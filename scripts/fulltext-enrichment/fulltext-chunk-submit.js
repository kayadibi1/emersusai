// scripts/fulltext-enrichment/fulltext-chunk-submit.js
//
// Reads chunks-fulltext-*.jsonl (one chunk per line with pmid, chunk_type,
// content, metadata), builds OpenAI embedding Batch file(s), submits, saves
// state. Subsequent fulltext-chunk-apply.js downloads + inserts.
//
// Usage:
//   node scripts/fulltext-enrichment/fulltext-chunk-submit.js [--force] [--max-rows=N]

import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(moduleDir, "data");
const STATE_FILE = path.join(DATA_DIR, "fulltext-chunk-batch-state.json");
const REQUESTS_PER_BATCH = 50_000;
const EMBED_MODEL = "text-embedding-3-small";

// All JSONL inputs for fulltext chunks; extend as new sources land.
const JSONL_INPUTS = [
  "chunks-fulltext-europepmc.jsonl",       // phase2b — per-paper Europe PMC API (not generated on this branch)
  "chunks-fulltext-grobid.jsonl",          // phase2c — Grobid (not generated on this branch)
  "chunks-phase2h-pmc-s3.filtered.jsonl",  // phase2h — PMC OA S3 bulk + Stage 1 regex filter (3.0M chunks)
];

function parseArgs(argv) {
  const a = { maxRows: Infinity, force: false };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--max-rows") a.maxRows = Number(v) || Infinity;
    else if (k === "--force") a.force = true;
  }
  return a;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const args = parseArgs(process.argv.slice(2));

  if (fs.existsSync(STATE_FILE) && !args.force) {
    const existing = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    throw new Error(
      `state file exists: ${STATE_FILE} (${existing.shards.length} shards). ` +
      `Run fulltext-chunk-apply.js after batches complete, or pass --force to re-submit.`
    );
  }

  // True streaming pipeline — never load all chunks into memory. Reads each
  // input JSONL line-by-line, dedupes via content-stable key, writes one batch
  // request per chunk into the current shard file. Rotates shard files at
  // REQUESTS_PER_BATCH. Memory bounded by the dedup Set (~150 MB for 3M keys).
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const chunksPath = path.join(DATA_DIR, "fulltext-chunk-batch-chunks.jsonl");
  const chunksStream = fs.createWriteStream(chunksPath);

  const seen = new Set();
  const shardFiles = [];        // [{ path, count, stream }]
  let currentShard = null;
  let totalChunks = 0;

  function rotateShard() {
    if (currentShard) currentShard.stream.end();
    const idx = shardFiles.length;
    const filePath = path.join(DATA_DIR, `fulltext-chunk-batch-${String(idx).padStart(2, "0")}.jsonl`);
    const stream = fs.createWriteStream(filePath);
    currentShard = { path: filePath, count: 0, stream };
    shardFiles.push(currentShard);
  }

  rotateShard();

  for (const basename of JSONL_INPUTS) {
    const file = path.join(DATA_DIR, basename);
    if (!fs.existsSync(file)) continue;
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (totalChunks >= args.maxRows) break;
      if (!line) continue;
      let c;
      try { c = JSON.parse(line); } catch { continue; }

      const key = `${c.pmid}:${c.metadata?.slot ?? c.metadata?.section_index ?? "?"}:${c.chunk_type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (currentShard.count >= REQUESTS_PER_BATCH) rotateShard();

      const cid = `ftck-${c.pmid}-${c.metadata?.slot ?? c.metadata?.section_index ?? "?"}-${c.chunk_type}`;
      const request = {
        custom_id: cid,
        method: "POST",
        url: "/v1/embeddings",
        body: { model: EMBED_MODEL, input: c.content, encoding_format: "float" },
      };
      currentShard.stream.write(JSON.stringify(request) + "\n");
      chunksStream.write(JSON.stringify(c) + "\n");
      currentShard.count++;
      totalChunks++;

      if (totalChunks % 100000 === 0) {
        console.log(`[fulltext-chunk-submit] streamed ${totalChunks} chunks across ${shardFiles.length} shard(s)`);
      }
    }
    if (totalChunks >= args.maxRows) break;
  }

  if (currentShard) await new Promise((r) => currentShard.stream.end(r));
  await new Promise((r) => chunksStream.end(r));

  console.log(`[fulltext-chunk-submit] ${totalChunks} unique chunks across ${shardFiles.length} shard file(s)`);
  if (!totalChunks) { console.log("[fulltext-chunk-submit] nothing to submit"); return; }

  // Submit each shard to OpenAI Batch API.
  const client = new OpenAI();
  const shards = [];
  for (let idx = 0; idx < shardFiles.length; idx++) {
    const sf = shardFiles[idx];
    const size = fs.statSync(sf.path).size;
    console.log(`[fulltext-chunk-submit] shard ${idx}: ${sf.count} req, ${(size / 1024 / 1024).toFixed(1)} MB`);

    const file = await client.files.create({ file: fs.createReadStream(sf.path), purpose: "batch" });
    const batch = await client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/embeddings",
      completion_window: "24h",
      metadata: { purpose: "fulltext_chunk_embed", shard: String(idx) },
    });
    console.log(`[fulltext-chunk-submit] shard ${idx}: file=${file.id} batch=${batch.id} status=${batch.status}`);
    shards.push({ shard: idx, input_file_id: file.id, batch_id: batch.id, jsonl_path: sf.path, request_count: sf.count });
  }

  const state = {
    created_at: new Date().toISOString(),
    model: EMBED_MODEL,
    total_chunks: totalChunks,
    chunks_jsonl: chunksPath,
    shards,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[fulltext-chunk-submit] state saved to ${STATE_FILE}`);
  console.log(`[fulltext-chunk-submit] next: node scripts/fulltext-enrichment/fulltext-chunk-apply.js (once batches complete)`);
}

main().catch((err) => { console.error("[fulltext-chunk-submit] FAILED:", err); process.exit(1); });
