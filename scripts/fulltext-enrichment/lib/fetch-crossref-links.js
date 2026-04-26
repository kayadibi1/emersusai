// scripts/fulltext-enrichment/lib/fetch-crossref-links.js
// S3 PDF-URL fetcher: CrossRef API (https://crossref.org)
// Returns a PDF URL from the CrossRef link[] array.
// No API key needed; RPS=50 with polite pool courtesy.

import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const CR_BASE = 'https://api.crossref.org';
const limiter = getRateLimiter('crossref', { rps: 50 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${CR_BASE}/works/${encodeURIComponent(doi)}?mailto=info@emersus.ai`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
      { label: `crossref:${doi}`, maxRetries: 3, baseMs: 1000 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }
  if (resp.status === 404) return null;
  if (!resp.ok) return null;

  let body;
  try { body = await resp.json(); } catch { return null; }

  const links = body?.message?.link ?? [];

  const pdfLink = links.find((l) =>
    l['content-type'] === 'application/pdf' ||
    (l['content-type'] === 'unspecified' && typeof l.URL === 'string' && l.URL.toLowerCase().endsWith('.pdf'))
  );

  if (!pdfLink?.URL) return null;

  return { text: null, pdfUrl: pdfLink.URL, source: 'phase2f_crossref' };
}
