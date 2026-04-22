// scripts/sources/openalex.js
// Ingestion adapter for OpenAlex (https://openalex.org).
//
// OpenAlex is a free, open-access research index with ~250M works.
// As of 2025, OpenAlex migrated from the old mailto= polite pool to a
// freemium API-key model. Without an api_key, budget is $0.01/day
// (~100 list calls). Free API key gives $1/day (~10,000 list calls,
// 1,000 full-text searches). Register at https://openalex.org/settings/api.
//
// Docs: https://developers.openalex.org

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion } from "./_registry.js";

const WORKS_URL = "https://api.openalex.org/works";
const PER_PAGE = 200; // OpenAlex max — minimizes search calls ($1/1000)

// 3 RPS — was 8, but the free-tier API key budget is $1/day ≈ 10k list
// calls. A bulk-ingest run (303 topics × ~3 pages each ≈ 900 calls) is
// fine at 8 RPS for one run, but back-to-back runs in the same UTC day
// (manual fill + scheduled fill, or a re-run after a partial failure)
// blew through the budget and triggered a failure-cluster alert
// (2026-04-21). 3 RPS keeps a single run under ~1h wall time and leaves
// budget headroom for accidental re-runs in the same day.
const waitSlot = createLimiter(3);

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
  const apiKey = process.env.OPENALEX_API_KEY;
  if (apiKey) params.set("api_key", apiKey);
  // Legacy mailto= polite pool — still accepted alongside api_key
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

// OpenAlex `work.type` values that are NOT citable evidence for our
// fitness/nutrition chat. Mirrors jobs/ingest-openalex-bulk.js (audit
// 2026-04-22 — a per-topic run produced SEO/PED-marketing "report"-type
// rows like "TrenMax Guide 2026" that got retrieved as evidence). Drop
// these at the adapter layer so the generic ingest-topic-from-source
// handler never inserts them.
const OPENALEX_DROP_TYPES = new Set([
  "dataset", "libguides", "peer-review", "erratum", "paratext",
  "supplementary-materials", "other", "dissertation", "book",
  "book-chapter", "letter", "editorial", "report", "reference-entry",
  "standard", "retraction",
]);

function normalize(work) {
  if (OPENALEX_DROP_TYPES.has(work.type)) return null;
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
        // 0 results is a valid outcome — not every topic has OpenAlex coverage.
        return;
      }
      for (const work of results) {
        const paper = normalize(work);
        if (!paper || !paper.externalId || !paper.title) continue;
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
