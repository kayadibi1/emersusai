import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { supabaseAdmin } from "../api/lib/clients.js";

const BASE_EUTILS_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DEFAULT_TARGET = 1000;
const DEFAULT_SEARCH_BATCH = 200;
const DEFAULT_LINK_BATCH_SIZE = 100;
const DEFAULT_REQUESTS_PER_SECOND = 8;
const DEFAULT_ANON_REQUESTS_PER_SECOND = 3;
const DEFAULT_OUTPUT = "data\\pmc-corpus.jsonl";
const DEFAULT_RAW_DIR = "data\\pmc-corpus-raw";

function parseArgs(argv) {
  const args = {
    query: "",
    target: DEFAULT_TARGET,
    searchBatch: DEFAULT_SEARCH_BATCH,
    requestsPerSecond: DEFAULT_REQUESTS_PER_SECOND,
    output: DEFAULT_OUTPUT,
    rawDir: DEFAULT_RAW_DIR,
    apiKey: process.env.NCBI_API_KEY || "",
    tool: process.env.NCBI_TOOL || "emersus_ai",
    email: process.env.NCBI_EMAIL || "",
    skipImport: false,
    skipEmbed: false,
    dryRun: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--skip-import") {
      args.skipImport = true;
      continue;
    }

    if (rawArg === "--skip-embed") {
      args.skipEmbed = true;
      continue;
    }

    if (rawArg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const [key, ...rest] = rawArg.split("=");
    const value = rest.join("=");

    if (key === "--query") {
      args.query = value;
    } else if (key === "--target") {
      args.target = Number(value || DEFAULT_TARGET);
    } else if (key === "--search-batch") {
      args.searchBatch = Number(value || DEFAULT_SEARCH_BATCH);
    } else if (key === "--requests-per-second") {
      args.requestsPerSecond = Number(value || DEFAULT_REQUESTS_PER_SECOND);
    } else if (key === "--output") {
      args.output = value;
    } else if (key === "--raw-dir") {
      args.rawDir = value;
    } else if (key === "--api-key") {
      args.apiKey = value;
    } else if (key === "--tool") {
      args.tool = value;
    } else if (key === "--email") {
      args.email = value;
    }
  }

  args.target = Math.max(1, Math.floor(args.target || DEFAULT_TARGET));
  args.searchBatch = Math.max(20, Math.min(500, Math.floor(args.searchBatch || DEFAULT_SEARCH_BATCH)));
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

function normalizeAuthors(authors, maxItems = 20) {
  if (!Array.isArray(authors)) {
    return [];
  }

  return [...new Set(
    authors
      .map((author) => normalizeText(author, 160))
      .filter(Boolean)
      .slice(0, maxItems)
  )];
}

function parsePmcAuthors(xml) {
  const contribBlocks = extractAll(
    xml,
    /<contrib\b[^>]*contrib-type="author"[^>]*>([\s\S]*?)<\/contrib>/gi
  );

  return normalizeAuthors(
    contribBlocks.map((block) => {
      const surname = stripXmlTags(extractFirst(block, /<surname>([\s\S]*?)<\/surname>/i));
      const givenNames = stripXmlTags(
        extractFirst(block, /<given-names>([\s\S]*?)<\/given-names>/i)
      );
      const nameText = stripXmlTags(extractFirst(block, /<string-name>([\s\S]*?)<\/string-name>/i));
      const collab = stripXmlTags(extractFirst(block, /<collab>([\s\S]*?)<\/collab>/i));

      return [givenNames, surname].filter(Boolean).join(" ") || nameText || collab;
    })
  );
}

function parsePubMedAuthors(xml) {
  const authorBlocks = extractAll(
    xml,
    /<Author\b[^>]*>([\s\S]*?)<\/Author>/gi
  );

  const parsedAuthors = authorBlocks.map((block) => {
    const lastName = stripXmlTags(extractFirst(block, /<LastName>([\s\S]*?)<\/LastName>/i));
    const foreName = stripXmlTags(extractFirst(block, /<ForeName>([\s\S]*?)<\/ForeName>/i));
    const initials = stripXmlTags(extractFirst(block, /<Initials>([\s\S]*?)<\/Initials>/i));
    const collectiveName = stripXmlTags(
      extractFirst(block, /<CollectiveName>([\s\S]*?)<\/CollectiveName>/i)
    );

    return [foreName, lastName].filter(Boolean).join(" ") || [initials, lastName].filter(Boolean).join(" ") || collectiveName;
  });

  return normalizeAuthors(parsedAuthors);
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
  const year = stripXmlTags(
    extractFirst(xml, /<pub-date\b[^>]*>[\s\S]*?<year>([\s\S]*?)<\/year>[\s\S]*?<\/pub-date>/i)
  );
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
  const title = normalizeText(stripXmlTags(extractFirst(xml, /<article-title>([\s\S]*?)<\/article-title>/i)), 1200);
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
      extractFirst(xml, /<journal-title>([\s\S]*?)<\/journal-title>/i) ||
        extractFirst(xml, /<abbrev-journal-title[^>]*>([\s\S]*?)<\/abbrev-journal-title>/i)
    ),
    300
  );
  const publicationTypes = extractAll(xml, /<subj-group\b[^>]*>([\s\S]*?)<\/subj-group>/gi)
    .map((groupXml) =>
      extractAll(groupXml, /<subject>([\s\S]*?)<\/subject>/gi)
        .map(stripXmlTags)
        .filter(Boolean)
    )
    .flat()
    .slice(0, 15);
  const meshTerms = extractAll(xml, /<kwd>([\s\S]*?)<\/kwd>/gi)
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
    authors: parsePmcAuthors(xml),
    publication_date: choosePublicationDate(xml),
    publication_year: choosePublicationYear(xml),
    publication_types: publicationTypes,
    mesh_terms: meshTerms,
  };
}

