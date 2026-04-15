# Frontend Redesign · Phase 5 · Progress (`/app/progress`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Goal:** Build the new Progress page with modality filter tabs + period pills, benchmark bars (literature-backed typical ranges), PR cards, small-multiples lift 1RM, working-weight range plot, cardio HR zones, training-load chart, streak tracker, and drill-down overlays replacing the old `/app/progress/session` + `/app/progress/exercise` routes.

**Scope rule:** This phase is **structural + new visualizations**. The existing 8 analytics RPCs (session-stats, exercise-history, etc.) stay as-is. **Benchmark seeding is a hard prereq** — Tasks 3+4 are flag-gated until a `benchmarks` table is populated.

**Spec:** § "5. Progress" + "Behaviors · 4. Progress".
**Mockup:** `.superpowers/brainstorm/linear-landing/progress.html`. Alts in `progress-variants.html`.
**Prerequisite:** Phases 2+3 shipped (drawer pattern from Phase 3 reused).

**Branch strategy:** `progress_v2` flag. Drill-downs replace `/app/progress/session` + `/app/progress/exercise` only after Task 14.

---

## File structure

- **New:** `app/progress/index-v2.html` + `app/progress/progress.js`
- **New:** `shared/progress/benchmark-bars.js` + `tests/unit/shared/progress/benchmark-bars.test.js`
- **New:** `shared/progress/pr-cards.js`
- **New:** `shared/progress/lift-1rm-multiples.js`
- **New:** `shared/progress/lift-range-plot.js`
- **New:** `shared/progress/cardio-zones.js`
- **New:** `shared/progress/training-load.js`
- **New:** `shared/progress/streak-tracker.js`
- **New:** `shared/progress/recent-sessions.js`
- **New:** `shared/progress/drill-down-panel.js` (right-side 540px slide)
- **New:** `shared/progress-v2.css`
- **New:** `api/emersus/progress.js` — orchestrator that batches benchmarks/prs/lift/cardio/training-load/streak per page-load
- **New:** `api/emersus/progress-benchmarks.js` (pure helper module — literature ranges)
- **New:** `supabase/20260420_benchmarks.sql` — `benchmarks` table + initial seed
- **Modify:** `server.js`, `vite.config.js`

---

## Task 1: Schema — `benchmarks` table + seed

- [ ] **Step 1:** Write migration `supabase/20260420_benchmarks.sql`:
  ```sql
  create table if not exists public.benchmarks (
    id uuid primary key default gen_random_uuid(),
    metric text not null,                         -- 'bench_1rm_kg', 'zone2_minutes_per_week', etc.
    experience text not null check (experience in ('beginner','intermediate','advanced')),
    sex text check (sex in ('male','female','other')),
    body_weight_band text,                        -- '70-80kg', '80-90kg', etc.
    low numeric not null,
    high numeric not null,
    label text not null,                          -- 'typical intermediate'
    source_citation text not null,                -- e.g. 'Schoenfeld 2017'
    unique (metric, experience, sex, body_weight_band)
  );
  ```
  Plus seed rows for the 4 headline metrics × 3 experience levels × {male,female,null sex}. Source citations go to a `benchmarks_seed.csv` reviewable artifact.
- [ ] **Step 2:** **DO NOT apply** — operator applies before deploy.
- [ ] **Step 3: Commit** `sql(progress): benchmarks table + seed (pending apply)`

---

## Task 2: Feature flag + page shell

- [ ] **Step 1:** `app/progress/index-v2.html` + `app/progress/progress.js`. Same shell pattern as Phases 2–4. URL state: `?modality=lift&period=month`.
- [ ] **Step 2:** Modality tabs (All · Lift · Cardio · Swim · Climb · Nutrition) + period pills (Week · Month · 3M · Year). Both persist to URL.
- [ ] **Step 3: Commit** `feat(progress-v2): page shell + filters`

---

## Task 3: `/api/progress` orchestrator

- [ ] **Step 1:** `GET /api/progress?modality=lift&period=month` — single batched response containing benchmarks/prs/lift_1rm/lift_range/cardio_zones/training_load/streak/recent. Each section uses the existing per-feature RPC + new `benchmarks` join.
- [ ] **Step 2:** Pure response shaping helpers (testable). Cache-Control: `private, max-age=60`.
- [ ] **Step 3: Commit** `feat(progress-v2): /api/progress orchestrator`

---

## Task 4: Benchmark bars (flag-gated until seed)

**Files:**
- Create: `shared/progress/benchmark-bars.js`
- Create: `tests/unit/shared/progress/benchmark-bars.test.js`

- [ ] **Step 1:** Pure `computeBarLayout({ value, low, high, axisMax })` → `{ bandX, bandWidth, tickX, status }` where status ∈ `above|within|below`. `axisMax` is per-metric.
- [ ] **Step 2:** `<BenchmarkBars rows/>` — 4 rows, each: label, muted band, ink tick, value, status pill.
- [ ] **Step 3:** Flag-gate behind `progress_benchmarks` (already in KNOWN_FLAGS). When off OR when `rows` is empty for a metric, render the legacy stat tile fallback.
- [ ] **Step 4: Commit** `feat(progress-v2): benchmark bars (flag-gated)`

