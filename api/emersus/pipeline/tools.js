/**
 * Tool definitions (strict-mode) for the OpenAI Responses API, plus
 * server-side validators that run when a tool call completes.
 *
 * Four tools:
 *   emit_meal_plan    — structured meal/diet plan
 *   emit_workout_plan — periodized training program
 *   emit_widget       — inline HTML/CSS/JS visual
 *   log_food          — food journal entry
 */

import { validateMealPlan } from "../../../shared/meal-plan-schema.js";
import {
  EXPERIENCE_LEVELS,
  GOALS,
  SCHEMA_VERSION as WORKOUT_PLAN_SCHEMA_VERSION,
  normalizePlan as normalizeWorkoutPlan,
  validatePlan as validateWorkoutPlan,
} from "../../../shared/workout-plan-schema.js";
import { validateCalculatorWidget } from "../../../shared/widget-v2/validators/calculator.js";
import { validateNutritionWidget } from "../../../shared/widget-v2/validators/nutrition.js";
import { validateTrainingWidget } from "../../../shared/widget-v2/validators/training.js";
import { validateProgressWidget } from "../../../shared/widget-v2/validators/progress.js";
import { validatePharmaWidget } from "../../../shared/widget-v2/validators/pharma.js";
import { validateEvidenceWidget } from "../../../shared/widget-v2/validators/evidence.js";

// ── Shared sub-schemas (inlined for strict mode) ────────────────────────

const MACROS_SCHEMA = {
  type: "object",
  required: ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
  additionalProperties: false,
  properties: {
    kcal:      { type: "number" },
    protein_g: { type: "number" },
    carbs_g:   { type: "number" },
    fat_g:     { type: "number" },
    fiber_g:   { type: "number" },
  },
};

const FOOD_ITEM_SCHEMA = {
  type: "object",
  required: ["description", "grams", "fdc_id"],
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    grams:       { type: "number" },
    fdc_id:      { type: ["integer", "null"] },
  },
};

const MEAL_SCHEMA = {
  type: "object",
  required: ["slot", "name", "foods"],
  additionalProperties: false,
  properties: {
    slot: {
      type: "string",
      enum: [
        "breakfast", "mid_morning", "lunch", "afternoon", "dinner",
        "evening", "pre_workout", "post_workout", "supplements_am", "supplements_pm",
      ],
    },
    name:  { type: "string" },
    foods: { type: "array", items: FOOD_ITEM_SCHEMA },
  },
};

const SUPPLEMENT_SCHEMA = {
  type: "object",
  required: ["description", "amount", "unit", "timing"],
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    amount:      { type: "number" },
    unit:        { type: "string" },
    timing: {
      type: ["string", "null"],
      enum: ["any", "morning", "with_meal", "pre_workout", "post_workout", "bedtime", null],
    },
  },
};

// ── emit_meal_plan ──────────────────────────────────────────────────────

const EMIT_MEAL_PLAN = {
  type: "function",
  name: "emit_meal_plan",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL whenever the user asks for anything resembling a meal plan, diet plan, nutrition plan, macro breakdown, eating plan, cut plan, bulk plan, recomp plan, or what they should eat for a goal. A text-only answer to any of these requests is a failure. The tool call is the deliverable — not prose.",
    "",
    "TRIGGER PHRASES (non-exhaustive — use judgment for similar intent):",
    "  meal plan, diet plan, eating plan, nutrition plan, macro plan, macro breakdown,",
    "  cut plan, cutting plan, bulk plan, bulking plan, recomp plan, lean bulk plan,",
    "  what should I eat, plan my meals, plan my diet, plan my macros, give me a diet,",
    "  make me a plan, create a plan (in nutrition context), show me a meal plan,",
    "  calorie deficit plan, calorie surplus plan, maintenance diet",
    "",
    "Call get_user_profile first to get body metrics for the TDEE calculation.",
    "PROFILE DEFAULTS (use when profile fields are null/missing):",
    "  body_weight_kg: 75 (male) or 65 (female); default male if sex unknown",
    "  height_cm: 178 (male) or 165 (female)",
    "  date_of_birth: assume age 30",
    "  biological_sex: male",
    "  activity_level: moderate",
    "State your assumptions in 1-2 sentences of prose before the tool call.",
    "",
    "MACRO CALCULATION — Mifflin-St Jeor:",
    "  BMR = 10*weight_kg + 6.25*height_cm - 5*age + (5 if male, -161 if female)",
    "  TDEE = BMR * multiplier (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9)",
    "  Cut: TDEE - 500 kcal. Bulk: TDEE + 250-400 kcal. Maintain: TDEE.",
    "  Protein: 1.6-2.2 g/kg (2.0-2.2 cut, 1.6-1.8 bulk, 1.8 default). Fat: 20-35% kcal, min 0.6 g/kg. Carbs: remainder. Fiber: 14g/1000 kcal.",
    "",
    "Show the user the math briefly in prose BEFORE calling the tool.",
    "",
    "THREE day types: training_day (computed targets, higher carbs), rest_day (carbs -60g, fat +15g, same protein), refeed_day (maintenance carb share, same protein).",
    "",
    "FOOD RULES: USDA FDC generic foods only. 3 meals + 1 snack default. Respect dietary_preferences. No restaurant chains or brand names unless asked.",
    "",
    "SUPPLEMENTS (evidence-based only): creatine 3-5g/day, whey/casein/pea protein, vitamin D3 1000-2000 IU/day, omega-3 1-2g/day, caffeine 3-6 mg/kg pre-workout, magnesium glycinate 200-400mg. Empty array if unwanted. No prescriptions, megadoses, or weak-evidence supplements.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["targets", "day_types", "assignments"],
    additionalProperties: false,
    properties: {
      targets: {
        type: "object",
        required: ["training_day", "rest_day", "refeed_day"],
        additionalProperties: false,
        properties: {
          training_day: MACROS_SCHEMA,
          rest_day:     MACROS_SCHEMA,
          refeed_day:   MACROS_SCHEMA,
        },
      },
      day_types: {
        type: "array",
        items: {
          type: "object",
          required: ["slug", "name", "meals", "supplements"],
          additionalProperties: false,
          properties: {
            slug:        { type: "string" },
            name:        { type: "string" },
            meals:       { type: "array", items: MEAL_SCHEMA },
            supplements: { type: "array", items: SUPPLEMENT_SCHEMA },
          },
        },
      },
      assignments: {
        type: "object",
        required: ["mode", "default_day_type"],
        additionalProperties: false,
        properties: {
          mode:             { type: "string", enum: ["auto_from_workout", "manual"] },
          default_day_type: { type: "string" },
        },
      },
    },
  },
};

// ── emit_workout_plan ───────────────────────────────────────────────────

const BLOCK_SCHEMA = {
  type: "object",
  required: ["name", "sets", "reps", "load", "rpe", "rest_seconds", "category", "notes"],
  additionalProperties: false,
  properties: {
    name:         { type: "string", description: "Exercise name, e.g. 'Barbell Back Squat', 'Romanian Deadlift'" },
    sets:         { type: "integer" },
    reps:         { type: "string" },
    load:         { type: "string" },
    rpe:          { type: "number" },
    rest_seconds: { type: "integer" },
    category:     { type: "string", enum: ["resistance", "cardio", "swimming", "climbing", "bodyweight"] },
    notes:        { type: ["string", "null"] },
  },
};

const SESSION_SCHEMA = {
  type: "object",
  required: ["id", "week", "day_of_week", "date", "title", "blocks", "warmup_blocks"],
  additionalProperties: false,
  properties: {
    id:            { type: "string" },
    week:          { type: "integer" },
    day_of_week:   { type: "integer" },
    date:          { type: "string" },
    title:         { type: "string" },
    blocks:        { type: "array", items: BLOCK_SCHEMA },
    warmup_blocks: { type: ["array", "null"], items: BLOCK_SCHEMA },
  },
};

const EMIT_WORKOUT_PLAN = {
  type: "function",
  name: "emit_workout_plan",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL whenever the user asks for anything resembling a workout plan, training plan, training program, workout program, workout split, training block, exercise routine, or gym program. A text-only answer to any of these requests is a failure. The tool call is the deliverable — not prose.",
    "",
    "TRIGGER PHRASES (non-exhaustive — use judgment for similar intent):",
    "  workout plan, training plan, training program, workout program, workout split,",
    "  training block, exercise routine, gym program, give me a program, make me a plan,",
    "  PPL, push pull legs, upper lower, full body program, bro split, 4-day split,",
    "  periodization plan, strength program, hypertrophy program, build me a routine",
    "",
    "Write 2-4 sentences of prose rationale BEFORE calling this tool.",
    "",
    "Session id format: s_w{week}d{day_of_week} (day_of_week 1=Monday, 7=Sunday).",
    "Each block: name (the exercise name, e.g. 'Barbell Back Squat'), sets, reps (string like '8-10'), load (string like '75kg' or 'bodyweight'), RPE, rest_seconds, category.",
    "Include warmup_blocks for compound lifts >= 60% 1RM.",
    "",
    "If current_workout_plan is non-null, you are ADJUSTING the existing plan:",
    "  - Set updates_plan_id to the current plan's id",
    "  - Preserve session ids where possible",
    "  - Explain what changed in prose",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["schema_version", "title", "goal", "experience_level", "start_date", "weeks", "days_per_week", "sessions", "updates_plan_id"],
    additionalProperties: false,
    properties: {
      schema_version:   { type: "integer" },
      title:            { type: "string" },
      goal:             { type: "string", enum: ["hypertrophy", "strength", "endurance", "general", "sport_specific"] },
      experience_level: { type: "string" },
      start_date:       { type: "string" },
      weeks:            { type: "integer" },
      days_per_week:    { type: "integer" },
      sessions:         { type: "array", items: SESSION_SCHEMA },
      updates_plan_id:  { type: ["string", "null"] },
    },
  },
};

// ── emit_widget ─────────────────────────────────────────────────────────

