# Widget Template Refactor — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation planning
**Supersedes:** raw-HTML `emit_widget` tool surface
**Pre-refactor snapshot:** `docs/widget-flow-pre-template-refactor.md` (read first)

---

## 1 · Problem

Widget generation is 100% output-token-count-bound at ~220 tokens/sec on `gpt-5.4-mini`. Typical widget HTML is 1300–2400 output tokens → **5.9–10.9 s silent gap** between prose end and widget render, with occasional 26 s P95 tail. Additional quality issues surfaced during baseline (2026-04-17):

1. **Widget emission rate ~60%** in warm runs — the model skips `emit_widget` on ~40% of widget-worthy prompts.
2. **Silent validation failures** — `emit_meal_plan` `fdc_id` schema mismatch drops widgets for 18 s with no user-visible feedback.
3. **Trailing-garbage tokens** — one `gpt-5.4-mini` run leaked internal tool-protocol tokens (`"}}]}]}ّto=functions.emit_widget 大发快三走势图json`) into rendered HTML. Model emits raw HTML as a string, so anything the model writes after the widget body gets rendered verbatim.
4. **Runaway iframe heights** — widgets using `responsive: true, maintainAspectRatio: false` inside unsized containers feed the auto-resizer back on itself, hitting the 1400 px clamp.
5. **Legend-vs-visual mismatch** — model describes visual elements in legend that it then fails to render (e.g., `caffeine-timing r3` "peak window" series with only 2 non-null points, invisible under the main line).
6. **Chart.js data errors on interaction** — null `{x,y}` points crash `hitRadius`/`getMinMax` on hover, breaking tooltips mid-session.

All six are symptoms of the same root cause: **the model emits unconstrained HTML+CSS+JS strings**. A typed-spec template system eliminates all six by construction.

## 2 · Goals

Measurable success criteria, evaluated against the 2026-04-17 baseline:

| metric | baseline | target |
|---|---|---|
| Silent gap P50 (prose-end → widget-done) | 5.9 s | **< 1.5 s** |
| Silent gap P95 | ~26 s | **< 3 s** |
| Widget emission rate (warm) | ~60% | **> 90%** |
| Validator drop rate (silent) | unknown (silent) | **< 1% with surfaced error** |
| Trailing-garbage incidents | unknown (silent) | **0 (structurally impossible)** |
| Output tokens per widget | 1300–2400 | **150–350** |

Non-goal: beating `gpt-5.4` + `reasoning:high` on *visual* quality. That model produces larger, often nicer widgets but at 7× latency. We optimize for time-to-render × acceptance, not pure aesthetics.

## 3 · Tool surface (approach C)

Six family-scoped tools. Each is strict-mode, with an internal `type` discriminator that selects the per-template data schema. Cross-family templates (e.g., `macro_calculator`) live in their single canonical home; other families' tool descriptions mention them with a pointer.

| tool name | family | templates | default `display.width` |
|---|---|---|---|
| `emit_pharma_widget` | F1 · Pharmacokinetics | 7 | medium |
| `emit_training_widget` | F2 · Training programming | 9 | mixed |
| `emit_nutrition_widget` | F3 · Nutrition | 9 | mixed |
| `emit_evidence_widget` | F4 · Evidence & comparison | 7 | wide |
| `emit_progress_widget` | F5 · Personal progression | 10 | mixed |
| `emit_calculator_widget` | F6 · Calculators | 9 | medium |

### 3.1 Tool description pattern

Each tool description follows this skeleton:

```
YOU MUST CALL THIS TOOL when the user asks about <family-specific domain phrases>.
Always write 2-4 sentences of prose FIRST, then call this tool.

TRIGGER PHRASES (non-exhaustive):
  <family-specific triggers>

TEMPLATE SELECTION (pick type from):
  <type> — <1-line description of when to use>
  <type> — <1-line description>
  ...

CROSS-FAMILY POINTERS:
  For X, use emit_<other>_widget (type=<other-type>).

Data must be concrete. Do not invent numbers not in retrieval context.
```

