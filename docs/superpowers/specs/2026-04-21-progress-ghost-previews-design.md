# Progress Ghost Previews — Design Spec

**Date:** 2026-04-21
**Status:** Approved
**Mockups:** `.superpowers/brainstorm/36180-1776743304/content/ghost-treatments.html`
**Related:** `docs/superpowers/specs/2026-04-16-progress-charts-design.md` (the charts being ghosted)

## Problem

New users on `/app/progress/` see mostly blank space. The four hero chart components — Momentum Cards, Beeswarm Plot, Zone River, Control Chart — all `return null` below their data thresholds. Personal Records and Recent Sessions also silently skip when empty. The result is a page that looks broken for anyone who hasn't logged ≥4 weeks of training.

The existing "Need 4+ weeks of training..." Control-Chart placeholder is the only empty-state in the current page; the other five sections just disappear.

## Goal

Replace null renders with a consistent **muted-ghost preview** that shows what the section will become, indicates the unlock threshold, and deep-links to the action that moves the user toward it. Users should see the full shape of their future dashboard from session zero, not blank space.

## Design decisions locked during brainstorming

| # | Decision | Choice |
|---|---|---|
| 1 | Visual treatment | **Muted** (opacity 0.45 + saturate 0.45, small corner chip, footer row with progress + CTA) — not blurred, not wireframe |
| 2 | Data source | **Hybrid** — synthetic sample at 0 state, user's actual sparse data when `1 ≤ logged < target` |
| 3 | Click behavior | **Deep-link** to `/app/train/` (with modality preset where relevant). Whole card is the affordance |
| 4 | Scope | **Four hero charts + Personal Records + Recent Sessions** (six slots total). Benchmarks stays as-is — it's reference content, not user-data |

## Architecture

A single shared `<ChartGhost>` wrapper component inside `app/progress/progress.js`. No new files.

```jsx
<ChartGhost
  title="Strength trajectory"
  unlockCopy="Unlocks at 3 sessions · you're at 1"
  ctaHref="/app/train/"
  ctaLabel="Log a session →"
  ariaLabel="Strength trajectory, locked. 2 more sessions to unlock. Tap to log a session."
>
  {/* chart-specific ghost content (SVG or mini cards) */}
</ChartGhost>
```

The wrapper owns:
- Muted filter (`opacity: 0.45; filter: saturate(0.45);`)
- Pointer-events disabled on the inner chart content so the whole card is one click target
- `🔒 Preview` chip (top-right, `font: 600 9px JetBrains Mono`)
- Footer row: unlock copy (left) + CTA link (right)
- `<button>` semantics + focus ring matching other interactive cards in `progress.css`
- Keyboard Enter/Space triggers the same navigation as click

Each of the six hidden sections changes from `if (noData) return null;` to `if (noData) return <ChartGhost … />;`.

## Data contract

`/api/progress` gains a `ghost` sub-object on each of the six slots. The server computes `current` + `target` counters and populates `sample` with static demo content at 0-state or the user's sparse data when partially filled.

```json
{
  "personal_records": {
    "items": [/* existing PR rows */],
    "ghost": { "current": 0, "target": 1 }
  },
  "momentum_cards": {
    "items": [/* existing momentum rows */],
    "ghost": {
      "sample": [/* 3 demo cards: BENCH 82.5kg, SQUAT 112kg, DEADLIFT 140kg */],
      "current": 1,
      "target": 3
    }
  },
  "beeswarm": {
    "exercise_name": "...", "sets": [...], "weeks": 12, "total_sets": 24,
    "ghost": {
      "sample": { "exercise_name": "Bench press", "sets": [/* ~12 demo sets */], "weeks": 6 },
      "current": 2,
      "target": 5
    }
  },
  "zone_river": {
    "weeks": [...], "pattern_label": "...",
    "ghost": {
      "sample": { "weeks": [/* 6 demo weeks z1–z5 stacked */], "pattern_label": "POLARIZED" },
      "current": 0,
      "target": 4
    }
  },
  "control_chart": {
    "weeks": [...], "current_acwr": 0.98, "mean_acwr": 1.02, "excursions": 0, "status": "in_control",
    "ghost": {
      "sample": { "weeks": [/* 6 demo weeks with ACWR points + control limits */], "status": "in_control" },
      "current": 1,
      "target": 4,
      "unit": "weeks"
    }
  },
  "recent_sessions": {
    "items": [/* existing session rows */],
    "ghost": { "current": 0, "target": 1 }
  }
}
```

Every slot's `ghost` object carries the same shape: `{ current: number, target: number, unit: "sessions"|"sets"|"cardio sessions"|"weeks", sample?: <slot-specific> }`. The counter names are unified across slots so the client copy-generator has one code path.

**Personal Records and Recent Sessions don't have chart content** — their "sample" is the slot's existing row markup rendered empty and muted (e.g. three PR cards with `—` hero numbers, two dimmed session rows with placeholder titles). They still pass through `<ChartGhost>` so the chip, footer, and CTA are consistent with the chart slots.

**Sample content is static**, shipped in code (not a DB fixture). Defined in a new `shared/progress-ghost-samples.js` exported constant so both server (to return) and client (to render) reference identical values — prevents drift and lets the client fall back to the same sample if the server is an older build. Static samples are:

