// scripts/fulltext-enrichment/fulltext-chunk-resubmit.js
//
// Drip-feed resubmitter for embedding batches that failed at submit due to
// the text-embedding-3-small 100M-token enqueued-token cap.
//
// We submitted 61 shards in one go (1.16B tokens total). Only 5 fit;
// the other 56 got `token_limit_exceeded` at submit. The OpenAI input
// files (file-IDs) are still valid — just need to re-create the batches
// once queue space frees up.
//
// Logic:
//   loop:
//     poll all batches in state
//     count enqueued tokens (sum of in_progress + validating batch token estimates)
//     if room for another batch (< CAP * 0.8):
//       pick the next failed shard
//       create new batch from its existing input_file_id
//       update state.shards[i].batch_id to the new id
//     else wait POLL_INTERVAL_MS
//     if no more failed shards: exit
//
// Per-batch token estimate: ~38M (50K reqs × ~750 tok avg). Conservative
// MAX_IN_QUEUE = 2 (= 76M, under 100M cap).
//
// Usage (Hetzner):
//   nohup node scripts/fulltext-enrichment/fulltext-chunk-resubmit.js \
//     > ~/embed-resubmit.log 2>&1 &

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(moduleDir, "data");
const STATE_FILE = path.join(DATA_DIR, "fulltext-chunk-batch-state.json");

const POLL_INTERVAL_MS = 30_000;     // poll every 30s
// Each batch ≈ 12M tokens (50K reqs × ~250 tok for text-embedding-3-small).
// 100M cap fits ~7 batches; we saw 5 simultaneously without rejection.
// Use 5 for safety margin (60M enqueued, headroom for new batches to validate).
const MAX_IN_QUEUE = 5;
const ACTIVE_STATUSES = new Set(["validating", "in_progress", "finalizing"]);
const TERMINAL_OK = new Set(["completed"]);
const TERMINAL_BAD = new Set(["failed", "expired", "cancelled"]);

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  if (!fs.existsSync(STATE_FILE)) throw new Error(`state file missing: ${STATE_FILE}`);

  const client = new OpenAI();
  let stateDirty = false;

  function readState() {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  }
  function writeState(s) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    stateDirty = false;
  }

  while (true) {
    const state = readState();
    const statuses = new Map();
    let activeCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    // Refresh statuses for each shard
    for (const s of state.shards) {
      try {
        const b = await client.batches.retrieve(s.batch_id);
        statuses.set(s.shard, b);
        if (ACTIVE_STATUSES.has(b.status)) activeCount++;
        else if (TERMINAL_OK.has(b.status)) completedCount++;
        else if (TERMINAL_BAD.has(b.status)) failedCount++;
      } catch (err) {
        console.error(`[resubmit] retrieve ${s.batch_id} failed: ${err.message}`);
      }
    }
    console.log(
      `[resubmit] active=${activeCount} completed=${completedCount} failed=${failedCount} ` +
      `total=${state.shards.length}`
    );

    // If everything is done (completed or terminally failed for non-resubmittable reasons),
    // exit.
    const stillFailed = state.shards.filter((s) => TERMINAL_BAD.has(statuses.get(s.shard)?.status));
    if (!stillFailed.length && activeCount === 0) {
      console.log(`[resubmit] DONE — no active or failed batches remain`);
      break;
    }

    // Resubmit slots available?
    const slots = MAX_IN_QUEUE - activeCount;
    if (slots > 0 && stillFailed.length > 0) {
      const toResubmit = stillFailed.slice(0, slots);
      for (const s of toResubmit) {
        try {
          const newBatch = await client.batches.create({
            input_file_id: s.input_file_id,
            endpoint: "/v1/embeddings",
            completion_window: "24h",
            metadata: { purpose: "fulltext_chunk_embed", shard: String(s.shard), resubmit: "true" },
          });
          console.log(
            `[resubmit] shard ${s.shard}: NEW batch=${newBatch.id} status=${newBatch.status} ` +
            `(was ${s.batch_id})`
          );
          // Update state in place
          const fresh = readState();
          const idx = fresh.shards.findIndex((x) => x.shard === s.shard);
          if (idx >= 0) {
            fresh.shards[idx].batch_id = newBatch.id;
            fresh.shards[idx].resubmitted_at = new Date().toISOString();
            writeState(fresh);
          }
          statuses.set(s.shard, { ...newBatch, status: "validating" });
          activeCount++;
        } catch (err) {
          // If the create itself fails (e.g., we hit the cap), back off
          console.error(`[resubmit] shard ${s.shard}: create failed: ${err.message}`);
          break;
        }
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => { console.error("[resubmit] FAILED:", err); process.exit(1); });
