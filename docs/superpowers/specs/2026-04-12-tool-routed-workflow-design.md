# Tool-Routed Workflow Redesign

**Date:** 2026-04-12
**Status:** Approved
**Scope:** `api/emersus/workflow.js` restructure across 4 stages

## Problem

workflow.js was designed for weaker models. It compensates for unreliable output with:

- Server-side regex intent classification (`inferTopic`, `classifyNutritionIntent`, `FITNESS_AFFINITY`)
- Conditional system prompt addendums (`MEAL_PLAN_GENERATION_PROTOCOL`, `systemPromptAddendum`)
- A 150-line normalization pipeline that parses, strips, rewraps, and rescues fences (`splitSynthesisIntoSegments`, `stripCodeFences`, `stripStrayFenceMarkers`, `autoWrapBareWorkoutPlan`, `autoWrapBareHtml`)
- A 300-term regex guardrail that conflates scope enforcement with safety enforcement, requiring brittle exemptions for every new feature

Every new structured output type (workout-plan, meal-plan, nutrition-log-confirm) must be added to 6+ locations in the fence pipeline. The meal-plan implementation missed the backend entirely — the backend strips `meal-plan` fences because `splitSynthesisIntoSegments()` only recognizes `widget`, `html`, and `workout-plan`. Additionally, "Do not return JSON" in system message 2 directly contradicts the meal-plan protocol's instruction to emit JSON.

gpt-5.4-mini doesn't need any of this. The model can self-route via tool selection, follow format instructions reliably, and handle scope refusal without a 300-term regex gate.

## Architecture

### Before (model-babysitting pattern)

```
User message
  -> regex classifies intent (inferTopic, classifyNutritionIntent)
  -> server decides which system prompt addendum to inject
  -> massive system prompt tells model "emit ```fence-type JSON```"
  -> model sometimes complies, sometimes doesn't
  -> normalizeSynthesisPayload parses/strips/rewraps fences
  -> autoWrapBare* rescues forgotten fences
  -> client re-parses fences from answer_text string
```

### After (tool-routed pattern)

```
User message
  -> targeted safety check (PED / self-harm / prompt injection only)
  -> callOpenAISynthesis with tools: [emit_meal_plan, emit_workout_plan]
  -> model returns: content (prose + widget fences) + optional tool call (validated JSON)
  -> server extracts tool call -> validates -> wraps in fence -> appends to prose
  -> normalizeSynthesisPayload handles widget fences and prose only
  -> client renders as before (parseLLMOutput unchanged)
```

## Tool Definitions

### emit_meal_plan

Called by the model when it wants to produce a meal plan. The tool description replaces `MEAL_PLAN_GENERATION_PROTOCOL`. The parameters schema matches the existing `shared/meal-plan-schema.js` validator.

**Tool description** (replaces the system prompt blob):

> Generate a structured meal plan. Compute macro targets using Mifflin-St Jeor: BMR = 10*weight_kg + 6.25*height_cm - 5*age + (5 male, -161 female). TDEE = BMR * activity_multiplier (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9). Adjust for goal: cut -500, maintain TDEE, bulk +250-400. Protein 1.6-2.2 g/kg. Fat 20-35% kcal. Carbs remainder. Fiber 14g per 1000 kcal.
>
> Emit THREE day types: training_day, rest_day, refeed_day. Use USDA FDC generic foods only. Respect dietary_preferences from profile. Include evidence-based supplements only (creatine, whey, vitamin D, omega-3, caffeine, electrolytes, magnesium). Do NOT call this tool if the user's profile is missing body_weight_kg, height_cm, date_of_birth, biological_sex, or activity_level — ask for those values first.

**Parameters schema** (non-strict mode, validated server-side by `validateMealPlan()`):

