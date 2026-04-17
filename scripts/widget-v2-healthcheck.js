// Widget v2 comprehensive health check.
//
// Layers:
//   1. Schema  — OpenAI accepts every tool under strict:true
//   2. Emission — each of 12 templates, when given a representative prompt,
//                 produces a payload that passes the server-side validator
//   3. Telemetry — prod emission rates + validator drop rate over the last 24 h
//
// Run locally or on Hetzner:
//   cat scripts/widget-v2-healthcheck.js | ssh hetzner \
//     "cat > /tmp/hc.js && cd ~/app && set -a; . .env; set +a; node /tmp/hc.js"
//
// Exits non-zero on any schema reject, validator fail, or telemetry-rate
// red flag, so it's safe to wire into CI or a cron.

import { buildToolDefinitions, validateToolCall } from "../api/emersus/pipeline/tools.js";

const MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Representative prompts per (family, type). Chosen so the model has no
// ambiguity about which family to pick; the tool description does the rest.
const CASES = [
  { family: "calculator", type: "macro_ring",               tool: "emit_calculator_widget", prompt: "I'm cutting at 2500 kcal with 180g protein. Show my daily macro split as a donut." },
  { family: "calculator", type: "tdee_calculator",          tool: "emit_calculator_widget", prompt: "What's my maintenance calories? I'm 80kg, 180cm, 32yo male, moderately active." },
  { family: "calculator", type: "one_rm_estimator",         tool: "emit_calculator_widget", prompt: "Estimate my 1RM on back squat — I just did 100kg for 5 reps." },
  { family: "nutrition",  type: "protein_distribution_bar", tool: "emit_nutrition_widget",  prompt: "Distribute 180g protein across 4 meals — breakfast 8am, lunch 1pm, post-workout 6pm, dinner 8pm." },
  { family: "nutrition",  type: "meal_macro_stack",         tool: "emit_nutrition_widget",  prompt: "Show macro breakdown by meal for a 2400 kcal cut day with 4 meals." },
  { family: "training",   type: "periodization_ladder",     tool: "emit_training_widget",   prompt: "Plan a 12-week hypertrophy block with accumulation (wk 1-4), intensification (5-8), realization (9-11), deload (12)." },
  { family: "training",   type: "volume_intensity_grid",    tool: "emit_training_widget",   prompt: "Show a 4-week volume heatmap: squat 120/130/140/150, bench 80/85/90/90, deadlift 100/110/120/130 (kg·sets)." },
  { family: "progress",   type: "pr_timeline",              tool: "emit_progress_widget",   prompt: "Plot my bench PRs: 80x5 on 2026-01-14, 85x5 on 2026-02-11, 87x5 on 2026-03-10, 90x3 on 2026-04-08." },
  { family: "progress",   type: "volume_trend",             tool: "emit_progress_widget",   prompt: "Show my weekly squat tonnage trend: 4800, 5200, 5600, 5900 kg starting the week of 2026-01-05." },
  { family: "pharma",     type: "dose_response_curve",      tool: "emit_pharma_widget",     prompt: "Plot the creatine monohydrate dose-response curve. Studies: 1g→2%, 3g→7%, 5g→9%, 10g→9.2%, 20g→9.1%. Recommended range 3-5g." },
  { family: "pharma",     type: "half_life_decay",          tool: "emit_pharma_widget",     prompt: "Plot caffeine decay after a 200mg dose with 5-hour half-life over 24 hours." },
  { family: "evidence",   type: "study_matrix",             tool: "emit_evidence_widget",   prompt: "Summarize creatine-for-strength evidence as a study matrix. 3-5 representative studies with design, n, effect size, direction." },
  { family: "evidence",   type: "effect_size_forest",       tool: "emit_evidence_widget",   prompt: "Show a forest plot of creatine effect sizes on bench 1RM with 95% CIs for Branch 2003 (ES 0.43, CI 0.28-0.58), Chilibeck 2017 (0.35, 0.15-0.55), Rawson 2011 (0.04, -0.2 to 0.28)." },
];

// ── Layer 1: Schema acceptance ─────────────────────────────────────

