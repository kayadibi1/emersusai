// Rechunk pubmed_articles with structured abstracts into per-section
// evidence_chunks.
//
// Why: the initial ingest stores the whole abstract as a single
// chunk_type='abstract' chunk (possibly split by length into 1200-char
// sub-chunks). For papers with structured abstracts (BACKGROUND /
// METHODS / RESULTS / CONCLUSIONS labels), this mixes results text
// with methods boilerplate, hurting retrieval quality — a query like
// "does creatine improve strength" wants to match the RESULTS section,
// not the METHODS.
//
// This script:
//   1. Selects rows WHERE abstract_sections IS NOT NULL
//                  AND chunks_sectioned_at IS NULL
//   2. For each paper, turns abstract_sections into per-section chunks
//      via sectionsToChunks() (pure helper, separately unit-tested)
//   3. Calls rechunk_abstract_sections_batch RPC to atomically delete
//      old generic chunks, insert new ones, and stamp chunks_sectioned_at
//   4. New chunks land with embedding NULL — scripts/embed-evidence.js
//      picks them up in a subsequent run.
//
// Usage:
//   node scripts/chunk-structured-abstracts.js                # full run
//   node scripts/chunk-structured-abstracts.js --max-batches=2 # smoke
//   node scripts/chunk-structured-abstracts.js --batch-size=100
//
// Resumable — chunks_sectioned_at gets stamped on successful RPC, so
// interrupting mid-run and re-running picks up exactly where it left off.
// Safe to run concurrently with reparse-pubmed-enrichment.js: the
// reparse UPDATEs different columns (abstract_sections, is_retracted,
// etc.) and they don't conflict.

import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";
import { sectionsToChunks } from "./lib/abstract-sections-chunks.js";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_PAUSE_MS = 100;
const DEFAULT_CHUNK_LENGTH = 1200;

function parseArgs(argv) {
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    pauseMs: DEFAULT_PAUSE_MS,
    chunkLength: DEFAULT_CHUNK_LENGTH,
    maxBatches: Infinity,
  };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--batch-size") args.batchSize = Number(value) || DEFAULT_BATCH_SIZE;
    else if (key === "--pause-ms") args.pauseMs = Number(value) || DEFAULT_PAUSE_MS;
    else if (key === "--chunk-length") args.chunkLength = Number(value) || DEFAULT_CHUNK_LENGTH;
    else if (key === "--max-batches") args.maxBatches = Number(value) || Infinity;
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNextPage(cursor, limit) {
  let query = supabaseAdmin
    .from("pubmed_articles")
    .select("pmid,abstract_sections")
    .not("abstract_sections", "is", null)
    .is("chunks_sectioned_at", null)
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
    `[chunk-sections] batch_size=${args.batchSize} chunk_length=${args.chunkLength} max_batches=${args.maxBatches}`
  );

  let cursor = null;
  let batchNum = 0;
  let totalPapers = 0;
  let totalChunks = 0;
  let totalStamped = 0;
  let totalSkipped = 0;
  const startedAt = Date.now();

  while (batchNum < args.maxBatches) {
    const page = await fetchNextPage(cursor, args.batchSize);
    if (page.length === 0) {
      console.log("[chunk-sections] no more papers pending; done");
      break;
    }

    cursor = page[page.length - 1].pmid;
    batchNum++;
    totalPapers += page.length;

    // Build the RPC payload for papers that actually yield chunks.
    // A paper with abstract_sections={} or sections that are all
    // whitespace will yield 0 chunks — we still want to stamp it so
    // it's not retried forever, but the RPC handles that by CONTINUE-ing
    // on missing 'chunks' and doing just the UPDATE.
    const updates = [];
    for (const row of page) {
      const chunks = sectionsToChunks(row.abstract_sections, args.chunkLength);
      if (chunks.length === 0) {
        totalSkipped++;
      }
      totalChunks += chunks.length;
      updates.push({ pmid: row.pmid, chunks });
    }

    const { data: stamped, error } = await supabaseAdmin.rpc(
      "rechunk_abstract_sections_batch",
      { updates }
    );
    if (error) {
      throw new Error(`rechunk_abstract_sections_batch failed: ${error.message}`);
    }
    totalStamped += stamped || 0;

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[chunk-sections] batch=${batchNum} papers=${totalPapers} chunks=${totalChunks} stamped=${totalStamped} empty=${totalSkipped} elapsed=${elapsedSec}s last_pmid=${cursor}`
    );

    await sleep(args.pauseMs);
  }

  console.log(
    `[chunk-sections] finished. papers=${totalPapers} chunks_inserted=${totalChunks} papers_stamped=${totalStamped}`
  );
}

main().catch((err) => {
  console.error("[chunk-sections] FAILED:", err);
  process.exit(1);
});
