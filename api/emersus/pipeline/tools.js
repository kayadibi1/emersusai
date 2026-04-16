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
    "For supplements (creatine, vitamin D, omega-3, etc.), set amount to the dose number and amount_unit to the appropriate unit (g, mg, IU, mcg, capsule). Set macros to 0.",
    "For liquids (coffee, milk, shakes), use ml as amount_unit and set amount to the volume.",
    "For solid foods, use g as amount_unit.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["meal_slot", "foods"],
    additionalProperties: false,
    properties: {
      meal_slot: {
        type: "string",
        enum: ["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"],
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
            amount_unit: { type: "string", enum: ["g", "ml", "mg", "mcg", "IU", "capsule", "tablet", "scoop", "serving"] },
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
    "Save extracted profile fields from the onboarding conversation.",
    "Call this after each user response when you have new profile information to save.",
    "Only include fields you have confident, non-null values for.",
    "On the final exchange (after all info is gathered), include onboarding_completed: true.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: [],
    additionalProperties: false,
    properties: {
      goal: { type: "string", description: "Primary fitness/health goal" },
      experience_level: { type: "string", enum: ["beginner", "intermediate", "advanced"], description: "Training experience level" },
      injuries_limitations: { type: "string", description: "Any injuries or physical limitations" },
      equipment_access: { type: "string", description: "What equipment they have access to" },
      available_days_per_week: { type: "number", description: "Training days per week" },
      dietary_preferences: { type: "string", description: "Diet preferences or restrictions" },
      primary_use_case: { type: "string", description: "What they want to use Emersus for" },
      weight_unit: { type: "string", enum: ["kg", "lbs"], description: "Preferred weight unit" },
      distance_unit: { type: "string", enum: ["km", "mi"], description: "Preferred distance unit" },
      preferred_sports: {
        type: "array",
        items: { type: "string", enum: ["weights", "running", "cycling", "swimming", "climbing", "mixed"] },
        description: "Sports/activities they do",
      },
      default_pool_length_m: { type: "number", enum: [25, 50, 22.86, 30.48], description: "Pool length in meters" },
      default_grade_system: { type: "string", enum: ["V", "YDS", "Font", "French"], description: "Climbing grade system" },
      onboarding_completed: { type: "boolean", description: "Set true on the final exchange after all info is gathered" },
    },
  },
};

// ── Exports ─────────────────────────────────────────────────────────────

// Main chat tools. update_user_profile is intentionally EXCLUDED here —
// it's onboarding-only. The onboarding handler passes it explicitly via
// tools: [UPDATE_USER_PROFILE]. Exposing it in the main chat would let
// the model call it during regular turns, where ctx._profileUpdates is
// never persisted — silent save failure.
export const TOOL_DEFINITIONS = [EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, LOG_FOOD, GET_USER_PROFILE];

/** Tools resolved server-side (profile lookup, etc.) — not forwarded to the client. */
export const SERVER_SIDE_TOOLS = new Set(["get_user_profile", "update_user_profile"]);

export { UPDATE_USER_PROFILE };

// ── Validators ──────────────────────────────────────────────────────────

const VALID_MEAL_SLOTS = new Set(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]);
const VALID_FOOD_AMOUNT_UNITS = new Set(["g", "ml", "mg", "mcg", "IU", "capsule", "tablet", "scoop", "serving"]);
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
