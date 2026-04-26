// scripts/fulltext-enrichment/lib/fetch-europepmc.js
//
// Europe PMC full-text XML — covers Wellcome/EU/UKRI-funded articles that
// are in EuropePMC but not necessarily in NCBI PMC. Two-step: search by DOI
// to get source+id, then fetch full-text XML.
// No API key needed. Polite limit: 5 RPS.
import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';
import { parseJatsFullText } from './jats-parser.js';

const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const limiter = getRateLimiter('europepmc', { rps: 5 });

export async function fetchForDoi(doi) {
  await limiter.take();

  // Step 1: search by DOI to find article metadata
  let result;
  try {
    const params = new URLSearchParams({
      query: `DOI:"${doi}"`,
      resultType: 'core',
      format: 'json',
      pageSize: '1',
    });
    const resp = await fetchWithRetry(`${EPMC_BASE}/search?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    }, { label: `epmc-search:${doi}`, maxRetries: 3, baseMs: 1500 });
    if (!resp.ok) return null;
    const data = await resp.json();
    result = data?.resultList?.result?.[0];
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (!result) return null;
  if (result.hasFullText !== 'Y') return null;

  const source = result.source; // MED, PMC, PPR (preprint), etc.
  const id = result.id;
  if (!source || !id) return null;

  // Step 2: fetch full-text XML
  await limiter.take();
  let xml;
  try {
    const resp = await fetchWithRetry(`${EPMC_BASE}/${source}/${id}/fullTextXML`, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20_000),
    }, { label: `epmc-xml:${source}/${id}`, maxRetries: 3, baseMs: 1500 });
    if (resp.status === 404 || resp.status === 400) return null;
    if (!resp.ok) return null;
    xml = await resp.text();
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (!xml || xml.length < 200) return null;

  const parsed = parseJatsFullText(xml);
  if (!parsed || parsed.text.length < 500) return null;

  return { text: parsed.text, sections: parsed.sections, pdfUrl: null, source: 'phase2g_europepmc' };
}
