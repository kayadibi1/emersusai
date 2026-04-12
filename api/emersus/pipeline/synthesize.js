import { buildMessages } from "./prompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini";

// Intent → forced tool mapping. When the user clearly asks for a specific
// structured output, we use the Responses API `allowed_tools` tool_choice
// to force the exact tool — not just "required" (which lets the model pick
// any tool), but constrained to the one matching tool.
const FORCED_TOOL_PATTERNS = [
  { re: /\b(meal\s*plan|diet\s*plan|macro\s*plan|eating\s*plan|nutrition\s*plan|cut\s*(meal\s*)?plan|bulk\s*(meal\s*)?plan|recomp\s*plan|cutting\s*plan|bulking\s*plan)\b/i, tool: "emit_meal_plan" },
  { re: /\b(workout\s*plan|training\s*plan|training\s*program|workout\s*program|training\s*block|workout\s*split|PPL|push.pull.legs|upper.lower)\b/i, tool: "emit_workout_plan" },
];

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

  // When the user clearly asks for a specific structured output, force the
  // exact tool via allowed_tools so the model can't skip or substitute.
  let toolChoice;
  for (const { re, tool } of FORCED_TOOL_PATTERNS) {
    if (re.test(ctx.question)) {
      toolChoice = {
        type: "allowed_tools",
        mode: "required",
        tools: [{ type: "function", name: tool }],
      };
      break;
    }
  }

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
