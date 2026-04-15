# Frontend Redesign · Phase 4 · Nutrition (`/app/nutrition`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Use checkbox (`- [ ]`) syntax.

**Goal:** Build the new Nutrition page with the **time-aware fuel gauge** (the headline visualization), meal cards (logged + planned), water + supplements micro-strip, `+ Quick log` dropdown, and Plans / Log / Recipes [SOON] / Allergens [SOON] tabs.

**Scope rule:** Reskin + new gauge widget. Existing meal-plan / meal-journal endpoints stay as-is. Macro-target editing already lives on Profile in Phase 6 — Phase 4 only **reads** target values.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "4. Nutrition" + "Behaviors · 3. Nutrition".
**Mockup:** `.superpowers/brainstorm/linear-landing/nutrition.html`. Alts in `macro-variants.html`.
**Prerequisite:** Phases 2+3 shipped. Phase 3 introduced the reusable `<AskEmersusDrawer/>`.

**Branch strategy:** `nutrition_v2` flag. Keep the old page reachable via `?nutrition_v2=0` until Task 12.

---

## File structure

- **New:** `app/nutrition/index-v2.html` (Vite entry; old index.html stays for the v1 path)
- **New:** `app/nutrition/nutrition.js` — page shell + tab routing
- **New:** `shared/nutrition/today-tab.js` — fuel gauge + NEXT UP card + WHY footnote + meals list
- **New:** `shared/nutrition/fuel-gauge.js` — the headline visualization (SVG)
- **New:** `shared/nutrition/water-supplements-strip.js`
- **New:** `shared/nutrition/log-meal-modal.js`
- **New:** `shared/nutrition/quick-log-dropdown.js`
- **New:** `shared/nutrition/plans-tab.js`
- **New:** `shared/nutrition/log-tab.js`
- **New:** `shared/nutrition/coming-soon-tile.js` (reused for Recipes + Allergens)
- **New:** `shared/nutrition-v2.css`
- **New:** `api/emersus/nutrition-day.js` — `GET /api/nutrition/day?date=YYYY-MM-DD` aggregator
- **New:** `api/emersus/nutrition-water.js` — `POST /api/nutrition/water { ml }`
- **New:** `api/emersus/nutrition-supplements.js` — `POST /api/nutrition/supplements { items[] }`
- **Modify:** `server.js` — mount new routers + redirect `/app/nutrition` to v2 when flag on
- **Modify:** `vite.config.js` — register new entry

Optional migration: `supabase/20260420_nutrition_water_supplements.sql` — only if `water_log` / `supplement_log` tables don't yet exist (verify in Task 1).

---

## Task 1: Schema verification + (optional) migration

- [ ] **Step 1:** `\d public.water_log` + `\d public.supplement_log` on prod. If missing, write migration `supabase/20260420_nutrition_water_supplements.sql` with `water_log` (id/user_id/consumed_at/ml) + `supplement_log` (id/user_id/consumed_at/name/amount/unit). Skip if already present.
- [ ] **Step 2:** **DO NOT apply.** User applies via the standard Hetzner runbook before deploy.
- [ ] **Step 3: Commit** `sql(nutrition): water/supplement tables (pending apply)` (skip if already present).

---

## Task 2: Feature flag + page shell

**Files:**
- Modify: `shared/feature-flags.js` (`nutrition_v2` already in KNOWN_FLAGS)
- Create: `app/nutrition/index-v2.html` + `app/nutrition/nutrition.js`
- Modify: `vite.config.js`

- [ ] **Step 1:** `app/nutrition/index-v2.html` — same head as chat/index.html with nutrition-v2.css static link, `<div id="nutrition-root"/>`, loads `app/nutrition/nutrition.js`.
- [ ] **Step 2:** `app/nutrition/nutrition.js` — `<NutritionApp/>` checks `resolveFlag('nutrition_v2')`, redirects to `/app/nutrition/index.html` if off. Reads URL state via shared helpers (parse `?tab=today|plans|log&date=YYYY-MM-DD`).
- [ ] **Step 3:** Render top tab bar (5 tabs, Recipes/Allergens with `[SOON]` badge + tooltip `SHIPPING Q3 2026`).
- [ ] **Step 4:** Tab change → push state → lazy-import the matching panel module.
- [ ] **Step 5: Commit** `feat(nutrition-v2): page shell + tab routing`

---

