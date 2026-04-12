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
  required: ["description", "grams"],
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    grams:       { type: "number" },
    fdc_id:      { type: "integer" },
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
  required: ["description", "amount", "unit"],
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    amount:      { type: "number" },
    unit:        { type: "string" },
    timing: {
      type: "string",
      enum: ["any", "morning", "with_meal", "pre_workout", "post_workout", "bedtime"],
    },
  },
};

// ── emit_meal_plan ──────────────────────────────────────────────────────

const EMIT_MEAL_PLAN = {
  type: "function",
  name: "emit_meal_plan",
  strict: true,
  description: [
    "Generate a structured meal plan. Call this tool when the user asks for a meal plan, diet plan, macro breakdown, eating plan, or cut/bulk/recomp plan.",
    "",
    "BEFORE calling: check the user_profile in the input. If ANY of these are null/missing, do NOT call this tool — instead ask the user for the missing values conversationally in one short message:",
    "  - body_weight_kg, height_cm, date_of_birth, biological_sex, activity_level",
    "",
    "Compute macro targets using Mifflin-St Jeor:",
    "  BMR = 10*weight_kg + 6.25*height_cm - 5*age + (5 if male, -161 if female)",
    "  TDEE = BMR * activity_multiplier (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9)",
    "  Adjust for goal: cut -500 kcal, maintain TDEE, bulk +250-400 kcal",
    "  Protein: 1.6-2.2 g/kg (2.0-2.2 for cut, 1.6-1.8 for bulk, 1.8 default)",
    "  Fat: 20-35% of kcal, minimum 0.6 g/kg",
    "  Carbs: remainder. Fiber: 14 g per 1000 kcal.",
    "",
    "Show the user the math briefly in your prose content BEFORE the tool call.",
    "",
    "Emit THREE day types: training_day, rest_day, refeed_day.",
    "  training_day: computed targets, carbs weighted higher",
    "  rest_day: carbs -60 g, fat +15 g, same protein",
    "  refeed_day: carbs at ~maintenance carb share, same protein",
    "",
    "Use USDA FDC generic foods only. 3 meals + 1 snack default. Respect dietary_preferences from profile.",
    "No restaurant chains. No brand names unless the user asked.",
    "",
    "SUPPLEMENTS (evidence-based only):",
    "  Creatine monohydrate 3-5 g/day, whey/casein/pea protein to hit target,",
    "  vitamin D3 1000-2000 IU/day, omega-3 EPA+DHA 1-2 g/day,",
    "  caffeine 3-6 mg/kg pre-workout, electrolytes in heat/low-sodium,",
    "  magnesium glycinate 200-400 mg for sleep/recovery.",
    "  Empty supplements array if user doesn't want them.",
    "  Do NOT recommend anything requiring prescription, megadoses, or weak-evidence supplements.",
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
  required: ["exercise", "sets", "reps", "load", "rpe", "rest_seconds", "category"],
  additionalProperties: false,
  properties: {
    exercise:     { type: "string" },
    sets:         { type: "integer" },
    reps:         { type: "string" },
    load:         { type: "string" },
    rpe:          { type: "number" },
    rest_seconds: { type: "integer" },
    category:     { type: "string", enum: ["resistance", "cardio", "swimming", "climbing", "bodyweight"] },
    notes:        { type: "string" },
  },
};

const SESSION_SCHEMA = {
  type: "object",
  required: ["id", "week", "day_of_week", "date", "title", "blocks"],
  additionalProperties: false,
  properties: {
    id:            { type: "string" },
    week:          { type: "integer" },
    day_of_week:   { type: "integer" },
    date:          { type: "string" },
    title:         { type: "string" },
    blocks:        { type: "array", items: BLOCK_SCHEMA },
    warmup_blocks: { type: "array", items: BLOCK_SCHEMA },
  },
};

const EMIT_WORKOUT_PLAN = {
  type: "function",
  name: "emit_workout_plan",
  strict: true,
  description: [
    "Generate a multi-week periodized training plan. Call this when the user asks for a workout plan, program, split, or training block.",
    "",
    "Write 2-4 sentences of prose rationale BEFORE calling this tool.",
    "",
    "Session id format: s_w{week}d{day_of_week} (day_of_week 1=Monday, 7=Sunday).",
    "Each block is one exercise: sets, reps (string like '8-10' or '5'), load (string like '75kg' or 'bodyweight'), RPE, rest_seconds, category.",
    "Include warmup_blocks for compound lifts >= 60% 1RM.",
    "",
    "If current_workout_plan is non-null, you are ADJUSTING the user's existing plan:",
    "  - Include updates_plan_id set to the current plan's id",
    "  - Preserve session ids where possible (so completed data isn't orphaned)",
    "  - Explain what changed in your prose",
  ].join("\n"),
  parameters: {
    type: "object",
    required: ["schema_version", "title", "goal", "experience_level", "start_date", "weeks", "days_per_week", "sessions"],
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
      updates_plan_id:  { type: "string" },
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
    "- Dark surface (#0c0e11), off-white text (#f9f9fd). Sandboxed iframe: allow-scripts allow-same-origin.",
    "- Chart.js 4.4.1 pre-loaded as global `Chart`. Use directly — do NOT add a <script src> for it.",
    "- CSS variables available: --color-background-primary, --color-background-secondary, --color-background-tertiary, --color-text-primary, --color-text-secondary, --color-text-tertiary, --color-border-tertiary, --color-border-secondary, --color-border-primary, --border-radius-md (12px), --border-radius-lg (18px), --accent-primary (#6d9fff), --accent-secondary (#9ffb00).",
    "- Evidence-strength tokens: --ev-strong-bg/text/dot, --ev-moderate-bg/text/dot, --ev-limited-bg/text/dot, --ev-insufficient-bg/text/dot.",
    "- Accent hex for chart data ONLY: #9ffb00 (positive), #6d9fff (neutral), #ffc466 (moderate), #ff8f9d (negative).",
    "- Chart axis labels: rgba(255,255,255,0.55). Chart gridlines: rgba(255,255,255,0.08).",
    "- No external scripts/links/imports. No hardcoded bg/text colors (use CSS vars). 1px min borders. Fluid width. Div grids over tables.",
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
    "Log food the user ate or drank. Call this when the user reports eating, drinking, or taking supplements.",
    "Parse the food description into structured items with macros. Use USDA FDC reference data for macro estimates.",
    "Infer meal_slot from the user's message or time of day if not stated.",
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
          required: ["description", "grams", "kcal", "protein_g", "carbs_g", "fat_g"],
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            grams:       { type: "number" },
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

// ── Exports ─────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, LOG_FOOD];

// ── Validators ──────────────────────────────────────────────────────────

const VALID_MEAL_SLOTS = new Set(["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"]);

const WIDGET_FORBIDDEN_PATTERNS = [
  /<script\s+src\s*=/i,
  /<link\b/i,
  /@import\b/i,
  /\bfetch\s*\(/i,
  /\blocalStorage\b/i,
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
      for (const field of ["grams", "kcal", "protein_g", "carbs_g", "fat_g"]) {
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

function validateEmitWorkoutPlan(args) {
  const errors = [];
  if (!args || typeof args !== "object") return { valid: false, errors: ["args must be an object"] };
  if (args.schema_version !== 1) errors.push("schema_version must be 1");
  if (typeof args.title !== "string" || !args.title) errors.push("title required");
  if (!Array.isArray(args.sessions) || args.sessions.length === 0) {
    errors.push("sessions array required");
  }
  return errors.length ? { valid: false, errors } : { valid: true, data: args };
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