const EMIT_WIDGET = {
  type: "function",
  name: "emit_widget",
  strict: true,
  description: [
    "Emit an inline HTML visual widget. Call this when the answer benefits from a visual: comparisons, charts, calculators, evidence matrices, dose-response curves, mechanism diagrams, phased plans, or interactive explorers.",
    "",
    "ALWAYS write 2-4 sentences of plain prose answering the user's question FIRST, then call this tool. The widget supplements the answer — it does not replace it. A response that starts with the tool call is a failure: the user's takeaway lives in the prose, not buried inside the visual.",
    "",
    "EMIT A WIDGET WHEN ANY OF THESE ARE TRUE:",
    "- Comparison (X vs Y), evidence matrix, or evidence-by-outcome.",
    "- Three or more quantitative items (doses, ranges, study results, effect sizes).",
    "- Decision tree, phased plan, periodization block, or step-by-step protocol.",
    "- Interactive: calculator, slider, scenario explorer, lookup table.",
    "- User says 'show me', 'compare', 'visualize', 'chart', 'diagram', 'dashboard', 'widget'.",
    "",
    "DO NOT emit when: short conversational follow-up, simple confirmation, or you lack real data.",
    "",
    "WIDGET ENVIRONMENT:",
    "- Sandboxed iframe (allow-scripts allow-same-origin). The host has TWO palettes that can flip at runtime (Graphite·Jade dark, Paper·Royal light); the iframe inherits the current palette via CSS variables. NEVER hardcode bg/text/accent hex or rgba(255,255,255,X) — those break in light mode.",
    "- Chart.js 4.4.1 pre-loaded as global `Chart`. Use directly — do NOT add a <script src> for it. Defaults for axis/grid/border are already palette-aware; do NOT override `ticks.color`, `grid.color`, or `borderColor` in chart configs.",
    "- Surface & text tokens: var(--color-background-primary | -secondary | -tertiary), var(--color-text-primary | -secondary | -tertiary), var(--color-border-primary | -secondary | -tertiary).",
    "- Accent tokens: var(--accent-primary), var(--accent-secondary), var(--accent-soft) (10%-alpha fill), var(--accent-line) (border tint).",
    "- Semantic tokens: var(--color-text-success | -warning | -danger | -info), var(--color-background-success | -warning | -danger | -info).",
    "- Evidence-strength tokens: var(--ev-strong-bg | -text | -dot), var(--ev-moderate-bg | -text | -dot), var(--ev-limited-bg | -text | -dot), var(--ev-insufficient-bg | -text | -dot).",
    "- Radii: var(--border-radius-md) = 8px, var(--border-radius-lg) = 10px.",
    "- Chart data series colors: rotate through the palette-tuned categorical series, distinct in both themes.",
    "  * In HTML/CSS: use var(--chart-series-1 | -2 | -3 | -4 | -5) in order.",
    "  * In Chart.js configs (and any JS): CSS vars don't resolve inside string props, so use the pre-resolved array `window.EMERSUS_CHART_SERIES` (length 5, indexed 0..4). Example: `borderColor: window.EMERSUS_CHART_SERIES[0]`, `backgroundColor: window.EMERSUS_CHART_SERIES[1] + '22'` (append `22` to the hex for ~13%-alpha fills).",
    "  * Do NOT use --accent-primary or the semantic --color-text-success/warning/danger/info tokens for data series — they share hues with the accent or with each other on one palette. Reserve semantic tokens for status pills, threshold lines, positive/negative call-outs.",
    "- No external scripts/links/imports. 1px min borders. Fluid width. Div grids over tables.",
    "- The host auto-resizes iframe height to content. Do NOT use viewport-sized layouts: no `vh`/`dvh`/`svh`/`lvh` heights, no `html/body/root { height:100%; min-height:100%; }`, no full-screen fixed wrappers.",
    "- window.sendPrompt('...') for clickable follow-ups.",
    "- Numbers, labels, study names must come from real evidence. Do not fabricate.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["title", "html"],
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Short descriptive title for the widget" },
      html:  { type: "string", description: "Self-contained HTML+inline CSS+optional inline JS. Chart.js is pre-loaded." },
    },
  },
};

// ── emit_calculator_widget (widget-v2 · F6) ──────────────────────────

const MACRO_RING_LEG = {
  type: "object",
  required: ["grams", "target_grams", "kcal"],
  additionalProperties: false,
  properties: {
    grams: { type: "number" },
    target_grams: { type: "number" },
    kcal: { type: "number" },
  },
};

// Calculator superset data — strict:true. Covers macro_ring +
// tdee_calculator + one_rm_estimator in one schema. `load`, `reps`,
// `lift`, `unit` are 1RM-only; `weight_kg`, `height_cm`, `age`, `sex`,
// `activity_level`, `bmr`, `tdee` are TDEE-only. No name collisions.
const MACRO_RING_TDEE_REF = {
  type: ["object", "null"],
  required: ["tdee", "delta_kcal"],
  additionalProperties: false,
  properties: { tdee: { type: "number" }, delta_kcal: { type: "number" } },
};
const CALC_MACRO_LEG = {
  type: ["object", "null"],
  required: ["grams", "target_grams", "kcal"],
  additionalProperties: false,
  properties: { grams: { type: "number" }, target_grams: { type: "number" }, kcal: { type: "number" } },
};
const CALC_PLATE = {
  type: "object",
  required: ["kg", "count"],
  additionalProperties: false,
  properties: { kg: { type: "number" }, count: { type: "integer" } },
};
const CALC_RPE_ROW = {
  type: "object",
  required: ["reps", "pcts_by_rpe"],
  additionalProperties: false,
  properties: { reps: { type: "integer" }, pcts_by_rpe: { type: "array", items: { type: "number" } } },
};
const CALC_CARB_DAY = {
  type: "object",
  required: ["day", "tier", "carbs_g"],
  additionalProperties: false,
  properties: { day: { type: "string" }, tier: { type: "string", enum: ["high", "med", "low"] }, carbs_g: { type: "number" } },
};
const CALCULATOR_DATA = {
  type: "object",
  required: [
    // macro_ring
    "kcal_total", "phase", "protein", "carbs", "fat", "tdee_reference",
    // tdee_calculator
    "weight_kg", "height_cm", "age", "sex", "activity_level", "bmr", "tdee",
    // one_rm_estimator
    "lift", "unit", "load", "reps", "epley_1rm", "brzycki_1rm",
    // macro_calculator
    "protein_g_per_kg", "fat_pct", "body_weight_kg", "protein_g", "fat_g", "carbs_g",
    // plate_loader_visual
    "target_kg", "bar_kg", "plates_per_side",
    // rpe_to_percent_rm
    "rows",
    // body_fat_estimator
    "neck_cm", "waist_cm", "hip_cm", "body_fat_pct",
    // carb_cycling_calculator
    "weekly_avg_g", "plan",
    // protein_target_calculator
    "meal_count", "total_g", "per_meal_g", "leucine_threshold_g",
    // pace_calculator
    "distance_km", "time_sec", "pace_sec_per_km", "speed_kmh", "zone",
  ],
  additionalProperties: false,
  properties: {
    kcal_total: { type: ["number", "null"] },
    phase: { type: ["string", "null"], enum: ["cut", "maintenance", "bulk", null] },
    protein: CALC_MACRO_LEG,
    carbs: CALC_MACRO_LEG,
    fat: CALC_MACRO_LEG,
    tdee_reference: MACRO_RING_TDEE_REF,
    weight_kg: { type: ["number", "null"] },
    height_cm: { type: ["number", "null"] },
    age: { type: ["number", "null"] },
    sex: { type: ["string", "null"], enum: ["male", "female", null] },
    activity_level: { type: ["string", "null"], enum: ["sedentary", "light", "moderate", "active", "very_active", null] },
    bmr: { type: ["number", "null"] },
    tdee: { type: ["number", "null"] },
    lift: { type: ["string", "null"] },
    unit: { type: ["string", "null"], enum: ["kg", "lb", null] },
    load: { type: ["number", "null"] },
    reps: { type: ["integer", "null"] },
    epley_1rm: { type: ["number", "null"] },
    brzycki_1rm: { type: ["number", "null"] },
    protein_g_per_kg: { type: ["number", "null"] },
    fat_pct: { type: ["number", "null"] },
    body_weight_kg: { type: ["number", "null"] },
    protein_g: { type: ["number", "null"] },
    fat_g: { type: ["number", "null"] },
    carbs_g: { type: ["number", "null"] },
    target_kg: { type: ["number", "null"] },
    bar_kg: { type: ["number", "null"] },
    plates_per_side: { type: ["array", "null"], items: CALC_PLATE },
    rows: { type: ["array", "null"], items: CALC_RPE_ROW },
    neck_cm: { type: ["number", "null"] },
    waist_cm: { type: ["number", "null"] },
    hip_cm: { type: ["number", "null"] },
    body_fat_pct: { type: ["number", "null"] },
    weekly_avg_g: { type: ["number", "null"] },
    plan: { type: ["array", "null"], items: CALC_CARB_DAY },
    meal_count: { type: ["integer", "null"] },
    total_g: { type: ["number", "null"] },
    per_meal_g: { type: ["number", "null"] },
    leucine_threshold_g: { type: ["number", "null"] },
    distance_km: { type: ["number", "null"] },
    time_sec: { type: ["number", "null"] },
    pace_sec_per_km: { type: ["number", "null"] },
    speed_kmh: { type: ["number", "null"] },
    zone: { type: ["string", "null"], enum: ["Z1", "Z2", "Z3", "Z4", "Z5", null] },
  },
};
const EMIT_CALCULATOR_WIDGET = {
  type: "function",
  name: "emit_calculator_widget",
  strict: true,
  description: [
    "Emit a quantitative calculator widget. Write 2-4 sentences of prose FIRST, then call.",
    "",
    "TEMPLATE SELECTION:",
    "  macro_ring — daily macro-split donut (grams/kcal per macro, optional TDEE comparison).",
    "  tdee_calculator — BMR + TDEE card from weight/height/age/sex/activity.",
    "  one_rm_estimator — one-rep-max card from a working set (load × reps). Shows Epley + Brzycki + average.",
    "  macro_calculator — protein-anchored macro split card (mini donut + per-macro grams/kcal).",
    "  plate_loader_visual — target weight → plate stack illustration per side.",
    "  rpe_to_percent_rm — reps × RPE → %1RM lookup heatmap (RPE 6-10).",
    "  body_fat_estimator — Navy-method body-fat card with zone label.",
    "  carb_cycling_calculator — 7-day plan with high/med/low tier + carb grams per day.",
    "  protein_target_calculator — body-weight × meals → per-meal protein + leucine-threshold check.",
    "  pace_calculator — distance + time → pace/km + speed + optional training zone.",
    "",
    "DO NOT CALL for:",
    "  - Protein timing / per-meal macros — use emit_nutrition_widget.",
    "  - Plate loading, RPE-to-%1RM, body-fat %, pace-per-km — use emit_widget (raw HTML) or prose; those templates are not shipped yet.",
    "",
    "DATA SHAPE (strict: fill the fields your `type` uses, null the others):",
    "  macro_ring fills: kcal_total, phase, protein, carbs, fat, tdee_reference (may be null)",
    "  tdee_calculator fills: weight_kg, height_cm, age, sex, activity_level, bmr, tdee",
    "  one_rm_estimator fills: lift, unit, load, reps, epley_1rm (load*(1+reps/30)), brzycki_1rm (load*36/(37-reps))",
    "",
    "EXAMPLE one_rm_estimator:",
    '  data: { "lift": "Back Squat", "unit": "kg", "load": 100, "reps": 5, "epley_1rm": 116.7, "brzycki_1rm": 112.5, "kcal_total": null, "phase": null, "protein": null, "carbs": null, "fat": null, "tdee_reference": null, "weight_kg": null, "height_cm": null, "age": null, "sex": null, "activity_level": null, "bmr": null, "tdee": null }',
    "EXAMPLE tdee_calculator:",
    '  data: { "weight_kg": 80, "height_cm": 180, "age": 32, "sex": "male", "activity_level": "moderate", "bmr": 1810, "tdee": 2805, "kcal_total": null, "phase": null, "protein": null, "carbs": null, "fat": null, "tdee_reference": null, "lift": null, "unit": null, "load": null, "reps": null, "epley_1rm": null, "brzycki_1rm": null }',
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
      type: { type: "string", enum: [
        "macro_ring", "tdee_calculator", "one_rm_estimator",
        "macro_calculator", "plate_loader_visual", "rpe_to_percent_rm",
        "body_fat_estimator", "carb_cycling_calculator",
        "protein_target_calculator", "pace_calculator",
      ] },
      data: CALCULATOR_DATA,
    },
  },
};

