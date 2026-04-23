import { ShortCircuit, createContext } from "./pipeline/context.js";
import { computeConfidence } from "./pipeline/confidence.js";
import { sanitize, validateRequest } from "./pipeline/sanitize.js";
import { safety } from "./pipeline/safety.js";
import { planRetrieval } from "./pipeline/retrieval-policy.js";
import { retrieve } from "./pipeline/retrieve.js";
import { retrieveMemory } from "./pipeline/retrieve-memory.js";
import { synthesize } from "./pipeline/synthesize.js";
import { stream, streamToBuffer } from "./pipeline/stream.js";
import { resolveChainingContext } from "./pipeline/response-chaining.js";
import { capture, Sentry } from "../lib/analytics.js";
import { supabaseAdmin } from "../lib/clients.js";

// Periodic prod sampling of (question, sources, answer, grounding) so a
// downstream grader can track citation-quality drift over time without
// running the full 100-prompt eval. GROUNDING_SAMPLE_RATE is a string
// in [0..1]; default 0 disables sampling entirely. Writes are fire-and-
// forget — a DB error never affects the user-visible response.
function groundingSampleRate() {
  const raw = Number(process.env.GROUNDING_SAMPLE_RATE || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(1, raw);
}

async function maybeSampleGroundingTurn(ctx) {
  const rate = groundingSampleRate();
  if (rate <= 0) return;
  if (Math.random() >= rate) return;
  if (!supabaseAdmin) return;
  if (!ctx?.prose || !ctx?.evidence?.items?.length) return;
  const sources = (ctx.evidence.items || []).map((it) => ({
    title: it.title,
    excerpt: it.excerpt,
    journal: it.journal,
    publication_year: it.publication_year,
    publication_type: it.publication_type,
    pmid: it.pmid,
    doi: it.doi,
    is_title_only_match: it.is_title_only_match === true,
  }));
  try {
    await supabaseAdmin.from("chat_grounding_samples").insert({
      user_id: ctx.supabaseUserId || null,
      thread_id: ctx.threadId || null,
      message_id: ctx._openaiResponseId || null,
      question: String(ctx.question || "").slice(0, 4000),
      sources_json: sources,
      answer: String(ctx.prose || "").slice(0, 16000),
      grounding_json: ctx.grounding || null,
      model: ctx._synthesisModel || null,
    });
  } catch (err) {
    console.warn("[workflow] grounding sample insert failed:", err?.message || err);
  }
}

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
  // Feature flag forwarded by the client. Read BEFORE createContext/sanitize
  // because those stages drop fields not declared in createContext.
  const chainingFlagEnabled =
    rawInput?.featureFlags?.chat_response_id_chaining === true;
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
    const chainingContext = resolveChainingContext({
      flagEnabled: chainingFlagEnabled,
      messages: ctx.recentMessages || [],
    });
    // Observability: record whether chaining was used for this turn so the
    // `done` SSE emit in stream.js can surface it to the client + ops.
    ctx._chainingUsed = chainingContext?.shouldChain === true;
    ctx = await synthesize(ctx, { chainingContext });
    await stream(ctx, res);
    // Fire-and-forget: sample a small fraction of turns into
    // chat_grounding_samples so a downstream grader can track
    // citation-quality drift without depending on the eval cadence.
    maybeSampleGroundingTurn(ctx).catch(() => {});
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
  const chainingFlagEnabled =
    rawInput?.featureFlags?.chat_response_id_chaining === true;
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
    const chainingContext = resolveChainingContext({
      flagEnabled: chainingFlagEnabled,
      messages: ctx.recentMessages || [],
    });
    ctx._chainingUsed = chainingContext?.shouldChain === true;
    ctx = await synthesize(ctx, { chainingContext });
    ctx = await streamToBuffer(ctx);
    maybeSampleGroundingTurn(ctx).catch(() => {});
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
    grounding: ctx.grounding,
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
