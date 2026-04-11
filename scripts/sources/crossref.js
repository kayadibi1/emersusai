// scripts/sources/crossref.js
// Ingestion adapter for the CrossRef REST API.
// Docs: https://api.crossref.org/swagger-ui/index.html
// Rate-limited to 10 RPS via the "polite pool" (requires Mailto header).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion } from "./_registry.js";

const BASE_URL = "https://api.crossref.org/works";
const PAGE_SIZE = 100;
const MAILTO = "noreply@emersus.ai";

const waitSlot = createLimiter(10); // 10 RPS (polite pool)

/** Helpers shared with pubmed.js — inline here to avoid cross-source import. */
function stripTags(s) { return (s ?? "").replace(/<[^>]+>/g, ""); }
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Fetch one page of CrossRef works.
 * @param {string} query
 * @param {number} offset
 */
async function fetchPage(query, offset) {
  await waitSlot();
  const url =
    `${BASE_URL}?query=${encodeURIComponent(query)}` +
    `&rows=${PAGE_SIZE}&offset=${offset}`;
  const resp = await fetchWithTimeoutAndUA(url, {
    accept: "application/json",
    headers: { Mailto: MAILTO },
  });
  const data = await resp.json();
  return {
    items: data.message?.items ?? [],
    totalResults: data.message?.["total-results"] ?? 0,
  };
}

function mapItem(item) {
  const title = item.title?.[0];
  if (!title) return null;

  const rawAbstract = item.abstract ?? null;
  // CrossRef abstracts may be JATS XML — strip tags and decode entities.
  const abstract = rawAbstract
    ? decodeEntities(stripTags(rawAbstract)).trim() || null
    : null;
  // Skip records with no meaningful abstract
  if (!abstract) return null;

  // Parse published date from date-parts array [year, month?, day?]
  const dateParts = item.issued?.["date-parts"]?.[0] ?? [];
  const [year, month, day] = dateParts;
  const publishedAt = year
    ? new Date(`${year}-${String(month ?? 1).padStart(2, "0")}-${String(day ?? 1).padStart(2, "0")}`)
    : null;

  return {
    externalId: item.DOI,
    source: "crossref",
    title,
    abstract,
    doi: item.DOI,
    publishedAt,
    journal: item["container-title"]?.[0] ?? null,
    authors: item.author
      ? item.author
          .map(a => `${a.given ?? ""} ${a.family ?? ""}`.trim())
          .filter(Boolean)
      : [],
    peerReviewed: true,
    sourceMetadata: {
      publisher: item.publisher ?? null,
      type: item.type ?? null,
    },
  };
}

export const crossref = {
  id: "crossref",
  name: "CrossRef",
  peerReviewed: true,

  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    let yielded = 0;
    let offset = 0;
    let totalResults = Infinity;

    while (yielded < target && offset < totalResults) {
      const { items, totalResults: total } = await fetchPage(query, offset);
      totalResults = total;
      if (items.length === 0) return;

      for (const item of items) {
        if (opts?.signal?.aborted) return;
        const paper = mapItem(item);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      offset += PAGE_SIZE;
    }
  },
};

registerIngestion(crossref);
