// scripts/fulltext-enrichment/phase2h-europepmc-bulk.js
//
// Phase 2H — bulk full-text enrichment via Europe PMC's pre-bundled
// OA archives at https://europepmc.org/ftp/oa/.
//
// Why this exists:
//   The per-paper fetch-europepmc-jats.js works at 5 req/s polite, which
//   takes ~8h for 146K rows. Europe PMC also publishes ~1,245 pre-bundled
//   archives (PMC{start}_PMC{end}.xml.gz, ~10K articles each) covering
//   the entire OA subset. Streaming ~80–100 archives that overlap our
//   target PMCIDs cuts wall-clock to ~40–60min and avoids per-paper RTT.
//
// Pipeline per archive:
//   HTTPS GET → gunzip → article-boundary scanner → parseJatsFullText
//   → buildBodyChunks → JSONL append + DB update batch.
//
// Eligibility:
//   research_articles WHERE content_source = 'abstract_only'
//                       AND pmcid IS NOT NULL AND pmcid != ''
//
// Tag map:
//   phase2h_europepmc_bulk              — success, full_text set
//   phase2h_europepmc_bulk_no_body      — article present but no usable <body>
//   phase2h_europepmc_bulk_rejected_short — quality gate: <1000 chars body text
//   phase2h_europepmc_bulk_notfound     — PMCID not present in any archive
//
// Output:
//   data/chunks-phase2h-europepmc-bulk.jsonl  (consumed by fulltext-chunk-submit.js)
//
// Usage (run on Hetzner):
//   nohup node scripts/fulltext-enrichment/phase2h-europepmc-bulk.js \
//     > ~/phase2h-europepmc-bulk.log 2>&1 &
//
// Flags:
//   --max-archives=N   limit number of archives processed (debug)
//   --max-rows=N       limit total target PMCIDs (debug)
//   --dry-run          parse + chunk but skip DB writes + JSONL append
//   --resume           skip target PMCIDs already promoted past abstract_only

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import zlib from "node:zlib";
import https from "node:https";
import { StringDecoder } from "node:string_decoder";
import pg from "pg";
import { parseJatsFullText } from "./lib/jats-parser.js";
import { buildBodyChunks } from "./lib/fulltext-chunker.js";

// Inline withPg — matches phase2f-sweep.js. Avoids the abstract-enrichment/lib/pg.js
// re-export which is gitignored and not present on the deploy box.
const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
});
async function withPg(fn) {
  const client = await _pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSONL = path.join(moduleDir, "data", "chunks-phase2h-europepmc-bulk.jsonl");
const ARCHIVE_INDEX_URL = "https://europepmc.org/ftp/oa/";
const UA = "emersus-research-bot/1.0 (+https://emersus.ai; info@emersus.ai)";

const TAG_OK = "phase2h_europepmc_bulk";
const TAG_NO_BODY = "phase2h_europepmc_bulk_no_body";
const TAG_REJECT_SHORT = "phase2h_europepmc_bulk_rejected_short";
const TAG_NOTFOUND = "phase2h_europepmc_bulk_notfound";

const MIN_BODY_CHARS = 1000;
const DB_FLUSH_EVERY = 200;       // batch DB writes per N successes
const ARTICLE_BUFFER_MAX = 8 * 1024 * 1024;  // 8 MB safety cap for any single article

function parseArgs(argv) {
  const a = { maxArchives: Infinity, maxRows: Infinity, dryRun: false, resume: false };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--max-archives") a.maxArchives = Number(v) || a.maxArchives;
    else if (k === "--max-rows") a.maxRows = Number(v) || a.maxRows;
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--resume") a.resume = true;
  }
  return a;
}

// Pull list of target PMCIDs (numeric, e.g. 13900 not "PMC13900") from DB.
async function loadTargetPmcids(pg, args) {
  const sql = args.resume
    ? `SELECT pmid, pmcid FROM research_articles
        WHERE content_source = 'abstract_only'
          AND pmcid IS NOT NULL AND pmcid != ''
        LIMIT $1`
    : `SELECT pmid, pmcid FROM research_articles
        WHERE content_source = 'abstract_only'
          AND pmcid IS NOT NULL AND pmcid != ''
        LIMIT $1`;
  const limit = Number.isFinite(args.maxRows) ? args.maxRows : 1_000_000;
  const { rows } = await pg.query(sql, [limit]);

  // Index pmcid_num → pmid for fast lookup during streaming.
  const targets = new Map();
  for (const r of rows) {
    const m = String(r.pmcid).match(/^PMC(\d+)$/i);
    if (!m) continue;
    targets.set(Number(m[1]), Number(r.pmid));
  }
  return targets;
}

