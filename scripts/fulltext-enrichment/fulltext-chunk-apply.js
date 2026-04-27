// scripts/fulltext-enrichment/fulltext-chunk-apply.js
//
// Downloads OpenAI Batch /v1/embeddings outputs from fulltext-chunk-submit.js,
// joins them to the original chunks via custom_id, INSERTs evidence_chunks
// rows with `embedding` populated.
//
// Per-shard streaming so memory stays bounded: peak ~350 MB regardless of
// total chunk count. The chunks-batch-chunks.jsonl is written sequentially
// across shards in submit, so we read it in lockstep — shard N consumes
// exactly state.shards[N].request_count lines.
//
// Resume-safe: processes only `completed` batches; skips `in_progress` /
// `validating` ones with a warning. ON CONFLICT DO NOTHING at the INSERT
// makes re-runs idempotent.
//
// Usage:
//   node scripts/fulltext-enrichment/fulltext-chunk-apply.js \
//     [--state=PATH] [--throttle-ms=N] [--insert-batch=N] [--dry-run]

import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import pg from "pg";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(moduleDir, "data");
const DEFAULT_STATE = path.join(DATA_DIR, "fulltext-chunk-batch-state.json");

// Inline withPg + toPgVector — matches phase2h-pmc-s3.js / phase2f-sweep.js
// pattern. Avoids the gitignored ../abstract-enrichment/lib/pg.js re-export.
const _pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
});

function toPgVector(arr) {
  if (!Array.isArray(arr)) return null;
  return `[${arr.join(",")}]`;
}

function parseArgs(argv) {
  const a = { state: DEFAULT_STATE, dryRun: false, throttleMs: 0, insertBatch: 500 };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--state") a.state = v;
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--throttle-ms") a.throttleMs = Number(v) || 0;
    else if (k === "--insert-batch") a.insertBatch = Number(v) || 500;
  }
  return a;
}

async function downloadOutput(client, fileId, destPath) {
  const res = await client.files.content(fileId);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}

function buildCustomId(c) {
  // Must match the cid built in fulltext-chunk-submit.js:
  //   ftck-<pmid>-<slot|section_index|?>-<chunk_type>
  const slot = c.metadata?.slot ?? c.metadata?.section_index ?? "?";
  return `ftck-${c.pmid}-${slot}-${c.chunk_type}`;
}

function parseOutputLine(line) {
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  const cid = e.custom_id;
  if (!cid) return null;
  if (e.error || e.response?.status_code !== 200) return { cid, error: e.error || e.response?.body };
  const emb = e.response?.body?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length !== 1536) return { cid, error: "bad_embedding" };
  return { cid, embedding: emb };
}

