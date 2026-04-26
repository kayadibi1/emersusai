import { supabaseAdmin } from "../lib/clients.js";
import { embedText } from "./embeddings.js";
import { generateHydePassage } from "./pipeline/hyde.js";
import { jinaRerank, isJinaConfigured } from "./pipeline/jina-rerank.js";
import { zerankRerank, isZerankConfigured } from "./pipeline/zerank-rerank.js";

/**
 * Group matches by DOI and keep the best-ranked chunk per DOI.
 * Matches without a DOI (preprints without an assigned DOI, etc.) are
 * preserved as-is. Used to dedup cross-source results — e.g., a paper
 * with DOI 10.1/foo indexed by both pubmed and openalex as separate
 * research_articles rows should collapse to one in retrieval.
 *
 * Tiebreaker: _zerank_score > _jina_score > rrf_score > similarity, so the
 * cross-encoder-preferred variant of a paper wins when a reranker ran.
 *
 * Operates on the flat row shape returned by retrieveDatabaseEvidence:
 *   { pmid, source, doi, similarity, _zerank_score?, _jina_score?, title, ... }
 *
 * @param {Array<object>} rows
 * @returns {Array<object>} deduped rows
 */
export function dedupByDoi(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const byDoi = new Map();
  const withoutDoi = [];
  for (const row of rows) {
    const doi = row?.doi;
    if (!doi) {
      withoutDoi.push(row);
      continue;
    }
    const existing = byDoi.get(doi);
    if (!existing) {
      byDoi.set(doi, row);
      continue;
    }
    const rowScore = row._zerank_score ?? row._jina_score ?? row.rrf_score ?? (row.similarity ?? 0);
    const existingScore = existing._zerank_score ?? existing._jina_score ?? existing.rrf_score ?? (existing.similarity ?? 0);
    if (rowScore > existingScore) {
      byDoi.set(doi, row);
    }
  }
  return [...byDoi.values(), ...withoutDoi];
}

// Reciprocal Rank Fusion constant. k=60 is Cormack et al. SIGIR 2009
// default — rank-based so it's unit-free and doesn't need similarity
// normalization across the two retrieval variants (raw query vs HyDE).
const RRF_K = 60;

// RPC dispatch. Priority: v5 (hybrid BM25+dense) > v4 (dense+passage-sub) > v3 (dense).
// v5 requires query_text for the BM25 side; threshold is applied to the cosine
// lane only (default 0.0 so BM25 can surface papers cosine would reject).
async function runMatchRpc({ queryEmbedding, queryText, matchThreshold, matchCount, includePreprints }) {
  const useV5 = String(process.env.RETRIEVAL_USE_V5 || "").toLowerCase() === "true";
  if (useV5) {
    const { data, error } = await supabaseAdmin.rpc("match_evidence_chunks_hybrid_v5", {
      query_embedding: queryEmbedding,
      query_text: queryText || "",
      match_threshold: 0.0,
      match_count: matchCount,
      p_include_preprints: includePreprints,
    });
    if (error) throw new Error(`match_evidence_chunks_hybrid_v5 failed: ${error.message}`);
    return (data || []).map((row, idx) => ({ ...row, _rank: idx + 1 }));
  }

  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const rpcName = useV4 ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_include_preprints: includePreprints,
  });
  if (error) throw new Error(`Vector search failed (${rpcName}): ${error.message}`);
  // Attach positional rank for downstream RRF (ordered by similarity from the RPC).
  return (data || []).map((row, idx) => ({ ...row, _rank: idx + 1 }));
}