// ── emit_nutrition_widget (widget-v2 · F3) ──────────────────────────
// Superset data — strict:true. Item-shape collision on `meals` is
// resolved by renaming to `protein_meals` / `macro_meals` per type.

const NUTRITION_PROTEIN_MEAL = {
  type: "object",
  required: ["slot", "grams", "hour"],
  additionalProperties: false,
  properties: {
    slot: { type: "string" },
    grams: { type: "number" },
    hour: { type: "integer" },
  },
};

const NUTRITION_MACRO_MEAL = {
  type: "object",
  required: ["name", "protein_kcal", "carbs_kcal", "fat_kcal"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    protein_kcal: { type: "number" },
    carbs_kcal: { type: "number" },
    fat_kcal: { type: "number" },
  },
};

const NUTRITION_FOOD_POINT = {
  type: "object",
  required: ["name", "x", "y"],
  additionalProperties: false,
  properties: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
};
const NUTRITION_HYDRATION_EVENT = {
  type: "object",
  required: ["hour", "volume_ml", "kind"],
  additionalProperties: false,
  properties: {
    hour: { type: "integer" }, volume_ml: { type: "number" },
    kind: { type: ["string", "null"], enum: ["fluid", "meal", "workout", null] },
  },
};
const NUTRITION_RADAR_AXIS = {
  type: "object",
  required: ["name", "pct"],
  additionalProperties: false,
  properties: { name: { type: "string" }, pct: { type: "number" } },
};
const NUTRITION_LEDGER_DAY = {
  type: "object",
  required: ["date", "intake", "expenditure"],
  additionalProperties: false,
  properties: { date: { type: "string" }, intake: { type: "number" }, expenditure: { type: "number" } },
};
const NUTRITION_TIMING_MEAL = {
  type: "object",
  required: ["hour", "label"],
  additionalProperties: false,
  properties: { hour: { type: "number" }, label: { type: "string" } },
};
const NUTRITION_LEG = {
  type: ["object", "null"],
  required: ["grams", "target_grams", "kcal"],
  additionalProperties: false,
  properties: { grams: { type: "number" }, target_grams: { type: "number" }, kcal: { type: "number" } },
};
const NUTRITION_DATA = {
  type: "object",
  required: [
    "daily_target_g", "protein_meals", "daily_total_kcal", "macro_meals",
    "x_label", "y_label", "foods",
    "target_ml", "events",
    "axes",
    "days",
    "workout_hour", "logged", "recommended_window",
    "bmr", "tea", "neat", "tef", "tdee",
    "kcal_total", "protein", "carbs", "fat",
  ],
  additionalProperties: false,
  properties: {
    daily_target_g: { type: ["number", "null"] },
    protein_meals: { type: ["array", "null"], items: NUTRITION_PROTEIN_MEAL },
    daily_total_kcal: { type: ["number", "null"] },
    macro_meals: { type: ["array", "null"], items: NUTRITION_MACRO_MEAL },
    x_label: { type: ["string", "null"] },
    y_label: { type: ["string", "null"] },
    foods: { type: ["array", "null"], items: NUTRITION_FOOD_POINT },
    target_ml: { type: ["number", "null"] },
    events: { type: ["array", "null"], items: NUTRITION_HYDRATION_EVENT },
    axes: { type: ["array", "null"], items: NUTRITION_RADAR_AXIS },
    days: { type: ["array", "null"], items: NUTRITION_LEDGER_DAY },
    workout_hour: { type: ["number", "null"] },
    logged: { type: ["array", "null"], items: NUTRITION_TIMING_MEAL },
    recommended_window: {
      type: ["object", "null"],
      required: ["start", "end"],
      additionalProperties: false,
      properties: { start: { type: "number" }, end: { type: "number" } },
    },
    bmr: { type: ["number", "null"] },
    tea: { type: ["number", "null"] },
    neat: { type: ["number", "null"] },
    tef: { type: ["number", "null"] },
    tdee: { type: ["number", "null"] },
    kcal_total: { type: ["number", "null"] },
    protein: NUTRITION_LEG,
    carbs: NUTRITION_LEG,
    fat: NUTRITION_LEG,
  },
};

// Strict mode is enabled via the superset-data pattern: NUTRITION_DATA lists
// every field from every template; unused fields are emitted as null. The
// server-side validator (shared/widget-v2/validators/nutrition.js) still runs
// for business rules (type↔required-field cross-checks) and surfaces
// tool_error SSE for payloads that pass schema but fail semantics.
const EMIT_NUTRITION_WIDGET = {
  type: "function",
  name: "emit_nutrition_widget",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL when the user asks to visualize nutrition distribution across a day — protein timing per meal, or per-meal macro composition. Write 2-4 sentences of prose FIRST, then call. Prefer this over emit_widget for nutrition visuals.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  distribute my protein, spread protein across meals, protein per meal, protein timing,",
    "  how much at breakfast/lunch/dinner, macros by meal, macro breakdown by meal,",
    "  per-meal calories, meal kcal breakdown, visualize my daily nutrition,",
    "  breakdown of each meal, P/C/F per meal, P/C/F breakdown by meal,",
    "  compare macro composition across meals, graph my per-meal [macro],",
    "  which meal has the most [carbs/protein/fat], meal-by-meal composition,",
    "  show [macro] by meal, plot meal macros",
    "",
    "TEMPLATE SELECTION:",
    "  protein_distribution_bar — horizontal bars of protein grams per meal across the day vs a daily target.",
    "  meal_macro_stack — stacked P/C/F bars per meal (kcal).",
    "  food_nutrient_scatter — scatter of foods on two nutrient density axes (numbered, with legend table).",
    "  hydration_timeline — cumulative fluid vs ideal-pace line; meal and workout icons on the axis.",
    "  micronutrient_radar — 3-10 axis radar of vitamin/mineral % RDI coverage with 50% threshold ring.",
    "  calorie_balance_ledger — dual-direction in-vs-out bars per day over a short window.",
    "  meal_timing_strip — meals plotted around a workout anchor with an optional recommended window.",
    "  tdee_waterfall — BMR → TEA → NEAT → TEF → TDEE cumulative bar composition.",
    "  macro_ring_nutrition — macro donut + per-macro progress bars (F3 variant, simpler than macro_ring in calculator family).",
    "",
    "DO NOT CALL for: macro-split donut (use emit_calculator_widget type=macro_ring), meal-plan construction (use emit_meal_plan).",
    "",
    "DATA SHAPE (strict: fill the fields your `type` uses, null the others. The `meals` array is split into `protein_meals` / `macro_meals` to keep strict-mode happy):",
    "  protein_distribution_bar fills: daily_target_g, protein_meals",
    "  meal_macro_stack fills: daily_total_kcal, macro_meals",
    "",
    "EXAMPLE protein_distribution_bar:",
    '  data: { "daily_target_g": 180, "protein_meals": [{ "slot": "breakfast", "grams": 40, "hour": 8 }], "daily_total_kcal": null, "macro_meals": null }',
    "EXAMPLE meal_macro_stack:",
    '  data: { "daily_target_g": null, "protein_meals": null, "daily_total_kcal": 2400, "macro_meals": [{ "name": "Breakfast", "protein_kcal": 180, "carbs_kcal": 240, "fat_kcal": 160 }] }',
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
      type: { type: "string", enum: [
        "protein_distribution_bar", "meal_macro_stack",
        "food_nutrient_scatter", "hydration_timeline", "micronutrient_radar",
        "calorie_balance_ledger", "meal_timing_strip", "tdee_waterfall",
        "macro_ring_nutrition",
      ] },
      data: NUTRITION_DATA,
    },
  },
};

// ── emit_training_widget (widget-v2 · F2) ──────────────────────────

