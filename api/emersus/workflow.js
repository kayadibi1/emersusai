import { ShortCircuit, createContext } from "./pipeline/context.js";
import { computeConfidence } from "./pipeline/confidence.js";
import { sanitize, validateRequest } from "./pipeline/sanitize.js";
import { safety } from "./pipeline/safety.js";
import { planRetrieval } from "./pipeline/retrieval-policy.js";
import { retrieve } from "./pipeline/retrieve.js";
import { retrieveMemory } from "./pipeline/retrieve-memory.js";
import { synthesize } from "./pipeline/synthesize.js";
import { stream, streamToBuffer } from "./pipeline/stream.js";
import { capture, Sentry } from "../lib/analytics.js";

function parseJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); }
    catch (_error) {
      const error = new Error("Request body must be valid JSON.");
      error.statusCode = 400;
      throw error;
    }
  }
  return req.body;
}

function sendResponse(res, response) {
  if (!res.headersSent) res.status(200).json(response);
}

async function generateRecommendationStream(rawInput, res) {
  const startedAt = Date.now();
  let ctx = createContext(rawInput);
  try {
    ctx = await sanitize(ctx);
    ctx = await safety(ctx);
    ctx = await planRetrieval(ctx);
    // Phase 2: memory retrieval runs in parallel with evidence retrieval.
    // retrieveMemory mutates ctx.crossThreadMemory on success; no-op on
    // failure. Both are independent reads — neither depends on the other.
    const [evResult, memResult] = await Promise.allSettled([
      retrieve(ctx),
      retrieveMemory(ctx),
    ]);
    if (evResult.status === "fulfilled") ctx = evResult.value;
    else throw evResult.reason; // evidence is load-bearing for the pipeline
    if (memResult.status === "rejected") {
      console.warn("[workflow] retrieveMemory failed:", memResult.reason?.message || memResult.reason);
    }
    ctx.confidence = computeConfidence({ plan: ctx.plan, evidence: ctx.evidence });
    ctx = await synthesize(ctx);
    await stream(ctx, res);
    capture(ctx.stableUserId || "anonymous", "chat_stream_complete", {
      latency_ms: Date.now() - startedAt,
      evidence_count: ctx.evidence?.length || 0,
      sources_count: ctx.sources?.length || 0,
      confidence: ctx.confidence?.level || null,
      memory_used: memResult.status === "fulfilled",
      model: ctx.tokenUsage?.model || null,
      tokens_in: ctx.tokenUsage?.input_tokens || null,
      tokens_out: ctx.tokenUsage?.output_tokens || null,
    });
  } catch (err) {
    if (err instanceof ShortCircuit) {
      capture(ctx.stableUserId || "anonymous", "chat_short_circuit", {
        reason: err.response?.guardrail?.response_mode || "unknown",
        latency_ms: Date.now() - startedAt,
      });
      const shortResponse = err.response;
      if (shortResponse.onboarding_progress !== null && shortResponse.onboarding_progress !== undefined) {
        shortResponse.onboarding = {
          progress: shortResponse.onboarding_progress,
          completed: shortResponse.onboarding_completed === true,
        };
      }
      return sendResponse(res, shortResponse);
    }
    Sentry?.captureException?.(err, { tags: { pipeline: "stream" } });
    capture(ctx.stableUserId || "anonymous", "chat_stream_failed", {
      latency_ms: Date.now() - startedAt,
      error_name: err?.name || "Error",
      mid_stream: res.headersSent,
    });
    if (res.headersSent) {
      try {
        console.error("Pipeline error (mid-stream):", err);
        res.write(`data: ${JSON.stringify({ type: "error", message: "An internal error occurred. Please try again." })}\n\n`);
        res.end();
      } catch { /* client gone */ }
      return;
    }
    throw err;
  }
}

async function generateRecommendationJSON(rawInput) {
  let ctx = createContext(rawInput);
  try {
    ctx = await sanitize(ctx);
    ctx = await safety(ctx);
    ctx = await planRetrieval(ctx);
    // Phase 2: parallel evidence + memory retrieval. Same pattern as the
    // streaming path.
    const [evResult, memResult] = await Promise.allSettled([
      retrieve(ctx),
      retrieveMemory(ctx),
    ]);
    if (evResult.status === "fulfilled") ctx = evResult.value;
    else throw evResult.reason;
    if (memResult.status === "rejected") {
      console.warn("[workflow] retrieveMemory failed:", memResult.reason?.message || memResult.reason);
    }
    ctx.confidence = computeConfidence({ plan: ctx.plan, evidence: ctx.evidence });
    ctx = await synthesize(ctx);
    ctx = await streamToBuffer(ctx);
  } catch (err) {
    if (err instanceof ShortCircuit) return err.response;
    throw err;
  }
  return {
    user: { id: ctx.stableUserId || null },
    plan: ctx.plan,
    summary: ctx.prose.slice(0, 600),
    answer_text: ctx.prose,
    tool_results: ctx.toolResults,
    sources: ctx.sources,
    confidence: ctx.confidence,
    token_usage: ctx.tokenUsage,
    guardrail: { status: "allowed", response_mode: "normal", reasons: [] },
  };
}

async function generateRecommendation(rawInput) {
  return generateRecommendationJSON(rawInput);
}

export {
  generateRecommendation,
  generateRecommendationStream,
  generateRecommendationJSON,
  parseJsonBody,
  validateRequest,
};