// Fetch the directory listing once, parse all PMC{start}_PMC{end}.xml.gz
// filenames, return as [{url, start, end}, ...].
async function listArchives() {
  const html = await fetchText(ARCHIVE_INDEX_URL);
  const files = [];
  const re = /href="(PMC(\d+)_PMC(\d+)\.xml\.gz)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    files.push({
      filename: m[1],
      url: ARCHIVE_INDEX_URL + m[1],
      start: Number(m[2]),
      end: Number(m[3]),
    });
  }
  return files;
}

// Determine which archives overlap our target set.
// Returns [{archive, targetSubset: Set<number>}, ...] sorted by overlap size desc.
function planArchives(archives, targets) {
  // Sort target ids once, then bisect against each archive range.
  const sortedTargets = [...targets.keys()].sort((a, b) => a - b);

  function rangeCount(arr, lo, hi) {
    // Number of items in arr where lo <= x <= hi.
    let l = 0, r = arr.length;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (arr[m] < lo) l = m + 1;
      else r = m;
    }
    const start = l;
    l = 0; r = arr.length;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (arr[m] <= hi) l = m + 1;
      else r = m;
    }
    return [start, l];
  }

  const plan = [];
  for (const archive of archives) {
    const [lo, hi] = rangeCount(sortedTargets, archive.start, archive.end);
    if (hi <= lo) continue;
    const targetSubset = new Set(sortedTargets.slice(lo, hi));
    plan.push({ archive, targetSubset, count: targetSubset.size });
  }
  return plan.sort((a, b) => b.count - a.count);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} on ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// Streaming Transform: scans the gunzip'd byte stream for <article>...</article>
// boundaries and emits each article XML as a Buffer. Keeps an in-memory rolling
// buffer up to ARTICLE_BUFFER_MAX bytes between writes.
class ArticleSplitter extends Transform {
  constructor(opts) {
    super({ ...opts, readableObjectMode: true });
    this.buf = "";
    this.openIdx = -1;
    this.decoder = new StringDecoder("utf8");
  }
  _transform(chunk, _enc, cb) {
    this.buf += this.decoder.write(chunk);
    if (this.buf.length > ARTICLE_BUFFER_MAX) {
      // Drop everything before the last <article — guard against runaway memory
      // on malformed streams. Practical articles are <2 MB.
      const last = this.buf.lastIndexOf("<article");
      this.buf = last >= 0 ? this.buf.slice(last) : "";
    }
    while (true) {
      if (this.openIdx < 0) {
        const idx = this.buf.indexOf("<article");
        if (idx < 0) break;
        this.openIdx = idx;
      }
      const close = this.buf.indexOf("</article>", this.openIdx);
      if (close < 0) break;
      const end = close + "</article>".length;
      const article = this.buf.slice(this.openIdx, end);
      this.push(article);
      this.buf = this.buf.slice(end);
      this.openIdx = -1;
    }
    cb();
  }
  _flush(cb) {
    this.buf += this.decoder.end();
    cb();
  }
}

// Pull the PMC numeric id out of an article XML chunk.
function extractPmcid(xml) {
  // <article-id pub-id-type="pmcid">PMC13900</article-id>
  const m = xml.match(/<article-id[^>]*pub-id-type="pmcid"[^>]*>(?:PMC)?(\d+)<\/article-id>/i)
    || xml.match(/<article-id[^>]*pub-id-type="pmc"[^>]*>(?:PMC)?(\d+)<\/article-id>/i);
  return m ? Number(m[1]) : null;
}

