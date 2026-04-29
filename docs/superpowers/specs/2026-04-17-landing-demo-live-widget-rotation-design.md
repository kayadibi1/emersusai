# Landing Demo — Live Widget Rotation

**Status:** approved, ready for plan
**Scope:** `index.html` hero demo (`section.demo-wrap`, `index.html:212-269`) + `shared/landing.css`

## Goal

Replace the current single static Q&A in the landing hero demo with a rotating demo of three prompts, each typed live into the composer, each producing a different **live-built widget** — visibly showing off three distinct product superpowers in ~42 s of screen time.

## Why

The current demo shows one question (protein intake) with one answer + citation card. It proves "we cite our sources" but fails to communicate:
- The product emits **live interactive UI**, not just text
- The model handles **multiple capability domains** (charts, comparisons, interactive tools)
- Sessions are **ongoing conversations**, not one-shots

A rotating, typed-in demo lets a landing-page visitor watch three different prompts → three different widgets materialize in the same frame, telegraphing the full product shape in under a minute.

## Rotation plan

One rotation = one prompt played through. Each ~14 s. Three rotations loop every ~42 s.

### Rotation A — Protein dose-response

**Prompt (typed in):** *"How much protein per day for hypertrophy?"*

**Intro text:** *"The evidence centers on **1.6–2.2 g/kg/day**. Above ~1.6, gains plateau."*

**Widget:** SVG line chart, ~380×180 viewBox.
- X-axis labels: `0.8 · 1.2 · 1.6 · 2.0 · 2.4 g/kg`
- Y-axis: muscle mass Δ (unlabeled units)
- Curve rises steeply 0.8 → 1.6, flattens 1.6 → 2.4
- Dashed vertical at 1.6 marked **PLATEAU**
- One callout dot with label "Diminishing returns"

**Value-fill animation:** line draws left→right (stroke-dashoffset over 900 ms), plateau marker + callout fade in at end.

**Citation pill:** `MORTON ET AL · BR J SPORTS MED · 2018 · HIGH`

**Sidebar highlight:** "Protein intake" (existing item)
**Chrome title:** `emersus.ai — protein intake`
**Thread title:** `Protein intake for hypertrophy`

### Rotation B — Creatine vs. beta-alanine evidence matrix

**Prompt (typed in):** *"Creatine vs. beta-alanine — which actually works?"*

**Intro text:** *"Both work, but not equally. Creatine has the broader, stronger literature."*

**Widget:** Two-column card, 4 rows.
- Columns: `CREATINE` | `BETA-ALANINE`
- Row 1 — Effect size: `d=0.20 strength` | `d=0.18 repeated sprint only`
- Row 2 — Studies: `200+ RCTs` | `40+ RCTs`
- Row 3 — Evidence pill: `HIGH` (green) | `MODERATE` (amber)
- Row 4 — Mechanism: `Phosphocreatine resynthesis` | `Carnosine buffering`

**Value-fill animation:** pills/rows fade + scale in, left column first then right, 80 ms stagger per cell.

**Citation pill:** `KREIDER ET AL · J INT SOC SPORTS NUTR · 2017 · HIGH`

**Sidebar highlight:** slides to "Creatine loading" (existing item)
**Chrome title:** `emersus.ai — creatine vs beta-alanine`
**Thread title:** `Creatine vs. beta-alanine`

### Rotation C — Interactive TDEE + cut macros

**Prompt (typed in):** *"I'm 82 kg and want to cut. What's my TDEE?"*

**Intro text:** *"Mifflin-St Jeor + 1.55 activity multiplier. A 20% cut lands here:"*

**Widget:** Stats card with inputs + outputs.
- Pre-filled input row (auto-types briefly): `82 KG · 178 CM · MODERATELY ACTIVE`
- Large readout: `TDEE 2,630 kcal` → animates to `CUT TARGET 2,100 kcal` (−20%)
- Three macro bars grow from 0: `PROTEIN 165g · CARBS 200g · FAT 65g`

**Value-fill animation:** inputs type in (~40 ms/char), kcal number counts up, then counts down to cut target, then bars grow from 0 to target width.

**Citation pill:** `MIFFLIN-ST JEOR · AM J CLIN NUTR · 1990 · STANDARD`

**Sidebar highlight:** slides to **new item** "Cut macros — 82 kg"
**Chrome title:** `emersus.ai — cut macros`
**Thread title:** `Cutting calories on 82 kg`

## Per-rotation animation sequence

Each rotation runs this choreography:

1. **t=0** — composer input types the prompt char-by-char (~40 ms/char with ±10 ms jitter). Caret blinks.
2. **t+1.2 s after last char** — ⏎ SEND pulses; the typed string translates upward + fades, materializes as a user bubble at the top of the thread.
3. **t+400 ms** — assistant bubble appears with a "thinking" shimmer (three dots).
4. **t+500 ms** — intro text streams in at 14 ms/char (matches existing demo typewriter speed).
5. **t+intro finish** — widget container fades in as **skeleton** (axis lines / empty bars / ghost pills in muted tone). Hold ~200 ms.
6. **t+skeleton** — values animate in (see per-widget specs above).
7. **t+widget settled** — one-line citation pill fades in below widget.
8. **t+1.8 s read pause** — hold, nothing moves.
9. **Thread swap:** sidebar highlight slides to next item (300 ms ease), chrome title + thread title crossfade (250 ms), thread body fades out, composer clears. Next rotation begins.

