// scripts/sources/europepmc.js
// Ingestion adapter for Europe PMC REST API.
// Docs: https://europepmc.org/RestfulWebService
// Rate-limited to 5 RPS (unauthenticated).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PAGE_SIZE = 100;

const waitSlot = createLimiter(5); // 5 RPS

/**
 * Perform one search page request.
 * @param {string} query
 * @param {string} cursorMark
 * @returns {Promise<{results: object[], nextCursorMark: string}>}
 */
async function searchPage(query, cursorMark) {
  await waitSlot();
  const url =
    `${SEARCH_URL}?query=${encodeURIComponent(query)}` +
    `&format=json&resultType=core&pageSize=${PAGE_SIZE}` +
    `&cursorMark=${encodeURIComponent(cursorMark)}`;
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  const data = await resp.json();
  return {
    results: data.resultList?.result ?? [],
    nextCursorMark: data.nextCursorMark ?? null,
  };
}

function mapResult(r) {
  // externalId: prefer pmid, fall back to doi; skip if neither
  const externalId = r.pmid ? String(r.pmid) : (r.doi ?? null);
  if (!externalId) return null;
  if (!r.title) return null;

  const publishedAt = r.firstPublicationDate
    ? new Date(r.firstPublicationDate)
    : r.pubYear
    ? new Date(`${r.pubYear}-01-01`)
    : null;

  return {
    externalId,
    source: "europepmc",
    title: r.title,
    abstract: r.abstractText ?? null,
    doi: r.doi ?? null,
    publishedAt,
    journal: r.journalTitle ?? null,
    authors: r.authorString ? r.authorString.split(", ") : [],
    peerReviewed: true,
    sourceMetadata: {
      pmid: r.pmid ?? null,
      pmcid: r.pmcid ?? null,
      source: r.source ?? null,
    },
  };
}

export const europepmc = {
  id: "europepmc",
  name: "Europe PMC",
  peerReviewed: true,
  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    let yielded = 0;
    let cursorMark = "*";
    let firstPage = true;

    while (yielded < target) {
      const { results, nextCursorMark } = await searchPage(query, cursorMark);
      if (results.length === 0) {
        // Signal bad/empty queries as permanent — matches pubmed.js behavior.
        // Only on the first page — later empty pages just mean end-of-results.
        if (firstPage) {
          throw new SourcePermanentError(`europepmc search returned 0 results for query: ${query}`);
        }
        return;
      }
      firstPage = false;

      for (const r of results) {
        const paper = mapResult(r);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }

      // pagination: stop when nextCursorMark equals current cursor
      if (!nextCursorMark || nextCursorMark === cursorMark) return;
      cursorMark = nextCursorMark;
    }
  },
};

registerIngestion(europepmc);
