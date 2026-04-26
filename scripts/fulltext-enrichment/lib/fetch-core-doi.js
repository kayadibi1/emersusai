// scripts/fulltext-enrichment/lib/fetch-core-doi.js
// S0 full-text fetcher: CORE API (https://core.ac.uk)
// Returns pre-parsed full text directly — no PDF download, no Grobid needed.
// API key required: CORE_API_KEY env var.
//
// Rate limit: CORE caps at 10 RPS account-wide. Multi-shard runs share a
// Redis-backed bucket via getRateLimiter('core', ...) so the cluster total
// stays under the cap.
//
// Throttle handling: 429/5xx are retried with exponential backoff (Retry-After
// honored). After max retries, throws Error with .transient=true so the caller
// can avoid marking the row phase2f_exhausted (would burn the signal).

import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const CORE_BASE = 'https://api.core.ac.uk/v3';
const limiter = getRateLimiter('core', { rps: 10 });

export async function fetchForDoi(doi) {
  if (!process.env.CORE_API_KEY) return null;
  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${CORE_BASE}/search/works?q=${encodeURIComponent(`doi:"${doi}"`)}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CORE_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      },
      { label: `core:${doi}`, maxRetries: 3, baseMs: 2000 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (resp.status === 404 || resp.status === 400 || resp.status === 401) return null;
  if (!resp.ok) return null;

  let body;
  try { body = await resp.json(); } catch { return null; }

  const result = body?.results?.[0];
  if (!result) return null;

  const text = result.fullText;
  if (!text || text.length < 500) return null;

  return { text, pdfUrl: null, source: 'phase2f_core' };
}