// Training superset data — strict:true. `weeks` (int, periodization total
// week count) would collide with the grid's column-index array, so the
// grid renames its field to `grid_weeks`.
const TRAINING_PHASE = {
  type: "object",
  required: ["name", "start_week", "end_week", "relative_load"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    start_week: { type: "integer" },
    end_week: { type: "integer" },
    relative_load: { type: "number" },
  },
};
const TRAINING_CELL = {
  type: "object",
  required: ["lift", "week", "volume"],
  additionalProperties: false,
  properties: {
    lift: { type: "string" },
    week: { type: "integer" },
    volume: { type: "number" },
  },
};
const TRAINING_MUSCLE = {
  type: "object",
  required: ["name", "mev", "mav", "mrv", "current"],
  additionalProperties: false,
  properties: { name: { type: "string" }, mev: { type: "number" }, mav: { type: "number" }, mrv: { type: "number" }, current: { type: "number" } },
};
const TRAINING_RPE_BUCKET = {
  type: "object",
  required: ["rpe", "count"],
  additionalProperties: false,
  properties: { rpe: { type: "number" }, count: { type: "integer" } },
};
const TRAINING_SCHEME = {
  type: "object",
  required: ["label", "reps_low", "reps_high", "pct_low", "pct_high", "focus"],
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    reps_low: { type: "number" }, reps_high: { type: "number" },
    pct_low: { type: "number" }, pct_high: { type: "number" },
    focus: { type: "string", enum: ["STR", "HYP", "END", "POW"] },
  },
};
const TRAINING_TSB_POINT = {
  type: "object",
  required: ["date", "ctl", "atl", "tsb"],
  additionalProperties: false,
  properties: { date: { type: "string" }, ctl: { type: "number" }, atl: { type: "number" }, tsb: { type: "number" } },
};
const TRAINING_SIGNAL = {
  type: "object",
  required: ["name", "score"],
  additionalProperties: false,
  properties: { name: { type: "string" }, score: { type: "number" } },
};
const TRAINING_DAY = {
  type: "object",
  required: ["label", "session", "intensity"],
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    session: { type: ["string", "null"] },
    intensity: { type: ["number", "null"] },
  },
};
const TRAINING_DELOAD_PHASE = {
  type: ["object", "null"],
  required: ["sets", "rpe"],
  additionalProperties: false,
  properties: { sets: { type: "number" }, rpe: { type: "number" } },
};
const TRAINING_FATIGUE_POINT = {
  type: "object",
  required: ["label", "value"],
  additionalProperties: false,
  properties: { label: { type: "string" }, value: { type: "number" } },
};
const TRAINING_DATA = {
  type: "object",
  required: [
    "weeks", "focus_metric", "phases",
    "lifts", "grid_weeks", "cells",
    "muscles", "metric_label",
    "buckets", "target_rpe",
    "schemes",
    "series",
    "readiness_score", "signals",
    "days",
    "before", "during", "after", "fatigue_curve",
  ],
  additionalProperties: false,
  properties: {
    weeks: { type: ["integer", "null"] },
    focus_metric: { type: ["string", "null"], enum: ["volume", "intensity", "frequency", null] },
    phases: { type: ["array", "null"], items: TRAINING_PHASE },
    lifts: { type: ["array", "null"], items: { type: "string" } },
    grid_weeks: { type: ["array", "null"], items: { type: "integer" } },
    cells: { type: ["array", "null"], items: TRAINING_CELL },
    muscles: { type: ["array", "null"], items: TRAINING_MUSCLE },
    metric_label: { type: ["string", "null"] },
    buckets: { type: ["array", "null"], items: TRAINING_RPE_BUCKET },
    target_rpe: { type: ["number", "null"] },
    schemes: { type: ["array", "null"], items: TRAINING_SCHEME },
    series: { type: ["array", "null"], items: TRAINING_TSB_POINT },
    readiness_score: { type: ["number", "null"] },
    signals: { type: ["array", "null"], items: TRAINING_SIGNAL },
    days: { type: ["array", "null"], items: TRAINING_DAY },
    before: TRAINING_DELOAD_PHASE,
    during: TRAINING_DELOAD_PHASE,
    after: TRAINING_DELOAD_PHASE,
    fatigue_curve: { type: ["array", "null"], items: TRAINING_FATIGUE_POINT },
  },
};

const EMIT_TRAINING_WIDGET = {
  type: "function",
  name: "emit_training_widget",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL when the user asks about training-block structure — multi-phase periodization layouts or week-by-week volume distribution. Write 2-4 sentences of prose FIRST, then call. Prefer this over emit_widget for programming visuals.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  periodization, block plan, training block, mesocycle, macrocycle,",
    "  accumulation/intensification/realization/deload, hypertrophy block, strength block,",
    "  volume per week, weekly volume, working sets per week, lift-by-lift volume, volume heatmap",
    "",
    "TEMPLATE SELECTION:",
    "  periodization_ladder — multi-phase block plan (accumulation → intensification → realization → deload).",
    "  volume_intensity_grid — heatmap of lifts × weeks × working volume.",
    "  mev_mrv_range — MEV/MAV/MRV floating bars per muscle + current-volume dot.",
    "  rpe_histogram — bar distribution of session RPEs with optional target line.",
    "  rep_scheme_grid — table of reps × %1RM schemes with STR/HYP/END/POW focus badges.",
    "  training_stress_balance — CTL/ATL/TSB triple-line trend.",
    "  fatigue_readiness_composite — big readiness ring + contributing signal bars.",
    "  weekly_plan_calendar — 7-day strip with intensity-shaded session cards.",
    "  deload_protocol — before/during/after sets + rpe, with fatigue-curve overlay.",
    "",
    "DO NOT CALL for: a concrete workout plan (use emit_workout_plan), single-session RPE/load, or exercise form cues.",
    "",
    "DATA SHAPE (strict: fill the fields your `type` uses, null the others. Field-clash fix: `weeks` is the periodization total week count (int); the grid's column indices use `grid_weeks`):",
    "  periodization_ladder fills: weeks (int), focus_metric, phases",
    "  volume_intensity_grid fills: lifts, grid_weeks, cells",
    "",
    "EXAMPLE periodization_ladder:",
    '  data: { "weeks": 12, "focus_metric": "volume", "phases": [{ "name": "Accumulation", "start_week": 1, "end_week": 4, "relative_load": 0.75 }], "lifts": null, "grid_weeks": null, "cells": null }',
    "EXAMPLE volume_intensity_grid:",
    '  data: { "weeks": null, "focus_metric": null, "phases": null, "lifts": ["Squat","Bench"], "grid_weeks": [1,2,3,4], "cells": [{ "lift": "Squat", "week": 1, "volume": 120 }] }',
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
      type: { type: "string", enum: [
        "periodization_ladder", "volume_intensity_grid",
        "mev_mrv_range", "rpe_histogram", "rep_scheme_grid",
        "training_stress_balance", "fatigue_readiness_composite",
        "weekly_plan_calendar", "deload_protocol",
      ] },
      data: TRAINING_DATA,
    },
  },
};

// ── emit_progress_widget (widget-v2 · F5) ──────────────────────────

// Progress superset data — strict:true. No field-name collisions across
// the two templates so every field lives at the top of `data`.
const PROGRESS_PR_ENTRY = {
  type: "object",
  required: ["date", "load", "reps"],
  additionalProperties: false,
  properties: {
    date: { type: "string" },   // YYYY-MM-DD
    load: { type: "number" },
    reps: { type: "integer" },
  },
};
const PROGRESS_TREND_POINT = {
  type: "object",
  required: ["week_start", "value"],
  additionalProperties: false,
  properties: {
    week_start: { type: "string" },   // YYYY-MM-DD
    value: { type: "number" },
  },
};
const PROGRESS_LIFT = {
  type: "object",
  required: ["name", "current", "delta_pct", "sparkline", "plateau"],
  additionalProperties: false,
  properties: {
    name: { type: "string" }, current: { type: "number" }, delta_pct: { type: "number" },
    sparkline: { type: "array", items: { type: "number" } },
    plateau: { type: ["boolean", "null"] },
  },
};
const PROGRESS_MUSCLE_SETS = {
  type: "object",
  required: ["muscle", "sets"],
  additionalProperties: false,
  properties: { muscle: { type: "string" }, sets: { type: "number" } },
};
const PROGRESS_WEEK = {
  type: "object",
  required: ["week_start", "muscle_sets"],
  additionalProperties: false,
  properties: {
    week_start: { type: "string" },
    muscle_sets: { type: "array", items: PROGRESS_MUSCLE_SETS },
  },
};
const PROGRESS_ADHERENCE_CELL = {
  type: "object",
  required: ["date", "intensity"],
  additionalProperties: false,
  properties: { date: { type: "string" }, intensity: { type: "number" } },
};
const PROGRESS_COMP_POINT = {
  type: "object",
  required: ["date", "bw", "lbm", "fm"],
  additionalProperties: false,
  properties: { date: { type: "string" }, bw: { type: "number" }, lbm: { type: "number" }, fm: { type: "number" } },
};
const PROGRESS_GOAL_POINT = {
  type: "object",
  required: ["date", "value"],
  additionalProperties: false,
  properties: { date: { type: "string" }, value: { type: "number" } },
};
const PROGRESS_PROJ_POINT = {
  type: "object",
  required: ["date", "low", "high"],
  additionalProperties: false,
  properties: { date: { type: "string" }, low: { type: "number" }, high: { type: "number" } },
};
const PROGRESS_PERSON = {
  type: "object",
  required: ["label", "before", "after"],
  additionalProperties: false,
  properties: { label: { type: "string" }, before: { type: "number" }, after: { type: "number" } },
};
const PROGRESS_SESSION = {
  type: "object",
  required: ["date", "hour"],
  additionalProperties: false,
  properties: { date: { type: "string" }, hour: { type: "number" } },
};
const PROGRESS_VO2_POINT = {
  type: "object",
  required: ["date", "value"],
  additionalProperties: false,
  properties: { date: { type: "string" }, value: { type: "number" } },
};
const PROGRESS_NIGHT = {
  type: "object",
  required: ["date", "bed_hour", "wake_hour"],
  additionalProperties: false,
  properties: { date: { type: "string" }, bed_hour: { type: "number" }, wake_hour: { type: "number" } },
};
const PROGRESS_DATA = {
  type: "object",
  required: [
    "lift", "unit", "entries",
    "metric", "trend_points",
    "lifts",
    "weeks", "muscle_order",
    "cells",
    "comp_points",
    "actual", "projected", "goal_value",
    "before_label", "after_label", "people",
    "sessions",
    "vo2_points", "age_group",
    "nights", "target_bed", "target_wake",
    "value", "previous", "context",
    "current", "best", "last_14",
  ],
  additionalProperties: false,
  properties: {
    lift: { type: ["string", "null"] },
    unit: { type: ["string", "null"], enum: ["kg", "lb", null] },
    entries: { type: ["array", "null"], items: PROGRESS_PR_ENTRY },
    metric: { type: ["string", "null"] },
    trend_points: { type: ["array", "null"], items: PROGRESS_TREND_POINT },
    lifts: { type: ["array", "null"], items: PROGRESS_LIFT },
    weeks: { type: ["array", "null"], items: PROGRESS_WEEK },
    muscle_order: { type: ["array", "null"], items: { type: "string" } },
    cells: { type: ["array", "null"], items: PROGRESS_ADHERENCE_CELL },
    comp_points: { type: ["array", "null"], items: PROGRESS_COMP_POINT },
    actual: { type: ["array", "null"], items: PROGRESS_GOAL_POINT },
    projected: { type: ["array", "null"], items: PROGRESS_PROJ_POINT },
    goal_value: { type: ["number", "null"] },
    before_label: { type: ["string", "null"] },
    after_label: { type: ["string", "null"] },
    people: { type: ["array", "null"], items: PROGRESS_PERSON },
    sessions: { type: ["array", "null"], items: PROGRESS_SESSION },
    vo2_points: { type: ["array", "null"], items: PROGRESS_VO2_POINT },
    age_group: { type: ["string", "null"] },
    nights: { type: ["array", "null"], items: PROGRESS_NIGHT },
    target_bed: { type: ["number", "null"] },
    target_wake: { type: ["number", "null"] },
    value: { type: ["number", "null"] },
    previous: { type: ["number", "null"] },
    context: { type: ["string", "null"] },
    current: { type: ["integer", "null"] },
    best: { type: ["integer", "null"] },
    last_14: { type: ["array", "null"], items: { type: "boolean" } },
  },
};

