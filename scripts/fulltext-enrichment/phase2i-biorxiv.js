// scripts/fulltext-enrichment/phase2i-biorxiv.js
//
// Per-paper bioRxiv/medRxiv full-text fetch. Targets the 10,905 papers in
// our DB whose DOI starts with 10.1101/ — preprint repositories that publish
// JATS XML directly (no PDF, no Grobid required).
//
// Why this exists:
//   The phase2h pipeline (PMC OA bulk) only covered published (post-peer-review)
//   biomedical literature in PubMed Central. Preprints sit on bioRxiv/medRxiv
//   instead — different namespace, different distribution. These papers are
//   100% open by design and provide JATS XML via their own API. This is the
//   cleanest non-Grobid path to more full text after phase2h.
//
// API:
//   GET https://api.biorxiv.org/details/biorxiv/{doi}    — metadata + jatsxml URL
//   GET https://api.biorxiv.org/details/medrxiv/{doi}    — same, medRxiv side
//   The bioRxiv vs medRxiv distinction is by JOURNAL (not by DOI prefix),
//   so we try both endpoints if the first 404s.
//
// Pipeline:
//   loadTargets (DOI LIKE '10.1101/%') → fetch metadata → GET jatsxml URL
//   → parseJatsFullText → buildBodyChunks → JSONL append + DB UPDATE batch
//
// Tag map:
//   phase2i_biorxiv_jats              — success
//   phase2i_biorxiv_no_body           — JATS present, no usable body
//   phase2i_biorxiv_rejected_short    — body <1000 chars
//   phase2i_biorxiv_notfound          — neither bioRxiv nor medRxiv has it
//   phase2i_biorxiv_no_jatsxml        — metadata returned but jatsxml URL missing
//
// Eligibility:
//   doi LIKE '10.1101/%' AND content_source IN ('abstract_only', 'phase2h_pmc_s3_notfound')
// Output: data/chunks-phase2i-biorxiv.jsonl
//
// Usage (Hetzner):
//   nohup node scripts/fulltext-enrichment/phase2i-biorxiv.js \
//     > ~/phase2i-biorxiv.log 2>&1 &

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import pg from "pg";
import { parseJatsFullText } from "./lib/jats-parser.js";
import { buildBodyChunks } from "./lib/fulltext-chunker.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSONL = path.join(moduleDir, "data", "chunks-phase2i-biorxiv.jsonl");
const API_BASE = "https://api.biorxiv.org/details";
const UA = "Mozilla/5.0 (compatible; emersus/1.0; +https://emersus.ai info@emersus.ai)";

const TAG_OK = "phase2i_biorxiv_jats";
const TAG_NO_BODY = "phase2i_biorxiv_no_body";
const TAG_REJECT_SHORT = "phase2i_biorxiv_rejected_short";
const TAG_NOTFOUND = "phase2i_biorxiv_notfound";
const TAG_NO_JATSXML = "phase2i_biorxiv_no_jatsxml";

const MIN_BODY_CHARS = 1000;
const RPS = 5;
const DB_FLUSH_EVERY = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TRANSIENT_RETRIES = 2;

const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
});

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

function parseArgs(argv) {
  const a = { maxRows: Infinity, dryRun: false };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--max-rows") a.maxRows = Number(v) || a.maxRows;
    else if (k === "--dry-run") a.dryRun = true;
  }
  return a;
}