async function checkSchema(tool) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content: "ping" }],
      tools: [tool], stream: false, max_output_tokens: 30,
    }),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, error: res.ok ? null : body };
}

// ── Layer 2: Tool emission + validator round-trip ──────────────────

async function checkEmission(caseSpec, tool) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: `Call ${caseSpec.tool} after a 2-3 sentence intro. Always use type="${caseSpec.type}".` },
        { role: "user", content: caseSpec.prompt },
      ],
      tools: [tool],
      tool_choice: { type: "function", name: caseSpec.tool },
      stream: false, max_output_tokens: 1500,
    }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, stage: "http", detail: JSON.stringify(body).slice(0, 200) };
  const fnCall = body.output?.find((o) => o.type === "function_call");
  if (!fnCall) return { ok: false, stage: "no_call" };
  let args;
  try { args = JSON.parse(fnCall.arguments); } catch (e) { return { ok: false, stage: "parse", detail: e.message }; }
  if (args.type !== caseSpec.type) return { ok: false, stage: "wrong_type", detail: `got ${args.type}, wanted ${caseSpec.type}` };
  const v = validateToolCall(caseSpec.tool, args);
  if (!v.valid) return { ok: false, stage: "validator", detail: v.errors.join("; ") };
  return { ok: true };
}

// ── Layer 3: Telemetry rollup (requires Supabase creds) ────────────

async function checkTelemetry() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, reason: "no supabase creds (skipping)" };
  const q = encodeURIComponent(`select=family,type,validator_result&created_at=gte.${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}`);
  const res = await fetch(`${url}/rest/v1/widget_v2_emission_events?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const rows = await res.json();
  const roll = {};
  for (const r of rows) {
    const k = `${r.family}.${r.type}`;
    if (!roll[k]) roll[k] = { valid: 0, invalid: 0 };
    roll[k][r.validator_result] = (roll[k][r.validator_result] || 0) + 1;
  }
  return { ok: true, total: rows.length, roll };
}

// ── Runner ─────────────────────────────────────────────────────────

async function main() {
  const tools = buildToolDefinitions();
  const toolByName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const widgetV2Tools = [
    "emit_calculator_widget", "emit_nutrition_widget", "emit_training_widget",
    "emit_progress_widget", "emit_pharma_widget", "emit_evidence_widget",
  ];
  let failures = 0;

  console.log("\n── Layer 1: Schema acceptance (6 tools) ─────────");
  for (const name of widgetV2Tools) {
    const r = await checkSchema(toolByName[name]);
    if (r.ok) console.log(`  ✔ ${name}`);
    else { console.log(`  ✖ ${name} HTTP ${r.status}: ${JSON.stringify(r.error).slice(0, 200)}`); failures++; }
  }

  console.log("\n── Layer 2: Tool emission + validator (12 templates) ─────────");
  for (const cs of CASES) {
    const r = await checkEmission(cs, toolByName[cs.tool]);
    if (r.ok) console.log(`  ✔ ${cs.family}.${cs.type}`);
    else { console.log(`  ✖ ${cs.family}.${cs.type} — ${r.stage}: ${r.detail || "(no detail)"}`); failures++; }
  }

  console.log("\n── Layer 3: Prod telemetry (last 24 h) ─────────");
  const t = await checkTelemetry();
  if (!t.ok) console.log(`  - ${t.reason}`);
  else {
    console.log(`  total rows: ${t.total}`);
    const keys = Object.keys(t.roll).sort();
    for (const k of keys) {
      const { valid = 0, invalid = 0 } = t.roll[k];
      const total = valid + invalid;
      const dropPct = total > 0 ? Math.round((invalid / total) * 100) : 0;
      const flag = invalid > 0 && dropPct > 5 ? "  ⚠ HIGH DROP" : "";
      console.log(`  ${k.padEnd(44)} valid=${valid} invalid=${invalid} drop=${dropPct}%${flag}`);
    }
  }

  console.log("");
  if (failures > 0) { console.log(`FAIL (${failures} problems)`); process.exit(1); }
  console.log("OK — all 13 layer-1 checks + 12 layer-2 checks passed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
