// scripts/sources/semantic-scholar.js
// Ingestion adapter for Semantic Scholar (https://www.semanticscholar.org).
//
// S2 has ~200M papers with strong coverage of CS, biology, and
// increasingly exercise science. Free API with x-api-key unlocking
// 10 req/sec (vs 1 req/sec anonymous). Key lives in
// process.env.SEMANTIC_SCHOLAR_API_KEY — already set in prod from
// the existing citation backfill pipeline.
//
// Search endpoint: https://api.semanticscholar.org/graph/v1/paper/search
// API docs: https://api.semanticscholar.org/api-docs/graph

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const PAGE_SIZE = 100; // S2 search max is 100
// S2's /paper/search endpoint enforces `offset + limit < 1000`. With
// PAGE_SIZE=100, the last valid request is offset=800 (800 + 100 = 900
// < 1000); offset=900 would produce 900 + 100 = 1000 which S2 rejects
// with a 400. /paper/search/bulk has no offset cap but returns fewer
// fields — enough of our target topics stay well under 1000 results
// that we live with the cap for now.
const S2_SEARCH_OFFSET_CAP = 1000;
const FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "venue",
  "authors",
  "isOpenAccess",
  "publicationTypes",
].join(",");

const waitSlot = createLimiter(1); // 1 RPS — S2 docs say 1 req/s with API key

/**
 * S2's /paper/search expects plain keyword queries — it doesn't parse
 * Lucene boolean syntax. Our topic queries look like
 * `(creatine OR "creatine monohydrate") AND ("resistance training" OR strength)`
 * which S2 treats as a literal phrase match and returns 0 results.
 * Strip the operators/quotes/parens and send just the keywords.
 */
export function sanitizeToKeywords(query) {
  if (!query || typeof query !== "string") return "";
  return query
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    .replace(/["']/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchUrl(query, offset) {
  const params = new URLSearchParams({
    query: sanitizeToKeywords(query),
    limit: String(PAGE_SIZE),
    offset: String(offset),
    fields: FIELDS,
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, offset) {
  await waitSlot();
  const url = buildSearchUrl(query, offset);
  const extraHeaders = {};
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (apiKey) extraHeaders["x-api-key"] = apiKey;
  const resp = await fetchWithTimeoutAndUA(url, {
    accept: "application/json",
    headers: extraHeaders,
  });
  return resp.json();
}

function normalize(paper) {
  const year = paper.year;
  // Local-time Jan 1 so getFullYear() round-trips cleanly regardless of TZ.
  const publishedAt = year ? new Date(year, 0, 1) : null;
  const pubTypes = Array.isArray(paper.publicationTypes) ? paper.publicationTypes : [];
  const isJournal = pubTypes.includes("JournalArticle") || pubTypes.includes("Review");
  return {
    externalId: paper.paperId,
    source: "semantic-scholar",
    title: (paper.title || "").trim() || null,
    abstract: (paper.abstract || "").trim() || null,
    doi: paper.externalIds?.DOI ?? null,
    publishedAt,
    journal: paper.venue || null,
    authors: (paper.authors || []).map((a) => a.name).filter(Boolean),
    peerReviewed: isJournal,
    sourceMetadata: {
      s2_paper_id: paper.paperId,
      pubmed_id: paper.externalIds?.PubMed ?? null,
      is_open_access: paper.isOpenAccess ?? null,
      publication_types: pubTypes,
    },
  };
}

export const semanticScholar = {
  id: "semantic-scholar",
  name: "Semantic Scholar",
  peerReviewed: true,
  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let offset = 0;
    let yielded = 0;
    while (yielded < target) {
      // Hard cap on S2 /paper/search offset+limit. If the NEXT request
      // would push us to or past the cap, stop — returning < target
      // papers is fine since we're just one source among many.
      if (offset + PAGE_SIZE >= S2_SEARCH_OFFSET_CAP) return;
      const body = await searchPage(query, offset);
      const papers = Array.isArray(body?.data) ? body.data : [];
      if (papers.length === 0) {
        // 0 results is a valid outcome — S2 search is keyword-based and
        // many niche exercise-science topics simply have no coverage.
        return;
      }
      for (const p of papers) {
        const paper = normalize(p);
        if (!paper.externalId || !paper.title) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      // S2 returns `next` for the next offset; fall back to offset + page_size
      offset = typeof body?.next === "number" ? body.next : offset + PAGE_SIZE;
      if (typeof body?.total === "number" && offset >= body.total) return;
    }
  },
};

registerIngestion(semanticScholar);
