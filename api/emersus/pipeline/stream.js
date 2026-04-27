import { validateToolCall, buildToolDefinitions, SERVER_SIDE_TOOLS } from "./tools.js";
import { formatSources } from "./format-sources.js";
import { PROMPT_CACHE_KEY, resolveMaxOutputTokens } from "./synthesize.js";
import { isExtractorEnabled } from "./memory-flags.js";
import { verifyAnswerGrounding } from "./grounding-verifier.js";
import { groundingEnforcementEnabled } from "./prompt.js";
import { sanitizeWidgetPayload } from "../../../shared/widget-v2/payload-sanitizer.js";
import { runMode2Pipeline } from "./mode2-pipeline.js";
import { mode2VerifierEnabled } from "./mode2-flags.js";

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

// Cache the known-tool-names set on first use. buildToolDefinitions()
// is flag-gated (MEMORY_REMEMBER_FACT_ENABLED / MEMORY_RECALL_ENABLED),
// so we rebuild the set each call — cheap, and flags can flip without
// a process restart in prod.
function isKnownToolName(name) {
  if (!name || typeof name !== "string") return false;
  if (SERVER_SIDE_TOOLS.has(name)) return true;
  for (const def of buildToolDefinitions()) {
    if (def?.name === name) return true;
  }
  return false;
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

const WIDGET_V2_TOOL_TO_FAMILY = {
  emit_pharma_widget: "pharma",
  emit_training_widget: "training",
  emit_nutrition_widget: "nutrition",
  emit_evidence_widget: "evidence",
  emit_progress_widget: "progress",
  emit_calculator_widget: "calculator",
};

// Record a widget-v2 emission for later flush. `response.completed` populates
// ctx.tokenUsage / ctx._openaiResponseId AFTER `onTool` fires, so writing the
// row inline would give null output_tokens + null response_id. Buffer here;
// flushWidgetV2Emissions() drains the queue once the response has completed.
function recordWidgetV2Emission(ctx, toolName, data, elapsedMs, validatorResult = "valid") {
  const family = WIDGET_V2_TOOL_TO_FAMILY[toolName];
  if (!family) return;
  if (!ctx._widgetV2Emissions) ctx._widgetV2Emissions = [];
  ctx._widgetV2Emissions.push({
    family,
    type: data?.type || null,
    display_width: data?.display_width || null,
    elapsed_ms: elapsedMs,
    validator_result: validatorResult,
  });
}

async function flushWidgetV2Emissions(ctx) {
  const queue = ctx._widgetV2Emissions;
  if (!Array.isArray(queue) || queue.length === 0) return;
  const { _supabaseUrl: url, _serviceRoleKey: key } = ctx;
  if (!url || !key) return;
  const outputTokens = ctx.tokenUsage?.output_tokens || null;
  const openaiResponseId = ctx._openaiResponseId || null;
  const userId = ctx.supabaseUserId || null;
  const threadId = ctx.threadId || null;
  const rows = queue.map((q) => ({
    user_id: userId,
    thread_id: threadId,
    family: q.family,
    type: q.type,
    output_tokens: outputTokens,
    elapsed_ms: q.elapsed_ms,
    display_width: q.display_width,
    validator_result: q.validator_result,
    openai_response_id: openaiResponseId,
  }));
  try {
    await fetch(`${url}/rest/v1/widget_v2_emission_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    console.error("widget-v2 emission log failed:", err);
  }
  ctx._widgetV2Emissions = [];
}

// Process events from the stream — shared logic between stream() and streamToBuffer()
function processEvent(event, state) {
  switch (event.type) {
    case "response.output_text.delta":
      state.proseBuffer += event.delta || "";
      if (state.onProse) state.onProse(event.delta || "");
      break;
    // Distinct prose-done signal — lets the client switch states cleanly
    // (e.g. stop the typewriter, finalize formatting) before tool calls
    // or the terminal `done` event arrive.
    case "response.output_text.done":
      if (state.onProseDone) state.onProseDone();
      break;
    // Refusals come on a separate content part, not as regular prose.
    // Route them to a distinct refusal channel so the client can style
    // the message as a guardrail refusal instead of normal prose.
    case "response.refusal.delta":
      state.proseBuffer += event.delta || "";
      if (state.onRefusal) state.onRefusal(event.delta || "");
      break;
    case "response.refusal.done":
      console.warn("Model refusal:", (event.refusal || "").slice(0, 200));
      if (state.onRefusalDone) state.onRefusalDone(event.refusal || "");
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
        // Early unknown-tool check: surface the error on `added` so we don't
        // buffer an entire arg payload before discovering the call is bogus.
        // Continue processing the stream — the full-arg validation on
        // `output_item.done` remains the authoritative shape check.
        const announcedName = event.item.name || "";
        if (announcedName && !isKnownToolName(announcedName)) {
          console.warn(`Unknown tool emitted on output_item.added: ${announcedName}`);
          if (state.onToolError) state.onToolError(announcedName, ["unknown_tool"]);
          if (!state.toolBuffers[callId]) state.toolBuffers[callId] = { name: announcedName, chunks: [] };
          state.toolBuffers[callId].unknown = true;
        }
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
          // Grounding sanitizer — strips ungrounded rows from evidence
          // widgets and drops the widget if too few survive. Scope limited
          // to emit_evidence_widget in this pass (2026-04-23 P1 diagnostic).
          const sanitized = sanitizeWidgetPayload(toolName, validation.data, state.ctx);
          if (sanitized.valid) {
            state.ctx.toolResults[toolName] = sanitized.data;
            if (sanitized.drops?.length) {
              console.log(`[sanitizer] ${toolName}:`, sanitized.drops.join("; "));
            }
            if (state.onTool) state.onTool(toolName, sanitized.data);
          } else {
            console.warn(`[sanitizer] ${toolName} dropped:`, sanitized.errors.join("; "));
            if (state.onToolError) state.onToolError(toolName, sanitized.errors);
          }
        } else {
          console.error(`Tool validation failed for ${toolName}:`, validation.errors);
          if (state.onToolError) state.onToolError(toolName, validation.errors);
          // Invalid widgets should not render. The most common failure mode is
          // viewport-sized HTML that turns iframe auto-sizing into a runaway
          // growth loop in the chat. widget-v2 emit_*_widget tools are
          // strictly validated — invalid payloads surface a diagnostic via
          // tool_error; we never fall back to raw data for them. Other tool
          // payloads still fall back so the client can attempt a best-effort
          // render.
          const isWidgetV2Tool = /^emit_(pharma|training|nutrition|evidence|progress|calculator)_widget$/.test(toolName);
          if (toolName !== "emit_widget" && !isWidgetV2Tool) {
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
    // Partial response (max_output_tokens hit, content_filter, etc.).
    // Capture usage/response id like `completed`, but also surface the
    // incompleteness reason so the client can decide whether to offer a
    // retry or a "continue" affordance.
    case "response.incomplete": {
      state.ctx._openaiResponseId = event.response?.id || null;
      state.ctx.tokenUsage = extractTokenUsage(event);
      if (state.ctx._synthesisStartMs) {
        state.ctx._timer.record("synthesis_total_ms", Date.now() - state.ctx._synthesisStartMs);
      }
      const reason =
        event.response?.incomplete_details?.reason ||
        event.incomplete_details?.reason ||
        "unknown";
      console.warn("OpenAI response incomplete:", reason);
      state.ctx._incompleteReason = reason;
      if (state.onIncomplete) state.onIncomplete(reason);
      break;
    }
    // Terminal failure — the response object ended in an error state.
    // Not recoverable from the client's point of view; the client should
    // surface a retry button rather than attempt a continuation.
    case "response.failed": {
      const message = event.response?.status_details?.error?.message || "response failed";
      console.error("OpenAI response failed:", event.response?.status_details);
      if (state.onFailed) state.onFailed(message);
      else if (state.onError) state.onError(message);
      break;
    }
    // Mid-stream error (rate limit, context overflow, transient 5xx).
    // Distinct from response.failed (terminal) — error can fire during
    // generation without ending the response object, so the client may
    // choose to retry or keep what it already has.
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
      const body = JSON.stringify(profile || { note: "No profile data saved yet. Use defaults." });
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: `<user_profile_untrusted>${body}</user_profile_untrusted>`,
      });
    } else if (tc.name === "update_user_profile") {
      if (tc.args && typeof tc.args === "object") {
        if (!ctx._profileUpdates) ctx._profileUpdates = {};
        Object.assign(ctx._profileUpdates, tc.args);
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: `<profile_update_untrusted>${JSON.stringify({ status: "saved" })}</profile_update_untrusted>`,
      });
    } else if (tc.name === "remember_fact") {
      // Lazy import so the handler module isn't loaded on every turn when the
      // flag is off. Follows spec §5.2 + §10.2 Phase 1.
      const { resolveRememberFact } = await import("./remember-fact-handler.js");
      const result = await resolveRememberFact({ args: tc.args, ctx });
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: `<remember_fact_untrusted>${JSON.stringify(result)}</remember_fact_untrusted>`,
      });
    } else if (tc.name === "recall_memory") {
      // Phase 3 — on-demand memory query. Lazy-imported.
      const { resolveRecallMemory } = await import("./recall-memory-handler.js");
      const result = await resolveRecallMemory({ args: tc.args, ctx });
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: `<memory_untrusted>${JSON.stringify(result)}</memory_untrusted>`,
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
      // Follow-up turn after a server-side tool output: recap + optional
      // single additional tool call. Much smaller budget than a fresh
      // synthesis turn.
      max_output_tokens: resolveMaxOutputTokens("tool_followup"),
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

/**
 * Run the MQPV pipeline against ctx and update ctx in place.
 * No SSE side effects — the caller wires those via opts.
 *
 * @param {Object} ctx — chat pipeline context
 * @param {Object} [opts]
 * @param {Function} [opts.onVerifying] — invoked once before MQPV runs (so streaming caller can SSE "verifying")
 * @param {Function} [opts.onProseUpdated] — invoked when prose was rewritten (passed the new prose string)
 * @param {Function} [opts.onMqpvNoChange] — invoked when MQPV ran but produced no rewrite
 * @param {Function} [opts.onMqpvError] — invoked when MQPV pipeline threw (passed the error)
 */
async function runMqpvAndUpdateCtx(ctx, opts = {}) {
  if (!mode2VerifierEnabled() || (ctx.evidence?.items?.length || 0) === 0) return;
  if (opts.onVerifying) opts.onVerifying();
  try {
    const mqpv = await runMode2Pipeline(ctx);
    ctx.mode2 = mqpv.telemetry;
    ctx.mode2_pre_prose = ctx.prose;
    if (mqpv.rewritten_prose) {
      ctx.prose = mqpv.rewritten_prose;
      ctx.mode2_post_prose = ctx.prose;
      // Re-run grounding verifier so the badge reflects the rewritten prose.
      ctx.grounding = verifyAnswerGrounding({
        answerText: ctx.prose,
        evidenceItems: ctx.evidence?.items || [],
        mode: groundingEnforcementEnabled() ? "citation" : "legacy",
      });
      if (opts.onProseUpdated) opts.onProseUpdated(ctx.prose);
    } else {
      ctx.mode2_post_prose = ctx.prose;
      if (opts.onMqpvNoChange) opts.onMqpvNoChange();
    }
  } catch (err) {
    console.warn("[mqpv] pipeline failed:", err?.message || err);
    // Preserve telemetry shape even on error so downstream consumers
    // (workflow.js insert + mode2-trend.js) see consistent fields.
    ctx.mode2 = {
      rewrites_attempted: 0,
      initial_failures: null,
      after_r1_failures: null,
      final_failures: null,
      extraction_cost_usd: 0,
      validation_cost_usd: 0,
      rewrite_cost_usd: 0,
      extraction_latency_ms: 0,
      validation_latency_ms: 0,
      rewrite_latency_ms: 0,
      total_latency_ms: 0,
      qualifiers_dropped_breakdown: {},
      validation_json: null,
      error: err?.message || String(err),
      errors: { pipeline: err?.message || String(err) },
    };
    if (opts.onMqpvError) opts.onMqpvError(err);
  }
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
    onTool: (name, data) => {
      sendSSE(res, { type: "tool", name, data });
      if (WIDGET_V2_TOOL_TO_FAMILY[name]) {
        const elapsedMs = ctx._synthesisStartMs ? (Date.now() - ctx._synthesisStartMs) : null;
        recordWidgetV2Emission(ctx, name, data, elapsedMs, "valid");
      }
    },
    onToolError: (name, errors) => {
      sendSSE(res, { type: "tool_error", name, errors });
      if (WIDGET_V2_TOOL_TO_FAMILY[name]) {
        const elapsedMs = ctx._synthesisStartMs ? (Date.now() - ctx._synthesisStartMs) : null;
        recordWidgetV2Emission(ctx, name, { type: null, display_width: null }, elapsedMs, "invalid");
      }
    },
    onProseDone: () => sendSSE(res, { type: "prose_done" }),
    onRefusal: (delta) => sendSSE(res, { type: "refusal_chunk", delta }),
    onRefusalDone: (refusal) => sendSSE(res, { type: "refusal_done", refusal }),
    onIncomplete: (reason) => sendSSE(res, { type: "incomplete", reason, partial: true }),
    onFailed: (message) => sendSSE(res, { type: "response_failed", message }),
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
  ctx.grounding = verifyAnswerGrounding({
    answerText: ctx.prose,
    evidenceItems: ctx.evidence?.items || [],
    mode: groundingEnforcementEnabled() ? "citation" : "legacy",
  });

  // Mode-2 Qualifier-Preservation Verifier (MQPV).
  // Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md
  // Runs after grounding verifier; rewrites prose if cited claims dropped
  // source qualifiers. Flag-gated (default off).
  await runMqpvAndUpdateCtx(ctx, {
    onVerifying: () => sendSSE(res, { type: "verifying" }),
    onProseUpdated: (content) => {
      sendSSE(res, { type: "prose_updated", content });
      sendSSE(res, { type: "mqpv_done", changed: true });
    },
    onMqpvNoChange: () => sendSSE(res, { type: "mqpv_done", changed: false }),
    onMqpvError: () => sendSSE(res, { type: "mqpv_done", changed: false, error: true }),
  });

  sendSSE(res, {
    type: "done",
    sources: ctx.sources,
    confidence: ctx.confidence,
    grounding: ctx.grounding,
    usage: ctx.tokenUsage,
    // Flat, frontend-friendly mirrors of the nested usage object. The rail
    // consumer reads these directly without needing to understand OpenAI's
    // input_tokens_details shape. `cachedTokens` is the input tokens served
    // from the prompt cache — the KPI for tuning the cached prefix.
    cachedTokens: ctx.tokenUsage?.cached_tokens || 0,
    inputTokens: ctx.tokenUsage?.input_tokens || 0,
    outputTokens: ctx.tokenUsage?.output_tokens || 0,
    // OpenAI server-side response id (stored at OpenAI when `store: true`
    // is on in buildRequestBody). Client persists this on the assistant
    // message. Phase 2: pass as previous_response_id on the next turn to
    // reduce input-token billing on multi-turn threads. Not yet wired;
    // requires delta system-prompt handling + 30-day expiry fallback.
    responseId: ctx._openaiResponseId || null,
    // Whether response chaining (previous_response_id) was used for this
    // turn. Set by workflow.js from resolveChainingContext().shouldChain.
    // Strict boolean — the client + ops can log/analyze chain adoption
    // per turn without peeking at the feature flag surface.
    chainingUsed: ctx._chainingUsed === true,
    // Extra flags when the underlying response ended in `incomplete` (e.g.
    // max_output_tokens / content_filter). Clients that ignore unknown
    // fields remain compatible; new clients can surface a "continue" CTA.
    ...(ctx._incompleteReason ? { incomplete: true, reason: ctx._incompleteReason } : {}),
  });
  res.end();

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
  flushWidgetV2Emissions(ctx).catch((err) => console.error("widget-v2 flush error:", err));
  persistProfileUpdates(ctx).catch((err) => console.error("Profile persist error:", err));
  maybeExtractMemory(ctx);
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
  ctx.grounding = verifyAnswerGrounding({
    answerText: ctx.prose,
    evidenceItems: ctx.evidence?.items || [],
    mode: groundingEnforcementEnabled() ? "citation" : "legacy",
  });

  // MQPV — buffer-mode parallel. No SSE callbacks — buffer mode has no SSE.
  await runMqpvAndUpdateCtx(ctx);

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
  persistProfileUpdates(ctx).catch((err) => console.error("Profile persist error:", err));
  maybeExtractMemory(ctx);
  return ctx;
}

// ── Phase 5: fire-and-forget memory extraction ────────────────────────
// Runs after the assistant stream fully writes. Flag-gated on
// MEMORY_EXTRACTOR_ENABLED. Never awaited — errors logged-and-swallowed
// so a bad extraction never leaks to the client. Reads last 2 user/assistant
// pairs for context (catches mid-thread retractions per spec §9.2).
function maybeExtractMemory(ctx) {
  if (!isExtractorEnabled()) return;
  const recent = Array.isArray(ctx.recentMessages) ? ctx.recentMessages.slice(-4) : [];
  import("./extract-memory.js")
    .then(({ extractMemory }) =>
      extractMemory({
        supabaseUserId: ctx.supabaseUserId,
        threadId: ctx.threadId,
        _openaiResponseId: ctx._openaiResponseId,
        question: ctx.question,
        lastAssistantReply: ctx.prose || "",
        recentPairs: recent,
      }, {
        supabaseUrl: ctx._supabaseUrl || process.env.SUPABASE_URL,
        serviceRoleKey: ctx._serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    )
    .catch((err) => console.warn("[extractMemory] failed:", err?.message || err));
}

// Test-only export. Do not import from production code.
export const __testables = { processEvent };
