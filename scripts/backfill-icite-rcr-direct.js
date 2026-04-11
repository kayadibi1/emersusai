// Populate research_articles.rcr from the NIH iCite API.
//
// Idempotent: only processes rows where rcr IS NULL, so re-running is
// safe and cheap. Paginates by PMID to avoid loading all 200k+ rows
// into memory.
//
// Usage:
//   node scripts/backfill-icite-rcr.js                # full backfill
//   node scripts/backfill-icite-rcr.js --max-batches=5 # quick smoke test
//   node scripts/backfill-icite-rcr.js --batch-size=500 # tune per-call size
//
// Rate limits: iCite is generous — ~10 req/sec is fine. We insert a
// short pause between batches to be polite and leave headroom for
// transient slowdowns.

// Load env from .env BEFORE importing clients.js, because clients.js's
// loadLocalEnv() only checks .env.local (which doesn't exist in ~/app
// on Hetzner — prod uses ~/app/.env, see reference_hetzner_env_file).
import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";
import { buildIciteUrl, parseIciteResponse } from "./lib/icite.js";

// iCite documents a 1000-PMID cap but its infra returns HTTP 413 well
// before that — the URL length limit bites first. 200 per request fits
// comfortably and is still fast enough to finish a 200k-row backfill
// in ~10 minutes at DEFAULT_PAUSE_MS.
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_PAUSE_MS = 300;      // between HTTP calls
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function parseArgs(argv) {
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    pauseMs: DEFAULT_PAUSE_MS,
    maxBatches: Infinity,
  };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--batch-size") args.batchSize = Number(value) || DEFAULT_BATCH_SIZE;
    else if (key === "--pause-ms") args.pauseMs = Number(value) || DEFAULT_PAUSE_MS;
    else if (key === "--max-batches") args.maxBatches = Number(value) || Infinity;
  }
  return args;
}

async function fetchIciteWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`iCite HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNextPmidPage(cursor, limit) {
  let query = supabaseAdmin
    .from("research_articles")
    .select("pmid")
    .is("rcr", null)
    .order("pmid", { ascending: true })
    .limit(limit);
  if (cursor != null) query = query.gt("pmid", cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase select failed: ${error.message}`);
  return data || [];
}

async function main() {
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[icite-backfill] batch_size=${args.batchSize} pause_ms=${args.pauseMs} max_batches=${args.maxBatches}`
  );

  let cursor = null;
  let batchNum = 0;
  let totalSeen = 0;
  let totalUpdated = 0;
  const startedAt = Date.now();

  while (batchNum < args.maxBatches) {
    const page = await fetchNextPmidPage(cursor, args.batchSize);
    if (page.length === 0) {
      console.log("[icite-backfill] no more rows with rcr IS NULL; done");
      break;
    }

    const pmids = page.map((row) => row.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalSeen += pmids.length;

    const url = buildIciteUrl(pmids);
    const body = await fetchIciteWithRetry(url);
    const updates = parseIciteResponse(body);

    if (updates.length > 0) {
      const { data, error } = await supabaseAdmin.rpc(
        "update_pubmed_rcr_batch",
        { updates }
      );
      if (error) {
        throw new Error(`update_pubmed_rcr_batch failed: ${error.message}`);
      }
      totalUpdated += data || 0;
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[icite-backfill] batch=${batchNum} seen=${totalSeen} updated=${totalUpdated} elapsed=${elapsedSec}s last_pmid=${cursor}`
    );

    await sleep(args.pauseMs);
  }

  console.log(
    `[icite-backfill] finished. total_seen=${totalSeen} total_updated=${totalUpdated}`
  );
}

// Export main so the wrapper (backfill-icite-rcr.js --direct) can call it.
export { main };

// Auto-run when invoked directly (node scripts/backfill-icite-rcr-direct.js).
// Skipped on import so the wrapper can import without triggering a run.
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((err) => {
    console.error(`[icite-backfill] FAILED:`, err);
    process.exit(1);
  });
}
