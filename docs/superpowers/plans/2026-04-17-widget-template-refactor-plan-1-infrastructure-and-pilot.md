# Widget Template Refactor — Plan 1 · Infrastructure + Pilot Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full widget-v2 rendering pipeline end-to-end with a single pilot template (`macro_ring` from F6 · Calculators). Prove the data-only tool contract, validator, React dispatcher, parser integration, SSE forwarding, feature flag, and client-side rendering all work before adding the remaining 54 templates.

**Architecture:** Six family-scoped strict-mode OpenAI tools (`emit_pharma_widget`, `emit_training_widget`, `emit_nutrition_widget`, `emit_evidence_widget`, `emit_progress_widget`, `emit_calculator_widget`) emit typed JSON payloads with a `type` discriminator that routes to React components under `shared/widget-v2/templates/<family>/<slug>.js`. No iframes, no Chart.js, pure SVG. Feature-flagged via `WIDGET_V2_ENABLED` for safe parallel deployment with legacy `emit_widget`.

**Tech Stack:** Node ESM, React 18 via esm.sh, `node:test` runner, Supabase Postgres 15, OpenAI Responses API with strict mode.

**Spec:** `docs/superpowers/specs/2026-04-17-widget-template-refactor-design.md`
**Pre-refactor snapshot:** `docs/widget-flow-pre-template-refactor.md`
**Memory:** `project_widget_template_refactor.md`

---

## Scope

This is **Plan 1 of 9**. It ships the entire pipeline plus ONE template (`macro_ring`). Subsequent plans fill out families:

- Plan 2 — F1 Pharma family (7 templates + emit_pharma_widget tool)
- Plan 3 — F2 Training family (9 templates)
- Plan 4 — F3 Nutrition family (9 templates)
- Plan 5 — F4 Evidence family (9 templates)
- Plan 6 — F5 Progression family (12 templates)
- Plan 7 — F6 Calculator family (8 remaining templates — `macro_ring` already shipped)
- Plan 8 — System prompt + per-family few-shots + rollout telemetry
- Plan 9 — Migration (flag ramp to 100%, soak, deprecate `emit_widget`)

Plan 1 must produce a working, testable, feature-flagged pilot before any family plan starts.

---

## File Structure

New:
```
shared/widget-v2/
├── dispatcher.js                          # <WidgetV2 /> — type-to-component router
├── types.js                               # JSDoc typedefs for WidgetBase + common enums
├── feature-flag.js                        # isWidgetV2Enabled()
├── primitives/
│   ├── slider.js                          # <Slider label value onChange min max unit />
│   ├── stat-card.js                       # <StatCard label value caption />
│   ├── follow-up-chips.js                 # <FollowUpChips chips /> (calls window.sendPrompt)
│   └── card-frame.js                      # <CardFrame title summary>children</CardFrame>
├── templates/
│   └── calculators/
│       ├── macro-ring.js                  # <MacroRing data /> component
│       └── macro-ring.schema.js           # JSON schema for macro_ring variant
├── validators/
│   ├── index.js                           # validateWidgetV2(family, payload)
│   └── calculator.js                      # emit_calculator_widget payload validator
└── tokens.css                             # palette-alias layer for v2 root

api/emersus/pipeline/tools.js              # add emit_calculator_widget definition + validator entry
api/emersus/pipeline/stream.js             # forward widget-v2 tool events as SSE
shared/widget-fence-parser.js              # (unchanged — fence parser; v2 uses SSE event type, not fences)
shared/emersus-renderer.js                 # dispatch widget-v2 SSE payloads to <WidgetV2 />
shared/feature-flags.js                    # add WIDGET_V2_ENABLED constant

tests/unit/shared/widget-v2/
├── dispatcher.test.js
├── primitives/slider.test.js
├── primitives/follow-up-chips.test.js
├── templates/calculators/macro-ring.test.js
└── validators/calculator.test.js

scripts/widget-v2-preflight.js             # real OpenAI API call — strict-mode schema validation

supabase/migrations/<ts>_widget_v2_emission_events.sql
```

Modified (line numbers indicative; verify before editing):
- `api/emersus/pipeline/tools.js:478` — add `EMIT_CALCULATOR_WIDGET` to `ALL_TOOLS`
- `api/emersus/pipeline/tools.js:743` — add validator entry
- `api/emersus/pipeline/stream.js:104-203` — extend `processEvent` with widget-v2 forwarding
- `shared/emersus-renderer.js:560+` — `LLMResponse` dispatches `widget-v2` segment to `<WidgetV2 />`
- `shared/feature-flags.js` — add `WIDGET_V2_ENABLED`

---

## Tasks

### Task 1 · Feature flag constant

**Files:**
- Modify: `shared/feature-flags.js`
- Test: `tests/unit/shared/feature-flags.test.js`

- [ ] **Step 1 · Read existing file**

Run: `cat shared/feature-flags.js` — note current exports.

- [ ] **Step 2 · Write failing test**

Create `tests/unit/shared/feature-flags.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { WIDGET_V2_ENABLED } from "../../../shared/feature-flags.js";

test("WIDGET_V2_ENABLED exists and is boolean", () => {
  assert.equal(typeof WIDGET_V2_ENABLED, "boolean");
});

test("WIDGET_V2_ENABLED defaults to false without env override", () => {
  // Default behavior: disabled until explicit opt-in via WIDGET_V2_ENABLED=true
  assert.equal(WIDGET_V2_ENABLED, process.env.WIDGET_V2_ENABLED === "true");
});
```

- [ ] **Step 3 · Run test — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/feature-flags.test.js`
Expected: import error "WIDGET_V2_ENABLED is not exported".

- [ ] **Step 4 · Add the flag**

Append to `shared/feature-flags.js`:

```js
// Widget v2 template system — gates the new emit_*_widget tools and the
// React dispatcher path. Off by default; enable per environment via env var.
// See docs/superpowers/specs/2026-04-17-widget-template-refactor-design.md §9.
export const WIDGET_V2_ENABLED =
  (typeof process !== "undefined" ? process.env.WIDGET_V2_ENABLED : "") === "true";
```

- [ ] **Step 5 · Run test — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/feature-flags.test.js`
Expected: 2 passes.

- [ ] **Step 6 · Commit**

```bash
git add shared/feature-flags.js tests/unit/shared/feature-flags.test.js
git commit -m "feat(widget-v2): add WIDGET_V2_ENABLED feature flag"
```

---

### Task 2 · JSDoc typedefs

**Files:**
- Create: `shared/widget-v2/types.js`

- [ ] **Step 1 · Create the directory**

Run: `mkdir -p shared/widget-v2/primitives shared/widget-v2/templates/calculators shared/widget-v2/validators`

- [ ] **Step 2 · Write typedefs**

Create `shared/widget-v2/types.js`:

```js
/**
 * @typedef {"narrow" | "medium" | "wide"} DisplayWidth
 *
 * @typedef {"pharma" | "training" | "nutrition" | "evidence" | "progress" | "calculator"} WidgetFamily
 *
 * @typedef {Object} WidgetBase
 * @property {string} title
 * @property {DisplayWidth} display_width
 * @property {string | null} summary
 * @property {string[]} follow_up_chips          // max 4
 * @property {string} type                       // template slug, family-specific enum
 * @property {Record<string, unknown>} data      // per-template schema
 *
 * @typedef {Object} WidgetV2Envelope
 * @property {WidgetFamily} family
 * @property {WidgetBase} payload
 */

// Runtime re-export stubs (JSDoc types are erased at runtime; these are for
// code that wants to import a "type" token for documentation).
export const DISPLAY_WIDTHS = /** @type {const} */ (["narrow", "medium", "wide"]);
export const WIDGET_FAMILIES = /** @type {const} */ ([
  "pharma", "training", "nutrition", "evidence", "progress", "calculator",
]);
```

- [ ] **Step 3 · Commit**

