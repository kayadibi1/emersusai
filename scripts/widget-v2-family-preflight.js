// Strict-mode preflight for candidate widget-v2 family tool schemas.
//
// Purpose: before committing to a family schema in Plans 2-6, prove that
// (a) OpenAI accepts the strict-mode shape on /v1/responses, and
// (b) the model can produce a valid payload from a realistic prompt.
//
// Pattern: map from family → { tool, prompt, validator }. Run one at a time
// via `node scripts/widget-v2-family-preflight.js <family>` or all via
// `node scripts/widget-v2-family-preflight.js all`. Exits non-zero on any
// schema rejection or validator failure.
//
// Reference: docs/openai-api-reference.md §strict-mode,
//            feedback_openai_strict_mode.md,
//            docs/superpowers/specs/2026-04-17-widget-template-refactor-design.md §3.2
//
// Run on Hetzner for the prod model + key:
//   cat scripts/widget-v2-family-preflight.js | ssh hetzner \
//     "cat > /tmp/pf.js && cd ~/app && set -a; . .env; set +a; node /tmp/pf.js pharma"

// ── F1 · Pharma (dose_response_curve representative) ───────────────

const PHARMA_DOSE_RESPONSE_DATA = {
  type: "object",
  required: ["compound", "unit", "points", "recommended_range"],
  additionalProperties: false,
  properties: {
    compound: { type: "string" },
    unit: { type: "string", enum: ["mg", "mg/kg", "g", "IU"] },
    points: {
      type: "array",
      items: {
        type: "object",
        required: ["dose", "effect_pct", "study_n"],
        additionalProperties: false,
        properties: {
          dose: { type: "number" },
          effect_pct: { type: "number" },
          study_n: { type: ["integer", "null"] },
        },
      },
    },
    recommended_range: {
      type: "object",
      required: ["min", "max"],
      additionalProperties: false,
      properties: {
        min: { type: "number" },
        max: { type: "number" },
      },
    },
  },
};

const EMIT_PHARMA_WIDGET = {
  type: "function",
  name: "emit_pharma_widget",
  strict: true,
  description: [
    "Emit a pharmacokinetics / dose-response widget (Plan 2 preflight).",
    "Use ONLY for: dose-response curves for supplements.",
    "Write 2-4 sentences of prose FIRST, then call this tool.",
    "",
    "TEMPLATE SELECTION:",
    "  dose_response_curve — effect vs dose scatter/line with recommended range band",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["title", "display_width", "summary", "follow_up_chips", "type", "data"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      display_width: { type: "string", enum: ["narrow", "medium", "wide"] },
      summary: { type: ["string", "null"] },
      follow_up_chips: { type: "array", items: { type: "string" } },
      type: { type: "string", enum: ["dose_response_curve"] },
      data: PHARMA_DOSE_RESPONSE_DATA,
    },
  },
};

function validatePharma(args) {
  const errors = [];
  if (args.type !== "dose_response_curve") errors.push("type");
  const d = args.data || {};
  if (typeof d.compound !== "string" || !d.compound.trim()) errors.push("data.compound");
  if (!["mg", "mg/kg", "g", "IU"].includes(d.unit)) errors.push("data.unit");
  if (!Array.isArray(d.points) || d.points.length < 2) errors.push("data.points (need >=2)");
  else {
    d.points.forEach((p, i) => {
      if (typeof p.dose !== "number") errors.push(`points[${i}].dose`);
      if (typeof p.effect_pct !== "number") errors.push(`points[${i}].effect_pct`);
    });
  }
  if (!d.recommended_range || typeof d.recommended_range.min !== "number" || typeof d.recommended_range.max !== "number") {
    errors.push("data.recommended_range");
  }
  return { valid: errors.length === 0, errors };
}

const PHARMA_PROMPT = "Plot the creatine monohydrate dose-response curve for strength gains. Studies tested 1-20 g/day; peak effect around 3-5 g saturates muscle stores.";

// ── F2 · Training (periodization_ladder representative) ────────────
// TODO Plan 3: finalize schema + run preflight

