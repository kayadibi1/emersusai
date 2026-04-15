# Frontend Redesign · Phase 5 · Progress (`/app/progress`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** Build the Progress page with modality filter tabs + period pills, benchmark bars, PR cards, small-multiples lift 1RM, working-weight range plot, cardio HR zones, training-load chart, streak tracker, and drill-down overlays replacing old `/app/progress/session` and `/app/progress/exercise` routes.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "5. Progress" + "Behaviors · 4. Progress".
**Mockup:** `.superpowers/brainstorm/linear-landing/progress.html` (alternatives in `progress-variants.html`).
**Feature flag:** `progress_v2`. Sub-flags `progress_benchmarks` and `progress_training_load` gate those sections until their backends seed.

## File structure (proposed)

- **New:** `app/progress/benchmark-bars.js`
- **New:** `app/progress/pr-cards.js`
- **New:** `app/progress/lift-1rm-multiples.js`
- **New:** `app/progress/lift-range-plot.js`
- **New:** `app/progress/cardio-zone-bars.js`
- **New:** `app/progress/training-load-chart.js`
- **New:** `app/progress/streak-tracker.js`
- **New:** `app/progress/recent-sessions-list.js`
- **New:** `app/progress/drill-down-panel.js` — 540px right-side overlay reused across session/exercise drill
- **New:** `shared/progress-v2.css`
- **New SQL:** `supabase/2026-04-XX_benchmarks.sql` — `benchmarks (metric, experience, low, high, label, source_citation)` + initial seed
- **New:** `api/emersus/progress/*.js` — one handler per data source (benchmarks, prs, lift-1rm, lift-range, cardio-zones, training-load, streak, sessions-recent)

## Task outline (~24 tasks)

1. `progress_v2` flag + filter/period URL persistence
2. Modality filter tabs + period pill group
3. Benchmark bars (gated by `progress_benchmarks` flag) — fallback to flat stat tiles when flag off
4. `benchmarks` table migration + initial seed from literature
5. PR cards component + endpoint
6. Small-multiples component (reusable bar + endpoint)
7. Lift 1RM multiples
8. Working-weight range plot (bench default, picker for squat/deadlift)
9. Cardio HR zone stacked bars (with missing-HR hatched fallback)
10. Training load chart (acute/chronic ratio + safe-zone band) — gated by `progress_training_load`
11. Training-load calc job — server-side rolling-average computation
12. Streak tracker — big number + pulsing flame + 3 sub-stats
13. Streak endpoint — computed on session-write
14. Recent sessions list with modality pills + PR chips
15. Drill-down panel shell (540px right overlay, close = ×/backdrop/Esc)
16. Session drill — per-set breakdown + charts + Ask Emersus seed
17. Exercise drill — per-metric history chart + Ask Emersus seed
18. Redirect `/app/progress/session` + `/app/progress/exercise` → open corresponding drill-down
19. Insight footnote on training load — server-generated, rule-based per Gabbett 2016
20. Both-theme palette audit
21. Empty states for every card (first-run users)
22. Flip flag default
23. Data-pipeline verification — run against a real user's data
24. Tag `redesign-phase-5-progress`

## Acceptance criteria

- Benchmark bars show a band only when the matching `(metric, experience)` row exists; hide otherwise.
- Training-load chart shades 0.8–1.3 safe zone regardless of data.
- Streak respects "any logged session across any modality."
- PR chips match what session-logging flagged.
- Drill-down overlays open from any row click and close on Esc.

## Open questions

- Initial benchmarks seed source → bench/squat/deadlift per gender × experience — use existing strength-standards literature.
- Default metric selection for multiples → user-editable in v2; spec deferred to Profile Preferences.
