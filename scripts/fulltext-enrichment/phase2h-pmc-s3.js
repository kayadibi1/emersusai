// scripts/fulltext-enrichment/phase2h-pmc-s3.js
//
// Phase 2H — full-text enrichment via the NCBI AWS Open Data PMC bucket.
//
// Why this exists alongside the europepmc-bulk variant:
//   europepmc.org/ftp/oa throttles bandwidth per-IP (~1.8 MB/s single-stream,
//   no benefit from parallelism — measured 62.7s/archive at concurrency=4).
//   The AWS S3 mirror at s3://pmc-oa-opendata/ has no per-IP throttle:
//   measured 32 concurrent GETs from Hetzner in 0.55s, vs 0.45s for one.
//
// Layout (per paper):
//   https://pmc-oa-opendata.s3.amazonaws.com/PMC{id}.{v}/PMC{id}.{v}.xml
//   https://pmc-oa-opendata.s3.amazonaws.com/PMC{id}.{v}/PMC{id}.{v}.txt   (pre-extracted)
//   https://pmc-oa-opendata.s3.amazonaws.com/PMC{id}.{v}/PMC{id}.{v}.json  (metadata)
// Most papers are version .1; revised papers may have .2 / .3.
//
// Pipeline per paper:
//   GET .{1,2,3}.xml → parseJatsFullText → buildBodyChunks
//   → batched JSONL append + DB UPDATE every FLUSH_EVERY successes.
//
// Eligibility:
//   research_articles WHERE content_source = 'abstract_only'
//                       AND pmcid IS NOT NULL AND pmcid != ''
//
// Tag map (mirrors europepmc-bulk variant):
//   phase2h_pmc_s3              — success
//   phase2h_pmc_s3_no_body      — XML present but no usable body
//   phase2h_pmc_s3_rejected_short — body <1000 chars
//   phase2h_pmc_s3_notfound     — PMCID has no .1/.2/.3 XML on S3
//
// Output staged to data/chunks-phase2h-pmc-s3.jsonl.
//
// Usage (Hetzner):
//   nohup node scripts/fulltext-enrichment/phase2h-pmc-s3.js \
//     > ~/phase2h-pmc-s3.log 2>&1 &
//
// Flags:
//   --concurrency=N    parallel GETs (default 32)
//   --max-rows=N       limit target PMCIDs (debug)
//   --dry-run          no DB writes / no JSONL append
//   --flush-every=N    DB-batch size (default 200)

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import pg from "pg";
import { parseJatsFullText } from "./lib/jats-parser.js";
import { buildBodyChunks } from "./lib/fulltext-chunker.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSONL = path.join(moduleDir, "data", "chunks-phase2h-pmc-s3.jsonl");
const S3_BASE = "https://pmc-oa-opendata.s3.amazonaws.com";
const UA = "Mozilla/5.0 (compatible; emersus/1.0; +https://emersus.ai info@emersus.ai)";

const TAG_OK = "phase2h_pmc_s3";
const TAG_NO_BODY = "phase2h_pmc_s3_no_body";
const TAG_REJECT_SHORT = "phase2h_pmc_s3_rejected_short";
const TAG_NOTFOUND = "phase2h_pmc_s3_notfound";

const MIN_BODY_CHARS = 1000;
const VERSIONS_TO_TRY = [1, 2, 3];

const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 20,
  keepAlive: true,
});

// One agent shared across all GETs lets keep-alive amortize TLS handshakes
// (S3 supports HTTP/1.1 keep-alive and HTTP/2 — this is a measurable win
// at concurrency >= 16).
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });

function parseArgs(argv) {
  const a = { concurrency: 32, maxRows: Infinity, dryRun: false, flushEvery: 200 };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--concurrency") a.concurrency = Math.max(1, Number(v) || a.concurrency);
    else if (k === "--max-rows") a.maxRows = Number(v) || a.maxRows;
    else if (k === "--flush-every") a.flushEvery = Math.max(1, Number(v) || a.flushEvery);
    else if (k === "--dry-run") a.dryRun = true;
  }
  return a;
}

async function loadTargets(pg, args) {
  const limit = Number.isFinite(args.maxRows) ? args.maxRows : 1_000_000;
  const { rows } = await pg.query(
    `SELECT pmid, pmcid FROM research_articles
       WHERE content_source = 'abstract_only'
         AND pmcid IS NOT NULL AND pmcid != ''
       LIMIT $1`,
    [limit]
  );
  // Return [{pmid, pmcidStr}] — pmcidStr always normalized to "PMC{digits}"
  // for the S3 URL. DB has two formats: "PMC10000143" and "10000143".
  return rows
    .map((r) => {
      const m = String(r.pmcid).match(/^(?:PMC)?(\d+)$/i);
      if (!m) return null;
      return { pmid: Number(r.pmid), pmcidStr: `PMC${m[1]}` };
    })
    .filter(Boolean);
}

// GET an https URL with custom UA + keep-alive agent. Returns
// {status, body} where body is utf8 string for 200, null for 404.
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA }, agent: httpsAgent }, (res) => {
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
      })
      .on("error", reject);
  });
}

// Try .1 first, fall back to .2 / .3. Returns {xml, version} or null.
async function fetchPmcXml(pmcidStr) {
  for (const v of VERSIONS_TO_TRY) {
    const url = `${S3_BASE}/${pmcidStr}.${v}/${pmcidStr}.${v}.xml`;
    try {
      const r = await fetchUrl(url);
      if (r.status === 200 && r.body) return { xml: r.body, version: v };
      if (r.status === 404) continue;
      // 5xx etc. — treat as transient, just retry once on next version
      continue;
    } catch (err) {
      // network errors — try next version
      continue;
    }
  }
  return null;
}

