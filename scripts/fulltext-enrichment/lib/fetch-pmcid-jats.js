// scripts/fulltext-enrichment/lib/fetch-pmcid-jats.js
//
// Fetch full-text JATS XML from NCBI eutils using PMC ID stored in source_metadata.
// Fastest route for PMC-deposited articles — no DOI lookup needed.
// Optional: set NCBI_API_KEY for 10 RPS (free at ncbi.nlm.nih.gov/account/).
//
// Two entry points:
//   fetchForPmcid(doi, row)       — single article (fallback / non-PMCID passes)
//   fetchBatchForPmcids(rows)     — up to 20 articles per HTTP call (pass 0 main path)
import { getRateLimiter } from './rate-limiter-redis.js';
import { fetchWithRetry } from './fetch-retry.js';
import { parseJatsFullText } from './jats-parser.js';

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const limiter = getRateLimiter('ncbi', { rps: process.env.NCBI_API_KEY ? 10 : 3 });

function toNumericPmcid(raw) {
  const s = String(raw).replace(/^PMC/i, '').trim();
  return /^\d+$/.test(s) ? s : null;
}

// Split <pmc-articleset> XML into individual <article>…</article> strings.
function splitArticleSet(xml) {
  const articles = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf('<article ', pos);
    if (start === -1) break;
    const end = xml.indexOf('</article>', start);
    if (end === -1) break;
    articles.push(xml.slice(start, end + '</article>'.length));
    pos = end + '</article>'.length;
  }
  return articles;
}

// Extract the numeric PMC ID from a single <article> XML string.
// NCBI batch responses use pub-id-type="pmcid" with value "PMC3456779",
// or pub-id-type="pmcaid" with bare numeric "3456779".
function extractPmcId(articleXml) {
  const bare = articleXml.match(/<article-id[^>]*pub-id-type="pmcaid"[^>]*>(\d+)<\/article-id>/);
  if (bare) return bare[1];
  const prefixed = articleXml.match(/<article-id[^>]*pub-id-type="pmcid"[^>]*>PMC(\d+)<\/article-id>/);
  return prefixed ? prefixed[1] : null;
}

// Single-article fetch — kept for non-PMCID passes and fallback.
export async function fetchForPmcid(doi, row) {
  const numericId = toNumericPmcid(row?.pmcid);
  if (!numericId) return null;

  await limiter.take();

  let xml;
  try {
    const params = new URLSearchParams({
      db: 'pmc', id: numericId, rettype: 'xml', retmode: 'xml',
    });
    if (process.env.NCBI_API_KEY) params.set('api_key', process.env.NCBI_API_KEY);

    const resp = await fetchWithRetry(`${NCBI_BASE}/efetch.fcgi?${params}`, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20_000),
    }, { label: `ncbi-pmc:${numericId}`, maxRetries: 3, baseMs: 1500 });
    if (resp.status === 404 || resp.status === 400) return null;
    if (!resp.ok) return null;
    xml = await resp.text();
  } catch (err) {
    if (err.transient) throw err;
    return null;
  }

  if (!xml || xml.length < 200) return null;
  if (xml.includes('<ERROR>') || xml.includes('No documents found')) return null;

  const parsed = parseJatsFullText(xml);
  if (!parsed || parsed.text.length < 500) return null;

  return { text: parsed.text, sections: parsed.sections, pdfUrl: null, source: 'phase2f_pmcid' };
}

// Batch fetch — one HTTP request for up to BATCH_SIZE rows.
// Returns Map<pmid (BigInt), {text, sections, source}> for articles found.
// Rows absent from the map had no full text in PMC.
export async function fetchBatchForPmcids(rows) {
  // Build numericPmcid → pmid mapping, skip invalid
  const idMap = new Map(); // numericPmcid (string) → pmid (BigInt)
  for (const row of rows) {
    const numericId = toNumericPmcid(row.pmcid);
    if (numericId) idMap.set(numericId, row.pmid);
  }
  if (!idMap.size) return new Map();

  await limiter.take(); // one token per batch request

  let xml;
  try {
    const params = new URLSearchParams({
      db: 'pmc',
      id: [...idMap.keys()].join(','),
      rettype: 'xml',
      retmode: 'xml',
    });
    if (process.env.NCBI_API_KEY) params.set('api_key', process.env.NCBI_API_KEY);

    const resp = await fetchWithRetry(`${NCBI_BASE}/efetch.fcgi?${params}`, {
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(60_000),
    }, { label: `ncbi-pmc-batch:${idMap.size}`, maxRetries: 3, baseMs: 2000 });
    if (!resp.ok) return new Map();
    xml = await resp.text();
  } catch (err) {
    if (err.transient) throw err;
    return new Map();
  }

  if (!xml || xml.length < 200) return new Map();

  const results = new Map(); // pmid → result

  for (const articleXml of splitArticleSet(xml)) {
    const pmcId = extractPmcId(articleXml);
    if (!pmcId) continue;

    const pmid = idMap.get(pmcId);
    if (pmid === undefined) continue;

    const parsed = parseJatsFullText(articleXml);
    if (!parsed || parsed.text.length < 500) continue;

    results.set(pmid, { text: parsed.text, sections: parsed.sections, source: 'phase2f_pmcid' });
  }

  return results;
}
