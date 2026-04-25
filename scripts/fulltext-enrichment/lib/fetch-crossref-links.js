// scripts/fulltext-enrichment/lib/fetch-crossref-links.js
// S3 PDF-URL fetcher: CrossRef API (https://crossref.org)
// Returns a PDF URL from the CrossRef link[] array.
// No API key needed; RPS=50 with polite pool courtesy.

import { RateLimiter } from './rate-limiter.js';

const CR_BASE = 'https://api.crossref.org';
const limiter = new RateLimiter({ rps: 50 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  let body;
  try {
    resp = await fetch(
      `${CR_BASE}/works/${encodeURIComponent(doi)}?mailto=info@emersus.ai`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
    );
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    body = await resp.json();
  } catch { return null; }

  const links = body?.message?.link ?? [];

  const pdfLink = links.find((l) =>
    l['content-type'] === 'application/pdf' ||
    (l['content-type'] === 'unspecified' && typeof l.URL === 'string' && l.URL.toLowerCase().endsWith('.pdf'))
  );

  if (!pdfLink?.URL) return null;

  return { text: null, pdfUrl: pdfLink.URL, source: 'phase2f_crossref' };
}
