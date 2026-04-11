// scripts/sources/epistemonikos.js
// Ingestion adapter for Epistemonikos (https://www.epistemonikos.org).
//
// Epistemonikos is a systematic-review aggregator with ~900k documents.
// Their API requires an API key passed via the Apikey header. Get one
// by emailing their team at https://www.epistemonikos.org/en/about_us/contact_us
//
// Self-limited to 2 RPS since Epistemonikos is a small organization
// and we want to be a good citizen.

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.epistemonikos.org/v1/search/documents";
const PAGE_SIZE = 50;

const waitSlot = createLimiter(2); // 2 RPS, conservative

function buildSearchUrl(query, page) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    per_page: String(PAGE_SIZE),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, page) {
  const apiKey = process.env.EPISTEMONIKOS_API_KEY;
  if (!apiKey) {
    throw new SourcePermanentError(
      "EPISTEMONIKOS_API_KEY env var is not set — cannot call Epistemonikos API. " +
      "Obtain a key by emailing https://www.epistemonikos.org/en/about_us/contact_us"
    );
  }
  await waitSlot();
  const url = buildSearchUrl(query, page);
  const resp = await fetchWithTimeoutAndUA(url, {
    accept: "application/json",
    headers: { Apikey: apiKey },
  });
  return resp.json();
}

function normalize(doc) {
  const year = doc.publication_year;
  // Local-time Jan 1 so getFullYear() round-trips cleanly regardless of TZ.
  const publishedAt = year ? new Date(year, 0, 1) : null;
  const docType = doc.document_type || null;
  const isPeerReviewed =
    docType === "systematic-review" ||
    docType === "primary-study" ||
    docType === "structured-summary";
  return {
    externalId: doc.id,
    source: "epistemonikos",
    title: (doc.title || "").trim() || null,
    abstract: (doc.abstract || "").trim() || null,
    doi: doc.doi || null,
    publishedAt,
    journal: doc.journal || null,
    authors: Array.isArray(doc.authors) ? doc.authors : [],
    peerReviewed: isPeerReviewed,
    sourceMetadata: {
      epistemonikos_id: doc.id,
      document_type: docType,
    },
  };
}

export const epistemonikos = {
  id: "epistemonikos",
  name: "Epistemonikos",
  peerReviewed: true,
  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let page = 1;
    let yielded = 0;
    while (yielded < target) {
      const body = await searchPage(query, page);
      const docs = Array.isArray(body?.documents) ? body.documents : [];
      if (docs.length === 0) {
        if (page === 1) {
          throw new SourcePermanentError(`epistemonikos returned 0 results for query: ${query}`);
        }
        return;
      }
      for (const d of docs) {
        const paper = normalize(d);
        if (!paper.externalId || !paper.title) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      page += 1;
      if (typeof body?.total === "number" && page * PAGE_SIZE >= body.total) return;
    }
  },
};

registerIngestion(epistemonikos);
