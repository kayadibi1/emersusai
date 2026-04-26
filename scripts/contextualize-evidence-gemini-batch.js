#!/usr/bin/env node
// Submit and apply Gemini Batch API contextualization jobs for evidence_chunks.

import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GEMINI_URL,
  DEFAULT_MODELS,
  DEFAULT_MAX_ABSTRACT_CHARS,
  DEFAULT_MAX_CHUNK_CHARS,
  PROMPT_VERSION,
  INPUT_PRICE_PER_MILLION_USD,
  OUTPUT_PRICE_PER_MILLION_USD,
  assertConfigured,
  buildPrompt,
  fetchBatch,
  applyResults,
  cleanModelContext,
  normalizeGeminiUsage,
  normalizeText,
  retryDelayMsFromMessage,
  sleep,
} from "./contextualize-evidence-chunks.js";

const BATCH_PRICE_MULTIPLIER = 0.5;
// 5000 rows × ~511 tokens/row = ~2.5M enqueued per batch. Stays safely under
// the Tier 1 Flash-Lite 10M cap (allowing ~4 batches in flight). Raise when
// project upgrades to Tier 2 (500M cap) or beyond.
const DEFAULT_ROWS_PER_JOB = 5000;
const DEFAULT_APPLY_BATCH_SIZE = 25;
const DEFAULT_POLL_SECONDS = 10;
const DEFAULT_ESTIMATED_PROMPT_TOKENS = 594;
const DEFAULT_ESTIMATED_COMPLETION_TOKENS = 55;
const DEFAULT_SAFETY_FACTOR = 0.97;
const STATE_DIR = path.join(
  process.cwd(),
  "scripts",
  "eval",
  "contextualization-trial",
  "gemini-batch"
);
// When running ON the Hetzner box, set LOCAL_PSQL=1 (or RUN_LOCAL=1) to skip
// the ssh wrapper and call docker directly. Default is laptop-via-ssh.
const LOCAL_PSQL = process.env.LOCAL_PSQL === "1" || process.env.RUN_LOCAL === "1";
const FETCH_FALLBACK_SSH_HOST = process.env.PSQL_SSH_HOST || "hetzner";

