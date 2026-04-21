// scripts/sources/sportrxiv.js
// Ingestion + discovery adapter for SportRxiv via the OSF API (JSON:API format).
//
// NOTE: The OSF preprints endpoint does not support free-text search well.
// For fetchPapers(), we page through SportRxiv preprints and apply client-side
// keyword filtering on title + description.
//
// NOTE: Author information requires a secondary per-preprint request to OSF's
// /contributors/ relationship endpoint. For v1, authors are left empty to avoid
// exploding the rate limit. TODO: batch-fetch contributors in a later milestone.
//
// Rate-limited to 2 RPS.
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion, registerDiscovery } from "./_registry.js";
import { parseQueryIntoGroups, matchesQueryGroups } from "./_query-match.js";
import { SourceTransientError } from "./_errors.js";

const BASE_URL = "https://api.osf.io/v2/preprints/";
const PAGE_SIZE = 100;

// SportRxiv's total corpus is small (~400 preprints) so natural
// pagination usually terminates quickly, but we still want a hard cap
// so a future expansion of the corpus or an OSF pagination hiccup
// can't spin the handler indefinitely.
const MAX_PAGES = 10;

const waitSlot = createLimiter(2); // 2 RPS

/**
 * Fetch one page of SportRxiv preprints.
 * @param {string} url full URL (used for pagination via links.next)
 */
async function fetchPage(url) {
  await waitSlot();
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/json" });
  const data = await resp.json();
  return {
    items: data.data ?? [],
    nextUrl: data.links?.next ?? null,
  };
}

function mapItem(item) {
  const attr = item.attributes ?? {};
  const links = item.links ?? {};

  // Parse DOI from preprint_doi link (e.g. "https://doi.org/10.31236/osf.io/9x6ha")
  let doi = null;
  if (links.preprint_doi) {
    const match = links.preprint_doi.match(/doi\.org\/(.+)$/);
    doi = match ? match[1] : null;
  }

  const publishedAt = attr.date_published ? new Date(attr.date_published) : null;

  return {
    externalId: item.id,
    source: "sportrxiv",
    title: attr.title ?? "",
    abstract: attr.description ?? null,
    doi,
    publishedAt,
    journal: "SportRxiv",
    authors: [], // TODO: batch-fetch from /contributors/ relationship
    peerReviewed: false,
    sourceMetadata: { osfId: item.id },
  };
}

function buildFirstPageUrl() {
  return (
    `${BASE_URL}?filter%5Bprovider%5D=sportrxiv` +
    `&page%5Bsize%5D=${PAGE_SIZE}`
  );
}

export const sportrxiv = {
  id: "sportrxiv",
  name: "SportRxiv",
  peerReviewed: false,

  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    const groups = parseQueryIntoGroups(query);
    let yielded = 0;
    let url = buildFirstPageUrl();
    let pagesFetched = 0;

    while (url && yielded < target && pagesFetched < MAX_PAGES) {
      let pageData;
      try {
        pageData = await fetchPage(url);
      } catch (err) {
        // OSF API throws 502s + timeouts on individual pages. Bail out
        // cleanly so the handler returns whatever inserted so far instead
        // of throwing and burning retries.
        if (err instanceof SourceTransientError) return;
        throw err;
      }
      const { items, nextUrl } = pageData;
      pagesFetched += 1;
      if (items.length === 0) break;

      for (const item of items) {
        if (opts?.signal?.aborted) return;
        const attr = item.attributes ?? {};
        if (!matchesQueryGroups(groups, attr.title ?? "", attr.description ?? "")) continue;
        const paper = mapItem(item);
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      url = nextUrl;
    }
  },

  // Discovery role: fetch new preprints since last_item_at
  async fetchNew(feedRow) {
    const watermark = feedRow.last_item_at ? new Date(feedRow.last_item_at) : null;
    const pageUrl = feedRow.url ?? buildFirstPageUrl();
    const { items } = await fetchPage(pageUrl);
    const results = [];

    for (const item of items) {
      const attr = item.attributes ?? {};
      const publishedAt = attr.date_published ? new Date(attr.date_published) : null;
      if (watermark && publishedAt && publishedAt <= watermark) continue;

      const links = item.links ?? {};
      let doi = null;
      if (links.preprint_doi) {
        const m = links.preprint_doi.match(/doi\.org\/(.+)$/);
        doi = m ? m[1] : null;
      }
      const url = doi
        ? `https://doi.org/${doi}`
        : (links.html ?? links.self ?? "");

      results.push({
        url,
        title: attr.title ?? "",
        abstract: attr.description ?? null,
        publishedAt,
        feedId: feedRow.id,
      });
    }

    return results;
  },
};

registerIngestion(sportrxiv);
registerDiscovery(sportrxiv);
