// scripts/fulltext-enrichment/lib/fetch-unpaywall.js
//
// Unpaywall API — finds legal OA copies: preprints, author manuscripts,
// repository deposits, and publisher OA versions missed by other sources.
// Free for research. Set UNPAYWALL_EMAIL in env (any valid address).
// Soft limit: ~100k req/day. We run at 10 RPS.
import { RateLimiter } from './rate-limiter.js';

const UW_BASE = 'https://api.unpaywall.org/v2';
const limiter = new RateLimiter({ rps: 10 });

export async function fetchForDoi(doi) {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) return null;

  await limiter.take();

  let data;
  try {
    const resp = await fetch(
      `${UW_BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (resp.status === 404 || resp.status === 400) return null;
    if (resp.status === 429) return null;
    if (!resp.ok) return null;
    data = await resp.json();
  } catch { return null; }

  if (!data || !data.is_oa) return null;

  // Walk all OA locations in order — prefer PDF links
  const locations = data.oa_locations ?? [];
  for (const loc of locations) {
    if (loc.url_for_pdf) {
      return { pdfUrl: loc.url_for_pdf, source: 'phase2g_unpaywall' };
    }
  }

  return null;
}