function parsePubMedArticle(xml) {
  const pmid = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<PMID\b[^>]*>([\s\S]*?)<\/PMID>/i)
    ),
    32
  );
  const doi = normalizeText(
    stripXmlTags(
      extractFirst(
        xml,
        /<ArticleId\b[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/i
      )
    ),
    160
  );
  const pmcid = normalizeText(
    stripXmlTags(
      extractFirst(
        xml,
        /<ArticleId\b[^>]*IdType="pmc"[^>]*>([\s\S]*?)<\/ArticleId>/i
      )
    ),
    40
  );
  const title = normalizeText(
    stripXmlTags(extractFirst(xml, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/i)),
    1200
  );
  const abstract = normalizeText(
    extractAll(xml, /<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/gi)
      .map(stripXmlTags)
      .join(" "),
    20000
  );
  const journal = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>[\s\S]*?<\/Journal>/i) ||
        extractFirst(
          xml,
          /<Journal>[\s\S]*?<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>[\s\S]*?<\/Journal>/i
        )
    ),
    300
  );
  const publicationYear = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<PubDate>[\s\S]*?<Year>([\s\S]*?)<\/Year>[\s\S]*?<\/PubDate>/i) ||
        extractFirst(xml, /<ArticleDate\b[^>]*>[\s\S]*?<Year>([\s\S]*?)<\/Year>/i)
    ),
    4
  );
  const publicationMonth = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<PubDate>[\s\S]*?<Month>([\s\S]*?)<\/Month>[\s\S]*?<\/PubDate>/i) ||
        extractFirst(xml, /<ArticleDate\b[^>]*>[\s\S]*?<Month>([\s\S]*?)<\/Month>/i)
    ),
    12
  );
  const publicationDay = normalizeText(
    stripXmlTags(
      extractFirst(xml, /<PubDate>[\s\S]*?<Day>([\s\S]*?)<\/Day>[\s\S]*?<\/PubDate>/i) ||
        extractFirst(xml, /<ArticleDate\b[^>]*>[\s\S]*?<Day>([\s\S]*?)<\/Day>/i)
    ),
    2
  );
  const publicationTypes = extractAll(
    xml,
    /<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/gi
  )
    .map(stripXmlTags)
    .filter(Boolean)
    .slice(0, 15);
  const meshTerms = extractAll(
    xml,
    /<MeshHeading>[\s\S]*?<DescriptorName\b[^>]*>([\s\S]*?)<\/DescriptorName>[\s\S]*?<\/MeshHeading>/gi
  )
    .map(stripXmlTags)
    .filter(Boolean)
    .slice(0, 25);
  const normalizedMonth = publicationMonth
    ? String(
        {
          jan: "01",
          feb: "02",
          mar: "03",
          apr: "04",
          may: "05",
          jun: "06",
          jul: "07",
          aug: "08",
          sep: "09",
          oct: "10",
          nov: "11",
          dec: "12",
        }[publicationMonth.toLowerCase().slice(0, 3)] || publicationMonth
      ).padStart(2, "0")
    : "";
  const publicationDate = publicationYear
    ? [publicationYear, normalizedMonth || "01", publicationDay.padStart(2, "0") || "01"]
        .filter(Boolean)
        .join("-")
    : "";

  return {
    pmid,
    pmcid,
    doi,
    title,
    abstract,
    full_text: "",
    journal,
    authors: parsePubMedAuthors(xml),
    publication_date: publicationDate,
    publication_year: publicationYear,
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

      const isRetryableTimeout =
        response.status === 400 &&
        /external viewer error: empty response|status:\s*timeout|empty response/i.test(
          text
        );

      if (response.status === 429 || isRetryableTimeout) {
        const retryAfterHeader = Number(response.headers.get("retry-after") || 0);
        const backoffMs =
          retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : Math.min(30000, 1500 * 2 ** attempt);
        const reason = response.status === 429 ? "rate limit" : "transient timeout";
        console.warn(
          `NCBI ${reason} hit. Backing off for ${formatDuration(backoffMs)} before retrying...`
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

async function searchPubMedPage({
  client,
  query,
  retstart,
  retmax,
  apiKey,
  tool,
  email,
}) {
  const url = buildUrl("esearch.fcgi", {
    db: "pubmed",
    term: query,
    retstart,
    retmax,
    retmode: "json",
    api_key: apiKey,
    tool,
    email,
  });

  const payload = await client.fetchJson(url);
  const result = payload?.esearchresult || {};
  return {
    count: Number(result.count || 0),
    ids: Array.isArray(result.idlist) ? result.idlist : [],
  };
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

async function mapPmidsToPmcids({ client, pmids, apiKey, tool, email }) {
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

async function fetchPmcArticleXml({ client, pmcid, apiKey, tool, email }) {
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

async function fetchPubMedArticleXml({ client, pmid, apiKey, tool, email }) {
  const url = buildUrl("efetch.fcgi", {
    db: "pubmed",
    id: pmid,
    retmode: "xml",
    api_key: apiKey,
    tool,
    email,
  });

  return client.fetchText(url);
}

async function fetchExistingPmids() {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const existing = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("pubmed_articles")
      .select("pmid")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch existing PMIDs: ${error.message}`);
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const row of data) {
      if (row?.pmid) {
        existing.add(String(row.pmid));
      }
    }

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return existing;
}

async function writeJsonl(outputPath, records) {
  const absolutePath = path.resolve(process.cwd(), outputPath);
  await ensureDirectory(path.dirname(absolutePath));
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(absolutePath, `${lines}\n`, "utf8");
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

function logProgress({ fetchedUnique, target, searchOffset, currentId, title, startedAt }) {
  const elapsedMs = Date.now() - startedAt;
  const averageMsPerRecord = fetchedUnique > 0 ? elapsedMs / fetchedUnique : 0;
  const remaining = Math.max(target - fetchedUnique, 0);
  const etaMs = averageMsPerRecord * remaining;
  const suffix = title ? ` | ${title}` : "";
  const percent = ((fetchedUnique / target) * 100).toFixed(1);

  console.log(
    `[${fetchedUnique}/${target} | ${percent}%] ETA ${formatDuration(etaMs)} | elapsed ${formatDuration(
      elapsedMs
    )} | search offset ${searchOffset} | ${currentId}${suffix}`
  );
}

function printUsage() {
  console.log("Usage:");
  console.log(
    '  node scripts/fill-pmc-corpus.js --query="creatine AND resistance training" [--target=1000] [--search-batch=200] [--output="data\\pubmed-corpus.jsonl"] [--raw-dir="data\\pubmed-raw"] [--requests-per-second=8] [--skip-import] [--skip-embed] [--dry-run]'
  );
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}.`));
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.query) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const effectiveRequestsPerSecond = args.apiKey
    ? args.requestsPerSecond
    : Math.min(args.requestsPerSecond, DEFAULT_ANON_REQUESTS_PER_SECOND);

  const client = new RateLimitedNcbiClient({
    requestsPerSecond: effectiveRequestsPerSecond,
  });
  const existingPmids = await fetchExistingPmids();
  const seenPmids = new Set(existingPmids);
  const stagedPmids = new Set();
  const records = [];
  const startedAt = Date.now();
  let pmcFullTextCount = 0;
  let pubmedAbstractCount = 0;

  console.log(
    `Starting PubMed corpus fill for ${args.target} new unique articles at a capped rate of ${effectiveRequestsPerSecond} requests/second...`
  );
  console.log(`Existing articles already in Supabase: ${existingPmids.size}`);
  console.log("Mode: PubMed search -> PMC full text when available -> PubMed abstract fallback otherwise.");

  let searchOffset = 0;
  let totalSearchCount = null;

  while (records.length < args.target) {
    const searchPage = await searchPubMedPage({
      client,
      query: args.query,
      retstart: searchOffset,
      retmax: args.searchBatch,
      apiKey: args.apiKey,
      tool: args.tool,
      email: args.email,
    });

    if (totalSearchCount === null) {
      totalSearchCount = searchPage.count;
      console.log(`PubMed search returned ${totalSearchCount} total matches.`);
    }

    if (!searchPage.ids.length) {
      break;
    }

    const unseenPmids = searchPage.ids.filter((pmid) => !seenPmids.has(String(pmid)));
    console.log(
      `Search batch ${searchOffset}-${searchOffset + searchPage.ids.length - 1}: ${searchPage.ids.length} PMIDs, ${unseenPmids.length} not already loaded.`
    );

    if (unseenPmids.length) {
      const mappings = await mapPmidsToPmcids({
        client,
        pmids: unseenPmids,
        apiKey: args.apiKey,
        tool: args.tool,
        email: args.email,
      });
      const mappingByPmid = new Map(
        mappings.map((mapping) => [String(mapping.pmid), mapping])
      );

      for (const unseenPmid of unseenPmids) {
        if (records.length >= args.target) {
          break;
        }

        const pmid = String(unseenPmid || "");
        const mapping = mappingByPmid.get(pmid);
        if (!pmid || seenPmids.has(pmid)) {
          continue;
        }

        let capturedRecord = null;
        let capturedXml = "";
        let capturedId = pmid;

        if (mapping?.pmcids?.length) {
          for (const pmcid of mapping.pmcids) {
            if (records.length >= args.target) {
              break;
            }

            try {
              const xml = await fetchPmcArticleXml({
                client,
                pmcid,
                apiKey: args.apiKey,
                tool: args.tool,
                email: args.email,
              });
              const record = parsePmcArticle(xml);

              if (
                !record?.pmid ||
                !record.title ||
                seenPmids.has(record.pmid) ||
                stagedPmids.has(record.pmid)
              ) {
                continue;
              }

              capturedRecord = record;
              capturedXml = xml;
              capturedId = pmcid;
              pmcFullTextCount += 1;
              break;
            } catch (error) {
              console.warn(
                `PMC fetch failed for ${pmcid}. Will try fallback if needed: ${error.message || error}`
              );
            }
          }
        }

        if (!capturedRecord) {
          try {
            const pubmedXml = await fetchPubMedArticleXml({
              client,
              pmid,
              apiKey: args.apiKey,
              tool: args.tool,
              email: args.email,
            });
            const pubmedRecord = parsePubMedArticle(pubmedXml);

            if (
              pubmedRecord?.pmid &&
              pubmedRecord.title &&
              !seenPmids.has(pubmedRecord.pmid) &&
              !stagedPmids.has(pubmedRecord.pmid)
            ) {
              capturedRecord = pubmedRecord;
              capturedXml = pubmedXml;
              capturedId = `PMID ${pmid}`;
              pubmedAbstractCount += 1;
            }
          } catch (error) {
            console.warn(
              `Skipping PMID ${pmid} after PMC and PubMed fetch failures: ${error.message || error}`
            );
            continue;
          }
        }

        if (!capturedRecord) {
          continue;
        }

        stagedPmids.add(capturedRecord.pmid);
        seenPmids.add(capturedRecord.pmid);
        records.push(capturedRecord);

        if (!args.dryRun) {
          const rawPath = path.resolve(
            process.cwd(),
            args.rawDir,
            `${capturedId.replace(/[^\w.-]+/g, "_")}.xml`
          );
          await ensureDirectory(path.dirname(rawPath));
          await fs.writeFile(rawPath, capturedXml, "utf8");
        }

        logProgress({
          fetchedUnique: records.length,
          target: args.target,
          searchOffset,
          currentId: capturedId,
          title: capturedRecord.title,
          startedAt,
        });
      }
    }

    searchOffset += searchPage.ids.length;
    if (totalSearchCount !== null && searchOffset >= totalSearchCount) {
      break;
    }
  }

  if (records.length === 0) {
    throw new Error("No new unique PMC articles were found to import.");
  }

  console.log(`Collected ${records.length} new unique articles.`);
  console.log(`PMC full text articles collected: ${pmcFullTextCount}`);
  console.log(`PubMed abstract-only articles collected: ${pubmedAbstractCount}`);

  if (args.dryRun) {
    console.log("Dry run complete. No files written and no import/embed steps executed.");
    return;
  }

  await writeJsonl(args.output, records);
  console.log(`Wrote ${records.length} records to ${args.output}`);

  if (!args.skipImport) {
    console.log("Starting PubMed import...");
    await runCommand(process.execPath, ["scripts/import-pubmed.js", `--input=${args.output}`]);
  }

  if (!args.skipEmbed) {
    console.log("Starting evidence embedding...");
    await runCommand(process.execPath, ["scripts/embed-evidence.js"]);
  }

  console.log("Corpus fill complete.");
}

main().catch((error) => {
  console.error("FILL ERROR:");
  console.error(error);
  process.exit(1);
});
