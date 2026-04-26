// scripts/fulltext-enrichment/lib/fetch-openalex-oa.js
// S2 OA URL fetcher: OpenAlex API (https://openalex.org)
// Returns a URL to a freely accessible PDF — no text parsing, just the link.
// No API key needed; 10 RPS polite limit with User-Agent header.

import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const OA_BASE = 'https://api.openalex.org';
const limiter = getRateLimiter('openalex', { rps: 10 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${OA_BASE}/works/https://doi.org/${doi}?select=open_access,primary_location`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'EmersusBot/1.0 (mailto:info@emersus.ai)',
        },
        signal: AbortSignal.timeout(10_000),
      },
      { label: `openalex:${doi}`, maxRetries: 3, baseMs: 1000 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }
  if (resp.status === 404) return null;
  if (!resp.ok) return null;

  let body;
  try { body = await resp.json(); } catch { return null; }

  const pdfUrl = body?.primary_location?.pdf_url ?? body?.open_access?.oa_url ?? null;
  if (!pdfUrl) return null;

  // OpenAlex sometimes returns the DOI URL itself as pdf_url — that's a
  // redirect to the publisher landing page, never a real PDF. Reject early
  // so we don't waste a download + Grobid round-trip on a guaranteed miss.
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(pdfUrl)) return null;

  return { text: null, pdfUrl, source: 'phase2f_openalex' };
}
