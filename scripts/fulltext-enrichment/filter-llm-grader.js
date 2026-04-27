// scripts/fulltext-enrichment/filter-llm-grader.js
//
// LLM-based chunk classifier. Reads a JSONL of chunks, asks OpenAI to label
// each as EVIDENCE or NOISE for the fitness/nutrition retrieval pipeline,
// writes a JSONL with the decision attached.
//
// Used in two roles:
//   - Stage 2 training: --max-rows=2000 --random-sample → labels for sklearn
//   - Stage 3 grader:   gray-zone JSONL from Stage 2 → final decisions
//
// Why OpenAI not Gemini: a Gemini-backed contextualization-paced run is
// already in flight against the 300M-token quota ceiling. Using Gemini here
// would starve that pipeline. OpenAI has its own quota envelope.
//
// Cost estimate (gpt-5.4-mini ballpark):
//   ~150 input tokens + ~5 output tokens per chunk
//   3M chunks × $0.225/1M tokens ≈ $100 sync, ~$50 if we batch.
//   With Stage 2 routing only ~600K go through here ≈ $20.
//
// Usage:
//   node scripts/fulltext-enrichment/filter-llm-grader.js \
//     --input=PATH \
//     --output=PATH \
//     [--max-rows=N] [--random-sample] [--concurrency=N] [--batch-size=N] \
//     [--model=NAME]

import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import OpenAI from "openai";

const DEFAULT_MODEL = process.env.OPENAI_FILTER_MODEL || "gpt-5-mini";
const DEFAULT_BATCH = 20;          // chunks per API call
const DEFAULT_CONCURRENCY = 8;     // parallel API calls in flight
const TRUNCATE_CONTENT_CHARS = 600; // sent to LLM per chunk
const RETRY_MAX = 3;
const RETRY_BACKOFF_MS = 2000;

// Trimmed prompt (~140 tokens vs the original ~1500). Keeps the
// "when in doubt → EVIDENCE" bias since calibration showed the model
// over-classifies methods sections as NOISE without that rule.
const SYSTEM_PROMPT = `Classify each scientific chunk for a fitness/nutrition evidence retrieval system. Output one verdict per chunk: EVIDENCE or NOISE.

EVIDENCE: study-specific methods (reagents, protocols, doses, recruitment, data-processing rules), quantitative findings (effect sizes, p-values, CIs, %), authors' original interpretation/claims/mechanisms, substantive background that contributes analysis.

NOISE: acknowledgments, funding, conflicts, ethics/consent statements, author contributions, data availability, trial-registration prose, statistical-software-only methods (e.g. "SPSS v26 was used"), citation-only paragraphs without authors' contribution, forward references to figures/tables without data, generic future-work hedging, online-content boilerplate, reference-list bleed-through.

When in doubt, output EVIDENCE.

Format: one line per chunk, "<index>: <VERDICT>", VERDICT exactly EVIDENCE or NOISE. No prose.`;

function parseArgs(argv) {
  const a = {
    input: null,
    output: null,
    maxRows: Infinity,
    randomSample: false,
    concurrency: DEFAULT_CONCURRENCY,
    batchSize: DEFAULT_BATCH,
    model: DEFAULT_MODEL,
    seed: 42,
  };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--input") a.input = v;
    else if (k === "--output") a.output = v;
    else if (k === "--max-rows") a.maxRows = Number(v) || a.maxRows;
    else if (k === "--random-sample") a.randomSample = true;
    else if (k === "--concurrency") a.concurrency = Math.max(1, Number(v) || a.concurrency);
    else if (k === "--batch-size") a.batchSize = Math.max(1, Number(v) || a.batchSize);
    else if (k === "--model") a.model = v;
    else if (k === "--seed") a.seed = Number(v) || a.seed;
  }
  if (!a.input || !a.output) {
    console.error("usage: --input=PATH --output=PATH [--max-rows=N] [--random-sample] [--concurrency=N] [--batch-size=N] [--model=NAME]");
    process.exit(2);
  }
  return a;
}

// Mulberry32 — small seeded PRNG so --random-sample is reproducible.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reservoir-sample N records from an unbounded stream.
async function reservoirSample(filePath, N, rand) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  const reservoir = [];
  let i = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (i < N) {
      reservoir.push(line);
    } else {
      const j = Math.floor(rand() * (i + 1));
      if (j < N) reservoir[j] = line;
    }
    i++;
  }
  return reservoir;
}

async function* streamLines(filePath, max) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (count >= max) break;
    yield line;
    count++;
  }
}

function buildUserPrompt(batch) {
  const lines = batch.map((chunk, i) => {
    const text = (chunk.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TRUNCATE_CONTENT_CHARS);
    return `${i + 1}) ${text}`;
  });
  return lines.join("\n\n");
}

