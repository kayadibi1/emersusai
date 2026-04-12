# Workflow Pipeline Redesign

**Date:** 2026-04-13
**Status:** Approved
**Supersedes:** `2026-04-12-tool-routed-workflow-design.md`

## Problem

`workflow.js` is a 4325-line monolith that does 10+ jobs: input sanitization, safety classification, profile merging, evidence retrieval, LLM synthesis, tool call extraction, fence parsing/normalization, card building, confidence scoring, visual artifact generation, and response assembly. Changes cascade — the tool-routed workflow redesign (16 commits) immediately hit 4 follow-up bugs because fence parsing, normalization, and tool call handling are interleaved in ways that are impossible to reason about or test in isolation.

The fence-based output format (model writes prose mixed with ````widget`/`workout-plan`/`meal-plan` fences, server parses them out via regex, client re-parses them) is the primary source of bugs. The model doesn't reliably produce fences in the expected format, and every normalization layer is a site for silent data loss.

## Solution

Two changes applied together:

1. **Decompose** — Break the monolith into a linear pipeline of single-purpose modules (~200-350 lines each), wired by a slim orchestrator (~60 lines).
2. **Rethink the interaction model** — All structured output flows through OpenAI Responses API tool calls with `strict: true`. Fences are eliminated. Streaming delivers prose in real-time and tool results as complete objects.

## Architecture

### Pipeline Shape

```
HTTP request
  → sanitize (validate, fetch profile, merge, normalize thread state)
  → safety (3-matcher guardrail; ShortCircuit on refusal)
  → retrieve (pgvector evidence retrieval + ranking + formatting)
  → synthesize (build OpenAI request, open streaming connection)
  → stream (read OpenAI SSE → forward client SSE)
  → done
```

Each stage is an async function: `async (ctx) => ctx`. Early exits (safety refusal, onboarding redirect) throw `ShortCircuit` with a response payload.

### Context Object

A single `ctx` object flows through all stages:

```js
{
  // Input (immutable after sanitize)
  question, userId, stableUserId, supabaseUserId,
  threadId, threadState, recentMessages, requestMeta,
  profile,          // merged from request + Supabase
  workoutPlan,      // fetched if active_workout_plan_id in threadState
  includeDebug,

  // Populated by stages
  plan,             // { topic, riskLevel }
  evidence,         // { available, method, items[], formatted }

  // Output (populated by stream stage)
  prose,            // accumulated text content
  toolResults,      // { mealPlan?, workoutPlan?, widget?, foodLog? }
  sources,          // formatted evidence sources for client
  tokenUsage,       // { input_tokens, output_tokens, cached_tokens }
  debug,            // stage timings, response id, model, etc.
}
```

### Orchestrator

```js
// workflow.js (~60 lines)
export async function generateRecommendation(req, res, rawInput) {
  let ctx = createContext(rawInput);
  try {
    ctx = await sanitize(ctx);
    ctx = await safety(ctx);
    ctx = await retrieve(ctx);
    ctx = await synthesize(ctx);
    await stream(ctx, res);
  } catch (err) {
    if (err instanceof ShortCircuit) {
      return sendResponse(res, err.response);
    }
    throw err;
  }
}
```

A `generateRecommendationJSON()` compat wrapper buffers the stream into a JSON response for tests and the onboarding flow.

## Tool Definitions

Four tools, all with `strict: true` enforced schemas.

### `emit_meal_plan`

Called when the user asks for a meal plan, diet plan, macro breakdown, or cut/bulk/recomp plan.

**Description** carries the Mifflin-St Jeor protocol, day type rules (training/rest/refeed), USDA food rules, and supplement guidelines — moved from system prompt into the tool where it's contextually relevant.

**Schema** (strict):
```json
{
  "type": "object",
  "required": ["targets", "day_types", "assignments"],
  "additionalProperties": false,
  "properties": {
    "targets": {
      "type": "object",
      "description": "Macro targets keyed by day_type slug",
      "additionalProperties": false,
      "properties": {
        "training_day": { "type": "object", "required": ["kcal","protein_g","carbs_g","fat_g","fiber_g"], "additionalProperties": false, "properties": { "kcal":{"type":"number"}, "protein_g":{"type":"number"}, "carbs_g":{"type":"number"}, "fat_g":{"type":"number"}, "fiber_g":{"type":"number"} } },
        "rest_day": { "...same shape..." },
        "refeed_day": { "...same shape..." }
      },
      "required": ["training_day", "rest_day", "refeed_day"]
    },
    "day_types": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["slug", "name", "meals", "supplements"],
        "additionalProperties": false,
        "properties": {
          "slug": { "type": "string" },
          "name": { "type": "string" },
          "meals": { "type": "array", "items": { "$ref": "#/$defs/meal" } },
          "supplements": { "type": "array", "items": { "$ref": "#/$defs/supplement" } }
        }
      }
    },
    "assignments": {
      "type": "object",
      "required": ["mode", "default_day_type"],
      "additionalProperties": false,
      "properties": {
        "mode": { "type": "string", "enum": ["auto_from_workout", "manual"] },
        "default_day_type": { "type": "string" }
      }
    }
  }
}
```

`strict: true` eliminates the normalization bug where the model embedded targets inside day_type objects — that shape becomes structurally impossible.

### `emit_workout_plan`

Called when the user asks for a training program, workout split, or periodization plan.

**Description** carries periodization rules, session structure, RPE/load prescriptions, warmup requirements.

**Schema** (strict): sessions array with blocks, warmup_blocks, schema_version. All properties required, `additionalProperties: false` at every level.

### `emit_widget`

Called when the answer benefits from a visual — comparisons, charts, calculators, matrices, dose-response curves, mechanism diagrams.

**Schema** (strict):
```json
{
  "type": "object",
  "required": ["title", "html"],
  "additionalProperties": false,
  "properties": {
    "title": { "type": "string" },
    "html": { "type": "string" }
  }
}
```

**Server-side validation:** Reject if `html` contains `<script src=`, `<link`, `@import`, `fetch(`, `localStorage`. The iframe sandbox is the primary security boundary; this is defense-in-depth.

**Description** carries the widget rules: dark surface design tokens, Chart.js availability, no external resources, CSS variable names, accent hex codes for chart data.

### `log_food`

Called when the user reports what they ate or drank.

**Schema** (strict):
```json
{
  "type": "object",
  "required": ["foods", "meal_slot"],
  "additionalProperties": false,
  "properties": {
    "meal_slot": { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"] },
    "foods": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description", "grams", "kcal", "protein_g", "carbs_g", "fat_g"],
        "additionalProperties": false,
        "properties": {
          "description": { "type": "string" },
          "grams": { "type": "number" },
          "kcal": { "type": "number" },
          "protein_g": { "type": "number" },
          "carbs_g": { "type": "number" },
          "fat_g": { "type": "number" }
        }
      }
    }
  }
}
```

Replaces the regex-based `isLogFoodIntent()` + `parseFoodDescription()` fast path. Slower (requires LLM) but far more accurate for complex food descriptions.

### Validation Contract

`validateToolCall(name, args)` returns `{ valid: true, data }` or `{ valid: false, errors }`.

On validation failure: the tool result is dropped, prose stands alone, and a `toolError` field is included in the response so the client can show a retry prompt. No fallback text injection, no fence rescue.

## Streaming Model

### Flow

```
Client ←—SSE—→ Server ←—SSE—→ OpenAI Responses API
```

### Three Event Types to Client

**`prose`** — Text deltas, streamed in real-time.
```json
{"type": "prose", "delta": "Creatine monohydrate is one of the most"}
```

**`tool`** — Complete validated tool result, sent when the tool call finishes.
```json
{"type": "tool", "name": "emit_widget", "data": {"title": "...", "html": "..."}}
```

**`done`** — Final payload with sources, usage, debug.
```json
{"type": "done", "sources": [...], "usage": {...}, "debug": {...}}
```

### Server-Side Event Mapping

| OpenAI Event | Server Action |
|---|---|
| `response.output_text.delta` | Forward as `{ type: "prose", delta }` |
| `response.function_call_arguments.delta` | Accumulate in `toolBuffer[callId]` |
| `response.output_item.done` (function_call) | Parse JSON, validate, send `{ type: "tool", name, data }` |
| `response.completed` | Send `{ type: "done", sources, usage }` |

### Key Behaviors

- **Interleaved output:** Prose and tool calls can alternate. Model writes "Here's your plan:" → calls `emit_meal_plan` → writes "This gives you 2400 kcal on training days." Client handles all orderings.
- **No retry/fallback in the stream.** If the primary call fails, stream sends `done` with an error. Client shows retry. Eliminates hidden second/third LLM calls.
- **Backpressure:** Client disconnect → server aborts the OpenAI request via `AbortController`. No wasted tokens.
- **One tool call at a time** in practice (model almost always calls 0 or 1), but the protocol supports multiple sequential `tool` events.

### HTTP Endpoint

`POST /api/emersus/recommendation` returns `Content-Type: text/event-stream`.

Compatibility wrapper `generateRecommendationJSON()` buffers the full stream and returns a JSON object — used by tests and potentially by onboarding.

## System Prompt

### Message 1: Identity, Scope & Voice (~80 lines)

Defines Emersus's identity, wheelhouse (training, nutrition, supplements, recovery, cardiovascular health, mental performance), hard stops (self-harm, PED, injection, off-topic), voice guidelines, and tool usage instructions.

Key instruction: "Write your prose FIRST, then call the tool. Never duplicate tool content in prose — the tool IS the structured breakdown."

### Message 2: Widget Design Tokens (~40 lines)

Design token reference only: CSS variable names, accent colors, Chart.js availability, iframe constraints. No examples, no "when to emit" logic (that's in the `emit_widget` tool description).

### User Message

Single JSON object:
```json
{
  "today": "2026-04-13",
  "question": "...",
  "user_profile": { ... },
  "thread_memory": "...",
  "current_workout_plan": null,
  "evidence": "..."
}
```

No more `topic`, `risk_level`, `safety_mode`, `safety_reasons`, `instructions[]`. Safety is server-side. The model doesn't need to know its risk classification.

### Total: ~120 lines (down from ~2400)

Tool descriptions carry the generation protocols. The system prompt is identity + scope + voice.

## Module Breakdown

### Directory Structure

```
api/emersus/
  workflow.js                  — orchestrator (~60 lines)
  pipeline/
    context.js                 — ctx factory, ShortCircuit, TimeTracker (~40 lines)
    sanitize.js                — input validation, profile, thread state (~300 lines)
    safety.js                  — 3-matcher guardrail + refusal copy (~250 lines)
    retrieve.js                — vector evidence + ranking + formatting (~150 lines)
    prompt.js                  — system prompt + user message builders (~150 lines)
    tools.js                   — 4 tool definitions + validators (~350 lines)
    synthesize.js              — build OpenAI request, open stream (~120 lines)
    stream.js                  — OpenAI SSE → client SSE bridge (~200 lines)
    format-sources.js          — evidence source formatting (~60 lines)
    onboarding.js              — onboarding flow (~150 lines)
  retrieveDatabaseEvidence.js  — unchanged
  rerank.js                    — unchanged