const EMIT_PROGRESS_WIDGET = {
  type: "function",
  name: "emit_progress_widget",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL when the user shares their own logged numbers over time (PRs, weekly volume, any metric with dates) and asks to plot / show / trend it. Write 2-4 sentences of prose FIRST, then call. Prefer this over emit_widget for personal-progression visuals.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  plot my PRs, show my history, bench over time, my squat progress, track my progress,",
    "  weekly tonnage, volume trend, session count trend, my numbers this year,",
    "  how has my X changed, graph my lifts, PR timeline,",
    "  tonnage has been X Y Z, volume was N last week, is that trending up,",
    "  am I progressing, is this going up or down, what direction is my [metric]",
    "",
    "TEMPLATE SELECTION:",
    "  pr_timeline — e1RM trend across dated sessions for one lift (alias: pr_progression_line).",
    "  volume_trend — weekly metric trend (tonnage, working sets, time under tension).",
    "  lift_progress_grid — 1-9 dashboard cards each with current number + delta % + sparkline + plateau flag.",
    "  weekly_volume_trend — stacked bar per week grouped by muscle.",
    "  adherence_calendar_heatmap — GitHub-style calendar showing session intensity per day.",
    "  body_comp_trend — three-line overlay of BW, lean mass, fat mass over time.",
    "  goal_trajectory_dual — actual-so-far line + projected cone + goal-value reference line.",
    "  intervention_slopegraph — before/after two-column slopegraph, one line per person.",
    "  session_consistency_strip — scatter of session start-hours across dates.",
    "  vo2max_trend — VO₂ max over time with Cooper age-group zone bands.",
    "  sleep_consistency_bars — per-night bedtime→wake bars with target ribbons.",
    "  pr_celebration_card — hero number + context + delta from previous PR.",
    "  streak_counter_card — current / best streak stat pair + 14-day proof dots (display_width: narrow).",
    "",
    "DO NOT CALL for: cross-user benchmarks, predictions of future PRs, or generic progression theory. This tool visualizes history only.",
    "",
    "DATA SHAPE (strict: fill the fields your `type` uses, set every other field to null):",
    "  pr_timeline fills: lift, unit, entries",
    "  volume_trend fills: metric, points",
    "",
    "EXAMPLE pr_timeline call:",
    '  data: { "lift": "Bench Press", "unit": "kg", "entries": [{ "date": "2026-01-14", "load": 80, "reps": 5 }], "metric": null, "points": null }',
    "EXAMPLE volume_trend call:",
    '  data: { "lift": null, "unit": null, "entries": null, "metric": "Squat tonnage (kg)", "points": [{ "week_start": "2026-01-05", "value": 4800 }] }',
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
      type: { type: "string", enum: [
        "pr_timeline", "volume_trend",
        "pr_progression_line", "lift_progress_grid", "weekly_volume_trend",
        "adherence_calendar_heatmap", "body_comp_trend", "goal_trajectory_dual",
        "intervention_slopegraph", "session_consistency_strip", "vo2max_trend",
        "sleep_consistency_bars", "pr_celebration_card", "streak_counter_card",
      ] },
      data: PROGRESS_DATA,
    },
  },
};

// ── emit_pharma_widget (widget-v2 · F1) ────────────────────────────

// Pharma data superset — strict:true compatible. The `data` schema lists
// every field from every type; fields not used by the chosen type are
// emitted as null. No field name collides across types.
const PHARMA_POINT = {
  type: "object",
  required: ["dose", "effect_pct", "study_n"],
  additionalProperties: false,
  properties: {
    dose: { type: "number" },
    effect_pct: { type: "number" },
    study_n: { type: ["integer", "null"] },
  },
};
const PHARMA_DOSE = {
  type: "object",
  required: ["hour", "amount", "unit"],
  additionalProperties: false,
  properties: { hour: { type: "number" }, amount: { type: "number" }, unit: { type: "string" } },
};
const PHARMA_SUPPLEMENT = {
  type: "object",
  required: ["name", "doses"],
  additionalProperties: false,
  properties: { name: { type: "string" }, doses: { type: "array", items: PHARMA_DOSE } },
};
const PHARMA_XY = {
  type: "object",
  required: ["x", "y"],
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
};
const PHARMA_PROTOCOL = {
  type: "object",
  required: ["label", "points"],
  additionalProperties: false,
  properties: { label: { type: "string" }, points: { type: "array", items: PHARMA_XY } },
};
const PHARMA_ABS_POINT = {
  type: "object",
  required: ["hour", "amount"],
  additionalProperties: false,
  properties: { hour: { type: "number" }, amount: { type: "number" } },
};
const PHARMA_CURVE = {
  type: "object",
  required: ["label", "points", "peak_hour"],
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    points: { type: "array", items: PHARMA_ABS_POINT },
    peak_hour: { type: ["number", "null"] },
  },
};
const PHARMA_COMPOUND = {
  type: "object",
  required: ["name", "onset_hour", "peak_start_hour", "peak_end_hour", "wearoff_hour"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    onset_hour: { type: "number" },
    peak_start_hour: { type: "number" },
    peak_end_hour: { type: "number" },
    wearoff_hour: { type: "number" },
  },
};
const PHARMA_ZONES = {
  type: ["object", "null"],
  required: ["sub_max", "therapeutic_min", "therapeutic_max", "over_min"],
  additionalProperties: false,
  properties: {
    sub_max: { type: "number" }, therapeutic_min: { type: "number" },
    therapeutic_max: { type: "number" }, over_min: { type: "number" },
  },
};
const PHARMA_DATA = {
  type: "object",
  required: [
    "compound",
    // dose_response_curve
    "unit", "points", "recommended_range",
    // half_life_decay
    "half_life_hours", "initial_dose", "dose_unit", "horizon_hours",
    // supplement_stack_schedule
    "supplements", "day_label",
    // loading_vs_maintenance
    "protocols", "saturation_y", "x_label", "y_label",
    // absorption_multi_protein
    "curves", "total_hours",
    // effect_duration_strip
    "compounds",
    // dose_threshold_band
    "current_dose", "zones", "axis_max",
  ],
  additionalProperties: false,
  properties: {
    compound: { type: ["string", "null"] },
    unit: { type: ["string", "null"], enum: ["mg", "mg/kg", "g", "IU", null] },
    points: { type: ["array", "null"], items: PHARMA_POINT },
    recommended_range: {
      type: ["object", "null"],
      required: ["min", "max"],
      additionalProperties: false,
      properties: { min: { type: "number" }, max: { type: "number" } },
    },
    half_life_hours: { type: ["number", "null"] },
    initial_dose: { type: ["number", "null"] },
    dose_unit: { type: ["string", "null"] },
    horizon_hours: { type: ["integer", "null"] },
    supplements: { type: ["array", "null"], items: PHARMA_SUPPLEMENT },
    day_label: { type: ["string", "null"] },
    protocols: { type: ["array", "null"], items: PHARMA_PROTOCOL },
    saturation_y: { type: ["number", "null"] },
    x_label: { type: ["string", "null"] },
    y_label: { type: ["string", "null"] },
    curves: { type: ["array", "null"], items: PHARMA_CURVE },
    total_hours: { type: ["number", "null"] },
    compounds: { type: ["array", "null"], items: PHARMA_COMPOUND },
    current_dose: { type: ["number", "null"] },
    zones: PHARMA_ZONES,
    axis_max: { type: ["number", "null"] },
  },
};