// Batched flusher. Holds a queue of result objects and flushes either when
// it accumulates flushEvery items or when force=true.
class BatchedWriter {
  constructor(pg, jsonlOut, flushEvery, dryRun) {
    this.pg = pg;
    this.jsonlOut = jsonlOut;
    this.flushEvery = flushEvery;
    this.dryRun = dryRun;
    this.successes = [];     // {pmid, full_text}
    this.noBodyIds = [];     // pmid
    this.shortIds = [];      // pmid
    this.notfoundIds = [];   // pmid
    this.pendingChunks = []; // jsonl strings
    this.flushPromise = Promise.resolve();
  }
  async addSuccess(pmid, fullText, chunks) {
    this.successes.push({ pmid, full_text: fullText });
    for (const c of chunks) this.pendingChunks.push(JSON.stringify(c));
    if (this.successes.length >= this.flushEvery) await this.flush();
  }
  addNoBody(pmid) { this.noBodyIds.push(pmid); }
  addShort(pmid) { this.shortIds.push(pmid); }
  addNotfound(pmid) { this.notfoundIds.push(pmid); }
  async flush() {
    if (this.dryRun) {
      this.successes = []; this.noBodyIds = []; this.shortIds = [];
      this.notfoundIds = []; this.pendingChunks = [];
      return;
    }
    const successes = this.successes;
    const noBodyIds = this.noBodyIds;
    const shortIds = this.shortIds;
    const notfoundIds = this.notfoundIds;
    const pendingChunks = this.pendingChunks;
    this.successes = []; this.noBodyIds = []; this.shortIds = [];
    this.notfoundIds = []; this.pendingChunks = [];

    // Serialize flushes so concurrent worker.add* calls can't interleave at
    // the DB layer (psotgres would handle it, but ordering is clearer).
    this.flushPromise = this.flushPromise.then(async () => {
      if (pendingChunks.length) this.jsonlOut.write(pendingChunks.join("\n") + "\n");
      if (successes.length) await applyFulltext(this.pg, successes);
      if (noBodyIds.length) await tagRows(this.pg, noBodyIds, TAG_NO_BODY);
      if (shortIds.length) await tagRows(this.pg, shortIds, TAG_REJECT_SHORT);
      if (notfoundIds.length) await tagRows(this.pg, notfoundIds, TAG_NOTFOUND);
    });
    return this.flushPromise;
  }
  async drain() { await this.flush(); await this.flushPromise; }
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

async function processOne(target, writer, stats) {
  const result = await fetchPmcXml(target.pmcidStr);
  if (!result) {
    writer.addNotfound(target.pmid);
    stats.notfound++;
    return;
  }
  const parsed = parseJatsFullText(result.xml);
  if (!parsed || !parsed.text || !parsed.sections?.length) {
    writer.addNoBody(target.pmid);
    stats.noBody++;
    return;
  }
  if (parsed.text.length < MIN_BODY_CHARS) {
    writer.addShort(target.pmid);
    stats.short++;
    return;
  }
  const chunks = buildBodyChunks({
    pmid: target.pmid,
    sections: parsed.sections,
    provenance: TAG_OK,
  });
  await writer.addSuccess(target.pmid, parsed.text, chunks);
  stats.ok++;
  stats.chunks += chunks.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[phase2h-s3] starting", args);

  fs.mkdirSync(path.dirname(OUTPUT_JSONL), { recursive: true });
  const jsonlOut = fs.createWriteStream(OUTPUT_JSONL, { flags: "a" });

  const targets = await loadTargets(_pool, args);
  console.log(`[phase2h-s3] target_pmcids=${targets.length}`);
  if (!targets.length) {
    console.log("[phase2h-s3] nothing to do");
    await _pool.end();
    return;
  }

  const writer = new BatchedWriter(_pool, jsonlOut, args.flushEvery, args.dryRun);
  const stats = { ok: 0, noBody: 0, short: 0, notfound: 0, chunks: 0, processed: 0 };

  let nextIndex = 0;
  const startedAt = Date.now();
  let lastLog = startedAt;

  async function worker(workerId) {
    while (true) {
      const i = nextIndex++;
      if (i >= targets.length) return;
      try {
        await processOne(targets[i], writer, stats);
      } catch (err) {
        // Log and continue — unexpected errors shouldn't kill the run
        console.error(`[phase2h-s3] worker=${workerId} pmcid=${targets[i].pmcidStr} ERR ${err.message}`);
      }
      stats.processed++;
      // Periodic progress log — every 5 seconds, regardless of worker
      const now = Date.now();
      if (now - lastLog > 5000) {
        lastLog = now;
        const elapsed = Math.round((now - startedAt) / 1000);
        const rate = stats.processed / Math.max(elapsed, 1);
        const etaSec = Math.round((targets.length - stats.processed) / Math.max(rate, 0.001));
        console.log(
          `[phase2h-s3] progress ${stats.processed}/${targets.length} ` +
          `ok=${stats.ok} no_body=${stats.noBody} short=${stats.short} notfound=${stats.notfound} ` +
          `chunks=${stats.chunks} rate=${rate.toFixed(1)}/s elapsed=${elapsed}s eta=${etaSec}s`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, (_, i) => worker(i + 1)));
  await writer.drain();

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[phase2h-s3] DONE processed=${stats.processed} ok=${stats.ok} ` +
    `no_body=${stats.noBody} short=${stats.short} notfound=${stats.notfound} ` +
    `chunks=${stats.chunks} elapsed=${elapsed}s`
  );

  await new Promise((r) => jsonlOut.end(r));
  await _pool.end();
}

main().catch((err) => { console.error("[phase2h-s3] FAILED:", err); process.exit(1); });
