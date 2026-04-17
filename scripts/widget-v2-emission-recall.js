// Widget v2 emission-recall benchmark — ONE-OFF.
//
// Measures: for natural-language prompts (not the forcing-language used by
// the healthcheck), does gpt-5.4-mini actually call the right widget tool?
//
// Prompts come in three flavors:
//   expected: "<family>"         — model SHOULD fire emit_<family>_widget
//   expected: "prose_ok"         — widget optional; fire or prose both count
//   expected: "prose_required"   — widget must NOT fire (false-positive probe)
//
// Reports: recall (fraction of tagged-widgetable prompts that fired), family
// precision (right tool when fired), false-positive rate (prose_required
// that still fired).
//
// Cost: ~50 Responses API calls, ~$0.25 total on gpt-5.4-mini, ~3 minutes.
// Run: cat scripts/widget-v2-emission-recall.js | ssh hetzner \
//        "cat > /tmp/er.js && cd ~/app && set -a; . .env; set +a; node /tmp/er.js"

import { buildToolDefinitions } from "../api/emersus/pipeline/tools.js";

const MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Representative minimal system prompt — mirrors the one prod uses so the
// model sees the same tool descriptions it would in the real pipeline.
const SYSTEM = "You are Emersus, an evidence-based fitness and nutrition coach. You have six structured visualization tools (emit_pharma_widget, emit_training_widget, emit_nutrition_widget, emit_progress_widget, emit_evidence_widget, emit_calculator_widget) plus the legacy emit_widget (raw HTML) for anything that doesn't fit. Use structured tools when they fit the user's question. Keep prose short — 2-4 sentences before a tool call, or 2-5 sentences total if no tool fires.";

// ── Prompt bank ─────────────────────────────────────────────────────

const PROMPTS = [
  // pharma (8)
  { expected: "pharma", prompt: "When should I cut off caffeine before bed? I had 200mg at 2pm." },
  { expected: "pharma", prompt: "How long does caffeine stay in your system?" },
  { expected: "pharma", prompt: "I took 400 mg caffeine at noon — safe to sleep at 10 pm?" },
  { expected: "pharma", prompt: "Does taking more creatine actually work better?" },
  { expected: "pharma", prompt: "What's the minimum effective dose of creatine?" },
  { expected: "pharma", prompt: "Is there a ceiling on ashwagandha benefits past a certain dose?" },
  { expected: "pharma", prompt: "Show me how caffeine levels decay over 24 hours." },
  { expected: "pharma", prompt: "What dose of creatine gives the most strength benefit?" },

  // nutrition (8)
  { expected: "nutrition", prompt: "How should I spread my protein across the day?" },
  { expected: "nutrition", prompt: "I train at 6pm — how should my protein per meal look?" },
  { expected: "nutrition", prompt: "Visualize my protein distribution across 4 meals, 160g target." },
  { expected: "nutrition", prompt: "Break down calories per meal for a 2200 kcal cut." },
  { expected: "nutrition", prompt: "Show me which meal has the most carbs in my day." },
  { expected: "nutrition", prompt: "Compare macro composition across breakfast lunch dinner." },
  { expected: "nutrition", prompt: "Graph my per-meal protein split vs the 180g daily target." },
  { expected: "nutrition", prompt: "What's the P/C/F breakdown of each of my meals?" },

  // training (6)
  { expected: "training", prompt: "Plan me a 16-week strength run-up to a meet." },
  { expected: "training", prompt: "What should my block structure look like for a hypertrophy phase?" },
  { expected: "training", prompt: "Show a weekly volume heatmap across my main lifts." },
  { expected: "training", prompt: "How should accumulation, intensification, and deload weeks be laid out?" },
  { expected: "training", prompt: "Visualize my volume ramp across 4 weeks for squat bench deadlift." },
  { expected: "training", prompt: "Show a periodization ladder for 12 weeks of powerbuilding." },

  // progress (6)
  { expected: "progress", prompt: "My bench went 80x5, 85x5, 87x5, 90x3 over 4 months — graph it." },
  { expected: "progress", prompt: "Plot my PR history: 140x3 Jan, 145x3 Feb, 150x1 Mar, 152.5x1 Apr on deadlift." },
  { expected: "progress", prompt: "How has my squat progressed this year given 80x5 Jan 85x5 Feb 90x5 Mar?" },
  { expected: "progress", prompt: "Weekly squat tonnage has been 4800, 5200, 5600, 5900 kg — is that trending up?" },
  { expected: "progress", prompt: "Show my weekly bench tonnage trend starting 2026-01-01: 3200, 3400, 3600, 3700 kg." },
  { expected: "progress", prompt: "Plot my working-set count per week: 18, 20, 22, 24 over the last month." },

  // evidence (6)
  { expected: "evidence", prompt: "What does the research say about creatine and strength?" },
  { expected: "evidence", prompt: "How strong is the evidence for ashwagandha?" },
  { expected: "evidence", prompt: "Show me a forest plot of the creatine effect-size data." },
  { expected: "evidence", prompt: "Compare the major creatine studies by design and effect." },
  { expected: "evidence", prompt: "Is the beta-alanine evidence consistent or mixed?" },
  { expected: "evidence", prompt: "Summarize the meta-analyses on whey vs plant protein for hypertrophy." },

  // calculator (6)
  { expected: "calculator", prompt: "What's my maintenance calories? I'm 78 kg, 178 cm, 30, male, moderate activity." },
  { expected: "calculator", prompt: "Estimate my 1RM on deadlift — 150 kg for 3 reps yesterday." },
  { expected: "calculator", prompt: "If I can do 8 reps at 60 kg on bench, what's my 1RM?" },
  { expected: "calculator", prompt: "Split 2400 kcal into macros for a cut with 180 g protein." },
  { expected: "calculator", prompt: "Show my daily macro split for a 2800 kcal maintenance day." },
  { expected: "calculator", prompt: "Quick TDEE calc: 75 kg female, 165 cm, 28, light activity." },

  // prose_required / adversarial (10)
  { expected: "prose_required", prompt: "Hi, how are you?" },
  { expected: "prose_required", prompt: "Thanks for your help!" },
  { expected: "prose_required", prompt: "What's the difference between Type I and Type II muscle fibers?" },
  { expected: "prose_required", prompt: "Should I do fasted cardio?" },
  { expected: "prose_required", prompt: "What's your pre-workout recommendation?" },
  { expected: "prose_required", prompt: "I'm tired today, should I still train?" },
  { expected: "prose_required", prompt: "Is creatine safe long-term?" },
  { expected: "prose_required", prompt: "Explain the stretch-shortening cycle briefly." },
  { expected: "prose_required", prompt: "Why do I get DOMS 48 hours later not same-day?" },
  { expected: "prose_required", prompt: "Good morning — anything I should focus on today?" },
];

