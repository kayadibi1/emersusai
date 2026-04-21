// scripts/sources/elife.js
// Ingestion adapter for eLife (https://elifesciences.org).
//
// eLife is a high-quality OA biomedical publisher with full open peer
// review. Their API at api.elifesciences.org returns clean JSON
// including the abstract content. Most eLife articles end up in
// PubMed/PMC once published, so direct ingestion mainly buys us:
//   - earlier capture (preprint-stage `preprint` type before PubMed
//     indexing)
//   - the eLife review/revision metadata in source_metadata
//
// API requires a versioned Accept header: `application/vnd.elife.search+json; version=2`.
// No API key, no documented rate limit (we use 5 RPS to be polite).

import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { registerIngestion } from "./_registry.js";

const SEARCH_URL = "https://api.elifesciences.org/search";
const PER_PAGE = 100;
const MAX_PAGES = 10; // hard cap — protects against runaway pagination

const waitSlot = createLimiter(5);

/**
 * eLife abstracts are structured as an array of typed content blocks.
 * Most are `{ type: "paragraph", text: "..." }`; some include
 * `{ type: "section" }` wrappers with nested content. Flatten to
 * plain text and strip the inline HTML tags eLife uses for italics
 * (e.g., `<i>C. elegans</i>`) so they don't end up in chunks.
 */
function flattenAbstract(abstract) {
  if (!abstract || !Array.isArray(abstract.content)) return null;
  const texts = [];
  const visit = (node) => {
    if (!node) return;
    if (typeof node.text === "string") texts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  abstract.content.forEach(visit);
  const joined = texts.join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return joined || null;
}

function stripHtml(s) {
  return typeof s === "string" ? s.replace(/<[^>]+>/g, "").trim() : null;
}

function parseAuthors(authorLine) {
  if (typeof authorLine !== "string" || !authorLine) return [];
  // eLife uses "FirstAuthor, SecondAuthor ... LastAuthor" — keep what
  // we can parse, drop the ellipsis. Full author lists need a per-paper
  // /article/{id} call which we skip for ingestion economy.
  return authorLine
    .split(/,\s*|\s*\.\.\.\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function buildSearchUrl(query, page) {
  const params = new URLSearchParams({
    for: query,
    "per-page": String(PER_PAGE),
    page: String(page),
  });
  // type[] needs explicit array bracket syntax; URLSearchParams handles it
  params.append("type[]", "research-article");
  params.append("type[]", "short-report");
  params.append("type[]", "tools-resources");
  params.append("type[]", "research-advance");
  return `${SEARCH_URL}?${params.toString()}`;
}

async function searchPage(query, page) {
  await waitSlot();
  const resp = await fetchWithTimeoutAndUA(buildSearchUrl(query, page), {
    accept: "application/vnd.elife.search+json; version=2",
    timeoutMs: 20_000,
  });
  return resp.json();
}

function normalize(item) {
  const title = stripHtml(item.title);
  if (!title) return null;
  const id = item.id;
  if (!id) return null;
  const publishedAt = item.published ? new Date(item.published) : null;
  const subjects = (item.subjects ?? []).map((s) => s?.name).filter(Boolean);
  return {
    externalId: id,
    source: "elife",
    title,
    abstract: flattenAbstract(item.abstract),
    doi: item.doi ?? null,
    publishedAt,
    journal: "eLife",
    authors: parseAuthors(item.authorLine),
    peerReviewed: item.stage === "published",
    sourceMetadata: {
      elife_id: id,
      type: item.type,
      stage: item.stage,
      version: item.version,
      volume: item.volume ?? null,
      subjects,
      research_organisms: item.researchOrganisms ?? null,
      impact_statement: stripHtml(item.impactStatement),
    },
  };
}

export const elife = {
  id: "elife",
  name: "eLife",
  peerReviewed: true,

  async *fetchPapers(query, opts = {}) {
    const target = opts?.target ?? 2000;
    let page = 1;
    let yielded = 0;

    while (yielded < target && page <= MAX_PAGES) {
      const body = await searchPage(query, page);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) return;

      for (const it of items) {
        if (opts?.signal?.aborted) return;
        const paper = normalize(it);
        if (!paper) continue;
        yield paper;
        yielded += 1;
        if (yielded >= target) return;
      }

      // eLife returns `total` once; if we've passed it we can stop early
      const total = Number(body?.total ?? 0);
      if (total > 0 && page * PER_PAGE >= total) return;
      page += 1;
    }
  },
};

registerIngestion(elife);