const TRAINING_PERIODIZATION_DATA = {
  type: "object",
  required: ["phases", "weeks", "focus_metric"],
  additionalProperties: false,
  properties: {
    weeks: { type: "integer" },
    focus_metric: { type: "string", enum: ["volume", "intensity", "frequency"] },
    phases: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "start_week", "end_week", "relative_load"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          start_week: { type: "integer" },
          end_week: { type: "integer" },
          relative_load: { type: "number" },
        },
      },
    },
  },
};

const EMIT_TRAINING_WIDGET_STUB = {
  type: "function",
  name: "emit_training_widget",
  strict: true,
  description: "Preflight stub — periodization ladder.",
  parameters: {
    type: "object",
    required: ["title", "display_width", "summary", "follow_up_chips", "type", "data"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      display_width: { type: "string", enum: ["narrow", "medium", "wide"] },
      summary: { type: ["string", "null"] },
      follow_up_chips: { type: "array", items: { type: "string" } },
      type: { type: "string", enum: ["periodization_ladder"] },
      data: TRAINING_PERIODIZATION_DATA,
    },
  },
};

const TRAINING_PROMPT = "Show a 12-week hypertrophy block with accumulation, intensification, and realization phases.";

// ── F3 · Nutrition (protein_distribution_bar representative) ────────
// TODO Plan 4: finalize schema

const NUTRITION_PROTEIN_DIST_DATA = {
  type: "object",
  required: ["daily_target_g", "meals"],
  additionalProperties: false,
  properties: {
    daily_target_g: { type: "number" },
    meals: {
      type: "array",
      items: {
        type: "object",
        required: ["slot", "grams", "hour"],
        additionalProperties: false,
        properties: {
          slot: { type: "string" },
          grams: { type: "number" },
          hour: { type: "integer" },
        },
      },
    },
  },
};

const EMIT_NUTRITION_WIDGET_STUB = {
  type: "function",
  name: "emit_nutrition_widget",
  strict: true,
  description: "Preflight stub — protein distribution bar.",
  parameters: {
    type: "object",
    required: ["title", "display_width", "summary", "follow_up_chips", "type", "data"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      display_width: { type: "string", enum: ["narrow", "medium", "wide"] },
      summary: { type: ["string", "null"] },
      follow_up_chips: { type: "array", items: { type: "string" } },
      type: { type: "string", enum: ["protein_distribution_bar"] },
      data: NUTRITION_PROTEIN_DIST_DATA,
    },
  },
};

const NUTRITION_PROMPT = "How should I distribute 180g of protein across my day? I train at 5pm and eat 4 times.";

// ── F4 · Evidence (study_matrix representative) ────────────────────
// TODO Plan 5: finalize schema

const EVIDENCE_STUDY_MATRIX_DATA = {
  type: "object",
  required: ["question", "studies"],
  additionalProperties: false,
  properties: {
    question: { type: "string" },
    studies: {
      type: "array",
      items: {
        type: "object",
        required: ["citation", "n", "design", "effect_size", "direction"],
        additionalProperties: false,
        properties: {
          citation: { type: "string" },
          n: { type: ["integer", "null"] },
          design: { type: "string", enum: ["RCT", "meta", "cohort", "review", "other"] },
          effect_size: { type: ["number", "null"] },
          direction: { type: "string", enum: ["positive", "null", "negative"] },
        },
      },
    },
  },
};

const EMIT_EVIDENCE_WIDGET_STUB = {
  type: "function",
  name: "emit_evidence_widget",
  strict: true,
  description: "Preflight stub — study matrix.",
  parameters: {
    type: "object",
    required: ["title", "display_width", "summary", "follow_up_chips", "type", "data"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      display_width: { type: "string", enum: ["narrow", "medium", "wide"] },
      summary: { type: ["string", "null"] },
      follow_up_chips: { type: "array", items: { type: "string" } },
      type: { type: "string", enum: ["study_matrix"] },
      data: EVIDENCE_STUDY_MATRIX_DATA,
    },
  },
};

const EVIDENCE_PROMPT = "What does the evidence say about creatine for strength? Include 3-5 representative studies.";

// ── F5 · Progress (pr_timeline representative) ─────────────────────
// TODO Plan 6: finalize schema