### 3.2 Strict-mode schema shape per tool

```json
{
  "type": "function",
  "name": "emit_<family>_widget",
  "strict": true,
  "description": "...",
  "parameters": {
    "type": "object",
    "required": ["title", "display_width", "type", "data", "summary", "follow_up_chips"],
    "additionalProperties": false,
    "properties": {
      "title": { "type": "string" },
      "display_width": { "type": "string", "enum": ["narrow", "medium", "wide"] },
      "summary": { "type": ["string", "null"] },
      "follow_up_chips": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 4
      },
      "type": { "type": "string", "enum": [<variant slugs for this family>] },
      "data": { "oneOf": [<per-variant schemas>] }
    }
  }
}
```

Strict mode requires every key in `required` and `additionalProperties: false` at every level. Optional semantics use `["type","null"]` (see `feedback_openai_strict_mode.md`). Validated before enabling via a real API call to catch per-variant schema violations.

### 3.3 Preserved tool surface

These existing tools remain unchanged:

- `emit_meal_plan` — dedicated meal-plan structure (separate rendering path)
- `emit_workout_plan` — dedicated workout-plan structure
- `log_food` — food journal write
- `get_user_profile`, `update_user_profile`, `remember_fact`, `recall_memory` — server-side

`emit_widget` (legacy raw-HTML) stays in service during Phase 1–3 migration, then deprecates in Phase 4.

## 4 · Template catalogue (the 50)

The full catalogue is rendered in `.superpowers/brainstorm/12234-1776404371/content/` (f1–f6 HTML). Summary table:

### F1 · Pharmacokinetics (`emit_pharma_widget`)

| type | display.width | purpose |
|---|---|---|
| `dose_response_curve` | medium | Sigmoid Hill function; threshold band, EC50 marker |
| `pk_half_life_decay` | medium | Exponential decay with alertness bands + dose/workout vertical markers |
| `supplement_stack_schedule` | wide | Daily lane chart — one supplement per row, pills at dose times |
| `loading_vs_maintenance` | medium | Two curves comparing protocols; saturation threshold line |
| `absorption_multi_protein` | medium | Three curves over hours (whey/casein/soy-style); peak markers |
| `effect_duration_strip` | medium | Lozenge strips per compound — onset → peak → wear-off |
| `dose_threshold_band` | medium | 1-axis dose ladder with sub/therapeutic/over zones + current marker |

### F2 · Training (`emit_training_widget`)

| type | display.width | purpose |
|---|---|---|
| `volume_heatmap` | wide | Grid sets × muscle × week with MEV/MAV/MRV zone colors |
| `mev_mrv_range` | wide | Floating bars per muscle with dot for current volume |
| `rpe_histogram` | medium | Bar distribution of session RPEs |
| `rep_scheme_grid` | medium | reps × %1RM matrix with STR/HYP/END focus badges |
| `training_stress_balance` | wide | CTL/ATL/TSB triple-line trend |
| `fatigue_readiness_composite` | narrow | Ring gauge + HRV/RHR/sleep/soreness/mood sub-bars |
| `weekly_plan_calendar` | wide | 7-day grid with intensity-saturation shading |
| `deload_protocol` | wide | Before/during/after sets + overlaid fatigue dashed line |
| `periodization_timeline` | wide | Macro blocks with current-week marker (from claude-designs v1) |

### F3 · Nutrition (`emit_nutrition_widget`)