function parseArgs(argv) {
  const args = {
    mode: "submit",
    provider: "gemini",
    model: DEFAULT_MODELS.gemini,
    baseUrl: GEMINI_URL,
    budgetUsd: 0,
    maxRows: 0,
    afterId: 0,
    rowsPerJob: DEFAULT_ROWS_PER_JOB,
    applyBatchSize: DEFAULT_APPLY_BATCH_SIZE,
    maxAbstractChars: DEFAULT_MAX_ABSTRACT_CHARS,
    maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
    estimatedPromptTokens: DEFAULT_ESTIMATED_PROMPT_TOKENS,
    estimatedCompletionTokens: DEFAULT_ESTIMATED_COMPLETION_TOKENS,
    safetyFactor: DEFAULT_SAFETY_FACTOR,
    pollSeconds: DEFAULT_POLL_SECONDS,
    displayPrefix: "emersus-context",
    manifest: "",
    help: false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    const [key, ...rest] = String(raw).split("=");
    const value = rest.join("=");
    if (key === "--mode") args.mode = String(value || "").trim().toLowerCase();
    else if (key === "--model") args.model = String(value || "").trim() || DEFAULT_MODELS.gemini;
    else if (key === "--base-url") args.baseUrl = String(value || "").trim().replace(/\/+$/, "");
    else if (key === "--budget-usd") args.budgetUsd = Number(value || 0);
    else if (key === "--max-rows") args.maxRows = Number(value || 0);
    else if (key === "--after-id") args.afterId = Number(value || 0);
    else if (key === "--rows-per-job") args.rowsPerJob = Number(value || DEFAULT_ROWS_PER_JOB);
    else if (key === "--apply-batch-size") args.applyBatchSize = Number(value || DEFAULT_APPLY_BATCH_SIZE);
    else if (key === "--max-abstract-chars") args.maxAbstractChars = Number(value || DEFAULT_MAX_ABSTRACT_CHARS);
    else if (key === "--max-chunk-chars") args.maxChunkChars = Number(value || DEFAULT_MAX_CHUNK_CHARS);
    else if (key === "--estimated-prompt-tokens") args.estimatedPromptTokens = Number(value || DEFAULT_ESTIMATED_PROMPT_TOKENS);
    else if (key === "--estimated-completion-tokens") args.estimatedCompletionTokens = Number(value || DEFAULT_ESTIMATED_COMPLETION_TOKENS);
    else if (key === "--safety-factor") args.safetyFactor = Number(value || DEFAULT_SAFETY_FACTOR);
    else if (key === "--poll-seconds") args.pollSeconds = Number(value || DEFAULT_POLL_SECONDS);
    else if (key === "--display-prefix") args.displayPrefix = String(value || "").trim() || "emersus-context";
    else if (key === "--manifest") args.manifest = String(value || "").trim();
    else throw new Error(`Unknown argument: ${raw}`);
  }

  args.mode = ["submit", "sync", "status"].includes(args.mode) ? args.mode : "";
  if (!args.mode) throw new Error(`Unknown --mode. Use submit, sync, or status.`);
  args.budgetUsd = Math.max(0, Number(args.budgetUsd || 0));
  args.maxRows = Math.max(0, Math.floor(args.maxRows || 0));
  args.afterId = Math.max(0, Math.floor(args.afterId || 0));
  args.rowsPerJob = Math.max(1, Math.floor(args.rowsPerJob || DEFAULT_ROWS_PER_JOB));
  args.applyBatchSize = Math.max(1, Math.floor(args.applyBatchSize || DEFAULT_APPLY_BATCH_SIZE));
  args.maxAbstractChars = Math.max(1000, Math.floor(args.maxAbstractChars || DEFAULT_MAX_ABSTRACT_CHARS));
  args.maxChunkChars = Math.max(400, Math.floor(args.maxChunkChars || DEFAULT_MAX_CHUNK_CHARS));
  args.estimatedPromptTokens = Math.max(1, Number(args.estimatedPromptTokens || DEFAULT_ESTIMATED_PROMPT_TOKENS));
  args.estimatedCompletionTokens = Math.max(1, Number(args.estimatedCompletionTokens || DEFAULT_ESTIMATED_COMPLETION_TOKENS));
  args.safetyFactor = Math.max(0.5, Math.min(1, Number(args.safetyFactor || DEFAULT_SAFETY_FACTOR)));
  args.pollSeconds = Math.max(5, Math.floor(args.pollSeconds || DEFAULT_POLL_SECONDS));
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/contextualize-evidence-gemini-batch.js --mode=submit --budget-usd=22
  node scripts/contextualize-evidence-gemini-batch.js --mode=sync --manifest=PATH
  node scripts/contextualize-evidence-gemini-batch.js --mode=status --manifest=PATH

Options:
  --mode=submit|sync|status         Submit new Gemini Batch jobs, sync completed jobs, or print manifest summary.
  --budget-usd=N                    Planned Gemini Batch spend target for submit mode.
  --max-rows=N                      Override estimated rows and cap submission to N rows.
  --after-id=N                      Start fetching pending rows after evidence_chunks.id N.
  --rows-per-job=N                  Rows per batch job JSONL file. Default: ${DEFAULT_ROWS_PER_JOB}.
  --apply-batch-size=N              DB apply batch size during sync. Default: ${DEFAULT_APPLY_BATCH_SIZE}.
  --manifest=PATH                   Existing manifest path for sync/status mode.
  --display-prefix=TEXT             Batch display name prefix. Default: emersus-context.
  --estimated-prompt-tokens=N       Cost estimate input tokens per row. Default: ${DEFAULT_ESTIMATED_PROMPT_TOKENS}.
  --estimated-completion-tokens=N   Cost estimate output tokens per row. Default: ${DEFAULT_ESTIMATED_COMPLETION_TOKENS}.
  --safety-factor=0.97              Budget safety factor for submit mode. Default: ${DEFAULT_SAFETY_FACTOR}.
  --poll-seconds=N                  Poll interval for sync mode. Default: ${DEFAULT_POLL_SECONDS}.
`);
}

function ensureConfigured() {
  assertConfigured({ provider: "gemini", dryRun: false });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function timestampStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function estimatedBatchCostPerRow(args) {
  return (
    args.estimatedPromptTokens * INPUT_PRICE_PER_MILLION_USD * BATCH_PRICE_MULTIPLIER / 1_000_000 +
    args.estimatedCompletionTokens * OUTPUT_PRICE_PER_MILLION_USD * BATCH_PRICE_MULTIPLIER / 1_000_000
  );
}

function plannedRows(args) {
  if (args.maxRows > 0) return args.maxRows;
  if (args.budgetUsd <= 0) return 0;
  return Math.max(1, Math.floor((args.budgetUsd * args.safetyFactor) / estimatedBatchCostPerRow(args)));
}

function manifestPathFromArgs(args) {
  if (args.manifest) return path.resolve(process.cwd(), args.manifest);
  const files = fs
    .readdirSync(STATE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^manifest-.*\.json$/.test(entry.name))
    .map((entry) => path.join(STATE_DIR, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files[0]) throw new Error(`No manifest found in ${STATE_DIR}`);
  return files[0];
}

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath, manifest) {
  manifest.updated_at = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function batchRequestForPrompt(prompt) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 140,
      // Disable thinking — gemini-2.5-flash otherwise eats the output budget
      // on hidden reasoning tokens (produces ~3-7 tokens of output).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

async function uploadJsonlFile(filePath, displayName) {
  const bytes = fs.readFileSync(filePath);
  return retryGeminiCall(async () => {
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": "jsonl",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: displayName,
        },
      }),
    });

    if (!start.ok) {
      const text = await start.text();
      const error = new Error(`File upload start failed: ${start.status} ${text}`);
      error.status = start.status;
      throw error;
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("File upload start did not return x-goog-upload-url");

    const finish = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "Content-Length": String(bytes.length),
        "Content-Type": "jsonl",
      },
      body: bytes,
    });

    const body = await finish.text();
    if (!finish.ok) {
      const error = new Error(`File upload finalize failed: ${finish.status} ${body}`);
      error.status = finish.status;
      throw error;
    }
    const parsed = body ? JSON.parse(body) : {};
    const fileName = parsed?.file?.name || parsed?.name;
    if (!fileName) throw new Error(`Upload succeeded but file name was missing: ${body}`);
    return parsed.file || parsed;
  }, "upload");
}

async function createBatchJob(fileName, args, displayName) {
  const modelPath = args.model.startsWith("models/") ? args.model : `models/${args.model}`;
  return retryGeminiCall(async () => {
    const response = await fetch(`${args.baseUrl}/${modelPath}:batchGenerateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: {
            file_name: fileName,
          },
        },
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Batch create failed: ${response.status} ${text}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : {};
  }, "create");
}

