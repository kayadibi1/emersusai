import { buildMessages } from "./prompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";

// Prompt-cache routing key. Bumping the version forces a fresh cache slot
// (use when the system prompt or tool schemas change enough to invalidate
// prior cached prefixes). Shared across all users — the system prompt
// dominates the cached prefix, so per-user sharding would hurt aggregate
// hit rate at current traffic levels.
const PROMPT_CACHE_KEY = "emersus-coach-v1";

// No server-side intent detection — the model self-routes via tool_choice
// "auto" (default). Tool descriptions carry strong trigger phrases so the
// model knows when to call each tool. See tools.js descriptions.

export function buildRequestBody({ messages, tools, model, toolChoice, metadata }) {
  const body = {
    model,
    stream: true,
    max_output_tokens: 16000,
    input: messages,
    prompt_cache_key: PROMPT_CACHE_KEY,
    prompt_cache_retention: "24h",
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
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (!RETRY_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
      // Drain the body so the connection can be reused
      await response.text().catch(() => "");
      lastErr = new Error(`status ${response.status}`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (attempt === maxAttempts) throw err;
      lastErr = err;
    }
    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr || new Error("fetchWithRetry exhausted");
}

export { fetchWithRetry };

export async function synthesize(ctx) {
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
  });

  const requestBody = buildRequestBody({
    messages,
    tools: TOOL_DEFINITIONS,
    model,
    metadata: buildMetadata(ctx),
  });

  const start = Date.now();
  const response = await fetchWithRetry(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: ctx._abortController.signal,
    }
  );

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