async function loadTargets(pg, args) {
  const limit = Number.isFinite(args.maxRows) ? args.maxRows : 100_000;
  const { rows } = await pg.query(
    `SELECT pmid, doi FROM research_articles
       WHERE doi LIKE '10.1101/%'
         AND content_source IN ('abstract_only', 'phase2h_pmc_s3_notfound')
       ORDER BY pmid
       LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ pmid: Number(r.pmid), doi: r.doi })).filter((r) => r.doi);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": UA }, agent: httpsAgent, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      // Follow simple redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 308) {
        const loc = res.headers.location;
        res.resume();
        if (loc) {
          fetchUrl(loc).then(resolve, reject);
          return;
        }
      }
      if (res.statusCode === 404) {
        res.resume();
        resolve({ status: 404, body: null });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ status: res.statusCode, body: null });
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: 200, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
  });
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const r = await fetchUrl(url);
      if (r.status === 200) return r;
      if (r.status === 404) return r;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    } catch (err) {
      if (attempt === MAX_TRANSIENT_RETRIES) return { status: 0, body: null };
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
  return { status: 0, body: null };
}

// Try bioRxiv first, then medRxiv. Returns { jatsxml: <url> } | null
async function fetchPreprintMetadata(doi) {
  for (const server of ["biorxiv", "medrxiv"]) {
    const url = `${API_BASE}/${server}/${encodeURIComponent(doi)}`;
    const r = await fetchWithRetry(url);
    if (r.status !== 200 || !r.body) continue;
    let parsed;
    try { parsed = JSON.parse(r.body); } catch { continue; }
    if (parsed?.messages?.[0]?.status !== "ok") continue;
    const items = parsed?.collection || [];
    if (!items.length) continue;
    // Pick the latest version (highest version number)
    items.sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    const item = items[0];
    if (item?.jatsxml) return { jatsxml: item.jatsxml, server };
  }
  return null;
}

async function tagRows(pg, pmids, tag) {
  const ids = pmids.filter((x) => Number.isFinite(x));
  if (!ids.length) return;
  await pg.query(
    `UPDATE research_articles SET content_source = $2, updated_at = now()
      WHERE pmid = ANY($1::bigint[])`,
    [ids.map(Number), tag]
  );
}

async function applyFulltext(pg, rows) {
  if (!rows.length) return;
  const pmids = rows.map((r) => Number(r.pmid));
  const texts = rows.map((r) => r.full_text);
  await pg.query(
    `UPDATE research_articles ra
        SET full_text = v.full_text,
            has_full_text = true,
            content_source = $3,
            updated_at = now()
       FROM unnest($1::bigint[], $2::text[]) AS v(pmid, full_text)
      WHERE ra.pmid = v.pmid`,
    [pmids, texts, TAG_OK]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[phase2i-biorxiv] starting", args);

  fs.mkdirSync(path.dirname(OUTPUT_JSONL), { recursive: true });
  const jsonlOut = fs.createWriteStream(OUTPUT_JSONL, { flags: "a" });

  const targets = await loadTargets(_pool, args);
  console.log(`[phase2i-biorxiv] target_rows=${targets.length}`);
  if (!targets.length) {
    await new Promise((r) => jsonlOut.end(r));
    await _pool.end();
    return;
  }

  const stats = { processed: 0, ok: 0, notfound: 0, no_body: 0, short: 0, no_jatsxml: 0, errors: 0, chunks: 0 };
  const successes = [];
  const noBodyIds = [];
  const shortIds = [];
  const notfoundIds = [];
  const noJatsxmlIds = [];

  async function flush() {
    if (args.dryRun) {
      successes.length = 0; noBodyIds.length = 0; shortIds.length = 0;
      notfoundIds.length = 0; noJatsxmlIds.length = 0;
      return;
    }
    if (successes.length) await applyFulltext(_pool, successes.splice(0));
    if (noBodyIds.length) await tagRows(_pool, noBodyIds.splice(0), TAG_NO_BODY);
    if (shortIds.length) await tagRows(_pool, shortIds.splice(0), TAG_REJECT_SHORT);
    if (notfoundIds.length) await tagRows(_pool, notfoundIds.splice(0), TAG_NOTFOUND);
    if (noJatsxmlIds.length) await tagRows(_pool, noJatsxmlIds.splice(0), TAG_NO_JATSXML);
  }

  const startedAt = Date.now();
  let lastLog = startedAt;
  const minIntervalMs = 1000 / RPS;
  let lastReqAt = 0;

  for (const t of targets) {
    const wait = Math.max(0, lastReqAt + minIntervalMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReqAt = Date.now();

    let meta;
    try {
      meta = await fetchPreprintMetadata(t.doi);
    } catch (err) {
      stats.errors++;
      stats.processed++;
      continue;
    }

    if (!meta) {
      stats.notfound++;
      notfoundIds.push(t.pmid);
    } else if (!meta.jatsxml) {
      stats.no_jatsxml++;
      noJatsxmlIds.push(t.pmid);
    } else {
      // Fetch the JATS XML itself
      let jatsRes;
      try {
        jatsRes = await fetchWithRetry(meta.jatsxml);
      } catch (err) {
        stats.errors++;
        stats.processed++;
        continue;
      }
      if (jatsRes.status !== 200 || !jatsRes.body) {
        stats.no_jatsxml++;
        noJatsxmlIds.push(t.pmid);
      } else {
        const parsed = parseJatsFullText(jatsRes.body);
        if (!parsed || !parsed.text || !parsed.sections?.length) {
          stats.no_body++;
          noBodyIds.push(t.pmid);
        } else if (parsed.text.length < MIN_BODY_CHARS) {
          stats.short++;
          shortIds.push(t.pmid);
        } else {
          stats.ok++;
          successes.push({ pmid: t.pmid, full_text: parsed.text });
          const chunks = buildBodyChunks({ pmid: t.pmid, sections: parsed.sections, provenance: TAG_OK });
          stats.chunks += chunks.length;
          if (!args.dryRun) {
            for (const c of chunks) jsonlOut.write(JSON.stringify(c) + "\n");
          }
        }
      }
    }

    stats.processed++;

    if (
      successes.length >= DB_FLUSH_EVERY ||
      noBodyIds.length >= DB_FLUSH_EVERY ||
      shortIds.length >= DB_FLUSH_EVERY ||
      notfoundIds.length >= DB_FLUSH_EVERY ||
      noJatsxmlIds.length >= DB_FLUSH_EVERY
    ) {
      await flush();
    }

    const now = Date.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      const elapsed = Math.round((now - startedAt) / 1000);
      const rate = stats.processed / Math.max(elapsed, 1);
      const etaSec = Math.round((targets.length - stats.processed) / Math.max(rate, 0.001));
      console.log(
        `[phase2i-biorxiv] progress ${stats.processed}/${targets.length} ` +
        `ok=${stats.ok} notfound=${stats.notfound} no_body=${stats.no_body} short=${stats.short} ` +
        `no_jatsxml=${stats.no_jatsxml} errors=${stats.errors} chunks=${stats.chunks} ` +
        `rate=${rate.toFixed(1)}/s elapsed=${elapsed}s eta=${etaSec}s`
      );
    }
  }

  await flush();
  await new Promise((r) => jsonlOut.end(r));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[phase2i-biorxiv] DONE processed=${stats.processed} ok=${stats.ok} ` +
    `notfound=${stats.notfound} no_body=${stats.no_body} short=${stats.short} ` +
    `no_jatsxml=${stats.no_jatsxml} errors=${stats.errors} chunks=${stats.chunks} elapsed=${elapsed}s`
  );

  await _pool.end();
}

main().catch((err) => { console.error("[phase2i-biorxiv] FAILED:", err); process.exit(1); });
