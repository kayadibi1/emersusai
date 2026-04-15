# Frontend Redesign · Phase 4 · Nutrition (`/app/nutrition`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** Implement the Nutrition page with time-aware fuel gauge as the Today-tab hero, meal cards (logged/planned with `Log as eaten` / `Swap`), water + supplements micro-strip, `+ Quick log` dropdown in the bottom bar, and the Plans / Log / Recipes [SOON] / Allergens [SOON] tabs.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "4. Nutrition" + "Behaviors · 3. Nutrition".
**Mockup:** `.superpowers/brainstorm/linear-landing/nutrition.html` (plus alternatives in `macro-variants.html`).
**Feature flag:** `nutrition_v2`.

## File structure (proposed)

- **New:** `app/nutrition/fuel-gauge.js` — time-aware kcal timeline with meal dots, tolerance band, NOW marker, NEXT UP card
- **New:** `app/nutrition/day-header.js` — day navigation (‹ / ›, TODAY chip, auto-save, ⋯)
- **New:** `app/nutrition/meal-list.js` — logged + planned meals with action buttons
- **New:** `app/nutrition/water-supplements-strip.js` — 2-column quick-log widget
- **New:** `app/nutrition/quick-log.js` — bottom-bar dropdown (Water · Meal · Snack · Supplement)
- **New:** `app/nutrition/plans-tab.js`, `log-tab.js`, `recipes-tab.js`, `allergens-tab.js`
- **New:** `shared/nutrition-v2.css` — page styles + tolerance-band hatched pattern
- **New:** `api/emersus/nutrition-day.js` — `GET /api/nutrition/day?date=<yyyy-mm-dd>` aggregator
- **New:** `api/emersus/nutrition-water.js` — `POST /api/nutrition/water { ml }`
- **New:** `api/emersus/nutrition-supplements.js` — `POST /api/nutrition/supplements { items[] }`
- **Modify:** existing meal/plan endpoints — verify they return the macro shape the fuel gauge expects

## Task outline (~22 tasks)

1. `nutrition_v2` flag gate
2. Day-header component + date navigation (prev/next/TODAY chip)
3. `/api/nutrition/day` aggregator — returns `{ consumed, planned, target, meals[], pace_zone_start, pace_zone_end, predicted_target_time, acute_ratio, chronic_ratio }`
4. Fuel gauge — header (kcal delta, predictive status)
5. Fuel gauge — timeline bar + meal dots (sized by kcal) + hatched tolerance band
6. Fuel gauge — NOW marker + time axis
7. NEXT UP card — planned vs target macros + `Suggest lighter option →` (chat-seed)
8. WHY insight footnote (server-generated, rule-based)
9. Per-macro mini gauges (same tolerance-band pattern)
10. Water strip — `+ 250ml` / `+ 500ml` quick-log
11. Supplements strip — default creatine toggle + `Log creatine` modal
12. Meal list — logged `⋯` + planned `Log as eaten` / `Swap`
13. Ingredient `<details>` chips (native HTML)
14. `+ Log a meal` modal — meal type + name + ingredient autocomplete + time
15. `+ Log a meal` plain-text mode — submits text to LLM for extraction
16. Quick-log dropdown (bottom bar) — Water / Meal / Snack / Supplement
17. Ask Emersus drawer — seeded with today's snapshot
18. Plans tab — list + detail + `Start this plan`
19. Log tab — paginated day rows with status pills
20. Recipes + Allergens coming-soon cards with waitlist button
21. URL persistence — `/app/nutrition?tab=today&date=2026-04-15`
22. Flip flag default

## Acceptance criteria

- Fuel gauge renders for any day with ≥1 meal.
- Empty-state renders for days with 0 meals (no fake data).
- Water + supplement quick-logs persist across reloads.
- Both themes.

## Open questions

- Tolerance band % — default `±5%` of target pace. Configurable in Profile?
- Predictive "target by" time — server-computed heuristic; fallback if not enough data?