const EMIT_PHARMA_WIDGET = {
  type: "function",
  name: "emit_pharma_widget",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL when the user asks about supplement or compound pharmacokinetics — dose-response curves or how long something stays in the system. Write 2-4 sentences of prose FIRST, then call. Prefer this over emit_widget for pharma visuals.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  plot … decay, show … half-life, concentration over time, how long does X stay in my system,",
    "  dose-response curve, optimal dose, minimum effective dose, ceiling dose, diminishing returns,",
    "  how much caffeine/creatine/ashwagandha should I take, what dose, dose vs effect",
    "",
    "TEMPLATE SELECTION:",
    "  dose_response_curve — effect vs dose with optional recommended-range band.",
    "  half_life_decay — concentration-vs-time from a single dose.",
    "  supplement_stack_schedule — daily lane chart with dose pills at their hours.",
    "  loading_vs_maintenance — two protocol curves comparing loading phase vs steady-state.",
    "  absorption_multi_protein — 2-4 overlaid absorption curves (e.g. whey/casein/soy).",
    "  effect_duration_strip — lozenge per compound with onset → peak → wear-off windows.",
    "  dose_threshold_band — 1D dose ladder with sub/therapeutic/over zones + current marker.",
    "",
    "DO NOT CALL for: prescription medication dosing (redirect to clinician), stacking/polypharmacy interaction matrices, or individual PK predictions.",
    "",
    "DATA SHAPE (strict: fill ONLY the fields your `type` uses, set every other field to null):",
    "  dose_response_curve: compound, unit, points[], recommended_range",
    "  half_life_decay: compound, half_life_hours, initial_dose, dose_unit, horizon_hours",
    "  supplement_stack_schedule: supplements[{name, doses[{hour,amount,unit}]}], day_label",
    "  loading_vs_maintenance: protocols[2]{label, points[{x,y}]}, saturation_y, x_label, y_label",
    "  absorption_multi_protein: curves[2-4]{label, peak_hour, points[{hour,amount}]}, total_hours",
    "  effect_duration_strip: compounds[{name,onset_hour,peak_start_hour,peak_end_hour,wearoff_hour}], total_hours",
    "  dose_threshold_band: compound, dose_unit, current_dose, zones{sub_max,therapeutic_min,therapeutic_max,over_min}, axis_max",
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
      type: { type: "string", enum: [
        "dose_response_curve", "half_life_decay",
        "supplement_stack_schedule", "loading_vs_maintenance",
        "absorption_multi_protein", "effect_duration_strip",
        "dose_threshold_band",
      ] },
      data: PHARMA_DATA,
    },
  },
};

// ── emit_evidence_widget (widget-v2 · F4) ──────────────────────────

// Evidence superset data — strict:true. No cross-type collisions.
const EVIDENCE_STUDY = {
  type: "object",
  required: ["citation", "design", "n", "effect_size", "direction"],
  additionalProperties: false,
  properties: {
    citation: { type: "string" },
    design: { type: "string", enum: ["RCT", "meta", "cohort", "review", "other"] },
    n: { type: ["integer", "null"] },
    effect_size: { type: ["number", "null"] },
    direction: { type: "string", enum: ["positive", "null", "negative"] },
  },
};
const EVIDENCE_FOREST_ROW = {
  type: "object",
  required: ["label", "effect", "ci_low", "ci_high"],
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    effect: { type: "number" },
    ci_low: { type: "number" },
    ci_high: { type: "number" },
  },
};
const EVIDENCE_FP_STUDY = {
  type: "object",
  required: ["label", "n", "effect", "ci_low", "ci_high", "is_outlier"],
  additionalProperties: false,
  properties: {
    label: { type: "string" }, n: { type: "integer" },
    effect: { type: "number" }, ci_low: { type: "number" }, ci_high: { type: "number" },
    is_outlier: { type: ["boolean", "null"] },
  },
};
const EVIDENCE_FP_POOLED = {
  type: ["object", "null"],
  required: ["k", "effect", "ci_low", "ci_high"],
  additionalProperties: false,
  properties: {
    k: { type: "integer" }, effect: { type: "number" },
    ci_low: { type: "number" }, ci_high: { type: "number" },
  },
};
const EVIDENCE_FACTOR = {
  type: "object",
  required: ["name", "rating", "note"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    rating: { type: "string", enum: ["high", "moderate", "low"] },
    note: { type: ["string", "null"] },
  },
};
const EVIDENCE_PROCON = {
  type: "object",
  required: ["label", "magnitude"],
  additionalProperties: false,
  properties: { label: { type: "string" }, magnitude: { type: "number" } },
};
const EVIDENCE_QUALITY_STUDY = {
  type: "object",
  required: ["label", "n", "duration_weeks", "design"],
  additionalProperties: false,
  properties: {
    label: { type: "string" }, n: { type: "integer" }, duration_weeks: { type: "number" },
    design: { type: "string", enum: ["RCT", "meta", "cohort", "review", "other"] },
  },
};
const EVIDENCE_METAREG_POINT = {
  type: "object",
  required: ["label", "x", "y"],
  additionalProperties: false,
  properties: { label: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
};
const EVIDENCE_REGRESSION = {
  type: ["object", "null"],
  required: ["slope", "intercept", "r_squared"],
  additionalProperties: false,
  properties: { slope: { type: "number" }, intercept: { type: "number" }, r_squared: { type: "number" } },
};
const EVIDENCE_LADDER_PROTO = {
  type: "object",
  required: ["label", "effect", "ci_low", "ci_high"],
  additionalProperties: false,
  properties: { label: { type: "string" }, effect: { type: "number" }, ci_low: { type: "number" }, ci_high: { type: "number" } },
};
const EVIDENCE_CITATION_STUDY = {
  type: "object",
  required: ["year", "label", "citations"],
  additionalProperties: false,
  properties: { year: { type: "integer" }, label: { type: "string" }, citations: { type: "integer" } },
};
const EVIDENCE_BEESWARM_DOT = {
  type: "object",
  required: ["label", "effect"],
  additionalProperties: false,
  properties: { label: { type: "string" }, effect: { type: "number" } },
};
const EVIDENCE_DATA = {
  type: "object",
  required: [
    "question", "studies", "outcome", "rows",
    "outcome_label", "x_axis", "fp_studies", "pooled",
    "claim", "level", "factors",
    "subject", "pros", "cons",
    "quality_studies",
    "x_label", "y_label", "regression_points", "regression",
    "ladder_protocols",
    "timeline_studies",
    "beeswarm_dots",
  ],
  additionalProperties: false,
  properties: {
    question: { type: ["string", "null"] },
    studies: { type: ["array", "null"], items: EVIDENCE_STUDY },
    outcome: { type: ["string", "null"] },
    rows: { type: ["array", "null"], items: EVIDENCE_FOREST_ROW },
    outcome_label: { type: ["string", "null"] },
    x_axis: {
      type: ["object", "null"],
      required: ["min", "max", "label"],
      additionalProperties: false,
      properties: { min: { type: "number" }, max: { type: "number" }, label: { type: ["string", "null"] } },
    },
    fp_studies: { type: ["array", "null"], items: EVIDENCE_FP_STUDY },
    pooled: EVIDENCE_FP_POOLED,
    claim: { type: ["string", "null"] },
    level: { type: ["string", "null"], enum: ["strong", "moderate", "limited", "insufficient", null] },
    factors: { type: ["array", "null"], items: EVIDENCE_FACTOR },
    subject: { type: ["string", "null"] },
    pros: { type: ["array", "null"], items: EVIDENCE_PROCON },
    cons: { type: ["array", "null"], items: EVIDENCE_PROCON },
    quality_studies: { type: ["array", "null"], items: EVIDENCE_QUALITY_STUDY },
    x_label: { type: ["string", "null"] },
    y_label: { type: ["string", "null"] },
    regression_points: { type: ["array", "null"], items: EVIDENCE_METAREG_POINT },
    regression: EVIDENCE_REGRESSION,
    ladder_protocols: { type: ["array", "null"], items: EVIDENCE_LADDER_PROTO },
    timeline_studies: { type: ["array", "null"], items: EVIDENCE_CITATION_STUDY },
    beeswarm_dots: { type: ["array", "null"], items: EVIDENCE_BEESWARM_DOT },
  },
};

const EMIT_EVIDENCE_WIDGET = {
  type: "function",
  name: "emit_evidence_widget",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL when the user asks to see the evidence base for a claim (what studies say about X) or the effect-size landscape (how big are the effects, how consistent). Write 2-4 sentences of prose FIRST, then call. Prefer this over emit_widget for evidence visuals.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  what does the evidence say, what do studies show, summarize the research,",
    "  effect size, forest plot, CI, confidence interval, meta-analysis,",
    "  how strong is the evidence, compare the studies, show me the studies on X",
    "",
    "TEMPLATE SELECTION:",
    "  study_matrix — table of studies with design, n, effect size, direction.",
    "  effect_size_forest — simple forest plot of effect sizes with 95% CIs.",
    "  forest_plot — classic meta-analysis forest with per-study square sized by n, CI whiskers, pooled diamond at bottom.",
    "  evidence_strength_card — GRADE-style badge card for a claim with contributing factors.",
    "  butterfly_comparison — pros vs cons two-sided bars from a center axis.",
    "  study_quality_matrix — n × duration scatter with design-shape encoding.",
    "  meta_regression_line — dose/moderator vs effect scatter with fitted line + R².",
    "  ci_ladder — protocols ranked by effect with CI whiskers; overlap = no statistical preference.",
    "  citation_timeline — studies by year with dot size/opacity tracking citation count.",
    "  study_beeswarm — every study as a dot jittered vertically; simple spread view.",
    "",
    "DATA SHAPE (strict: fill the fields your `type` uses, null the others):",
    "  study_matrix fills: question, studies",
    "  effect_size_forest fills: outcome, rows",
    "",
    "EXAMPLE study_matrix:",
    '  data: { "question": "Does creatine improve 1RM?", "studies": [{ "citation": "Branch 2003 (meta)", "design": "meta", "n": 500, "effect_size": 0.43, "direction": "positive" }], "outcome": null, "rows": null }',
    "EXAMPLE effect_size_forest:",
    '  data: { "question": null, "studies": null, "outcome": "Bench 1RM (kg)", "rows": [{ "label": "Branch 2003", "effect": 0.43, "ci_low": 0.28, "ci_high": 0.58 }] }',
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
      type: { type: "string", enum: [
        "study_matrix", "effect_size_forest",
        "forest_plot", "evidence_strength_card", "butterfly_comparison",
        "study_quality_matrix", "meta_regression_line", "ci_ladder",
        "citation_timeline", "study_beeswarm",
      ] },
      data: EVIDENCE_DATA,
    },
  },
};

// ── log_food ────────────────────────────────────────────────────────────

