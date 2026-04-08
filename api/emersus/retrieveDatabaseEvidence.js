import { supabaseAdmin } from "../lib/clients.js";
import { embedText } from "./embeddings.js";

// Pure candidate fetcher: embeds the prompt, runs the pgvector RPC, joins
// each matched chunk to its pubmed_articles row, and returns the raw set.
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
}) {
  const queryEmbedding = await embedText(prompt);

  const { data: matches, error: matchError } = await supabaseAdmin.rpc(
    "match_evidence_chunks",
    {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
    }
  );

  if (matchError) {
    throw new Error(`Vector search failed: ${matchError.message}`);
  }

  if (!matches || matches.length === 0) {
    return [];
  }

  const pmids = [...new Set(matches.map((m) => m.pmid).filter(Boolean))];

  const { data: articles, error: articleError } = await supabaseAdmin
    .from("pubmed_articles")
    .select(
      "pmid,doi,pmcid,title,abstract,authors,journal,publication_date,publication_year,publication_types,mesh_terms,is_deleted"
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
      similarity: row.similarity,
      chunk_type: row.chunk_type,
      chunk_text: row.content,
      title: row.article.title,
      doi: row.article.doi,
      pmcid: row.article.pmcid,
      authors: Array.isArray(row.article.authors) ? row.article.authors : [],
      journal: row.article.journal,
      publication_date: row.article.publication_date,
      publication_year: row.article.publication_year,
      publication_types: row.article.publication_types || [],
      mesh_terms: row.article.mesh_terms || [],
    }));
}
