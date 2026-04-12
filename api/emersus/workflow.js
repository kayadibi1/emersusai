import { ShortCircuit, createContext } from "./pipeline/context.js";
import { sanitize, validateRequest } from "./pipeline/sanitize.js";
import { safety } from "./pipeline/safety.js";
import { retrieve } from "./pipeline/retrieve.js";
import { synthesize } from "./pipeline/synthesize.js";
import { stream, streamToBuffer } from "./pipeline/stream.js";

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
  let ctx = createContext(rawInput);
  try {
    ctx = await sanitize(ctx);
    ctx = await safety(ctx);
    ctx = await retrieve(ctx);
    ctx = await synthesize(ctx);
    await stream(ctx, res);
  } catch (err) {
    if (err instanceof ShortCircuit) return sendResponse(res, err.response);
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
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
    ctx = await retrieve(ctx);
    ctx = await synthesize(ctx);
    ctx = await streamToBuffer(ctx);
  } catch (err) {
    if (err instanceof ShortCircuit) return err.response;
    throw err;
  }
  return {
    user: { id: ctx.stableUserId || null, profile_used: ctx.profile },
    plan: ctx.plan,
    summary: ctx.prose.slice(0, 600),
    answer_text: ctx.prose,
    tool_results: ctx.toolResults,
    sources: ctx.sources,
    token_usage: ctx.tokenUsage,
    guardrail: { status: "allowed", response_mode: "normal", reasons: [] },
    debug: ctx.includeDebug ? {
      openai_response_id: ctx._openaiResponseId,
      synthesis_model: ctx._synthesisModel,
      stage_timings: ctx._timer.all(),
      openai_input: ctx.debug.openai_input,
    } : undefined,
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
