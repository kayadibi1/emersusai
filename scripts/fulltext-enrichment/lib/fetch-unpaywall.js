// scripts/fulltext-enrichment/lib/fetch-unpaywall.js
//
// Unpaywall API — finds legal OA copies: preprints, author manuscripts,
// repository deposits, and publisher OA versions missed by other sources.
// Free for research. Set UNPAYWALL_EMAIL in env (any valid address).
// Soft limit: ~100k req/day at 10 RPS. Cluster-shared bucket via Redis.
//
// Throttle handling: 429/5xx are retried with exponential backoff. Throws on
// max retries so the caller can avoid marking the row exhausted.
import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const UW_BASE = 'https://api.unpaywall.org/v2';
const limiter = getRateLimiter('unpaywall', { rps: 10 });

export async function fetchForDoi(doi) {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) return null;

  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${UW_BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      },
      { label: `unpaywall:${doi}`, maxRetries: 3, baseMs: 1500 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (resp.status === 404 || resp.status === 400) return null;
  if (!resp.ok) return null;

  let data;
  try { data = await resp.json(); } catch { return null; }

  if (!data || !data.is_oa) return null;

  // Walk OA locations in order — prefer PDF links
  const locations = data.oa_locations ?? [];
  for (const loc of locations) {
    if (loc.url_for_pdf) {
      return { pdfUrl: loc.url_for_pdf, source: 'phase2g_unpaywall' };
    }
  }

  return null;
}
