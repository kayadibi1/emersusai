import { buildMessages } from "./prompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini";

// Simple intent detection — when the user clearly asks for a structured
// output (meal plan, workout plan, food log), we set tool_choice to
// "required" so the model MUST call a tool instead of prose-only.
const TOOL_REQUIRED_RE = /\b(meal\s*plan|diet\s*plan|macro\s*plan|eating\s*plan|nutrition\s*plan|cut\s*plan|bulk\s*plan|recomp\s*plan|workout\s*plan|training\s*plan|program|training\s*block|split)\b/i;

export function buildRequestBody({ messages, tools, model, toolChoice }) {
  const body = {
    model,
    stream: true,
    max_output_tokens: 16000,
    input: messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }
  return body;
}

export async function synthesize(ctx) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const model = DEFAULT_MODEL;
  ctx._synthesisModel = model;

  const messages = buildMessages({
    question: ctx.question,
    profile: ctx.profile,
    threadState: ctx.threadState,
    recentMessages: ctx.recentMessages,
    evidence: ctx.evidence,
    workoutPlan: ctx.workoutPlan,
  });

  if (ctx.includeDebug) {
    ctx.debug.openai_input = messages;
  }

  // When the user clearly asks for a structured plan, force the model to
  // call a tool instead of writing everything as prose.
  const toolChoice = TOOL_REQUIRED_RE.test(ctx.question) ? "required" : undefined;

  const requestBody = buildRequestBody({ messages, tools: TOOL_DEFINITIONS, model, toolChoice });

  const start = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: ctx._abortController.signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  ctx._timer.record("synthesis_ttfb_ms", Date.now() - start);
  ctx._openaiStream = response.body;
  ctx._synthesisStartMs = start;

  return ctx;
}
