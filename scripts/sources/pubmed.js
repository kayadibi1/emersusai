// scripts/sources/pubmed.js
// Ingestion adapter for PubMed eutils. Two-phase: esearch → efetch.
//
// Rate limits:
//   - Unauthenticated: 3 RPS (NCBI's stated limit).
//   - With api_key: 10 RPS (we use 9 for safety margin).
// NCBI policy also requires tool + email params when a key is sent.
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const BATCH_SIZE = 100;
const NCBI_TOOL = "emersus";
const NCBI_EMAIL = "info@emersus.ai";

// Read the key at module load to size the limiter. The URL builders re-read
// it on every call (lazy) so tests can flip the env var per-test.
const HAS_API_KEY_AT_LOAD = Boolean(process.env.NCBI_API_KEY);
const waitSlot = createLimiter(HAS_API_KEY_AT_LOAD ? 9 : 3);

/**
 * Append api_key, tool, email to a URL when NCBI_API_KEY is set in env.
 * Read env lazily so tests can set it per-call.
 */
function appendAuth(url) {
  const apiKey = process.env.NCBI_API_KEY;
  if (!apiKey) return url;
  const params = `&api_key=${encodeURIComponent(apiKey)}&tool=${encodeURIComponent(NCBI_TOOL)}&email=${encodeURIComponent(NCBI_EMAIL)}`;
  return url + params;
}

async function esearchPmids(query, retmax, retstart) {
  await waitSlot();
  const url = appendAuth(
    `${ESEARCH_URL}?db=pubmed&retmax=${retmax}&retstart=${retstart}&term=${encodeURIComponent(query)}`
  );
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/xml" });
  const xml = await resp.text();
  const idList = [...xml.matchAll(/<Id>(\d+)<\/Id>/g)].map(m => m[1]);
  const countMatch = xml.match(/<Count>(\d+)<\/Count>/);
  const total = countMatch ? Number(countMatch[1]) : 0;
  return { idList, total };
}

async function efetchBatch(pmids) {
  if (pmids.length === 0) return [];
  await waitSlot();
  const url = appendAuth(
    `${EFETCH_URL}?db=pubmed&id=${pmids.join(",")}&retmode=xml`
  );
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/xml" });
  const xml = await resp.text();
  return parsePubmedXml(xml);
}

/**
 * Minimal PubMed XML parser — extracts the fields we care about without
 * pulling in a full XML library. Works on a per-<PubmedArticle> split.
 */
export function parsePubmedXml(xml) {
  const articles = xml.split(/<PubmedArticle[\s>]/).slice(1).map(s => "<PubmedArticle " + s);
  const out = [];
  for (const a of articles) {
    const pmid = a.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;

    const title = decodeEntities(stripTags(
      a.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? ""
    )).trim();

    const abstract = decodeEntities(stripTags(
      [...a.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m => m[1]).join("\n")
    )).trim() || null;

    const doi = a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1] ?? null;

    const year = a.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<\/PubDate>/)?.[1];
    const month = a.match(/<PubDate>[\s\S]*?<Month>(\w+)<\/Month>/)?.[1];
    const publishedAt = year ? new Date(`${year}-${monthNum(month ?? "Jan")}-01`) : null;

    const journal = a.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? null;

    const authors = [...a.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)]
      .map(m => {
        const last  = m[1].match(/<LastName>([^<]+)<\/LastName>/)?.[1];
        const fore  = m[1].match(/<ForeName>([^<]+)<\/ForeName>/)?.[1];
        return last && fore ? `${fore} ${last}` : (last || fore || null);
      })
      .filter(Boolean);

    out.push({
      externalId: pmid,
      source: "pubmed",
      title,
      abstract,
      doi,
      publishedAt,
      journal,
      authors,
      peerReviewed: true,
      sourceMetadata: { pmid },
    });
  }
  return out;
}

function stripTags(s) { return (s ?? "").replace(/<[^>]+>/g, ""); }
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function monthNum(m) {
  // Handle numeric months (e.g. "03") as well as named abbreviations
  const n = Number(m);
  if (!isNaN(n) && n >= 1 && n <= 12) return String(n).padStart(2, "0");
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  return months[m.slice(0, 3).toLowerCase()] ?? "01";
}

export const pubmed = {
  id: "pubmed",
  name: "PubMed",
  peerReviewed: true,
  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    let retstart = 0;
    let yielded = 0;
    while (yielded < target) {
      const { idList, total } = await esearchPmids(query, BATCH_SIZE, retstart);
      if (idList.length === 0) return;
      if (retstart === 0 && total === 0) {
        throw new SourcePermanentError(`pubmed esearch returned 0 results for query: ${query}`);
      }
      const papers = await efetchBatch(idList);
      for (const p of papers) {
        yield p;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      retstart += idList.length;
      if (retstart >= total) return;
    }
  },
};

registerIngestion(pubmed);
