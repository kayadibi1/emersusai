import { buildMessages } from "./prompt.js";
import { buildToolDefinitions } from "./tools.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";

// Prompt-cache routing key. Bumping the version forces a fresh cache slot
// (use when the system prompt or tool schemas change enough to invalidate
// prior cached prefixes). Shared across all users — the system prompt
// dominates the cached prefix, so per-user sharding would hurt aggregate
// hit rate at current traffic levels.
const PROMPT_CACHE_KEY = "emersus-coach-v1";

// Per-turn-type output caps. The legacy 16000 across the board masked
// runaway completions and gave conversational turns a budget they never
// needed. Tune per call site:
//   synthesis     — main chat prose + up to two widget/plan tool calls
//   onboarding    — short structured follow-ups in onboarding.js
//   memory_extract — extract-memory: tiny JSON object
//   tool_followup — continuation after a function_call_output (recap + maybe
//                   one more tool call; no long plans)
const MAX_OUTPUT_TOKENS = {
  synthesis: 8000,
  onboarding: 1500,
  memory_extract: 1000,
  tool_followup: 4000,
};

export function resolveMaxOutputTokens(kind = "synthesis") {
  return MAX_OUTPUT_TOKENS[kind] ?? 8000;
}

// No server-side intent detection — the model self-routes via tool_choice
// "auto" (default). Tool descriptions carry strong trigger phrases so the
// model knows when to call each tool. See tools.js descriptions.

export function buildRequestBody({ messages, tools, model, toolChoice, metadata, kind = "synthesis", chainingContext = null }) {
  const body = {
    model,
    stream: true,
    max_output_tokens: resolveMaxOutputTokens(kind),
    input: messages,
    prompt_cache_key: PROMPT_CACHE_KEY,
    prompt_cache_retention: "24h",
    // Let the model dispatch independent tool calls (e.g. get_user_profile
    // alongside a widget emit) concurrently instead of serialising — trims
    // wall-clock on multi-tool turns.
    parallel_tool_calls: true,
    // Server-side state retention at OpenAI. Gives us conversation visibility
    // in the OpenAI dashboard and captures response.id for every turn so a
    // future session can flip to previous_response_id chaining. Content is
    // exercise-science coaching advice (not sensitive health data); OpenAI
    // retains stored responses for 30 days per their retention policy.
    // Phase 2: pass ctx._openaiResponseId as previous_response_id on the next
    // turn to reduce input-token billing on multi-turn threads. Not yet wired;
    // requires delta system-prompt handling + 30-day expiry fallback.
    store: true,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }
  if (metadata && Object.keys(metadata).length > 0) {
    body.metadata = metadata;
  }
  // Response chaining: when chainingContext signals a viable previous turn,
  // drop the prior conversation from `input` (OpenAI already has it via
  // previous_response_id) and keep only system prompts + the newest user
  // turn. Trimming + previous_response_id are a linked pair — do ONE if and
  // only if we can do BOTH (defensive: a pathological no-user-message case
  // falls through to full history rather than sending an empty chained turn).
  if (chainingContext?.shouldChain && chainingContext.previousResponseId) {
    const systemPrompts = (Array.isArray(body.input) ? body.input : []).filter(
      (m) => m.role === "system"
    );
    let lastUserIdx = -1;
    for (let i = body.input.length - 1; i >= 0; i--) {
      if (body.input[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      body.input = [...systemPrompts, body.input[lastUserIdx]];
      body.previous_response_id = chainingContext.previousResponseId;
    }
    // Else: no user message — unusual; leave body unchanged (full-history fallback).
  }
  return body;
}

export { PROMPT_CACHE_KEY };

// OpenAI metadata fields: strings only, max 16 keys, values ≤ 512 chars.
function buildMetadata(ctx) {
  const md = {};
  if (ctx.threadId) md.thread_id = String(ctx.threadId).slice(0, 512);
  if (ctx.supabaseUserId) md.user_id = String(ctx.supabaseUserId).slice(0, 512);
  if (ctx.plan?.topic) md.topic = String(ctx.plan.topic).slice(0, 512);
  if (ctx.plan?.riskLevel) md.risk_level = String(ctx.plan.riskLevel).slice(0, 512);
  return md;
}

// Transient HTTP statuses we retry once with a short backoff. 5xx and 429
// are OpenAI's documented transient conditions; 4xx (auth, bad request)
// are not retried.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

async function fetchWithRetry(url, init, { maxAttempts = 3, baseDelayMs = 250 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Next-attempt backoff (computed here so 429s can override with retry-after).
    // Exponential base + small random jitter — prevents thundering herd when
    // multiple in-flight requests share the same backoff window.
    let delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 250;
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (!RETRY_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      // If the server explicitly tells us when to retry (seconds), honor it
      // — but keep `delay` as the floor and cap at 30s so a pathological
      // header can't stall the pipeline indefinitely.
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          delay = Math.min(30_000, Math.max(delay, retryAfter * 1000));
        }
      }
      // Drain the body so the connection can be reused
      await response.text().catch(() => "");
      lastErr = new Error(`status ${response.status}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (attempt === maxAttempts) throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr || new Error("fetchWithRetry exhausted");
}

export { fetchWithRetry };

export async function synthesize(ctx, { chainingContext = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const model = DEFAULT_MODEL;
  ctx._synthesisModel = model;

  const messages = buildMessages({
    question: ctx.question,
    threadState: ctx.threadState,
    recentMessages: ctx.recentMessages,
    evidence: ctx.evidence,
    workoutPlan: ctx.workoutPlan,
    crossThreadMemory: ctx.crossThreadMemory,
  });

  const requestBody = buildRequestBody({
    messages,
    tools: buildToolDefinitions(),
    model,
    metadata: buildMetadata(ctx),
    chainingContext,
  });

  const start = Date.now();
  // 60s outbound connect/headers timeout. This guards ONLY the initial
  // fetch + TTFB; once the stream is established, the existing user-disconnect
  // abort (ctx._abortController) takes over for the lifetime of the stream.
  // Cleared in the finally so we don't leave timers racing against a healthy
  // long-lived SSE response.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("timeout"), 60_000);
  const combinedSignal = typeof AbortSignal.any === "function"
    ? AbortSignal.any([ctx._abortController.signal, timeoutController.signal])
    : ctx._abortController.signal;
  // Fallback for runtimes without AbortSignal.any: forward the timeout into
  // the user-disconnect controller so a stalled connect still aborts.
  if (typeof AbortSignal.any !== "function") {
    timeoutController.signal.addEventListener("abort", () => {
      try { ctx._abortController.abort("timeout"); } catch { /* already aborted */ }
    }, { once: true });
  }

  let response;
  try {
    response = await fetchWithRetry(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.error(`OpenAI API error ${response.status}:`, errBody);
    throw new Error(`Synthesis failed (status ${response.status}). Please try again.`);
  }

  ctx._timer.record("synthesis_ttfb_ms", Date.now() - start);
  ctx._openaiStream = response.body;
  ctx._synthesisStartMs = start;

  return ctx;
}
