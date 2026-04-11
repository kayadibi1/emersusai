// scripts/sources/doaj.js
// Ingestion adapter for the Directory of Open Access Journals (DOAJ) API v2.
// Docs: https://doaj.org/api/v2/docs
// Rate-limited to 2 RPS.
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const BASE_URL = "https://doaj.org/api/v2/search/articles";
const PAGE_SIZE = 100;

const waitSlot = createLimiter(2); // 2 RPS

/**
 * Fetch one page of DOAJ articles.
 * @param {string} query
 * @param {number} page  1-based page number
 */
async function fetchPage(query, page) {
  await waitSlot();
  const url =
    `${BASE_URL}/${encodeURIComponent(query)}` +
    `?pageSize=${PAGE_SIZE}&page=${page}`;
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  const data = await resp.json();
  return {
    results: data.results ?? [],
    total: data.total ?? 0,
  };
}

function mapResult(result) {
  const bib = result.bibjson ?? {};

  // Extract DOI from identifier array
  const doiEntry = (bib.identifier ?? []).find(i => i.type === "doi");
  const doi = doiEntry?.id ?? null;
  if (!doi) return null;

  const title = bib.title ?? null;
  if (!title) return null;

  // Skip records with no abstract
  const abstract = bib.abstract?.trim() || null;
  if (!abstract) return null;

  const yearStr = bib.year ?? null;
  const monthStr = bib.month ?? null;
  const publishedAt = yearStr
    ? new Date(`${yearStr}-${(monthStr ?? "1").padStart(2, "0")}-01`)
    : null;

  return {
    externalId: doi,
    source: "doaj",
    title,
    abstract,
    doi,
    publishedAt,
    journal: bib.journal?.title ?? null,
    authors: (bib.author ?? []).map(a => a.name).filter(Boolean),
    peerReviewed: true,
    sourceMetadata: { doajId: result.id },
  };
}

export const doaj = {
  id: "doaj",
  name: "DOAJ",
  peerReviewed: true,

  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    let yielded = 0;
    let page = 1;
    let total = Infinity;

    while (yielded < target) {
      const { results, total: t } = await fetchPage(query, page);
      total = t;
      if (page === 1 && total === 0) {
        throw new SourcePermanentError(`doaj search returned 0 total results for query: ${query}`);
      }
      if (results.length === 0) return;

      for (const result of results) {
        if (opts?.signal?.aborted) return;
        const paper = mapResult(result);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      if (page * PAGE_SIZE >= total) return;
      page += 1;
    }
  },
};

registerIngestion(doaj);