function parseDecisions(responseText, batchSize) {
  // Expected: "1: EVIDENCE\n2: NOISE\n..."
  // Be tolerant of variants: "1) EVIDENCE", "1. EVIDENCE", "1 - EVIDENCE", or with backticks.
  const decisions = new Array(batchSize).fill("UNKNOWN");
  const lineRe = /^\s*(\d+)\s*[):.\-]\s*(?:`|"|')?\s*(EVIDENCE|NOISE)\b/gim;
  for (const m of responseText.matchAll(lineRe)) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < batchSize) decisions[idx] = m[2].toUpperCase();
  }
  return decisions;
}

async function gradeBatch(client, model, batch) {
  const userPrompt = buildUserPrompt(batch);
  let lastErr = null;
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        // gpt-5.4 family rejects `max_tokens`, accepts `max_completion_tokens`.
        // Fixed temperature support varies by model — omit and let the API default.
        max_completion_tokens: 8 * batch.length + 64,
      });
      const text = res.choices?.[0]?.message?.content || "";
      const decisions = parseDecisions(text, batch.length);
      return { decisions, usage: res.usage };
    } catch (err) {
      lastErr = err;
      const ms = RETRY_BACKOFF_MS * Math.pow(2, attempt);
      console.error(`[grader] attempt ${attempt + 1} failed: ${err.message}; backoff ${ms}ms`);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  console.error(`[grader] giving up on batch after ${RETRY_MAX} attempts: ${lastErr?.message}`);
  return { decisions: new Array(batch.length).fill("UNKNOWN"), usage: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[grader] starting", args);

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const out = fs.createWriteStream(args.output);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let counts = { EVIDENCE: 0, NOISE: 0, UNKNOWN: 0 };
  let totalUsageIn = 0, totalUsageOut = 0;
  let completedBatches = 0;
  let totalChunks = 0;
  const startedAt = Date.now();
  let lastLog = startedAt;

  if (args.randomSample && Number.isFinite(args.maxRows)) {
    // Random sample fits in memory (max ~tens of MB for typical maxRows)
    console.log(`[grader] reservoir-sampling ${args.maxRows} from ${args.input}`);
    const inputLines = await reservoirSample(args.input, args.maxRows, mulberry32(args.seed));
    totalChunks = inputLines.length;
    console.log(`[grader] queued ${totalChunks} chunks`);

    // Build batches up front (small, in-memory)
    const batches = [];
    for (let i = 0; i < inputLines.length; i += args.batchSize) {
      batches.push(inputLines.slice(i, i + args.batchSize).map((l) => JSON.parse(l)));
    }
    let nextBatch = 0;
    async function worker() {
      while (nextBatch < batches.length) {
        const chunks = batches[nextBatch++];
        await processBatch(chunks);
      }
    }
    await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  } else {
    // Streaming path — bounded memory regardless of input size.
    // Producer pushes batches to a bounded queue; N workers consume.
    const QUEUE_LIMIT = args.concurrency * 3;
    const queue = [];
    let inputDone = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function producer() {
      const rl = readline.createInterface({
        input: fs.createReadStream(args.input),
        crlfDelay: Infinity,
      });
      let batch = [];
      let read = 0;
      for await (const line of rl) {
        if (read >= args.maxRows) break;
        if (!line.trim()) continue;
        read++;
        try {
          batch.push(JSON.parse(line));
        } catch {
          continue;
        }
        if (batch.length >= args.batchSize) {
          while (queue.length >= QUEUE_LIMIT) await sleep(20);
          queue.push(batch);
          batch = [];
        }
      }
      if (batch.length) {
        while (queue.length >= QUEUE_LIMIT) await sleep(20);
        queue.push(batch);
      }
      inputDone = true;
    }

    async function worker() {
      while (true) {
        if (queue.length === 0) {
          if (inputDone) return;
          await sleep(20);
          continue;
        }
        const chunks = queue.shift();
        if (!chunks) continue;
        await processBatch(chunks);
      }
    }

    const producerP = producer();
    const workers = Array.from({ length: args.concurrency }, () => worker());
    await Promise.all([producerP, ...workers]);
  }

  await new Promise((r) => out.end(r));

  async function processBatch(chunks) {
    totalChunks += chunks.length;
    const { decisions, usage } = await gradeBatch(client, args.model, chunks);
    for (let j = 0; j < chunks.length; j++) {
      const decision = decisions[j];
      counts[decision] = (counts[decision] || 0) + 1;
      out.write(JSON.stringify({ ...chunks[j], __decision: decision }) + "\n");
    }
    if (usage) {
      totalUsageIn += usage.prompt_tokens || 0;
      totalUsageOut += usage.completion_tokens || 0;
    }
    completedBatches++;
    const now = Date.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      const elapsed = Math.round((now - startedAt) / 1000);
      const ratePerSec = totalChunks / Math.max(elapsed, 1);
      console.log(
        `[grader] chunks=${totalChunks} batches=${completedBatches} ` +
        `evidence=${counts.EVIDENCE} noise=${counts.NOISE} unknown=${counts.UNKNOWN} ` +
        `tok_in=${totalUsageIn} tok_out=${totalUsageOut} ` +
        `rate=${ratePerSec.toFixed(0)}/s elapsed=${elapsed}s`
      );
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[grader] DONE total=${totalChunks} evidence=${counts.EVIDENCE} noise=${counts.NOISE} unknown=${counts.UNKNOWN} ` +
    `tokens_in=${totalUsageIn} tokens_out=${totalUsageOut} elapsed=${elapsed}s`
  );
  if (totalUsageIn > 0) {
    // Rough cost estimate (placeholder rates — replace with real ones when known)
    const inUsd = (totalUsageIn / 1_000_000) * 0.15;
    const outUsd = (totalUsageOut / 1_000_000) * 0.60;
    console.log(`[grader] est_cost_usd=$${(inUsd + outUsd).toFixed(2)} (assuming 0.15/0.60 per 1M)`);
  }
}

main().catch((err) => { console.error("[grader] FAILED:", err); process.exit(1); });