// Merge N candidate lists by pmid using RRF: score(p) = Σ 1/(k + rank_i(p)).
// The fused list is a superset of all input lists; documents present in
// multiple lists accumulate contributions from each. For display fields
// (id, chunk_type, content, similarity) we keep the variant with the
// highest similarity — that's the best-matching chunk across all queries.
function rrfMerge(lists, k = RRF_K) {
  const acc = new Map();
  for (const list of lists) {
    for (const row of list) {
      const key = Number(row.pmid);
      if (!Number.isFinite(key)) continue;
      const score = 1 / (k + (row._rank || 1));
      const existing = acc.get(key);
      if (!existing) {
        acc.set(key, { ...row, _rrf_score: score });
        continue;
      }
      existing._rrf_score += score;
      if ((row.similarity || 0) > (existing.similarity || 0)) {
        existing.id = row.id;
        existing.chunk_type = row.chunk_type;
        existing.content = row.content;
        existing.similarity = row.similarity;
        existing.matched_chunk_type = row.matched_chunk_type;
        existing.is_title_only_match = row.is_title_only_match;
      }
    }
  }
  return Array.from(acc.values()).sort((a, b) => b._rrf_score - a._rrf_score);
}

// Enrich raw chunk matches with research_articles metadata and map to the
// flat row shape every downstream consumer (rerank, workflow, retrieve.js)
// has been consuming since before HyDE existed. This is the single
// place the output shape is defined.
async function enrichMatches(matches) {
  if (!matches || matches.length === 0) return [];

  const pmids = [...new Set(matches.map((m) => m.pmid).filter(Boolean))];
  const { data: articles, error: articleError } = await supabaseAdmin
    .from("research_articles")
    .select(
      "pmid,source,external_id,doi,pmcid,title,abstract,authors,journal,publication_date,publication_year,publication_types,mesh_terms,is_deleted,rcr,citation_count,influential_citation_count,publication_country"
    )
    .in("pmid", pmids)
    .eq("is_deleted", false);

  if (articleError) {
    throw new Error(`Article fetch failed: ${articleError.message}`);
  }

  const byPmid = new Map((articles || []).map((a) => [a.pmid, a]));

  return matches
    .map((match) => ({
      ...match,
      article: byPmid.get(match.pmid) || null,
    }))
    .filter((row) => row.article)
    .map((row) => ({
      pmid: row.pmid,
      source: row.article.source ?? "pubmed",
      external_id: row.article.external_id ?? null,
      similarity: row.similarity,
      chunk_type: row.chunk_type,
      chunk_text: row.content,
      // v4 surfaces what actually matched the query (may be 'title' even
      // when chunk_text was substituted to an abstract). v3 returns
      // undefined for both — downstream treats undefined as
      // "matched=chunk_type, not title-only".
      matched_chunk_type: row.matched_chunk_type ?? row.chunk_type,
      is_title_only_match: row.is_title_only_match === true,
      rrf_score: row.rrf_score ?? null,
      bm25_score: row.bm25_score ?? null,
      title: row.article.title,
      doi: row.article.doi,
      pmcid: row.article.pmcid,
      authors: Array.isArray(row.article.authors) ? row.article.authors : [],
      journal: row.article.journal,
      publication_date: row.article.publication_date,
      publication_year: row.article.publication_year,
      publication_types: row.article.publication_types || [],
      mesh_terms: row.article.mesh_terms || [],
      // Credibility/impact signals for downstream rerank. NULL is a
      // valid state (NIH iCite hasn't computed RCR for recent papers);
      // the impact scorer treats it as neutral.
      rcr: row.article.rcr ?? null,
      citation_count: row.article.citation_count ?? null,
      influential_citation_count: row.article.influential_citation_count ?? null,
      publication_country: row.article.publication_country ?? null,
    }));
}

async function retrieveSingleQuery({ prompt, matchThreshold, matchCount, includePreprints }) {
  const queryEmbedding = await embedText(prompt);
  const matches = await runMatchRpc({ queryEmbedding, queryText: prompt, matchThreshold, matchCount, includePreprints });
  const enriched = await enrichMatches(matches);
  const reranked = await maybeRerank(prompt, enriched);
  return dedupByDoi(reranked);
}