async function getBatchJob(name, args) {
  const response = await fetch(`${args.baseUrl}/${name}`, {
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Batch get failed for ${name}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function downloadResultFile(fileName) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media`,
    {
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
    }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Result download failed: ${response.status} ${text}`);
  return text;
}

function parseResultLine(line, model) {
  const parsed = JSON.parse(line);
  const id = Number(parsed?.key);
  if (!Number.isFinite(id)) throw new Error(`Invalid result key in line: ${line.slice(0, 200)}`);

  if (parsed.error) {
    const message =
      parsed.error.message ||
      parsed.error.status ||
      parsed.error.code ||
      JSON.stringify(parsed.error);
    return {
      id,
      context_prefix: null,
      context_provider: "gemini",
      context_model: model,
      context_prompt_version: PROMPT_VERSION,
      context_latency_ms: null,
      context_prompt_tokens: null,
      context_completion_tokens: null,
      context_cost_usd: null,
      context_error: String(message),
    };
  }

  const response = parsed.response || {};
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const usage = normalizeGeminiUsage(response?.usageMetadata);
  const batchCost =
    (
      Number(usage.prompt_tokens || 0) * INPUT_PRICE_PER_MILLION_USD * BATCH_PRICE_MULTIPLIER / 1_000_000 +
      Number(usage.completion_tokens || 0) * OUTPUT_PRICE_PER_MILLION_USD * BATCH_PRICE_MULTIPLIER / 1_000_000
    );
  return {
    id,
    context_prefix: cleanModelContext(parts.map((part) => part.text || "").join("")),
    context_provider: "gemini",
    context_model: model,
    context_prompt_version: PROMPT_VERSION,
    context_latency_ms: null,
    context_prompt_tokens: usage.prompt_tokens,
    context_completion_tokens: usage.completion_tokens,
    context_cost_usd: Number(batchCost.toFixed(8)),
    context_error: null,
  };
}

function stateHas(state, suffix) {
  return String(state || "").toUpperCase().endsWith(String(suffix || "").toUpperCase());
}

async function submitJobs(args) {
  ensureConfigured();
  const rowTarget = plannedRows(args);
  if (rowTarget <= 0) throw new Error("Submit mode needs --budget-usd or --max-rows.");

  const stamp = timestampStamp();
  const runDir = path.join(STATE_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const manifestPath = path.join(STATE_DIR, `manifest-${stamp}.json`);
  const manifest = {
    kind: "gemini-batch-contextualization",
    created_at: new Date().toISOString(),
    run_dir: runDir,
    prompt_version: PROMPT_VERSION,
    model: args.model,
    budget_usd: args.budgetUsd,
    estimated_batch_cost_per_row: Number(estimatedBatchCostPerRow(args).toFixed(8)),
    planned_rows: rowTarget,
    rows_per_job: args.rowsPerJob,
    jobs: [],
  };

  let cursor = args.afterId;
  let submittedRows = 0;
  let jobIndex = 0;

  while (submittedRows < rowTarget) {
    const remaining = rowTarget - submittedRows;
    const rows = await fetchRowsViaSshPsql(cursor, Math.min(args.rowsPerJob, remaining));
    if (!rows.length) break;

    jobIndex += 1;
    const batchLastId = Number(rows[rows.length - 1].id);

    const inputFilePath = path.join(runDir, `requests-${String(jobIndex).padStart(3, "0")}.jsonl`);
    const stream = fs.createWriteStream(inputFilePath, { flags: "w" });
    for (const row of rows) {
      const prompt = buildPrompt(row, args);
      stream.write(
        `${JSON.stringify({
          key: String(row.id),
          request: batchRequestForPrompt(prompt),
        })}\n`
      );
    }
    await new Promise((resolve, reject) => {
      stream.end(resolve);
      stream.on("error", reject);
    });

    const displayName = `${args.displayPrefix}-${stamp}-${String(jobIndex).padStart(3, "0")}`;
    const uploaded = await uploadJsonlFile(inputFilePath, path.basename(inputFilePath));
    let batchJob;
    try {
      batchJob = await createBatchJob(uploaded.name, args, displayName);
    } catch (error) {
      const message = String(error?.message || "");
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
        console.warn(`[batch-submit] queue full after ${manifest.jobs.length} jobs; stopping submit loop`);
        writeManifest(manifestPath, manifest);
        break;
      }
      throw error;
    }
    const estimatedCost = Number((rows.length * estimatedBatchCostPerRow(args)).toFixed(4));

    manifest.jobs.push({
      index: jobIndex,
      display_name: displayName,
      batch_name: batchJob.name,
      state: batchJob.state || batchJob.metadata?.state || "JOB_STATE_UNSPECIFIED",
      input_file_path: inputFilePath,
      uploaded_file_name: uploaded.name,
      row_count: rows.length,
      first_id: Number(rows[0].id),
      last_id: Number(rows[rows.length - 1].id),
      estimated_cost_usd: estimatedCost,
      submitted_at: new Date().toISOString(),
      result_file_name: "",
      result_file_path: "",
      applied_at: "",
      applied_rows: 0,
    });
    cursor = batchLastId;
    submittedRows += rows.length;
    writeManifest(manifestPath, manifest);
    console.log(
      `[batch-submit] job=${jobIndex} rows=${rows.length} ids=${rows[0].id}-${rows[rows.length - 1].id} est_cost=$${estimatedCost.toFixed(4)} batch=${batchJob.name}`
    );
  }

  manifest.submitted_rows = submittedRows;
  manifest.submitted_estimated_cost_usd = Number(
    manifest.jobs.reduce((sum, job) => sum + Number(job.estimated_cost_usd || 0), 0).toFixed(4)
  );
  writeManifest(manifestPath, manifest);
  console.log(`[batch-submit] manifest=${manifestPath}`);
  console.log(
    `[batch-submit] submitted_jobs=${manifest.jobs.length} submitted_rows=${submittedRows} est_cost=$${manifest.submitted_estimated_cost_usd.toFixed(4)}`
  );
  return manifestPath;
}

async function retryGeminiCall(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const message = String(error?.message || "");
      const retryable = status === 429 || status === 503 || /RESOURCE_EXHAUSTED|unavailable|quota|fetch failed|timeout/i.test(message);
      if (!retryable || attempt === 6) break;
      const waitMs =
        retryDelayMsFromMessage(message) ||
        Math.min(180000, 15000 * 2 ** (attempt - 1));
      console.warn(`[batch-${label}] retrying after ${message} (attempt ${attempt}/6, wait ${waitMs}ms)`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function fetchRowsViaSshPsql(afterId, limit) {
  const sql = `
SET statement_timeout = 0;
SET lock_timeout = 0;
SELECT row_to_json(t)::text
FROM (
  SELECT
    ec.id,
    ec.pmid,
    ec.chunk_type,
    ec.content,
    ec.context_attempts,
    ra.title AS article_title,
    ra.journal,
    ra.publication_year,
    ra.authors,
    ra.abstract
  FROM public.evidence_chunks ec
  JOIN public.research_articles ra ON ra.pmid = ec.pmid
  WHERE ec.id > ${Number(afterId || 0)}
    AND ec.content IS NOT NULL
    AND length(ec.content) > 0
    AND ec.context_prefix IS NULL
    AND ec.context_error IS NULL
    AND ra.is_retracted = false
    AND ra.is_deleted = false
    AND (ra.language IS NULL OR ra.language IN ('eng', 'sco'))
  ORDER BY ec.id ASC
  LIMIT ${Number(limit || 0)}
) t;
`;

  const psqlArgs = ["exec", "-i", "supabase-db", "psql", "-U", "supabase_admin", "-d", "postgres", "-X", "-q", "-A", "-t", "-f", "-"];
  const child = LOCAL_PSQL
    ? spawn("docker", psqlArgs, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] })
    : spawn("ssh", [FETCH_FALLBACK_SSH_HOST, "docker", ...psqlArgs], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(sql);

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (code !== 0) {
    throw new Error(`ssh/psql fetch failed: ${normalizeText(stderr || stdout)}`);
  }

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function syncJobs(args) {
  ensureConfigured();
  const manifestPath = manifestPathFromArgs(args);
  const manifest = readManifest(manifestPath);
  let appliedRows = 0;
  let appliedCost = 0;

  for (const job of manifest.jobs) {
    if (job.applied_at) continue;
    const status = await getBatchJob(job.batch_name, args);
    job.state = status.state || status.metadata?.state || job.state;
    job.result_file_name = status.dest?.fileName || status.response?.responsesFile || job.result_file_name || "";
    job.last_checked_at = new Date().toISOString();

    if (stateHas(job.state, "SUCCEEDED") && job.result_file_name) {
      const resultText = await downloadResultFile(job.result_file_name);
      const resultFilePath = path.join(STATE_DIR, path.basename(manifest.run_dir), `results-${String(job.index).padStart(3, "0")}.jsonl`);
      fs.writeFileSync(resultFilePath, resultText, "utf8");
      job.result_file_path = resultFilePath;

      const lines = resultText.split(/\r?\n/).filter(Boolean);
      const results = lines.map((line) => parseResultLine(line, manifest.model));
      const applied = await applyResults(results, args.applyBatchSize);
      const cost = results.reduce((sum, row) => sum + Number(row.context_cost_usd || 0), 0);
      job.applied_at = new Date().toISOString();
      job.applied_rows = applied;
      job.applied_cost_usd = Number(cost.toFixed(4));
      appliedRows += applied;
      appliedCost += cost;
      console.log(
        `[batch-sync] applied job=${job.index} rows=${applied} cost=$${Number(cost).toFixed(4)} batch=${job.batch_name}`
      );
    } else if (
      stateHas(job.state, "FAILED") ||
      stateHas(job.state, "CANCELLED") ||
      stateHas(job.state, "EXPIRED")
    ) {
      job.failed_at = new Date().toISOString();
      job.error = normalizeText(
        typeof status.error === "string" ? status.error : status.error?.message || JSON.stringify(status.error || {})
      );
      console.log(`[batch-sync] job=${job.index} state=${job.state} error=${job.error}`);
    } else {
      console.log(`[batch-sync] job=${job.index} state=${job.state}`);
    }
    writeManifest(manifestPath, manifest);
    await sleep(args.pollSeconds * 1000);
  }

  const outstanding = manifest.jobs.filter((job) => !job.applied_at && !job.failed_at).length;
  console.log(
    `[batch-sync] manifest=${manifestPath} applied_rows=${appliedRows} applied_cost=$${appliedCost.toFixed(4)} outstanding_jobs=${outstanding}`
  );
  return manifestPath;
}

function printStatus(args) {
  const manifestPath = manifestPathFromArgs(args);
  const manifest = readManifest(manifestPath);
  const submitted = manifest.jobs.reduce((sum, job) => sum + Number(job.row_count || 0), 0);
  const applied = manifest.jobs.reduce((sum, job) => sum + Number(job.applied_rows || 0), 0);
  const estimated = manifest.jobs.reduce((sum, job) => sum + Number(job.estimated_cost_usd || 0), 0);
  const actual = manifest.jobs.reduce((sum, job) => sum + Number(job.applied_cost_usd || 0), 0);
  const counts = {};
  for (const job of manifest.jobs) counts[job.state] = (counts[job.state] || 0) + 1;
  console.log(`[batch-status] manifest=${manifestPath}`);
  console.log(
    `[batch-status] jobs=${manifest.jobs.length} submitted_rows=${submitted} applied_rows=${applied} est_cost=$${estimated.toFixed(4)} actual_cost=$${actual.toFixed(4)}`
  );
  console.log(`[batch-status] states=${JSON.stringify(counts)}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.mode === "submit") {
    await submitJobs(args);
    return;
  }
  if (args.mode === "sync") {
    await syncJobs(args);
    return;
  }
  if (args.mode === "status") {
    printStatus(args);
    return;
  }
  throw new Error(`Unsupported mode: ${args.mode}`);
}

main().catch((err) => {
  console.error("[batch] FAILED:", err);
  process.exit(1);
});