const PROGRESS_PR_TIMELINE_DATA = {
  type: "object",
  required: ["lift", "unit", "entries"],
  additionalProperties: false,
  properties: {
    lift: { type: "string" },
    unit: { type: "string", enum: ["kg", "lb"] },
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["date", "load", "reps"],
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          load: { type: "number" },
          reps: { type: "integer" },
        },
      },
    },
  },
};

const EMIT_PROGRESS_WIDGET_STUB = {
  type: "function",
  name: "emit_progress_widget",
  strict: true,
  description: "Preflight stub — PR timeline.",
  parameters: {
    type: "object",
    required: ["title", "display_width", "summary", "follow_up_chips", "type", "data"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      display_width: { type: "string", enum: ["narrow", "medium", "wide"] },
      summary: { type: ["string", "null"] },
      follow_up_chips: { type: "array", items: { type: "string" } },
      type: { type: "string", enum: ["pr_timeline"] },
      data: PROGRESS_PR_TIMELINE_DATA,
    },
  },
};

const PROGRESS_PROMPT = "Here's my bench press history: 80kg x5 in Jan, 85x5 in Feb, 87x5 in March, 90x3 in April. Show it.";

// ── Registry ────────────────────────────────────────────────────────

const FAMILIES = {
  pharma: { tool: EMIT_PHARMA_WIDGET, prompt: PHARMA_PROMPT, validator: validatePharma },
  training: { tool: EMIT_TRAINING_WIDGET_STUB, prompt: TRAINING_PROMPT, validator: null },
  nutrition: { tool: EMIT_NUTRITION_WIDGET_STUB, prompt: NUTRITION_PROMPT, validator: null },
  evidence: { tool: EMIT_EVIDENCE_WIDGET_STUB, prompt: EVIDENCE_PROMPT, validator: null },
  progress: { tool: EMIT_PROGRESS_WIDGET_STUB, prompt: PROGRESS_PROMPT, validator: null },
};

async function runOne(name) {
  const cfg = FAMILIES[name];
  if (!cfg) throw new Error(`unknown family: ${name}`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  console.log(`── ${name} preflight ─────────────`);

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini",
      input: [
        { role: "system", content: `You are a fitness assistant. When appropriate, call ${cfg.tool.name} after a brief prose intro.` },
        { role: "user", content: cfg.prompt },
      ],
      tools: [cfg.tool],
      tool_choice: { type: "function", name: cfg.tool.name },
      stream: false,
      max_output_tokens: 1200,
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    console.error(`  HTTP ${res.status}:`, JSON.stringify(body).slice(0, 500));
    return { name, status: "schema_rejected", error: body };
  }

  const fnCall = body.output?.find((o) => o.type === "function_call");
  if (!fnCall) {
    console.error("  no function_call in output");
    return { name, status: "no_call" };
  }

  let args;
  try { args = JSON.parse(fnCall.arguments); } catch (e) {
    console.error("  args parse failed:", e.message);
    return { name, status: "parse_failed" };
  }

  console.log(`  strict-mode: ACCEPTED`);
  console.log(`  type: ${args.type}`);
  console.log(`  payload keys: ${Object.keys(args.data || {}).join(", ")}`);

  if (cfg.validator) {
    const v = cfg.validator(args);
    if (!v.valid) {
      console.error("  validator: FAILED", v.errors);
      return { name, status: "validator_failed", errors: v.errors };
    }
    console.log("  validator: OK");
  } else {
    console.log("  validator: not yet implemented (skipped)");
  }

  return { name, status: "ok", args };
}

async function main() {
  const target = process.argv[2] || "all";
  const families = target === "all" ? Object.keys(FAMILIES) : [target];
  const results = [];
  for (const f of families) {
    try {
      results.push(await runOne(f));
    } catch (e) {
      console.error(`  ${f} threw:`, e.message);
      results.push({ name: f, status: "threw", error: e.message });
    }
  }
  console.log("\n── Summary ─────────────");
  for (const r of results) console.log(`  ${r.name}: ${r.status}`);
  const bad = results.filter((r) => !["ok"].includes(r.status));
  if (bad.length > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