| type | display.width | purpose |
|---|---|---|
| `macro_ring` | narrow | Donut + macro progress bars + kcal center |
| `macros_per_meal_stacked` | wide | Stacked bars across meals, target reference line |
| `food_nutrient_scatter` | wide | Protein density × fiber density quadrant with numbered foods + legend |
| `hydration_timeline` | wide | Cumulative fluid vs target pace + meal/workout event markers |
| `micronutrient_radar` | medium | 8-axis radar, 50%-RDI inner ring threshold |
| `calorie_balance_ledger` | wide | Dual-direction bars (in vs out) over a week |
| `meal_timing_strip` | wide | Three rows (zones / recommended / logged) around a workout anchor |
| `protein_distribution_bar` | wide | Per-meal bars with leucine-threshold target + hatched under-threshold flag |
| `tdee_waterfall` | wide | BMR → TEA → NEAT → TEF → TDEE cumulative bars (from claude-designs v1) |

### F4 · Evidence (`emit_evidence_widget`)

9 templates (7 from f4-evidence.html + `effect_size_lollipop`, `study_beeswarm` from claude-designs v1):

| type | display.width | purpose |
|---|---|---|
| `forest_plot` | wide | Per-study square + CI whisker; pooled diamond at bottom |
| `effect_size_lollipop` | wide | Ranked SMD values with CI whiskers + zero-crossing marker (from claude-designs v1) |
| `evidence_strength_card` | medium | GRADE-style badges using `--ev-*` tokens |
| `butterfly_comparison` | wide | Pros vs cons two-sided bars from center axis |
| `study_quality_matrix` | wide | N × duration scatter with design-shape encoding |
| `meta_regression_line` | wide | Dose vs effect scatter + regression line + R² |
| `ci_ladder` | wide | Protocols ranked by effect, CIs shown for overlap detection |
| `citation_timeline` | wide | Studies per year as circles, opacity = citation count |
| `study_beeswarm` | wide | Every study as a dot, jittered vertically (from claude-designs v1) |


### F5 · Progression (`emit_progress_widget`)

12 templates (10 from f5-progression.html + `lift_progress_grid`, `intervention_slopegraph` from claude-designs v1):

| type | display.width | purpose |
|---|---|---|
| `pr_progression_line` | wide | Single-lift trend with novice→elite zone bands |
| `lift_progress_grid` | wide | 6-card dashboard with sparklines + Δ% + plateau detection (from claude-designs v1) |
| `weekly_volume_trend` | wide | Stacked bars per week grouped by muscle |
| `adherence_calendar_heatmap` | wide | GitHub-style year/14-week grid with intensity shading |
| `body_comp_trend` | wide | BW/LBM/FM three-line trend |
| `goal_trajectory_dual` | wide | Actual + projected cone, goal-zone band at endpoint |
| `intervention_slopegraph` | wide | Before/after block with slope color-coding (from claude-designs v1) |
| `session_consistency_strip` | wide | Time-of-day consistency across 4 weeks |
| `vo2max_trend` | wide | Aerobic fitness over time with Cooper zone bands |
| `sleep_consistency_bars` | wide | Per-night bedtime→wake bars with target ribbons |
| `pr_celebration_card` | medium | Hero number + context (previous, streak, rank) |
| `streak_counter_card` | narrow | Current vs best, 14-day proof strip |

F5 is actually 12 templates: the 10 listed above plus two from claude-designs v1 (`lift_progress_grid`, `intervention_slopegraph`). Deduplicated in implementation.

### F6 · Calculators (`emit_calculator_widget`)

| type | display.width | purpose |
|---|---|---|
| `one_rm_estimator` | wide | Weight + reps + RPE → 1RM via Epley/Brzycki/RPE-based |
| `tdee_calculator` | wide | Mifflin-St Jeor + activity multiplier, bulk/cut bands |
| `macro_calculator` | wide | Protein-anchored split, live donut + per-gram breakdown |
| `plate_loader_visual` | wide | Target weight → plate stack illustration per side |
| `rpe_to_percent_rm` | wide | RPE + reps → %1RM lookup table |
| `body_fat_estimator` | wide | Navy circumference method, zone ribbon |
| `carb_cycling_calculator` | wide | Weekly avg + training days → 7-day high/med/low plan |
| `protein_target_calculator` | wide | Body weight + meal count → per-meal protein, leucine threshold check |
| `pace_calculator` | wide | Distance + time → pace + speed + zone mapping |

