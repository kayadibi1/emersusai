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
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const PAGE_SIZE = 100; // S2 search max is 100
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

const waitSlot = createLimiter(8); // 8 RPS with key (ceiling is 10)

function buildSearchUrl(query, offset) {
  const params = new URLSearchParams({
    query,
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
      const body = await searchPage(query, offset);
      const papers = Array.isArray(body?.data) ? body.data : [];
      if (papers.length === 0) {
        if (offset === 0) {
          throw new SourcePermanentError(`semantic-scholar returned 0 results for query: ${query}`);
        }
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