// Optional cross-encoder rerank step. Two backends, mutually exclusive
// (zerank wins when both flags are on, since the 2026-04-25 shootout
// found zerank-2 the only stat-sig winner at +10pp doi@10).
// Runs after enrichment so the reranker sees the full candidate pool.
// Non-fatal — returns input unchanged on any API error.
async function maybeRerank(prompt, candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return candidates;

  const zerankFlag = String(process.env.CHAT_ZERANK_RERANK_ENABLED || "").toLowerCase() === "true";
  if (zerankFlag && isZerankConfigured()) {
    try {
      const reranked = await zerankRerank({
        query: prompt,
        candidates,
        topN: candidates.length,
        contentField: "chunk_text",
      });
      return Array.isArray(reranked) && reranked.length > 0 ? reranked : candidates;
    } catch (err) {
      console.warn(`[retrieval] zerank rerank failed (${err.message}); falling back to non-reranked candidates.`);
      return candidates;
    }
  }

  const jinaFlag = String(process.env.CHAT_JINA_RERANK_ENABLED || "").toLowerCase() === "true";
  if (jinaFlag && isJinaConfigured()) {
    try {
      const reranked = await jinaRerank({
        query: prompt,
        candidates,
        topN: candidates.length,
        contentField: "chunk_text",
      });
      return Array.isArray(reranked) && reranked.length > 0 ? reranked : candidates;
    } catch (err) {
      console.warn(`[retrieval] Jina rerank failed (${err.message}); falling back to non-reranked candidates.`);
      return candidates;
    }
  }

  return candidates;
}

// HyDE-augmented retrieval: generate a hypothetical passage, retrieve
// against both the raw prompt and the hypothetical, then RRF-merge the
// candidate pools before enriching. Per-sub-query matchCount is doubled
// so the fused pool has at least 2× candidates for the heuristic rerank
// downstream to choose from. If HyDE fails at any step, fall back to
// single-query retrieval — never block chat on the expansion.
async function retrieveWithHyde({ prompt, matchThreshold, matchCount, includePreprints }) {
  const hydePassage = await generateHydePassage(prompt);
  if (!hydePassage) {
    return retrieveSingleQuery({ prompt, matchThreshold, matchCount, includePreprints });
  }

  // Wider per-sub-query net so the fused pool is meaningfully richer.
  const expandedCount = Math.max(matchCount * 2, 20);
  const [origEmbedding, hydeEmbedding] = await Promise.all([
    embedText(prompt),
    embedText(hydePassage),
  ]);

  const [origMatches, hydeMatches] = await Promise.all([
    runMatchRpc({ queryEmbedding: origEmbedding, queryText: prompt, matchThreshold, matchCount: expandedCount, includePreprints }),
    runMatchRpc({ queryEmbedding: hydeEmbedding, queryText: hydePassage, matchThreshold, matchCount: expandedCount, includePreprints }),
  ]);

  const fused = rrfMerge([origMatches, hydeMatches]).slice(0, matchCount);
  const enriched = await enrichMatches(fused);
  const reranked = await maybeRerank(prompt, enriched);
  return dedupByDoi(reranked);
}

// Pure candidate fetcher: embeds the prompt, runs the pgvector RPC, joins
// each matched chunk to its research_articles row, and returns the raw set.
// All ranking happens downstream in rerank.js — this function deliberately
// does not sort or slice so the rerank operates on the full candidate
// pool from the RPC.
//
// The matchThreshold default mirrors the value every production caller
// actually passes. The previous default (0.65) was dead code: the only
// call site (workflow.js) always passes VECTOR_MATCH_THRESHOLD = 0.4, so
// the signature was lying about how strict retrieval actually is.
//
// When CHAT_HYDE_ENABLED=true, the function runs the HyDE-augmented path
// (two embeddings, two RPC calls, RRF fusion) — output shape is
// identical so downstream rerank/workflow code is unchanged.
export async function retrieveDatabaseEvidence({
  prompt,
  matchThreshold = 0.4,
  matchCount = 10,
  includePreprints = true,
}) {
  const hydeEnabled = String(process.env.CHAT_HYDE_ENABLED || "").toLowerCase() === "true";

  if (hydeEnabled) {
    try {
      return await retrieveWithHyde({ prompt, matchThreshold, matchCount, includePreprints });
    } catch (err) {
      console.warn(`HyDE retrieval failed (${err.message}); falling back to single-query.`);
    }
  }
  return retrieveSingleQuery({ prompt, matchThreshold, matchCount, includePreprints });
}