**Grand total: 7 + 9 + 9 + 9 + 12 + 9 = 55 templates** (the 50 originally planned plus 5 from claude-designs v1 absorbed into their families: `tdee_waterfall` → F3, `periodization_timeline` → F2, `effect_size_lollipop` + `study_beeswarm` → F4, `lift_progress_grid` + `intervention_slopegraph` → F5).

Rejected: `exercise_hierarchy_tree` (per user review).

### 4.1 Cross-family conflict resolution

Only one template appears in two families by domain: `macro_calculator`. Home: **F6**. The F3 `emit_nutrition_widget` description includes a pointer: "For *macro budget* math with sliders, use `emit_calculator_widget(type=macro_calculator)`."

## 5 · Common data schema

Every template shares this baseline contract:

```typescript
interface WidgetBase {
  title: string;                            // short card title
  display_width: "narrow" | "medium" | "wide";
  summary: string | null;                   // optional one-line takeaway under chart
  follow_up_chips: string[];                // up to 4, each emits sendPrompt on click
  type: <template-slug>;                    // variant discriminator
  data: <per-variant-schema>;               // template-specific payload
}
```

Template-specific `data` shapes live in `shared/widget-templates/<family>/<slug>.schema.ts`. Examples:

**`dose_response_curve`:**

```typescript
interface DoseResponseData {
  x_label: string;         // e.g. "daily dose"
  x_unit: string;          // e.g. "g"
  y_label: string;         // e.g. "saturation"
  y_unit: "%" | "mg/dL" | "...";
  ec50: number;
  threshold_band?: { from: number; to: number; label?: string };
  ceiling?: number;
  curves: Array<{
    label: string;           // e.g. "3 g/day"
    series: number;          // 1-5 → --chart-series-N token
    line_style?: "solid" | "dashed" | "dotted";
    points: Array<{ x: number; y: number }>;
  }>;
  highlight_point?: { x: number; y: number; label: string };
}
```

**`macro_ring`:**

```typescript
interface MacroRingData {
  kcal_total: number;
  phase: "cut" | "maintenance" | "bulk";
  protein: { grams: number; target_grams: number; kcal: number };
  carbs:   { grams: number; target_grams: number; kcal: number };
  fat:     { grams: number; target_grams: number; kcal: number };
  tdee_reference?: { tdee: number; delta_kcal: number };
}
```

**`forest_plot`:**

```typescript
interface ForestPlotData {
  outcome_label: string;
  x_axis: { min: number; max: number; label: string };
  studies: Array<{
    label: string;             // "Volek 2004"
    n: number;
    effect: number;
    ci_low: number;
    ci_high: number;
    is_outlier?: boolean;
  }>;
  pooled: {
    k: number;                 // study count
    effect: number;
    ci_low: number;
    ci_high: number;
    model: "random-effects" | "fixed-effects";
  };
}
```

All 54 schemas are authored in this style: concrete, small (usually 5–15 fields), typed numbers/enums/short-strings. No free-form HTML or CSS. No strings containing code.

## 6 · Rendering architecture

### 6.1 Client dispatcher

Replaces `WidgetFrame` (iframe) with a React component tree:

```
shared/widget-v2/
├── dispatcher.js                          # <WidgetV2 family type data />
├── templates/
│   ├── pharma/
│   │   ├── dose-response-curve.js
│   │   ├── pk-half-life-decay.js
│   │   └── ...
│   ├── training/ ...
│   ├── nutrition/ ...
│   ├── evidence/ ...
│   ├── progress/ ...
│   └── calculators/ ...
├── primitives/
│   ├── axis.js                            # shared X/Y axis SVG helpers
│   ├── legend.js                          # shared legend rows
│   ├── slider.js                          # shared slider input
│   ├── stat-card.js                       # shared big-number card
│   └── follow-up-chips.js                 # shared chip row with sendPrompt
└── tokens.css                             # per-palette CSS vars alias layer
```