```

### Net Size

Current: 1 file, 4325 lines.
New: 11 files, ~1830 lines total. 58% reduction while adding streaming.

### What Gets Deleted

| Section | ~Lines | Reason |
|---|---|---|
| Fence parsing (splitSynthesisIntoSegments, stripCodeFences, stripStrayFenceMarkers) | 120 | No fences |
| Normalization pipeline (normalizeSynthesisPayload, stripLeakedSourceSections) | 100 | Structured output, not mixed text |
| Card building (buildCards, buildMetricGridCard, buildQuantFindings) | 300 | Model + widget tool covers this |
| Confidence scoring (computeConfidence + helpers) | 150 | Removed |
| Visual artifact builders (diagram, chart, mockup, interactive, art) | 700 | Widget tool replaces all |
| Widget forcing retry (callOpenAIWidgetForcingRetry) | 60 | No retry/fallback |
| Fallback synthesis | 70 | Single model, client retry |
| Diagram planner (callOpenAIDiagramPlanner) | 60 | Widget tool covers this |
| Food logging fast path (isLogFoodIntent, parseFoodDescription ref) | 80 | log_food tool replaces |
| Pseudo-visual detection + rescue functions | 50 | No pseudo-visual detection |
| **Total** | **~1690** | |

## Frontend Changes Required

`shared/react-chat-app.js`:

1. Switch from `fetch()` → JSON to streaming fetch with SSE parsing
2. Handle 3 event types (`prose`, `tool`, `done`) instead of parsing `answer_text` for fences
3. Remove dependency on `emersus-renderer.js` fence parser — tool results arrive as typed objects
4. Render tool results by `name`: `emit_meal_plan` → meal plan component, `emit_workout_plan` → workout plan view, `emit_widget` → iframe sandbox, `log_food` → food log confirmation UI
5. Source citations render on `done` event instead of being extracted from response JSON

## Preserved Behaviors

- Profile injection sanitization (regex patterns on all free-text fields)
- Workout plan sanitization for model input (walk all user-writable fields)
- Safety classification (3-matcher: injection, self-harm, PED) — runs before LLM call
- Evidence retrieval via pgvector + reranking (unchanged modules)
- Token usage logging to Supabase (fire-and-forget)
- Guardrail event logging to Supabase (fire-and-forget)
- Onboarding flow (own system prompt, own OpenAI call, profile upsert)
- Thread memory block construction from threadState

## Non-Goals

- Changing the evidence retrieval pipeline or reranking logic
- Modifying the Supabase schema
- Adding new LLM capabilities (vision, audio, etc.)
- Changing the onboarding flow beyond extracting it to its own module
- Multi-model fallback (removed — single model, client-side retry on failure)