```json
{
  "type": "object",
  "required": ["targets", "day_types", "assignments"],
  "properties": {
    "targets": {
      "type": "object",
      "description": "Macro targets keyed by day_type slug (e.g. training_day, rest_day, refeed_day). Each value has kcal, protein_g, carbs_g, fat_g, fiber_g as non-negative numbers."
    },
    "day_types": {
      "type": "array",
      "description": "Array of day type objects. Typically three: training_day, rest_day, refeed_day.",
      "items": {
        "type": "object",
        "required": ["slug", "name", "meals"],
        "properties": {
          "slug": {
            "type": "string",
            "description": "Lowercase identifier matching /^[a-z][a-z0-9_]{0,30}$/"
          },
          "name": {
            "type": "string",
            "description": "Human-readable name, e.g. 'Training Day'"
          },
          "meals": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["slot", "name", "foods"],
              "properties": {
                "slot": {
                  "type": "string",
                  "enum": ["breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening", "pre_workout", "post_workout", "supplements_am", "supplements_pm"]
                },
                "name": {
                  "type": "string",
                  "description": "Meal name, e.g. 'High-protein breakfast'"
                },
                "foods": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["description", "grams"],
                    "properties": {
                      "description": { "type": "string" },
                      "grams": { "type": "number" },
                      "fdc_id": { "type": "integer" }
                    }
                  }
                }
              }
            }
          },
          "supplements": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["description", "amount", "unit"],
              "properties": {
                "description": { "type": "string" },
                "amount": { "type": "number" },
                "unit": { "type": "string" },
                "timing": {
                  "type": "string",
                  "enum": ["any", "morning", "with_meal", "pre_workout", "post_workout", "bedtime"]
                }
              }
            }
          }
        }
      }
    },
    "assignments": {
      "type": "object",
      "required": ["mode", "default_day_type"],
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["auto_from_workout", "manual"]
        },
        "default_day_type": {
          "type": "string",
          "description": "Slug of the default day type (e.g. rest_day)"
        },
        "overrides": {
          "type": "object",
          "description": "Optional map of ISO date (YYYY-MM-DD) to day_type slug"
        }
      }
    },
    "provenance": {
      "type": "object",
      "description": "Optional. Include profile_snapshot with the user's goal, body_weight_kg, etc.",
      "properties": {
        "profile_snapshot": { "type": "object" }
      }
    }
  }
}
```

### emit_workout_plan (stage 2)

Same pattern. Tool description replaces the WORKOUT-PLAN FENCES + CHAT ADJUSTMENTS sections of `INLINE_WIDGET_SYSTEM_INSTRUCTIONS`. Parameters schema matches the existing workout-plan fence spec (schema_version 1, sessions array, etc.).

The tool description includes:
- Session shape (id, week, day_of_week, date, blocks, warmup_blocks)
- Field rules (schema_version must be 1, id format s_w{week}d{day}, compact JSON)
- Chat adjustment rules (updates_plan_id, preserve session ids)
- current_workout_plan context is passed in the user message as before

### Tools are passed on every call

Both tools are included in every `callOpenAISynthesis` call, not conditionally. The model's tool choice IS the intent signal. No server-side intent classification needed.

## Server-Side Handling

### Tool call processing (new function)

After `callOpenAISynthesis` returns:

1. Extract `content` items from response output (prose + widget fences)
2. Extract `function_call` items from response output
3. For each function call:
   a. `emit_meal_plan`: parse arguments, validate with `validateMealPlan()`, validate profile completeness. If valid, wrap JSON in `` ```meal-plan `` fence. If profile incomplete, discard tool output and inject profile-gate response.
   b. `emit_workout_plan`: parse arguments, validate schema. If valid, wrap JSON in `` ```workout-plan `` fence.
4. Combine: prose content + "\n\n" + fence-wrapped tool output
5. Feed combined string into `normalizeSynthesisPayload()` (which now only handles widget fences and prose cleanup)

### Profile gate (server-side validation)

