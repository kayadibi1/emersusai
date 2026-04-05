import fs from "node:fs/promises";
import path from "node:path";

const BASE_EUTILS_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_REQUESTS_PER_SECOND = 8;
const DEFAULT_ANON_REQUESTS_PER_SECOND = 3;
const DEFAULT_LINK_BATCH_SIZE = 100;
const DEFAULT_OUTPUT = "data\\pmc-fulltext.jsonl";
const DEFAULT_RAW_DIR = "data\\pmc-raw";

function parseArgs(argv) {
  const args = {
    query: "",
    output: DEFAULT_OUTPUT,
    rawDir: DEFAULT_RAW_DIR,
    maxResults: DEFAULT_MAX_RESULTS,
    requestsPerSecond: DEFAULT_REQUESTS_PER_SECOND,
    apiKey: process.env.NCBI_API_KEY || "",
    tool: process.env.NCBI_TOOL || "emersus_ai",
    email: process.env.NCBI_EMAIL || "",
    dryRun: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const [key, ...rest] = rawArg.split("=");
    const value = rest.join("=");

    if (key === "--query") {
      args.query = value;
    } else if (key === "--output") {
      args.output = value;
    } else if (key === "--raw-dir") {
      args.rawDir = value;
    } else if (key === "--max-results") {
      args.maxResults = Number(value || DEFAULT_MAX_RESULTS);
    } else if (key === "--requests-per-second") {
      args.requestsPerSecond = Number(value || DEFAULT_REQUESTS_PER_SECOND);
    } else if (key === "--api-key") {
      args.apiKey = value;
    } else if (key === "--tool") {
      args.tool = value;
    } else if (key === "--email") {
      args.email = value;
    }
  }

  args.requestsPerSecond = Math.min(
    Math.max(Math.floor(args.requestsPerSecond || DEFAULT_REQUESTS_PER_SECOND), 1),
    9
  );

  return args;
}

function normalizeText(value, maxLength = 120000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2013;/gi, "-")
    .replace(/&#x2014;/gi, "-");
}

function stripXmlTags(xml) {
  return decodeXmlEntities(
    String(xml || "")
      .replace(/<sup[^>]*>.*?<\/sup>/gis, " ")
      .replace(/<sub[^>]*>.*?<\/sub>/gis, " ")
      .replace(/<xref[^>]*>.*?<\/xref>/gis, " ")
      .replace(/<label[^>]*>.*?<\/label>/gis, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractAll(xml, regex) {
  return [...String(xml || "").matchAll(regex)].map((match) => match[1]);
}

function extractFirst(xml, regex) {
  const match = String(xml || "").match(regex);
  return match ? match[1] : "";
}

function choosePublicationDate(xml) {
  const pubDateBlocks = extractAll(xml, /<pub-date\b[^>]*>([\s\S]*?)<\/pub-date>/gi);
  for (const block of pubDateBlocks) {
    const year = stripXmlTags(extractFirst(block, /<year>([\s\S]*?)<\/year>/i));
    const month = stripXmlTags(extractFirst(block, /<month>([\s\S]*?)<\/month>/i));
    const day = stripXmlTags(extractFirst(block, /<day>([\s\S]*?)<\/day>/i));

    if (year) {
      return [year, month.padStart(2, "0"), day.padStart(2, "0")]
        .filter(Boolean)
        .join("-")
        .replace(/-00/g, "");
    }
  }

  return "";
}

function choosePublicationYear(xml) {
  const year = stripXmlTags(extractFirst(xml, /<pub-date\b[^>]*>[\s\S]*?<year>([\s\S]*?)<\/year>[\s\S]*?<\/pub-date>/i));
  return normalizeText(year, 4);
}

function parsePmcArticle(xml) {
  const pmid = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<article-id\b[^>]*pub-id-type="pmid"[^>]*>([\s\S]*?)<\/article-id>/i)
    ),
    32
  );
  const pmcid = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<article-id\b[^>]*pub-id-type="pmc"[^>]*>([\s\S]*?)<\/article-id>/i)
    ),
    40
  );
  const doi = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<article-id\b[^>]*pub-id-type="doi"[^>]*>([\s\S]*?)<\/article-id>/i)
    ),
    160
  );
  const title = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<article-title>([\s\S]*?)<\/article-title>/i)
    ),
    1200
  );
  const abstract = normalizeText(
    extractAll(xml, /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/gi)
      .map(stripXmlTags)
      .join(" "),
    20000
  );
  const bodyXml = extractFirst(xml, /<body>([\s\S]*?)<\/body>/i);
  const fullText = normalizeText(stripXmlTags(bodyXml), 120000);
  const journal = normalizeText(
    stripXmlTags(
      extractFirst(
        xml,
        /<journal-title>([\s\S]*?)<\/journal-title>/i
      ) ||
        extractFirst(xml, /<abbrev-journal-title[^>]*>([\s\S]*?)<\/abbrev-journal-title>/i)
    ),
    300
  );
  const publicationTypes = extractAll(
    xml,
    /<subj-group\b[^>]*>([\s\S]*?)<\/subj-group>/gi
  )
    .map((groupXml) =>
      extractAll(groupXml, /<subject>([\s\S]*?)<\/subject>/gi)
        .map(stripXmlTags)
        .filter(Boolean)
    )
    .flat()
    .slice(0, 15);
  const meshTerms = extractAll(
    xml,
    /<kwd>([\s\S]*?)<\/kwd>/gi
  )
    .map(stripXmlTags)
    .filter(Boolean)
    .slice(0, 25);

  return {
    pmid,
    pmcid,
    doi,
    title,
    abstract,
    full_text: fullText,
    journal,
    publication_date: choosePublicationDate(xml),
    publication_year: choosePublicationYear(xml),
    publication_types: publicationTypes,
    mesh_terms: meshTerms,
  };
}

