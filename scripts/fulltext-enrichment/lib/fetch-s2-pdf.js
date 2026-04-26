// scripts/fulltext-enrichment/lib/fetch-s2-pdf.js
// S1 PDF-URL fetcher: Semantic Scholar API (https://semanticscholar.org)
// Returns a URL to a freely accessible PDF — no text parsing, just the link.
// API key optional: S2_API_KEY env var. With key, RPS=10; without, RPS=1.
// Cluster-shared bucket via Redis so multi-shard runs don't compound rate.
import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const limiter = getRateLimiter('s2', { rps: process.env.S2_API_KEY ? 10 : 1 });

export async function fetchForDoi(doi) {
  await limiter.take();

  const headers = { Accept: 'application/json' };
  if (process.env.S2_API_KEY) headers['x-api-key'] = process.env.S2_API_KEY;

  let resp;
  try {
    resp = await fetchWithRetry(
      `${S2_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf`,
      { headers, signal: AbortSignal.timeout(10_000) },
      { label: `s2:${doi}`, maxRetries: 3, baseMs: 1500 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (resp.status === 404 || resp.status === 400) return null;
  if (!resp.ok) return null;

  let body;
  try { body = await resp.json(); } catch { return null; }

  const pdfUrl = body?.openAccessPdf?.url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_s2' };
}