---

## Task 5: PR cards

- [ ] **Step 1:** `<PrCards prs/>` — 3 accent-soft cards with NEW PR / PR / FIRST tag, exercise, value, delta-from-previous, sparkline (uses existing `shared/progress-charts.js`).
- [ ] **Step 2:** Card click → `<DrillDownPanel kind="pr" id={pr.id}/>` (Task 12).
- [ ] **Step 3: Commit** `feat(progress-v2): PR cards`

---

## Task 6: Lift 1RM small multiples

- [ ] **Step 1:** `<Lift1rmMultiples cards/>` — 3 mini cards (Bench/Squat/Deadlift), each: big 1RM · delta chip · filled-area sparkline.
- [ ] **Step 2:** Card click → drill-down per-set history.
- [ ] **Step 3: Commit** `feat(progress-v2): lift 1rm small multiples`

---

## Task 7: Working-weight range plot

- [ ] **Step 1:** `<LiftRangePlot weeks/>` — 8 vertical bars, min→max worked-weight per week, 1RM tick on each, current week highlighted. Pill picker above (Bench/Squat/Deadlift) — exercise toggle. Uses SVG.
- [ ] **Step 2: Commit** `feat(progress-v2): working-weight range plot`

---

## Task 8: Cardio HR zones

- [ ] **Step 1:** `<CardioZones weeks/>` — 4 stacked weekly bars Z1–Z5, totals below, 5-item legend. Hatched bar + `HR DATA UNAVAILABLE` tooltip when zone_minutes is null for a week.
- [ ] **Step 2: Commit** `feat(progress-v2): cardio HR zones`

---

## Task 9: Training load (acute:chronic)

- [ ] **Step 1:** `<TrainingLoad weeks currentRatio/>` — area chart with acute (accent fill) vs chronic (dashed muted line), 0.8–1.3 safe-zone band, current ratio chip, INSIGHT footnote (server-emitted natural language, NOT LLM).
- [ ] **Step 2:** Pure `classifyTrainingLoad(ratio)` returns `{ band, message }` — testable.
- [ ] **Step 3:** Flag-gate behind `progress_training_load`.
- [ ] **Step 4: Commit** `feat(progress-v2): training load chart`

---

## Task 10: Streak tracker

- [ ] **Step 1:** `<StreakTracker streak/>` — massive `14 ◆` with pulsing flame keyframe, 14-dot streak row, 3 sub-stats (longest ever · total active 2026 · this month %).
- [ ] **Step 2:** When `streak.current === 0`, show `0` muted + `Start a streak today →` accent CTA linking `/app/train`.
- [ ] **Step 3: Commit** `feat(progress-v2): streak tracker`

---

## Task 11: Recent sessions list

- [ ] **Step 1:** `<RecentSessions sessions/>` — 10-row list, color-coded modality pills, PR chips, chevron drill-down.
- [ ] **Step 2:** Row click → `<DrillDownPanel kind="session" id={session_id}/>`.
- [ ] **Step 3: Commit** `feat(progress-v2): recent sessions list`

---

## Task 12: Drill-down panel (right-side 540px)

- [ ] **Step 1:** `<DrillDownPanel open kind id onClose/>` — generic. Lazy-loads `GET /api/sessions/:id` (or per-kind endpoint) on first open. Per-set breakdown, charts specific to kind, `Ask Emersus` button seeded with context.
- [ ] **Step 2:** Close: ×, click-outside, Esc.
- [ ] **Step 3:** Reuses `<AskEmersusDrawer/>` from Phase 3 (mounts in tandem).
- [ ] **Step 4: Commit** `feat(progress-v2): drill-down panel`

---

## Task 13: progress-v2.css

- [ ] **Step 1:** Port progress.html mockup CSS into `shared/progress-v2.css`, scoped `[data-progress-v2="1"]`.
- [ ] **Step 2:** Audit. Commit `feat(progress-v2): page styles`

---

## Task 14: Old-route redirects + flip default + tag

- [ ] **Step 1:** Redirect `/app/progress/session` + `/app/progress/exercise` → `/app/progress?drill=<kind>&id=<id>` (server-side 302).
- [ ] **Step 2:** Flip `DEFAULT_FLAGS.progress_v2 = true`.
- [ ] **Step 3:** Tag `redesign-phase-5-progress`.
- [ ] **Step 4: Commit** `feat(progress-v2): default to true + redirects`

---

## Acceptance criteria

1. All 8 sections render without console errors on both themes.
2. Modality + period filter changes persist to URL + reload correctly.
3. Benchmark bars hide rows where no `benchmarks` row exists for the metric × experience combo.
4. PR cards click → drill panel slides in from right with full history.
5. Streak tracker pulses + clicks through to /app/train when current === 0.
6. Old `/app/progress/{session,exercise}` URLs redirect cleanly.
7. `progress_v2=0` falls back to existing pages.