Each template is ≤ 150 lines of React. Pure SVG output. No Chart.js import anywhere in the v2 tree. Shared primitives account for most lines; each template glues primitives + handles its specific data shape.

### 6.2 No iframe

Widgets render inline in the chat message DOM. Benefits:

- Instant theme flip (CSS var cascade, no srcDoc reload)
- No 70 KB Chart.js CDN fetch
- No postMessage bridge for resize
- No sandbox boundary for `sendPrompt` (direct React event handler)
- Accessibility — one document, one focus order, screen readers work naturally
- No `connect-src 'none'` CSP — the chat page's own CSP applies

Risk: widget code now runs in the main document. Mitigation:
- No `dangerouslySetInnerHTML` anywhere in v2 templates
- No user-controlled `href`/`src` attributes
- Data comes from the validated tool call (JSON), so injection surface is zero

### 6.3 Parser integration

`shared/widget-fence-parser.js` adds two new segment types:

```js
// { type: "widget-v2", content: { family, type, data } }
// existing: "widget" (legacy HTML), "workout-plan", "meal-plan", "nutrition-log-confirm", "text"
```

`LLMResponse` in `shared/emersus-renderer.js` dispatches to `<WidgetV2>` for the new type. Legacy HTML widgets continue via `WidgetFrame` until deprecated.

### 6.4 SSE stream contract

`stream.js` gains the ability to forward validated tool output for the six new tools directly as `{ type: "widget-v2", family, type, data }` events. No changes to prose/existing-tool flow.

## 7 · Interactivity model

Local React state + sendPrompt for follow-ups. Server stays idle during interaction.

### 7.1 Local state

Each template component manages its own `useState` for interactive inputs (sliders, toggles). Changes trigger a re-render of the SVG. Example (`dose_response_curve`):

```jsx
function DoseResponseCurve({ data }) {
  const [dose, setDose] = useState(data.default_dose ?? data.ec50);
  const [bw, setBw] = useState(data.default_body_weight_kg ?? 75);
  const saturation = computeSaturation(dose, bw, data);
  return (
    <Card>
      <SigmoidSvg curves={data.curves} highlight={{ x: dose, y: saturation }} />
      <Slider value={dose} onChange={setDose} min={1} max={25} unit="g/day" />
      <Slider value={bw} onChange={setBw} min={40} max={130} unit="kg" />
      <StatRow stats={[...]} />
      <FollowUpChips chips={data.follow_up_chips} />
    </Card>
  );
}
```

### 7.2 sendPrompt contract (unchanged in semantics)

`follow_up_chips` array on every template. Each chip is a string that, when clicked, calls `window.sendPrompt(chip_text)`. In v2, this is a direct React handler (no postMessage — no iframe).

### 7.3 postMessage opt-in contract

For host-owned actions (save, copy-as-image, share, log-result), templates that want these features declare capability:

```typescript
interface WidgetBase {
  ...
  supports?: Array<"save" | "copy-image" | "share" | "log-result">;
}
```

Host renders appropriate buttons in a card footer; clicks call host-side APIs directly (no postMessage since no iframe).

## 8 · System prompt changes

Current `SYSTEM_WIDGET_TOKENS` in `api/emersus/pipeline/prompt.js:64-81` is 18 lines describing the iframe/Chart.js environment. **This block is deleted entirely** post-migration. Template rendering is the client's responsibility; the model only produces typed data.

New guidance injected into each family-tool description (lives in `tools.js`):

