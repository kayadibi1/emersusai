// scripts/fulltext-enrichment/lib/fetch-core-doi.js
// S0 full-text fetcher: CORE API (https://core.ac.uk)
// Returns pre-parsed full text directly — no PDF download, no Grobid needed.
// API key required: CORE_API_KEY env var.

import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const CORE_BASE = 'https://api.core.ac.uk/v3';
const limiter = new RateLimiter({ rps: 10 });

export async function fetchForDoi(doi) {
  if (!process.env.CORE_API_KEY) return null;
  await limiter.take();

  let resp;
  try {
    resp = await fetch(
      `${CORE_BASE}/search/works?q=doi:"${encodeURIComponent(doi)}"&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CORE_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch { return null; }

  if (!resp.ok) return null;

  const body = await resp.json();
  const result = body?.results?.[0];
  if (!result) return null;

  const text = result.fullText;
  if (!text || text.length < 500) return null;

  return { text, pdfUrl: null, source: 'phase2f_core' };
}
