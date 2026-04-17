import { validateToolCall, buildToolDefinitions, SERVER_SIDE_TOOLS } from "./tools.js";
import { formatSources } from "./format-sources.js";
import { PROMPT_CACHE_KEY } from "./synthesize.js";

export function parseSSELine(line) {
  const trimmed = String(line).trim();
  if (!trimmed || !trimmed.startsWith("data: ")) return null;
  const payload = trimmed.slice(6);
  if (payload === "[DONE]") return null;
  try { return JSON.parse(payload); } catch { return null; }
}

export function extractTokenUsage(event) {
  const usage = event?.response?.usage || {};
  const inputDetails = usage.input_tokens_details || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    cached_tokens: inputDetails.cached_tokens || 0,
  };
}

function sendSSE(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === "function") res.flush();
  } catch { /* client disconnected */ }
}

// Valid columns the model is allowed to update via update_user_profile
// in the main chat. onboarding_completed is deliberately excluded — it's
// the onboarding flow's concern, not a user-editable preference.
const MAIN_CHAT_PROFILE_COLUMNS = new Set([
  "goal", "experience_level", "dietary_preferences", "injuries_limitations",
  "equipment_access", "available_days_per_week", "available_minutes_per_session",
  "sleep_stress_context", "primary_use_case", "weight_unit", "distance_unit",
  "preferred_sports", "default_pool_length_m", "default_grade_system",
]);

async function persistProfileUpdates(ctx) {
  const { _supabaseUrl: url, _serviceRoleKey: key, supabaseUserId, _profileUpdates: updates } = ctx;
  if (!url || !key || !supabaseUserId) return;
  if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) return;

  const safeFields = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(updates)) {
    if (MAIN_CHAT_PROFILE_COLUMNS.has(k) && v !== undefined && v !== null && v !== "") {
      safeFields[k] = v;
    }
  }
  if (Object.keys(safeFields).length === 1) return; // only updated_at

  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(supabaseUserId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(safeFields),
    });
    if (!res.ok) {
      console.error("Profile update persist failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Profile update persist error:", err);
  }
}

