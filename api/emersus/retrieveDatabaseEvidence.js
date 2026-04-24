import { supabaseAdmin } from "../lib/clients.js";
import { embedText } from "./embeddings.js";
import { generateHydePassage } from "./pipeline/hyde.js";
import { jinaRerank, isJinaConfigured } from "./pipeline/jina-rerank.js";

/**
 * Group matches by DOI and keep the highest-similarity chunk per DOI.
 * Matches without a DOI (preprints without an assigned DOI, etc.) are
 * preserved as-is. Used to dedup cross-source results — e.g., a paper
 * with DOI 10.1/foo indexed by both pubmed and openalex as separate
 * research_articles rows should collapse to one in retrieval.
 *
 * Operates on the flat row shape returned by retrieveDatabaseEvidence:
 *   { pmid, source, doi, similarity, title, ... }
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
    if (!existing || (row.similarity ?? 0) > (existing.similarity ?? 0)) {
      byDoi.set(doi, row);
    }
  }
  return [...byDoi.values(), ...withoutDoi];
}

// Reciprocal Rank Fusion constant. k=60 is Cormack et al. SIGIR 2009
// default — rank-based so it's unit-free and doesn't need similarity
// normalization across the two retrieval variants (raw query vs HyDE).
const RRF_K = 60;

// RPC dispatch — same v3/v4 toggle as the pre-HyDE path.
async function runMatchRpc({ queryEmbedding, matchThreshold, matchCount, includePreprints }) {
  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const rpcName = useV4 ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_include_preprints: includePreprints,
  });
  if (error) {
    throw new Error(`Vector search failed (${rpcName}): ${error.message}`);
  }
  // Attach rank for downstream RRF. Rank is the position in the RPC's
  // own ordering (by similarity), not any downstream rerank.
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
  const matches = await runMatchRpc({ queryEmbedding, matchThreshold, matchCount, includePreprints });
  const enriched = await enrichMatches(matches);
  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const deduped = useV4 ? enriched : dedupByDoi(enriched);
  return maybeJinaRerank(prompt, deduped);
}

// Optional cross-encoder rerank step applied to the full enriched candidate
// pool before the downstream heuristic (rankEvidence in api/emersus/rerank.js)
// sees it. Feature-flagged via CHAT_JINA_RERANK_ENABLED. Jina produces a
// stronger query-doc relevance signal than cosine similarity; the heuristic
// blend (freshness/quality/similarity/RCR) then boosts freshness + credibility
// on top of that reordered pool. Net: better relevance pool going into the
// final freshness/RCR blend, while preserving all existing UI signals.
//
// Non-fatal — jina-rerank.js catches API errors internally and returns the
// input unchanged, so retrieval never blocks on rerank.
async function maybeJinaRerank(prompt, candidates) {
  const flag = String(process.env.CHAT_JINA_RERANK_ENABLED || "").toLowerCase() === "true";
  if (!flag || !isJinaConfigured() || !Array.isArray(candidates) || candidates.length < 2) {
    return candidates;
  }
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
    runMatchRpc({ queryEmbedding: origEmbedding, matchThreshold, matchCount: expandedCount, includePreprints }),
    runMatchRpc({ queryEmbedding: hydeEmbedding, matchThreshold, matchCount: expandedCount, includePreprints }),
  ]);

  const fused = rrfMerge([origMatches, hydeMatches]).slice(0, matchCount);
  const enriched = await enrichMatches(fused);
  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const deduped = useV4 ? enriched : dedupByDoi(enriched);
  return maybeJinaRerank(prompt, deduped);
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
