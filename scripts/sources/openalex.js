// scripts/sources/openalex.js
// Ingestion adapter for OpenAlex (https://openalex.org).
//
// OpenAlex is a free, open-access research index with ~250M works.
// Their "polite pool" gives priority access when a contact email is
// passed via the mailto= query param. Limit: 10 req/sec polite,
// we self-limit to 8 for safety margin.
//
// API docs: https://docs.openalex.org/api-entities/works

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const WORKS_URL = "https://api.openalex.org/works";
const PER_PAGE = 50; // OpenAlex max per_page is 200 but 50 is friendlier

const waitSlot = createLimiter(8); // 8 RPS with polite pool

/**
 * OpenAlex stores abstracts as an "inverted index" — a map of word →
 * [positions]. We reconstruct the plain text by sorting words by their
 * lowest position and joining with spaces. Not perfect (loses exact
 * punctuation and word reuse) but good enough for embedding chunks.
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return null;
  const positioned = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      positioned.push([pos, word]);
    }
  }
  if (positioned.length === 0) return null;
  positioned.sort((a, b) => a[0] - b[0]);
  return positioned.map(([, word]) => word).join(" ");
}

/** Normalize an OpenAlex work id URL (`https://openalex.org/W2087402540`) to the bare id. */
function shortWorkId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/(W\d+)$/);
  return match ? match[1] : url;
}

/** Strip the `https://doi.org/` prefix from an OpenAlex DOI field. */
function shortDoi(url) {
  if (!url || typeof url !== "string") return null;
  return url.replace(/^https?:\/\/doi\.org\//i, "") || null;
}

function buildSearchUrl(query, page) {
  const params = new URLSearchParams({
    search: query,
    page: String(page),
    "per-page": String(PER_PAGE),
  });
  const mailto = process.env.OPENALEX_POLITE_EMAIL;
  if (mailto) params.set("mailto", mailto);
  return `${WORKS_URL}?${params.toString()}`;
}

async function fetchPage(query, page) {
  await waitSlot();
  const url = buildSearchUrl(query, page);
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  const body = await resp.json();
  return body;
}

function normalize(work) {
  const pubDateStr = work.publication_date;
  const publishedAt = pubDateStr ? new Date(pubDateStr) : null;
  return {
    externalId: shortWorkId(work.id),
    source: "openalex",
    title: (work.title || "").trim() || null,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    doi: shortDoi(work.doi),
    publishedAt,
    journal: work.primary_location?.source?.display_name ?? null,
    authors: (work.authorships || [])
      .map((a) => a.author?.display_name)
      .filter(Boolean),
    peerReviewed: work.type === "article" || work.type === "review",
    sourceMetadata: {
      openalex_id: shortWorkId(work.id),
      type: work.type,
    },
  };
}

export const openalex = {
  id: "openalex",
  name: "OpenAlex",
  peerReviewed: true,
  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let yielded = 0;
    let page = 1;
    while (yielded < target) {
      const body = await fetchPage(query, page);
      const results = Array.isArray(body?.results) ? body.results : [];
      if (results.length === 0) {
        if (page === 1) {
          throw new SourcePermanentError(`openalex returned 0 results for query: ${query}`);
        }
        return;
      }
      for (const work of results) {
        const paper = normalize(work);
        if (!paper.externalId || !paper.title) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      page += 1;
    }
  },
};

registerIngestion(openalex);
