// Populate pubmed_articles.citation_count and influential_citation_count
// from the Semantic Scholar Graph API.
//
// Idempotent: selects rows where citation_count = 0 (the default,
// meaning "never backfilled") and updates them. Re-running is safe —
// already-backfilled rows won't be reselected.
//
// Usage:
//   node scripts/backfill-semantic-scholar.js                # full backfill
//   node scripts/backfill-semantic-scholar.js --max-batches=2 # smoke test
//   node scripts/backfill-semantic-scholar.js --batch-size=200 --pause-ms=5000
//
// Rate limits: free tier is ~100 req / 5 min (no API key). Default
// pause is 3.5s between requests, which stays well within that
// budget and leaves headroom for retries on 429.

import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";
import {
  buildSemanticScholarBatchUrl,
  buildSemanticScholarBatchBody,
  parseSemanticScholarResponse,
} from "./lib/semantic-scholar.js";

const DEFAULT_BATCH_SIZE = 500;   // S2 API cap
const DEFAULT_PAUSE_MS = 3500;    // stay under free-tier rate limit
const RETRY_DELAY_MS = 10000;     // longer backoff than iCite because 429s
const MAX_RETRIES = 4;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSemanticScholarWithRetry(pmids) {
  const url = buildSemanticScholarBatchUrl();
  const body = JSON.stringify(buildSemanticScholarBatchBody(pmids));
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body,
      });
      if (response.status === 429) {
        // Rate limited — wait longer and try again.
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Semantic Scholar HTTP ${response.status} ${response.statusText}`
        );
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError || new Error("Semantic Scholar: retries exhausted");
}

async function fetchNextPmidPage(cursor, limit) {
  // Gate on influential_citation_count IS NULL as the "never
  // backfilled" marker. citation_count has a DEFAULT 0, so papers that
  // S2 processed-and-returned-zero become indistinguishable from
  // never-processed — using that column as the gate makes the resume
  // redundantly re-process tens of thousands of already-done papers.
  // influential_citation_count has NO default, so NULL reliably
  // means "no successful S2 response has landed here yet".
  let query = supabaseAdmin
    .from("pubmed_articles")
    .select("pmid")
    .is("influential_citation_count", null)
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
    `[s2-backfill] batch_size=${args.batchSize} pause_ms=${args.pauseMs} max_batches=${args.maxBatches}`
  );

  let cursor = null;
  let batchNum = 0;
  let totalSeen = 0;
  let totalUpdated = 0;
  const startedAt = Date.now();

  while (batchNum < args.maxBatches) {
    const page = await fetchNextPmidPage(cursor, args.batchSize);
    if (page.length === 0) {
      console.log("[s2-backfill] no more rows with citation_count = 0; done");
      break;
    }

    const pmids = page.map((row) => row.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalSeen += pmids.length;

    const body = await fetchSemanticScholarWithRetry(pmids);
    const updates = parseSemanticScholarResponse(body);

    if (updates.length > 0) {
      const { data, error } = await supabaseAdmin.rpc(
        "update_pubmed_citations_batch",
        { updates }
      );
      if (error) {
        throw new Error(
          `update_pubmed_citations_batch failed: ${error.message}`
        );
      }
      totalUpdated += data || 0;
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[s2-backfill] batch=${batchNum} seen=${totalSeen} updated=${totalUpdated} elapsed=${elapsedSec}s last_pmid=${cursor}`
    );

    await sleep(args.pauseMs);
  }

  console.log(
    `[s2-backfill] finished. total_seen=${totalSeen} total_updated=${totalUpdated}`
  );
}

main().catch((err) => {
  console.error(`[s2-backfill] FAILED:`, err);
  process.exit(1);
});
