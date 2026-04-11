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
import { spawn } from "node:child_process";
import { supabaseAdmin } from "../api/lib/clients.js";
import {
  buildSemanticScholarBatchUrl,
  buildSemanticScholarBatchBody,
  parseSemanticScholarResponse,
} from "./lib/semantic-scholar.js";

const DEFAULT_BATCH_SIZE = 500;   // S2 API cap
const DEFAULT_PAUSE_MS = 3500;    // stay under free-tier rate limit
const RETRY_DELAY_MS = 10000;     // longer backoff than iCite because 429s
const REQUEST_TIMEOUT_MS = 25000; // abort fetches that hang silently
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

// Sentinel: a non-fatal 400 from Semantic Scholar. Some batches
// include a PMID that their API rejects (reason unclear — possibly
// malformed external ID, possibly a paper their pipeline failed to
// index). We surface this as a SKIP instead of dying so the backfill
// can make progress on the rest of the corpus.
class SemanticScholarBatchSkip extends Error {
  constructor(message) {
    super(message);
    this.name = "SemanticScholarBatchSkip";
  }
}

// POST to Semantic Scholar via curl instead of Node's native fetch.
// Why: Node's fetch hangs indefinitely on this specific endpoint —
// likely HTTP/2 multiplexing against Cloudflare combined with a
// silently-dropped connection. AbortController + timeout didn't
// rescue it (the abort signal was never honored). curl has its
// own --max-time enforcement and returns quickly with the same
// endpoint + headers. Same script, reliable transport.
function curlSemanticScholarBatch(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      "-s",                                    // silent
      "-o", "-",                               // body to stdout
      "-w", "\\n%{http_code}",                 // append status code on new line
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", "User-Agent: emersus-backfill/1.0 (+https://emersus.ai)",
      "--data-binary", "@-",                   // body from stdin
      url,
    ];
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      // Last line of stdout is the status code (from -w).
      const newlineIdx = stdout.lastIndexOf("\n");
      const statusLine = newlineIdx >= 0 ? stdout.slice(newlineIdx + 1) : "";
      const bodyText = newlineIdx >= 0 ? stdout.slice(0, newlineIdx) : stdout;
      const status = Number(statusLine.trim()) || 0;
      resolve({ status, bodyText });
    });
    child.stdin.write(body);
    child.stdin.end();
  });
}

async function fetchSemanticScholarWithRetry(pmids) {
  const url = buildSemanticScholarBatchUrl();
  const body = JSON.stringify(buildSemanticScholarBatchBody(pmids));
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, bodyText } = await curlSemanticScholarBatch(
        url,
        body,
        REQUEST_TIMEOUT_MS
      );
      if (status === 429) {
        console.warn(
          `[s2-backfill] HTTP 429 on attempt ${attempt}/${MAX_RETRIES}, sleeping ${RETRY_DELAY_MS * attempt}ms`
        );
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (status === 400) {
        throw new SemanticScholarBatchSkip(
          `Semantic Scholar HTTP 400 on batch of ${pmids.length} PMIDs; skipping.`
        );
      }
      if (status < 200 || status >= 300) {
        throw new Error(
          `Semantic Scholar HTTP ${status}: ${bodyText.slice(0, 200)}`
        );
      }
      return JSON.parse(bodyText);
    } catch (err) {
      if (err instanceof SemanticScholarBatchSkip) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError || new Error("Semantic Scholar: retries exhausted");
}