async function insertWithEmbeddings(pg, rows) {
  if (!rows.length) return 0;
  const pmids = rows.map((r) => r.pmid);
  const types = rows.map((r) => r.chunk_type);
  const contents = rows.map((r) => r.content);
  const metas = rows.map((r) => JSON.stringify(r.metadata ?? {}));
  const embs = rows.map((r) => toPgVector(r.embedding));
  const res = await pg.query(
    `INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata, embedding)
     SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::jsonb[], $5::vector[])
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [pmids, types, contents, metas, embs]
  );
  return res.rowCount ?? 0;
}

// Loads one shard's output JSONL into Map<cid, embedding>.
// Memory ~50K × 6 KB ≈ 300 MB peak per shard — fits comfortably.
async function loadShardEmbeddings(outPath) {
  const map = new Map();
  let errors = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(outPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const parsed = parseOutputLine(line);
    if (!parsed) continue;
    if (parsed.error) { errors++; continue; }
    map.set(parsed.cid, parsed.embedding);
  }
  return { map, errors };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(fs.readFileSync(args.state, "utf8"));
  console.log(`[apply] ${state.shards.length} shard(s), total_chunks=${state.total_chunks}`);

  const client = new OpenAI();

  // Refresh batch statuses up front so we know which to process.
  const statuses = await Promise.all(state.shards.map((s) => client.batches.retrieve(s.batch_id)));
  const completedShards = [];
  let pending = 0, failed = 0;
  for (let i = 0; i < statuses.length; i++) {
    const b = statuses[i]; const s = state.shards[i];
    const done = b.request_counts?.completed ?? 0;
    const total = b.request_counts?.total ?? 0;
    console.log(`[apply] shard ${s.shard}: status=${b.status} ${done}/${total}`);
    if (b.status === "completed" && b.output_file_id) {
      completedShards.push({ shard: s, batch: b });
    } else if (["failed", "expired", "cancelled"].includes(b.status)) {
      failed++;
    } else {
      pending++;
    }
  }
  console.log(`[apply] ready=${completedShards.length} pending=${pending} failed=${failed}`);
  if (!completedShards.length) {
    console.log("[apply] no completed shards yet — re-run later");
    await _pool.end();
    return;
  }

  // Open chunks-batch-chunks.jsonl ONCE. It contains chunks in submit-order:
  // shard 0's chunks first, then shard 1's, etc. We advance through it in
  // lockstep with shards, consuming exactly `request_count` lines per shard.
  // This is why we MUST process shards in submit-order even if some are
  // pending — pending shards still consume their chunks in the stream.
  const chunksRl = readline.createInterface({
    input: fs.createReadStream(state.chunks_jsonl, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const chunksIter = chunksRl[Symbol.asyncIterator]();

  let totalJoined = 0, totalInserted = 0, totalErrors = 0, totalSkippedPending = 0;
  const touchedPmids = new Set();
  const throttle = () => args.throttleMs > 0 ? new Promise((r) => setTimeout(r, args.throttleMs)) : Promise.resolve();

  for (let i = 0; i < state.shards.length; i++) {
    const s = state.shards[i];
    const b = statuses[i];
    const isCompleted = b.status === "completed" && b.output_file_id;

    // Always advance the chunks stream by request_count to maintain alignment.
    // For completed shards, build the embedding map and join+insert.
    // For pending/failed shards, just discard the chunks (they'll be re-applied
    // on a later run when those shards complete).

    if (isCompleted) {
      const outPath = path.join(DATA_DIR, `fulltext-chunk-batch-${String(s.shard).padStart(2, "0")}.out.jsonl`);
      if (!fs.existsSync(outPath)) {
        console.log(`[apply] shard ${s.shard}: downloading output`);
        await downloadOutput(client, b.output_file_id, outPath);
      }
      console.log(`[apply] shard ${s.shard}: loading embeddings`);
      const { map: embMap, errors: parseErrors } = await loadShardEmbeddings(outPath);
      console.log(`[apply] shard ${s.shard}: ${embMap.size} embeddings loaded (${parseErrors} parse errors)`);

      // Stream this shard's chunks, join, insert in batches.
      let buffer = [];
      let shardJoined = 0, shardErrors = parseErrors;
      for (let n = 0; n < s.request_count; n++) {
        const { value: line, done } = await chunksIter.next();
        if (done) break;
        if (!line) { n--; continue; }  // skip blank lines without consuming the count
        let c;
        try { c = JSON.parse(line); } catch { shardErrors++; continue; }
        const cid = buildCustomId(c);
        const emb = embMap.get(cid);
        if (!emb) { shardErrors++; continue; }
        shardJoined++;
        touchedPmids.add(c.pmid);
        buffer.push({
          pmid: c.pmid,
          chunk_type: c.chunk_type,
          content: c.content,
          metadata: c.metadata ?? {},
          embedding: emb,
        });
        if (buffer.length >= args.insertBatch) {
          if (!args.dryRun) {
            totalInserted += await insertWithEmbeddings(_pool, buffer);
            await throttle();
          }
          buffer = [];
        }
      }
      if (buffer.length && !args.dryRun) totalInserted += await insertWithEmbeddings(_pool, buffer);
      totalJoined += shardJoined;
      totalErrors += shardErrors;
      console.log(`[apply] shard ${s.shard}: joined=${shardJoined} errors=${shardErrors} inserted_so_far=${totalInserted}`);
    } else {
      // Drain request_count lines without processing
      let drained = 0;
      while (drained < s.request_count) {
        const { value: line, done } = await chunksIter.next();
        if (done) break;
        if (!line) continue;
        drained++;
      }
      totalSkippedPending += drained;
      console.log(`[apply] shard ${s.shard}: SKIP (${b.status}), drained ${drained} chunk lines`);
    }
  }

  chunksRl.close();

  console.log(
    `[apply] DONE joined=${totalJoined} inserted=${totalInserted} errors=${totalErrors} ` +
    `papers=${touchedPmids.size} skipped_pending=${totalSkippedPending}`
  );
  if (args.dryRun) console.log(`[apply] DRY RUN — no DB writes`);
  if (totalSkippedPending > 0) {
    console.log(`[apply] re-run after pending shards complete to embed those chunks`);
  }

  await _pool.end();
}

main().catch((err) => { console.error("[apply] FAILED:", err); process.exit(1); });
