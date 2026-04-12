import { validateToolCall } from "./tools.js";
import { formatSources } from "./format-sources.js";

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
    case "response.function_call_arguments.delta": {
      const callId = event.call_id || event.item_id || "unknown";
      if (!state.toolBuffers[callId]) state.toolBuffers[callId] = { name: "", chunks: [] };
      state.toolBuffers[callId].chunks.push(event.delta || "");
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
        const argsStr = event.item.arguments || (toolBuf?.chunks.join("") ?? "");
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
          // Store the raw data anyway so the client can still render it
          // (strict mode already validated the schema on the OpenAI side)
          state.ctx.toolResults[toolName] = args;
          if (state.onTool) state.onTool(toolName, args);
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
    onProse: (delta) => sendSSE(res, { type: "prose", delta }),
    onTool: (name, data) => sendSSE(res, { type: "tool", name, data }),
    onToolError: (name, errors) => sendSSE(res, { type: "tool_error", name, errors }),
  };

  await readStream(ctx._openaiStream, state);

  ctx.prose = state.proseBuffer;
  ctx.sources = formatSources(ctx.evidence?.items || []);

  sendSSE(res, {
    type: "done",
    sources: ctx.sources,
    usage: ctx.tokenUsage,
    debug: ctx.includeDebug ? {
      openai_response_id: ctx._openaiResponseId,
      synthesis_model: ctx._synthesisModel,
      stage_timings: ctx._timer.all(),
    } : undefined,
  });
  res.end();

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
}

/** Buffer mode: collect the full response into ctx. */
export async function streamToBuffer(ctx) {
  const state = {
    ctx,
    proseBuffer: "",
    toolBuffers: {},
    onProse: null,
    onTool: null,
    onToolError: null,
  };

  await readStream(ctx._openaiStream, state);

  ctx.prose = state.proseBuffer;
  ctx.sources = formatSources(ctx.evidence?.items || []);

  logTokenUsage(ctx).catch((err) => console.error("Token usage log error:", err));
  return ctx;
}