```
This tool emits a <family> visual widget. Data-only — you provide structured data,
the client renders.

ALWAYS write 2-4 sentences of prose FIRST, then call this tool.

Widget appears inline in the chat. No HTML to write, no CSS to worry about,
no colors to pick. Use the `type` enum to choose a template; the client handles
rendering, palette, interactivity, and accessibility.

TRIGGER — call this tool when:
<family-specific trigger phrases>

TEMPLATE SELECTION — pick `type` from:
<per-template 1-line descriptions>

CROSS-FAMILY POINTERS:
<see §4.1>

DATA INTEGRITY:
- Every number must come from retrieval context or known physiology — do not fabricate.
- `display_width` is your recommendation to the host; "narrow" tiles 2-up, "medium"
  centers, "wide" fills the chat container.
- `summary` is one short sentence the user reads if they glance without interacting.
- `follow_up_chips` are 1-4 short CTAs (e.g., "Apply to plan", "Show dose-response").
```

### 8.1 Few-shot policy

The 2026-04-16 few-shot removal note (`prompt.js:83-88`) was a response to one prose-only example training the model to skip tool calls. The template system enables safer few-shots because **every example now ends with a tool call** (a typed JSON object), not prose. We will add **1 few-shot per family** (6 total) covering the most common use case for that family. Validated against emission rate — rolled back if emission rate drops.

### 8.2 Prompt cache impact

- Remove: `SYSTEM_WIDGET_TOKENS` (18 lines) from `prompt.js` — saves ~400 tokens always cached
- Add: 6 family-tool descriptions in `tools.js` — costs ~2400 tokens always cached
- Net: ~+2000 cached tokens per turn. At current traffic, negligible dollar cost; no measurable effect on cache hit rate

### 8.3 Review with user

A pre-implementation pass over the proposed tool descriptions (specifically §8 block + per-family trigger wording) happens *before* Phase 2 ships. Changes to trigger phrases have outsized effect on emission rate per the 2026-04-16 lesson — no trigger-phrase changes without a real API call to validate.

## 9 · Migration path

### Phase 0 — deploy infrastructure (no user-visible change)

- Add `shared/widget-v2/` tree with dispatcher + first 6 templates (one per family) + all primitives
- Add 6 family tools to `tools.js` behind a feature flag (`WIDGET_V2_ENABLED=false`)
- Add validators for 6 templates
- Add `widget-v2` segment handling in `widget-fence-parser.js` and `emersus-renderer.js`
- Add SSE event type in `stream.js`

Acceptance: all existing tests pass; new v2 dispatch path has unit tests against sample payloads.

### Phase 1 — expand template coverage behind flag

- Implement remaining 48 templates
- Each template ships with a JSON schema + React component + unit test + sample payload
- Telemetry for v2: log every emission (type, family, size, render time)
- Parallel rendering: feature flag on for a small user cohort (1%)

Acceptance: 48+ templates rendering correctly; zero regressions in legacy path.

### Phase 2 — switch default routing to v2

- System prompt updates: `SYSTEM_WIDGET_TOKENS` removed, new family-tool descriptions deployed
- `emit_widget` tool description updated: "Use this ONLY when no family template fits. New visuals are emitted via `emit_*_widget`."
- Few-shots per family deployed
- Feature flag moved to 100%
- Emit rate measured daily

Acceptance: **7-day rolling** emission rate > 90% on widget-worthy prompts (baseline: prompts containing trigger phrases from §8 or historical emit_widget-requiring patterns); silent gap P50 < 1.5 s measured over same window; no user-reported regressions.

### Phase 3 — soak + deprecate emit_widget

- Two-week soak at 100% v2
- Monitor fallback rate: `emit_widget` calls / (emit_widget + emit_*_widget calls) over 7-day rolling window; should drop toward zero
- When legacy-fallback < 2% of total widget tool calls, remove `emit_widget` tool from `tools.js`
- Delete `WidgetFrame` iframe code path and `EMERSUS_THEME_CSS` block from `emersus-renderer.js`

Acceptance: zero references to `emit_widget` in prompt or code; baseline latency metrics achieved.

## 10 · Metrics + telemetry

New table `widget_v2_emission_events` logs each v2 emission:

