// scripts/fulltext-enrichment/lib/fetch-pmcid-jats.js
//
// Fetch full-text JATS XML from NCBI eutils using PMC ID stored in source_metadata.
// Fastest route for PMC-deposited articles — no DOI lookup needed.
// Optional: set NCBI_API_KEY for 10 RPS (free at ncbi.nlm.nih.gov/account/).
import { RateLimiter } from './rate-limiter.js';
import { parseJatsFullText } from './jats-parser.js';

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const limiter = new RateLimiter({ rps: process.env.NCBI_API_KEY ? 10 : 3 });

export async function fetchForPmcid(doi, row) {
  const rawPmcid = row?.pmcid;
  if (!rawPmcid) return null;

  const numericId = String(rawPmcid).replace(/^PMC/i, '').trim();
  if (!numericId || !/^\d+$/.test(numericId)) return null;

  await limiter.take();

  let resp;
  let xml;
  try {
    const params = new URLSearchParams({
      db: 'pmc', id: numericId, rettype: 'xml', retmode: 'xml',
    });
    if (process.env.NCBI_API_KEY) params.set('api_key', process.env.NCBI_API_KEY);

    resp = await fetch(`${NCBI_BASE}/efetch.fcgi?${params}`, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20_000),
    });
    if (resp.status === 404 || resp.status === 400) return null;
    if (!resp.ok) return null;
    xml = await resp.text();
  } catch { return null; }

  if (!xml || xml.length < 200) return null;
  if (xml.includes('<ERROR>') || xml.includes('No documents found')) return null;

  const parsed = parseJatsFullText(xml);
  if (!parsed || parsed.text.length < 500) return null;

  return { text: parsed.text, sections: parsed.sections, pdfUrl: null, source: 'phase2f_pmcid' };
}
