// scripts/sources/psyarxiv.js
// Ingestion + discovery adapter for PsyArXiv via the OSF API (JSON:API format).
//
// Same backend as sportrxiv.js — the OSF preprints endpoint doesn't support
// keyword search, so we page through PsyArXiv preprints and apply
// client-side keyword filtering on title + description.
//
// PsyArXiv covers psychology, behavior, and social science — relevant to
// our sport psych / motivation / adherence / body image topics that the
// existing biomedical-heavy sources underserve.
//
// Rate-limited to 2 RPS, separate budget from the biorxiv shared limiter.

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion, registerDiscovery } from "./_registry.js";
import { parseQueryIntoGroups, matchesQueryGroups } from "./_query-match.js";

const BASE_URL = "https://api.osf.io/v2/preprints/";
const PAGE_SIZE = 100;
// PsyArXiv has ~30k preprints — most exercise/sport-psych queries hit
// nothing or a small handful. Hard cap at 10 pages to bound wall time
// per topic the same way sportrxiv does.
const MAX_PAGES = 10;

const waitSlot = createLimiter(2);

async function fetchPage(url) {
  await waitSlot();
  const resp = await fetchWithTimeoutAndUA(url, {
    accept: "application/json",
    timeoutMs: 20_000,
  });
  const data = await resp.json();
  return {
    items: data.data ?? [],
    nextUrl: data.links?.next ?? null,
  };
}

function mapItem(item) {
  const attr = item.attributes ?? {};
  const links = item.links ?? {};

  let doi = null;
  if (links.preprint_doi) {
    const match = links.preprint_doi.match(/doi\.org\/(.+)$/);
    doi = match ? match[1] : null;
  }
  if (!doi && attr.doi) doi = attr.doi;

  const publishedAt = attr.date_published ? new Date(attr.date_published) : null;

  return {
    externalId: item.id,
    source: "psyarxiv",
    title: (attr.title ?? "").trim(),
    abstract: attr.description ?? null,
    doi,
    publishedAt,
    journal: "PsyArXiv",
    authors: [], // OSF requires a secondary /contributors/ call per preprint — defer
    peerReviewed: false,
    sourceMetadata: {
      osf_id: item.id,
      tags: attr.tags ?? [],
      reviews_state: attr.reviews_state ?? null,
    },
  };
}

function buildFirstPageUrl() {
  return (
    `${BASE_URL}?filter%5Bprovider%5D=psyarxiv` +
    `&page%5Bsize%5D=${PAGE_SIZE}`
  );
}

export const psyarxiv = {
  id: "psyarxiv",
  name: "PsyArXiv",
  peerReviewed: false,

  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    const groups = parseQueryIntoGroups(query);
    let yielded = 0;
    let url = buildFirstPageUrl();
    let pagesFetched = 0;

    while (url && yielded < target && pagesFetched < MAX_PAGES) {
      const { items, nextUrl } = await fetchPage(url);
      pagesFetched += 1;
      if (items.length === 0) break;

      for (const item of items) {
        if (opts?.signal?.aborted) return;
        const attr = item.attributes ?? {};
        if (!matchesQueryGroups(groups, attr.title ?? "", attr.description ?? "")) continue;
        const paper = mapItem(item);
        if (!paper.title) continue;
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      url = nextUrl;
    }
  },

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

registerIngestion(psyarxiv);
registerDiscovery(psyarxiv);
