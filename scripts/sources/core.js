// scripts/sources/core.js
// Ingestion adapter for CORE (https://core.ac.uk).
//
// CORE is a UK-based open-access aggregator with ~250M papers. Their
// v3 API uses Bearer-token auth. Get a key by registering at
// https://core.ac.uk/services/api (self-service, instant).
//
// API docs: https://api.core.ac.uk/docs/v3

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.core.ac.uk/v3/search/works";
const PAGE_SIZE = 50;

const waitSlot = createLimiter(8); // 8 RPS with key (ceiling is 10)

function buildSearchUrl(query, offset) {
  const params = new URLSearchParams({
    q: query,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, offset) {
  const apiKey = process.env.CORE_API_KEY;
  if (!apiKey) {
    throw new SourcePermanentError(
      "CORE_API_KEY env var is not set — cannot call CORE API. " +
      "Register at https://core.ac.uk/services/api to get a key."
    );
  }
  await waitSlot();
  const url = buildSearchUrl(query, offset);
  const resp = await fetchWithTimeoutAndUA(url, {
    accept: "application/json",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  return resp.json();
}

function normalize(work) {
  const dateStr = work.publishedDate || (work.yearPublished ? `${work.yearPublished}-01-01` : null);
  const publishedAt = dateStr ? new Date(dateStr) : null;
  return {
    externalId: String(work.id),
    source: "core",
    title: (work.title || "").trim() || null,
    abstract: (work.abstract || "").trim() || null,
    doi: work.doi || null,
    publishedAt,
    journal: work.publisher || null,
    authors: (work.authors || []).map((a) => a.name).filter(Boolean),
    peerReviewed: true, // CORE indexes primarily peer-reviewed journals; not perfect but a reasonable default
    sourceMetadata: {
      core_id: String(work.id),
      download_url: work.downloadUrl || null,
    },
  };
}

export const core = {
  id: "core",
  name: "CORE",
  peerReviewed: true,
  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let offset = 0;
    let yielded = 0;
    while (yielded < target) {
      const body = await searchPage(query, offset);
      const results = Array.isArray(body?.results) ? body.results : [];
      if (results.length === 0) {
        if (offset === 0) {
          throw new SourcePermanentError(`core returned 0 results for query: ${query}`);
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
      offset += PAGE_SIZE;
      if (typeof body?.totalHits === "number" && offset >= body.totalHits) return;
    }
  },
};

registerIngestion(core);
