// scripts/fulltext-enrichment/lib/fetch-wiley-tdm.js
//
// Wiley TDM API — returns PDF binary directly.
// Get token at: https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining
// Set WILEY_TDM_TOKEN in env.
// Note: access is IP+token gated. Token must be from an account with subscription access.
import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';

const WILEY_BASE = 'https://api.wiley.com/onlinelibrary/tdm/v1/articles';
const limiter = getRateLimiter('wiley', { rps: 3 });

export async function fetchForDoi(doi) {
  if (!process.env.WILEY_TDM_TOKEN) return null;
  // Wiley DOIs start with 10.1111, 10.1002, 10.1113 etc — skip non-Wiley DOIs fast
  if (!doi.startsWith('10.1111') && !doi.startsWith('10.1002') &&
      !doi.startsWith('10.1113') && !doi.startsWith('10.1196') &&
      !doi.startsWith('10.1046') && !doi.startsWith('10.1359')) return null;

  await limiter.take();

  let resp;
  try {
    resp = await fetchWithRetry(
      `${WILEY_BASE}/${encodeURIComponent(doi)}`,
      {
        headers: {
          'Wiley-TDM-Client-Token': process.env.WILEY_TDM_TOKEN,
          'Accept': 'application/pdf',
        },
        signal: AbortSignal.timeout(30_000),
      },
      { label: `wiley:${doi}`, maxRetries: 3, baseMs: 1500 }
    );
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }
  if (resp.status === 404 || resp.status === 400) return null;
  if (resp.status === 401 || resp.status === 403) return null;
  if (!resp.ok) return null;

  const contentType = resp.headers.get('content-type') ?? '';
  if (!contentType.includes('pdf')) return null;

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length < 1000) return null;

  return { pdfBuffer: buffer, pdfUrl: null, source: 'phase2f_wiley_tdm' };
}
