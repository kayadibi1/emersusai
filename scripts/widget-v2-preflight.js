// One-shot script: make a real OpenAI Responses API call with the new
// emit_calculator_widget tool, force tool_choice, verify the model can
// produce a valid payload under strict mode. Run manually before any
// feature-flag enable. Reference: docs/openai-api-reference.md §strict-mode,
// feedback_openai_strict_mode.md.

import "dotenv/config";
import { buildToolDefinitions } from "../api/emersus/pipeline/tools.js";

const PROMPT = "I'm cutting at 2500 kcal with 180g protein. Show me my macros.";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const tools = buildToolDefinitions().filter((t) => t.name === "emit_calculator_widget");
  if (tools.length !== 1) throw new Error("emit_calculator_widget not in tools");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini",
      input: [
        { role: "system", content: "You are a macro-planning assistant. When the user asks for a macro breakdown with sliders, call emit_calculator_widget(type=macro_ring) after a brief prose intro." },
        { role: "user", content: PROMPT },
      ],
      tools,
      tool_choice: { type: "function", name: "emit_calculator_widget" },
      stream: false,
      max_output_tokens: 800,
    }),
  });

  const body = await res.json();
  if (!res.ok) { console.error("HTTP", res.status, body); process.exit(1); }

  const fnCall = body.output?.find((o) => o.type === "function_call");
  if (!fnCall) { console.error("No function_call in output:", JSON.stringify(body.output).slice(0, 400)); process.exit(1); }

  console.log("Tool call name:", fnCall.name);
  let args;
  try { args = JSON.parse(fnCall.arguments); } catch (e) { console.error("Args parse fail:", e.message); process.exit(1); }

  const { validateCalculatorWidget } = await import("../shared/widget-v2/validators/calculator.js");
  const v = validateCalculatorWidget(args);
  console.log("Validator:", v);
  if (!v.valid) process.exit(1);

  console.log("PREFLIGHT OK");
  console.log(JSON.stringify(args, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
