// scripts/fulltext-enrichment/phase2h-eupmc-notfound.js
//
// Move 5 from the prior-art research: re-attempt the 11K papers tagged
// `phase2h_pmc_s3_notfound` via Europe PMC's per-paper REST API instead of
// the AWS PMC OA bucket. Different mirror sometimes has:
//   - Author manuscripts (NIH-deposited, not in commercial OA bucket)
//   - Version variants beyond .1/.2/.3
//   - Recently-added papers post the AWS snapshot date
// Expected yield: 40-60% of 11,374 = ~5-7K more full texts.
//
// API: GET https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/{pmcid}/fullTextXML
// Returns JATS XML (200) or 404. Polite at 5 rps per Europe PMC etiquette.
//
// Pipeline:
//   target rows → fetch JATS → parseJatsFullText → buildBodyChunks
//   → JSONL append + DB UPDATE batch
//
// Tag map:
//   phase2h_eupmc_jats              — success
//   phase2h_eupmc_no_body           — XML returned but no usable body
//   phase2h_eupmc_rejected_short    — body <1000 chars
//   phase2h_eupmc_still_notfound    — 404 (truly not in any mirror)
//
// Eligibility: content_source = 'phase2h_pmc_s3_notfound'
// Output: data/chunks-phase2h-eupmc-notfound.jsonl
//
// Usage (Hetzner):
//   nohup node scripts/fulltext-enrichment/phase2h-eupmc-notfound.js \
//     > ~/phase2h-eupmc-notfound.log 2>&1 &

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import pg from "pg";
import { parseJatsFullText } from "./lib/jats-parser.js";
import { buildBodyChunks } from "./lib/fulltext-chunker.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSONL = path.join(moduleDir, "data", "chunks-phase2h-eupmc-notfound.jsonl");
const API_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const UA = "Mozilla/5.0 (compatible; emersus/1.0; +https://emersus.ai info@emersus.ai)";

const TAG_OK = "phase2h_eupmc_jats";
const TAG_NO_BODY = "phase2h_eupmc_no_body";
const TAG_REJECT_SHORT = "phase2h_eupmc_rejected_short";
const TAG_NOTFOUND = "phase2h_eupmc_still_notfound";

const MIN_BODY_CHARS = 1000;
const RPS = 5;                    // Europe PMC etiquette
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
    `SELECT pmid, pmcid FROM research_articles
       WHERE content_source = 'phase2h_pmc_s3_notfound'
         AND pmcid IS NOT NULL AND pmcid != ''
       ORDER BY pmid
       LIMIT $1`,
    [limit]
  );
  return rows
    .map((r) => {
      const m = String(r.pmcid).match(/^(?:PMC)?(\d+)$/i);
      if (!m) return null;
      return { pmid: Number(r.pmid), pmcidStr: `PMC${m[1]}` };
    })
    .filter(Boolean);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": UA }, agent: httpsAgent, timeout: REQUEST_TIMEOUT_MS }, (res) => {
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

async function fetchEupmc(pmcidStr) {
  const url = `${API_BASE}/PMC/${pmcidStr}/fullTextXML`;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const r = await fetchUrl(url);
      if (r.status === 200 && r.body) return { xml: r.body };
      if (r.status === 404) return null;
      // 5xx / other: backoff and retry
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    } catch (err) {
      if (attempt === MAX_TRANSIENT_RETRIES) return null;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
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
  console.log("[phase2h-eupmc-notfound] starting", args);

  fs.mkdirSync(path.dirname(OUTPUT_JSONL), { recursive: true });
  const jsonlOut = fs.createWriteStream(OUTPUT_JSONL, { flags: "a" });

  const targets = await loadTargets(_pool, args);
  console.log(`[phase2h-eupmc-notfound] target_rows=${targets.length}`);
  if (!targets.length) {
    console.log("[phase2h-eupmc-notfound] nothing to do");
    await new Promise((r) => jsonlOut.end(r));
    await _pool.end();
    return;
  }

  const stats = { processed: 0, ok: 0, notfound: 0, no_body: 0, short: 0, errors: 0, chunks: 0 };
  const successes = [];
  const noBodyIds = [];
  const shortIds = [];
  const notfoundIds = [];

  async function flush() {
    if (args.dryRun) {
      successes.length = 0; noBodyIds.length = 0; shortIds.length = 0; notfoundIds.length = 0;
      return;
    }
    if (successes.length) await applyFulltext(_pool, successes.splice(0));
    if (noBodyIds.length) await tagRows(_pool, noBodyIds.splice(0), TAG_NO_BODY);
    if (shortIds.length) await tagRows(_pool, shortIds.splice(0), TAG_REJECT_SHORT);
    if (notfoundIds.length) await tagRows(_pool, notfoundIds.splice(0), TAG_NOTFOUND);
  }

  // Sequential per-paper at 5 rps (Europe PMC etiquette).
  // 200ms gap between requests at 5 rps.
  const startedAt = Date.now();
  let lastLog = startedAt;
  const minIntervalMs = 1000 / RPS;
  let lastReqAt = 0;

  for (const t of targets) {
    const wait = Math.max(0, lastReqAt + minIntervalMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReqAt = Date.now();

    let result;
    try {
      result = await fetchEupmc(t.pmcidStr);
    } catch (err) {
      stats.errors++;
      stats.processed++;
      continue;
    }

    if (!result) {
      stats.notfound++;
      notfoundIds.push(t.pmid);
    } else {
      const parsed = parseJatsFullText(result.xml);
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

    stats.processed++;

    if (
      successes.length >= DB_FLUSH_EVERY ||
      noBodyIds.length >= DB_FLUSH_EVERY ||
      shortIds.length >= DB_FLUSH_EVERY ||
      notfoundIds.length >= DB_FLUSH_EVERY
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
        `[phase2h-eupmc-notfound] progress ${stats.processed}/${targets.length} ` +
        `ok=${stats.ok} notfound=${stats.notfound} no_body=${stats.no_body} short=${stats.short} ` +
        `errors=${stats.errors} chunks=${stats.chunks} ` +
        `rate=${rate.toFixed(1)}/s elapsed=${elapsed}s eta=${etaSec}s`
      );
    }
  }

  await flush();
  await new Promise((r) => jsonlOut.end(r));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[phase2h-eupmc-notfound] DONE processed=${stats.processed} ok=${stats.ok} ` +
    `notfound=${stats.notfound} no_body=${stats.no_body} short=${stats.short} ` +
    `errors=${stats.errors} chunks=${stats.chunks} elapsed=${elapsed}s`
  );

  await _pool.end();
}

main().catch((err) => { console.error("[phase2h-eupmc-notfound] FAILED:", err); process.exit(1); });