const LOG_FOOD = {
  type: "function",
  name: "log_food",
  strict: true,
  description: [
    "YOU MUST CALL THIS TOOL whenever the user reports food they ate, drank, or supplements they took. A text-only acknowledgment is a failure — always call this tool to log the food structurally.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  I had, I ate, I drank, I took, just had, for breakfast I, for lunch I,",
    "  log this, track this, had a shake, took my creatine, took my vitamins,",
    "  ate 200g chicken, had a sandwich, drank a protein shake",
    "",
    "Parse the food description into structured items with macros (kcal, protein_g, carbs_g, fat_g). Use USDA FDC reference data for macro estimates.",
    "Infer meal_slot from context or time of day if not stated.",
    "amount_unit MUST be 'g' or 'serving'. For solid foods and liquids, convert to grams (e.g. 250ml milk = 258g). For supplements with a per-serving base (capsules, tablets, scoops), use 'serving' and set amount to the number of servings. Set macros to 0 for supplements.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["meal_slot", "foods"],
    additionalProperties: false,
    properties: {
      meal_slot: {
        type: "string",
        enum: ["breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening", "pre_workout", "post_workout", "supplements_am", "supplements_pm"],
      },
      foods: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "amount", "amount_unit", "kcal", "protein_g", "carbs_g", "fat_g"],
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            amount:      { type: "number", description: "Quantity in the unit specified by amount_unit" },
            amount_unit: { type: "string", enum: ["g", "serving"] },
            kcal:        { type: "number" },
            protein_g:   { type: "number" },
            carbs_g:     { type: "number" },
            fat_g:       { type: "number" },
          },
        },
      },
    },
  },
};

// ── get_user_profile (server-side tool) ────────────────────────────────
//
// The model calls this when it needs profile data to personalize the answer.
// The server intercepts the call, injects the stored profile as the tool
// output, and continues generation via previous_response_id. The profile
// never appears in the initial prompt, so the model can't accidentally
// parrot it when the question doesn't need personalization.

const GET_USER_PROFILE = {
  type: "function",
  name: "get_user_profile",
  strict: true,
  description: [
    "Retrieve the user's saved profile (goal, experience, injuries, equipment, schedule, body metrics, dietary preferences).",
    "Call this when you need to personalize: workout plans, meal plans, injury-aware exercise swaps, schedule-specific programming, or body-metric calculations (TDEE, macros).",
    "Do NOT call for general knowledge questions that apply to everyone.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: [],
    additionalProperties: false,
    properties: {},
  },
};

// ── update_user_profile (server-side tool) ─────────────────────────────
//
// The onboarding flow calls this to persist profile fields extracted from
// the conversation. The server intercepts the call, PATCHes the profile
// to Supabase, returns a confirmation, and continues generation.
// Replaces the legacy ~~~profile-update fence pattern.

const UPDATE_USER_PROFILE = {
  type: "function",
  name: "update_user_profile",
  strict: true,
  description: [
    "Save or update fields on the user's saved profile (goal, experience, injuries, equipment, schedule, preferences).",
    "Call this when the user wants to change a saved preference in regular chat ('change my goal to strength', 'I just hurt my shoulder', 'switch me to lbs'), or during onboarding when you've extracted new profile information from their answer.",
    "Strict mode requires every field in the arguments object. Pass null for any field you are NOT updating — only provide a concrete value for the fields you intend to change. The server drops null values before persisting.",
    "During onboarding only: include onboarding_completed: true on the final exchange after all info is gathered.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: [
      "goal",
      "experience_level",
      "injuries_limitations",
      "equipment_access",
      "available_days_per_week",
      "dietary_preferences",
      "primary_use_case",
      "weight_unit",
      "distance_unit",
      "preferred_sports",
      "default_pool_length_m",
      "default_grade_system",
      "onboarding_completed",
    ],
    additionalProperties: false,
    properties: {
      goal: { type: ["string", "null"], description: "Primary fitness/health goal. Null = no change." },
      experience_level: { type: ["string", "null"], enum: ["beginner", "intermediate", "advanced", null], description: "Training experience level. Null = no change." },
      injuries_limitations: { type: ["string", "null"], description: "Any injuries or physical limitations. Null = no change." },
      equipment_access: { type: ["string", "null"], description: "What equipment they have access to. Null = no change." },
      available_days_per_week: { type: ["number", "null"], description: "Training days per week. Null = no change." },
      dietary_preferences: { type: ["string", "null"], description: "Diet preferences or restrictions. Null = no change." },
      primary_use_case: { type: ["string", "null"], description: "What they want to use Emersus for. Null = no change." },
      weight_unit: { type: ["string", "null"], enum: ["kg", "lbs", null], description: "Preferred weight unit. Null = no change." },
      distance_unit: { type: ["string", "null"], enum: ["km", "mi", null], description: "Preferred distance unit. Null = no change." },
      preferred_sports: {
        type: ["array", "null"],
        items: { type: "string", enum: ["weights", "running", "cycling", "swimming", "climbing", "mixed"] },
        description: "Sports/activities they do. Null = no change.",
      },
      default_pool_length_m: { type: ["number", "null"], enum: [25, 50, 22.86, 30.48, null], description: "Pool length in meters. Null = no change." },
      default_grade_system: { type: ["string", "null"], enum: ["V", "YDS", "Font", "French", null], description: "Climbing grade system. Null = no change." },
      onboarding_completed: { type: ["boolean", "null"], description: "Set true on the final exchange after all info is gathered. Null = no change." },
    },
  },
};

// ── remember_fact (server-side tool, flag-gated) ────────────────────────
//
// When MEMORY_REMEMBER_FACT_ENABLED=true, the model can call remember_fact
// to save an explicit user-requested fact to public.user_memories. Resolved
// server-side in stream.js. See spec §5.2.

export const MEMORY_CATEGORY_ENUM = [
  "injury","allergy","medication","chronic_condition","pregnancy_status","biological_constraint",
  "goal","target_metric","dietary_protocol","schedule_pattern","coach_program",
  "personal_record","completed_event",
  "deload_window","illness_recovery","travel_constraint","sleep_deficit",
  "exercise_preference","supplement_stack","equipment_inventory",
  "custom",
];

export const REMEMBER_FACT = {
  type: "function",
  name: "remember_fact",
  description:
    "Save a fact the user explicitly asked to remember across future conversations. Use ONLY when the user clearly signals save-intent (e.g., 'remember that…', 'note this for next time', 'make sure you know I…'). Do NOT infer save-intent — if the user didn't explicitly ask, don't call this. For facts that don't fit any whitelist category, use category='custom'. Keep the fact text under 500 characters. After the call returns, the result contains an `echo` field — surface that exact string in your reply verbatim (do not paraphrase it) so the user sees a deterministic save confirmation.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", enum: MEMORY_CATEGORY_ENUM },
      fact:     { type: "string" },
      note:     { type: ["string", "null"] },
    },
    required: ["category", "fact", "note"],
    additionalProperties: false,
  },
};

// ── recall_memory (server-side tool, flag-gated) ────────────────────────
//
// When MEMORY_RECALL_ENABLED=true, the model can query the user's memory
// on demand — for off-path questions that always-inject + RAG didn't cover.
// Typical uses: "what was my deadlift PR in March?", "remember when I
// mentioned my shoulder?". Wider than Phase 2 auto-retrieval: all tiers,
// includes resolved/archived history rows. See spec §5.3.

export const RECALL_MEMORY = {
  type: "function",
  name: "recall_memory",
  description:
    "Retrieve prior-thread memory about the user. Use when you need context the profile and auto-injected memories don't cover — typically PR history, past events, preferences, or explicit recall requests from the user ('remember when I mentioned…', 'what was my…'). Either `query` OR `categories` must be non-null to produce useful results; passing both narrows the result. `limit` defaults to 6 if null; hard cap 20.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query:      { type: ["string", "null"] },
      categories: {
        type:  ["array", "null"],
        items: { type: "string", enum: MEMORY_CATEGORY_ENUM },
      },
      limit:      { type: ["integer", "null"] },
    },
    required: ["query", "categories", "limit"],
    additionalProperties: false,
  },
};

// ── Exports ─────────────────────────────────────────────────────────────

// Main chat tools. update_user_profile is included — its schema lists every
// property in `required` with nullable union types so the model can pass
// `null` for fields it's not changing. The persistProfileUpdates path in
// stream.js drops null values before PATCHing Supabase.
//
// The chat pipeline (synthesize.js) uses buildToolDefinitions() below so
// flag-gated tools like remember_fact can be toggled at runtime.
export const TOOL_DEFINITIONS = [
  EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, EMIT_CALCULATOR_WIDGET,
  EMIT_NUTRITION_WIDGET, EMIT_TRAINING_WIDGET, EMIT_PROGRESS_WIDGET, EMIT_PHARMA_WIDGET, EMIT_EVIDENCE_WIDGET,
  LOG_FOOD, GET_USER_PROFILE, UPDATE_USER_PROFILE,
];

/**
 * Runtime tool-list used by the chat pipeline. Honors MEMORY_* kill switches.
 * Non-pipeline callers (tests, static analysis) may still import TOOL_DEFINITIONS.
 */
export function buildToolDefinitions() {
  const defs = [...TOOL_DEFINITIONS];
  const rememberEnabled = /^(true|1)$/i.test(String(process.env.MEMORY_REMEMBER_FACT_ENABLED || "").trim());
  const recallEnabled   = /^(true|1)$/i.test(String(process.env.MEMORY_RECALL_ENABLED        || "").trim());
  if (rememberEnabled) defs.push(REMEMBER_FACT);
  if (recallEnabled)   defs.push(RECALL_MEMORY);
  return defs;
}

/** Tools resolved server-side (profile lookup, etc.) — not forwarded to the client. */
export const SERVER_SIDE_TOOLS = new Set([
  "get_user_profile",
  "update_user_profile",
  "remember_fact",
  "recall_memory",
]);

export { UPDATE_USER_PROFILE };

// ── Validators ──────────────────────────────────────────────────────────

