#!/usr/bin/env node
// Generate paper-aware context prefixes for evidence_chunks.
//
// Requires the Phase 3 migration:
//   supabase/20260423_contextual_embeddings.sql
//
// Safe smoke tests:
//   node scripts/contextualize-evidence-chunks.js --help
//   node scripts/contextualize-evidence-chunks.js --dry-run --max-rows=3
//
// Live small batch:
//   node scripts/contextualize-evidence-chunks.js --max-rows=100 --concurrency=10 --requests-per-minute=600
// Budgeted run:
//   node scripts/contextualize-evidence-chunks.js --budget-usd=25 --concurrency=10 --requests-per-minute=600
// Local Ollama benchmark:
//   node scripts/contextualize-evidence-chunks.js --provider=ollama --model=qwen3:8b --max-rows=100 --concurrency=1

import "dotenv/config";
import { supabaseAdmin } from "../api/lib/clients.js";

export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
export const OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_PROVIDER = "gemini";
export const DEFAULT_MODELS = {
  // 2026-04-25 reverted to flash-lite: Tier 1 Flash batch enqueued-token cap
  // is 3M, Flash-Lite is 10M — 3.3× throughput on Tier 1. Upgrade this back
  // to "gemini-2.5-flash" when the project reaches Tier 2 (400M cap).
  gemini: "gemini-2.5-flash-lite",
  ollama: "qwen3:8b",
};
export const PROMPT_VERSION = "scientific-context-v2-title-aware";
// Gemini 2.5 Flash-Lite sync pricing ($0.10 in / $0.40 out per M);
// batch mode is 50% off.
export const INPUT_PRICE_PER_MILLION_USD = 0.10;
export const OUTPUT_PRICE_PER_MILLION_USD = 0.40;

export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_APPLY_BATCH_SIZE = 25;
export const DEFAULT_CONCURRENCY = 10;
export const DEFAULT_REQUESTS_PER_MINUTE = 600;
export const DEFAULT_MAX_ABSTRACT_CHARS = 3600;
export const DEFAULT_MAX_CHUNK_CHARS = 1600;

export function parseArgs(argv) {
  const args = {
    provider: DEFAULT_PROVIDER,
    baseUrl: null,
    batchSize: DEFAULT_BATCH_SIZE,
    applyBatchSize: DEFAULT_APPLY_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    maxRows: 0,
    budgetUsd: 0,
    afterId: 0,
    retryErrors: false,
    dryRun: false,
    model: null,
    maxAbstractChars: DEFAULT_MAX_ABSTRACT_CHARS,
    maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
    help: false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--retry-errors") args.retryErrors = true;
    else {
      const [key, ...rest] = String(raw).split("=");
      const value = rest.join("=");
      if (key === "--provider") args.provider = normalizeProvider(value || DEFAULT_PROVIDER);
      else if (key === "--base-url") args.baseUrl = String(value || "").trim();
      else if (key === "--batch-size") args.batchSize = Number(value || DEFAULT_BATCH_SIZE);
      else if (key === "--apply-batch-size") {
        args.applyBatchSize = Number(value || DEFAULT_APPLY_BATCH_SIZE);
      }
      else if (key === "--concurrency") args.concurrency = Number(value || DEFAULT_CONCURRENCY);
      else if (key === "--requests-per-minute") {
        args.requestsPerMinute = Number(value || DEFAULT_REQUESTS_PER_MINUTE);
      } else if (key === "--max-rows") args.maxRows = Number(value || 0);
      else if (key === "--budget-usd") args.budgetUsd = Number(value || 0);
      else if (key === "--after-id") args.afterId = Number(value || 0);
      else if (key === "--model") args.model = String(value || "").trim();
      else if (key === "--max-abstract-chars") {
        args.maxAbstractChars = Number(value || DEFAULT_MAX_ABSTRACT_CHARS);
      } else if (key === "--max-chunk-chars") {
        args.maxChunkChars = Number(value || DEFAULT_MAX_CHUNK_CHARS);
      } else {
        throw new Error(`Unknown argument: ${raw}`);
      }
    }
  }

  args.batchSize = clamp(args.batchSize, 1, 1000, DEFAULT_BATCH_SIZE);
  args.applyBatchSize = clamp(args.applyBatchSize, 1, args.batchSize, DEFAULT_APPLY_BATCH_SIZE);
  args.concurrency = clamp(args.concurrency, 1, 50, DEFAULT_CONCURRENCY);
  args.requestsPerMinute = Math.max(0, Math.floor(args.requestsPerMinute || 0));
  args.maxRows = Math.max(0, Math.floor(args.maxRows || 0));
  args.budgetUsd = Math.max(0, Number(args.budgetUsd || 0));
  args.afterId = Math.max(0, Math.floor(args.afterId || 0));
  args.model = args.model || DEFAULT_MODELS[args.provider];
  args.baseUrl = normalizeBaseUrl(args.baseUrl || (args.provider === "ollama" ? OLLAMA_URL : GEMINI_URL));
  args.maxAbstractChars = clamp(args.maxAbstractChars, 1000, 12000, DEFAULT_MAX_ABSTRACT_CHARS);
  args.maxChunkChars = clamp(args.maxChunkChars, 400, 4000, DEFAULT_MAX_CHUNK_CHARS);
  return args;
}

