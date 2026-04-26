// scripts/fulltext-enrichment/lib/fetch-ia-scholar.js
// S4 PDF-URL fetcher: Internet Archive Scholar (https://scholar.archive.org)
// Returns a URL to a freely accessible PDF from IA's OA collection.
// API key not required. Rate limit: 3 RPS (polite).

import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const IA_BASE = 'https://scholar.archive.org';
const limiter = getRateLimiter('ia', { rps: 3 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${IA_BASE}/api/search?q=doi:${encodeURIComponent(doi)}&limit=1`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
      { label: `ia:${doi}`, maxRetries: 3, baseMs: 1000 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }
  if (!resp.ok) return null;

  let body;
  try { body = await resp.json(); } catch { return null; }

  const hit = body?.hits?.hits?.[0]?._source;
  if (!hit) return null;

  const pdfUrl = hit.pdf_url ?? hit.ia_pdf_url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_ia' };
}
