// scripts/sources/biorxiv.js
// Ingestion + discovery adapter for bioRxiv.
//
// NOTE: The bioRxiv API does NOT accept free-text queries. The API only supports
// date-range and DOI lookups. For fetchPapers(), we fetch recent papers in 30-day
// chunks and apply client-side keyword filtering.
//
// Rate-limited to 1 RPS shared with medrxiv (both use api.biorxiv.org).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { biorxivLimiter } from "./_shared-limiters.js";
import { registerIngestion, registerDiscovery } from "./_registry.js";
import { parseQueryIntoGroups, matchesQueryGroups } from "./_query-match.js";
import { SourceTransientError } from "./_errors.js";

const BASE_URL = "https://api.biorxiv.org/details/biorxiv";
const PAGE_SIZE = 100;

// Early-termination knobs. The biorxiv API has no keyword search, so
// we pull chunked date ranges and filter client-side. For niche topics
// (e.g., creatine) most chunks return zero matches. Without early
// termination, a target=20 scan can take 3+ minutes walking all 12
// monthly chunks and hit the pg-boss batch-blocking pathology documented
// in the 2026-04-12 checkpoint.
//
// Heuristic: walk newest → oldest in 30-day chunks. Bail after this many
// CONSECUTIVE zero-match chunks (trends usually cluster in a window).
const MAX_CONSECUTIVE_EMPTY_CHUNKS = 3;
// Per-chunk page cap so one huge chunk can't spin forever. 5 pages × 100
// papers/page × 1 RPS ≈ 5s per chunk worst case.
const MAX_PAGES_PER_CHUNK = 5;

const waitSlot = biorxivLimiter;

/**
 * Fetch one page of bioRxiv papers for a date range.
 * @param {string} from YYYY-MM-DD
 * @param {string} to   YYYY-MM-DD
 * @param {number} cursor
 */
async function fetchPage(from, to, cursor) {
  await waitSlot();
  const url = `${BASE_URL}/${from}/${to}/${cursor}`;
  // 15s timeout: a healthy biorxiv response is 5–8s; a stalled PHP
  // backend won't recover even if we wait 45s. Faster failure means
  // SourceTransientError fires sooner, page-skip advances faster.
  // The watermark optimization (sweep handler computes daysBack from
  // max(publication_date)) keeps total request count low enough that
  // re-fetching skipped pages on next sweep is cheap.
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json", timeoutMs: 15_000 });
  const data = await resp.json();
  const msg = data.messages?.[0] ?? {};
  return {
    collection: data.collection ?? [],
    total: Number(msg.total ?? 0),
    count: Number(msg.count ?? 0),
  };
}

function mapRecord(c) {
  if (!c.doi) return null;
  return {
    externalId: c.doi,
    source: "biorxiv",
    title: c.title ?? "",
    abstract: c.abstract ?? null,
    doi: c.doi,
    publishedAt: c.date ? new Date(c.date) : null,
    journal: "bioRxiv",
    authors: c.authors ? c.authors.split("; ") : [],
    peerReviewed: false,
    sourceMetadata: { category: c.category ?? null, type: c.type ?? null },
  };
}

/** Build date strings for the last N days relative to today. */
function dateRange(daysBack) {
  const to = new Date();
  const from = new Date(to - daysBack * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export const biorxiv = {
  id: "biorxiv",
  name: "bioRxiv",
  peerReviewed: false,

  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    const groups = parseQueryIntoGroups(query);
    let yielded = 0;
    let consecutiveEmptyChunks = 0;

    // Scan last N days in 30-day chunks, NEWEST to OLDEST. Bails out
    // after MAX_CONSECUTIVE_EMPTY_CHUNKS so niche topics don't spin
    // forever. opts.daysBack lets sweep-mode callers shrink the window
    // for weekly top-up runs (default 365 for first-fill / per-topic).
    const totalDays = opts?.daysBack ?? 365;
    const chunkDays = 30;

    for (let daysAgo = 0; daysAgo < totalDays && yielded < target; daysAgo += chunkDays) {
      const chunkStart = daysAgo;
      const chunkEnd = Math.min(totalDays, daysAgo + chunkDays);
      const to = new Date(Date.now() - chunkStart * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - chunkEnd * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      let cursor = 0;
      let pagesInThisChunk = 0;
      let total = Infinity;
      let chunkYielded = 0;

      while (cursor <= total - 1 && yielded < target && pagesInThisChunk < MAX_PAGES_PER_CHUNK) {
        let pageData;
        try {
          pageData = await fetchPage(from, to, cursor);
        } catch (err) {
          // api.biorxiv.org's PHP backend periodically emits fatal errors
          // (mysqli connection failures, timeouts) on individual cursors
          // mid-chunk. One bad page should not kill the iteration —
          // advance the cursor and try the next page.
          if (err instanceof SourceTransientError) {
            cursor += PAGE_SIZE;
            pagesInThisChunk += 1;
            continue;
          }
          throw err;
        }
        const { collection, total: t, count } = pageData;
        total = t;
        pagesInThisChunk += 1;

        for (const c of collection) {
          if (opts?.signal?.aborted) return;
          if (!matchesQueryGroups(groups, c.title ?? "", c.abstract ?? "")) continue;
          const paper = mapRecord(c);
          if (!paper) continue;
          yield paper;
          yielded += 1;
          chunkYielded += 1;
          if (yielded >= target) return;
        }

        if (collection.length === 0 || count === 0) break;
        cursor += PAGE_SIZE;
      }

      if (chunkYielded === 0) {
        consecutiveEmptyChunks += 1;
        if (consecutiveEmptyChunks >= MAX_CONSECUTIVE_EMPTY_CHUNKS) return;
      } else {
        consecutiveEmptyChunks = 0;
      }
    }
  },

  // Discovery role: fetch new preprints since last_item_at
  async fetchNew(feedRow) {
    const { from, to } = dateRange(30);
    const watermark = feedRow.last_item_at ? new Date(feedRow.last_item_at) : null;
    const items = [];

    let cursor = 0;
    let total = Infinity;

    while (cursor <= total - 1) {
      const { collection, total: t, count } = await fetchPage(from, to, cursor);
      total = t;
      for (const c of collection) {
        const publishedAt = c.date ? new Date(c.date) : null;
        if (!c.doi) continue;
        if (watermark && publishedAt && publishedAt <= watermark) continue;
        items.push({
          url: `https://doi.org/${c.doi}`,
          title: c.title ?? "",
          abstract: c.abstract ?? null,
          publishedAt,
          feedId: feedRow.id,
        });
      }
      if (collection.length === 0 || count === 0) break;
      cursor += PAGE_SIZE;
    }

    return items;
  },
};

registerIngestion(biorxiv);
registerDiscovery(biorxiv);