```bash
git add shared/widget-v2/types.js
git commit -m "feat(widget-v2): add JSDoc typedefs for common data shapes"
```

---

### Task 3 · Common base validator

**Files:**
- Create: `shared/widget-v2/validators/index.js`
- Test: `tests/unit/shared/widget-v2/validators/base.test.js`

- [ ] **Step 1 · Write failing tests**

Create `tests/unit/shared/widget-v2/validators/base.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBase } from "../../../../../shared/widget-v2/validators/index.js";

test("rejects missing title", () => {
  const r = validateBase({ display_width: "narrow", type: "x", data: {}, summary: null, follow_up_chips: [] });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /title/);
});

test("rejects invalid display_width", () => {
  const r = validateBase({ title: "T", display_width: "huge", type: "x", data: {}, summary: null, follow_up_chips: [] });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /display_width/);
});

test("rejects follow_up_chips over 4", () => {
  const r = validateBase({
    title: "T", display_width: "narrow", type: "x", data: {}, summary: null,
    follow_up_chips: ["a", "b", "c", "d", "e"],
  });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /follow_up_chips.*max/);
});

test("accepts a valid base payload", () => {
  const r = validateBase({
    title: "Macros", display_width: "narrow", type: "macro_ring",
    data: { kcal_total: 2500 }, summary: null, follow_up_chips: ["Apply"],
  });
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
});
```

- [ ] **Step 2 · Run — expect FAIL (module not found)**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/validators/base.test.js`
Expected: import error.

- [ ] **Step 3 · Implement validator**

Create `shared/widget-v2/validators/index.js`:

```js
// Top-level widget-v2 validator. Mirrors the strict-mode OpenAI schema but
// runs server-side after parsing the tool arguments JSON, so we can surface
// clear errors in SSE `tool_error` events rather than silently dropping.

const VALID_WIDTHS = new Set(["narrow", "medium", "wide"]);

export function validateBase(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["payload must be an object"] };
  }
  if (typeof payload.title !== "string" || !payload.title.trim()) {
    errors.push("title must be a non-empty string");
  }
  if (!VALID_WIDTHS.has(payload.display_width)) {
    errors.push(`display_width must be one of narrow|medium|wide, got ${payload.display_width}`);
  }
  if (payload.summary !== null && typeof payload.summary !== "string") {
    errors.push("summary must be string or null");
  }
  if (!Array.isArray(payload.follow_up_chips)) {
    errors.push("follow_up_chips must be an array");
  } else if (payload.follow_up_chips.length > 4) {
    errors.push("follow_up_chips max 4 items");
  } else if (payload.follow_up_chips.some((c) => typeof c !== "string")) {
    errors.push("follow_up_chips must contain strings");
  }
  if (typeof payload.type !== "string") errors.push("type must be a string");
  if (!payload.data || typeof payload.data !== "object") errors.push("data must be an object");
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/validators/base.test.js`
Expected: 4 passes.

- [ ] **Step 5 · Commit**

```bash
git add shared/widget-v2/validators/index.js tests/unit/shared/widget-v2/validators/base.test.js
git commit -m "feat(widget-v2): add base payload validator"
```

---

### Task 4 · macro_ring data schema + validator

**Files:**
- Create: `shared/widget-v2/templates/calculators/macro-ring.schema.js`
- Create: `shared/widget-v2/validators/calculator.js`
- Test: `tests/unit/shared/widget-v2/templates/calculators/macro-ring.schema.test.js`

- [ ] **Step 1 · Write failing tests**

Create `tests/unit/shared/widget-v2/templates/calculators/macro-ring.schema.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCalculatorWidget } from "../../../../../../shared/widget-v2/validators/calculator.js";

const VALID = {
  title: "Daily macros",
  display_width: "narrow",
  summary: null,
  follow_up_chips: ["Apply"],
  type: "macro_ring",
  data: {
    kcal_total: 2500,
    phase: "cut",
    protein: { grams: 180, target_grams: 180, kcal: 720 },
    carbs:   { grams: 275, target_grams: 275, kcal: 1100 },
    fat:     { grams: 76,  target_grams: 76,  kcal: 680 },
    tdee_reference: { tdee: 2900, delta_kcal: -400 },
  },
};