The tool description tells the model not to call `emit_meal_plan` without a complete profile. Belt-and-suspenders: the server checks `mergedProfile` when it receives the tool call. If any of the five required fields (body_weight_kg, height_cm, date_of_birth, biological_sex, activity_level) are null, the server:

1. Discards the tool call output
2. Constructs a response asking for the missing fields
3. Returns that response instead of the model's output

This replaces `checkNutritionProfileGate()` and the `systemPromptAddendum` conditional assembly.

### Fence survival

In stage 1, `splitSynthesisIntoSegments()` and its guard regexes need a minimal update to recognize `meal-plan` fences (so they survive the normalization pipeline after being injected by the server). In stage 3, plan-type handling is removed entirely from the pipeline since tool outputs bypass it.

## System Prompt Changes

### Stage 1

- Remove `MEAL_PLAN_GENERATION_PROTOCOL` constant
- Remove `systemPromptAddendum` conditional assembly (lines 4460-4479)
- Amend line 2111: `"Do not return JSON."` -> `"Do not return JSON in prose. Structured data goes through tool calls."`
- `instructions[]` array in user message stays (per-request context)

### Stage 2

- Remove WORKOUT-PLAN FENCES section (~110 lines) from `INLINE_WIDGET_SYSTEM_INSTRUCTIONS`
- Remove CHAT ADJUSTMENTS section
- Remove workout-plan entries from `instructions[]` array (lines 2195-2196)
- Few-shot example (messages 3-4) stays (demonstrates widget HTML, not plans)

## Guardrail Redesign

### Current: scope + safety conflated

`classifySafety()` is a multi-layer regex classifier:
- `FITNESS_AFFINITY` 300-term regex (scope enforcement)
- Exemptions: `isNutritionGateReply`, `threadTopicIsNutrition` (undo false positives)
- Cooldown tracking (`recordGuardrailBlock`, `clearGuardrailCooldown`)
- PED/self-harm/medication/diagnosis detection (safety enforcement)

### Redesigned: safety only, three targeted matchers

**Scope enforcement -> trust the model.** System prompt hard stop #5 handles off-topic refusal. gpt-5.4-mini follows this reliably. The 300-term regex, all exemptions, and cooldown logic are removed.

**Safety enforcement -> three focused patterns:**

| Category | Detection | Action |
|----------|-----------|--------|
| PED protocols | Actionable PED terms (cycle, stack, dose, PCT) in proximity to substance names (tren, sarm, dbol, clen, dnp, anavar, testosterone injection, etc.) | Hard refusal before model call |
| Self-harm / crisis | Explicit self-harm terms (suicide, self-harm, kill myself, etc.) | Hard refusal + crisis resources |
| Prompt injection | "ignore previous", "system prompt", "act as if safety", jailbreak patterns | Silent strip or hard refusal |

Each pattern is tight and specific. No false positives on normal fitness/nutrition questions. No exemptions needed.

**Post-call validation (optional belt-and-suspenders):** After the model responds, scan output for PED dosing patterns. If the model slipped through despite the system prompt, catch it before sending to the client.

### What is removed

- `FITNESS_AFFINITY` regex (~300 terms)
- `isNutritionGateReply` exemption
- `threadTopicIsNutrition` exemption
- Cooldown tracking (`recordGuardrailBlock`, `clearGuardrailCooldown`)
- `buildGuardrailResponse()` for scope blocks (kept for safety blocks)
- All thread-state routing in the guardrail

### What medication dosing and diagnosis don't need server enforcement

The system prompt handles these as "soft" refusals — the model gives general education but redirects to clinicians. The failure mode is minor (slightly too-specific answer, not a dangerous one). Server-side hard stops are reserved for categories where model failure has real consequences.

## Normalization Pipeline Changes

### Stage 1 (minimal)

Add `meal-plan` to `splitSynthesisIntoSegments()` and guard regexes so server-injected fences survive.

### Stage 3 (full cleanup)