export function normalizeProvider(value) {
  const provider = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
  if (!["gemini", "ollama"].includes(provider)) {
    throw new Error(`Unknown provider "${value}". Use gemini or ollama.`);
  }
  return provider;
}

export function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function clamp(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function printHelp() {
  console.log(`Usage:
  node scripts/contextualize-evidence-chunks.js [options]

Options:
  --dry-run                         Fetch rows and build prompts, but do not call the LLM or write DB rows.
  --provider=gemini|ollama          LLM provider. Default: ${DEFAULT_PROVIDER}.
  --model=MODEL                     Model name. Defaults: gemini=${DEFAULT_MODELS.gemini}, ollama=${DEFAULT_MODELS.ollama}.
  --base-url=URL                    Provider base URL. Ollama default: ${OLLAMA_URL}.
  --max-rows=N                      Stop after N chunks. Default: unlimited.
  --budget-usd=N                    Stop before starting a new batch once observed spend reaches N dollars. Gemini only; Ollama cost is recorded as 0.
  --after-id=N                      Start after evidence_chunks.id N. Default: 0.
  --batch-size=N                    Rows fetched/applied per loop. Default: ${DEFAULT_BATCH_SIZE}.
  --apply-batch-size=N              Rows written per DB apply RPC. Default: ${DEFAULT_APPLY_BATCH_SIZE}.
  --concurrency=N                   Parallel LLM requests. Default: ${DEFAULT_CONCURRENCY}.
  --requests-per-minute=N           Global request pace. Default: ${DEFAULT_REQUESTS_PER_MINUTE}.
  --retry-errors                    Retry rows with context_error set.
  --max-abstract-chars=N            Truncate article abstract in prompt. Default: ${DEFAULT_MAX_ABSTRACT_CHARS}.
  --max-chunk-chars=N               Truncate chunk in prompt. Default: ${DEFAULT_MAX_CHUNK_CHARS}.
`);
}

export function assertConfigured(args) {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!args.dryRun && args.provider === "gemini" && !process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY.");
  }
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function truncateText(value, maxChars) {
  const text = normalizeText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

export function authorLine(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return "Unknown";
  const first = normalizeText(authors[0]);
  if (!first) return "Unknown";
  return authors.length > 1 ? `${first} et al.` : first;
}

export function buildPrompt(row, args) {
  const title = normalizeText(row.article_title) || "Unknown title";
  const journal = normalizeText(row.journal) || "Unknown journal";
  const year = row.publication_year || "unknown year";
  const authors = authorLine(row.authors);
  const abstract = truncateText(row.abstract, args.maxAbstractChars) || "No abstract available.";
  const chunkContent = truncateText(row.content, args.maxChunkChars);

  if ((row.chunk_type || "").toLowerCase() === "title") {
    return `<document>
Title: ${title}
Journal: ${journal} (${year})
Authors: ${authors}
Abstract: ${abstract}
</document>

The chunk below is only the paper title:
<chunk>
${chunkContent}
</chunk>

Write a short (35-60 token) retrieval context blurb for this title chunk. Capture what the paper studies using broad searchable terms when appropriate: intervention or exposure, population or model, and primary outcome or domain. Do NOT say "title", "this chunk", or similar meta language. Output ONLY the context, nothing else.`;
  }

  return `<document>
Title: ${title}
Journal: ${journal} (${year})
Authors: ${authors}
Abstract: ${abstract}
</document>

Here is a chunk we want to situate within this paper:
<chunk>
${chunkContent}
</chunk>

Write a short (50-80 token) context blurb for this chunk to improve its retrievability when users search for related questions. Include: what the paper studies (intervention, population, outcome) and what specifically this chunk discusses. Be precise. Output ONLY the context, nothing else.`;
}

export function normalizeGeminiUsage(usage) {
  const promptTokens = Number(usage?.promptTokenCount ?? 0);
  const completionTokens = Number(usage?.candidatesTokenCount ?? 0);
  const totalTokens = Number(usage?.totalTokenCount ?? promptTokens + completionTokens);
  return {
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

export function normalizeOllamaUsage(body, prompt) {
  const promptTokens = Number(body?.prompt_eval_count ?? Math.ceil(normalizeText(prompt).length / 4));
  const completionTokens = Number(body?.eval_count ?? 0);
  return {
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    total_tokens: (Number.isFinite(promptTokens) ? promptTokens : 0) +
      (Number.isFinite(completionTokens) ? completionTokens : 0),
  };
}

export function costUsd(usage, provider) {
  if (provider !== "gemini") return 0;
  return (
    Number(usage.prompt_tokens || 0) * INPUT_PRICE_PER_MILLION_USD / 1_000_000 +
    Number(usage.completion_tokens || 0) * OUTPUT_PRICE_PER_MILLION_USD / 1_000_000
  );
}

export function isRetryableHttp(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function retryDelayMsFromMessage(message) {
  const text = String(message || "");
  const retrySeconds = text.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (retrySeconds) return Math.ceil(Number(retrySeconds[1]) * 1000) + 1000;
  const retryMs = text.match(/retry in\s+(\d+(?:\.\d+)?)ms/i);
  if (retryMs) return Math.ceil(Number(retryMs[1])) + 1000;
  return 0;
}

export async function readJsonResponse(response) {
  const bodyText = await response.text();
  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return { raw: bodyText };
  }
}

export async function callGemini(prompt, args) {
  let lastError;
  const modelPath = args.model.startsWith("models/") ? args.model : `models/${args.model}`;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${args.baseUrl}/${modelPath}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 140,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      const body = await readJsonResponse(response);
      if (!response.ok) {
        const message = body?.error?.message || body?.message || body?.raw || response.statusText;
        const err = new Error(`Gemini ${response.status}: ${message}`);
        err.status = response.status;
        throw err;
      }

      const parts = body?.candidates?.[0]?.content?.parts || [];
      return {
        context: normalizeText(parts.map((part) => part.text || "").join("")),
        latency_ms: Date.now() - started,
        usage: normalizeGeminiUsage(body?.usageMetadata),
      };
    } catch (err) {
      lastError = err;
      const retryable = isRetryableHttp(err.status) || /fetch failed|timeout|network/i.test(err.message);
      if (!retryable || attempt === 5) break;
      const waitMs = retryDelayMsFromMessage(err.message) || Math.min(30000, 750 * 2 ** (attempt - 1));
      console.warn(`[gemini] retrying after ${err.message} (attempt ${attempt}/5, wait ${waitMs}ms)`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export async function callOllama(prompt, args) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${args.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: args.model,
          prompt: `${prompt}\n\n/no_think`,
          stream: false,
          think: false,
          options: {
            temperature: 0.2,
            num_predict: 140,
          },
        }),
      });

      const body = await readJsonResponse(response);
      if (!response.ok) {
        const message = body?.error || body?.message || body?.raw || response.statusText;
        const err = new Error(`Ollama ${response.status}: ${message}`);
        err.status = response.status;
        throw err;
      }

      return {
        context: cleanModelContext(body?.response || ""),
        latency_ms: Date.now() - started,
        usage: normalizeOllamaUsage(body, prompt),
      };
    } catch (err) {
      lastError = err;
      const retryable = isRetryableHttp(err.status) || /fetch failed|timeout|network|ECONNREFUSED/i.test(err.message);
      if (!retryable || attempt === 3) break;
      const waitMs = Math.min(5000, 500 * 2 ** (attempt - 1));
      console.warn(`[ollama] retrying after ${err.message} (attempt ${attempt}/3, wait ${waitMs}ms)`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export function cleanModelContext(value) {
  return normalizeText(
    String(value || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\|channel\|>thought\s*[\r\n]+[\s\S]*?<channel\|>/gi, "")
      .replace(/^["'`]+|["'`]+$/g, "")
  );
}

export async function callProvider(prompt, args) {
  if (args.provider === "gemini") return callGemini(prompt, args);
  if (args.provider === "ollama") return callOllama(prompt, args);
  throw new Error(`Unsupported provider: ${args.provider}`);
}

export function createRateLimiter(requestsPerMinute) {
  if (!requestsPerMinute || requestsPerMinute <= 0) return null;
  const spacingMs = Math.ceil(60000 / requestsPerMinute);
  let nextAt = 0;
  let chain = Promise.resolve();

  return async function waitForTurn() {
    const previous = chain;
    let release;
    chain = new Promise((resolve) => {
      release = resolve;
    });

    await previous;
    const now = Date.now();
    const waitMs = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + spacingMs;
    release();
    if (waitMs > 0) await sleep(waitMs);
  };
}

export async function fetchBatch(args, cursor, remaining) {
  const limit = remaining > 0 ? Math.min(args.batchSize, remaining) : args.batchSize;
  const { data, error } = await supabaseAdmin.rpc("fetch_contextualization_batch", {
    p_limit: limit,
    p_after_id: cursor,
    p_retry_errors: args.retryErrors,
  });
  if (error) {
    throw new Error(
      `fetch_contextualization_batch failed: ${error.message}. Apply supabase/20260423_contextual_embeddings.sql first.`
    );
  }
  return data || [];
}

export async function applyResults(results, applyBatchSize) {
  if (results.length === 0) return 0;
  let applied = 0;
  for (let index = 0; index < results.length; index += applyBatchSize) {
    const batch = results.slice(index, index + applyBatchSize);
    const { data, error } = await supabaseAdmin.rpc("apply_contextualization_results", {
      updates: batch,
    });
    if (error) {
      throw new Error(
        `apply_contextualization_results failed for rows ${index + 1}-${index + batch.length}/${results.length}: ${error.message}`
      );
    }
    applied += Number(data || 0);
  }
  return applied;
}

export async function contextualizeRow(row, args, limiter) {
  const prompt = buildPrompt(row, args);
  if (args.dryRun) {
    return {
      id: row.id,
      prompt_chars: prompt.length,
      dry_run: true,
      preview: truncateText(prompt, 260),
    };
  }

  try {
    if (limiter) await limiter();
    const response = await callProvider(prompt, args);
    if (!response.context) throw new Error(`${args.provider} returned empty context`);
    return {
      id: row.id,
      context_prefix: response.context,
      context_provider: args.provider,
      context_model: args.model,
      context_prompt_version: PROMPT_VERSION,
      context_latency_ms: response.latency_ms,
      context_prompt_tokens: response.usage.prompt_tokens,
      context_completion_tokens: response.usage.completion_tokens,
      context_cost_usd: Number(costUsd(response.usage, args.provider).toFixed(8)),
      context_error: null,
    };
  } catch (err) {
    return {
      id: row.id,
      context_prefix: null,
      context_provider: args.provider,
      context_model: args.model,
      context_prompt_version: PROMPT_VERSION,
      context_latency_ms: null,
      context_prompt_tokens: null,
      context_completion_tokens: null,
      context_cost_usd: null,
      context_error: err.message,
    };
  }
}

export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker(workerIndex) {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await mapper(items[current], current, workerIndex);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, (_, index) => worker(index + 1))
  );
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  assertConfigured(args);

  const limiter = createRateLimiter(args.requestsPerMinute);
  let cursor = args.afterId;
  let totalSeen = 0;
  let totalApplied = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalCost = 0;
  const startedAt = Date.now();

  console.log(
    `[context] provider=${args.provider} model=${args.model} baseUrl=${args.baseUrl} batch=${args.batchSize} applyBatch=${args.applyBatchSize} concurrency=${args.concurrency} rpm=${args.requestsPerMinute || "unlimited"} maxRows=${args.maxRows || "unlimited"} budgetUsd=${args.budgetUsd || "none"} dryRun=${args.dryRun}`
  );

  while (true) {
    if (args.budgetUsd > 0 && totalCost >= args.budgetUsd) {
      console.log(`[context] budget reached: $${totalCost.toFixed(4)} >= $${args.budgetUsd.toFixed(4)}`);
      break;
    }

    const remaining = args.maxRows > 0 ? args.maxRows - totalSeen : 0;
    if (args.maxRows > 0 && remaining <= 0) break;

    const rows = await fetchBatch(args, cursor, remaining);
    if (rows.length === 0) break;

    cursor = Number(rows[rows.length - 1].id);
    totalSeen += rows.length;

    const results = await mapLimit(rows, args.concurrency, (row) =>
      contextualizeRow(row, args, limiter)
    );

    if (args.dryRun) {
      for (const result of results.slice(0, 3)) {
        console.log(`[dry-run] chunk=${result.id} prompt_chars=${result.prompt_chars} ${result.preview}`);
      }
      console.log(`[dry-run] fetched=${rows.length} cursor=${cursor}`);
      continue;
    }

    const applied = await applyResults(results, args.applyBatchSize);
    const successes = results.filter((r) => !r.context_error).length;
    const failures = results.length - successes;
    const cost = results.reduce((sum, r) => sum + Number(r.context_cost_usd || 0), 0);
    totalApplied += applied;
    totalSuccess += successes;
    totalFailed += failures;
    totalCost += cost;

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[context] batch=${rows.length} applied=${applied} ok=${successes} failed=${failures} cursor=${cursor} total=${totalApplied} cost=$${totalCost.toFixed(4)} elapsed=${elapsedSec}s`
    );
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[context] done seen=${totalSeen} applied=${totalApplied} ok=${totalSuccess} failed=${totalFailed} cost=$${totalCost.toFixed(4)} elapsed=${elapsedSec}s cursor=${cursor}`
  );
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  main().catch((err) => {
    console.error("[context] FAILED:", err);
    process.exit(1);
  });
}