## Task 3: Nutrition-day aggregator endpoint

**Files:**
- Create: `api/emersus/nutrition-day.js`
- Create: `tests/unit/api/emersus/nutrition-day.test.js`
- Modify: `server.js`

- [ ] **Step 1:** `GET /api/nutrition/day?date=YYYY-MM-DD` — `requireAuth`. Returns:
  ```ts
  {
    consumed: { kcal, protein_g, carbs_g, fat_g, water_ml, supplements: [...] },
    planned:  { kcal, protein_g, carbs_g, fat_g },
    target:   { kcal, protein_g, carbs_g, fat_g, water_ml },
    meals:    [{ id, type, name, eaten_at?, planned_at?, kcal, protein_g, carbs_g, fat_g, ingredients: [...] }],
    pace_zone_start: 0.42,
    pace_zone_end:   0.58,
    predicted_target_time: "18:30",
    why_insight: "Lunch came in at 680 kcal, 100 over the planned rice bowl."
  }
  ```
- [ ] **Step 2:** Pure helpers (testable):
  - `computePaceZone({ targetKcal, eatingWindow, now })` → `{ start, end }` (% of target).
  - `computeWhyInsight({ meals, planned, consumed })` → string (rule-based, not LLM).
- [ ] **Step 3:** Mount + commit `feat(nutrition-v2): /api/nutrition/day aggregator`

---

## Task 4: Time-aware fuel gauge

**Files:**
- Create: `shared/nutrition/fuel-gauge.js`
- Create: `tests/unit/shared/nutrition/fuel-gauge.test.js`

- [ ] **Step 1:** Pure layout helpers — `mealDotsLayout({ meals, eatingWindow, axisWidth })` returns `[{ x, size, kcal, label, planned }]`. `paceZoneRect(...)` returns `{ x, width }` for the diagonal-hatched band.

- [ ] **Step 2:** `<FuelGauge data/>` — SVG (themable):
  - Header row: 38px kcal number · delta chip · `● ON TRACK · TARGET BY 6:30 PM · +1 MEAL` predictive status.
  - Timeline: meal dots above the bar (size ∝ kcal), accent fill bar, hatched on-pace band, vertical `NOW` marker at `Date.now()` mapped to eating-window axis.
  - Axis labels below: `7 AM · 12 PM · NOW · 6:30 PM · 10 PM`.

- [ ] **Step 3:** `<MacroMiniGauge label value target paceZone/>` — repeated for protein/carbs/fat with the same tolerance-band pattern.

- [ ] **Step 4: Commit** `feat(nutrition-v2): time-aware fuel gauge`

---

## Task 5: NEXT UP card + WHY footnote

**Files:**
- Modify: `shared/nutrition/today-tab.js`

- [ ] **Step 1:** `<NextUpCard nextMeal remaining/>` — accent-soft bg. Shows planned vs target macros. If planned kcal > 1.15× remaining target, show amber `⚠ PLANNED DINNER IS {N} KCAL OVER TARGET` + `Suggest lighter option →` button. Click opens `<AskEmersusDrawer/>` (Phase 3) seeded with: `Suggest a lighter dinner — under {X} kcal with at least {Y}g protein...`.

- [ ] **Step 2:** `<WhyFootnote text/>` — muted explanation pulled from the API response.

- [ ] **Step 3: Commit** `feat(nutrition-v2): NEXT UP card + WHY footnote`

---

## Task 6: Water + supplements micro-strip

**Files:**
- Create: `shared/nutrition/water-supplements-strip.js`
- Create: `api/emersus/nutrition-water.js`, `api/emersus/nutrition-supplements.js`
- Modify: `server.js`

- [ ] **Step 1:** Server: `POST /api/nutrition/water { ml }` (auth, validates 1–2000 ml). `POST /api/nutrition/supplements { items: [{ name, amount, unit }] }`.

