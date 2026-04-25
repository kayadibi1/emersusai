// scripts/fulltext-enrichment/lib/fetch-springer-oa.js
//
// Springer Nature Open Access API — returns JATS XML full text directly.
// Free tier: 5000 req/day. Register at dev.springernature.com for API key.
// Set SPRINGER_API_KEY in env.
import { RateLimiter } from './rate-limiter.js';
import { parseJatsFullText } from './jats-parser.js';

const SN_BASE = 'https://api.springernature.com/openaccess/jats';
const limiter = new RateLimiter({ rps: 5 });

export async function fetchForDoi(doi) {
  if (!process.env.SPRINGER_API_KEY) return null;
  await limiter.take();

  let resp;
  let xml;
  try {
    resp = await fetch(
      `${SN_BASE}?api_key=${encodeURIComponent(process.env.SPRINGER_API_KEY)}&q=doi:${encodeURIComponent(doi)}`,
      {
        headers: { Accept: 'application/jats+xml, application/xml, */*' },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (resp.status === 404 || resp.status === 400) return null;
    if (!resp.ok) return null;
    xml = await resp.text();
  } catch { return null; }

  if (!xml || xml.length < 200) return null;

  const parsed = parseJatsFullText(xml);
  if (!parsed || parsed.text.length < 500) return null;

  return { text: parsed.text, sections: parsed.sections, pdfUrl: null, source: 'phase2f_springer' };
}
