// Validates TOPIC_QUERIES against PubMed eutils /esearch by checking that
// each query returns a reasonable number of papers. Rate-limited to the
// PubMed unauthenticated limit (3 req/sec). Reports pass/warn/fail per
// query to stdout so operators can fix malformed queries before running
// a real fill.
//
// Usage:
//   node scripts/validate-pubmed-queries.js                    # all topics
//   node scripts/validate-pubmed-queries.js --topics=creatine,sleep
//   node scripts/validate-pubmed-queries.js --min-count=100    # tune pass threshold
//
// Thresholds:
//   count >= PASS_MIN       → PASS
//   WARN_MIN <= count < PASS_MIN → WARN  (query works but narrow)
//   count <  WARN_MIN       → FAIL  (likely malformed or very obscure topic)
import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_PASS_MIN = 100;
const DEFAULT_WARN_MIN = 10;
const REQUEST_SPACING_MS = 350; // ~3 RPS, under PubMed's unauthenticated limit
const ESEARCH_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

function parseArgs(argv) {
  const args = { topics: null, passMin: DEFAULT_PASS_MIN, warnMin: DEFAULT_WARN_MIN };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--topics") {
      args.topics = value.split(",").map(s => s.trim()).filter(Boolean);
    } else if (key === "--min-count") {
      args.passMin = Number(value) || DEFAULT_PASS_MIN;
    } else if (key === "--warn-count") {
      args.warnMin = Number(value) || DEFAULT_WARN_MIN;
    }
  }
  return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function curlGet(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25", "-A", "emersus-validator/1.0", url];
    const child = spawn("curl", args);
    let out = ""; let err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}

async function esearchCount(query) {
  const url = `${ESEARCH_URL}?db=pubmed&retmax=0&term=${encodeURIComponent(query)}`;
  const xml = await curlGet(url);
  const match = xml.match(/<Count>(\d+)<\/Count>/);
  if (!match) throw new Error(`no <Count> in response: ${xml.slice(0, 200)}`);
  return Number(match[1]);
}

// Parse TOPIC_QUERIES from fill-pmc-topics.js without importing the module
// (fill-pmc-topics.js does not export TOPIC_QUERIES; it's a script, not a
// library). A simple regex over the object literal is sufficient because
// the file uses a flat { key: "value", ... } shape.
function parseTopicQueries() {
  const src = readFileSync(
    new URL("./fill-pmc-topics.js", import.meta.url),
    "utf8"
  );
  const out = {};
  // Match indented `  key_name: "string",` entries. Handles escaped quotes
  // inside the string literal. Multi-line strings with concatenation are
  // not supported — but fill-pmc-topics.js uses single-line literals.
  const re = /^\s{2}([a-z_0-9]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const TOPIC_QUERIES = parseTopicQueries();

  const topics = args.topics && args.topics.length
    ? args.topics.filter(t => TOPIC_QUERIES[t])
    : Object.keys(TOPIC_QUERIES);

  if (!topics.length) {
    console.error("No matching topics. Available:", Object.keys(TOPIC_QUERIES).slice(0, 5).join(", "), "...");
    process.exit(2);
  }

  const results = { pass: 0, warn: 0, fail: 0, error: 0, failed: [], warned: [] };
  console.log(`Validating ${topics.length} queries at ~${Math.round(1000 / REQUEST_SPACING_MS)} RPS...`);
  console.log(`Pass threshold: ≥${args.passMin}  Warn threshold: ≥${args.warnMin}\n`);

  for (const topic of topics) {
    const query = TOPIC_QUERIES[topic];
    try {
      const count = await esearchCount(query);
      let tag;
      if (count >= args.passMin) { tag = "PASS"; results.pass++; }
      else if (count >= args.warnMin) { tag = "WARN"; results.warn++; results.warned.push({ topic, count }); }
      else { tag = "FAIL"; results.fail++; results.failed.push({ topic, count, query }); }
      console.log(`[${tag}] ${count.toString().padStart(7)}  ${topic}`);
    } catch (e) {
      console.log(`[ERROR]          ${topic}: ${e.message.slice(0, 120)}`);
      results.error++;
    }
    await sleep(REQUEST_SPACING_MS);
  }

  console.log(`\nSummary: ${results.pass} pass, ${results.warn} warn, ${results.fail} fail, ${results.error} error`);
  if (results.failed.length) {
    console.log("\nFailed queries:");
    for (const f of results.failed) {
      console.log(`  ${f.topic} (count=${f.count}): ${f.query.slice(0, 160)}${f.query.length > 160 ? "..." : ""}`);
    }
  }
  if (results.fail > 0 || results.error > 0) process.exit(1);
}

// Export main so the wrapper (validate-pubmed-queries.js --direct) can call it.
export { main };

// Auto-run when invoked directly (node scripts/validate-pubmed-queries-direct.js).
// Skipped on import so the wrapper can import without triggering a run.
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
  });
}