const WIDGET_V2_TOOLS = [
  "emit_calculator_widget", "emit_nutrition_widget", "emit_training_widget",
  "emit_progress_widget", "emit_pharma_widget", "emit_evidence_widget",
];
const TOOL_TO_FAMILY = {
  emit_calculator_widget: "calculator", emit_nutrition_widget: "nutrition",
  emit_training_widget: "training",     emit_progress_widget: "progress",
  emit_pharma_widget: "pharma",         emit_evidence_widget: "evidence",
};

async function runOne(prompt, allTools) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      tools: allTools, stream: false, max_output_tokens: 800,
    }),
  });
  const body = await res.json();
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const fnCall = body.output?.find((o) => o.type === "function_call");
  if (!fnCall) return { fired: null };
  return { fired: fnCall.name, is_widget_v2: WIDGET_V2_TOOLS.includes(fnCall.name) };
}

async function main() {
  const allTools = buildToolDefinitions();
  const results = [];
  console.log(`Running ${PROMPTS.length} prompts against ${MODEL} …\n`);

  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${PROMPTS.length}  ${p.expected.padEnd(16)} `);
    const r = await runOne(p.prompt, allTools);
    const firedFamily = r.fired ? TOOL_TO_FAMILY[r.fired] || "legacy" : null;
    const ok = (() => {
      if (p.expected === "prose_required") return r.fired === null;
      if (p.expected === "prose_ok") return true;
      return firedFamily === p.expected;
    })();
    const mark = ok ? "✔" : "✖";
    const detail = r.error ? `ERROR ${r.error}` : r.fired === null ? "prose" : `${r.fired}`;
    console.log(`${mark}  ${detail.padEnd(30)}  | ${p.prompt.slice(0, 64)}`);
    results.push({ ...p, ...r, firedFamily, ok });
  }

  // ── Rollup ─────────────────────────────────────────
  const byFamily = {};
  for (const r of results) {
    const key = r.expected;
    if (!byFamily[key]) byFamily[key] = { total: 0, fired: 0, right_family: 0, ok: 0 };
    const bucket = byFamily[key];
    bucket.total += 1;
    if (r.fired) bucket.fired += 1;
    if (r.firedFamily === r.expected) bucket.right_family += 1;
    if (r.ok) bucket.ok += 1;
  }

  console.log("\n── Rollup ─────────────");
  const widgetCats = ["pharma", "nutrition", "training", "progress", "evidence", "calculator"];
  let totalWidgetable = 0, totalRightFamily = 0, totalFired = 0;
  for (const cat of widgetCats) {
    const b = byFamily[cat];
    if (!b) continue;
    const recall = Math.round((b.fired / b.total) * 100);
    const precision = b.fired > 0 ? Math.round((b.right_family / b.fired) * 100) : 0;
    console.log(`  ${cat.padEnd(12)}  recall ${String(b.fired).padStart(2)}/${String(b.total).padStart(2)} (${recall}%)   family-precision ${b.right_family}/${b.fired} (${precision}%)`);
    totalWidgetable += b.total;
    totalFired += b.fired;
    totalRightFamily += b.right_family;
  }
  const overallRecall = Math.round((totalFired / totalWidgetable) * 100);
  const overallPrecision = totalFired > 0 ? Math.round((totalRightFamily / totalFired) * 100) : 0;
  console.log(`  ${"──".padEnd(12)}  ────`);
  console.log(`  ${"widgetable".padEnd(12)}  recall ${totalFired}/${totalWidgetable} (${overallRecall}%)   family-precision ${totalRightFamily}/${totalFired} (${overallPrecision}%)`);

  const proseRequired = byFamily["prose_required"];
  if (proseRequired) {
    const fp = proseRequired.fired;
    const fpPct = Math.round((fp / proseRequired.total) * 100);
    console.log(`  ${"prose-required".padEnd(12)}  false-fire ${fp}/${proseRequired.total} (${fpPct}%)`);
  }

  console.log("\nBand guidance:  recall ≥70%, family-precision ≥85%, false-fire ≤10%");
}

main().catch((e) => { console.error(e); process.exit(1); });