async function logTokenUsage(ctx) {
  const { _supabaseUrl: url, _serviceRoleKey: key, supabaseUserId, stableUserId, question, plan, tokenUsage } = ctx;
  if (!url || !key || !tokenUsage.total_tokens) return;
  const payload = {
    user_id: supabaseUserId || null,
    stable_user_id: stableUserId || null,
    thread_id: ctx.threadId || null,
    question_preview: String(question || "").slice(0, 320),
    topic: plan?.topic || null,
    risk_level: plan?.riskLevel || null,
    model: ctx._synthesisModel || null,
    openai_response_id: ctx._openaiResponseId || null,
    prompt_tokens: tokenUsage.input_tokens,
    completion_tokens: tokenUsage.output_tokens,
    total_tokens: tokenUsage.total_tokens,
    cached_prompt_tokens: tokenUsage.cached_tokens,
    client_ip_hash: "",
    user_agent: ctx.requestMeta?.userAgent?.slice(0, 300) || "",
    metadata: { source: "emersus.recommendation", generated_at: new Date().toISOString() },
  };
  try {
    await fetch(`${url}/rest/v1/chat_token_usage_events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
  } catch (err) { console.error("Token usage log failed:", err); }
}

// Process events from the stream — shared logic between stream() and streamToBuffer()
function processEvent(event, state) {
  switch (event.type) {
    case "response.output_text.delta":
      state.proseBuffer += event.delta || "";
      if (state.onProse) state.onProse(event.delta || "");
      break;
    // Refusals come on a separate content part, not as regular prose.
    // Stream them to the client as prose so the user still sees the
    // refusal message (e.g. self-harm, PED, medication guardrails).
    case "response.refusal.delta":
      state.proseBuffer += event.delta || "";
      if (state.onProse) state.onProse(event.delta || "");
      break;
    case "response.refusal.done":
      // Full refusal text has already been streamed as deltas; nothing
      // extra to append, but useful for telemetry.
      console.warn("Model refusal:", (event.refusal || "").slice(0, 200));
      break;
    case "response.function_call_arguments.delta": {
      const callId = event.call_id || event.item_id || "unknown";
      if (!state.toolBuffers[callId]) state.toolBuffers[callId] = { name: "", chunks: [] };
      state.toolBuffers[callId].chunks.push(event.delta || "");
      break;
    }
    case "response.function_call_arguments.done": {
      // Safety net: preserve the authoritative final args string in case
      // a delta was dropped. output_item.done prefers event.item.arguments
      // first, then falls back to this.
      const callId = event.call_id || event.item_id || "unknown";
      if (!state.toolBuffers[callId]) state.toolBuffers[callId] = { name: "", chunks: [] };
      if (typeof event.arguments === "string") {
        state.toolBuffers[callId].finalArgs = event.arguments;
      }
      break;
    }
    case "response.output_item.added":
      if (event.item?.type === "function_call") {
        const callId = event.item.call_id || event.item.id || "unknown";
        if (!state.toolBuffers[callId]) state.toolBuffers[callId] = { name: event.item.name || "", chunks: [] };
        else state.toolBuffers[callId].name = event.item.name || "";
      }
      break;
    case "response.output_item.done":
      if (event.item?.type === "function_call") {
        const callId = event.item.call_id || event.item.id;
        const toolBuf = state.toolBuffers[callId];
        const toolName = event.item.name || toolBuf?.name || "unknown";

        const argsStr = event.item.arguments || toolBuf?.finalArgs || (toolBuf?.chunks.join("") ?? "");

        // Server-side tools (e.g. get_user_profile): queue for follow-up,
        // don't forward to the client.
        if (SERVER_SIDE_TOOLS.has(toolName)) {
          let args = null;
          try { args = JSON.parse(argsStr); } catch {}
          if (state.serverToolCalls) state.serverToolCalls.push({ callId, name: toolName, args });
          break;
        }
        let args;
        try { args = JSON.parse(argsStr); } catch (parseErr) {
          console.error(`Tool JSON parse failed for ${toolName}:`, parseErr.message, argsStr.slice(0, 200));
          if (state.onToolError) state.onToolError(toolName, ["Failed to parse tool arguments"]);
          break;
        }
        const validation = validateToolCall(toolName, args);
        if (validation.valid) {
          state.ctx.toolResults[toolName] = validation.data;
          if (state.onTool) state.onTool(toolName, validation.data);
        } else {
          console.error(`Tool validation failed for ${toolName}:`, validation.errors);
          if (state.onToolError) state.onToolError(toolName, validation.errors);
          // Invalid widgets should not render. The most common failure mode is
          // viewport-sized HTML that turns iframe auto-sizing into a runaway
          // growth loop in the chat. Other tool payloads still fall back to
          // raw data so the client can attempt a best-effort render.
          if (toolName !== "emit_widget") {
            state.ctx.toolResults[toolName] = args;
            if (state.onTool) state.onTool(toolName, args);
          }
        }
      }
      break;
    case "response.completed":
      state.ctx._openaiResponseId = event.response?.id || null;
      state.ctx.tokenUsage = extractTokenUsage(event);
      state.ctx._timer.record("synthesis_total_ms", Date.now() - state.ctx._synthesisStartMs);
      break;
    case "response.failed":
      console.error("OpenAI response failed:", event.response?.status_details);
      if (state.onError) state.onError(event.response?.status_details?.error?.message || "response failed");
      break;
    // Mid-stream error (rate limit, context overflow, transient 5xx).
    // Distinct from response.failed (terminal) — error can fire during
    // generation without ending the response object.
    case "error":
      console.error("OpenAI stream error:", event.code, event.message);
      if (state.onError) state.onError(event.message || "stream error");
      break;
  }
}

async function readStream(reader, state) {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of reader) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseSSELine(line);
        if (event) processEvent(event, state);
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    throw err;
  }
}

// ── Server-side tool resolution (multi-turn) ──────────────────────────

/** Strip empty/null/false profile fields so the model only sees what's set. */
function compactProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(profile)) {
    if (v == null || v === "" || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Resolve pending server-side tool calls, then make a follow-up streaming
 * request using previous_response_id so the model can continue generating.
 */
async function resolveAndContinue(state, ctx) {
  const toolOutputs = [];
  for (const tc of state.serverToolCalls) {
    if (tc.name === "get_user_profile") {
      const profile = compactProfile(ctx.profile);
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify(profile || { note: "No profile data saved yet. Use defaults." }),
      });
    } else if (tc.name === "update_user_profile") {
      if (tc.args && typeof tc.args === "object") {
        if (!ctx._profileUpdates) ctx._profileUpdates = {};
        Object.assign(ctx._profileUpdates, tc.args);
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify({ status: "saved" }),
      });
    } else if (tc.name === "remember_fact") {
      // Lazy import so the handler module isn't loaded on every turn when the
      // flag is off. Follows spec §5.2 + §10.2 Phase 1.
      const { resolveRememberFact } = await import("./remember-fact-handler.js");
      const result = await resolveRememberFact({ args: tc.args, ctx });
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify(result),
      });
    } else if (tc.name === "recall_memory") {
      // Phase 3 — on-demand memory query. Lazy-imported.
      const { resolveRecallMemory } = await import("./recall-memory-handler.js");
      const result = await resolveRecallMemory({ args: tc.args, ctx });
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify(result),
      });
    }
  }

  // Reset for next round
  state.serverToolCalls = [];
  state.toolBuffers = {};

  const apiKey = process.env.OPENAI_API_KEY;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ctx._synthesisModel,
      previous_response_id: ctx._openaiResponseId,
      input: toolOutputs,
      tools: buildToolDefinitions(),
      stream: true,
      max_output_tokens: 16000,
      prompt_cache_key: PROMPT_CACHE_KEY,
      prompt_cache_retention: "24h",
    }),
    signal: ctx._abortController.signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.error(`OpenAI follow-up error ${response.status}:`, errBody);
    throw new Error(`Profile follow-up failed (status ${response.status}).`);
  }

  return response.body;
}

/** Pipeline stage: stream SSE to the Express response. */
export async function stream(ctx, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  res.on("close", () => ctx._abortController.abort());

  const state = {
    ctx,
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onProse: (delta) => sendSSE(res, { type: "prose", delta }),
    onTool: (name, data) => sendSSE(res, { type: "tool", name, data }),
    onToolError: (name, errors) => sendSSE(res, { type: "tool_error", name, errors }),
    onError: (message) => sendSSE(res, { type: "error", message }),
  };

  await readStream(ctx._openaiStream, state);

  // Handle server-side tool calls (e.g. get_user_profile) — make a
  // follow-up request with the tool output so the model can continue.
  let followUpAttempts = 0;
  while (state.serverToolCalls.length > 0 && ctx._openaiResponseId && followUpAttempts < 2) {
    followUpAttempts++;
    const followUpStream = await resolveAndContinue(state, ctx);
    await readStream(followUpStream, state);
  }

  ctx.prose = state.proseBuffer;
  ctx.sources = formatSources(ctx.evidence?.items || []);

  sendSSE(res, {
    type: "done",
    sources: ctx.sources,
    confidence: ctx.confidence,
    usage: ctx.tokenUsage,
  });
  res.end();

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
  persistProfileUpdates(ctx).catch((err) => console.error("Profile persist error:", err));
}

/** Buffer mode: collect the full response into ctx. */
export async function streamToBuffer(ctx) {
  const state = {
    ctx,
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onProse: null,
    onTool: null,
    onToolError: null,
    onError: null,
  };

  await readStream(ctx._openaiStream, state);

  let followUpAttempts = 0;
  while (state.serverToolCalls.length > 0 && ctx._openaiResponseId && followUpAttempts < 2) {
    followUpAttempts++;
    const followUpStream = await resolveAndContinue(state, ctx);
    await readStream(followUpStream, state);
  }

  ctx.prose = state.proseBuffer;
  ctx.sources = formatSources(ctx.evidence?.items || []);

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
  persistProfileUpdates(ctx).catch((err) => console.error("Profile persist error:", err));
  return ctx;
}
