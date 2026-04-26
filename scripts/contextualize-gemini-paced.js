#!/usr/bin/env node
// Paced Gemini Batch submitter for Tier 1 — submits one batch every N seconds
// to stay under the Tier 1 batch-create rate limit. On 429, doubles the wait
// (capped at 30 min). Manifest format compatible with Codex's --mode=sync.
//
// Usage:
//   node scripts/contextualize-gemini-paced.js --budget-usd=20 --rows-per-job=5000 --pace-seconds=600

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  PROMPT_VERSION,
  INPUT_PRICE_PER_MILLION_USD,
  OUTPUT_PRICE_PER_MILLION_USD,
  buildPrompt,
} from "./contextualize-evidence-chunks.js";

const BATCH_PRICE_MULTIPLIER = 0.5;
const STATE_DIR = path.join(process.cwd(), "scripts", "eval", "contextualization-trial", "gemini-batch");
// When running ON the Hetzner box, set LOCAL_PSQL=1 (or RUN_LOCAL=1) to skip
// the ssh wrapper and call docker exec directly. Default is laptop-via-ssh.
const LOCAL_PSQL = process.env.LOCAL_PSQL === "1" || process.env.RUN_LOCAL === "1";
const SSH_HOST = process.env.PSQL_SSH_HOST || "hetzner";

function parseArgs(argv) {
  const a = {
    budgetUsd: 20,
    rowsPerJob: 5000,
    paceSeconds: 600, // 10 min initial
    minPaceSeconds: 300, // 5 min floor on success
    maxPaceSeconds: 1800, // 30 min ceiling on 429
    model: "gemini-2.5-flash-lite",
    estPromptTokens: 594,
    estCompletionTokens: 55,
    safetyFactor: 0.97,
    afterId: 0,
    maxEnqueuedTokens: 7_500_000, // safety margin under Tier 1 Flash-Lite 10M cap
    quotaCheckSleepSeconds: 300, // sleep when over quota; recheck cadence
  };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--budget-usd") a.budgetUsd = Number(v);
    else if (k === "--rows-per-job") a.rowsPerJob = Number(v);
    else if (k === "--pace-seconds") a.paceSeconds = Number(v);
    else if (k === "--max-pace-seconds") a.maxPaceSeconds = Number(v);
    else if (k === "--min-pace-seconds") a.minPaceSeconds = Number(v);
    else if (k === "--model") a.model = String(v);
    else if (k === "--after-id") a.afterId = Number(v);
    else if (k === "--max-enqueued-tokens") a.maxEnqueuedTokens = Number(v);
    else if (k === "--quota-check-sleep") a.quotaCheckSleepSeconds = Number(v);
  }
  return a;
}

function timestampStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function costPerRow(args) {
  const inUsd = (args.estPromptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD;
  const outUsd = (args.estCompletionTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION_USD;
  return (inUsd + outUsd) * BATCH_PRICE_MULTIPLIER;
}

async function fetchRows(afterId, limit) {
  const sql = `
    COPY (
      SELECT row_to_json(t) FROM (
        SELECT ec.id, ec.pmid, ec.chunk_type, ec.content, ra.title, ra.abstract
        FROM evidence_chunks ec
        JOIN research_articles ra ON ra.pmid = ec.pmid
        WHERE ec.context_prefix IS NULL
          AND ec.content IS NOT NULL
          AND length(ec.content) >= 100
          AND ra.is_retracted = false
          AND ra.is_deleted = false
          AND (ra.language IS NULL OR ra.language IN ('eng','sco'))
          AND ec.context_error IS NULL
          AND ec.id > ${afterId}
        ORDER BY ec.id ASC
        LIMIT ${limit}
      ) t
    ) TO STDOUT;
  `;
  return new Promise((resolve, reject) => {
    const cmd = `docker exec -i supabase-db psql -U supabase_admin -d postgres -tAc "${sql.replace(/"/g, '\\"').replace(/\n\s+/g, " ")}"`;
    const child = LOCAL_PSQL
      ? spawn("bash", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] })
      : spawn("ssh", [SSH_HOST, cmd], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ssh psql failed: ${err}`));
      const rows = out.trim().split("\n").filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      resolve(rows);
    });
  });
}

async function uploadFile(filePath, displayName) {
  const KEY = process.env.GEMINI_API_KEY;
  const bytes = fs.readFileSync(filePath);
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + KEY, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/jsonl",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`upload-start http_${start.status}: ${await start.text()}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  const j = await up.json();
  if (!up.ok || !j.file?.name) throw new Error(`upload-finalize http_${up.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.file.name;
}

const TERMINAL_STATES = new Set(["BATCH_STATE_SUCCEEDED", "BATCH_STATE_FAILED", "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED"]);

async function getEnqueuedTokenEstimate(args) {
  // Lists all batches in this project, sums estimated tokens across non-terminal ones.
  // tokens = requestCount * (estPromptTokens + estCompletionTokens)
  const KEY = process.env.GEMINI_API_KEY;
  const tokensPerRow = args.estPromptTokens + args.estCompletionTokens;
  let pageToken = "";
  let totalTokens = 0;
  let inFlight = 0;
  let pages = 0;
  while (true) {
    const url = `https://generativelanguage.googleapis.com/v1beta/batches?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const r = await fetch(url, { headers: { "x-goog-api-key": KEY } });
    if (!r.ok) {
      console.warn(`[quota] batches.list http_${r.status}; assuming worst-case full quota`);
      return { tokens: args.maxEnqueuedTokens + 1, inFlight: -1, error: `http_${r.status}` };
    }
    const j = await r.json();
    const ops = j.operations || j.batches || [];
    for (const op of ops) {
      const md = op.metadata || op;
      const state = md.state || op.state;
      if (!state || TERMINAL_STATES.has(state)) continue;
      const reqCount = Number(md.batchStats?.requestCount || 0);
      totalTokens += reqCount * tokensPerRow;
      inFlight++;
    }
    pages++;
    if (!j.nextPageToken || pages > 10) break;
    pageToken = j.nextPageToken;
  }
  return { tokens: totalTokens, inFlight, error: null };
}

async function waitForQuotaHeadroom(args, plannedRows) {
  const tokensPerRow = args.estPromptTokens + args.estCompletionTokens;
  const plannedTokens = plannedRows * tokensPerRow;
  while (true) {
    const probe = await getEnqueuedTokenEstimate(args);
    const headroom = args.maxEnqueuedTokens - probe.tokens;
    if (headroom >= plannedTokens) {
      console.log(`[quota] OK enqueued=${(probe.tokens/1e6).toFixed(2)}M in_flight=${probe.inFlight} headroom=${(headroom/1e6).toFixed(2)}M planned=${(plannedTokens/1e6).toFixed(2)}M`);
      return probe;
    }
    console.log(`[quota] WAIT enqueued=${(probe.tokens/1e6).toFixed(2)}M in_flight=${probe.inFlight} headroom=${(headroom/1e6).toFixed(2)}M planned=${(plannedTokens/1e6).toFixed(2)}M; sleeping ${args.quotaCheckSleepSeconds}s`);
    await new Promise((r) => setTimeout(r, args.quotaCheckSleepSeconds * 1000));
  }
}

async function createBatch(model, fileName, displayName) {
  const KEY = process.env.GEMINI_API_KEY;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body, json: (() => { try { return JSON.parse(body); } catch { return null; } })() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = timestampStamp();
  const runDir = path.join(STATE_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const manifestPath = path.join(STATE_DIR, `manifest-${stamp}-paced.json`);
  const manifest = {
    kind: "gemini-batch-contextualization-paced",
    created_at: new Date().toISOString(),
    run_dir: runDir,
    prompt_version: PROMPT_VERSION,
    model: args.model,
    budget_usd: args.budgetUsd,
    rows_per_job: args.rowsPerJob,
    pace_seconds: args.paceSeconds,
    estimated_batch_cost_per_row: Number(costPerRow(args).toFixed(8)),
    jobs: [],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[paced] manifest=${manifestPath}`);
  console.log(`[paced] model=${args.model} rows-per-job=${args.rowsPerJob} pace=${args.paceSeconds}s budget=$${args.budgetUsd}`);

  let cursor = args.afterId;
  let submittedRows = 0;
  let jobIndex = 0;
  let pace = args.paceSeconds;
  const targetRows = Math.floor((args.budgetUsd * args.safetyFactor) / costPerRow(args));
  console.log(`[paced] target rows: ${targetRows}`);

  while (submittedRows < targetRows) {
    // 1. Fetch rows
    console.log(`[paced] fetching up to ${args.rowsPerJob} rows after id=${cursor}`);
    const rows = await fetchRows(cursor, Math.min(args.rowsPerJob, targetRows - submittedRows));
    if (!rows.length) { console.log("[paced] no more rows; done"); break; }

    jobIndex++;
    const lastId = Number(rows[rows.length - 1].id);

    // 1.5. Token-quota gate — wait until enqueued tokens fall below threshold
    await waitForQuotaHeadroom(args, rows.length);

    // 2. Build JSONL
    const jsonlPath = path.join(runDir, `req-${String(jobIndex).padStart(4, "0")}.jsonl`);
    const stream = fs.createWriteStream(jsonlPath);
    for (const row of rows) {
      const prompt = buildPrompt(row, args);
      stream.write(JSON.stringify({
        key: String(row.id),
        request: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 140, thinkingConfig: { thinkingBudget: 0 } },
        },
      }) + "\n");
    }
    await new Promise((res, rej) => { stream.end(res); stream.on("error", rej); });

    // 3. Upload
    let fileName;
    try {
      fileName = await uploadFile(jsonlPath, `paced-${stamp}-${String(jobIndex).padStart(4, "0")}`);
      console.log(`[paced] job ${jobIndex} uploaded: ${fileName}`);
    } catch (err) {
      console.error(`[paced] upload failed: ${err.message}; sleeping 5 min and retrying`);
      await new Promise((r) => setTimeout(r, 300_000));
      continue;
    }

    // 4. Create batch
    const displayName = `emersus-paced-${stamp}-${String(jobIndex).padStart(4, "0")}`;
    const cr = await createBatch(args.model, fileName, displayName);
    if (cr.ok && cr.json?.name) {
      // Success — record + advance
      manifest.jobs.push({
        index: jobIndex,
        batch_name: cr.json.name,
        rows: rows.length,
        first_id: Number(rows[0].id),
        last_id: lastId,
        jsonl_path: jsonlPath,
        cost_estimate: Number((rows.length * costPerRow(args)).toFixed(4)),
        created_at: new Date().toISOString(),
      });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      submittedRows += rows.length;
      cursor = lastId;
      console.log(`[paced] job ${jobIndex} OK ${cr.json.name} | submitted=${submittedRows}/${targetRows} | next sleep ${pace}s`);
      // Decay pace toward floor on success
      pace = Math.max(args.minPaceSeconds, Math.round(pace * 0.9));
    } else {
      console.warn(`[paced] job ${jobIndex} create http_${cr.status}: ${cr.body.slice(0, 200)}`);
      const is429 = cr.status === 429;
      if (is429) {
        pace = Math.min(args.maxPaceSeconds, Math.round(pace * 1.5));
        console.warn(`[paced] 429 — bumping pace to ${pace}s, will retry same range`);
      } else {
        console.error(`[paced] non-429 error — sleeping ${pace}s and retrying same range`);
      }
      // DO NOT advance cursor — retry same range next loop
    }

    // 5. Pace
    console.log(`[paced] sleeping ${pace}s before next batch...`);
    await new Promise((r) => setTimeout(r, pace * 1000));
  }

  console.log(`[paced] DONE. submitted_rows=${submittedRows} jobs=${manifest.jobs.length} manifest=${manifestPath}`);
  console.log(`[paced] To apply when batches complete: node scripts/contextualize-evidence-gemini-batch.js --mode=sync --manifest=${manifestPath}`);
}

main().catch((e) => { console.error("[paced] FAILED:", e); process.exit(1); });
