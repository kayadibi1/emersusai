// scripts/fulltext-enrichment/lib/fetch-openalex-oa.js
// S2 OA URL fetcher: OpenAlex API (https://openalex.org)
// Returns a URL to a freely accessible PDF — no text parsing, just the link.
// No API key needed; 10 RPS polite limit with User-Agent header.

import { RateLimiter } from './rate-limiter.js';

const OA_BASE = 'https://api.openalex.org';
const limiter = new RateLimiter({ rps: 10 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  let body;
  try {
    resp = await fetch(
      `${OA_BASE}/works/https://doi.org/${doi}?select=open_access,primary_location`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'EmersusBot/1.0 (mailto:info@emersus.ai)',
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    body = await resp.json();
  } catch { return null; }

  const pdfUrl = body?.primary_location?.pdf_url ?? body?.open_access?.oa_url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_openalex' };
}