- Momentum: 3 cards (bench 82.5 kg, squat 112 kg, deadlift 140 kg) each with a 12-point up-right sparkline and benchmark marker
- Beeswarm: 24 demo sets across 6 weeks on "Bench press", RPE 6–9 distribution
- Zone river: 6 weeks of z1–z5 time-in-zone with a visually clear polarized pattern
- Control chart: 6 weeks of ACWR points clustered around 1.0 with both UCL/LCL lines

When `items.length ≥ 1 && < target` (hybrid path), the server computes the partial series using the same functions as the real chart and returns it as `ghost.sample`. The client renders that identically to the static sample — the `ChartGhost` component doesn't care whether the data is synthetic or real-but-sparse.

## Per-slot copy

| Slot | Title | Target | Copy (0 state) | Copy (partial) | CTA | Link |
|---|---|---|---|---|---|---|
| Personal Records | Personal records | 1 session | "Your PRs will appear here" | — | Log a session → | `/app/train/` |
| Momentum Cards | Strength trajectory | 3 sessions | "Unlocks at 3 sessions · you're at 0" | "2 more sessions to unlock" | Log a session → | `/app/train/?modality=lift` |
| Beeswarm | Working weight distribution | 5 sets on one lift | "Unlocks at 5 sets on the same lift" | "3 more sets on bench to unlock" | Log a set → | `/app/train/?modality=lift` |
| Zone River | Heart rate zones | 4 cardio sessions | "Unlocks after 4 cardio sessions" | "2 more cardio sessions" | Log cardio → | `/app/train/?modality=cardio` |
| Control Chart | Training load | 4 weeks | "Unlocks after 4 weeks of training" | "2 more weeks to unlock" | Log a session → | `/app/train/` |
| Recent Sessions | Recent sessions | 1 session | "Your recent sessions will appear here" | — | Log a session → | `/app/train/` |

The partial-state copy is generated client-side by interpolating `ghost.current` and `ghost.target`. Exact template: `"{target − current} more {unit} to unlock"` where `unit` is `sessions`/`sets on {exercise}`/`cardio sessions`/`weeks`.

## Theme + mobile + a11y

**Theme.** All colors come from existing `design-tokens.css` tokens. The muted treatment (`opacity: 0.45 + saturate(0.45)`) works identically across Paper and Mint — no new tokens needed. The `🔒` chip background uses `var(--line)` with `var(--ink)` text.

**Mobile (`max-width: 480px`).** `ChartGhost` footer stacks vertically: unlock copy on top, CTA on the next line, both left-aligned. The inner chart ghost content inherits each chart's existing mobile treatment (from the 2026-04-16 spec) — `ChartGhost` wraps, it doesn't redesign. Tap targets are a minimum 48px high per iOS HIG.

**A11y.** Whole card is a single `<button type="button">` with `aria-label` describing the locked state and the action. Focus ring reuses `--focus-ring` token from `progress.css`. The inner chart content has `aria-hidden="true"` so screen readers don't narrate the sample data.

## Backend work

1. **New `shared/progress-ghost-samples.js`** — isomorphic module exporting the four static sample objects.
2. **`api/progress/index.js` (or equivalent handler):** after computing each of the six slots, append the `ghost` object. For the hybrid path (beeswarm/momentum/zone-river/control-chart with `1 ≤ logged < target`), reuse the existing compute functions but skip the threshold gate so we get partial series.
3. **No new SQL.** Existing queries already return partial counts; we just surface them.

## Frontend work

1. **`app/progress/progress.js`:** add `<ChartGhost>` component (~40 lines). Change six `return null` paths to `return <ChartGhost …>{sampleContent}</ChartGhost>`. The sample content for each chart is the existing SVG helper from `shared/progress-charts.js` called with `ghost.sample` — the helpers don't know or care that the data is a ghost.
2. **`shared/progress.css`:** add `.pg-chart-ghost`, `.pg-chart-ghost-inner`, `.pg-chart-ghost-chip`, `.pg-chart-ghost-footer`, `.pg-chart-ghost-cta` rules. ~50 lines of CSS. Mobile media query at `@media (max-width: 480px)` for the footer stack.

## Out of scope

- Animated transitions from ghost → real chart when the threshold is crossed. If it feels worth it later, revisit — for now a hard-cut refresh is fine.
- Benchmarks section — it's static reference content (NSCA Essentials), not user-data. Leave alone.
- Illustrated empty states (mascot, hand-drawn). Too whimsical for the product's current voice.
- Per-user dismissal of ghosts. User should never want to hide the thing telling them what to do next.
- Gamification layer (streaks, badges) beyond the existing Consistency widget. Scope creep.

## Test plan

- Zero-session user: all six ghosts render with static sample content, correct copy, clickable to `/app/train/`.
- Partial (1–2 sessions): momentum shows user's 1–2 actual points in the muted style; PR/Recent Sessions unlock (since their target is 1); beeswarm/zone-river/control-chart still show ghosts.
- Threshold crossed: each section flips from ghost to full chart on the next `/api/progress` load.
- Paper + Mint themes: muted treatment legible in both; chip and CTA contrast ≥ 4.5:1.
- Mobile (375px): footer stacks, card stays tappable, no horizontal scroll.
- Keyboard: Tab reaches each ghost card, Enter/Space navigates, focus ring visible.
- Screen reader: `aria-label` announced as a single button; inner SVG silent.
- No regressions on users who already see full charts — the `ghost` field is ignored when data ≥ threshold.
