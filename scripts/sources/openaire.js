// scripts/sources/openaire.js
// Ingestion adapter for OpenAIRE (https://www.openaire.eu/).
//
// OpenAIRE is the EU open-access research aggregator with ~150M records
// pulled from national repositories across Europe. Free REST API, no
// auth required. Response format is the legacy OAF XML shape rendered
// as JSON — nested but consistent once you know the path.
//
// API docs: https://graph.openaire.eu/docs/apis/search-api/publications/

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.openaire.eu/search/publications";
const PAGE_SIZE = 50;

const waitSlot = createLimiter(2); // 2 RPS, polite

function buildSearchUrl(query, page) {
  const params = new URLSearchParams({
    title: query,
    format: "json",
    size: String(PAGE_SIZE),
    page: String(page),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, page) {
  await waitSlot();
  const url = buildSearchUrl(query, page);
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  return resp.json();
}

function extractText(field) {
  if (!field) return null;
  if (typeof field === "string") return field;
  if (typeof field === "object" && field.$) return field.$;
  return null;
}

function extractDoi(pidField) {
  if (!pidField) return null;
  const list = Array.isArray(pidField) ? pidField : [pidField];
  for (const entry of list) {
    if (entry?.["@classid"] === "doi") return extractText(entry);
  }
  return null;
}

function extractAuthors(creatorField) {
  if (!creatorField) return [];
  const list = Array.isArray(creatorField) ? creatorField : [creatorField];
  return list.map(extractText).filter(Boolean);
}

function normalize(result) {
  const oaf = result?.metadata?.["oaf:entity"]?.["oaf:result"];
  if (!oaf) return null;
  const title = extractText(oaf.title);
  if (!title) return null;
  const doi = extractDoi(oaf.pid);
  const dateStr = extractText(oaf.dateofacceptance);
  const publishedAt = dateStr ? new Date(dateStr) : null;
  // OpenAIRE doesn't have a stable synthetic id — use the DOI if we have
  // one, otherwise fall back to a hash of title+date for determinism.
  const externalId = doi || `openaire:${title.slice(0, 80)}-${dateStr || "nodate"}`;
  return {
    externalId,
    source: "openaire",
    title,
    abstract: extractText(oaf.description),
    doi,
    publishedAt,
    journal: extractText(oaf.journal),
    authors: extractAuthors(oaf.creator),
    peerReviewed: true, // OpenAIRE publications are assumed peer-reviewed
    sourceMetadata: {
      resulttype: oaf.resulttype?.["@classname"] ?? null,
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
      const results = body?.response?.results?.result;
      const list = Array.isArray(results) ? results : (results ? [results] : []);
      if (list.length === 0) {
        if (page === 1) {
          throw new SourcePermanentError(`openaire returned 0 results for query: ${query}`);
        }
        return;
      }
      for (const r of list) {
        const paper = normalize(r);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      page += 1;
    }
  },
};

registerIngestion(openaire);