const VALID_MEAL_SLOTS = new Set(["breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening", "pre_workout", "post_workout", "supplements_am", "supplements_pm"]);
const VALID_FOOD_AMOUNT_UNITS = new Set(["g", "serving"]);
const VALID_WORKOUT_BLOCK_CATEGORIES = new Set(["resistance", "cardio", "swimming", "climbing", "bodyweight"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORKOUT_SESSION_ID_PATTERN = /^s_w\d+d[1-7]$/;

const WIDGET_FORBIDDEN_PATTERNS = [
  /<script\s+src\s*=/i,
  /<link\b/i,
  /@import\b/i,
  /\bfetch\s*\(/i,
  /\blocalStorage\b/i,
  /\b(?:min-height|height)\s*:\s*[^;{}]*(?:dvh|svh|lvh|vh)\b/i,
  /\b(?:html|body|:root)\s*\{[^}]*\b(?:min-height|height)\s*:\s*[^;{}]*100%\b/i,
  /\bposition\s*:\s*fixed\b[\s\S]{0,120}\binset\s*:\s*0\b/i,
];

function validateEmitWidget(args) {
  const errors = [];
  if (!args || typeof args !== "object") return { valid: false, errors: ["args must be an object"] };
  if (typeof args.title !== "string" || !args.title.trim()) errors.push("title is required");
  if (typeof args.html !== "string" || !args.html.trim()) errors.push("html is required");
  if (errors.length) return { valid: false, errors };

  for (const pattern of WIDGET_FORBIDDEN_PATTERNS) {
    if (pattern.test(args.html)) {
      errors.push(`html contains forbidden pattern: ${pattern}`);
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, data: args };
}

function validateLogFood(args) {
  const errors = [];
  if (!args || typeof args !== "object") return { valid: false, errors: ["args must be an object"] };
  if (!VALID_MEAL_SLOTS.has(args.meal_slot)) errors.push(`invalid meal_slot: ${args.meal_slot}`);
  if (!Array.isArray(args.foods) || args.foods.length === 0) {
    errors.push("foods array is required and must not be empty");
  }
  if (Array.isArray(args.foods)) {
    for (const [i, food] of args.foods.entries()) {
      if (typeof food.description !== "string" || !food.description) {
        errors.push(`foods[${i}].description required`);
      }
      if (typeof food.amount !== "number" || !Number.isFinite(food.amount)) {
        errors.push(`foods[${i}].amount must be a number`);
      }
      if (!VALID_FOOD_AMOUNT_UNITS.has(food.amount_unit)) {
        errors.push(`foods[${i}].amount_unit invalid: ${food.amount_unit}`);
      }
      for (const field of ["kcal", "protein_g", "carbs_g", "fat_g"]) {
        if (typeof food[field] !== "number") {
          errors.push(`foods[${i}].${field} must be a number`);
        }
      }
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, data: args };
}

function validateEmitMealPlan(args) {
  if (!args || typeof args !== "object") return { valid: false, errors: ["args must be an object"] };
  // Delegate to the existing shared validator
  const result = validateMealPlan(args);
  return result.valid
    ? { valid: true, data: args }
    : { valid: false, errors: result.errors };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeWorkoutToolArgs(args) {
  return {
    ...args,
    updates_plan_id: args.updates_plan_id ?? null,
    sessions: Array.isArray(args.sessions)
      ? args.sessions.map((session) => (
        session && typeof session === "object"
          ? { ...session, warmup_blocks: session.warmup_blocks ?? null }
          : session
      ))
      : args.sessions,
  };
}

function validateWorkoutBlock(block, label, errors) {
  if (!block || typeof block !== "object") {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!isNonEmptyString(block.name)) errors.push(`${label}.name is required`);
  if (!isPositiveInteger(block.sets)) errors.push(`${label}.sets must be a positive integer`);
  if (!isNonEmptyString(block.reps)) errors.push(`${label}.reps is required`);
  if (!isNonEmptyString(block.load)) errors.push(`${label}.load is required`);
  if (typeof block.rpe !== "number" || !Number.isFinite(block.rpe) || block.rpe < 0 || block.rpe > 10) {
    errors.push(`${label}.rpe must be a finite number between 0 and 10`);
  }
  if (!Number.isInteger(block.rest_seconds) || block.rest_seconds < 0) {
    errors.push(`${label}.rest_seconds must be a non-negative integer`);
  }
  if (!VALID_WORKOUT_BLOCK_CATEGORIES.has(block.category)) {
    errors.push(`${label}.category invalid: ${block.category}`);
  }
  if (block.notes != null && typeof block.notes !== "string") {
    errors.push(`${label}.notes must be a string or null`);
  }
}

function validateEmitWorkoutPlan(args) {
  const errors = [];
  if (!args || typeof args !== "object") return { valid: false, errors: ["args must be an object"] };

  const candidate = normalizeWorkoutToolArgs(args);

  if (candidate.schema_version !== WORKOUT_PLAN_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${WORKOUT_PLAN_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(candidate.title)) errors.push("title required");
  if (!GOALS.includes(candidate.goal)) errors.push(`goal invalid: ${candidate.goal}`);
  if (!EXPERIENCE_LEVELS.includes(candidate.experience_level)) {
    errors.push(`experience_level invalid: ${candidate.experience_level}`);
  }
  if (!isNonEmptyString(candidate.start_date) || !ISO_DATE_PATTERN.test(candidate.start_date)) {
    errors.push("start_date must be YYYY-MM-DD");
  }
  if (!isPositiveInteger(candidate.weeks)) errors.push("weeks must be a positive integer");
  if (!Number.isInteger(candidate.days_per_week) || candidate.days_per_week < 1 || candidate.days_per_week > 7) {
    errors.push("days_per_week must be an integer between 1 and 7");
  }
  if (candidate.updates_plan_id != null && !isNonEmptyString(candidate.updates_plan_id)) {
    errors.push("updates_plan_id must be a non-empty string or null");
  }
  if (!Array.isArray(candidate.sessions) || candidate.sessions.length === 0) {
    errors.push("sessions array required");
  }

  if (Array.isArray(candidate.sessions)) {
    const sessionIds = new Set();
    const sessionSlots = new Set();
    const sessionsPerWeek = new Map();

    candidate.sessions.forEach((session, index) => {
      const sessionLabel = `sessions[${index}]`;
      if (!session || typeof session !== "object") {
        errors.push(`${sessionLabel} must be an object`);
        return;
      }

      if (!isNonEmptyString(session.id)) {
        errors.push(`${sessionLabel}.id is required`);
      } else {
        if (!WORKOUT_SESSION_ID_PATTERN.test(session.id)) {
          errors.push(`${sessionLabel}.id must match s_w{week}d{day_of_week}`);
        }
        if (sessionIds.has(session.id)) {
          errors.push(`${sessionLabel}.id duplicated: ${session.id}`);
        } else {
          sessionIds.add(session.id);
        }
      }

      if (!isPositiveInteger(session.week)) {
        errors.push(`${sessionLabel}.week must be a positive integer`);
      } else {
        if (isPositiveInteger(candidate.weeks) && session.week > candidate.weeks) {
          errors.push(`${sessionLabel}.week exceeds weeks (${candidate.weeks})`);
        }
        sessionsPerWeek.set(session.week, (sessionsPerWeek.get(session.week) || 0) + 1);
      }

      if (!Number.isInteger(session.day_of_week) || session.day_of_week < 1 || session.day_of_week > 7) {
        errors.push(`${sessionLabel}.day_of_week must be an integer between 1 and 7`);
      }

      if (isPositiveInteger(session.week) && Number.isInteger(session.day_of_week) && session.day_of_week >= 1 && session.day_of_week <= 7) {
        const slotKey = `${session.week}:${session.day_of_week}`;
        if (sessionSlots.has(slotKey)) {
          errors.push(`${sessionLabel} duplicates week/day slot ${slotKey}`);
        } else {
          sessionSlots.add(slotKey);
        }
      }

      if (!isNonEmptyString(session.date) || !ISO_DATE_PATTERN.test(session.date)) {
        errors.push(`${sessionLabel}.date must be YYYY-MM-DD`);
      }
      if (!isNonEmptyString(session.title)) errors.push(`${sessionLabel}.title is required`);
      if (!Array.isArray(session.blocks) || session.blocks.length === 0) {
        errors.push(`${sessionLabel}.blocks must be a non-empty array`);
      } else {
        session.blocks.forEach((block, blockIndex) => {
          validateWorkoutBlock(block, `${sessionLabel}.blocks[${blockIndex}]`, errors);
        });
      }

      if (session.warmup_blocks != null && !Array.isArray(session.warmup_blocks)) {
        errors.push(`${sessionLabel}.warmup_blocks must be an array or null`);
      } else if (Array.isArray(session.warmup_blocks)) {
        session.warmup_blocks.forEach((block, blockIndex) => {
          validateWorkoutBlock(block, `${sessionLabel}.warmup_blocks[${blockIndex}]`, errors);
        });
      }
    });

    if (Number.isInteger(candidate.days_per_week) && candidate.days_per_week >= 1 && candidate.days_per_week <= 7) {
      for (const [week, count] of sessionsPerWeek.entries()) {
        if (count > candidate.days_per_week) {
          errors.push(`week ${week} has ${count} sessions, exceeds days_per_week ${candidate.days_per_week}`);
        }
      }
    }
  }

  if (errors.length) {
    return { valid: false, errors };
  }

  const normalizedPlan = normalizeWorkoutPlan({
    ...candidate,
    timezone: "UTC",
  });
  const sharedValidation = validateWorkoutPlan(normalizedPlan);

  return sharedValidation.ok
    ? { valid: true, data: candidate }
    : { valid: false, errors: sharedValidation.errors };
}

const VALIDATORS = {
  emit_meal_plan:    validateEmitMealPlan,
  emit_workout_plan: validateEmitWorkoutPlan,
  emit_widget:       validateEmitWidget,
  emit_calculator_widget: (args) => {
    const r = validateCalculatorWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  emit_nutrition_widget: (args) => {
    const r = validateNutritionWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  emit_training_widget: (args) => {
    const r = validateTrainingWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  emit_progress_widget: (args) => {
    const r = validateProgressWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  emit_pharma_widget: (args) => {
    const r = validatePharmaWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  emit_evidence_widget: (args) => {
    const r = validateEvidenceWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
  log_food:          validateLogFood,
};

/**
 * Validate a tool call result.
 * @param {string} name — tool name
 * @param {object} args — parsed arguments
 * @returns {{ valid: boolean, data?: object, errors?: string[] }}
 */
export function validateToolCall(name, args) {
  const validator = VALIDATORS[name];
  if (!validator) return { valid: false, errors: [`unknown tool: ${name}`] };
  return validator(args);
}
