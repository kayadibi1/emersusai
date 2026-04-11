// scripts/sources/openaire.js
// Ingestion adapter for OpenAIRE Graph v1 API.
//
// OpenAIRE is the EU open-access research aggregator with ~150M records
// pulled from national repositories across Europe. The legacy REST
// endpoint at /search/publications was deprecated and is currently
// unresponsive — we use their new Graph v1 API at /graph/v1/researchProducts.
//
// Graph API docs: https://graph.openaire.eu/docs/apis/graph-api/
//
// Query parameters: `search`, `pageSize`, `page`, optional `type=publication`.
// Response shape: { header: { numFound, page, pageSize }, results: [...] }
//
// OpenAIRE Graph search expects plain keyword queries — not Lucene/boolean
// syntax. We sanitize the upstream topic query via sanitizeToKeywords()
// before passing it to avoid the 25s+ query-parser hangs we saw in prod.

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.openaire.eu/graph/v1/researchProducts";
const PAGE_SIZE = 50;

const waitSlot = createLimiter(2); // 2 RPS, polite

/**
 * Collapse a boolean research query (`(creatine OR "creatine monohydrate")
 * AND ("resistance training" OR strength)`) into plain whitespace-separated
 * keywords. OpenAIRE Graph's `search` param does keyword relevance
 * matching, not boolean parsing — a complex query causes a 25s timeout.
 */
export function sanitizeToKeywords(query) {
  if (!query || typeof query !== "string") return "";
  return query
    // Drop boolean operators (as whole words)
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    // Drop quotes
    .replace(/["']/g, " ")
    // Drop parens
    .replace(/[()]/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchUrl(query, page) {
  const params = new URLSearchParams({
    search: sanitizeToKeywords(query),
    pageSize: String(PAGE_SIZE),
    page: String(page),
    type: "publication",
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, page) {
  await waitSlot();
  const url = buildSearchUrl(query, page);
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  return resp.json();
}

/** OpenAIRE descriptions often include <jats:p>...</jats:p> wrappers. Strip them. */
function stripJats(text) {
  if (!text || typeof text !== "string") return null;
  return text
    .replace(/<\/?jats:[a-zA-Z]+[^>]*>/g, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function extractDoi(pids) {
  if (!Array.isArray(pids)) return null;
  for (const p of pids) {
    if (p?.scheme === "doi" && p.value) return p.value;
  }
  return null;
}

function extractPubmedId(pids) {
  if (!Array.isArray(pids)) return null;
  for (const p of pids) {
    if (p?.scheme === "pmid" && p.value) return p.value;
  }
  return null;
}

function normalize(product) {
  const title = typeof product.mainTitle === "string" ? product.mainTitle.trim() : "";
  if (!title) return null;

  const abstract = Array.isArray(product.descriptions) && product.descriptions.length > 0
    ? stripJats(product.descriptions[0])
    : null;

  const doi = extractDoi(product.pids);
  const dateStr = product.publicationDate || null;
  const publishedAt = dateStr ? new Date(dateStr) : null;

  // Use the OpenAIRE id as the stable externalId (it's e.g.
  // "doi_dedup___::f2ef26f432cc9e0b8cedaba451799145"). Falls back to DOI
  // then a title+date hash if neither is present.
  const externalId = product.id
    || doi
    || `openaire:${title.slice(0, 80)}-${dateStr || "nodate"}`;

  return {
    externalId,
    source: "openaire",
    title,
    abstract,
    doi,
    publishedAt,
    journal: product.container?.name ?? null,
    authors: Array.isArray(product.authors)
      ? product.authors.map((a) => a?.fullName).filter(Boolean)
      : [],
    peerReviewed: true, // OpenAIRE publications are assumed peer-reviewed
    sourceMetadata: {
      openaire_id: product.id ?? null,
      type: product.type ?? null,
      publisher: product.publisher ?? null,
      pubmed_id: extractPubmedId(product.pids),
      open_access_color: product.openAccessColor ?? null,
    },
  };
}

export const openaire = {
  id: "openaire",
  name: "OpenAIRE",
  peerReviewed: true,
  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let page = 1;
    let yielded = 0;
    while (yielded < target) {
      const body = await searchPage(query, page);
      const results = Array.isArray(body?.results) ? body.results : [];
      if (results.length === 0) {
        if (page === 1) {
          throw new SourcePermanentError(`openaire returned 0 results for query: ${query}`);
        }
        return;
      }
      for (const product of results) {
        const paper = normalize(product);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      const numFound = body?.header?.numFound;
      if (typeof numFound === "number" && page * PAGE_SIZE >= numFound) return;
      page += 1;
    }
  },
};

registerIngestion(openaire);