Total per rotation: ~14 s. Full loop: ~42 s.

## Composer typing + send-flight mechanics

- Typing happens in the existing `.composer-input` slot (`index.html:263`). Placeholder text ("Ask a follow-up…") is replaced on first run with the first prompt typing in.
- A blinking `<span class="composer-caret">` is appended after the last typed char.
- On send: the composer contents translateY(-40px) + opacity 0 over 250 ms, simultaneously a cloned bubble fades in at the user-bubble slot with the same string.
- ⏎ SEND hint on the right side pulses (scale 1.15, accent glow) at the moment of send.

## Sidebar composition

Current sidebar (`index.html:218-231`) has two groups: Today (2 items), Yesterday (3 items). Update to:

**Today:**
- Protein intake *(highlighted in rotation A)*
- Creatine loading *(highlighted in rotation B)*
- **Cut macros — 82 kg** *(highlighted in rotation C — NEW item)*

**Yesterday:**
- Hypertrophy volume
- Sleep & recovery
- Zone 2 protocol

Highlight moves between Today items as rotation advances. Sidebar groups never collapse/expand.

## Reduced-motion fallback

When `prefers-reduced-motion: reduce`:
- Render rotation A (protein / dose-response) in its fully-built end state on first paint
- No typing, no cycling, no thread swaps
- Intro text + widget + citation pill all present and static
- This mirrors the existing pattern at `index.html:736`

## Palette support

New widgets use existing design tokens:
- Curve stroke: `--color-accent-primary`
- Skeleton fills: `--color-border-tertiary` + low-alpha `--color-text-tertiary`
- Evidence pills: existing `--ev-strong-*` / `--ev-moderate-*` families
- Macro bars: reuse `.macro-bar.protein / .carbs / .fat` tokens from the bento section (`index.html:330-334`)

Both Graphite·Jade (dark) and Paper·Royal (light) palettes work automatically.

## Mobile behavior

- `.demo-frame` already scales; widget SVGs use `viewBox` so they reflow.
- Evidence matrix's two columns stack vertically below ~420 px (add breakpoint).
- Composer typing still readable at narrow widths — prompt strings chosen short enough (max ~60 chars).
- Sidebar already hides below ~720 px in existing CSS (verify during implementation).

## File changes

- **`index.html:212-269`** — replace `.demo-main` body with three-rotation DOM (all widgets pre-rendered as hidden siblings, toggled via `data-rotation="a|b|c"`). Update sidebar items. Keep `.demo-frame` and `.demo-chrome` structure.
- **`index.html:672-744`** — replace the typing script with a state-machine orchestrating the per-rotation sequence above. Single async function per phase; top-level loop awaits each rotation.
- **`shared/landing.css`** — add CSS for:
  - Composer caret blink, send-pulse, user-bubble fly-up keyframe
  - Three widget skeleton-to-filled states (SVG stroke-dashoffset for curve, pill fade-scale-stagger, bar width grow with CSS custom properties, number count-up)
  - Sidebar highlight slide transition
  - Thread-swap crossfade on chrome title + thread title + thread body
  - Mobile breakpoint for evidence matrix column stacking

## Implementation constraints

- **No build step.** Follow project convention: raw ESM, no bundler, CSS authored directly in `shared/landing.css`. (Per `CLAUDE.md`.)
- **No external dependencies.** No Chart.js import, no animation library. Pure CSS transitions + SVG + vanilla JS.
- **Single-file HTML edit.** All three widgets live in the DOM at page load; state machine swaps `data-rotation` attribute and data attributes. No dynamic DOM generation beyond swapping text content for the typing effect.
- **Intersection-observer start.** Animation loop starts only when `.demo-wrap` scrolls into view (same pattern as current code at `index.html:738-743`). Keeps landing snappy on first paint.

## Risks

- **Timing coordination.** If value animations kick off while intro text still streams, it reads as chaotic. Mitigate: state machine awaits each phase serially, no parallel animations within a rotation.
- **Content crowding.** Three elements per rotation (text + widget + cite pill) must fit inside the existing `.demo-main` area without forcing scroll. If it overflows on narrow widths, shrink widget max-height and widget typography; do not shrink text.
- **Palette switch mid-loop.** If a user toggles theme during a rotation, currently running CSS animations keep their computed start values. Acceptable — next rotation picks up new palette. Do not add mid-rotation reseed.
- **Mobile readability.** Line chart axis labels can get dense. Drop alternate labels below 520 px.

## Out of scope

- Real Chart.js widgets (stylized SVG only — decided in brainstorming)
- Actual interactive input on the TDEE calculator (looks interactive; does not accept input — it's still a mockup)
- A/B test infrastructure for comparing new demo vs. old (single rollout, no flag)
- Persisting rotation index across page reloads
- Pausing rotation on hover or on user interaction (loop runs continuously once it starts)

## Success criteria

- All three rotations play through cleanly on desktop + mobile, in both palettes
- Full loop completes without visual artifacts (no layout jumps, no orphaned carets, no stuck skeletons)
- Reduced-motion users see rotation A fully built, no cycling
- First-paint performance unchanged (no new network requests, no heavy JS eval; all widgets are inline DOM)
- No TypeScript/linter errors; deploys via webhook on push to `main`