- Remove `autoWrapBareWorkoutPlan()` — tool output is always valid
- Remove workout-plan and meal-plan handling from `splitSynthesisIntoSegments()`
- Remove plan-type guards from `stripCodeFences()`, `stripStrayFenceMarkers()`
- Remove plan-type filtering from `proseOnly` extraction
- `normalizeSynthesisPayload()` becomes widget-and-prose pipeline only
- Remove unclosed workout-plan detection (backend + `widget-fence-parser.js`)

## Stage Breakdown

### Stage 1: meal-plan via tool call

**Add:**
- `emit_meal_plan` tool definition
- Tool call processing in response handler
- Server-side profile gate validation on tool call
- `meal-plan` recognition in `splitSynthesisIntoSegments` + guard regexes

**Remove:**
- `MEAL_PLAN_GENERATION_PROTOCOL` constant
- `systemPromptAddendum` conditional assembly
- `classifyNutritionIntent()`
- `checkNutritionProfileGate()` (replaced by server-side tool call validation)
- Nutrition sub-routing block (lines 4388-4565) — `inferTopic()` and `buildPlan()` stay (they feed `plan.topic` into the user message for non-nutrition questions)

**Amend:**
- "Do not return JSON" line in system message 2

**Client changes:** None. `parseLLMOutput()` already handles `meal-plan` fences.

### Stage 2: workout-plan via tool call

**Add:**
- `emit_workout_plan` tool definition
- Workout-plan tool call processing in response handler

**Remove:**
- WORKOUT-PLAN FENCES section from `INLINE_WIDGET_SYSTEM_INSTRUCTIONS` (~110 lines)
- CHAT ADJUSTMENTS section (~25 lines)
- Workout-plan entries from `instructions[]` array

**Keep as fallback:** Existing fence path — if model emits a fence instead of a tool call, the pipeline still handles it.

**Client changes:** None.

### Stage 3: simplify normalization pipeline

**Remove:**
- `autoWrapBareWorkoutPlan()`
- `autoWrapBareHtml()` (verify gpt-5.4-mini doesn't exhibit this failure mode first)
- Workout-plan and meal-plan handling from `splitSynthesisIntoSegments()`
- Plan-type guards from `stripCodeFences()`, `stripStrayFenceMarkers()`
- Plan-type filtering from `proseOnly` extraction
- Unclosed workout-plan detection (backend + frontend)
- Fence-path fallback from stage 2

**Client changes:** Remove unclosed workout-plan handling from `widget-fence-parser.js`.

### Stage 4: guardrail redesign + dead code removal

**Replace:**
- `classifySafety()` internals with three targeted matchers (PED, self-harm, prompt injection)

**Remove:**
- `FITNESS_AFFINITY` regex
- `isNutritionGateReply`, `threadTopicIsNutrition` exemptions
- Cooldown tracking (`recordGuardrailBlock`, `clearGuardrailCooldown`)
- `inferTopic()` entirely
- Thread-state routing block (lines 4388-4458)
- `buildGuardrailResponse()` scope-block variants

**Add (optional):**
- Post-call output scan for PED/safety patterns

**Client changes:** None.

## Migration Safety

- Stages are independently deployable. Each stage is a working state.
- Stage 2 keeps the fence fallback so workout plans work even if the model doesn't use the tool.
- Stage 3 only removes the fallback after tools are proven in production.
- Stage 4 is the only stage that changes safety behavior — test thoroughly.
- All changes are in `workflow.js` and `widget-fence-parser.js`. No database migrations, no new API endpoints, no new client components.

## Files Touched

- `api/emersus/workflow.js` — all stages
- `shared/widget-fence-parser.js` — stage 3 only (remove unclosed workout-plan detection)
- `shared/meal-plan-schema.js` — no changes (tool schema matches existing validator)
- `shared/react-chat-app.js` — no changes (existing segment rendering handles all fence types)