async function fetchNextPmidPage(cursor, limit) {
  // Gate on s2_checked_at IS NULL — a dedicated "we tried" timestamp
  // that covers both (a) successful updates with real data and (b)
  // PMIDs that S2 returned nothing for OR 400'd on a batch containing
  // them. This is the only selector that converges: a cursor run
  // strictly reduces the eligible set, regardless of whether S2 has
  // data for a given PMID or not.
  let query = supabaseAdmin
    .from("pubmed_articles")
    .select("pmid")
    .is("s2_checked_at", null)
    .order("pmid", { ascending: true })
    .limit(limit);
  if (cursor != null) query = query.gt("pmid", cursor);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase select failed: ${error.message}`);
  return data || [];
}

async function markChecked(pmids) {
  if (!pmids || pmids.length === 0) return 0;
  const { data, error } = await supabaseAdmin.rpc(
    "mark_pubmed_s2_checked",
    { pmid_list: pmids }
  );
  if (error) {
    throw new Error(`mark_pubmed_s2_checked failed: ${error.message}`);
  }
  return data || 0;
}

// Process a batch of PMIDs with recursive bisect on HTTP 400.
// Returns { updates: [{pmid, citation_count, influential_citation_count}],
//           dead: [pmid, ...] } — the caller updates the live ones
// and marks the dead ones as checked (failed) so they stop appearing
// in future runs. If ANY non-skip error propagates up, it's fatal —
// only permanent bad-batch 400s are bisected-and-dropped.
async function processBatchWithBisect(pmids) {
  try {
    const body = await fetchSemanticScholarWithRetry(pmids);
    const updates = parseSemanticScholarResponse(body);
    return { updates, dead: [] };
  } catch (err) {
    if (!(err instanceof SemanticScholarBatchSkip)) throw err;
    // Can't narrow further — mark this single PMID as checked-but-no-data.
    if (pmids.length === 1) {
      return { updates: [], dead: [pmids[0]] };
    }
    const mid = Math.floor(pmids.length / 2);
    const left = await processBatchWithBisect(pmids.slice(0, mid));
    const right = await processBatchWithBisect(pmids.slice(mid));
    return {
      updates: [...left.updates, ...right.updates],
      dead: [...left.dead, ...right.dead],
    };
  }
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
  let totalUnmatched = 0; // PMIDs S2 omitted from an otherwise-successful batch
  let totalDead = 0;       // PMIDs that bisected down to a permanent 400
  const startedAt = Date.now();

  while (batchNum < args.maxBatches) {
    const stepStart = Date.now();
    console.log(`[s2-backfill] step: fetchNextPmidPage cursor=${cursor}`);
    const page = await fetchNextPmidPage(cursor, args.batchSize);
    console.log(`[s2-backfill] step: fetchNextPmidPage returned ${page.length} rows in ${Date.now() - stepStart}ms`);
    if (page.length === 0) {
      console.log("[s2-backfill] no more rows with s2_checked_at IS NULL; done");
      break;
    }

    const pmids = page.map((row) => row.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalSeen += pmids.length;

    console.log(`[s2-backfill] step: calling S2 API with ${pmids.length} pmids`);
    const apiStart = Date.now();
    const { updates, dead } = await processBatchWithBisect(pmids);
    console.log(`[s2-backfill] step: S2 API returned ${updates.length} updates, ${dead.length} dead in ${Date.now() - apiStart}ms`);

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

    // Stamp any PMID that was in the batch but NOT in the returned
    // updates (either S2 omitted it, or it bisected down to a
    // permanent 400). These rows are now "checked" and won't be
    // re-selected on future runs.
    const matchedPmids = new Set(updates.map((u) => u.pmid));
    const unmatched = pmids.filter((p) => !matchedPmids.has(p) && !dead.includes(p));
    const toMark = [...unmatched, ...dead];
    if (toMark.length > 0) {
      await markChecked(toMark);
      totalUnmatched += unmatched.length;
      totalDead += dead.length;
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[s2-backfill] batch=${batchNum} seen=${totalSeen} updated=${totalUpdated} unmatched=${totalUnmatched} dead=${totalDead} elapsed=${elapsedSec}s last_pmid=${cursor}`
    );

    await sleep(args.pauseMs);
  }

  console.log(
    `[s2-backfill] finished. seen=${totalSeen} updated=${totalUpdated} unmatched=${totalUnmatched} dead=${totalDead}`
  );
}

main().catch((err) => {
  console.error(`[s2-backfill] FAILED:`, err);
  process.exit(1);
});