```sql
CREATE TABLE widget_v2_emission_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  thread_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  family TEXT NOT NULL,
  type TEXT NOT NULL,
  output_tokens INT,
  elapsed_ms INT,
  prose_end_to_widget_done_ms INT,
  display_width TEXT,
  validator_result TEXT,                  -- 'valid' | 'invalid:<reason>'
  openai_response_id TEXT
);
```

Daily rollup views:

- `widget_v2_emit_rate_daily` — widgets per widget-worthy prompt (by family)
- `widget_v2_silent_gap_daily` — P50 / P95
- `widget_v2_validator_drops_daily` — invalid count per family/type

Cross-reference against existing `chat_token_usage_events` for adoption curves.

## 11 · Risks + mitigations

| risk | probability | mitigation |
|---|---|---|
| Model emission rate drops after prompt change | medium | Few-shot per family; monitor daily; revert tool descriptions if drop > 5pp |
| Template coverage gaps cause fallback to `emit_widget` | medium | Telemetry on fallback; add templates for top 3 missed shapes per sprint |
| Strict-mode discriminated-union schema hits OpenAI limits | low | Validated pre-ship with a real API call per family tool; if hit, split a family into two |
| In-DOM rendering introduces XSS | very low | No `dangerouslySetInnerHTML`; no user-controlled `href/src`; validated JSON only |
| Breaking existing chat threads | low | Legacy `emit_widget` path preserved until Phase 3; no schema changes to existing tools |
| Client bundle bloat from 54 templates | low | Code-split by family; lazy-import on first use; each template ≤ 150 lines |
| Interactivity quality varies by template | medium | Design review checklist per template (keyboard, screen-reader, slider a11y) |

## 12 · Out of scope

- Mobile-specific layout variations (desktop chat width assumed)
- Widget animations / transitions beyond existing theme-flip
- Server-side rendering of widgets (SSR)
- Saving widgets as standalone assets (export, share link) — deferred to follow-up
- Editing widgets after emission (the model emits, user consumes) — deferred
- Localization of widget labels (English only at launch; i18n is a separate system)

## 13 · Open questions

1. **Chart.js retirement** — once v2 is at 100%, do we remove the Chart.js CDN load from the chat page entirely? Currently it's only used by legacy iframe widgets. Preserve for user-authored widgets? **Proposal: remove post-Phase 3, alongside `WidgetFrame` deletion.**

2. **`emit_meal_plan` + `emit_workout_plan`** — these already use dedicated React widgets (not HTML iframes). Bring them under the v2 umbrella schema-wise (so they get the same `display_width`, `follow_up_chips` treatment)? **Proposal: yes, but as a separate follow-up spec; out of scope for this refactor.**

3. **Dark palette (Graphite·Jade)** — v2 templates use CSS custom props that cascade from the host `data-theme`. No per-theme template variants needed. Confirmed by rendering the mockups — palette flips without re-mount in v2.

4. **Template versioning** — if `dose_response_curve` data schema evolves, how do we handle stored widgets in historical threads? **Proposal: each template schema gets a `v: 1` field; dispatcher picks renderer by `v`. Schema additions are backward-compatible; breaking changes bump `v`.**

## 14 · References

- **Pre-refactor baseline:** `docs/widget-flow-pre-template-refactor.md` (frozen 2026-04-17)
- **Memory entry:** `project_widget_template_refactor.md`
- **Baseline benchmark scripts:** `scripts/bench/widget-latency*.mjs` (local, untracked)
- **Template mockups:** `.superpowers/brainstorm/12234-1776404371/content/f{1..6}*.html` (local, untracked)
- **User picks:** `.widget-gallery/user-picks.md` (local, untracked)
- **OpenAI API reference:** `docs/openai-api-reference.md` §Responses, §strict-mode, §reasoning
- **UX design reference:** `docs/references/ux-reference.md`
- **DVP catalogue:** `docs/references/dvp.py`

---

**End of spec.** Next: implementation plan via `writing-plans` skill.
