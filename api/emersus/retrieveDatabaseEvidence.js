import { supabaseAdmin } from "../lib/clients.js";
import { embedText } from "./embeddings.js";

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
export async function retrieveDatabaseEvidence({
  prompt,
  matchThreshold = 0.4,
  matchCount = 10,
  includePreprints = true,
}) {
  const queryEmbedding = await embedText(prompt);

  // RETRIEVAL_USE_V4 toggles between match_evidence_chunks_v3 (default)
  // and v4 (source-centric with passage substitution + is_title_only_match).
  // v4 is already deduped per source inside the RPC; v3 is not, so we run
  // dedupByDoi only when on v3.
  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const rpcName = useV4 ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";

  const { data: matches, error: matchError } = await supabaseAdmin.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_include_preprints: includePreprints,
  });

  if (matchError) {
    throw new Error(`Vector search failed: ${matchError.message}`);
  }

  if (!matches || matches.length === 0) {
    return [];
  }

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

  const enriched = matches
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

  // v4 already deduped per source inside the RPC. v3 needs dedupByDoi
  // for cross-source DOI collisions.
  return useV4 ? enriched : dedupByDoi(enriched);
}
