// scripts/sources/medrxiv.js
// Ingestion + discovery adapter for medRxiv.
//
// NOTE: The medRxiv API (served by api.biorxiv.org) does NOT accept free-text queries.
// For fetchPapers(), we fetch recent papers in 30-day chunks and apply client-side
// keyword filtering.
//
// Rate-limited to 1 RPS shared with biorxiv (both use api.biorxiv.org).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { biorxivLimiter } from "./_shared-limiters.js";
import { registerIngestion, registerDiscovery } from "./_registry.js";

const BASE_URL = "https://api.biorxiv.org/details/medrxiv";
const PAGE_SIZE = 100;

const waitSlot = biorxivLimiter;

/**
 * Fetch one page of medRxiv papers for a date range.
 * @param {string} from YYYY-MM-DD
 * @param {string} to   YYYY-MM-DD
 * @param {number} cursor
 */
async function fetchPage(from, to, cursor) {
  await waitSlot();
  const url = `${BASE_URL}/${from}/${to}/${cursor}`;
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  const data = await resp.json();
  const msg = data.messages?.[0] ?? {};
  return {
    collection: data.collection ?? [],
    total: Number(msg.total ?? 0),
    count: Number(msg.count ?? 0),
  };
}

/**
 * Extract meaningful search terms from a PubMed-style query string.
 * Strips boolean operators and short stopwords; lowercases.
 * TODO: upgrade to a proper relevance score
 */
const STOPWORDS = new Set(["and", "or", "not", "with", "from", "this", "that"]);
function extractTerms(query) {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

function matchesQuery(terms, title, abstract) {
  const haystack = `${title} ${abstract ?? ""}`.toLowerCase();
  return terms.some(t => haystack.includes(t));
}

function mapRecord(c) {
  if (!c.doi) return null;
  return {
    externalId: c.doi,
    source: "medrxiv",
    title: c.title ?? "",
    abstract: c.abstract ?? null,
    doi: c.doi,
    publishedAt: c.date ? new Date(c.date) : null,
    journal: "medRxiv",
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

export const medrxiv = {
  id: "medrxiv",
  name: "medRxiv",
  peerReviewed: false,

  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    const terms = extractTerms(query);
    let yielded = 0;

    // Fetch last 365 days in 30-day chunks, oldest to newest
    const totalDays = 365;
    const chunkDays = 30;

    for (let daysAgo = totalDays; daysAgo > 0 && yielded < target; daysAgo -= chunkDays) {
      const chunkEnd = daysAgo;
      const chunkStart = Math.max(0, daysAgo - chunkDays);
      const to = new Date(Date.now() - chunkStart * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - chunkEnd * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      let cursor = 0;
      let total = Infinity;

      while (cursor <= total - 1 && yielded < target) {
        const { collection, total: t, count } = await fetchPage(from, to, cursor);
        total = t;

        for (const c of collection) {
          if (opts?.signal?.aborted) return;
          if (!matchesQuery(terms, c.title ?? "", c.abstract ?? "")) continue;
          const paper = mapRecord(c);
          if (!paper) continue;
          yield paper;
          yielded += 1;
          if (yielded >= target) return;
        }

        if (collection.length === 0 || count === 0) break;
        cursor += PAGE_SIZE;
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

registerIngestion(medrxiv);
registerDiscovery(medrxiv);