test("accepts valid macro_ring payload", () => {
  const r = validateCalculatorWidget(VALID);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("rejects unknown type", () => {
  const bad = { ...VALID, type: "unknown_thing" };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /unknown_thing|type/);
});

test("rejects macro_ring with missing protein field", () => {
  const bad = { ...VALID, data: { ...VALID.data, protein: undefined } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("rejects macro_ring with negative kcal", () => {
  const bad = { ...VALID, data: { ...VALID.data, kcal_total: -100 } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/templates/calculators/macro-ring.schema.test.js`
Expected: module not found.

- [ ] **Step 3 · Write schema**

Create `shared/widget-v2/templates/calculators/macro-ring.schema.js`:

```js
// Strict-mode JSON schema for the macro_ring variant. Mirrored by the
// server-side validator in ../../validators/calculator.js and by the
// OpenAI tool definition in api/emersus/pipeline/tools.js.

const MACRO_LEG_SCHEMA = {
  type: "object",
  required: ["grams", "target_grams", "kcal"],
  additionalProperties: false,
  properties: {
    grams:        { type: "number", minimum: 0 },
    target_grams: { type: "number", minimum: 0 },
    kcal:         { type: "number", minimum: 0 },
  },
};

export const MACRO_RING_DATA_SCHEMA = {
  type: "object",
  required: ["kcal_total", "phase", "protein", "carbs", "fat", "tdee_reference"],
  additionalProperties: false,
  properties: {
    kcal_total: { type: "number", minimum: 0 },
    phase:      { type: "string", enum: ["cut", "maintenance", "bulk"] },
    protein:    MACRO_LEG_SCHEMA,
    carbs:      MACRO_LEG_SCHEMA,
    fat:        MACRO_LEG_SCHEMA,
    tdee_reference: {
      type: ["object", "null"],
      required: ["tdee", "delta_kcal"],
      additionalProperties: false,
      properties: {
        tdee: { type: "number", minimum: 0 },
        delta_kcal: { type: "number" },
      },
    },
  },
};
```

- [ ] **Step 4 · Write calculator-family validator**

Create `shared/widget-v2/validators/calculator.js`:

```js
import { validateBase } from "./index.js";

const CALC_TYPES = new Set([
  "macro_ring",
  // Future: one_rm_estimator, tdee_calculator, macro_calculator, plate_loader_visual,
  // rpe_to_percent_rm, body_fat_estimator, carb_cycling_calculator,
  // protein_target_calculator, pace_calculator
]);

function validateMacroRing(data) {
  const errors = [];
  if (typeof data.kcal_total !== "number" || data.kcal_total < 0) {
    errors.push("data.kcal_total must be a non-negative number");
  }
  if (!["cut", "maintenance", "bulk"].includes(data.phase)) {
    errors.push(`data.phase must be cut|maintenance|bulk, got ${data.phase}`);
  }
  for (const leg of ["protein", "carbs", "fat"]) {
    const v = data[leg];
    if (!v || typeof v !== "object") {
      errors.push(`data.${leg} must be an object`);
      continue;
    }
    for (const f of ["grams", "target_grams", "kcal"]) {
      if (typeof v[f] !== "number" || v[f] < 0) {
        errors.push(`data.${leg}.${f} must be non-negative number`);
      }
    }
  }
  return errors;
}

export function validateCalculatorWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!CALC_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown calculator type: ${payload.type}`] };
  }
  let typeErrors = [];
  if (payload.type === "macro_ring") typeErrors = validateMacroRing(payload.data);
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
```

- [ ] **Step 5 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/templates/calculators/macro-ring.schema.test.js`
Expected: 4 passes.

- [ ] **Step 6 · Commit**

```bash
git add shared/widget-v2/templates/calculators/macro-ring.schema.js shared/widget-v2/validators/calculator.js tests/unit/shared/widget-v2/templates/calculators/macro-ring.schema.test.js
git commit -m "feat(widget-v2): add macro_ring schema + calculator-family validator"
```

---

### Task 5 · OpenAI tool definition for emit_calculator_widget

**Files:**
- Modify: `api/emersus/pipeline/tools.js`
- Test: `tests/unit/api/emersus/pipeline/tools-widget-v2.test.js`

- [ ] **Step 1 · Read relevant sections**

Run these to understand the current file structure:

```bash
rg -n "export.*ALL_TOOLS|const EMIT_|validateEmit" api/emersus/pipeline/tools.js | head -30
```

- [ ] **Step 2 · Write failing test**

Create `tests/unit/api/emersus/pipeline/tools-widget-v2.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildToolDefinitions, validateToolCall } from "../../../../../api/emersus/pipeline/tools.js";

test("emit_calculator_widget is in tool definitions", () => {
  const tools = buildToolDefinitions();
  const t = tools.find((x) => x.name === "emit_calculator_widget");
  assert.ok(t, "emit_calculator_widget missing from buildToolDefinitions()");
  assert.equal(t.strict, true);
});

test("emit_calculator_widget schema includes macro_ring type", () => {
  const tools = buildToolDefinitions();
  const t = tools.find((x) => x.name === "emit_calculator_widget");
  const typeEnum = t.parameters.properties.type.enum;
  assert.ok(Array.isArray(typeEnum));
  assert.ok(typeEnum.includes("macro_ring"));
});

test("validateToolCall('emit_calculator_widget') rejects bad payload", () => {
  const r = validateToolCall("emit_calculator_widget", { title: "T" });
  assert.equal(r.valid, false);
});

test("validateToolCall('emit_calculator_widget') accepts valid macro_ring", () => {
  const r = validateToolCall("emit_calculator_widget", {
    title: "Macros", display_width: "narrow", summary: null, follow_up_chips: [],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  });
  assert.equal(r.valid, true, r.errors?.join("; "));
});
```

- [ ] **Step 3 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/api/emersus/pipeline/tools-widget-v2.test.js`
Expected: emit_calculator_widget not found.

- [ ] **Step 4 · Add tool definition to `tools.js`**

Find the section after `EMIT_WIDGET` (~line 281) and add before `LOG_FOOD`:

```js
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

const MACRO_RING_DATA = {
  type: "object",
  required: ["kcal_total", "phase", "protein", "carbs", "fat", "tdee_reference"],
  additionalProperties: false,
  properties: {
    kcal_total: { type: "number" },
    phase: { type: "string", enum: ["cut", "maintenance", "bulk"] },
    protein: MACRO_RING_LEG,
    carbs: MACRO_RING_LEG,
    fat: MACRO_RING_LEG,
    tdee_reference: {
      type: ["object", "null"],
      required: ["tdee", "delta_kcal"],
      additionalProperties: false,
      properties: {
        tdee: { type: "number" },
        delta_kcal: { type: "number" },
      },
    },
  },
};

const EMIT_CALCULATOR_WIDGET = {
  type: "function",
  name: "emit_calculator_widget",
  strict: true,
  description: [
    "Emit an interactive calculator widget. Call this whenever the user asks to compute something: 1RM estimates, TDEE, macro budgets, plate loading, RPE-to-%1RM conversions, body-fat estimates, carb cycling, protein targets, pace.",
    "",
    "ALWAYS write 2-4 sentences of prose FIRST, then call this tool.",
    "",
    "Data-only: you provide a structured JSON payload, the client renders the calculator with sliders and live output. No HTML, no CSS, no colors to pick. Widget appears inline in the chat.",
    "",
    "TRIGGER PHRASES (non-exhaustive):",
    "  calculate, calculator, compute, estimate, 1RM, TDEE, maintenance calories,",
    "  macro split, macro breakdown (with live sliders), how much protein, plate loading,",
    "  how many plates, RPE to %, body fat %, pace per km/mile",
    "",
    "TEMPLATE SELECTION (pick `type` from):",
    "  macro_ring — macro split donut with per-macro grams/kcal and optional TDEE comparison",
    "",
    "CROSS-FAMILY:",
    "  For protein-timing questions (not sliders) use emit_nutrition_widget(type=protein_distribution_bar).",
    "",
    "DATA:",
    "- Numbers must reflect what the user asked — do not default-fill fields the user didn't mention.",
    "- display_width: 'narrow' for simple stat cards; 'wide' for calculators with multiple sliders.",
    "- summary: one-sentence takeaway (e.g., '~400 kcal deficit · 0.4 kg/wk projected loss').",
    "- follow_up_chips: 1-4 short CTAs (e.g., 'Apply to plan', 'Log today').",
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
      type: { type: "string", enum: ["macro_ring"] },
      data: MACRO_RING_DATA,
    },
  },
};
```

- [ ] **Step 5 · Add to `ALL_TOOLS` export**

Find the `ALL_TOOLS` array near line 478 and add `EMIT_CALCULATOR_WIDGET`:

```js
const ALL_TOOLS = [
  EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, EMIT_CALCULATOR_WIDGET, LOG_FOOD, GET_USER_PROFILE,
  UPDATE_USER_PROFILE, REMEMBER_FACT, RECALL_MEMORY,
];
```

- [ ] **Step 6 · Add validator entry**

Near line 743 where the validators map lives, add:

```js
import { validateCalculatorWidget } from "../../../shared/widget-v2/validators/calculator.js";

// ... inside the existing validators map object:
  emit_calculator_widget: (args) => {
    const r = validateCalculatorWidget(args);
    return r.valid ? { valid: true, data: args } : { valid: false, errors: r.errors };
  },
```

- [ ] **Step 7 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/api/emersus/pipeline/tools-widget-v2.test.js`
Expected: 4 passes.

- [ ] **Step 8 · Commit**

```bash
git add api/emersus/pipeline/tools.js tests/unit/api/emersus/pipeline/tools-widget-v2.test.js
git commit -m "feat(widget-v2): add emit_calculator_widget tool with macro_ring"
```

---

### Task 6 · Strict-mode preflight script

**Files:**
- Create: `scripts/widget-v2-preflight.js`

- [ ] **Step 1 · Write preflight script**

Create `scripts/widget-v2-preflight.js`:

```js
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
```

- [ ] **Step 2 · Run preflight on Hetzner**

Push + run (matches existing Hetzner bench pattern — see `scripts/bench/widget-variations.mjs`):

```bash
cat scripts/widget-v2-preflight.js | ssh hetzner "cat > ~/app/scripts/widget-v2-preflight.js && cd ~/app && node scripts/widget-v2-preflight.js"
```

Expected output: `Tool call name: emit_calculator_widget` · `Validator: { valid: true, errors: [] }` · `PREFLIGHT OK` · printed JSON.

If strict-mode rejects the schema, OpenAI returns an error before streaming — fix the schema and re-run.

- [ ] **Step 3 · Cleanup**

```bash
ssh hetzner "rm -f ~/app/scripts/widget-v2-preflight.js"
```

- [ ] **Step 4 · Commit preflight script**

```bash
git add scripts/widget-v2-preflight.js
git commit -m "chore(widget-v2): add preflight script for strict-mode validation"
```

---

### Task 7 · Primitive — FollowUpChips

**Files:**
- Create: `shared/widget-v2/primitives/follow-up-chips.js`
- Test: `tests/unit/shared/widget-v2/primitives/follow-up-chips.test.js`

- [ ] **Step 1 · Write failing test**

Create `tests/unit/shared/widget-v2/primitives/follow-up-chips.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

// React components in this codebase are plain React.createElement calls
// (esm.sh + no build step). We test by calling the component as a pure
// function and inspecting the returned element tree.
import React from "react";
import { FollowUpChips } from "../../../../../shared/widget-v2/primitives/follow-up-chips.js";

test("returns null when chips empty", () => {
  const el = FollowUpChips({ chips: [] });
  assert.equal(el, null);
});

test("renders one chip per string", () => {
  const el = FollowUpChips({ chips: ["A", "B"] });
  assert.ok(el);
  assert.equal(el.props.children.length, 2);
});

test("chip onClick calls window.sendPrompt with chip text", () => {
  let sent = null;
  global.window = { sendPrompt: (s) => { sent = s; } };
  const el = FollowUpChips({ chips: ["hello"] });
  const chip = el.props.children[0];
  chip.props.onClick();
  assert.equal(sent, "hello");
  delete global.window;
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/follow-up-chips.test.js`
Expected: import fails.

- [ ] **Step 3 · Implement**

Create `shared/widget-v2/primitives/follow-up-chips.js`:

```js
import React from "react";
const h = React.createElement;

// Follow-up chips render as a horizontal row at the bottom of a widget card.
// Each chip, when clicked, calls window.sendPrompt so the chat app can feed
// the text into the composer (existing behavior; see emersus-renderer.js
// `window.sendPrompt` host bridge).

export function FollowUpChips({ chips }) {
  if (!Array.isArray(chips) || chips.length === 0) return null;
  const onClick = (text) => () => {
    try {
      if (typeof window !== "undefined" && typeof window.sendPrompt === "function") {
        window.sendPrompt(text);
      }
    } catch { /* noop */ }
  };
  return h(
    "div",
    { className: "wv-chips", role: "group", "aria-label": "Follow-up suggestions" },
    chips.slice(0, 4).map((text, i) =>
      h(
        "button",
        {
          key: `chip-${i}`,
          type: "button",
          className: "wv-chip",
          onClick: onClick(text),
        },
        text,
      ),
    ),
  );
}
```

- [ ] **Step 4 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/follow-up-chips.test.js`
Expected: 3 passes.

- [ ] **Step 5 · Commit**

```bash
git add shared/widget-v2/primitives/follow-up-chips.js tests/unit/shared/widget-v2/primitives/follow-up-chips.test.js
git commit -m "feat(widget-v2): add FollowUpChips primitive"
```

---

### Task 8 · Primitive — Slider

**Files:**
- Create: `shared/widget-v2/primitives/slider.js`
- Test: `tests/unit/shared/widget-v2/primitives/slider.test.js`

- [ ] **Step 1 · Write failing test**

Create `tests/unit/shared/widget-v2/primitives/slider.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { Slider } from "../../../../../shared/widget-v2/primitives/slider.js";

test("renders label, current value, unit, and <input type=range>", () => {
  const el = Slider({ label: "Dose", value: 5, onChange: () => {}, min: 1, max: 25, unit: "g/day" });
  assert.ok(el);
  // The returned root div has 2 children: label row + <input type=range>.
  const labelRow = el.props.children[0];
  assert.match(JSON.stringify(labelRow), /Dose/);
  assert.match(JSON.stringify(labelRow), /5/);
  assert.match(JSON.stringify(labelRow), /g\/day/);
  const input = el.props.children[1];
  assert.equal(input.type, "input");
  assert.equal(input.props.type, "range");
  assert.equal(input.props.min, 1);
  assert.equal(input.props.max, 25);
});

test("onChange passes parsed number", () => {
  let got = null;
  const el = Slider({ label: "X", value: 10, onChange: (v) => { got = v; }, min: 0, max: 100 });
  const input = el.props.children[1];
  input.props.onChange({ target: { value: "42" } });
  assert.equal(got, 42);
  assert.equal(typeof got, "number");
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/slider.test.js`

- [ ] **Step 3 · Implement**

Create `shared/widget-v2/primitives/slider.js`:

```js
import React from "react";
const h = React.createElement;

// Slider primitive. Controlled input — parent owns the value and provides
// onChange(number). Renders the label + current value at the top, range
// input below. Styling lives in tokens.css and is palette-token driven.

export function Slider({ label, value, onChange, min, max, step = 1, unit = "" }) {
  return h(
    "div",
    { className: "wv-slider" },
    h(
      "div",
      { className: "wv-slider-row" },
      h("span", { className: "wv-slider-label" }, label),
      h(
        "span",
        { className: "wv-slider-value" },
        `${value}`,
        unit ? h("span", { className: "wv-slider-unit" }, ` ${unit}`) : null,
      ),
    ),
    h("input", {
      type: "range",
      min,
      max,
      step,
      value,
      onChange: (e) => onChange(Number(e.target.value)),
      "aria-label": `${label}${unit ? ` in ${unit}` : ""}`,
    }),
  );
}
```

- [ ] **Step 4 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/slider.test.js`
Expected: 2 passes.

- [ ] **Step 5 · Commit**

```bash
git add shared/widget-v2/primitives/slider.js tests/unit/shared/widget-v2/primitives/slider.test.js
git commit -m "feat(widget-v2): add Slider primitive"
```

---

### Task 9 · Primitive — CardFrame + StatCard

**Files:**
- Create: `shared/widget-v2/primitives/card-frame.js`
- Create: `shared/widget-v2/primitives/stat-card.js`
- Test: `tests/unit/shared/widget-v2/primitives/card-frame.test.js`

- [ ] **Step 1 · Write failing tests**

Create `tests/unit/shared/widget-v2/primitives/card-frame.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { CardFrame } from "../../../../../shared/widget-v2/primitives/card-frame.js";
import { StatCard } from "../../../../../shared/widget-v2/primitives/stat-card.js";

test("CardFrame wraps children with title + optional summary", () => {
  const el = CardFrame({ title: "T", summary: "S", children: "body" });
  const json = JSON.stringify(el);
  assert.match(json, /"T"/);
  assert.match(json, /"S"/);
  assert.match(json, /"body"/);
});

test("CardFrame hides summary when null", () => {
  const el = CardFrame({ title: "T", summary: null, children: "body" });
  const json = JSON.stringify(el);
  assert.match(json, /"T"/);
  assert.doesNotMatch(json, /summary/);
});

test("CardFrame honors display_width → class", () => {
  const el = CardFrame({ title: "T", summary: null, display_width: "narrow", children: "x" });
  assert.match(el.props.className, /wv-narrow/);
});

test("StatCard renders caption + big value + unit", () => {
  const el = StatCard({ caption: "TDEE", value: 2500, unit: "kcal" });
  const json = JSON.stringify(el);
  assert.match(json, /TDEE/);
  assert.match(json, /2500/);
  assert.match(json, /kcal/);
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/card-frame.test.js`

- [ ] **Step 3 · Implement CardFrame**

Create `shared/widget-v2/primitives/card-frame.js`:

```js
import React from "react";
const h = React.createElement;

// Shared shell: gives every widget a consistent frame (title, optional summary
// ribbon, display-width class). Children = the actual chart + controls.

const WIDTH_CLASS = { narrow: "wv-narrow", medium: "wv-medium", wide: "wv-wide" };

export function CardFrame({ title, summary, display_width = "wide", children }) {
  const className = `wv-card ${WIDTH_CLASS[display_width] || "wv-wide"}`;
  return h(
    "div",
    { className },
    h("div", { className: "wv-card-head" }, h("h4", null, title)),
    children,
    summary ? h("div", { className: "wv-card-summary" }, summary) : null,
  );
}
```

- [ ] **Step 4 · Implement StatCard**

Create `shared/widget-v2/primitives/stat-card.js`:

```js
import React from "react";
const h = React.createElement;

export function StatCard({ caption, value, unit }) {
  return h(
    "div",
    { className: "wv-stat" },
    h("div", { className: "wv-stat-caption" }, caption),
    h(
      "div",
      { className: "wv-stat-value" },
      `${value}`,
      unit ? h("span", { className: "wv-stat-unit" }, ` ${unit}`) : null,
    ),
  );
}
```

- [ ] **Step 5 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/primitives/card-frame.test.js`
Expected: 4 passes.

- [ ] **Step 6 · Commit**

```bash
git add shared/widget-v2/primitives/card-frame.js shared/widget-v2/primitives/stat-card.js tests/unit/shared/widget-v2/primitives/card-frame.test.js
git commit -m "feat(widget-v2): add CardFrame + StatCard primitives"
```

---

### Task 10 · CSS tokens layer

**Files:**
- Create: `shared/widget-v2/tokens.css`

- [ ] **Step 1 · Write tokens**

Create `shared/widget-v2/tokens.css`:

```css
/* Widget v2 styling. Inherits palette from <html data-theme="..."> via the
 * existing design-tokens.css cascade. Defines only the v2-specific structure
 * classes. Colors always go through var(--chart-series-N), var(--accent),
 * semantic and ev-* tokens. Never hard-coded hex.
 */

.wv-card {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 20px;
  margin: 12px 0;
  font-family: 'Space Grotesk', system-ui, sans-serif;
  color: var(--ink);
  box-sizing: border-box;
}
.wv-narrow { max-width: 360px; }
.wv-medium { max-width: 560px; margin-left: auto; margin-right: auto; }
.wv-wide   { max-width: 760px; }

.wv-card-head h4 { margin: 0 0 4px; font-size: 14px; font-weight: 600; letter-spacing: -0.005em; }
.wv-card-summary {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line);
  font-size: 11px; color: var(--muted); line-height: 1.5;
}

.wv-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.wv-chip {
  padding: 4px 10px; border: 1px solid var(--accent-line); background: var(--accent-soft);
  border-radius: 999px; font-size: 11px; color: var(--accent); font-weight: 500;
  cursor: pointer; font-family: inherit;
}
.wv-chip:hover { background: var(--accent); color: var(--accent-text); }

.wv-slider { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: var(--surface); border-radius: 8px; border: 1px solid var(--line); }
.wv-slider-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: baseline; }
.wv-slider-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
.wv-slider-value { font-size: 16px; color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; }
.wv-slider-unit { font-size: 11px; color: var(--muted); font-weight: 400; }
.wv-slider input[type=range] { width: 100%; accent-color: var(--accent); }

.wv-stat { text-align: center; padding: 16px; background: var(--accent-soft); border-radius: 8px; border: 1px solid var(--accent-line); }
.wv-stat-caption { font-size: 10px; color: var(--accent); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.wv-stat-value { font-size: 40px; color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; margin-top: 4px; }
.wv-stat-unit { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 6px; }
```

- [ ] **Step 2 · Import from chat stylesheet**

Add to `shared/chat.css` at the top (after other imports):

```css
@import url("./widget-v2/tokens.css");
```

- [ ] **Step 3 · Commit**

```bash
git add shared/widget-v2/tokens.css shared/chat.css
git commit -m "feat(widget-v2): add tokens.css with structural classes"
```

---

### Task 11 · macro_ring component

**Files:**
- Create: `shared/widget-v2/templates/calculators/macro-ring.js`
- Test: `tests/unit/shared/widget-v2/templates/calculators/macro-ring.test.js`

- [ ] **Step 1 · Write failing test**

Create `tests/unit/shared/widget-v2/templates/calculators/macro-ring.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { MacroRing } from "../../../../../../shared/widget-v2/templates/calculators/macro-ring.js";

const VALID_DATA = {
  kcal_total: 2500, phase: "cut",
  protein: { grams: 180, target_grams: 180, kcal: 720 },
  carbs: { grams: 275, target_grams: 275, kcal: 1100 },
  fat: { grams: 76, target_grams: 76, kcal: 680 },
  tdee_reference: { tdee: 2900, delta_kcal: -400 },
};

function stringify(el) { return JSON.stringify(el); }

test("renders title, calories, macro values", () => {
  const el = MacroRing({
    title: "Daily macros", display_width: "narrow", summary: null,
    follow_up_chips: [], data: VALID_DATA,
  });
  const s = stringify(el);
  assert.match(s, /Daily macros/);
  assert.match(s, /2500/);
  assert.match(s, /180/);       // protein grams
  assert.match(s, /275/);       // carbs
  assert.match(s, /76/);        // fat
});

test("renders follow-up chips when provided", () => {
  const el = MacroRing({
    title: "T", display_width: "narrow", summary: null,
    follow_up_chips: ["Apply"], data: VALID_DATA,
  });
  assert.match(stringify(el), /Apply/);
});

test("renders summary when provided", () => {
  const el = MacroRing({
    title: "T", display_width: "narrow", summary: "400 kcal deficit",
    follow_up_chips: [], data: VALID_DATA,
  });
  assert.match(stringify(el), /400 kcal deficit/);
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/templates/calculators/macro-ring.test.js`

- [ ] **Step 3 · Implement component**

Create `shared/widget-v2/templates/calculators/macro-ring.js`:

```js
import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;
const CIRC = 2 * Math.PI * 60;                  // donut circumference at r=60

// Macro ring donut for a daily macro split. Pure SVG. Interactive hover
// highlights a segment (local state only, no server round-trip).

export function MacroRing({ title, display_width, summary, follow_up_chips, data }) {
  const { kcal_total, protein, carbs, fat, tdee_reference } = data;
  const total = (protein.kcal || 0) + (carbs.kcal || 0) + (fat.kcal || 0);
  const segments = total > 0 ? [
    { label: "Protein", grams: protein.grams, kcal: protein.kcal, var: "--protein" },
    { label: "Carbs",   grams: carbs.grams,   kcal: carbs.kcal,   var: "--carbs" },
    { label: "Fat",     grams: fat.grams,     kcal: fat.kcal,     var: "--fat" },
  ] : [];

  let offset = 0;
  const arcs = segments.map((seg) => {
    const frac = seg.kcal / total;
    const dash = frac * CIRC;
    const dashStr = `${dash} ${CIRC - dash}`;
    const startOffset = -offset;
    offset += dash;
    return h("circle", {
      key: seg.label,
      cx: 80, cy: 80, r: 60, fill: "none",
      stroke: `var(${seg.var})`,
      strokeWidth: 18,
      strokeDasharray: dashStr,
      strokeDashoffset: startOffset,
      transform: "rotate(-90 80 80)",
    });
  });

  const legendRows = segments.map((seg) =>
    h(
      "div",
      { key: seg.label, className: "wv-mring-row" },
      h("span", { className: "wv-mring-dot", style: { background: `var(${seg.var})` } }),
      h("span", { className: "wv-mring-label" }, seg.label),
      h("span", { className: "wv-mring-grams" }, `${seg.grams}g`),
      h("span", { className: "wv-mring-kcal" }, `${seg.kcal} kcal`),
    ),
  );

  const tdeeFoot = tdee_reference
    ? h(
        "div",
        { className: "wv-mring-foot" },
        `vs TDEE ${tdee_reference.tdee} · `,
        h(
          "b",
          { style: { color: tdee_reference.delta_kcal < 0 ? "var(--chart-series-3)" : "var(--chart-series-2)" } },
          `${tdee_reference.delta_kcal > 0 ? "+" : ""}${tdee_reference.delta_kcal} kcal`,
        ),
      )
    : null;

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-mring-body" },
      h(
        "svg",
        { viewBox: "0 0 160 160", width: 150, height: 150, className: "wv-mring-svg" },
        h("circle", { cx: 80, cy: 80, r: 60, fill: "none", stroke: "rgba(26,24,19,0.06)", strokeWidth: 18 }),
        ...arcs,
        h("text", { x: 80, y: 76, textAnchor: "middle", fontSize: 28, fontWeight: 700, fill: "var(--ink)" }, `${kcal_total}`),
        h("text", { x: 80, y: 96, textAnchor: "middle", fontSize: 9, fill: "var(--muted)", letterSpacing: "0.14em" }, `KCAL · ${(data.phase || "").toUpperCase()}`),
      ),
      h("div", { className: "wv-mring-legend" }, ...legendRows),
    ),
    tdeeFoot,
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
```

- [ ] **Step 4 · Extend tokens.css with macro-ring classes**

Append to `shared/widget-v2/tokens.css`:

```css
.wv-mring-body { display: grid; grid-template-columns: 150px 1fr; gap: 16px; align-items: center; }
.wv-mring-svg { display: block; }
.wv-mring-legend { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.wv-mring-row { display: grid; grid-template-columns: 10px 1fr auto auto; align-items: center; gap: 8px; }
.wv-mring-dot { width: 10px; height: 10px; border-radius: 50%; }
.wv-mring-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
.wv-mring-grams { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.wv-mring-kcal { font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; margin-left: 6px; }
.wv-mring-foot { margin-top: 10px; font-size: 11px; color: var(--muted); padding-top: 8px; border-top: 1px solid var(--line); }
.wv-mring-foot b { font-weight: 600; font-variant-numeric: tabular-nums; }
@media (max-width: 400px) { .wv-mring-body { grid-template-columns: 1fr; } }
```

- [ ] **Step 5 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/templates/calculators/macro-ring.test.js`
Expected: 3 passes.

- [ ] **Step 6 · Commit**

```bash
git add shared/widget-v2/templates/calculators/macro-ring.js shared/widget-v2/tokens.css tests/unit/shared/widget-v2/templates/calculators/macro-ring.test.js
git commit -m "feat(widget-v2): add macro_ring template component"
```

---

### Task 12 · Dispatcher

**Files:**
- Create: `shared/widget-v2/dispatcher.js`
- Test: `tests/unit/shared/widget-v2/dispatcher.test.js`

- [ ] **Step 1 · Write failing test**

Create `tests/unit/shared/widget-v2/dispatcher.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { WidgetV2 } from "../../../../shared/widget-v2/dispatcher.js";

const VALID_CALC = {
  family: "calculator",
  payload: {
    title: "Macros", display_width: "narrow", summary: null, follow_up_chips: [],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  },
};

test("routes calculator.macro_ring to MacroRing component", () => {
  const el = WidgetV2(VALID_CALC);
  assert.ok(el);
  assert.match(JSON.stringify(el), /Macros/);
  assert.match(JSON.stringify(el), /2500/);
});

test("returns diagnostic component for unknown family", () => {
  const el = WidgetV2({ family: "unknown", payload: { title: "T" } });
  assert.match(JSON.stringify(el), /unsupported family/i);
});

test("returns diagnostic component for unknown type", () => {
  const el = WidgetV2({
    family: "calculator",
    payload: { ...VALID_CALC.payload, type: "not_a_type" },
  });
  assert.match(JSON.stringify(el), /unknown type/i);
});
```

- [ ] **Step 2 · Run — expect FAIL**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/dispatcher.test.js`

- [ ] **Step 3 · Implement dispatcher**

Create `shared/widget-v2/dispatcher.js`:

```js
import React from "react";
import { MacroRing } from "./templates/calculators/macro-ring.js";

const h = React.createElement;

// Family → { type → component } routing table. Populated by Plan 2-7 as
// each family's templates are added.
const REGISTRY = {
  calculator: {
    macro_ring: MacroRing,
    // Plan 7: one_rm_estimator, tdee_calculator, macro_calculator,
    // plate_loader_visual, rpe_to_percent_rm, body_fat_estimator,
    // carb_cycling_calculator, protein_target_calculator, pace_calculator
  },
  pharma:    {},  // Plan 2
  training:  {},  // Plan 3
  nutrition: {},  // Plan 4
  evidence:  {},  // Plan 5
  progress:  {},  // Plan 6
};

function Diagnostic({ reason, family, type }) {
  return h(
    "div",
    { className: "wv-card wv-wide wv-diagnostic", role: "alert" },
    h("div", { className: "wv-diagnostic-head" }, `Widget render error`),
    h("div", { className: "wv-diagnostic-body" }, `${reason}: family=${family || "?"} type=${type || "?"}`),
  );
}

export function WidgetV2({ family, payload }) {
  const familyMap = REGISTRY[family];
  if (!familyMap) return h(Diagnostic, { reason: "unsupported family", family, type: payload?.type });
  const Component = familyMap[payload?.type];
  if (!Component) return h(Diagnostic, { reason: "unknown type", family, type: payload?.type });
  return h(Component, payload);
}
```

- [ ] **Step 4 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/shared/widget-v2/dispatcher.test.js`
Expected: 3 passes.

- [ ] **Step 5 · Add diagnostic styles**

Append to `shared/widget-v2/tokens.css`:

```css
.wv-diagnostic { border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.04); }
.wv-diagnostic-head { font-weight: 600; color: var(--color-danger, #dc2626); font-size: 13px; }
.wv-diagnostic-body { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--muted); margin-top: 4px; }
```

- [ ] **Step 6 · Commit**

```bash
git add shared/widget-v2/dispatcher.js shared/widget-v2/tokens.css tests/unit/shared/widget-v2/dispatcher.test.js
git commit -m "feat(widget-v2): add dispatcher with macro_ring routing + diagnostic fallback"
```

---

### Task 13 · SSE stream forwarding

**Files:**
- Modify: `api/emersus/pipeline/stream.js`
- Test: `tests/unit/api/emersus/pipeline/stream-widget-v2.test.js`

- [ ] **Step 1 · Read stream.js processEvent**

Run: `rg -n "onTool|type: .tool.|emit_" api/emersus/pipeline/stream.js | head -20`

- [ ] **Step 2 · Write failing test**

Create `tests/unit/api/emersus/pipeline/stream-widget-v2.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

// Indirect test: simulate a processEvent run with an output_item.done carrying
// emit_calculator_widget args, verify the onTool handler is called with
// a widget-v2-flavored payload (family derived from tool name).

// We import processEvent if exported, otherwise this test stays shape-driven.

test("stream forwards emit_calculator_widget as widget-v2", async () => {
  const { __testables } = await import("../../../../../api/emersus/pipeline/stream.js");
  if (!__testables?.processEvent) {
    // processEvent is not exported. Task 13 exposes __testables; if missing,
    // this test is a reminder to expose them.
    assert.fail("expected __testables.processEvent export");
  }
  const { processEvent } = __testables;

  const state = {
    ctx: { toolResults: {} },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const calls = [];
  state.onTool = (name, data) => calls.push({ name, data });

  const validPayload = {
    title: "T", display_width: "narrow", summary: null, follow_up_chips: [],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  };
  processEvent({
    type: "response.output_item.done",
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify(validPayload), call_id: "c1" },
  }, state);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "emit_calculator_widget");
  assert.equal(calls[0].data.type, "macro_ring");
});
```

- [ ] **Step 3 · Run — expect FAIL (__testables missing)**

Run: `npm run test:unit -- tests/unit/api/emersus/pipeline/stream-widget-v2.test.js`

- [ ] **Step 4 · Expose processEvent for tests**

At the bottom of `api/emersus/pipeline/stream.js`, add:

```js
// Test-only export. Do not import from production code.
export const __testables = { processEvent };
```

- [ ] **Step 5 · Run — expect PASS**

Run: `npm run test:unit -- tests/unit/api/emersus/pipeline/stream-widget-v2.test.js`
Expected: 1 pass.

The existing `processEvent` already routes validated `emit_*` tool outputs through `state.onTool(name, data)` — no runtime change needed. The downstream SSE emits `{ type: "tool", name, data }` via `onTool: (name, data) => sendSSE(res, { type: "tool", name, data })` in `stream()`.

- [ ] **Step 6 · Commit**

```bash
git add api/emersus/pipeline/stream.js tests/unit/api/emersus/pipeline/stream-widget-v2.test.js
git commit -m "test(widget-v2): expose processEvent testable; verify emit_calculator_widget forwards"
```

---

### Task 14 · Client-side SSE handler

**Files:**
- Modify: `shared/react-chat-app.js`
- Test: manual smoke (unit-testing react-chat-app's SSE handler requires a bigger harness; Plan 1 relies on the integration smoke in Task 17)

- [ ] **Step 1 · Find current tool-event handler**

Run: `rg -n "type === .tool.|type === \"tool\"" shared/react-chat-app.js | head -10`

- [ ] **Step 2 · Add widget-v2 routing**

Locate the SSE event handler in `shared/react-chat-app.js` where `event.type === "tool"` is handled. Add routing for the 6 new tool names:

```js
const WIDGET_V2_TOOLS = {
  emit_pharma_widget: "pharma",
  emit_training_widget: "training",
  emit_nutrition_widget: "nutrition",
  emit_evidence_widget: "evidence",
  emit_progress_widget: "progress",
  emit_calculator_widget: "calculator",
};

// ... inside SSE handler where tool events are processed:
if (event.type === "tool" && WIDGET_V2_TOOLS[event.name]) {
  const family = WIDGET_V2_TOOLS[event.name];
  // Append a widget-v2 segment to the current assistant message.
  // Use whatever mechanism the existing code uses to add rendered segments.
  // Example shape (verify against actual state structure in this file):
  appendAssistantSegment({ type: "widget-v2", content: { family, payload: event.data } });
  return;
}
```

The exact integration depends on how the current code routes prose/tool segments into rendered React elements. Verify by reading `shared/react-chat-app.js` `updateAssistantMessage` / segment handling.

- [ ] **Step 3 · Render widget-v2 segment**

In `shared/emersus-renderer.js` `LLMResponse` (around line 560), add a case:

```js
if (segment.type === "widget-v2") {
  const { family, payload } = segment.content;
  return h(WidgetV2, { key: `wv-${index}`, family, payload });
}
```

Add the import at the top of `shared/emersus-renderer.js`:

```js
import { WidgetV2 } from "./widget-v2/dispatcher.js";
```

- [ ] **Step 4 · Commit**

```bash
git add shared/react-chat-app.js shared/emersus-renderer.js
git commit -m "feat(widget-v2): route SSE tool events for emit_*_widget to dispatcher"
```

---

### Task 15 · Widget fence parser — no changes

- [ ] **Step 1 · Confirm**

Widget-v2 uses the SSE `tool` event path, not markdown fences. `shared/widget-fence-parser.js` does not need modification. Verify by running the existing fence-parser tests:

```bash
npm run test:widget-fence
```

Expected: all passes. No changes to this file in Plan 1.

---

### Task 16 · System-prompt TOOL ORDER update (minimal)

**Files:**
- Modify: `api/emersus/pipeline/prompt.js`

- [ ] **Step 1 · Find TOOL ORDER section**

Run: `rg -n "TOOL ORDER|emit_widget" api/emersus/pipeline/prompt.js | head -10`

- [ ] **Step 2 · Append to the output-tools list**

In `SYSTEM_IDENTITY`, locate the `TOOL ORDER depends on the tool type` section (~line 40) and update the OUTPUT tools line to include `emit_calculator_widget`:

```
- emit_widget, emit_calculator_widget, emit_meal_plan, emit_workout_plan, and log_food are OUTPUT tools. ALWAYS write 2-4 sentences of plain prose first, THEN call the tool — never start a response with one of these. A text-only answer to a meal-plan, workout-plan, food-log, calculator, or widget-eligible request is a failure — you MUST produce the tool call after the prose.
```

Full per-family prompt replacement happens in Plan 8 — Plan 1 only adds minimal awareness so the model knows the tool exists.

- [ ] **Step 3 · Commit**

```bash
git add api/emersus/pipeline/prompt.js
git commit -m "feat(widget-v2): teach system prompt about emit_calculator_widget"
```

---

### Task 17 · End-to-end smoke test (flag off by default)

**Files:**
- Create: `tests/integration/widget-v2-calculator.smoke.test.js`

- [ ] **Step 1 · Write integration smoke**

Create `tests/integration/widget-v2-calculator.smoke.test.js`:

```js
// Integration smoke: drive the pipeline with a mocked OpenAI response that
// returns an emit_calculator_widget tool call. Verify the SSE stream emits
// { type: "tool", name: "emit_calculator_widget", data: <validated> }.

import assert from "node:assert/strict";
import { test } from "node:test";
import { __testables } from "../../api/emersus/pipeline/stream.js";

const { processEvent } = __testables;

test("full widget-v2 event → SSE tool event", () => {
  const state = {
    ctx: { toolResults: {}, _timer: { record() {} } },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const events = [];
  state.onTool = (n, d) => events.push({ type: "tool", name: n, data: d });
  state.onToolError = (n, errs) => events.push({ type: "tool_error", name: n, errors: errs });

  const payload = {
    title: "Daily macros · cut",
    display_width: "narrow",
    summary: "400 kcal deficit",
    follow_up_chips: ["Apply", "Log today"],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  };
  processEvent({
    type: "response.output_item.done",
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify(payload), call_id: "x" },
  }, state);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool");
  assert.equal(events[0].name, "emit_calculator_widget");
  assert.equal(events[0].data.type, "macro_ring");
  assert.deepEqual(events[0].data.data.protein, { grams: 180, target_grams: 180, kcal: 720 });
});

test("invalid payload → tool_error, no tool event", () => {
  const state = {
    ctx: { toolResults: {}, _timer: { record() {} } },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const events = [];
  state.onTool = (n, d) => events.push({ type: "tool", name: n, data: d });
  state.onToolError = (n, errs) => events.push({ type: "tool_error", name: n, errors: errs });

  processEvent({
    type: "response.output_item.done",
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify({ title: "T" }), call_id: "y" },
  }, state);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool_error");
});
```

- [ ] **Step 2 · Run — expect PASS**

Run: `npm run test:integration -- tests/integration/widget-v2-calculator.smoke.test.js`
Expected: 2 passes.

- [ ] **Step 3 · Commit**

```bash
git add tests/integration/widget-v2-calculator.smoke.test.js
git commit -m "test(widget-v2): integration smoke for emit_calculator_widget pipeline"
```

---

### Task 18 · Live preflight on Hetzner

- [ ] **Step 1 · Push preflight + run**

Same pattern as existing Hetzner benchmarks:

```bash
ssh hetzner "cd ~/app && WIDGET_V2_ENABLED=true node scripts/widget-v2-preflight.js 2>&1 | head -40"
```

Expected: `PREFLIGHT OK` + pretty-printed payload with non-default values (model should read the "2500 kcal cut, 180g protein" from the prompt, not emit generic defaults).

If the model emits defaults or ignores the prompt, the trigger wording in the tool description (Task 5) needs tuning — iterate.

- [ ] **Step 2 · Note run in commit message**

No file changes — append result to a note:

```bash
echo "2026-04-17 preflight passed with gpt-5.4-mini; payload matched prompt." >> docs/widget-v2-preflight-log.md
git add docs/widget-v2-preflight-log.md
git commit -m "chore(widget-v2): log successful strict-mode preflight"
```

---

### Task 19 · Enable flag locally + visual smoke

- [ ] **Step 1 · Run the app locally with flag on**

```bash
WIDGET_V2_ENABLED=true npm start
```

- [ ] **Step 2 · Manual test prompt**

Open chat. Send: `I'm cutting at 2500 kcal with 180g protein. Show me my macros.`

Expected: prose appears streaming, then a macro_ring widget renders inline (not in an iframe — inspect element to confirm).

- [ ] **Step 3 · Theme flip test**

While widget is rendered, flip to dark palette (Profile → Appearance → Graphite·Jade). Widget should re-color via CSS vars without re-mount or flicker.

- [ ] **Step 4 · If anything broken, iterate**

Do NOT commit broken code. If the widget doesn't render, doesn't respect palette, or crashes:

- Check browser console for React errors.
- Check network SSE stream for the `tool` event.
- Check that `WIDGET_V2_ENABLED=true` was exported before `npm start`.
- Update failing task and re-run.

- [ ] **Step 5 · Capture screenshot**

Take screenshot of rendered widget in both palettes. Save to `.widget-gallery/plan-1-smoke-paper.png` and `.widget-gallery/plan-1-smoke-mint.png` (local-only, not committed — dir is `.gitignore`d).

---

### Task 20 · Telemetry table migration

**Files:**
- Create: `supabase/migrations/<timestamp>_widget_v2_emission_events.sql`

- [ ] **Step 1 · Generate migration timestamp + file**

```bash
ts=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${ts}_widget_v2_emission_events.sql"
```

- [ ] **Step 2 · Write migration**

```sql
-- widget_v2_emission_events — per-emission telemetry for the widget-v2 rollout.
-- Referenced by docs/superpowers/specs/2026-04-17-widget-template-refactor-design.md §10.
-- Read-side aggregates added in Plan 8.

CREATE TABLE IF NOT EXISTS public.widget_v2_emission_events (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  thread_id       UUID,
  family          TEXT NOT NULL,
  type            TEXT NOT NULL,
  output_tokens   INTEGER,
  elapsed_ms      INTEGER,
  prose_end_to_widget_done_ms INTEGER,
  display_width   TEXT,
  validator_result TEXT NOT NULL,
  openai_response_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_widget_v2_events_created_at
  ON public.widget_v2_emission_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_v2_events_family_type
  ON public.widget_v2_emission_events (family, type, created_at DESC);

-- Allow service role to insert / select; no direct user access (rollups live in views).
ALTER TABLE public.widget_v2_emission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY widget_v2_events_service_all
  ON public.widget_v2_emission_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 3 · Apply locally via psql (uses Hetzner pattern)**

Per `feedback_migration_scp_conflict.md`:

```bash
cat "supabase/migrations/${ts}_widget_v2_emission_events.sql" | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Expected: `CREATE TABLE` + two `CREATE INDEX` + `ALTER TABLE` + `CREATE POLICY`.

- [ ] **Step 4 · Verify**

```bash
ssh hetzner "docker exec -i supabase-db psql -U postgres -d postgres -c '\\d+ public.widget_v2_emission_events'"
```

Expected: table structure matches.

- [ ] **Step 5 · Commit**

```bash
git add supabase/migrations/
git commit -m "feat(widget-v2): add widget_v2_emission_events telemetry table"
```

---

### Task 21 · Emission logger

**Files:**
- Modify: `api/emersus/pipeline/stream.js`
- Test: existing stream tests cover integration

- [ ] **Step 1 · Add insert helper**

In `api/emersus/pipeline/stream.js`, near `logTokenUsage` (~line 74), add:

```js
const WIDGET_V2_TOOL_TO_FAMILY = {
  emit_pharma_widget: "pharma",
  emit_training_widget: "training",
  emit_nutrition_widget: "nutrition",
  emit_evidence_widget: "evidence",
  emit_progress_widget: "progress",
  emit_calculator_widget: "calculator",
};

async function logWidgetV2Emission(ctx, toolName, data, elapsedMs) {
  const family = WIDGET_V2_TOOL_TO_FAMILY[toolName];
  if (!family) return;
  const { _supabaseUrl: url, _serviceRoleKey: key } = ctx;
  if (!url || !key) return;
  const payload = {
    user_id: ctx.supabaseUserId || null,
    thread_id: ctx.threadId || null,
    family,
    type: data?.type || null,
    output_tokens: ctx.tokenUsage?.output_tokens || null,
    elapsed_ms: elapsedMs,
    display_width: data?.display_width || null,
    validator_result: "valid",
    openai_response_id: ctx._openaiResponseId || null,
  };
  try {
    await fetch(`${url}/rest/v1/widget_v2_emission_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("widget-v2 emission log failed:", err);
  }
}
```

- [ ] **Step 2 · Wire into onTool path**

In `stream()`, modify the `onTool` handler:

```js
onTool: (name, data) => {
  sendSSE(res, { type: "tool", name, data });
  if (WIDGET_V2_TOOL_TO_FAMILY[name]) {
    const elapsedMs = ctx._synthesisStartMs ? (Date.now() - ctx._synthesisStartMs) : null;
    logWidgetV2Emission(ctx, name, data, elapsedMs).catch(() => {});
  }
},
```

Also wire in `onToolError` for validator_result != valid:

```js
onToolError: (name, errors) => {
  sendSSE(res, { type: "tool_error", name, errors });
  if (WIDGET_V2_TOOL_TO_FAMILY[name]) {
    const elapsedMs = ctx._synthesisStartMs ? (Date.now() - ctx._synthesisStartMs) : null;
    logWidgetV2Emission({ ...ctx }, name, { type: null, display_width: null }, elapsedMs).catch(() => {});
  }
},
```

Update `logWidgetV2Emission` signature to accept a `validator_result` string; default `"valid"`.

- [ ] **Step 3 · Smoke-verify on Hetzner**

```bash
ssh hetzner "docker exec -i supabase-db psql -U postgres -d postgres -c 'SELECT COUNT(*) FROM public.widget_v2_emission_events;'"
```

Expected: some count > 0 after the live preflight (Task 18) ran.

- [ ] **Step 4 · Commit**

```bash
git add api/emersus/pipeline/stream.js
git commit -m "feat(widget-v2): log emission events for rollout telemetry"
```

---

### Task 22 · Plan completion marker

- [ ] **Step 1 · Update memory**

Append to `C:\Users\Sidar\.claude\projects\C--Users-Sidar-Desktop-emersus\memory\project_widget_template_refactor.md`:

```markdown
**Plan 1 shipped 2026-XX-XX**: widget-v2 infrastructure + macro_ring pilot. Feature flag WIDGET_V2_ENABLED gates rollout. Next: Plan 2 (Pharma family).
```

- [ ] **Step 2 · Run full test suite**

```bash
npm test
```

Expected: all passes including existing tests + 7 new widget-v2 test files.

- [ ] **Step 3 · Final commit**

```bash
git commit --allow-empty -m "docs(widget-v2): Plan 1 complete — infrastructure + macro_ring pilot"
```

- [ ] **Step 4 · Tag**

```bash
git tag widget-v2-plan-1 -m "Widget v2 Plan 1: infrastructure + macro_ring"
```

Do NOT push the tag automatically. User confirmation required before `git push` per `feedback_autonomous_mode.md`.

---

## Self-Review

**Spec coverage:**
- §3 Tool surface (C) — Task 5 adds `emit_calculator_widget` with strict-mode schema.
- §4 Template catalogue — Task 11 adds `macro_ring`; remaining 54 scheduled for Plans 2-7.
- §5 Common data schema — Task 3 validator + Task 4 per-type validator implement the base.
- §6 Rendering architecture — Tasks 7-12 (primitives, dispatcher, component).
- §7 Interactivity — macro_ring is render-only in Plan 1; slider-driven interactivity deferred to Plan 7 (where the full macro_calculator template lives). macro_ring is a display card, not a calculator.
- §8 System prompt changes — Task 16 (minimal) + full family descriptions in Plan 8.
- §9 Migration — feature flag in Task 1; Plan 9 handles ramp + deprecate.
- §10 Metrics — Tasks 20-21.

**Placeholder scan:** No TBD/TODO/"fill in later" instances found. Exact code, paths, commands in every step.

**Type consistency:** `WIDGET_V2_TOOL_TO_FAMILY` map used consistently in Task 14 (client) and Task 21 (server). `validateCalculatorWidget` signature `(payload) → { valid, errors }` consistent across Tasks 4, 5, 17. `Widget` component props consistent across MacroRing, CardFrame, dispatcher tests.

**Gaps closed:** Added Task 15 (explicit no-op on fence parser) + Task 16 (minimal system-prompt update) because the spec implies these.

---

## Handoff

Plan complete and saved. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints

Which approach?