// Process a single archive end-to-end.
async function processArchive(plan, pg, jsonlOut, stats, args) {
  const { archive, targetSubset } = plan;
  const remaining = new Set(targetSubset);
  let archiveOk = 0, archiveNoBody = 0, archiveShort = 0, articlesScanned = 0;
  const successes = [];
  const noBodyIds = [];
  const shortIds = [];

  await new Promise((resolve, reject) => {
    https.get(archive.url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} on ${archive.url}`));
        res.resume();
        return;
      }
      const splitter = new ArticleSplitter();
      res.pipe(zlib.createGunzip()).pipe(splitter);

      splitter.on("data", (xml) => {
        articlesScanned++;
        const pmcidNum = extractPmcid(xml);
        if (pmcidNum == null || !remaining.has(pmcidNum)) return;
        remaining.delete(pmcidNum);
        const realPmid = stats.targetsByPmcid.get(pmcidNum);

        const parsed = parseJatsFullText(xml);
        if (!parsed || !parsed.text || !parsed.sections?.length) {
          archiveNoBody++; noBodyIds.push(realPmid); return;
        }
        if (parsed.text.length < MIN_BODY_CHARS) {
          archiveShort++; shortIds.push(realPmid); return;
        }
        archiveOk++;
        successes.push({ pmid: realPmid, full_text: parsed.text });

        const chunks = buildBodyChunks({ pmid: realPmid, sections: parsed.sections, provenance: TAG_OK });
        for (const c of chunks) {
          stats.totalChunks++;
          if (!args.dryRun) jsonlOut.write(JSON.stringify(c) + "\n");
        }
      });

      splitter.on("end", resolve);
      splitter.on("error", reject);
      res.on("error", reject);
    }).on("error", reject);
  });

  // Persist this archive's results in a single batch.
  if (!args.dryRun && successes.length) await applyFulltext(pg, successes);
  if (!args.dryRun && noBodyIds.length) await tagRows(pg, noBodyIds, TAG_NO_BODY);
  if (!args.dryRun && shortIds.length) await tagRows(pg, shortIds, TAG_REJECT_SHORT);

  stats.totalOk += archiveOk;
  stats.totalNoBody += archiveNoBody;
  stats.totalShort += archiveShort;
  stats.archivesProcessed++;

  // Anything still in remaining means: we expected this PMCID in this archive
  // but the article wasn't there (rare — versioning gap or filename overlap edge).
  if (remaining.size && !args.dryRun) {
    const stillMissingPmids = [...remaining].map((pmcid) => stats.targetsByPmcid.get(pmcid));
    await tagRows(pg, stillMissingPmids, TAG_NOTFOUND);
    stats.totalNotfound += remaining.size;
  }

  console.log(
    `[phase2h] archive=${archive.filename} target=${targetSubset.size} ` +
    `scanned=${articlesScanned} ok=${archiveOk} no_body=${archiveNoBody} ` +
    `short=${archiveShort} missing=${remaining.size}`
  );
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
  console.log("[phase2h] starting", args);

  fs.mkdirSync(path.dirname(OUTPUT_JSONL), { recursive: true });
  const jsonlOut = fs.createWriteStream(OUTPUT_JSONL, { flags: "a" });

  await withPg(async (pg) => {
    const targetsByPmcid = await loadTargetPmcids(pg, args);
    console.log(`[phase2h] target_pmcids=${targetsByPmcid.size}`);
    if (!targetsByPmcid.size) {
      console.log("[phase2h] nothing to do");
      return;
    }

    const archives = await listArchives();
    console.log(`[phase2h] archive_index_count=${archives.length}`);

    const plan = planArchives(archives, targetsByPmcid);
    const totalCovered = plan.reduce((s, p) => s + p.count, 0);
    console.log(
      `[phase2h] plan archives=${plan.length} covered_pmcids=${totalCovered} ` +
      `uncovered=${targetsByPmcid.size - totalCovered}`
    );

    const truncated = plan.slice(0, args.maxArchives);
    if (truncated.length < plan.length) {
      console.log(`[phase2h] limiting to first ${truncated.length} archives by overlap size`);
    }

    const stats = {
      targetsByPmcid,
      archivesProcessed: 0,
      totalOk: 0, totalNoBody: 0, totalShort: 0, totalNotfound: 0, totalChunks: 0,
    };

    const started = Date.now();
    for (let i = 0; i < truncated.length; i++) {
      const p = truncated[i];
      try {
        await processArchive(p, pg, jsonlOut, stats, args);
      } catch (err) {
        console.error(`[phase2h] archive=${p.archive.filename} FAILED: ${err.message}`);
      }
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(
        `[phase2h] progress ${i + 1}/${truncated.length} ` +
        `ok=${stats.totalOk} no_body=${stats.totalNoBody} short=${stats.totalShort} ` +
        `notfound=${stats.totalNotfound} chunks=${stats.totalChunks} elapsed=${elapsed}s`
      );
    }

    // PMCIDs that the directory listing simply doesn't cover (e.g. our DB has
    // a PMCID that isn't in the OA subset at all). Tag them as notfound.
    // Only do this when processing the FULL plan — under --max-archives we'd
    // misclassify deferred-but-coverable PMCIDs as notfound.
    if (!args.dryRun && truncated.length === plan.length) {
      const covered = new Set();
      for (const p of plan) for (const id of p.targetSubset) covered.add(id);
      const orphans = [...targetsByPmcid.keys()].filter((id) => !covered.has(id));
      if (orphans.length) {
        const orphanPmids = orphans.map((pmcid) => targetsByPmcid.get(pmcid));
        await tagRows(pg, orphanPmids, TAG_NOTFOUND);
        stats.totalNotfound += orphans.length;
        console.log(`[phase2h] tagged_index_orphans=${orphans.length}`);
      }
    }

    console.log(
      `[phase2h] DONE archives=${stats.archivesProcessed} ok=${stats.totalOk} ` +
      `no_body=${stats.totalNoBody} short=${stats.totalShort} ` +
      `notfound=${stats.totalNotfound} chunks=${stats.totalChunks}`
    );
  });

  await new Promise((r) => jsonlOut.end(r));
  await _pool.end();
}

main().catch((err) => { console.error("[phase2h] FAILED:", err); process.exit(1); });