function buildUrl(endpoint, params) {
  const url = new URL(`${BASE_EUTILS_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

class RateLimitedNcbiClient {
  constructor({ requestsPerSecond }) {
    this.intervalMs = Math.ceil(1000 / requestsPerSecond);
    this.nextAllowedAt = 0;
  }

  async fetchText(url) {
    let attempt = 0;

    while (attempt < 5) {
      const now = Date.now();
      const waitMs = Math.max(0, this.nextAllowedAt - now);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      this.nextAllowedAt = Date.now() + this.intervalMs;
      const response = await fetch(url, {
        headers: {
          Accept: "application/xml, application/json, text/plain;q=0.8, */*;q=0.5",
        },
      });

      const text = await response.text();
      if (response.ok) {
        return text;
      }

      if (response.status === 429) {
        const retryAfterHeader = Number(response.headers.get("retry-after") || 0);
        const backoffMs = retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : Math.min(30000, 1500 * 2 ** attempt);
        console.warn(
          `NCBI rate limit hit. Backing off for ${formatDuration(backoffMs)} before retrying...`
        );
        this.nextAllowedAt = Date.now() + backoffMs;
        attempt += 1;
        continue;
      }

      throw new Error(`NCBI request failed (${response.status}): ${text.slice(0, 300)}`);
    }

    throw new Error("NCBI rate limit persisted after multiple retries.");
  }

  async fetchJson(url) {
    const text = await this.fetchText(url);
    return JSON.parse(text);
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(path.resolve(process.cwd(), dirPath), { recursive: true });
}

async function searchPubMed({ client, query, maxResults, apiKey, tool, email }) {
  const url = buildUrl("esearch.fcgi", {
    db: "pubmed",
    term: query,
    retmax: maxResults,
    retmode: "json",
    api_key: apiKey,
    tool,
    email,
  });

  const payload = await client.fetchJson(url);
  return payload?.esearchresult?.idlist || [];
}

function parsePmcLinksXml(xml) {
  const linkSetMatches = [...String(xml || "").matchAll(/<LinkSet>([\s\S]*?)<\/LinkSet>/gi)];
  const mappings = [];

  for (const [, linkSetXml] of linkSetMatches) {
    const pmid = normalizeText(
      stripXmlTags(extractFirst(linkSetXml, /<IdList>[\s\S]*?<Id>([\s\S]*?)<\/Id>[\s\S]*?<\/IdList>/i)),
      32
    );
    const pmcIds = extractAll(
      linkSetXml,
      /<LinkSetDb>[\s\S]*?<DbTo>pmc<\/DbTo>[\s\S]*?<LinkName>[^<]*<\/LinkName>([\s\S]*?)<\/LinkSetDb>/gi
    )
      .flatMap((block) => extractAll(block, /<Link>[\s\S]*?<Id>([\s\S]*?)<\/Id>[\s\S]*?<\/Link>/gi))
      .map((value) => normalizeText(stripXmlTags(value), 32))
      .filter(Boolean)
      .map((value) => (value.startsWith("PMC") ? value : `PMC${value}`));

    mappings.push({
      pmid,
      pmcids: [...new Set(pmcIds)],
    });
  }

  return mappings.filter((item) => item.pmid && item.pmcids.length > 0);
}

async function mapPmidsToPmcids({
  client,
  pmids,
  apiKey,
  tool,
  email,
}) {
  const mappings = [];

  for (const batch of chunkArray(pmids, DEFAULT_LINK_BATCH_SIZE)) {
    const url = buildUrl("elink.fcgi", {
      dbfrom: "pubmed",
      db: "pmc",
      id: batch.join(","),
      api_key: apiKey,
      tool,
      email,
    });

    const xml = await client.fetchText(url);
    mappings.push(...parsePmcLinksXml(xml));
  }

  return mappings;
}

async function fetchPmcArticleXml({
  client,
  pmcid,
  apiKey,
  tool,
  email,
}) {
  const numericId = pmcid.replace(/^PMC/i, "");
  const url = buildUrl("efetch.fcgi", {
    db: "pmc",
    id: numericId,
    retmode: "xml",
    api_key: apiKey,
    tool,
    email,
  });

  return client.fetchText(url);
}

async function writeJsonl(outputPath, records) {
  const absolutePath = path.resolve(process.cwd(), outputPath);
  await ensureDirectory(path.dirname(absolutePath));
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(absolutePath, `${lines}\n`, "utf8");
}

function printUsage() {
  console.log("Usage:");
  console.log(
    '  node scripts/fetch-pmc-fulltext.js --query="creatine AND resistance training" [--max-results=50] [--output="data\\pmc-fulltext.jsonl"] [--raw-dir="data\\pmc-raw"] [--requests-per-second=8] [--api-key=YOUR_KEY] [--tool=emersus_ai] [--email=you@example.com] [--dry-run]'
  );
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function logFetchProgress({
  completed,
  total,
  startedAt,
  currentTitle,
  currentPmcid,
}) {
  const elapsedMs = Date.now() - startedAt;
  const averageMsPerItem = completed > 0 ? elapsedMs / completed : 0;
  const remainingItems = Math.max(total - completed, 0);
  const remainingMs = averageMsPerItem * remainingItems;
  const percent = total > 0 ? ((completed / total) * 100).toFixed(1) : "0.0";
  const titleSuffix = currentTitle ? ` | ${currentTitle}` : "";

  console.log(
    `[${completed}/${total} | ${percent}%] ETA ${formatDuration(
      remainingMs
    )} | elapsed ${formatDuration(elapsedMs)} | ${currentPmcid}${titleSuffix}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.query) {
    printUsage();
    throw new Error("Missing required --query argument.");
  }

  if (!args.apiKey && args.requestsPerSecond > DEFAULT_ANON_REQUESTS_PER_SECOND) {
    args.requestsPerSecond = DEFAULT_ANON_REQUESTS_PER_SECOND;
  }

  const client = new RateLimitedNcbiClient({
    requestsPerSecond: args.requestsPerSecond,
  });

  console.log(
    `Searching PubMed with a capped rate of ${args.requestsPerSecond} requests/second...`
  );
  const pmids = await searchPubMed({
    client,
    query: args.query,
    maxResults: args.maxResults,
    apiKey: args.apiKey,
    tool: args.tool,
    email: args.email,
  });

  console.log(`Found ${pmids.length} PubMed IDs.`);
  if (pmids.length === 0) {
    throw new Error("No PubMed results matched the query.");
  }

  const pmcMappings = await mapPmidsToPmcids({
    client,
    pmids,
    apiKey: args.apiKey,
    tool: args.tool,
    email: args.email,
  });

  const pmcidPairs = pmcMappings.flatMap((mapping) =>
    mapping.pmcids.map((pmcid) => ({ pmid: mapping.pmid, pmcid }))
  );

  console.log(`Mapped ${pmcidPairs.length} PMC full-text candidates.`);
  if (pmcidPairs.length === 0) {
    throw new Error(
      "No PMC full-text articles were found for the PubMed results."
    );
  }

  if (args.dryRun) {
    console.log("Dry run complete. No XML or JSONL files were written.");
    return;
  }

  await ensureDirectory(args.rawDir);

  const records = [];
  const fetchStartedAt = Date.now();

  for (let index = 0; index < pmcidPairs.length; index += 1) {
    const pair = pmcidPairs[index];
    const xml = await fetchPmcArticleXml({
      client,
      pmcid: pair.pmcid,
      apiKey: args.apiKey,
      tool: args.tool,
      email: args.email,
    });

    const rawFilePath = path.resolve(
      process.cwd(),
      args.rawDir,
      `${pair.pmcid}.xml`
    );
    await fs.writeFile(rawFilePath, xml, "utf8");

    const parsed = parsePmcArticle(xml);
    const record = {
      ...parsed,
      pmid: parsed.pmid || pair.pmid,
      pmcid: parsed.pmcid || pair.pmcid,
    };

    if (!record.pmid || !record.title) {
      console.warn(`Skipping ${pair.pmcid} because PMID or title was missing.`);
      continue;
    }

    records.push(record);
    logFetchProgress({
      completed: index + 1,
      total: pmcidPairs.length,
      startedAt: fetchStartedAt,
      currentTitle: record.title,
      currentPmcid: record.pmcid,
    });
  }

  await writeJsonl(args.output, records);
  console.log(`Saved ${records.length} records to ${args.output}`);
  console.log("Next step: run npm run import:pubmed -- --input=\"data\\pmc-fulltext.jsonl\"");
}

main().catch((error) => {
  console.error("FETCH ERROR:");
  console.error(error);
  process.exit(1);
});
