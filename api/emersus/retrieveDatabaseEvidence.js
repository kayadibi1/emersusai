import { supabaseAdmin } from "../lib/clients.js";
import { embedText } from "./embeddings.js";

function scorePublicationType(publicationTypes = []) {
  const normalized = publicationTypes.map((x) => String(x).toLowerCase());

  if (normalized.some((x) => x.includes("guideline"))) return 5;
  if (
    normalized.some(
      (x) => x.includes("systematic review") || x.includes("meta-analysis")
    )
  ) {
    return 4;
  }
  if (normalized.some((x) => x.includes("randomized controlled trial"))) {
    return 3;
  }
  if (
    normalized.some(
      (x) =>
        x.includes("cohort") ||
        x.includes("observational") ||
        x.includes("clinical trial")
    )
  ) {
    return 2;
  }
  return 1;
}

function rerankMatch(match) {
  const article = match.article || {};
  const publicationTypes = article.publication_types || [];
  const evidenceWeight = scorePublicationType(publicationTypes);
  const similarity = Number(match.similarity || 0);

  return similarity + evidenceWeight * 0.03;
}

export async function retrieveDatabaseEvidence({
  prompt,
  limit = 6,
  matchThreshold = 0.65,
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
      "pmid,doi,pmcid,title,abstract,journal,publication_date,publication_year,publication_types,mesh_terms,is_deleted"
    )
    .in("pmid", pmids)
    .eq("is_deleted", false);

  if (articleError) {
    throw new Error(`Article fetch failed: ${articleError.message}`);
  }

  const byPmid = new Map((articles || []).map((a) => [a.pmid, a]));

  const joined = matches
    .map((match) => ({
      ...match,
      article: byPmid.get(match.pmid) || null,
    }))
    .filter((row) => row.article);

  joined.sort((a, b) => rerankMatch(b) - rerankMatch(a));

  return joined.slice(0, limit).map((row) => ({
    pmid: row.pmid,
    similarity: row.similarity,
    chunk_type: row.chunk_type,
    chunk_text: row.content,
    title: row.article.title,
    doi: row.article.doi,
    pmcid: row.article.pmcid,
    journal: row.article.journal,
    publication_date: row.article.publication_date,
    publication_year: row.article.publication_year,
    publication_types: row.article.publication_types || [],
    mesh_terms: row.article.mesh_terms || [],
  }));
}