- [ ] **Step 2:** Client widget: 2 columns. Water column has `+ 250ml` / `+ 500ml` buttons + `1.8L / 3L` counter. Supplements column has `Log creatine` (or whatever's scheduled) + status checklist.

- [ ] **Step 3:** Long-press / `⋯` on a logged entry → edit/delete via the existing meal-journal endpoints (water_log/supplement_log support PATCH/DELETE).

- [ ] **Step 4: Commit** `feat(nutrition-v2): water + supplements micro-strip`

---

## Task 7: Meals list

**Files:**
- Modify: `shared/nutrition/today-tab.js`

- [ ] **Step 1:** Render `data.meals` in chronological order. Logged meals show `⋯` (Edit / Move / Duplicate / Delete). Planned meals show `Log as eaten` (accent — promotes to logged with `eaten_at: now`) + `Swap` (opens AskEmersusDrawer seeded with swap prompt) + `⋯`.

- [ ] **Step 2:** Ingredient list uses native `<details>` `<summary>` (no JS) with the `4 items ⌄` chip.

- [ ] **Step 3: Commit** `feat(nutrition-v2): meals list with logged/planned actions`

---

## Task 8: + Log a meal modal

**Files:**
- Create: `shared/nutrition/log-meal-modal.js`

- [ ] **Step 1:** Modal with: meal type pills, name input, ingredients autocomplete (multi-select from `/api/emersus/foods/search`), time input (defaults now). On save → existing `POST /api/emersus/meal-journal/entries`.

- [ ] **Step 2:** "Describe in plain text" mode toggle — submits to existing nutrition-parser endpoint, returns structured data, populates the form.

- [ ] **Step 3: Commit** `feat(nutrition-v2): log-meal modal`

---

## Task 9: + Quick log dropdown (bottom bar)

**Files:**
- Create: `shared/nutrition/quick-log-dropdown.js`

- [ ] **Step 1:** `<QuickLogDropdown/>` — 4 items (Water +250ml, Meal full, Snack quick, Supplement). Each has a mono hint on the right (`+ 250ML`, `FULL`, `QUICK`, `FROM LIST`). Items wire to existing endpoints / open existing modals.

- [ ] **Step 2:** Bottom bar: `<QuickLogDropdown/>` (left) + `Ask Emersus` button (right, opens drawer seeded with today's nutrition snapshot).

- [ ] **Step 3: Commit** `feat(nutrition-v2): quick-log dropdown + bottom bar`

---

## Task 10: Plans / Log / Coming-soon tabs

**Files:**
- Create: `shared/nutrition/plans-tab.js`, `shared/nutrition/log-tab.js`, `shared/nutrition/coming-soon-tile.js`

- [ ] **Step 1:** Plans: list of saved meal plans (existing endpoint `GET /api/emersus/meal-plans`). Row click → detail view with `Start this plan` / `Duplicate` / `Archive`. `+ New plan` opens the existing meal-plan editor.

- [ ] **Step 2:** Log: paginated 14-at-a-time recent days, each row date · meal count · macros · status pill (green/amber/red per ±5%/+10% bands). Click → navigates to today-tab with that date.

- [ ] **Step 3:** Recipes + Allergens: `<ComingSoonTile/>` with `SHIPPING Q3 2026` copy.

- [ ] **Step 4: Commit** `feat(nutrition-v2): plans/log/coming-soon tabs`

---

## Task 11: nutrition-v2.css

- [ ] **Step 1:** Port nutrition.html mockup CSS into `shared/nutrition-v2.css`, scoped under `[data-nutrition-v2="1"]`.
- [ ] **Step 2:** Audit pass — every selector referenced by JS code.
- [ ] **Step 3: Commit** `feat(nutrition-v2): page styles`

---

## Task 12: Flip default + tag

**Files:**
- Modify: `shared/feature-flags.js` — `DEFAULT_FLAGS.nutrition_v2 = true`
- Modify: `tests/unit/shared/feature-flags.test.js`

- [ ] **Step 1:** Manual QA both flag states.
- [ ] **Step 2:** Flip default + commit `feat(nutrition-v2): default to true`.
- [ ] **Step 3:** `git tag -a redesign-phase-4-nutrition -m "Phase 4 — Nutrition shipped"`

---

## Acceptance criteria

1. Fuel gauge renders with all 4 macro mini-gauges + tolerance bands.
2. NOW marker tracks current time live (re-renders every minute).
3. NEXT UP card flags overage + opens AskEmersusDrawer with the swap prompt.
4. Water `+ 250ml` updates the counter immediately + persists.
5. Quick-log dropdown opens the right modal/endpoint per item.
6. Plans tab lists existing saved plans with no migration needed.
7. Log tab paginates and date-clicks navigate to today-tab.
8. `nutrition_v2=0` falls back to the prior page.

---

## Next: Phase 5 (Progress)
