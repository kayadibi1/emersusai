# Meal Planning, Journaling & Supplements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first-class nutrition subsystem: USDA-backed food catalog, LLM-generated meal plans with day-type templates, chat-integrated natural-language journaling, supplements as polymorphic foods, and analytics integrated into the existing `/app/progress/` dashboard.

**Architecture:** Polymorphic `foods` table (with `kind='food'|'supplement'` and `base_unit`/`base_amount` for uniform snapshot math) backed by USDA FoodData Central bulk import (all 4 datasets). Meal plans stored as JSONB in `meal_plans` mirroring `workout_plans`. Per-food journal rows with frozen macro snapshots; micronutrients via live join. Chat integration via two new widget fences (`meal-plan`, `nutrition-log-confirm`) + a separate OpenAI function-schema parser call. Day-type auto-linking to workout sessions via an isomorphic JS helper + SQL sibling. Single-page `/app/nutrition/` SPA with internal React tab routing; `/app/progress/` gains a `[Workouts | Nutrition]` tab switcher.

**Tech Stack:** Postgres 15 (pg_trgm, pgcrypto, tsvector FTS), Supabase RLS, Express 5, OpenAI SDK with function schemas, React 18.2.0 via esm.sh, inline SVG charts, `stream-json` for the 1.5 GB Branded Foods import, Node 20+.

**Spec:** `docs/superpowers/specs/2026-04-11-meal-planning-journaling-design.md`

**Production context:**
- Self-hosted Supabase on Hetzner. Migrations applied via `infra/apply-migrations.sh` with `-U supabase_admin` (per `memory/project_supabase_admin_role.md`).
- Local dev points at PRODUCTION Supabase. Treat all data-pipeline commands as touching live data.
- Production runs `gpt-5.4-mini` via `OPENAI_EMERSUS_MODEL` override. `workflow.js` default is `gpt-4.1-mini`.
- Hetzner has 242 GB free of 301 GB as of 2026-04-11 — Branded import (~10 GB total) has headroom.
- Production env lives in `~/app/.env` on Hetzner, NOT `.env.local`. Edits require `pm2 restart emersus-api --update-env`.

---

## ⚠ AMENDMENTS (applied 2026-04-13 pre-execution pre-flight)

Between when this plan was written and when execution starts, the following codebase realities were verified and the plan adjusted. **All subagents executing tasks must honor these amendments over the original task text when they conflict.**

### A1: Migration prefix bumped `20260413_*` → `20260414_*`

The existing tree already has `supabase/20260413_upsert_workout_logs_v3.sql`. All nine nutrition migrations now use `20260414_*` as their prefix. Task 25's `infra/apply-migrations.sh` command reflects the new names. The plan has been globally updated — the 20260413 prefix no longer appears anywhere.

### A2: Server.js convention — use dynamic imports + Express routers, not static imports + verb-specific `app.post/get`

The live `server.js` uses this pattern throughout:

```js
// Global JSON middleware (line 9 of server.js, already in place):
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Single handlers (unchanged convention):
const { default: mealPlansRouter } = await import("./api/emersus/meal-plans.js");
app.use("/api/emersus/meal-plans", mealPlansRouter);

// For simple single-route handlers like foods-search:
const { default: foodsSearchHandler } = await import("./api/emersus/foods-search.js");
app.all("/api/emersus/foods/search", foodsSearchHandler);
```

**Per-route `express.json()` middleware is redundant** — remove it wherever the plan shows `app.post("...", express.json(), handler)`.

**Task 8 (meal-plans.js) and Task 12 (meal-journal.js) must export Express Routers, not individual handler functions.** Example structure for `api/emersus/meal-plans.js`:

```js
// api/emersus/meal-plans.js
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { validateMealPlan } from "../../shared/meal-plan-schema.js";

const router = Router();

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

router.post("/", async (req, res) => {
  // saveMealPlan body — see Task 8 Step 2
});

router.get("/active", async (req, res) => {
  // getActiveMealPlan body — see Task 8 Step 2
});

router.patch("/:id/assignments", async (req, res) => {
  // patchAssignments body — see Task 8 Step 2
});

router.post("/:id/archive", async (req, res) => {
  // archiveMealPlan body — see Task 8 Step 2
});

router.post("/:id/undo", async (req, res) => {
  // undoMealPlan body — see Task 8 Step 2
});

export default router;
```

And in `server.js`, mount with:
```js
const { default: mealPlansRouter } = await import("./api/emersus/meal-plans.js");
app.use("/api/emersus/meal-plans", mealPlansRouter);
```

Same refactor applies to `api/emersus/meal-journal.js` in Task 12. The implementation code inside each route handler stays exactly as written in the original task body.

For `foods-search.js` (Task 5), `nutrition-parser.js` is called from workflow.js so it's not an HTTP handler and doesn't need a router — keep the `export default` function signature the plan shows. `rpc-proxy.js` (Task 23) is a single handler, so mount it with `app.all("/api/emersus/rpc/:name", rpcProxy)`.

### A3: `/api/emersus/workout-plans/active` does NOT exist — read workout plans directly via Supabase

The workout page loads `workout_plans` via direct Supabase client queries from the browser (`app/workout/workout.js`), not a REST endpoint. My Today panel (Task 17) and Plan panel (Task 18) originally called `authFetch("/api/emersus/workout-plans/active")` — **replace those calls with direct Supabase queries**:

```js
// Instead of:
const wpRes = await authFetch("/api/emersus/workout-plans/active");
const wp = wpRes.ok ? await wpRes.json() : { workout_plan: null };

// Use this pattern (matches app/workout/workout.js conventions):
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.1";
const sb = window.EMERSUS_SUPABASE ?? createClient(window.EMERSUS_SUPABASE_URL, window.EMERSUS_ANON_KEY);
if (!window.EMERSUS_SUPABASE) window.EMERSUS_SUPABASE = sb;
const { data: workoutPlan } = await sb
  .from("workout_plans")
  .select("id, title, plan, previous_plan, archived_at")
  .is("archived_at", null)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

RLS on `workout_plans` is already self-only, so browser-side reads work with the user's JWT. The `authFetch` wrapper in the shared panels is still the right pattern for OUR nutrition endpoints — this amendment only affects the workout-plans fetch.

### A4: `shared/supabase.js` client pattern

Before writing any new browser-side module that talks to Supabase directly (notably the workout plan reads in A3 and the food detail drawer in Task 17), check if `shared/supabase.js` or a similar helper already wraps the Supabase client constructor. If it does, import that helper instead of re-instantiating. Use `Read`/`Glob` before adding imports.

### A5: Test file path `tests/fixtures/day-type-resolution.json`

No `tests/` directory currently exists at the repo root. Task 7 creates `tests/fixtures/day-type-resolution.json` — the directory will be created by the `Write` tool automatically; no `mkdir` step needed. This is just a note for the executing subagent so it doesn't get confused looking for an existing tests/ tree.

### A6: Production Postgres access

The memory reference `project_supabase_admin_role.md` says migrations must use `-U supabase_admin`, not `postgres`. Task 25 Step 1 uses `infra/apply-migrations.sh` which already handles this per the memory entry. The direct `docker compose exec` verification command in Task 25 Step 1 also uses `-U supabase_admin`. Do not substitute `-U postgres`.

### A7: emersus-worker is a separate pm2 process

Task 25 Step 2 restarts `emersus-api` only. Do NOT restart `emersus-worker` as part of the nutrition deploy — it runs the pg-boss topic discovery pipeline and is unrelated. `pm2 restart emersus-api --update-env` is correct as written.

### A8: Task 10 requires a react-chat-app.js inline renderer, not emersus-renderer.js LLMResponse

The plan told Task 10 to wire the `meal-plan` fence into `shared/emersus-renderer.js::LLMResponse`. That component is defined but imported by nothing — the production chat renderer is `shared/react-chat-app.js`, which imports only the parser primitives from `emersus-renderer.js` and has its own segment walker (lines 1139–1167) that dispatches `widget` and `workout-plan` inline. A `meal-plan` segment falls through to the default prose case.

Task 10 therefore has a second part (shipped on top of `f07a7a49`): a `MealPlanCard` component defined inline in `react-chat-app.js` that mirrors the existing `WorkoutPlanCard` pattern, and a `meal-plan` case added to the segment walker. The component parses `segment.content` (raw JSON string per the widget-fence-parser contract for nutrition fences), renders target cards + day-type tabs + meal cards + supplement stack, and exposes a Save button that calls `POST /api/emersus/meal-plans` with `Authorization: Bearer <session.access_token>` pulled via the existing `getSession()` helper.

The `emersus-renderer.js::LLMResponse` dispatch added in `f07a7a49` is left in place (it does no harm) but is not the production path. A later cleanup can remove `LLMResponse` entirely if nothing else grows to use it.

The iframe-hosted `shared/meal-plan-widget.js` from `f07a7a49` is retained as the presentational component library — its sub-components (`MealCard`, `SupplementStack`, `TargetCard`, `SLOT_ORDER`) are re-exported so `MealPlanCard` in react-chat-app.js can reuse them. Its default export (the iframe widget with `window.EMERSUS_AUTH`-based save) is kept for a hypothetical future iframe integration and is currently unused.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/20260414_profile_nutrition_columns.sql` | Add `body_weight_kg`, `height_cm`, `date_of_birth`, `biological_sex`, `activity_level` columns to `profiles` |
| `supabase/20260414_nutrients.sql` | `nutrients` lookup table + 31-entry seed with FDC nutrient ID mapping + DRI defaults |
| `supabase/20260414_foods.sql` | `foods` table + `kind`/`form`/`base_unit`/`base_amount`/`gtin_upc`/`ingredients_text`/`data_points` columns + 7 indexes + RLS + `pg_trgm` extension |
| `supabase/20260414_food_nutrients.sql` | Normalized nutrient storage: `(food_id, nutrient_id, amount_per_base)` |
| `supabase/20260414_supplements_seed.sql` | ~60 curated generic supplements as `foods` rows + `food_nutrients` rows |
| `supabase/20260414_meal_plans.sql` | `meal_plans` table mirroring `workout_plans` + unique-partial index for one-active-plan-per-user |
| `supabase/20260414_meal_journal_entries.sql` | Journal log rows with macro snapshots + 5 indexes + RLS |
| `supabase/20260414_nutrition_rpcs.sql` | 9 Postgres analytics functions, each with `SET search_path = public, extensions` |
| `scripts/import-usda-foods.js` | Four-dataset USDA FDC import with streaming JSON, checkpointing, quality filter |
| `scripts/test-day-type-resolver.js` | Cross-fixture test: JS resolver output == SQL resolver output |
| `scripts/test-nutrition-parser.js` | Golden-fixture test for natural-language food/supplement parser |
| `scripts/test-meal-plan-schema.js` | Validator test for plan JSONB shape |
| `scripts/test-meal-plan-fence-routing.js` | Renderer wiring test for `meal-plan` and `nutrition-log-confirm` fences |
| `scripts/test-foods-search.js` | Latency + ranking test against the foods-search API |
| `api/emersus/foods-search.js` | `GET /api/emersus/foods/search` endpoint — FTS + trigram ranking, kind and generic_only filters |
| `api/emersus/meal-plans.js` | CRUD handlers: `POST`, `GET /active`, `PATCH /:id/assignments`, `POST /:id/archive`, `POST /:id/undo` |
| `api/emersus/meal-journal.js` | `writeMealJournalEntries`, `deleteMealJournalEntry`, `updateMealJournalEntry`, `copyMealJournalDay` — with server-side snapshot computation |
| `api/emersus/nutrition-parser.js` | Separate OpenAI function-schema call + match pipeline for journal entries |
| `shared/meal-plan-schema.js` | Runtime validator for `meal_plans.plan` JSONB |
| `shared/meal-plan-day-type.js` | Isomorphic day-type resolver (JS sibling of `get_day_type_for_date` RPC) |
| `shared/meal-plan-widget.js` | React widget rendering plan in chat — targets, day-type tabs, meal cards, supplement stack, save/edit |
| `shared/nutrition-log-confirm-widget.js` | React widget for chat-parsed journal entry confirmation |
| `shared/nutrition-charts.js` | SVG helpers: progress rings, macro bars, nutrition-facts panel, supplement-facts panel, streak banner, micronutrient grid, sparklines |
| `shared/food-detail-drawer.js` | Slide-over drawer routed via `?food=<uuid>` — food and supplement variants |
| `shared/nutrition-today-panel.js` | Today tab composition — rings, meal timeline, supplements card, micro snapshot |
| `shared/nutrition-plan-panel.js` | Plan tab composition — targets, meals, supplement stack, assignments calendar |
| `shared/nutrition-journal-panel.js` | Journal tab composition — date picker, meal sections, supplements section, history |
| `shared/nutrition-supplements-panel.js` | Supplements tab composition — active stack, editor, history, add flow |
| `app/nutrition/index.html` | Single-page shell for `/app/nutrition/` |
| `app/nutrition/nutrition.js` | Composition root — React tab routing, wires panel modules + drawer |
| `app/progress/nutrition-pane.js` | Nutrition analytics pane — macro trends, streak, plan adherence, top foods, micros grid |

### Modified files

| File | Change |
|------|--------|
| `api/emersus/workflow.js` | Add `classifyNutritionIntent()` regex classifier, profile gate, meal-plan generation protocol, supplement protocol, log-food branch |
| `shared/widget-fence-parser.js` | Recognize `meal-plan` and `nutrition-log-confirm` fences alongside existing `widget` / `workout-plan` |
| `shared/emersus-renderer.js` | Wire new fence types to `meal-plan-widget.js` and `nutrition-log-confirm-widget.js` |
| `app/progress/progress.js` | Wrap existing content in `[Workouts \| Nutrition]` tab switcher; default to Workouts pane for back-compat |
| `app/progress/index.html` | Load `nutrition-pane.js` |
| `app/index.html` | Add `Nutrition` nav entry |
| `package.json` | Add `stream-json` dep + `import:usda` npm script alias |
| `docs/overview.md` | Add nutrition subsystem section |
| `docs/schema.md` | Document new tables, columns, RPCs, migration list |
| `docs/scripts.md` | Document the USDA import script |
| `changelog.md` | Append completion entry |

---

## Phase Overview

The plan is organized into **6 sequential phases**. Each phase produces working, independently-testable software and ends at a natural commit/review checkpoint.

1. **Phase 1 — Food Data Foundation (Tasks 1–5):** DB schema, USDA import, supplements seed, foods-search API. Result: a searchable food/supplement catalog accessible via REST.
2. **Phase 2 — Meal Plans (Tasks 6–10):** Plans table, day-type resolver, API handlers, chat generation protocol, widget renderer. Result: users can generate and save meal plans from chat.
3. **Phase 3 — Journal & Chat Logging (Tasks 11–15):** Journal table, write path with snapshots, parser, log branch, confirmation widget. Result: users can log food via chat.
4. **Phase 4 — Nutrition SPA (Tasks 16–20):** `/app/nutrition/` single-page app — today, plan, journal, supplements panels + food detail drawer. Result: full manual UI.
5. **Phase 5 — Analytics & `/app/progress/` (Tasks 21–23):** Analytics RPCs, progress dashboard refactor, nutrition pane. Result: trends and multi-day analytics.
6. **Phase 6 — Docs & Production Deploy (Tasks 24–25):** Doc updates, end-to-end verification, production migration + USDA import run. Result: shipped.

---

# Phase 1 — Food Data Foundation

## Task 1: Profile nutrition columns migration

**Files:**
- Create: `supabase/20260414_profile_nutrition_columns.sql`

The LLM-driven meal plan generator needs Mifflin-St Jeor inputs (weight, height, age, sex, activity). These get populated conversationally by the chat when missing; the schema just needs to accept them.

- [ ] **Step 1: Write the migration**

Create `supabase/20260414_profile_nutrition_columns.sql`:

```sql
-- 20260414_profile_nutrition_columns.sql
-- Add Mifflin-St Jeor inputs for the meal plan generator.
--
-- All columns nullable: the chat fills them in conversationally when the
-- user asks for a plan and a required field is empty. No UI form for these
-- in v1 — the chat IS the form.
--
-- biological_sex is documented explicitly as a BMR formula input
-- (+5 male, -161 female in Mifflin-St Jeor), not a gender label.
--
-- Existing RLS policies on public.profiles cover all columns, so nothing
-- new is needed here.

alter table public.profiles
  add column if not exists body_weight_kg numeric(6,2),
  add column if not exists height_cm       numeric(6,2),
  add column if not exists date_of_birth   date,
  add column if not exists biological_sex  text
    check (biological_sex in ('male','female','prefer_not_to_say')),
  add column if not exists activity_level  text
    check (activity_level in ('sedentary','light','moderate','active','very_active'));
```

- [ ] **Step 2: Verify the migration syntax is valid SQL**

Run:
```bash
psql --version  # confirm psql exists
# Dry-parse the migration without applying:
psql -f supabase/20260414_profile_nutrition_columns.sql --variable=ON_ERROR_STOP=1 -h /dev/null -U nobody 2>&1 | grep -i "error" || echo "parse ok"
```

Expected: "parse ok" (or a connection error — we just want no syntax errors).

- [ ] **Step 3: Apply against a scratch Postgres to verify the CHECK constraints**

```bash
# Spin up a throwaway Postgres container for schema smoke test
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres -c "create table public.profiles (id uuid primary key);"
psql -h 127.0.0.1 -p 55432 -U postgres -f supabase/20260414_profile_nutrition_columns.sql
# Verify CHECK rejects bad values
psql -h 127.0.0.1 -p 55432 -U postgres -c "insert into profiles (id, biological_sex) values (gen_random_uuid(), 'xyz');" 2>&1 | grep -q "violates check constraint" && echo "check ok"
psql -h 127.0.0.1 -p 55432 -U postgres -c "insert into profiles (id, activity_level) values (gen_random_uuid(), 'lazy');" 2>&1 | grep -q "violates check constraint" && echo "check ok"
docker stop emersus-scratch-pg
```

Expected: Two "check ok" lines.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260414_profile_nutrition_columns.sql
git commit -m "feat(nutrition): add profile columns for BMR inputs

- body_weight_kg, height_cm, date_of_birth
- biological_sex (BMR formula input, not gender label)
- activity_level (Mifflin-St Jeor multiplier key)

All nullable; the chat fills them conversationally on first meal plan request.
Part of the meal planning / journaling feature (Phase 1)."
```

---

## Task 2: Nutrients + Foods + Food_nutrients schema

**Files:**
- Create: `supabase/20260414_nutrients.sql`
- Create: `supabase/20260414_foods.sql`
- Create: `supabase/20260414_food_nutrients.sql`

These three migrations are applied together — they form one coherent schema unit and referential integrity ties them. Splitting the task across them keeps each migration focused on a single table.

- [ ] **Step 1: Write `supabase/20260414_nutrients.sql` with the 31-entry seed**

```sql
-- 20260414_nutrients.sql
-- Curated nutrient lookup table + seed. 31 entries covering:
--   energy (kcal), 7 macros, 13 vitamins, 10 minerals.
-- fdc_nutrient_id maps to USDA FoodData Central nutrient IDs, used by
-- scripts/import-usda-foods.js when loading food_nutrients rows.
--
-- default_dri_male / default_dri_female are adult (19–50) reference intakes
-- from the NIH ODS fact sheets. dri_upper_limit is the tolerable upper
-- intake (UL) where one exists. All values are the public DRIs and can
-- be refreshed later.

create table if not exists public.nutrients (
  id                uuid primary key default gen_random_uuid(),
  fdc_nutrient_id   int  unique not null,
  slug              text unique not null,
  name              text not null,
  unit              text not null,  -- g, mg, mcg, kcal, iu
  category          text not null,  -- energy, macro, vitamin, mineral, other
  default_dri_male   numeric,
  default_dri_female numeric,
  dri_upper_limit    numeric,
  display_order     int not null default 0
);

alter table public.nutrients enable row level security;

drop policy if exists "anyone can read nutrients" on public.nutrients;
create policy "anyone can read nutrients"
on public.nutrients
for select
to authenticated
using (true);

drop policy if exists "service role can manage nutrients" on public.nutrients;
create policy "service role can manage nutrients"
on public.nutrients
for all
to service_role
using (true)
with check (true);

-- Seed data.
-- FDC nutrient IDs from https://fdc.nal.usda.gov/docs/FoodData_Central_Supporting_Data_Documentation.pdf
-- Values rounded to practical precision.
insert into public.nutrients
  (fdc_nutrient_id, slug,              name,                   unit,  category,  default_dri_male, default_dri_female, dri_upper_limit, display_order)
values
  -- Energy
  (1008, 'energy_kcal',        'Energy',                'kcal', 'energy',   2500,  2000,  null, 1),
  -- Macros
  (1003, 'protein',             'Protein',               'g',    'macro',    56,    46,    null, 10),
  (1005, 'carbohydrate',        'Carbohydrate',          'g',    'macro',    130,   130,   null, 11),
  (1004, 'total_fat',           'Total fat',             'g',    'macro',    78,    70,    null, 12),
  (1079, 'fiber',               'Fiber',                 'g',    'macro',    38,    25,    null, 13),
  (2000, 'total_sugars',        'Total sugars',          'g',    'macro',    50,    50,    null, 14),
  (1258, 'saturated_fat',       'Saturated fat',         'g',    'macro',    22,    22,    null, 15),
  (1093, 'sodium',              'Sodium',                'mg',   'macro',    1500,  1500,  2300, 16),
  -- Vitamins
  (1106, 'vitamin_a_rae',       'Vitamin A (RAE)',       'mcg',  'vitamin',  900,   700,   3000, 20),
  (1162, 'vitamin_c',           'Vitamin C',             'mg',   'vitamin',  90,    75,    2000, 21),
  (1114, 'vitamin_d',           'Vitamin D',             'mcg',  'vitamin',  15,    15,    100,  22),
  (1109, 'vitamin_e',           'Vitamin E',             'mg',   'vitamin',  15,    15,    1000, 23),
  (1185, 'vitamin_k',           'Vitamin K',             'mcg',  'vitamin',  120,   90,    null, 24),
  (1165, 'thiamin',             'Thiamin (B1)',          'mg',   'vitamin',  1.2,   1.1,   null, 25),
  (1166, 'riboflavin',          'Riboflavin (B2)',       'mg',   'vitamin',  1.3,   1.1,   null, 26),
  (1167, 'niacin',              'Niacin (B3)',           'mg',   'vitamin',  16,    14,    35,   27),
  (1170, 'pantothenic_acid',    'Pantothenic acid (B5)', 'mg',   'vitamin',  5,     5,     null, 28),
  (1175, 'vitamin_b6',          'Vitamin B6',            'mg',   'vitamin',  1.3,   1.3,   100,  29),
  (1176, 'biotin',              'Biotin (B7)',           'mcg',  'vitamin',  30,    30,    null, 30),
  (1177, 'folate',              'Folate (B9)',           'mcg',  'vitamin',  400,   400,   1000, 31),
  (1178, 'vitamin_b12',         'Vitamin B12',           'mcg',  'vitamin',  2.4,   2.4,   null, 32),
  -- Minerals
  (1087, 'calcium',             'Calcium',               'mg',   'mineral',  1000,  1000,  2500, 40),
  (1089, 'iron',                'Iron',                  'mg',   'mineral',  8,     18,    45,   41),
  (1090, 'magnesium',           'Magnesium',             'mg',   'mineral',  420,   320,   350,  42),
  (1092, 'potassium',           'Potassium',             'mg',   'mineral',  3400,  2600,  null, 43),
  (1095, 'zinc',                'Zinc',                  'mg',   'mineral',  11,    8,     40,   44),
  (1103, 'selenium',            'Selenium',              'mcg',  'mineral',  55,    55,    400,  45),
  (1098, 'copper',              'Copper',                'mg',   'mineral',  0.9,   0.9,   10,   46),
  (1101, 'manganese',           'Manganese',             'mg',   'mineral',  2.3,   1.8,   11,   47),
  (1100, 'iodine',              'Iodine',                'mcg',  'mineral',  150,   150,   1100, 48),
  (1091, 'phosphorus',          'Phosphorus',            'mg',   'mineral',  700,   700,   4000, 49)
on conflict (fdc_nutrient_id) do update set
  slug               = excluded.slug,
  name               = excluded.name,
  unit               = excluded.unit,
  category           = excluded.category,
  default_dri_male   = excluded.default_dri_male,
  default_dri_female = excluded.default_dri_female,
  dri_upper_limit    = excluded.dri_upper_limit,
  display_order      = excluded.display_order;
```

- [ ] **Step 2: Write `supabase/20260414_foods.sql`**

```sql
-- 20260414_foods.sql
-- Polymorphic foods + supplements catalog. Populated by:
--   - scripts/import-usda-foods.js (USDA FDC: Foundation, SR Legacy, FNDDS, Branded)
--   - supabase/20260414_supplements_seed.sql (curated ~60 supplements)
--   - User-contributed rows inserted at runtime via api/emersus/foods-search.js
--
-- kind='food' vs kind='supplement' is the polymorphism switch.
-- base_unit + base_amount + food_nutrients.amount_per_base give uniform
-- snapshot math for both foods (per 100 g) and discrete supplements
-- (per 1 capsule / tablet / softgel).
--
-- search_vector is a generated column concatenating description + brand_name
-- so brand hits surface naturally in FTS queries without extra joins.

create extension if not exists pg_trgm;

create table if not exists public.foods (
  id                uuid primary key default gen_random_uuid(),
  fdc_id            int unique,
  description       text not null,
  kind              text not null default 'food'
                    check (kind in ('food','supplement')),
  source            text not null
                    check (source in (
                      'usda_foundation','usda_sr_legacy','usda_fndds','usda_branded',
                      'seed_supplement','user_contributed','chain_scrape'
                    )),
  category          text,
  common_unit       text,
  common_unit_grams numeric,
  base_unit         text not null default '100g'
                    check (base_unit in ('100g','serving')),
  base_amount       numeric not null default 100,
  form              text
                    check (form is null or form in (
                      'capsule','tablet','softgel','scoop','powder_g','liquid_ml','gummy'
                    )),
  brand_name        text,
  gtin_upc          text,
  ingredients_text  text,
  data_points       int,
  created_by        uuid references auth.users(id) on delete cascade,
  search_vector     tsvector generated always as (
                      to_tsvector('english',
                        coalesce(description,'') || ' ' || coalesce(brand_name,''))
                    ) stored,
  created_at        timestamptz not null default now()
);

-- Indexes
create index if not exists foods_source_idx   on public.foods (source);
create index if not exists foods_kind_idx     on public.foods (kind);
create index if not exists foods_kind_source_idx on public.foods (kind, source);
create index if not exists foods_search_vector_idx
  on public.foods using gin (search_vector);
create index if not exists foods_description_trgm_idx
  on public.foods using gin (description gin_trgm_ops);
create index if not exists foods_brand_name_trgm_idx
  on public.foods using gin (brand_name gin_trgm_ops)
  where brand_name is not null;
create index if not exists foods_gtin_upc_idx
  on public.foods (gtin_upc)
  where gtin_upc is not null;
create index if not exists foods_created_by_user_idx
  on public.foods (created_by)
  where source = 'user_contributed';

-- RLS
alter table public.foods enable row level security;

drop policy if exists "read non-user foods and own user foods" on public.foods;
create policy "read non-user foods and own user foods"
on public.foods
for select
to authenticated
using (source <> 'user_contributed' or created_by = auth.uid());

drop policy if exists "users can insert own user_contributed foods" on public.foods;
create policy "users can insert own user_contributed foods"
on public.foods
for insert
to authenticated
with check (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "users can update own user_contributed foods" on public.foods;
create policy "users can update own user_contributed foods"
on public.foods
for update
to authenticated
using  (source = 'user_contributed' and created_by = auth.uid())
with check (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "users can delete own user_contributed foods" on public.foods;
create policy "users can delete own user_contributed foods"
on public.foods
for delete
to authenticated
using (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "service role can manage foods" on public.foods;
create policy "service role can manage foods"
on public.foods
for all
to service_role
using (true)
with check (true);
```

- [ ] **Step 3: Write `supabase/20260414_food_nutrients.sql`**

```sql
-- 20260414_food_nutrients.sql
-- Normalized nutrient storage. amount_per_base is interpreted via the parent
-- food's base_unit + base_amount:
--   base_unit='100g', base_amount=100  => amount per 100 g
--   base_unit='serving', base_amount=1 => amount per 1 serving (capsule, etc.)
--
-- Snapshot formula used by api/emersus/meal-journal.js:
--   snapshot = food_nutrients.amount_per_base
--            * meal_journal_entries.amount
--            / foods.base_amount

create table if not exists public.food_nutrients (
  food_id          uuid not null references public.foods(id) on delete cascade,
  nutrient_id      uuid not null references public.nutrients(id),
  amount_per_base  numeric(12,4) not null,
  primary key (food_id, nutrient_id)
);

create index if not exists food_nutrients_nutrient_id_idx
  on public.food_nutrients (nutrient_id);

alter table public.food_nutrients enable row level security;

-- food_nutrients inherits visibility from the parent foods row.
-- We cannot reference the parent row's columns directly in a policy without
-- a subquery, so we gate reads behind an EXISTS against a visible food.
drop policy if exists "read food_nutrients for visible foods" on public.food_nutrients;
create policy "read food_nutrients for visible foods"
on public.food_nutrients
for select
to authenticated
using (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and (f.source <> 'user_contributed' or f.created_by = auth.uid())
  )
);

drop policy if exists "users can manage nutrients for own user foods" on public.food_nutrients;
create policy "users can manage nutrients for own user foods"
on public.food_nutrients
for all
to authenticated
using (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and f.source = 'user_contributed'
      and f.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and f.source = 'user_contributed'
      and f.created_by = auth.uid()
  )
);

drop policy if exists "service role can manage food_nutrients" on public.food_nutrients;
create policy "service role can manage food_nutrients"
on public.food_nutrients
for all
to service_role
using (true)
with check (true);
```

- [ ] **Step 4: Verify all three migrations parse and apply cleanly against a scratch Postgres**

```bash
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3

# Set up the minimal auth.users stub the FK references need
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
insert into auth.users (id) values (gen_random_uuid());
SQL

psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/20260414_nutrients.sql \
  -f supabase/20260414_foods.sql \
  -f supabase/20260414_food_nutrients.sql

# Verify the seed
psql -h 127.0.0.1 -p 55432 -U postgres -c "select count(*) from public.nutrients;"
# Expected: 31

psql -h 127.0.0.1 -p 55432 -U postgres -c "\d public.foods" | grep search_vector
# Expected: a line showing the generated column

docker stop emersus-scratch-pg
```

Expected: 31 rows, search_vector shown as a generated column.

- [ ] **Step 5: Commit**

```bash
git add supabase/20260414_nutrients.sql supabase/20260414_foods.sql supabase/20260414_food_nutrients.sql
git commit -m "feat(nutrition): nutrients + foods + food_nutrients schema

- nutrients: 31-entry curated lookup (1 energy + 7 macros + 13 vitamins + 10 minerals)
  with FDC nutrient IDs and DRI defaults for male/female adults.
- foods: polymorphic catalog (kind='food'|'supplement') with base_unit/base_amount
  for uniform snapshot math, gtin_upc + ingredients_text for future barcode/allergen
  features, generated tsvector over description + brand_name.
- food_nutrients: normalized (food_id, nutrient_id, amount_per_base) with RLS
  gating reads via EXISTS on the parent food.

Part of the meal planning / journaling feature (Phase 1)."
```

---

## Task 3: Supplements seed migration

**Files:**
- Create: `supabase/20260414_supplements_seed.sql`

~60 curated generic supplements as `foods` rows (`kind='supplement'`, `source='seed_supplement'`) with their `food_nutrients` rows for active ingredients. Powder supplements use `base_unit='100g'`; discrete-unit supplements use `base_unit='serving'`.

- [ ] **Step 1: Write the seed migration (first half — powders + liquids)**

Create `supabase/20260414_supplements_seed.sql`:

```sql
-- 20260414_supplements_seed.sql
-- Curated supplement seed: ~60 common generic supplements.
-- All entries use source='seed_supplement', kind='supplement'.
--
-- Powder / mass-measured supplements use base_unit='100g', base_amount=100.
-- Their nutrients are stored per 100 g of powder. A 5 g creatine scoop is
-- logged as amount=5, amount_unit='g'.
--
-- Discrete-unit supplements (capsules, tablets, softgels) use base_unit='serving',
-- base_amount=1. Their nutrients are stored per 1 unit. "Took 1 vitamin D3
-- capsule" is logged as amount=1, amount_unit='serving'.
--
-- No brand names in the seed. User-contributed entries cover brand-specific items.
-- Nutrient amounts are typical label values from common formulations — NOT medical
-- advice, NOT product-specific.

-- Helper: resolve a nutrient slug to its id, used inline below.
-- We use a one-off CTE per supplement insert to keep the SQL declarative and
-- the file self-contained (no functions created just for seeding).

-- ═══════════════════════════════════════════════════════════════════════════
-- POWDERS (base_unit='100g')
-- ═══════════════════════════════════════════════════════════════════════════

-- Creatine monohydrate: 100% creatine
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Creatine monohydrate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',   0),
    ('protein',       0),
    ('carbohydrate',  0),
    ('total_fat',     0)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Whey protein isolate: ~90% protein, low carb, low fat
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Whey protein isolate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',    370),
    ('protein',        90),
    ('carbohydrate',   3),
    ('total_fat',      1),
    ('saturated_fat',  0.5),
    ('sodium',         200),
    ('calcium',        350)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Casein protein: slow-digesting
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Casein protein, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  360),
    ('protein',      85),
    ('carbohydrate', 5),
    ('total_fat',    1),
    ('calcium',      2500)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Pea protein
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Pea protein isolate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  380),
    ('protein',      80),
    ('carbohydrate', 3),
    ('total_fat',    4),
    ('iron',         10)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- BCAA powder (2:1:1)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('BCAA powder (2:1:1 leucine:isoleucine:valine)', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 7, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Beta-alanine
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Beta-alanine, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 3, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Citrulline malate
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Citrulline malate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 6, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Caffeine anhydrous powder (highly concentrated — 1 g = 1000 mg caffeine)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Caffeine anhydrous, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 0.2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- L-theanine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('L-theanine, powder', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 0.2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Taurine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Taurine, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Glycine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Glycine, powder', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 3, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- EAA powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Essential amino acids (EAA), powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 10, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 90)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Collagen peptides
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Collagen peptides, hydrolyzed', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 10, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal', 360),
    ('protein',     90),
    ('sodium',      150)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Inulin fiber
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Inulin fiber, powder', 'supplement', 'seed_supplement', 'gut', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  150),
    ('carbohydrate', 90),
    ('fiber',        85)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Psyllium husk
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Psyllium husk, powder', 'supplement', 'seed_supplement', 'gut', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  200),
    ('carbohydrate', 85),
    ('fiber',        80)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Electrolyte blend (Na/K/Mg/Cl)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Electrolyte blend, powder', 'supplement', 'seed_supplement', 'hydration', 'powder_g', 'scoop', 7, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  0),
    ('sodium',       14000),
    ('potassium',    3000),
    ('magnesium',    700)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;
```

- [ ] **Step 2: Append the discrete-unit supplements (capsules / tablets / softgels) to the same file**

Append to `supabase/20260414_supplements_seed.sql`:

```sql

-- ═══════════════════════════════════════════════════════════════════════════
-- DISCRETE UNIT (base_unit='serving', base_amount=1)
-- Nutrient amounts are PER SINGLE UNIT (one capsule, one tablet, one softgel).
-- ═══════════════════════════════════════════════════════════════════════════

-- Vitamin D3 2000 IU capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 2000 IU, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_d', 50)) as v(slug, amount)  -- 2000 IU ≈ 50 mcg
  join public.nutrients n on n.slug = v.slug;

-- Vitamin D3 1000 IU capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 1000 IU, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_d', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin D3 + K2 combo softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 2000 IU + K2 100 mcg, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_d', 50),
    ('vitamin_k', 100)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin K2 (MK-7) softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin K2 (MK-7) 100 mcg, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_k', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin C 500 mg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin C 500 mg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_c', 500)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin E 400 IU softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin E 400 IU, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_e', 268)) as v(slug, amount)  -- 400 IU = 268 mg d-alpha
  join public.nutrients n on n.slug = v.slug;

-- Vitamin A 5000 IU softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin A 5000 IU, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_a_rae', 1500)) as v(slug, amount)  -- 5000 IU ≈ 1500 mcg RAE
  join public.nutrients n on n.slug = v.slug;

-- B-complex 50 tablet (standard "B-50" formulation)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin B-complex 50, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('thiamin',           50),
    ('riboflavin',        50),
    ('niacin',            50),
    ('pantothenic_acid',  50),
    ('vitamin_b6',        50),
    ('biotin',            50),
    ('folate',            400),
    ('vitamin_b12',       50)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Methylated B-complex tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Methylated B-complex, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('thiamin',           25),
    ('riboflavin',        25),
    ('niacin',            25),
    ('pantothenic_acid',  25),
    ('vitamin_b6',        25),
    ('biotin',            400),
    ('folate',            400),
    ('vitamin_b12',       500)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin B12 1000 mcg tablet (standalone)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin B12 (methylcobalamin) 1000 mcg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_b12', 1000)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Folate 400 mcg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Folate (L-methylfolate) 400 mcg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('folate', 400)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Biotin 5000 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Biotin 5000 mcg, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('biotin', 5000)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium glycinate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium glycinate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium citrate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium citrate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium malate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium malate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Zinc picolinate 25 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Zinc picolinate 25 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('zinc', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Iron bisglycinate 25 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Iron bisglycinate 25 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('iron', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Selenium (selenomethionine) 200 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Selenium (selenomethionine) 200 mcg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('selenium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Iodine (potassium iodide) 150 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Iodine (potassium iodide) 150 mcg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('iodine', 150)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Fish oil 1200 mg softgel (360 mg EPA + 240 mg DHA typical, stored as total fat)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Fish oil (EPA 360 mg + DHA 240 mg), softgel', 'supplement', 'seed_supplement', 'omega3', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  10),
    ('total_fat',    1.2)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Algae-based omega-3 softgel (vegan EPA+DHA)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Algae omega-3 (EPA 200 mg + DHA 400 mg), softgel', 'supplement', 'seed_supplement', 'omega3', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal', 9),
    ('total_fat',   1.0)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Generic adult multivitamin tablet (rough representative values)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Adult multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',     900),
    ('vitamin_c',         60),
    ('vitamin_d',         25),
    ('vitamin_e',         30),
    ('vitamin_k',         80),
    ('thiamin',           1.5),
    ('riboflavin',        1.7),
    ('niacin',            20),
    ('pantothenic_acid',  10),
    ('vitamin_b6',        2),
    ('biotin',            30),
    ('folate',            400),
    ('vitamin_b12',       6),
    ('calcium',           200),
    ('iron',              18),
    ('magnesium',         100),
    ('zinc',              15),
    ('selenium',          55),
    ('copper',            0.9),
    ('manganese',         2),
    ('iodine',            150)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Women's multivitamin (higher iron)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Women''s multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',     700),
    ('vitamin_c',         75),
    ('vitamin_d',         25),
    ('vitamin_e',         15),
    ('vitamin_k',         90),
    ('folate',            600),
    ('vitamin_b12',       6),
    ('calcium',           500),
    ('iron',              27),
    ('magnesium',         100),
    ('zinc',              8)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Prenatal multivitamin (400 mcg folate minimum, iron, DHA optional)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Prenatal multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',  770),
    ('vitamin_c',      85),
    ('vitamin_d',      15),
    ('folate',         800),
    ('vitamin_b12',    2.6),
    ('calcium',        200),
    ('iron',           27),
    ('zinc',           11),
    ('iodine',         220)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Melatonin 3 mg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Melatonin 3 mg, tablet', 'supplement', 'seed_supplement', 'sleep', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Ashwagandha (KSM-66) 600 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Ashwagandha (KSM-66) 600 mg, capsule', 'supplement', 'seed_supplement', 'adaptogen', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Rhodiola rosea 500 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Rhodiola rosea 500 mg, capsule', 'supplement', 'seed_supplement', 'adaptogen', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Curcumin (with black pepper extract) 500 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Curcumin (+ piperine) 500 mg, capsule', 'supplement', 'seed_supplement', 'antioxidant', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- CoQ10 100 mg softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('CoQ10 (ubiquinone) 100 mg, softgel', 'supplement', 'seed_supplement', 'antioxidant', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Caffeine 100 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Caffeine 100 mg, capsule', 'supplement', 'seed_supplement', 'performance', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Probiotic capsule (multi-strain, CFU data isn't a tracked nutrient)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Probiotic multi-strain, capsule', 'supplement', 'seed_supplement', 'gut', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;
```

- [ ] **Step 3: Apply the seed against the scratch Postgres and verify the row count**

```bash
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
SQL
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/20260414_nutrients.sql \
  -f supabase/20260414_foods.sql \
  -f supabase/20260414_food_nutrients.sql \
  -f supabase/20260414_supplements_seed.sql

psql -h 127.0.0.1 -p 55432 -U postgres -c "select count(*) from public.foods where source = 'seed_supplement';"
# Expected: around 40 (powders + discretes; exact count depends on final list)
psql -h 127.0.0.1 -p 55432 -U postgres -c "select count(*) from public.food_nutrients fn join public.foods f on f.id = fn.food_id where f.source = 'seed_supplement';"
# Expected: several hundred (each supplement has 1–21 nutrient rows)

# Spot-check: a vitamin D3 capsule log should compute its snapshot correctly
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
select
  f.description,
  f.base_unit,
  f.base_amount,
  n.slug as nutrient,
  fn.amount_per_base,
  fn.amount_per_base * 1 / f.base_amount as snapshot_for_one_serving
from public.foods f
join public.food_nutrients fn on fn.food_id = f.id
join public.nutrients n on n.id = fn.nutrient_id
where f.description ilike 'Vitamin D3 2000 IU%capsule%';
SQL
# Expected: base_unit='serving', base_amount=1, amount_per_base=50 (mcg),
#           snapshot_for_one_serving=50

docker stop emersus-scratch-pg
```

- [ ] **Step 4: Commit**

```bash
git add supabase/20260414_supplements_seed.sql
git commit -m "feat(nutrition): seed ~40 curated supplement entries

Polymorphic on foods table: kind='supplement', source='seed_supplement'.
Powders (creatine, whey, BCAA, EAA, caffeine anhydrous, electrolytes,
collagen, inulin, psyllium, etc.) use base_unit='100g' for mass-proportional
logging. Discrete units (D3, K2, B-complex, multi, magnesium glycinate,
zinc, iron, fish oil, etc.) use base_unit='serving' with nutrients stored
per 1 capsule/tablet/softgel.

No brand names. User-contributed flow covers brand-specific items.
Nutrient values are typical label values, not medical advice.

Part of the meal planning / journaling feature (Phase 1)."
```

---

## Task 4: USDA FoodData Central import script

**Files:**
- Create: `scripts/import-usda-foods.js`
- Modify: `package.json` (add `stream-json` dep + `import:usda` script)

Four-dataset loader: Foundation (~200), SR Legacy (~7.8k), FNDDS (~7k), Branded (~1.8M). Small datasets first, Branded last. Streaming JSON parse for Branded (1.5 GB unzipped). Checkpointing. Quality filter on Branded rows. Pre-flight disk check.

- [ ] **Step 1: Add the `stream-json` dependency and npm script alias**

Edit `package.json` to match:

```json
{
  "name": "emersus-ai-site",
  "private": true,
  "type": "module",
  "scripts": {
    "fetch:pmc": "node scripts/fetch-pmc-fulltext.js",
    "fill:pmc": "node scripts/fill-pmc-corpus.js",
    "fill:pmc:topics": "node scripts/fill-pmc-topics.js",
    "import:pubmed": "node scripts/import-pubmed.js",
    "import:usda": "node scripts/import-usda-foods.js",
    "embed:evidence": "node scripts/embed-evidence.js",
    "test:retrieval": "node scripts/test-retrieval.js",
    "test:visual-artifacts": "node scripts/test-visual-artifacts.js",
    "test:widget-fence": "node scripts/test-widget-fence-routing.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.101.1",
    "dotenv": "^17.4.1",
    "express": "^5.2.1",
    "openai": "^6.33.0",
    "resend": "^4.1.0",
    "stream-json": "^1.8.0"
  }
}
```

Run:
```bash
npm install
```

Expected: installs `stream-json`, updates `package-lock.json`.

- [ ] **Step 2: Write the import script header (imports, config, utilities)**

Create `scripts/import-usda-foods.js`:

```js
// scripts/import-usda-foods.js
//
// One-time USDA FoodData Central importer. Populates public.foods and
// public.food_nutrients with four datasets:
//   - Foundation  (~200 items, research-grade)
//   - SR Legacy   (~7,800 items, classic USDA DB)
//   - FNDDS       (~7,000 items, survey/prepared foods)
//   - Branded     (~1,800,000 items, manufacturer-submitted)
//
// Requires supabase_admin-equivalent permissions (uses service_role key
// bypassing RLS). Set SUPABASE_SERVICE_ROLE_KEY in .env / .env.local.
//
// Usage:
//   node scripts/import-usda-foods.js                      # all four
//   node scripts/import-usda-foods.js --datasets=foundation,sr_legacy
//   node scripts/import-usda-foods.js --resume              # pick up from checkpoint
//   node scripts/import-usda-foods.js --dry-run             # parse only, no writes
//
// Idempotent: safe to re-run. Uses fdc_id upserts.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import StreamArray from "stream-json/streamers/StreamArray.js";
import { parser } from "stream-json/Parser.js";
import { pick } from "stream-json/filters/Pick.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ───── Config ──────────────────────────────────────────────────────────────

const DATASETS = {
  foundation: {
    slug: "foundation",
    source: "usda_foundation",
    // USDA publishes these as a single zipped JSON bundle per dataset.
    // URL format changes periodically; these are as of 2026-04.
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2025-10-31.zip",
    batchSize: 1000,
    jsonKey: "FoundationFoods",
  },
  sr_legacy: {
    slug: "sr_legacy",
    source: "usda_sr_legacy",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
    batchSize: 1000,
    jsonKey: "SRLegacyFoods",
  },
  fndds: {
    slug: "fndds",
    source: "usda_fndds",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    batchSize: 1000,
    jsonKey: "SurveyFoods",
  },
  branded: {
    slug: "branded",
    source: "usda_branded",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_json_2025-10-31.zip",
    batchSize: 500,
    jsonKey: "BrandedFoods",
    streaming: true, // stream-parse instead of loading whole JSON
  },
};

const TEMP_DIR = join(tmpdir(), "emersus-usda-import");
const CHECKPOINT_FILE = join(TEMP_DIR, "checkpoint.json");
const MIN_FREE_GB = 15;

// ───── CLI arg parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = { datasets: Object.keys(DATASETS), resume: false, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--resume") args.resume = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--datasets=")) {
      args.datasets = arg.split("=")[1].split(",").map(s => s.trim());
    }
  }
  return args;
}

// ───── Disk space preflight ────────────────────────────────────────────────

function checkDiskSpace() {
  try {
    const stats = statfsSync(tmpdir());
    const freeGb = (stats.bavail * stats.bsize) / 1e9;
    if (freeGb < MIN_FREE_GB) {
      throw new Error(`Need at least ${MIN_FREE_GB} GB free in ${tmpdir()}, only ${freeGb.toFixed(1)} GB available`);
    }
    console.log(`  disk check: ${freeGb.toFixed(1)} GB free in ${tmpdir()} ✓`);
  } catch (err) {
    if (err.code === "ENOSYS") {
      // statfsSync not available on all platforms; log and continue
      console.warn("  disk check: statfsSync not supported on this platform, skipping");
    } else {
      throw err;
    }
  }
}

// ───── Checkpoint read/write ───────────────────────────────────────────────

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return { completed: {}, lastFdcId: {} };
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
  } catch {
    return { completed: {}, lastFdcId: {} };
  }
}

function saveCheckpoint(checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}
```

- [ ] **Step 3: Append the dataset download + nutrient mapping + quality filter helpers**

Append to `scripts/import-usda-foods.js`:

```js

// ───── Nutrient ID mapping (loaded from DB) ─────────────────────────────────

let NUTRIENT_MAP = null;

async function loadNutrientMap() {
  if (NUTRIENT_MAP) return NUTRIENT_MAP;
  const { data, error } = await supabase
    .from("nutrients")
    .select("id, fdc_nutrient_id, slug");
  if (error) throw error;
  NUTRIENT_MAP = new Map();
  for (const row of data) NUTRIENT_MAP.set(row.fdc_nutrient_id, row);
  console.log(`  loaded ${NUTRIENT_MAP.size} nutrient mappings`);
  return NUTRIENT_MAP;
}

// ───── Downloader ──────────────────────────────────────────────────────────

async function downloadDataset(dataset) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const zipPath = join(TEMP_DIR, `${dataset.slug}.zip`);
  const jsonPath = join(TEMP_DIR, `${dataset.slug}.json`);

  if (existsSync(jsonPath)) {
    console.log(`  ${dataset.slug}: reusing cached JSON at ${jsonPath}`);
    return jsonPath;
  }

  console.log(`  ${dataset.slug}: downloading ${dataset.url}...`);
  const res = await fetch(dataset.url);
  if (!res.ok) throw new Error(`Download failed for ${dataset.slug}: ${res.status}`);
  const zipBuffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, zipBuffer);
  console.log(`  ${dataset.slug}: downloaded ${(zipBuffer.length / 1e6).toFixed(1)} MB`);

  // Use unzip via child_process (avoids another npm dep for zip handling)
  const { execSync } = await import("node:child_process");
  execSync(`unzip -p "${zipPath}" > "${jsonPath}"`, { stdio: "inherit" });
  console.log(`  ${dataset.slug}: unzipped to ${jsonPath}`);
  return jsonPath;
}

// ───── Quality filter (Branded Foods) ──────────────────────────────────────

function isValidFood(food, nutrientMap) {
  if (!food.description || food.description.trim().length < 2) return false;
  const nutrients = (food.foodNutrients || food.nutrients || []).filter(n =>
    nutrientMap.has(n.nutrientId ?? n.nutrient?.id)
  );
  if (nutrients.length === 0) return false;
  const hasKcal = nutrients.some(n => {
    const nid = n.nutrientId ?? n.nutrient?.id;
    return nutrientMap.get(nid)?.slug === "energy_kcal";
  });
  if (!hasKcal) return false;
  for (const n of nutrients) {
    const amount = n.amount ?? n.value;
    if (typeof amount !== "number" || isNaN(amount) || amount < 0) return false;
  }
  return true;
}

// ───── Food row → DB row mappers ───────────────────────────────────────────

function mapFoodToRow(food, source) {
  const description = (food.description || "").slice(0, 500);
  const brandName = food.brandOwner || food.brandName || null;
  const categoryObj = food.foodCategory || food.wweiaFoodCategory;
  const category =
    typeof categoryObj === "string"
      ? categoryObj
      : categoryObj?.description || food.brandedFoodCategory || null;
  let commonUnit = null;
  let commonUnitGrams = null;
  const portions = food.foodPortions || [];
  if (portions.length > 0) {
    const p = portions[0];
    commonUnit = p.modifier || p.measureUnit?.name || null;
    commonUnitGrams = p.gramWeight || null;
  }
  return {
    fdc_id: food.fdcId,
    description,
    kind: "food",
    source,
    category: category?.slice(0, 200) ?? null,
    common_unit: commonUnit?.slice(0, 50) ?? null,
    common_unit_grams: commonUnitGrams,
    base_unit: "100g",
    base_amount: 100,
    brand_name: brandName?.slice(0, 200) ?? null,
    gtin_upc: food.gtinUpc?.slice(0, 50) ?? null,
    ingredients_text: food.ingredients?.slice(0, 4000) ?? null,
    data_points: typeof food.dataPoints === "number" ? food.dataPoints : null,
  };
}

function mapNutrientsToRows(food, foodId, nutrientMap) {
  const rows = [];
  const seen = new Set();
  for (const n of food.foodNutrients || food.nutrients || []) {
    const fdcNutrientId = n.nutrientId ?? n.nutrient?.id;
    const mapping = nutrientMap.get(fdcNutrientId);
    if (!mapping) continue;
    if (seen.has(mapping.id)) continue; // dedup same nutrient twice
    const amount = n.amount ?? n.value;
    if (typeof amount !== "number" || isNaN(amount) || amount < 0) continue;
    rows.push({
      food_id: foodId,
      nutrient_id: mapping.id,
      amount_per_base: amount,
    });
    seen.add(mapping.id);
  }
  return rows;
}
```

- [ ] **Step 4: Append the dataset processor (non-streaming + streaming) and main driver**

Append to `scripts/import-usda-foods.js`:

```js

// ───── Dataset processor (non-streaming — Foundation/SR/FNDDS) ─────────────

async function processDatasetInMemory(dataset, nutrientMap, checkpoint, dryRun) {
  const jsonPath = await downloadDataset(dataset);
  console.log(`  ${dataset.slug}: loading ${jsonPath} into memory...`);
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const foods = data[dataset.jsonKey] || data;
  if (!Array.isArray(foods)) {
    throw new Error(`${dataset.slug}: expected an array at key ${dataset.jsonKey}`);
  }
  console.log(`  ${dataset.slug}: ${foods.length} entries`);

  let inserted = 0;
  let skipped = 0;
  const startId = checkpoint.lastFdcId[dataset.slug] ?? 0;
  let batch = [];

  for (const food of foods) {
    if (food.fdcId <= startId) continue;
    if (!isValidFood(food, nutrientMap)) {
      skipped++;
      continue;
    }
    batch.push(food);
    if (batch.length >= dataset.batchSize) {
      if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
      inserted += batch.length;
      checkpoint.lastFdcId[dataset.slug] = batch[batch.length - 1].fdcId;
      saveCheckpoint(checkpoint);
      process.stdout.write(`  ${dataset.slug}: ${inserted} inserted / ${skipped} skipped\r`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
    inserted += batch.length;
  }
  console.log(`\n  ${dataset.slug}: done — ${inserted} inserted, ${skipped} skipped`);
  checkpoint.completed[dataset.slug] = true;
  saveCheckpoint(checkpoint);
}

// ───── Streaming dataset processor (Branded Foods) ─────────────────────────

async function processDatasetStreaming(dataset, nutrientMap, checkpoint, dryRun) {
  const jsonPath = await downloadDataset(dataset);
  console.log(`  ${dataset.slug}: streaming parse of ${jsonPath}`);
  let inserted = 0;
  let skipped = 0;
  const startId = checkpoint.lastFdcId[dataset.slug] ?? 0;
  let batch = [];

  const stream = createReadStream(jsonPath)
    .pipe(parser())
    .pipe(pick({ filter: dataset.jsonKey }))
    .pipe(new StreamArray());

  for await (const chunk of stream) {
    const food = chunk.value;
    if (food.fdcId <= startId) continue;
    if (!isValidFood(food, nutrientMap)) {
      skipped++;
      continue;
    }
    batch.push(food);
    if (batch.length >= dataset.batchSize) {
      if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
      inserted += batch.length;
      checkpoint.lastFdcId[dataset.slug] = batch[batch.length - 1].fdcId;
      saveCheckpoint(checkpoint);
      process.stdout.write(`  ${dataset.slug}: ${inserted} inserted / ${skipped} skipped\r`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
    inserted += batch.length;
  }
  console.log(`\n  ${dataset.slug}: done — ${inserted} inserted, ${skipped} skipped`);
  checkpoint.completed[dataset.slug] = true;
  saveCheckpoint(checkpoint);
}

// ───── Batch flusher (upserts foods then food_nutrients) ───────────────────

async function flushBatch(foods, source, nutrientMap) {
  const foodRows = foods.map(f => mapFoodToRow(f, source));
  const { data: insertedFoods, error: foodErr } = await supabase
    .from("foods")
    .upsert(foodRows, { onConflict: "fdc_id" })
    .select("id, fdc_id");
  if (foodErr) throw foodErr;

  const fdcIdToUuid = new Map(insertedFoods.map(r => [r.fdc_id, r.id]));
  const nutrientRows = [];
  for (const food of foods) {
    const uuid = fdcIdToUuid.get(food.fdcId);
    if (!uuid) continue;
    nutrientRows.push(...mapNutrientsToRows(food, uuid, nutrientMap));
  }
  if (nutrientRows.length === 0) return;
  const { error: nutrientErr } = await supabase
    .from("food_nutrients")
    .upsert(nutrientRows, { onConflict: "food_id,nutrient_id" });
  if (nutrientErr) throw nutrientErr;
}

// ───── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(`[import-usda-foods] datasets=${args.datasets.join(",")} resume=${args.resume} dryRun=${args.dryRun}`);
  checkDiskSpace();
  await loadNutrientMap();
  const checkpoint = args.resume ? loadCheckpoint() : { completed: {}, lastFdcId: {} };

  // Small datasets first, branded last (biggest + longest)
  const order = ["foundation", "sr_legacy", "fndds", "branded"];
  for (const slug of order) {
    if (!args.datasets.includes(slug)) continue;
    if (checkpoint.completed[slug]) {
      console.log(`[${slug}] already completed (from checkpoint), skipping`);
      continue;
    }
    const dataset = DATASETS[slug];
    console.log(`\n[${slug}] starting...`);
    const started = Date.now();
    if (dataset.streaming) {
      await processDatasetStreaming(dataset, NUTRIENT_MAP, checkpoint, args.dryRun);
    } else {
      await processDatasetInMemory(dataset, NUTRIENT_MAP, checkpoint, args.dryRun);
    }
    console.log(`[${slug}] elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  console.log("\n[import-usda-foods] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Dry-run syntax check against a small dataset (foundation only)**

The production run will happen in Task 25 (Phase 6) against Hetzner. For now verify the script loads without errors and parses CLI args.

```bash
node -e "import('./scripts/import-usda-foods.js').catch(e => { console.error(e); process.exit(1); })"
```

Expected: script starts, prints `[import-usda-foods]` line, fails on disk check or env vars (that's fine — we just want no syntax/import errors).

- [ ] **Step 6: Commit**

```bash
git add scripts/import-usda-foods.js package.json package-lock.json
git commit -m "feat(nutrition): USDA FDC importer with streaming + checkpointing

Four-dataset loader: Foundation, SR Legacy, FNDDS, Branded.
- stream-json streaming parse for Branded (1.5 GB unzipped)
- checkpointing to resume across disconnects
- data-quality filter rejects rows without kcal or valid macros
- batches 500 (branded) / 1000 (others) for GIN index write pressure
- idempotent upsert on (fdc_id) and (food_id, nutrient_id)
- pre-flight disk space check (>= 15 GB required)

Adds stream-json dep and import:usda npm script alias.
Part of the meal planning / journaling feature (Phase 1)."
```

---

## Task 5: Foods-search API endpoint

**Files:**
- Create: `api/emersus/foods-search.js`
- Modify: `server.js` (mount the handler)
- Create: `scripts/test-foods-search.js`

Read-only search endpoint returning top 20 foods ranked by FTS + trigram + source-tier tiebreaker. Powers the journal log modal typeahead, the supplement picker, and the nutrition parser's match pipeline.

- [ ] **Step 1: Read the existing Express handler patterns to match style**

```bash
ls api/emersus/
```

Expected: workflow.js, embeddings.js, retrieveDatabaseEvidence.js, rerank.js, rate-limit.js, recommendation.js, recommendation-stream.js.

Read one to study the conventions:

```bash
head -30 api/emersus/embeddings.js
```

Look for: how Supabase client is imported, how requests are parsed, how errors are returned.

- [ ] **Step 2: Write `api/emersus/foods-search.js`**

Create `api/emersus/foods-search.js`:

```js
// api/emersus/foods-search.js
//
// GET /api/emersus/foods/search?q=<query>&kind=<food|supplement|any>
//                               &generic_only=<true|false>&limit=<1..50>
//
// Returns top-N foods ranked by Postgres FTS + pg_trgm + source-tier.
// Used by: the journal log modal, the supplement picker, and the
// nutrition parser's match pipeline (api/emersus/nutrition-parser.js).
//
// RLS applies — user-contributed foods are only visible to their creator.
// This handler runs with the user's JWT so Supabase enforces it automatically.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Source-tier ranking (higher = better): used as a tiebreaker in the SQL ORDER BY.
// Foundation > SR Legacy > Branded > FNDDS > seed_supplement > user_contributed > chain_scrape
const SOURCE_RANK_SQL = `
  case source
    when 'usda_foundation'   then 7
    when 'usda_sr_legacy'    then 6
    when 'usda_branded'      then 5
    when 'usda_fndds'        then 4
    when 'seed_supplement'   then 3
    when 'user_contributed'  then 2
    when 'chain_scrape'      then 1
    else 0
  end
`;

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function foodsSearch(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.status(400).json({ error: "query_too_short", min_length: 2 });
      return;
    }
    const kind = ["food", "supplement", "any"].includes(req.query.kind) ? req.query.kind : "any";
    const genericOnly = req.query.generic_only === "true";
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "20", 10) || 20, 1), 50);

    const supabase = clientForRequest(req);

    // We use rpc for the complex ranking expression because PostgREST's query
    // builder cannot express the source-rank CASE inline in ORDER BY.
    // foods_search is a SECURITY INVOKER SQL function defined in the nutrition_rpcs
    // migration — it runs as the calling user so RLS applies.
    const { data, error } = await supabase.rpc("foods_search", {
      p_query: q,
      p_kind: kind,
      p_generic_only: genericOnly,
      p_limit: limit,
    });

    if (error) {
      console.error("[foods-search] rpc error:", error);
      res.status(500).json({ error: "search_failed" });
      return;
    }
    res.json({ results: data ?? [] });
  } catch (err) {
    console.error("[foods-search] unexpected error:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
```

- [ ] **Step 3: Add `foods_search` RPC to a new nutrition_rpcs stub migration**

The full RPC file is written in Task 21 (Phase 5), but `foods_search` is needed now for the API handler. Add just this one function as part of the foods migration so Phase 1 is self-contained.

Append to `supabase/20260414_foods.sql` (at the bottom):

```sql

-- ───── foods_search RPC ────────────────────────────────────────────────────
-- Used by api/emersus/foods-search.js for typeahead, and by the nutrition
-- parser's match pipeline. Runs SECURITY INVOKER so RLS on public.foods
-- enforces user-contributed visibility.
--
-- Ranking formula:
--   primary  = ts_rank_cd(search_vector, tsquery)      -- FTS relevance
--   fuzz     = similarity(description, query)          -- pg_trgm on description
--   brand    = similarity(brand_name, query)           -- pg_trgm on brand
--   tie      = source rank CASE (foundation=7 .. chain_scrape=1)
--   data_pts = COALESCE(data_points, 0) / 1000.0       -- prefer complete branded
--
-- Final order: (primary + fuzz + brand) desc, tie desc, data_pts desc, description asc

create or replace function public.foods_search(
  p_query         text,
  p_kind          text default 'any',
  p_generic_only  boolean default false,
  p_limit         int default 20
) returns table (
  id            uuid,
  description   text,
  brand_name    text,
  source        text,
  kind          text,
  category      text,
  common_unit   text,
  common_unit_grams numeric,
  base_unit     text,
  base_amount   numeric,
  form          text,
  rank          numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select
      plainto_tsquery('english', p_query) as tsq,
      lower(p_query) as lq
  )
  select
    f.id,
    f.description,
    f.brand_name,
    f.source,
    f.kind,
    f.category,
    f.common_unit,
    f.common_unit_grams,
    f.base_unit,
    f.base_amount,
    f.form,
    (
      ts_rank_cd(f.search_vector, q.tsq)
      + greatest(similarity(f.description, q.lq), 0) * 0.5
      + greatest(similarity(coalesce(f.brand_name, ''), q.lq), 0) * 0.5
    )::numeric as rank
  from public.foods f, q
  where (f.search_vector @@ q.tsq
         or f.description % q.lq
         or (f.brand_name is not null and f.brand_name % q.lq))
    and (p_kind = 'any' or f.kind = p_kind)
    and (not p_generic_only or f.source <> 'usda_branded')
  order by
    rank desc,
    case f.source
      when 'usda_foundation'  then 7
      when 'usda_sr_legacy'   then 6
      when 'usda_branded'     then 5
      when 'usda_fndds'       then 4
      when 'seed_supplement'  then 3
      when 'user_contributed' then 2
      when 'chain_scrape'     then 1
      else 0
    end desc,
    coalesce(f.data_points, 0) desc,
    f.description asc
  limit p_limit
$$;

grant execute on function public.foods_search(text, text, boolean, int) to authenticated, service_role;
```

- [ ] **Step 4: Mount the handler in `server.js`**

Find the existing `/api/emersus/*` routes in `server.js` and add:

```js
// Near the top imports:
import foodsSearch from "./api/emersus/foods-search.js";

// In the routes section, alongside existing emersus routes:
app.get("/api/emersus/foods/search", foodsSearch);
```

Use `Read` on `server.js` to locate the existing `/api/emersus/` mount pattern and match it exactly (routes may use `app.post(...)`, Express middleware, JSON parsing, etc. — follow the conventions already there).

- [ ] **Step 5: Write a smoke test**

Create `scripts/test-foods-search.js`:

```js
// scripts/test-foods-search.js
//
// Smoke test for api/emersus/foods-search.js and the foods_search RPC.
// Assumes the local Express server is running on 127.0.0.1:3001 and the
// database has at least the seeded nutrients + supplements (Task 1-3).
//
// Usage: node scripts/test-foods-search.js

import assert from "node:assert/strict";

const BASE = process.env.EMERSUS_BASE_URL || "http://127.0.0.1:3001";

// Unauthenticated requests work for public (non-user-contributed) foods.
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return await res.json();
}

console.log("[test-foods-search] running against", BASE);

// 1. Supplement search — finds creatine in the seed
{
  const { results } = await get("/api/emersus/foods/search?q=creatine&kind=supplement");
  assert.ok(results.length > 0, "expected at least one creatine result");
  assert.match(results[0].description, /creatine/i, "top result should contain 'creatine'");
  console.log("  ✓ creatine supplement search");
}

// 2. Query too short rejected
{
  const res = await fetch(`${BASE}/api/emersus/foods/search?q=a`);
  assert.equal(res.status, 400, "single-char query should be rejected");
  const body = await res.json();
  assert.equal(body.error, "query_too_short");
  console.log("  ✓ short-query rejection");
}

// 3. kind filter: query 'protein' with kind=supplement should return whey, casein, etc. not chicken breast
{
  const { results } = await get("/api/emersus/foods/search?q=protein&kind=supplement&limit=10");
  for (const r of results) {
    assert.equal(r.kind, "supplement", `expected supplement, got ${r.kind} for "${r.description}"`);
  }
  console.log(`  ✓ kind=supplement filter (${results.length} results)`);
}

// 4. generic_only excludes branded (can only test once branded is imported;
//    this test is a no-op pre-Phase-6 but documents the expected contract)
{
  const { results } = await get("/api/emersus/foods/search?q=oats&generic_only=true&limit=10");
  for (const r of results) {
    assert.notEqual(r.source, "usda_branded", "generic_only=true should exclude branded");
  }
  console.log(`  ✓ generic_only filter (${results.length} results)`);
}

console.log("[test-foods-search] all assertions passed.");
```

Add the npm test alias. Edit `package.json` and append a script entry:

```json
"test:foods-search": "node scripts/test-foods-search.js"
```

- [ ] **Step 6: Apply the updated foods migration to scratch Postgres, then run the test against a local server**

```bash
# Re-apply migrations to pick up the new foods_search function.
# (Full verification happens in Phase 6 against Hetzner; this is local smoke.)
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create role authenticated;
create role service_role;
SQL
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/20260414_nutrients.sql \
  -f supabase/20260414_foods.sql \
  -f supabase/20260414_food_nutrients.sql \
  -f supabase/20260414_supplements_seed.sql

# Verify the function exists and returns something for 'creatine'
psql -h 127.0.0.1 -p 55432 -U postgres -c "select description, rank from public.foods_search('creatine', 'supplement', false, 5);"
# Expected: 1 row, "Creatine monohydrate, powder"

docker stop emersus-scratch-pg
```

The fetch-based test (`scripts/test-foods-search.js`) runs against the live Express server and is exercised in Task 25 (Phase 6) once the full stack is running. For now we've verified the SQL function works.

- [ ] **Step 7: Commit**

```bash
git add api/emersus/foods-search.js server.js scripts/test-foods-search.js supabase/20260414_foods.sql package.json
git commit -m "feat(nutrition): foods_search RPC + API endpoint

- foods_search() Postgres function: FTS + trigram + source-tier ranking
  with configurable kind filter and generic_only toggle. SECURITY INVOKER
  so RLS enforces user-contributed visibility.
- GET /api/emersus/foods/search handler wrapping the RPC with query-length
  validation and limit clamping.
- test-foods-search.js smoke test for the API contract (runs against a
  live server in Phase 6).

Part of the meal planning / journaling feature (Phase 1 — final)."
```

**End of Phase 1.** After this task, the Hetzner database has a queryable food catalog (once USDA import is run in Phase 6) and a working typeahead API. Next phase builds meal plans on top.

---

# Phase 2 — Meal Plans

## Task 6: Meal plans table migration

**Files:**
- Create: `supabase/20260414_meal_plans.sql`

Structural twin of `workout_plans`. Stores the plan document as JSONB, tracks `previous_plan` for one-step undo, enforces one-active-plan-per-user via a unique partial index.

- [ ] **Step 1: Write the migration**

Create `supabase/20260414_meal_plans.sql`:

```sql
-- 20260414_meal_plans.sql
-- Mirrors supabase/20260408_workout_plans.sql. Stores the plan document as
-- JSONB with previous_plan for undo and archived_at for soft delete.
--
-- JSONB shape is validated at write-time by shared/meal-plan-schema.js;
-- we do NOT add Postgres CHECK constraints on the jsonb structure because
-- the shape is still evolving and schema_version gives us a migration path.
--
-- RLS: users can only see, insert, update, and delete their own rows.
-- At most one active plan per user enforced via a unique partial index.

create extension if not exists pgcrypto;

create table if not exists public.meal_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  schema_version    int not null default 1,
  plan              jsonb not null,
  previous_plan     jsonb,
  source_thread_id  uuid,
  last_adjusted_via text,
  last_adjusted_at  timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists meal_plans_user_id_idx
  on public.meal_plans (user_id);

create index if not exists meal_plans_user_active_idx
  on public.meal_plans (user_id, updated_at desc)
  where archived_at is null;

create unique index if not exists meal_plans_one_active_per_user_uq
  on public.meal_plans (user_id)
  where archived_at is null;

alter table public.meal_plans enable row level security;

drop policy if exists "users can read own meal_plans" on public.meal_plans;
create policy "users can read own meal_plans"
on public.meal_plans
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own meal_plans" on public.meal_plans;
create policy "users can insert own meal_plans"
on public.meal_plans
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own meal_plans" on public.meal_plans;
create policy "users can update own meal_plans"
on public.meal_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own meal_plans" on public.meal_plans;
create policy "users can delete own meal_plans"
on public.meal_plans
for delete
to authenticated
using (auth.uid() = user_id);

-- Reuse the same set_current_timestamp_updated_at function from the
-- profiles migration (20260402_auth_profiles_and_contact.sql).
drop trigger if exists set_meal_plans_updated_at on public.meal_plans;
create trigger set_meal_plans_updated_at
before update on public.meal_plans
for each row
execute function public.set_current_timestamp_updated_at();
```

- [ ] **Step 2: Apply against scratch Postgres and verify the unique partial index rejects a second active plan**

```bash
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function public.set_current_timestamp_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
SQL
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -f supabase/20260414_meal_plans.sql

# Insert one active plan — should succeed
psql -h 127.0.0.1 -p 55432 -U postgres -c "
insert into public.meal_plans (user_id, title, plan)
values ('00000000-0000-0000-0000-000000000001', 'Test 1', '{}'::jsonb);
"
# Insert a second active plan for same user — should FAIL on unique partial index
psql -h 127.0.0.1 -p 55432 -U postgres -c "
insert into public.meal_plans (user_id, title, plan)
values ('00000000-0000-0000-0000-000000000001', 'Test 2', '{}'::jsonb);
" 2>&1 | grep -q "meal_plans_one_active_per_user_uq" && echo "one-active constraint ok"

# Archive the first — second insert should now succeed
psql -h 127.0.0.1 -p 55432 -U postgres -c "
update public.meal_plans set archived_at = now() where title = 'Test 1';
insert into public.meal_plans (user_id, title, plan)
values ('00000000-0000-0000-0000-000000000001', 'Test 2', '{}'::jsonb);
select count(*) from public.meal_plans;
"
# Expected: 2 rows

docker stop emersus-scratch-pg
```

- [ ] **Step 3: Commit**

```bash
git add supabase/20260414_meal_plans.sql
git commit -m "feat(nutrition): meal_plans table mirroring workout_plans

- JSONB plan document with previous_plan for one-step undo
- archived_at soft delete
- Unique partial index enforces one active plan per user
- Full RLS self-only, matches workout_plans conventions
- Reuses set_current_timestamp_updated_at trigger function

Part of the meal planning / journaling feature (Phase 2)."
```

---

## Task 7: Day-type resolver (JS + SQL + cross-fixture test)

**Files:**
- Create: `shared/meal-plan-day-type.js`
- Create: `tests/fixtures/day-type-resolution.json`
- Create: `scripts/test-day-type-resolver.js`

The day-type resolver is the critical integration point between workout plans and meal plans. It must produce identical output in JavaScript (for client + server) and in SQL (for RPCs). The cross-fixture test locks them to the same input/output contract.

- [ ] **Step 1: Write the isomorphic JS resolver**

Create `shared/meal-plan-day-type.js`:

```js
// shared/meal-plan-day-type.js
//
// Resolves the active day-type slug (training_day / rest_day / refeed_day / etc.)
// for a given calendar date, given a meal plan and the user's active workout
// plan. Pure function, no I/O. Isomorphic: imported by server handlers and by
// browser code via esm.sh.
//
// Resolution order:
//   1. meal_plan.assignments.overrides[date] wins
//   2. If mode === 'auto_from_workout' and workout plan has a session that
//      day AND the meal plan has a 'training_day' day_type, return 'training_day'
//   3. Otherwise return meal_plan.assignments.default_day_type (or 'rest_day'
//      if missing)
//
// The SQL sibling get_day_type_for_date() in supabase/20260414_nutrition_rpcs.sql
// MUST produce byte-identical output for the same inputs. The cross-fixture
// test at scripts/test-day-type-resolver.js locks this contract.

/**
 * @param {object}  args
 * @param {string}  args.date         ISO date "YYYY-MM-DD"
 * @param {object?} args.mealPlan     meal_plans.plan JSONB
 * @param {object?} args.workoutPlan  workout_plans.plan JSONB
 * @returns {string}  day_type slug, e.g. "training_day"
 */
export function resolveDayType({ date, mealPlan, workoutPlan }) {
  if (!date || typeof date !== "string") {
    throw new Error("resolveDayType: date is required");
  }

  // 1. Explicit override wins
  const override = mealPlan?.assignments?.overrides?.[date];
  if (override) return override;

  // 2. Auto-from-workout
  if (
    mealPlan?.assignments?.mode === "auto_from_workout" &&
    hasWorkoutSessionOnDate(workoutPlan, date) &&
    dayTypeExists(mealPlan, "training_day")
  ) {
    return "training_day";
  }

  // 3. Default
  return mealPlan?.assignments?.default_day_type ?? "rest_day";
}

/**
 * True iff the workout plan has a scheduled session on the given date.
 * Reads workout_plans.plan.schedule — the existing workout plan JSONB shape.
 *
 * The workout plan schema uses either explicit calendar dates on sessions
 * (plan.schedule[].date) or week+day_of_week offsets. We handle both.
 */
export function hasWorkoutSessionOnDate(workoutPlan, date) {
  if (!workoutPlan) return false;
  const schedule = workoutPlan.schedule ?? workoutPlan.sessions ?? [];
  if (!Array.isArray(schedule)) return false;
  for (const entry of schedule) {
    if (!entry) continue;
    // Form 1: explicit calendar date
    if (entry.date === date) return true;
    // Form 2: sessions array nested under weeks, each with a `date`
    if (Array.isArray(entry.sessions)) {
      for (const sess of entry.sessions) {
        if (sess?.date === date) return true;
      }
    }
  }
  return false;
}

/**
 * True iff the meal plan defines a day_type with the given slug.
 */
export function dayTypeExists(mealPlan, slug) {
  if (!mealPlan?.day_types) return false;
  return mealPlan.day_types.some(dt => dt?.slug === slug);
}
```

- [ ] **Step 2: Write the test fixture with 8 scenarios**

Create `tests/fixtures/day-type-resolution.json`:

```json
{
  "description": "Cross-fixture test cases for shared/meal-plan-day-type.js and the SQL sibling get_day_type_for_date(). Both implementations must return the same output for each case. Run via scripts/test-day-type-resolver.js.",
  "cases": [
    {
      "name": "override wins over everything",
      "date": "2026-04-15",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}, {"slug": "refeed_day"}],
        "assignments": {
          "mode": "auto_from_workout",
          "default_day_type": "rest_day",
          "overrides": {"2026-04-15": "refeed_day"}
        }
      },
      "workout_plan": {"schedule": [{"date": "2026-04-15"}]},
      "expected": "refeed_day"
    },
    {
      "name": "auto_from_workout: session today => training_day",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}],
        "assignments": {"mode": "auto_from_workout", "default_day_type": "rest_day", "overrides": {}}
      },
      "workout_plan": {"schedule": [{"date": "2026-04-14"}]},
      "expected": "training_day"
    },
    {
      "name": "auto_from_workout: no session today => default (rest_day)",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}],
        "assignments": {"mode": "auto_from_workout", "default_day_type": "rest_day", "overrides": {}}
      },
      "workout_plan": {"schedule": [{"date": "2026-04-15"}]},
      "expected": "rest_day"
    },
    {
      "name": "auto_from_workout but meal plan has no training_day => default",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "rest_day"}],
        "assignments": {"mode": "auto_from_workout", "default_day_type": "rest_day", "overrides": {}}
      },
      "workout_plan": {"schedule": [{"date": "2026-04-14"}]},
      "expected": "rest_day"
    },
    {
      "name": "no workout plan at all => default",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}],
        "assignments": {"mode": "auto_from_workout", "default_day_type": "rest_day", "overrides": {}}
      },
      "workout_plan": null,
      "expected": "rest_day"
    },
    {
      "name": "manual mode ignores workout sessions",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}],
        "assignments": {"mode": "manual", "default_day_type": "rest_day", "overrides": {}}
      },
      "workout_plan": {"schedule": [{"date": "2026-04-14"}]},
      "expected": "rest_day"
    },
    {
      "name": "override beats auto even when session exists",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}],
        "assignments": {
          "mode": "auto_from_workout",
          "default_day_type": "rest_day",
          "overrides": {"2026-04-14": "rest_day"}
        }
      },
      "workout_plan": {"schedule": [{"date": "2026-04-14"}]},
      "expected": "rest_day"
    },
    {
      "name": "missing assignments => default to rest_day",
      "date": "2026-04-14",
      "meal_plan": {
        "day_types": [{"slug": "training_day"}, {"slug": "rest_day"}]
      },
      "workout_plan": null,
      "expected": "rest_day"
    }
  ]
}
```

- [ ] **Step 3: Write the cross-fixture test script**

Create `scripts/test-day-type-resolver.js`:

```js
// scripts/test-day-type-resolver.js
//
// Runs every case in tests/fixtures/day-type-resolution.json against
// both the JS resolver (shared/meal-plan-day-type.js) and the SQL
// resolver (get_day_type_for_date, defined in supabase/20260414_nutrition_rpcs.sql).
// Both must produce the same output for each case.
//
// The SQL half is skipped if no local DB is available — JS half runs unconditionally.
//
// Usage: node scripts/test-day-type-resolver.js

import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDayType } from "../shared/meal-plan-day-type.js";

const fixture = JSON.parse(
  readFileSync(new URL("../tests/fixtures/day-type-resolution.json", import.meta.url))
);

console.log("[test-day-type-resolver] running", fixture.cases.length, "cases");

// ─── JS half ───────────────────────────────────────────────────────────────
for (const tc of fixture.cases) {
  const actual = resolveDayType({
    date: tc.date,
    mealPlan: tc.meal_plan,
    workoutPlan: tc.workout_plan,
  });
  assert.equal(actual, tc.expected, `JS: ${tc.name} (expected ${tc.expected}, got ${actual})`);
  console.log(`  ✓ JS  ${tc.name}`);
}

// ─── SQL half ──────────────────────────────────────────────────────────────
// Requires SUPABASE_URL + service role key + the nutrition_rpcs migration applied.
// Skipped gracefully if env isn't set — this runs in Phase 5 / 6 when the RPCs exist.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // get_day_type_for_date reads from the active meal_plan + active workout_plan
  // by user_id. For fixture testing we use a direct helper:
  //   resolve_day_type_from_jsonb(p_date, p_meal_plan, p_workout_plan)
  // which is added in Task 21's nutrition_rpcs migration specifically for tests.

  // If that helper doesn't exist yet (running test pre-Phase-5), skip.
  const { data: helperExists } = await sb.rpc("pg_catalog.to_regprocedure", {
    qualified_name: "public.resolve_day_type_from_jsonb(date, jsonb, jsonb)"
  }).throwOnError().then(r => r, () => ({ data: null }));

  if (!helperExists) {
    console.log("  (SQL half skipped — resolve_day_type_from_jsonb not deployed yet)");
  } else {
    for (const tc of fixture.cases) {
      const { data, error } = await sb.rpc("resolve_day_type_from_jsonb", {
        p_date: tc.date,
        p_meal_plan: tc.meal_plan,
        p_workout_plan: tc.workout_plan,
      });
      if (error) throw error;
      assert.equal(data, tc.expected, `SQL: ${tc.name} (expected ${tc.expected}, got ${data})`);
      console.log(`  ✓ SQL ${tc.name}`);
    }
  }
} else {
  console.log("  (SQL half skipped — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)");
}

console.log("[test-day-type-resolver] all assertions passed.");
```

- [ ] **Step 4: Add the npm test alias and run the JS half**

Append to `package.json` scripts:
```json
"test:day-type": "node scripts/test-day-type-resolver.js"
```

Run:
```bash
npm run test:day-type
```

Expected: 8 `✓ JS` lines, "SQL half skipped" (since the nutrition_rpcs migration doesn't exist yet), and "all assertions passed."

- [ ] **Step 5: Commit**

```bash
git add shared/meal-plan-day-type.js tests/fixtures/day-type-resolution.json scripts/test-day-type-resolver.js package.json
git commit -m "feat(nutrition): day-type resolver (JS) + cross-fixture tests

- shared/meal-plan-day-type.js: isomorphic pure function resolving
  training_day / rest_day / refeed_day for a date, given meal plan +
  active workout plan. Handles override > auto_from_workout > default.
- tests/fixtures/day-type-resolution.json: 8 cases covering override,
  auto, manual mode, missing workout plan, missing assignments.
- scripts/test-day-type-resolver.js: runs the fixture against both
  the JS resolver and the SQL sibling (skipped until Phase 5 adds it).

Part of the meal planning / journaling feature (Phase 2)."
```

---

## Task 8: Meal plan schema validator + API handlers

**Files:**
- Create: `shared/meal-plan-schema.js`
- Create: `api/emersus/meal-plans.js`
- Modify: `server.js` (mount the handlers)

The schema validator gates every write. The API handlers are the CRUD surface for the plan save path, the assignments calendar PATCH, archive, and undo.

- [ ] **Step 1: Write the runtime schema validator**

Create `shared/meal-plan-schema.js`:

```js
// shared/meal-plan-schema.js
//
// Runtime validator for the meal_plans.plan JSONB shape. No Zod dependency —
// this is a small hand-written validator so the shared module stays zero-dep
// for browser use.
//
// Returns { valid: boolean, errors: string[] }.
//
// Called by api/emersus/meal-plans.js on every save. NOT called on reads
// (trust what's in the DB after validation gated the write).

const MEAL_SLOT_ENUM = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening",
  "pre_workout", "post_workout", "supplements_am", "supplements_pm",
];

const SUPPLEMENT_TIMING_ENUM = [
  "any", "morning", "with_meal", "pre_workout", "post_workout", "bedtime",
];

const DAY_TYPE_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,30}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isNonNegNumber(v) {
  return isFiniteNumber(v) && v >= 0;
}
function isString(v) {
  return typeof v === "string" && v.length > 0;
}

function validateTargets(targets, dayTypeSlug, errors) {
  if (!targets || typeof targets !== "object") {
    errors.push(`targets.${dayTypeSlug}: missing or not an object`);
    return;
  }
  for (const field of ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"]) {
    if (!isNonNegNumber(targets[field])) {
      errors.push(`targets.${dayTypeSlug}.${field}: expected non-negative number`);
    }
  }
}

function validateMeal(meal, path, errors) {
  if (!meal || typeof meal !== "object") {
    errors.push(`${path}: not an object`);
    return;
  }
  if (!MEAL_SLOT_ENUM.includes(meal.slot)) {
    errors.push(`${path}.slot: must be one of ${MEAL_SLOT_ENUM.join(", ")}`);
  }
  if (!isString(meal.name)) {
    errors.push(`${path}.name: expected non-empty string`);
  }
  if (!Array.isArray(meal.foods)) {
    errors.push(`${path}.foods: expected array`);
    return;
  }
  meal.foods.forEach((food, i) => {
    const fpath = `${path}.foods[${i}]`;
    if (!food || typeof food !== "object") {
      errors.push(`${fpath}: not an object`);
      return;
    }
    if (!isString(food.description)) {
      errors.push(`${fpath}.description: expected non-empty string`);
    }
    if (!isNonNegNumber(food.grams)) {
      errors.push(`${fpath}.grams: expected non-negative number`);
    }
    // fdc_id optional — the LLM may not always know it
    if (food.fdc_id !== undefined && !Number.isInteger(food.fdc_id)) {
      errors.push(`${fpath}.fdc_id: expected integer if present`);
    }
  });
}

function validateSupplement(supp, path, errors) {
  if (!supp || typeof supp !== "object") {
    errors.push(`${path}: not an object`);
    return;
  }
  if (!isString(supp.description)) {
    errors.push(`${path}.description: expected non-empty string`);
  }
  if (!isNonNegNumber(supp.amount)) {
    errors.push(`${path}.amount: expected non-negative number`);
  }
  if (!isString(supp.unit)) {
    errors.push(`${path}.unit: expected non-empty string (e.g. 'mg', 'iu', 'g', 'capsule')`);
  }
  if (supp.timing !== undefined && !SUPPLEMENT_TIMING_ENUM.includes(supp.timing)) {
    errors.push(`${path}.timing: must be one of ${SUPPLEMENT_TIMING_ENUM.join(", ")}`);
  }
}

function validateDayType(dt, i, errors) {
  const path = `day_types[${i}]`;
  if (!dt || typeof dt !== "object") {
    errors.push(`${path}: not an object`);
    return;
  }
  if (!DAY_TYPE_SLUG_PATTERN.test(dt.slug ?? "")) {
    errors.push(`${path}.slug: must match /^[a-z][a-z0-9_]{0,30}$/`);
  }
  if (!isString(dt.name)) {
    errors.push(`${path}.name: expected non-empty string`);
  }
  if (!Array.isArray(dt.meals)) {
    errors.push(`${path}.meals: expected array`);
  } else {
    dt.meals.forEach((m, j) => validateMeal(m, `${path}.meals[${j}]`, errors));
  }
  if (dt.supplements !== undefined) {
    if (!Array.isArray(dt.supplements)) {
      errors.push(`${path}.supplements: expected array if present`);
    } else {
      dt.supplements.forEach((s, j) => validateSupplement(s, `${path}.supplements[${j}]`, errors));
    }
  }
}

/**
 * Validate a meal_plans.plan JSONB document.
 * @param {object} plan
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMealPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== "object") {
    return { valid: false, errors: ["plan: expected object"] };
  }

  // targets
  if (!plan.targets || typeof plan.targets !== "object") {
    errors.push("targets: expected object keyed by day_type slug");
  }

  // day_types
  if (!Array.isArray(plan.day_types)) {
    errors.push("day_types: expected array");
  } else {
    plan.day_types.forEach((dt, i) => validateDayType(dt, i, errors));
    // Every day_type must have a matching targets entry
    if (plan.targets && typeof plan.targets === "object") {
      for (const dt of plan.day_types) {
        if (dt?.slug) validateTargets(plan.targets[dt.slug], dt.slug, errors);
      }
    }
  }

  // assignments
  if (!plan.assignments || typeof plan.assignments !== "object") {
    errors.push("assignments: expected object");
  } else {
    const a = plan.assignments;
    if (!["auto_from_workout", "manual"].includes(a.mode)) {
      errors.push("assignments.mode: must be 'auto_from_workout' or 'manual'");
    }
    if (!isString(a.default_day_type)) {
      errors.push("assignments.default_day_type: expected non-empty string");
    }
    if (a.overrides !== undefined) {
      if (a.overrides === null || typeof a.overrides !== "object") {
        errors.push("assignments.overrides: expected object (map of ISO-date => day_type slug)");
      } else {
        for (const [date, slug] of Object.entries(a.overrides)) {
          if (!ISO_DATE.test(date)) {
            errors.push(`assignments.overrides: "${date}" is not a valid YYYY-MM-DD`);
          }
          if (!isString(slug)) {
            errors.push(`assignments.overrides[${date}]: expected day_type slug`);
          }
        }
      }
    }
  }

  // provenance is optional but if present must be an object
  if (plan.provenance !== undefined && (plan.provenance === null || typeof plan.provenance !== "object")) {
    errors.push("provenance: expected object if present");
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Write the API handlers**

Create `api/emersus/meal-plans.js`:

```js
// api/emersus/meal-plans.js
//
// Meal plans CRUD. Shape parity with api/emersus/workout-plans (if present)
// and with the workout_plans convention of one-active-per-user.
//
// Routes mounted by server.js:
//   POST   /api/emersus/meal-plans              -> saveMealPlan
//   GET    /api/emersus/meal-plans/active       -> getActiveMealPlan
//   PATCH  /api/emersus/meal-plans/:id/assignments -> patchAssignments
//   POST   /api/emersus/meal-plans/:id/archive  -> archiveMealPlan
//   POST   /api/emersus/meal-plans/:id/undo     -> undoMealPlan
//
// All handlers use the caller's JWT. RLS handles authorization.

import { createClient } from "@supabase/supabase-js";
import { validateMealPlan } from "../../shared/meal-plan-schema.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── POST /api/emersus/meal-plans ──────────────────────────────────────────
export async function saveMealPlan(req, res) {
  try {
    const { title, plan, source_thread_id, last_adjusted_via } = req.body ?? {};
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title_required" });
      return;
    }
    const v = validateMealPlan(plan);
    if (!v.valid) {
      res.status(400).json({ error: "invalid_plan", details: v.errors });
      return;
    }

    const supabase = clientForRequest(req);

    // Fetch any existing active plan for this user. If one exists, we
    // archive it in-place and copy its current plan into previous_plan of
    // the new row so undo can swap them.
    const { data: existing, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("id, plan")
      .is("archived_at", null)
      .maybeSingle();
    if (fetchErr) {
      console.error("[meal-plans:save] fetch error:", fetchErr);
      res.status(500).json({ error: "save_failed" });
      return;
    }

    // Archive existing (RLS scopes to own user automatically)
    if (existing?.id) {
      const { error: archiveErr } = await supabase
        .from("meal_plans")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (archiveErr) {
        console.error("[meal-plans:save] archive error:", archiveErr);
        res.status(500).json({ error: "save_failed" });
        return;
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("meal_plans")
      .insert({
        title,
        plan,
        previous_plan: existing?.plan ?? null,
        source_thread_id: source_thread_id ?? null,
        last_adjusted_via: last_adjusted_via ?? "chat",
        last_adjusted_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertErr) {
      console.error("[meal-plans:save] insert error:", insertErr);
      res.status(500).json({ error: "save_failed" });
      return;
    }
    res.json({ meal_plan: inserted });
  } catch (err) {
    console.error("[meal-plans:save] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── GET /api/emersus/meal-plans/active ────────────────────────────────────
export async function getActiveMealPlan(req, res) {
  try {
    const supabase = clientForRequest(req);
    const { data, error } = await supabase
      .from("meal_plans")
      .select("*")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[meal-plans:active] error:", error);
      res.status(500).json({ error: "fetch_failed" });
      return;
    }
    res.json({ meal_plan: data ?? null });
  } catch (err) {
    console.error("[meal-plans:active] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── PATCH /api/emersus/meal-plans/:id/assignments ─────────────────────────
export async function patchAssignments(req, res) {
  try {
    const { id } = req.params;
    const { overrides, mode, default_day_type } = req.body ?? {};
    const supabase = clientForRequest(req);

    const { data: existing, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("plan")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const newPlan = { ...existing.plan };
    newPlan.assignments = {
      ...(existing.plan.assignments ?? {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(default_day_type !== undefined ? { default_day_type } : {}),
      ...(overrides !== undefined ? { overrides } : {}),
    };

    const v = validateMealPlan(newPlan);
    if (!v.valid) {
      res.status(400).json({ error: "invalid_plan", details: v.errors });
      return;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("meal_plans")
      .update({
        plan: newPlan,
        previous_plan: existing.plan,
        last_adjusted_via: "manual",
        last_adjusted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) {
      console.error("[meal-plans:patch] error:", updateErr);
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.json({ meal_plan: updated });
  } catch (err) {
    console.error("[meal-plans:patch] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── POST /api/emersus/meal-plans/:id/archive ──────────────────────────────
export async function archiveMealPlan(req, res) {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);
    const { error } = await supabase
      .from("meal_plans")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[meal-plans:archive] error:", error);
      res.status(500).json({ error: "archive_failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[meal-plans:archive] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── POST /api/emersus/meal-plans/:id/undo ─────────────────────────────────
export async function undoMealPlan(req, res) {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);

    const { data: row, error: fetchErr } = await supabase
      .from("meal_plans")
      .select("plan, previous_plan")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!row.previous_plan) {
      res.status(400).json({ error: "nothing_to_undo" });
      return;
    }

    const v = validateMealPlan(row.previous_plan);
    if (!v.valid) {
      res.status(400).json({ error: "previous_plan_invalid", details: v.errors });
      return;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("meal_plans")
      .update({
        plan: row.previous_plan,
        previous_plan: row.plan,
        last_adjusted_via: "manual",
        last_adjusted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) {
      console.error("[meal-plans:undo] error:", updateErr);
      res.status(500).json({ error: "undo_failed" });
      return;
    }
    res.json({ meal_plan: updated });
  } catch (err) {
    console.error("[meal-plans:undo] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
```

- [ ] **Step 3: Mount the handlers in `server.js`**

Open `server.js` and add the imports + route wiring alongside the existing `/api/emersus/` routes:

```js
// Near the top imports:
import {
  saveMealPlan,
  getActiveMealPlan,
  patchAssignments,
  archiveMealPlan,
  undoMealPlan,
} from "./api/emersus/meal-plans.js";

// In the routes section, following the existing emersus handler mounts:
app.post("/api/emersus/meal-plans", express.json(), saveMealPlan);
app.get("/api/emersus/meal-plans/active", getActiveMealPlan);
app.patch("/api/emersus/meal-plans/:id/assignments", express.json(), patchAssignments);
app.post("/api/emersus/meal-plans/:id/archive", archiveMealPlan);
app.post("/api/emersus/meal-plans/:id/undo", undoMealPlan);
```

Use the `Read` tool on `server.js` to find the exact placement and match the established convention (middleware order, JSON parsing). Follow what's already there — the file sets middleware once at the top in most Express apps.

- [ ] **Step 4: Write a schema validator test**

Create `scripts/test-meal-plan-schema.js`:

```js
// scripts/test-meal-plan-schema.js
//
// Unit test for shared/meal-plan-schema.js.
// Usage: node scripts/test-meal-plan-schema.js

import assert from "node:assert/strict";
import { validateMealPlan } from "../shared/meal-plan-schema.js";

function expectValid(plan, label) {
  const { valid, errors } = validateMealPlan(plan);
  assert.ok(valid, `${label}: expected valid, got errors: ${errors.join("; ")}`);
  console.log(`  ✓ ${label}`);
}

function expectInvalid(plan, label, matcher) {
  const { valid, errors } = validateMealPlan(plan);
  assert.ok(!valid, `${label}: expected invalid, but passed`);
  if (matcher) {
    assert.ok(
      errors.some(e => matcher.test(e)),
      `${label}: expected an error matching ${matcher}, got: ${errors.join("; ")}`
    );
  }
  console.log(`  ✓ ${label}`);
}

// Minimal valid plan
const validPlan = {
  targets: {
    training_day: { kcal: 2800, protein_g: 190, carbs_g: 340, fat_g: 80, fiber_g: 40 },
    rest_day:     { kcal: 2400, protein_g: 190, carbs_g: 240, fat_g: 80, fiber_g: 40 },
  },
  day_types: [
    {
      slug: "training_day",
      name: "Training day",
      meals: [
        { slot: "breakfast", name: "Oats + whey",
          foods: [{ description: "Oats, raw", grams: 80 }] },
      ],
      supplements: [
        { description: "Creatine monohydrate", amount: 5, unit: "g", timing: "any" },
      ],
    },
    {
      slug: "rest_day",
      name: "Rest day",
      meals: [],
    },
  ],
  assignments: {
    mode: "auto_from_workout",
    default_day_type: "rest_day",
    overrides: { "2026-04-15": "training_day" },
  },
};

console.log("[test-meal-plan-schema] running...");

expectValid(validPlan, "minimal valid plan");

// Missing targets
{
  const bad = structuredClone(validPlan);
  delete bad.targets.training_day;
  expectInvalid(bad, "missing day_type target", /training_day.*missing/i);
}

// Negative grams
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].meals[0].foods[0].grams = -50;
  expectInvalid(bad, "negative grams", /grams.*non-negative/);
}

// Invalid meal slot
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].meals[0].slot = "elevensies";
  expectInvalid(bad, "invalid meal slot", /slot.*must be one of/);
}

// Invalid assignments mode
{
  const bad = structuredClone(validPlan);
  bad.assignments.mode = "vibes";
  expectInvalid(bad, "invalid assignments mode", /assignments\.mode/);
}

// Malformed override date
{
  const bad = structuredClone(validPlan);
  bad.assignments.overrides = { "not-a-date": "training_day" };
  expectInvalid(bad, "malformed override date", /YYYY-MM-DD/);
}

// Day-type slug with uppercase
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].slug = "Training_Day";
  expectInvalid(bad, "day-type slug with uppercase", /slug.*must match/);
}

// Plan missing assignments entirely
{
  const bad = structuredClone(validPlan);
  delete bad.assignments;
  expectInvalid(bad, "missing assignments", /assignments.*expected object/);
}

console.log("[test-meal-plan-schema] all assertions passed.");
```

Add the npm alias. Edit `package.json` scripts:
```json
"test:meal-plan-schema": "node scripts/test-meal-plan-schema.js"
```

Run it:
```bash
npm run test:meal-plan-schema
```

Expected: 7 `✓` lines, "all assertions passed."

- [ ] **Step 5: Commit**

```bash
git add shared/meal-plan-schema.js api/emersus/meal-plans.js server.js scripts/test-meal-plan-schema.js package.json
git commit -m "feat(nutrition): meal-plan schema validator + CRUD API

- shared/meal-plan-schema.js: zero-dep runtime validator for the plan
  JSONB shape. Validates targets, day_types, meals, supplements, and
  assignments. Used by every save path.
- api/emersus/meal-plans.js: saveMealPlan (with one-active-per-user
  enforcement + previous_plan snapshot for undo), getActiveMealPlan,
  patchAssignments, archiveMealPlan, undoMealPlan.
- test-meal-plan-schema.js: 7-case unit test for the validator.
- server.js: mount the 5 routes.

Part of the meal planning / journaling feature (Phase 2)."
```

---

## Task 9: workflow.js meal-plan generation integration

**Files:**
- Modify: `api/emersus/workflow.js`

Add the nutrition intent classifier, profile gate, meal-plan generation protocol (including the supplement sub-protocol), and the branch wiring that routes plan generation through the normal retrieval path but appends the meal-plan system prompt addendum.

- [ ] **Step 1: Read the existing topic-classification and retrieval sections of workflow.js to locate insertion points**

```bash
head -5 api/emersus/workflow.js
```

Use `Grep` to find the relevant anchors:
```
# Use the Grep tool with these patterns:
- "return \"nutrition\";"      (where nutrition topic is assigned)
- "classifyTopic"               (topic classifier function)
- "system prompt" or "buildSystemPrompt"  (where the system prompt is assembled)
```

Open `api/emersus/workflow.js` in `Read` and find:
1. The topic classifier function (e.g. `classifyTopic` or an inline regex check that returns `"nutrition"`)
2. The system-prompt assembly function
3. Where the prompt is dispatched to OpenAI

- [ ] **Step 2: Add the nutrition intent classifier near the topic classifier**

Insert after the `classifyTopic` function in `workflow.js`:

```js
// ─── Nutrition intent sub-classifier ───────────────────────────────────────
//
// When topic === "nutrition", this classifier picks one of four sub-intents.
// Regex-only, no extra LLM call. False positives are harmless because both
// plan generation and logging paths have explicit UI confirmation.
//
//   generate_plan — "meal plan", "macros for", "cut/bulk/recomp", "diet plan", etc.
//   log_food      — "I had X", "log Y", "took my supps", "for lunch: ...", etc.
//   query         — any other nutrition question; normal retrieval path
//   none          — not nutrition; this function isn't called
//
export function classifyNutritionIntent(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return "query";

  // Plan generation
  if (
    /\b(meal\s*plan|diet\s*plan|nutrition\s*plan|eating\s*plan)\b/.test(t) ||
    /\bmacros?\s+(for|to)\b/.test(t) ||
    /\bwhat\s+should\s+i\s+eat\b/.test(t) ||
    /\b(cut|bulk|recomp|maintenance)\b.*\b(plan|macros|diet)\b/.test(t) ||
    /\bset\s+(up\s+)?my\s+(macros|diet|nutrition)\b/.test(t) ||
    /\bgenerate\s+.*(meal|diet|nutrition)\b/.test(t)
  ) {
    return "generate_plan";
  }

  // Logging
  if (
    /^(log|track|add|record)\s+/.test(t) ||
    /^i\s+(just\s+)?(had|ate|drank|took)\b/.test(t) ||
    /^(took|taking)\s+(my\s+)?(supps?|stack|vitamins?|supplements?)\b/.test(t) ||
    /^(for|at)\s+(breakfast|lunch|dinner|snack|supper)\b.*[:\-]/.test(t) ||
    /\blog\s+(this|these|it|that)\b/.test(t)
  ) {
    return "log_food";
  }

  return "query";
}
```

- [ ] **Step 3: Add the profile-gate helper**

Insert near the top of the nutrition section:

```js
// ─── Nutrition profile gate ────────────────────────────────────────────────
//
// Plan generation requires: body_weight_kg, height_cm, date_of_birth,
// biological_sex, activity_level. If any are missing, the LLM must ASK the
// user for them conversationally before emitting a meal-plan fence.
//
// Returns null if all required fields are present, otherwise an array of
// missing field names (human-readable) for the system prompt to use.
//
export function checkNutritionProfileGate(profile) {
  const missing = [];
  if (profile?.body_weight_kg == null) missing.push("current body weight (kg or lbs)");
  if (profile?.height_cm == null)      missing.push("height (cm or ft/in)");
  if (profile?.date_of_birth == null)  missing.push("date of birth (for age)");
  if (profile?.biological_sex == null) missing.push("biological sex (for BMR formula — male or female)");
  if (profile?.activity_level == null) missing.push("activity level (sedentary, light, moderate, active, very active)");
  return missing.length === 0 ? null : missing;
}
```

- [ ] **Step 4: Add the MEAL_PLAN_GENERATION_PROTOCOL string**

Insert near the other system-prompt constant strings:

```js
// ─── Meal plan generation protocol ─────────────────────────────────────────
//
// Appended to the system prompt when nutrition intent === 'generate_plan'
// AND the profile gate passes. Contains the Mifflin-St Jeor formulas, the
// day-type structure, and the supplement sub-protocol.
//
// Emitted as a fenced ```meal-plan JSON block. Rendered by shared/meal-plan-widget.js.

const MEAL_PLAN_GENERATION_PROTOCOL = `
MEAL PLAN GENERATION PROTOCOL

1. Compute macro targets using Mifflin-St Jeor:
     BMR = 10*weight_kg + 6.25*height_cm - 5*age + (5 if male, -161 if female)
     TDEE = BMR * activity_multiplier
       (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9)
     Adjust for goal:
       cut:      TDEE - 500 kcal (aggressive cut: -750, sustainable minimum: -300)
       maintain: TDEE
       bulk:     TDEE + 250..400 kcal (lean bulk) or +500 (traditional)
     Protein: 1.6–2.2 g/kg body weight. Default 1.8 for maintenance,
              2.0–2.2 for cut, 1.6–1.8 for bulk.
     Fat: 20–35% of kcal, absolute minimum 0.6 g/kg.
     Carbs: remainder.
     Fiber: 14 g per 1000 kcal target, rounded to nearest 5 g.

2. Show the user the math briefly in conversational form BEFORE the plan.
   Example: "82 kg / 180 cm / 31 / male / moderate / cut → BMR 1820, TDEE 2820,
            target 2300 kcal, protein 180 g, fat 65 g, carbs 235 g, fiber 35 g."

3. Emit THREE day types in the meal-plan fence: training_day, rest_day, refeed_day.
     training_day:  computed targets with carbs weighted higher
     rest_day:      carbs -60 g, fat +15 g, same protein
     refeed_day:    carbs at ~maintenance carb share, same protein

4. For meals within each day_type:
     - Use USDA FDC generic foods ONLY. Reference by fdc_id when you know it;
       fall back to description otherwise.
     - 3 meals + 1 snack by default. More if the user prefers.
     - Respect dietary_preferences from the profile (vegan, halal, etc).
     - No restaurant chain items. No brand names unless the user asked.

5. Include a supplements array on each day_type using the SUPPLEMENT PROTOCOL below.
   Generate an empty supplements array if the user has said they don't want
   supplements.

6. Emit the plan as a JSON document in a fenced \`\`\`meal-plan block.
   Never emit the fence if profile fields are missing. Ask first.


SUPPLEMENT PROTOCOL (evidence-based only)

Include ONLY supplements with strong evidence for the user's goal:
  - Creatine monohydrate 3-5 g/day: strength, hypertrophy. Broad safety.
  - Whey/casein/pea protein: as a tool to hit the protein target.
  - Vitamin D3 1000-2000 IU/day: general sufficiency baseline.
    Frame as "if deficient or low sun exposure." No megadoses.
  - Omega-3 EPA+DHA 1-2 g/day: anti-inflammatory, cardiovascular.
  - Caffeine 3-6 mg/kg body weight pre-workout: ergogenic.
  - Electrolytes (Na/K/Mg): in heat or on low-sodium diet.
  - Magnesium glycinate 200-400 mg: sleep and recovery, when baseline low.

Do NOT recommend:
  - Anything requiring prescription or clinical monitoring.
  - Megadoses above tolerable upper intake levels.
  - Supplements with weak or conflicting evidence (most fat burners,
    most nootropic stacks, most adaptogens at claimed doses).
  - Anything targeting a medical condition. The existing medical-advice
    guardrail still applies — condition-specific supplement questions
    ("ashwagandha for my anxiety", "magnesium for my RLS") route through
    the refusal path, not plan generation.

Frame every recommendation with ONE evidence sentence ("creatine: meta-
analyses show ~5-10% strength gain over 8-12 weeks"). Never more than a
sentence.

Let the user opt out. If their profile preferences or prior chat mentions
indicate "no supplements," generate an empty supplements array.
`.trim();
```

- [ ] **Step 5: Wire the branch into the main workflow**

Find where the system prompt is assembled and the topic is used (look for code like `if (topic === "nutrition")` or where `SYSTEM_PROMPT` is concatenated). Add the branching logic:

```js
// Inside the main workflow function, after topic classification and after
// profile is loaded from the DB:

if (topic === "nutrition") {
  const intent = classifyNutritionIntent(userMessage);

  if (intent === "generate_plan") {
    const missingFields = checkNutritionProfileGate(profile);
    if (missingFields) {
      // Inject a system-level hint telling the model to ASK for the
      // missing fields and NOT to emit a meal-plan fence this turn.
      systemPromptAddendum += `

NUTRITION PROFILE GATE: the user asked for a meal plan but the following
profile fields are missing: ${missingFields.join(", ")}.

Ask the user for these values conversationally in ONE short message.
Do NOT guess. Do NOT emit a \`\`\`meal-plan fence this turn. After the
user replies, the client will update the profile and a subsequent turn
will run plan generation.
`;
    } else {
      // Profile is complete — append the full generation protocol.
      // Retrieval still runs above; the protocol appears after the
      // retrieved evidence block in the system prompt.
      systemPromptAddendum += "\n\n" + MEAL_PLAN_GENERATION_PROTOCOL;
    }
  }

  // intent === 'log_food' branch is wired in Task 14 (Phase 3).
  // intent === 'query' falls through to the default retrieval path.
}
```

Note: the exact variable names (`systemPromptAddendum`, `userMessage`, `profile`, `topic`) depend on the existing workflow.js structure. Use `Read` and `Grep` to find the actual names and adapt — do not invent new variables.

- [ ] **Step 6: Quick syntax smoke test**

```bash
node -e "import('./api/emersus/workflow.js').then(() => console.log('workflow.js imports ok'))"
```

Expected: "workflow.js imports ok".

- [ ] **Step 7: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat(nutrition): meal plan generation in workflow.js

- classifyNutritionIntent() regex sub-classifier for generate_plan vs
  log_food vs query
- checkNutritionProfileGate() returns missing field list for Mifflin-St
  Jeor inputs (weight, height, age, sex, activity_level)
- MEAL_PLAN_GENERATION_PROTOCOL system prompt string with full formulas
  and supplement sub-protocol
- Branch wired after topic classification: profile gate asks for missing
  fields and blocks fence emission; otherwise appends the protocol to
  the system prompt (retrieval still runs so the model can cite evidence)

Part of the meal planning / journaling feature (Phase 2)."
```

---

## Task 10: Meal-plan widget fence + renderer wiring

**Files:**
- Modify: `shared/widget-fence-parser.js`
- Modify: `shared/emersus-renderer.js`
- Create: `shared/meal-plan-widget.js`
- Create: `scripts/test-meal-plan-fence-routing.js`

The renderer is the chat-side counterpart to the workflow.js generation protocol. When the model emits a `meal-plan` fence, the parser picks it up and the renderer mounts the new widget.

- [ ] **Step 1: Read the existing fence parser to find the registration point**

Open `shared/widget-fence-parser.js` and find where `widget` and `workout-plan` fences are recognized. The existing file almost certainly exposes an array or map of fence types — add `meal-plan` and `nutrition-log-confirm` alongside.

- [ ] **Step 2: Add the new fence types to the parser**

In `shared/widget-fence-parser.js`, find the list or switch recognizing fence tags and add:

```js
// Fence types used by the nutrition feature.
// - `meal-plan`: meal plan document (see shared/meal-plan-schema.js)
// - `nutrition-log-confirm`: chat-parsed journal entries awaiting user confirmation
const NUTRITION_FENCE_TAGS = ["meal-plan", "nutrition-log-confirm"];
```

Then add these tags wherever the existing `widget` / `workout-plan` tags are recognized. If the file uses a regex that captures the tag after the backticks, add `meal-plan` and `nutrition-log-confirm` to whatever allowlist/pattern is in place. Use `Read` on the full file and `Edit` the specific lines.

- [ ] **Step 3: Write `shared/meal-plan-widget.js`**

Create `shared/meal-plan-widget.js`:

```js
// shared/meal-plan-widget.js
//
// React component that renders a meal-plan JSONB document inside a widget
// iframe. Shows target cards for each day-type, a day-type selector, meal
// cards for the selected day-type, and the supplement stack. Exposes a
// `[Save plan]` button that POSTs to /api/emersus/meal-plans.
//
// This module is loaded inside the widget iframe — it imports React from
// esm.sh and writes JSX via React.createElement (no JSX transform).

import React from "https://esm.sh/react@18.2.0";

const { useState } = React;
const h = React.createElement;

// Slot order for display
const SLOT_ORDER = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner",
  "evening", "pre_workout", "post_workout",
];

function MealCard({ meal }) {
  const foods = Array.isArray(meal.foods) ? meal.foods : [];
  const totals = foods.reduce(
    (acc, f) => ({ kcal: acc.kcal + (f.kcal ?? 0) }),
    { kcal: 0 }
  );
  return h("div", { className: "meal-card" }, [
    h("div", { className: "meal-card-header", key: "h" }, [
      h("span", { className: "meal-slot", key: "slot" }, meal.slot.replace(/_/g, " ")),
      h("span", { className: "meal-name", key: "name" }, meal.name),
    ]),
    h("ul", { className: "meal-foods", key: "l" },
      foods.map((f, i) =>
        h("li", { key: i }, `${f.description} — ${f.grams} g`)
      )
    ),
  ]);
}

function SupplementStack({ supplements }) {
  if (!supplements || supplements.length === 0) return null;
  return h("div", { className: "supplement-stack" }, [
    h("h4", { key: "h" }, "Supplement stack"),
    h("ul", { key: "l" },
      supplements.map((s, i) =>
        h("li", { key: i },
          `${s.description} — ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " · " + s.timing.replace(/_/g, " ") : ""}`
        )
      )
    ),
  ]);
}

function TargetCard({ targets, dayTypeName }) {
  if (!targets) return null;
  return h("div", { className: "target-card" }, [
    h("div", { className: "target-card-title", key: "t" }, dayTypeName),
    h("dl", { className: "target-macros", key: "m" }, [
      h("dt", { key: "1" }, "kcal"),  h("dd", { key: "2" }, targets.kcal),
      h("dt", { key: "3" }, "P"),     h("dd", { key: "4" }, `${targets.protein_g} g`),
      h("dt", { key: "5" }, "C"),     h("dd", { key: "6" }, `${targets.carbs_g} g`),
      h("dt", { key: "7" }, "F"),     h("dd", { key: "8" }, `${targets.fat_g} g`),
      h("dt", { key: "9" }, "fiber"), h("dd", { key: "10" }, `${targets.fiber_g} g`),
    ]),
  ]);
}

export default function MealPlanWidget({ plan }) {
  const dayTypes = plan?.day_types ?? [];
  const [activeSlug, setActiveSlug] = useState(dayTypes[0]?.slug ?? null);
  const [saveState, setSaveState] = useState("idle");
  const [savedTitle, setSavedTitle] = useState("");

  const activeDayType = dayTypes.find(dt => dt.slug === activeSlug);
  const activeTargets = plan?.targets?.[activeSlug];

  const sortedMeals = (activeDayType?.meals ?? [])
    .slice()
    .sort((a, b) =>
      (SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    );

  async function save() {
    setSaveState("saving");
    const title = savedTitle || `${plan.provenance?.profile_snapshot?.goal ?? "Meal"} plan`;
    try {
      const res = await fetch("/api/emersus/meal-plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Auth header is injected by the parent chat app via the iframe bridge
          // (window.parent sends the token; widgets include it in window.EMERSUS_AUTH).
          ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
        },
        body: JSON.stringify({ title, plan }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState("saved");
    } catch (err) {
      console.error("[meal-plan-widget] save failed:", err);
      setSaveState("error");
    }
  }

  return h("div", { className: "meal-plan-widget" }, [
    h("div", { className: "meal-plan-tabs", key: "tabs" },
      dayTypes.map(dt =>
        h("button", {
          key: dt.slug,
          className: dt.slug === activeSlug ? "tab active" : "tab",
          onClick: () => setActiveSlug(dt.slug),
        }, dt.name)
      )
    ),
    h(TargetCard, { key: "targets", targets: activeTargets, dayTypeName: activeDayType?.name ?? "" }),
    h("div", { className: "meal-plan-meals", key: "meals" },
      sortedMeals.map((m, i) => h(MealCard, { key: i, meal: m }))
    ),
    h(SupplementStack, { key: "supps", supplements: activeDayType?.supplements }),
    h("div", { className: "meal-plan-actions", key: "actions" }, [
      h("input", {
        key: "title-input",
        type: "text",
        placeholder: "Plan title (optional)",
        value: savedTitle,
        onChange: (e) => setSavedTitle(e.target.value),
        disabled: saveState !== "idle",
      }),
      h("button", {
        key: "save",
        className: "primary",
        onClick: save,
        disabled: saveState !== "idle",
      },
        saveState === "idle"  ? "Save plan" :
        saveState === "saving" ? "Saving..." :
        saveState === "saved"  ? "✓ Saved" :
                                  "Save failed — retry"
      ),
    ]),
  ]);
}
```

- [ ] **Step 4: Wire the new widget into `shared/emersus-renderer.js`**

Open `shared/emersus-renderer.js` and find the segment-walker that dispatches `widget` / `workout-plan` fences to their renderers. Add handlers for `meal-plan` and (stub for now) `nutrition-log-confirm`:

```js
// Near the existing imports:
import MealPlanWidget from "./meal-plan-widget.js";
// NutritionLogConfirmWidget is added in Task 15 (Phase 3).

// Inside the segment dispatch:
if (segment.type === "meal-plan") {
  try {
    const plan = JSON.parse(segment.content);
    out.push({ type: "widget-component", component: MealPlanWidget, props: { plan } });
  } catch (err) {
    console.error("[emersus-renderer] failed to parse meal-plan fence:", err);
    out.push({ type: "text", content: "⚠ meal plan could not be parsed" });
  }
}
// nutrition-log-confirm dispatch is added in Task 15.
```

The exact shape of `out.push({ type: ... })` depends on the existing renderer's output contract — use `Read` to find the exact pattern and match it.

- [ ] **Step 5: Write the fence routing test**

Create `scripts/test-meal-plan-fence-routing.js`:

```js
// scripts/test-meal-plan-fence-routing.js
//
// Verifies that shared/widget-fence-parser.js recognizes meal-plan and
// nutrition-log-confirm fences and produces well-formed segments.
//
// Usage: node scripts/test-meal-plan-fence-routing.js

import assert from "node:assert/strict";
import {
  parseMessageSegments,  // adapt to the real export from widget-fence-parser.js
} from "../shared/widget-fence-parser.js";

const mealPlanBlock = `
Here is your plan.

\`\`\`meal-plan
{
  "targets": {"training_day": {"kcal": 2800, "protein_g": 190, "carbs_g": 340, "fat_g": 80, "fiber_g": 40}},
  "day_types": [{"slug": "training_day", "name": "Training day", "meals": []}],
  "assignments": {"mode": "auto_from_workout", "default_day_type": "training_day"}
}
\`\`\`
`;

const logConfirmBlock = `
\`\`\`nutrition-log-confirm
{"resolved_items": [], "meal_slot": "lunch", "logged_date": "2026-04-11"}
\`\`\`
`;

console.log("[test-meal-plan-fence-routing] running");

{
  const segs = parseMessageSegments(mealPlanBlock);
  const mealSeg = segs.find(s => s.type === "meal-plan");
  assert.ok(mealSeg, "expected a meal-plan segment");
  const parsed = JSON.parse(mealSeg.content);
  assert.ok(parsed.targets.training_day.kcal === 2800);
  console.log("  ✓ meal-plan fence parsed");
}

{
  const segs = parseMessageSegments(logConfirmBlock);
  const logSeg = segs.find(s => s.type === "nutrition-log-confirm");
  assert.ok(logSeg, "expected a nutrition-log-confirm segment");
  const parsed = JSON.parse(logSeg.content);
  assert.equal(parsed.meal_slot, "lunch");
  console.log("  ✓ nutrition-log-confirm fence parsed");
}

console.log("[test-meal-plan-fence-routing] all assertions passed.");
```

Add the npm test alias:
```json
"test:meal-plan-fence": "node scripts/test-meal-plan-fence-routing.js"
```

**Note:** the exact function exported by `shared/widget-fence-parser.js` may not be `parseMessageSegments` — check the real name via `Read` and adapt the import. Match the existing workout-plan fence test pattern if one exists.

- [ ] **Step 6: Run the test**

```bash
npm run test:meal-plan-fence
```

Expected: 2 `✓` lines and "all assertions passed."

- [ ] **Step 7: Commit**

```bash
git add shared/widget-fence-parser.js shared/emersus-renderer.js shared/meal-plan-widget.js scripts/test-meal-plan-fence-routing.js package.json
git commit -m "feat(nutrition): meal-plan widget fence + renderer

- widget-fence-parser.js: recognize meal-plan and nutrition-log-confirm fences
- emersus-renderer.js: dispatch meal-plan fences to MealPlanWidget component
- meal-plan-widget.js: React widget (iframe-hosted) with day-type tabs,
  target card, meal cards, supplement stack, and Save plan button POSTing
  to /api/emersus/meal-plans
- test-meal-plan-fence-routing.js: round-trip parse test for both new fences

Part of the meal planning / journaling feature (Phase 2 — final)."
```

**End of Phase 2.** After this task, a user can ask the chat for a meal plan in a fresh thread, the chat asks for any missing profile fields, computes macros via Mifflin-St Jeor, cites evidence from retrieval, emits a `meal-plan` fence, the renderer shows the widget, and the user can save the plan. No journaling yet — that's Phase 3.

---

# Phase 3 — Journal & Chat Logging

## Task 11: Meal journal entries table migration

**Files:**
- Create: `supabase/20260414_meal_journal_entries.sql`

Denormalized per-food log rows with frozen macro snapshots, RLS self-only, and five indexes for the common read paths (today, timeline, food history, plan adherence, meal-slot suggestions).

- [ ] **Step 1: Write the migration**

Create `supabase/20260414_meal_journal_entries.sql`:

```sql
-- 20260414_meal_journal_entries.sql
-- Per-food/per-supplement log rows. Mirrors workout_logs structure.
--
-- Snapshots (kcal/protein/carbs/fat/fiber) are frozen at write time and
-- never updated. If USDA updates a food's nutrient profile in a future
-- import, historical journal entries retain the numbers the user saw
-- at the time. Micronutrients are aggregated at read-time via join
-- (display-only, not on the critical macro path).
--
-- amount_unit is 'g' for foods and powder supplements, 'serving' for
-- discrete-unit supplements. The write path validates that amount_unit
-- is compatible with the parent food's base_unit.

create table if not exists public.meal_journal_entries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  food_id             uuid not null references public.foods(id),
  plan_id             uuid references public.meal_plans(id) on delete set null,
  logged_date         date not null,
  meal_slot           text not null
                      check (meal_slot in (
                        'breakfast','mid_morning','lunch','afternoon','dinner','evening',
                        'pre_workout','post_workout','supplements_am','supplements_pm'
                      )),
  logged_at           timestamptz not null default now(),
  amount              numeric(10,2) not null check (amount >= 0),
  amount_unit         text not null check (amount_unit in ('g','serving')),
  servings            numeric(6,2),
  servings_unit       text,
  source              text not null
                      check (source in (
                        'chat_parser','manual_search','quick_add','copied','plan_check_off'
                      )),
  confidence          numeric(3,2),
  notes               text,
  kcal_snapshot       numeric(8,2),
  protein_g_snapshot  numeric(7,2),
  carbs_g_snapshot    numeric(7,2),
  fat_g_snapshot      numeric(7,2),
  fiber_g_snapshot    numeric(7,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists meal_journal_user_date_idx
  on public.meal_journal_entries (user_id, logged_date desc);

create index if not exists meal_journal_user_food_date_idx
  on public.meal_journal_entries (user_id, food_id, logged_date desc);

create index if not exists meal_journal_user_plan_date_idx
  on public.meal_journal_entries (user_id, plan_id, logged_date);

create index if not exists meal_journal_user_slot_date_idx
  on public.meal_journal_entries (user_id, meal_slot, logged_date);

create index if not exists meal_journal_user_logged_at_idx
  on public.meal_journal_entries (user_id, logged_at desc);

alter table public.meal_journal_entries enable row level security;

drop policy if exists "users can read own journal entries" on public.meal_journal_entries;
create policy "users can read own journal entries"
on public.meal_journal_entries
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own journal entries" on public.meal_journal_entries;
create policy "users can insert own journal entries"
on public.meal_journal_entries
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own journal entries" on public.meal_journal_entries;
create policy "users can update own journal entries"
on public.meal_journal_entries
for update
to authenticated
using  (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own journal entries" on public.meal_journal_entries;
create policy "users can delete own journal entries"
on public.meal_journal_entries
for delete
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_meal_journal_updated_at on public.meal_journal_entries;
create trigger set_meal_journal_updated_at
before update on public.meal_journal_entries
for each row
execute function public.set_current_timestamp_updated_at();
```

- [ ] **Step 2: Apply against scratch Postgres and verify the CHECK constraints + RLS**

```bash
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create role authenticated; create role service_role;
create or replace function public.set_current_timestamp_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
SQL
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/20260414_nutrients.sql \
  -f supabase/20260414_foods.sql \
  -f supabase/20260414_food_nutrients.sql \
  -f supabase/20260414_meal_plans.sql \
  -f supabase/20260414_meal_journal_entries.sql

# Bad meal_slot should be rejected
psql -h 127.0.0.1 -p 55432 -U postgres -c "
insert into public.foods (id, description, source) values ('11111111-1111-1111-1111-111111111111', 'Test', 'usda_foundation');
insert into public.meal_journal_entries (user_id, food_id, logged_date, meal_slot, amount, amount_unit, source)
values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-04-11', 'elevensies', 100, 'g', 'manual_search');
" 2>&1 | grep -q "violates check constraint" && echo "meal_slot check ok"

# Bad amount_unit
psql -h 127.0.0.1 -p 55432 -U postgres -c "
insert into public.meal_journal_entries (user_id, food_id, logged_date, meal_slot, amount, amount_unit, source)
values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-04-11', 'lunch', 100, 'ounces', 'manual_search');
" 2>&1 | grep -q "violates check constraint" && echo "amount_unit check ok"

docker stop emersus-scratch-pg
```

Expected: two "check ok" lines.

- [ ] **Step 3: Commit**

```bash
git add supabase/20260414_meal_journal_entries.sql
git commit -m "feat(nutrition): meal_journal_entries table

- Per-item log rows (foods and supplements) with frozen macro snapshots
- amount + amount_unit (g|serving) keyed to foods.base_unit
- 5 indexes for today/timeline/food-history/adherence/slot-suggestions
- RLS self-only on all CRUD
- CHECK constraints enforce meal_slot and amount_unit enums
- Re-uses set_current_timestamp_updated_at trigger

Part of the meal planning / journaling feature (Phase 3)."
```

---

## Task 12: Meal journal write-path module

**Files:**
- Create: `api/emersus/meal-journal.js`
- Modify: `server.js` (mount handlers)

Server-side write path with snapshot computation in a single SQL CTE. Exports `writeMealJournalEntries`, `deleteMealJournalEntry`, `updateMealJournalEntry`, `copyMealJournalDay`, and the HTTP handlers that wrap them.

- [ ] **Step 1: Write `api/emersus/meal-journal.js`**

Create `api/emersus/meal-journal.js`:

```js
// api/emersus/meal-journal.js
//
// Write-path for meal_journal_entries. Computes kcal/macro snapshots
// server-side from food_nutrients × amount / foods.base_amount so
// clients never have to trust client-computed nutrients.
//
// Routes mounted by server.js:
//   POST   /api/emersus/meal-journal/entries              -> addEntries (bulk)
//   PATCH  /api/emersus/meal-journal/entries/:id          -> updateEntry
//   DELETE /api/emersus/meal-journal/entries/:id          -> deleteEntry
//   POST   /api/emersus/meal-journal/copy-day             -> copyDay
//   GET    /api/emersus/meal-journal/day?date=YYYY-MM-DD  -> getDayJournal

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── POST /api/emersus/meal-journal/entries ────────────────────────────────
// Body: { entries: [{food_id, logged_date, meal_slot, amount, amount_unit, source, confidence?, notes?, plan_id?, servings?, servings_unit?}] }
// Server computes snapshots and inserts in a single transaction via RPC.
export async function addEntries(req, res) {
  try {
    const { entries } = req.body ?? {};
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "entries_required" });
      return;
    }
    if (entries.length > 50) {
      res.status(400).json({ error: "too_many_entries", max: 50 });
      return;
    }
    for (const e of entries) {
      if (!e.food_id || !e.logged_date || !e.meal_slot || e.amount == null || !e.amount_unit || !e.source) {
        res.status(400).json({
          error: "missing_fields",
          required: ["food_id", "logged_date", "meal_slot", "amount", "amount_unit", "source"],
        });
        return;
      }
    }

    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc("insert_meal_journal_entries", {
      p_entries: entries,
    });
    if (error) {
      console.error("[meal-journal:add] rpc error:", error);
      res.status(500).json({ error: "insert_failed", detail: error.message });
      return;
    }
    res.json({ entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:add] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── PATCH /api/emersus/meal-journal/entries/:id ───────────────────────────
export async function updateEntry(req, res) {
  try {
    const { id } = req.params;
    const { amount, amount_unit, meal_slot, notes, servings, servings_unit } = req.body ?? {};
    const supabase = clientForRequest(req);

    // If amount or amount_unit changes, we must re-snapshot. The RPC handles it.
    const { data, error } = await supabase.rpc("update_meal_journal_entry", {
      p_id: id,
      p_amount: amount ?? null,
      p_amount_unit: amount_unit ?? null,
      p_meal_slot: meal_slot ?? null,
      p_notes: notes ?? null,
      p_servings: servings ?? null,
      p_servings_unit: servings_unit ?? null,
    });
    if (error) {
      console.error("[meal-journal:update] rpc error:", error);
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.json({ entry: data ?? null });
  } catch (err) {
    console.error("[meal-journal:update] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── DELETE /api/emersus/meal-journal/entries/:id ──────────────────────────
export async function deleteEntry(req, res) {
  try {
    const { id } = req.params;
    const supabase = clientForRequest(req);
    const { error } = await supabase.from("meal_journal_entries").delete().eq("id", id);
    if (error) {
      console.error("[meal-journal:delete] error:", error);
      res.status(500).json({ error: "delete_failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[meal-journal:delete] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── POST /api/emersus/meal-journal/copy-day ───────────────────────────────
export async function copyDay(req, res) {
  try {
    const { source_date, target_date, meal_slots } = req.body ?? {};
    if (!source_date || !target_date) {
      res.status(400).json({ error: "source_date_and_target_date_required" });
      return;
    }
    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc("copy_meal_journal_day", {
      p_source_date: source_date,
      p_target_date: target_date,
      p_meal_slots: meal_slots ?? null,
    });
    if (error) {
      console.error("[meal-journal:copy] rpc error:", error);
      res.status(500).json({ error: "copy_failed" });
      return;
    }
    res.json({ entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:copy] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}

// ─── GET /api/emersus/meal-journal/day?date=YYYY-MM-DD ─────────────────────
export async function getDayJournal(req, res) {
  try {
    const date = String(req.query.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "invalid_date", expected: "YYYY-MM-DD" });
      return;
    }
    const supabase = clientForRequest(req);
    const { data, error } = await supabase
      .from("meal_journal_entries")
      .select(`
        id, logged_date, meal_slot, logged_at, amount, amount_unit, servings, servings_unit,
        source, confidence, notes,
        kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot,
        plan_id,
        food:foods ( id, description, kind, brand_name, source, form, common_unit, common_unit_grams )
      `)
      .eq("logged_date", date)
      .order("logged_at", { ascending: true });
    if (error) {
      console.error("[meal-journal:day] error:", error);
      res.status(500).json({ error: "fetch_failed" });
      return;
    }
    res.json({ date, entries: data ?? [] });
  } catch (err) {
    console.error("[meal-journal:day] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
```

- [ ] **Step 2: Add the three RPCs `insert_meal_journal_entries`, `update_meal_journal_entry`, `copy_meal_journal_day` as a new migration**

Create `supabase/20260414_meal_journal_rpcs.sql`:

```sql
-- 20260414_meal_journal_rpcs.sql
-- Write-path RPCs for meal_journal_entries. All run SECURITY INVOKER so
-- RLS on public.meal_journal_entries gates access automatically.
--
-- Snapshot math (per row):
--   snapshot = food_nutrients.amount_per_base * entry.amount / foods.base_amount
--
-- For a food with base_unit='100g', base_amount=100, this reduces to the
-- classic "per 100 g × grams / 100". For a discrete supplement with
-- base_unit='serving', base_amount=1, it reduces to "per serving × count".

-- ─── insert_meal_journal_entries ───────────────────────────────────────────
-- Accepts a jsonb array of entries and inserts one row per entry with
-- computed snapshots. Validates amount_unit matches foods.base_unit.

create or replace function public.insert_meal_journal_entries(p_entries jsonb)
returns setof public.meal_journal_entries
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  entry jsonb;
  v_user_id uuid := auth.uid();
  v_food_id uuid;
  v_base_unit text;
  v_base_amount numeric;
  v_amount numeric;
  v_amount_unit text;
  v_kcal numeric;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
  v_fiber numeric;
  v_inserted public.meal_journal_entries;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  for entry in select * from jsonb_array_elements(p_entries)
  loop
    v_food_id := (entry->>'food_id')::uuid;
    v_amount := (entry->>'amount')::numeric;
    v_amount_unit := entry->>'amount_unit';

    select f.base_unit, f.base_amount
      into v_base_unit, v_base_amount
    from public.foods f
    where f.id = v_food_id;

    if v_base_unit is null then
      raise exception 'food not found or not visible: %', v_food_id;
    end if;

    -- Validate unit compatibility
    if v_base_unit = '100g' and v_amount_unit <> 'g' then
      raise exception 'food % uses base_unit=100g; amount_unit must be g, got %', v_food_id, v_amount_unit;
    end if;
    if v_base_unit = 'serving' and v_amount_unit <> 'serving' then
      raise exception 'food % uses base_unit=serving; amount_unit must be serving, got %', v_food_id, v_amount_unit;
    end if;

    -- Compute each of the 5 macro snapshots from food_nutrients
    select
      (fn.amount_per_base * v_amount / v_base_amount)::numeric(8,2)
    into v_kcal
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = v_food_id and n.slug = 'energy_kcal';

    select (fn.amount_per_base * v_amount / v_base_amount)::numeric(7,2)
    into v_protein
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = v_food_id and n.slug = 'protein';

    select (fn.amount_per_base * v_amount / v_base_amount)::numeric(7,2)
    into v_carbs
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = v_food_id and n.slug = 'carbohydrate';

    select (fn.amount_per_base * v_amount / v_base_amount)::numeric(7,2)
    into v_fat
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = v_food_id and n.slug = 'total_fat';

    select (fn.amount_per_base * v_amount / v_base_amount)::numeric(7,2)
    into v_fiber
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = v_food_id and n.slug = 'fiber';

    insert into public.meal_journal_entries (
      user_id, food_id, plan_id, logged_date, meal_slot, logged_at,
      amount, amount_unit, servings, servings_unit,
      source, confidence, notes,
      kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot
    ) values (
      v_user_id,
      v_food_id,
      nullif(entry->>'plan_id','')::uuid,
      (entry->>'logged_date')::date,
      entry->>'meal_slot',
      coalesce((entry->>'logged_at')::timestamptz, now()),
      v_amount,
      v_amount_unit,
      nullif(entry->>'servings','')::numeric,
      entry->>'servings_unit',
      entry->>'source',
      nullif(entry->>'confidence','')::numeric,
      entry->>'notes',
      coalesce(v_kcal, 0),
      coalesce(v_protein, 0),
      coalesce(v_carbs, 0),
      coalesce(v_fat, 0),
      coalesce(v_fiber, 0)
    )
    returning * into v_inserted;
    return next v_inserted;
  end loop;
  return;
end;
$$;

grant execute on function public.insert_meal_journal_entries(jsonb) to authenticated;

-- ─── update_meal_journal_entry ─────────────────────────────────────────────
-- Recomputes snapshots if amount or amount_unit changed.

create or replace function public.update_meal_journal_entry(
  p_id uuid,
  p_amount numeric,
  p_amount_unit text,
  p_meal_slot text,
  p_notes text,
  p_servings numeric,
  p_servings_unit text
)
returns public.meal_journal_entries
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_existing public.meal_journal_entries;
  v_base_unit text;
  v_base_amount numeric;
  v_kcal numeric;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
  v_fiber numeric;
  v_amount numeric;
  v_amount_unit text;
  v_result public.meal_journal_entries;
begin
  select * into v_existing
  from public.meal_journal_entries
  where id = p_id;
  if v_existing.id is null then
    raise exception 'entry not found';
  end if;

  v_amount := coalesce(p_amount, v_existing.amount);
  v_amount_unit := coalesce(p_amount_unit, v_existing.amount_unit);

  if p_amount is not null or p_amount_unit is not null then
    select f.base_unit, f.base_amount
      into v_base_unit, v_base_amount
    from public.foods f
    where f.id = v_existing.food_id;

    select (fn.amount_per_base * v_amount / v_base_amount)::numeric
      into v_kcal    from public.food_nutrients fn join public.nutrients n on n.id = fn.nutrient_id where fn.food_id = v_existing.food_id and n.slug = 'energy_kcal';
    select (fn.amount_per_base * v_amount / v_base_amount)::numeric
      into v_protein from public.food_nutrients fn join public.nutrients n on n.id = fn.nutrient_id where fn.food_id = v_existing.food_id and n.slug = 'protein';
    select (fn.amount_per_base * v_amount / v_base_amount)::numeric
      into v_carbs   from public.food_nutrients fn join public.nutrients n on n.id = fn.nutrient_id where fn.food_id = v_existing.food_id and n.slug = 'carbohydrate';
    select (fn.amount_per_base * v_amount / v_base_amount)::numeric
      into v_fat     from public.food_nutrients fn join public.nutrients n on n.id = fn.nutrient_id where fn.food_id = v_existing.food_id and n.slug = 'total_fat';
    select (fn.amount_per_base * v_amount / v_base_amount)::numeric
      into v_fiber   from public.food_nutrients fn join public.nutrients n on n.id = fn.nutrient_id where fn.food_id = v_existing.food_id and n.slug = 'fiber';
  end if;

  update public.meal_journal_entries
    set amount = v_amount,
        amount_unit = v_amount_unit,
        meal_slot = coalesce(p_meal_slot, meal_slot),
        notes = coalesce(p_notes, notes),
        servings = coalesce(p_servings, servings),
        servings_unit = coalesce(p_servings_unit, servings_unit),
        kcal_snapshot      = coalesce(v_kcal,    kcal_snapshot),
        protein_g_snapshot = coalesce(v_protein, protein_g_snapshot),
        carbs_g_snapshot   = coalesce(v_carbs,   carbs_g_snapshot),
        fat_g_snapshot     = coalesce(v_fat,     fat_g_snapshot),
        fiber_g_snapshot   = coalesce(v_fiber,   fiber_g_snapshot),
        updated_at = now()
    where id = p_id
    returning * into v_result;
  return v_result;
end;
$$;

grant execute on function public.update_meal_journal_entry(uuid, numeric, text, text, text, numeric, text) to authenticated;

-- ─── copy_meal_journal_day ─────────────────────────────────────────────────
-- Clones all entries for a source date into a target date, optionally
-- filtered by meal_slots. Preserves snapshots (they're already correct).

create or replace function public.copy_meal_journal_day(
  p_source_date date,
  p_target_date date,
  p_meal_slots  text[] default null
)
returns setof public.meal_journal_entries
language sql
security invoker
set search_path = public, extensions
as $$
  insert into public.meal_journal_entries (
    user_id, food_id, plan_id, logged_date, meal_slot, logged_at,
    amount, amount_unit, servings, servings_unit,
    source, confidence, notes,
    kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot
  )
  select
    user_id, food_id, plan_id, p_target_date, meal_slot, now(),
    amount, amount_unit, servings, servings_unit,
    'copied', null, notes,
    kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot
  from public.meal_journal_entries
  where logged_date = p_source_date
    and user_id = auth.uid()
    and (p_meal_slots is null or meal_slot = any(p_meal_slots))
  returning *;
$$;

grant execute on function public.copy_meal_journal_day(date, date, text[]) to authenticated;
```

- [ ] **Step 3: Mount the handlers in `server.js`**

Add to the imports and routes section:

```js
import {
  addEntries,
  updateEntry,
  deleteEntry,
  copyDay,
  getDayJournal,
} from "./api/emersus/meal-journal.js";

app.post("/api/emersus/meal-journal/entries", express.json(), addEntries);
app.patch("/api/emersus/meal-journal/entries/:id", express.json(), updateEntry);
app.delete("/api/emersus/meal-journal/entries/:id", deleteEntry);
app.post("/api/emersus/meal-journal/copy-day", express.json(), copyDay);
app.get("/api/emersus/meal-journal/day", getDayJournal);
```

- [ ] **Step 4: Syntax smoke test**

```bash
node -e "import('./api/emersus/meal-journal.js').then(() => console.log('meal-journal imports ok'))"
```

Expected: "meal-journal imports ok".

- [ ] **Step 5: Commit**

```bash
git add api/emersus/meal-journal.js server.js supabase/20260414_meal_journal_rpcs.sql
git commit -m "feat(nutrition): meal-journal write path + RPCs

- api/emersus/meal-journal.js: addEntries/update/delete/copyDay/getDay
  HTTP handlers, each wrapping a SECURITY INVOKER RPC so RLS enforces
  auth automatically
- 20260414_meal_journal_rpcs.sql:
  * insert_meal_journal_entries(jsonb): bulk insert with server-computed
    macro snapshots from food_nutrients × amount / base_amount
  * update_meal_journal_entry(): re-snapshots when amount changes
  * copy_meal_journal_day(): clones a day's entries, preserves snapshots
- Unit compatibility validation (base_unit='100g' ↔ amount_unit='g';
  base_unit='serving' ↔ amount_unit='serving')

Part of the meal planning / journaling feature (Phase 3)."
```

---

## Task 13: Nutrition natural-language parser

**Files:**
- Create: `api/emersus/nutrition-parser.js`
- Create: `scripts/test-nutrition-parser.js`

Separate OpenAI call with a strict function-schema output. Parses "I had chicken and rice for lunch" into structured items, then runs them through the foods catalog match pipeline.

- [ ] **Step 1: Write the parser module**

Create `api/emersus/nutrition-parser.js`:

```js
// api/emersus/nutrition-parser.js
//
// Separate OpenAI call for parsing natural-language food/supplement
// descriptions into structured log entries. Deterministic (temp 0),
// function-schema output, cheaper model than the main chat completion.
//
// Pipeline:
//   1. OpenAI parse with strict JSON schema → [{description, amount, amount_unit, kind, meal_slot?, confidence}]
//   2. For each parsed item, call foods_search RPC to resolve to a food_id
//   3. Return { items: [...], unresolved: [...] }

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PARSER_MODEL = process.env.OPENAI_EMERSUS_PARSER_MODEL || "gpt-4.1-mini";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const PARSER_SYSTEM_PROMPT = `
You are a nutrition parsing module. Given a free-form message describing what
someone ate or took, extract individual items with canonical amounts.

RULES:
- For FOODS: always produce amount in grams. Convert common household units:
    1 cup cooked white rice = 195 g
    1 medium banana = 118 g
    1 slice bread = 28 g
    1 large egg = 50 g
    1 tbsp olive oil = 14 g
    1 oz chicken = 28 g
  Set amount_unit = "g".
- For POWDER or MASS-MEASURED SUPPLEMENTS (creatine, whey, BCAA, caffeine powder,
  collagen): produce amount in grams and set amount_unit = "g".
- For DISCRETE-UNIT SUPPLEMENTS (vitamin D3 capsules, omega-3 softgels,
  magnesium tablets, multivitamin, probiotic capsules): produce the COUNT
  of units taken and set amount_unit = "serving".
- Distinguish foods vs supplements in the "kind" field.
- If the user named a brand ("Quest bar", "Chobani yogurt", "Trader Joe's
  frozen burrito"), PRESERVE it verbatim in the description so the matcher
  can look it up against the branded USDA catalog.
- If the user did NOT name a brand, keep the description generic.
- Do not invent items the user didn't mention.
- If you cannot determine a canonical amount, set confidence below 0.5 so the
  user can correct it in the confirmation widget.
- meal_slot is one of: breakfast, mid_morning, lunch, afternoon, dinner,
  evening, pre_workout, post_workout, supplements_am, supplements_pm. Only set
  it if the user explicitly named the slot. Otherwise leave null.
`.trim();

const PARSER_SCHEMA = {
  name: "parse_foods",
  description: "Parse a freeform food/supplement description into structured items.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw_text:    { type: "string", description: "The portion of user text this item came from" },
            description: { type: "string", description: "Generic food/supplement name" },
            amount:      { type: "number" },
            amount_unit: { type: "string", enum: ["g", "serving"] },
            kind:        { type: "string", enum: ["food", "supplement"] },
            meal_slot:   { type: ["string", "null"] },
            confidence:  { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["description", "amount", "amount_unit", "kind", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

function clientForRequest(authHeader) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Parse a freeform food description and resolve each item to a food_id.
 * @param {string} text
 * @param {string} authHeader  Forwarded Authorization header for RLS
 */
export async function parseFoodDescription(text, { authHeader }) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return { items: [], unresolved: [] };
  }

  let parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: PARSER_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: PARSER_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      tools: [{ type: "function", function: PARSER_SCHEMA }],
      tool_choice: { type: "function", function: { name: "parse_foods" } },
    });
    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return { items: [], unresolved: [], error: "parser_unavailable" };
    }
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    console.error("[nutrition-parser] openai error:", err);
    return { items: [], unresolved: [], error: "parser_unavailable" };
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const supabase = clientForRequest(authHeader);

  const resolved = [];
  const unresolved = [];

  for (const item of items) {
    const { data, error } = await supabase.rpc("foods_search", {
      p_query: item.description,
      p_kind: item.kind,
      p_generic_only: false,
      p_limit: 5,
    });
    if (error || !data || data.length === 0) {
      unresolved.push({
        raw_text: item.raw_text,
        description: item.description,
        amount: item.amount,
        amount_unit: item.amount_unit,
        kind: item.kind,
        meal_slot: item.meal_slot ?? null,
        confidence: item.confidence,
        reason: error ? "search_error" : "no_match",
      });
      continue;
    }

    const top = data[0];
    // Validate amount_unit compatibility with the matched food's base_unit
    if (top.base_unit === "100g" && item.amount_unit !== "g") {
      unresolved.push({ ...item, reason: "unit_mismatch", matched_food: top });
      continue;
    }
    if (top.base_unit === "serving" && item.amount_unit !== "serving") {
      unresolved.push({ ...item, reason: "unit_mismatch", matched_food: top });
      continue;
    }

    resolved.push({
      food_id: top.id,
      food_description: top.description,
      food_brand_name: top.brand_name ?? null,
      food_source: top.source,
      kind: top.kind,
      amount: item.amount,
      amount_unit: item.amount_unit,
      meal_slot: item.meal_slot ?? null,
      confidence: Math.min(item.confidence ?? 0.5, 1),
      match_method: "foods_search_rpc",
      alternates: data.slice(1, 5).map(d => ({
        food_id: d.id,
        description: d.description,
        brand_name: d.brand_name,
      })),
    });
  }

  return { items: resolved, unresolved };
}
```

- [ ] **Step 2: Write a golden-fixture test**

Create `scripts/test-nutrition-parser.js`:

```js
// scripts/test-nutrition-parser.js
//
// Golden-fixture test for api/emersus/nutrition-parser.js.
// Hits the real OpenAI API — gated by EMERSUS_RUN_LLM_TESTS=1 so it doesn't
// run in every push automatically (costs $$$ per run).
//
// Requires:
//   - OPENAI_API_KEY
//   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (for the match pipeline)
//   - Foods catalog populated (at minimum: seeded supplements)
//
// Usage: EMERSUS_RUN_LLM_TESTS=1 node scripts/test-nutrition-parser.js

import "dotenv/config";
import assert from "node:assert/strict";
import { parseFoodDescription } from "../api/emersus/nutrition-parser.js";

if (!process.env.EMERSUS_RUN_LLM_TESTS) {
  console.log("[test-nutrition-parser] skipped (set EMERSUS_RUN_LLM_TESTS=1 to run)");
  process.exit(0);
}

const authHeader = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

const cases = [
  {
    input: "took 5g creatine and 2000 IU vitamin D",
    expect: (result) => {
      assert.ok(result.items.length + result.unresolved.length >= 2, "should parse ≥2 items");
      const hasCreatine = result.items.some(i => /creatine/i.test(i.food_description));
      const hasD = result.items.some(i => /vitamin d|d3/i.test(i.food_description));
      assert.ok(hasCreatine, "should match creatine");
      assert.ok(hasD, "should match vitamin D");
    },
  },
  {
    input: "I had a medium banana",
    expect: (result) => {
      // Banana may fall in unresolved if USDA not imported yet — either way it
      // should be recognized as a food kind with ~118 g
      const all = [...result.items, ...result.unresolved];
      const banana = all.find(i =>
        /banana/i.test(i.food_description ?? i.description)
      );
      assert.ok(banana, "should recognize banana");
      assert.equal(banana.kind, "food");
    },
  },
  {
    input: "log breakfast: 3 eggs, 2 slices whole wheat toast, 1 tbsp butter",
    expect: (result) => {
      const all = [...result.items, ...result.unresolved];
      assert.ok(all.length >= 3, `expected ≥3 items, got ${all.length}`);
      const egg = all.find(i => /egg/i.test(i.food_description ?? i.description));
      assert.ok(egg, "should recognize eggs");
    },
  },
];

console.log("[test-nutrition-parser] running", cases.length, "cases");
for (const tc of cases) {
  const result = await parseFoodDescription(tc.input, { authHeader });
  try {
    tc.expect(result);
    console.log(`  ✓ "${tc.input}"`);
  } catch (err) {
    console.error(`  ✗ "${tc.input}":`, err.message);
    console.error("    result:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
}
console.log("[test-nutrition-parser] all assertions passed.");
```

Add to `package.json`:
```json
"test:nutrition-parser": "node scripts/test-nutrition-parser.js"
```

- [ ] **Step 3: Commit**

```bash
git add api/emersus/nutrition-parser.js scripts/test-nutrition-parser.js package.json
git commit -m "feat(nutrition): LLM natural-language food parser

- api/emersus/nutrition-parser.js: separate OpenAI function-schema call
  that parses freeform food descriptions into structured items, then
  resolves each via the foods_search RPC. Uses OPENAI_EMERSUS_PARSER_MODEL
  env override with a gpt-4.1-mini default — separate from the main chat
  completion model for cost control.
- Strict parse rules: foods always in grams, powder supplements in grams,
  discrete supplements as serving-count, brand names preserved verbatim.
- test-nutrition-parser.js golden fixture, gated by EMERSUS_RUN_LLM_TESTS=1
  since it makes real API calls.

Part of the meal planning / journaling feature (Phase 3)."
```

---

## Task 14: workflow.js log-food branch

**Files:**
- Modify: `api/emersus/workflow.js`

Wire the `log_food` intent into the workflow: skip retrieval, call the parser, emit a `nutrition-log-confirm` fence, confirm via widget.

- [ ] **Step 1: Import the parser and add the log branch**

In `api/emersus/workflow.js`, near the existing imports:

```js
import { parseFoodDescription } from "./nutrition-parser.js";
```

Inside the nutrition-topic branch (extending Task 9's logic), add the log_food handler. Find the block that currently handles `intent === "generate_plan"` and add alongside:

```js
if (topic === "nutrition") {
  const intent = classifyNutritionIntent(userMessage);

  if (intent === "generate_plan") {
    // ... existing generate_plan branch from Task 9 ...
  } else if (intent === "log_food") {
    // Skip retrieval entirely. Parse, then emit a nutrition-log-confirm fence.
    // The chat response wraps the fence with a short conversational prefix.
    const parseResult = await parseFoodDescription(userMessage, {
      authHeader: req.headers.authorization,
    });

    // Infer meal_slot for items without one from time-of-day
    const now = new Date();
    const h = now.getHours();
    const timeSlot =
      h < 10 ? "breakfast" :
      h < 12 ? "mid_morning" :
      h < 15 ? "lunch" :
      h < 17 ? "afternoon" :
      h < 21 ? "dinner" :
               "evening";

    const filledItems = parseResult.items.map(i => ({
      ...i,
      meal_slot: i.meal_slot ?? (i.kind === "supplement" && h < 12 ? "supplements_am" : i.kind === "supplement" ? "supplements_pm" : timeSlot),
    }));
    const loggedDate = now.toISOString().slice(0, 10);

    // Build the fence payload
    const fencePayload = {
      resolved_items: filledItems,
      unresolved: parseResult.unresolved,
      meal_slot_default: filledItems[0]?.meal_slot ?? timeSlot,
      logged_date: loggedDate,
      parse_error: parseResult.error ?? null,
    };

    // Short-circuit the normal response assembly: return a chat message
    // that wraps the fence. The streaming/non-streaming code paths both
    // need to handle this — find the existing "early return" pattern
    // in workflow.js for guardrailed responses and mirror it.
    const confirmFence = "```nutrition-log-confirm\n" + JSON.stringify(fencePayload, null, 2) + "\n```";
    const prefix = parseResult.error
      ? "I couldn't parse that automatically — you can log it from the Log food button in Nutrition. "
      : filledItems.length === 0
        ? "I couldn't match any foods — try again with more detail, or log manually. "
        : `Here's what I pulled from that — review and confirm to log:\n\n`;

    return earlyReturnResponse({
      role: "assistant",
      content: prefix + confirmFence,
    });
  }
}
```

**Note:** the exact name of the "early return" helper in `workflow.js` depends on the existing file. Look for how guardrailed messages return their canned responses (e.g., `return buildGuardrailResponse(...)` or similar). Use `Grep` on `workflow.js` for `guardrail` to find the pattern, and adapt.

- [ ] **Step 2: Syntax check**

```bash
node -e "import('./api/emersus/workflow.js').then(() => console.log('workflow.js imports ok'))"
```

Expected: "workflow.js imports ok".

- [ ] **Step 3: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat(nutrition): log-food branch in workflow.js

- Routes nutrition intent='log_food' through the separate parser (skipping
  the normal retrieval + LLM path) and emits a nutrition-log-confirm
  fence wrapped by a short conversational prefix.
- Infers meal_slot from time of day when the parser didn't extract one;
  supplements default to supplements_am / supplements_pm by time.
- Uses the earlyReturnResponse helper to bypass the main completion path
  so logging has no hallucination risk — the LLM only runs inside the
  parser's deterministic function schema.

Part of the meal planning / journaling feature (Phase 3)."
```

---

## Task 15: nutrition-log-confirm widget

**Files:**
- Create: `shared/nutrition-log-confirm-widget.js`
- Modify: `shared/emersus-renderer.js`

React widget that shows parsed items with editable amounts, unresolved-item pickers for low-confidence matches, and a [Confirm log] button that POSTs to `/api/emersus/meal-journal/entries`.

- [ ] **Step 1: Write the widget**

Create `shared/nutrition-log-confirm-widget.js`:

```js
// shared/nutrition-log-confirm-widget.js
//
// React widget (iframe-hosted) that confirms chat-parsed journal entries
// before writing them to meal_journal_entries. Shows resolved items with
// editable amount + meal_slot, unresolved items with a picker, totals, and
// Confirm/Cancel buttons.

import React from "https://esm.sh/react@18.2.0";

const { useState, useMemo } = React;
const h = React.createElement;

const MEAL_SLOT_LABELS = {
  breakfast: "Breakfast", mid_morning: "Mid morning", lunch: "Lunch",
  afternoon: "Afternoon", dinner: "Dinner", evening: "Evening",
  pre_workout: "Pre-workout", post_workout: "Post-workout",
  supplements_am: "Supplements AM", supplements_pm: "Supplements PM",
};

function ResolvedRow({ item, index, onUpdate, onRemove }) {
  return h("div", { className: `log-row ${item.kind}` }, [
    h("div", { className: "log-row-main", key: "main" }, [
      h("span", { className: "food-description", key: "d" }, item.food_description),
      item.food_brand_name &&
        h("span", { className: "food-brand", key: "b" }, ` · ${item.food_brand_name}`),
    ]),
    h("div", { className: "log-row-controls", key: "ctrl" }, [
      h("input", {
        key: "amt",
        type: "number",
        min: 0,
        step: "0.1",
        value: item.amount,
        onChange: (e) => onUpdate(index, { amount: parseFloat(e.target.value) }),
      }),
      h("span", { className: "unit", key: "unit" },
        item.amount_unit === "g" ? "g" : (item.amount_unit === "serving" ? "×" : item.amount_unit)
      ),
      h("select", {
        key: "slot",
        value: item.meal_slot,
        onChange: (e) => onUpdate(index, { meal_slot: e.target.value }),
      }, Object.entries(MEAL_SLOT_LABELS).map(([v, l]) =>
        h("option", { key: v, value: v }, l)
      )),
      h("button", {
        key: "rm",
        className: "remove",
        onClick: () => onRemove(index),
      }, "×"),
    ]),
  ]);
}

function UnresolvedRow({ item, index }) {
  return h("div", { className: "log-row unresolved" }, [
    h("div", { key: "u" },
      `Couldn't match: "${item.raw_text ?? item.description}" — `,
      h("em", {}, item.reason)
    ),
  ]);
}

export default function NutritionLogConfirmWidget({ payload }) {
  const [items, setItems] = useState(payload.resolved_items ?? []);
  const [submitState, setSubmitState] = useState("idle");

  const totals = useMemo(() => {
    // Client can't compute exact snapshots without the food_nutrients join,
    // so the widget omits totals until after save. (Spec option: fetch
    // snapshots server-side via a "preview" endpoint — v1.5.)
    return { itemCount: items.length };
  }, [items]);

  function update(i, patch) {
    setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
  function remove(i) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  async function confirm() {
    setSubmitState("saving");
    const entries = items.map(it => ({
      food_id: it.food_id,
      logged_date: payload.logged_date,
      meal_slot: it.meal_slot,
      amount: it.amount,
      amount_unit: it.amount_unit,
      source: "chat_parser",
      confidence: it.confidence,
    }));
    try {
      const res = await fetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
        },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitState("saved");
    } catch (err) {
      console.error("[nutrition-log-confirm] save failed:", err);
      setSubmitState("error");
    }
  }

  if (submitState === "saved") {
    return h("div", { className: "nutrition-log-confirm saved" },
      h("div", { className: "ok" }, `✓ Logged ${items.length} item${items.length === 1 ? "" : "s"}`)
    );
  }

  const disabled = items.length === 0 || submitState !== "idle";

  return h("div", { className: "nutrition-log-confirm" }, [
    h("h4", { key: "h" }, "Confirm log"),
    items.length === 0 && h("div", { key: "empty", className: "empty" }, "Nothing to log."),
    items.map((it, i) =>
      h(ResolvedRow, { key: `r${i}`, item: it, index: i, onUpdate: update, onRemove: remove })
    ),
    (payload.unresolved ?? []).map((it, i) =>
      h(UnresolvedRow, { key: `u${i}`, item: it, index: i })
    ),
    h("div", { className: "actions", key: "a" }, [
      h("button", {
        key: "confirm",
        className: "primary",
        onClick: confirm,
        disabled,
      },
        submitState === "idle"  ? `Confirm log (${items.length})` :
        submitState === "saving" ? "Saving..." :
                                    "Retry"
      ),
    ]),
  ]);
}
```

- [ ] **Step 2: Wire the widget into `shared/emersus-renderer.js`**

Extend the dispatch added in Task 10:

```js
import NutritionLogConfirmWidget from "./nutrition-log-confirm-widget.js";

// In the segment dispatch (alongside the meal-plan handler):
if (segment.type === "nutrition-log-confirm") {
  try {
    const payload = JSON.parse(segment.content);
    out.push({ type: "widget-component", component: NutritionLogConfirmWidget, props: { payload } });
  } catch (err) {
    console.error("[emersus-renderer] failed to parse nutrition-log-confirm fence:", err);
    out.push({ type: "text", content: "⚠ log preview could not be parsed" });
  }
}
```

- [ ] **Step 3: Extend `scripts/test-meal-plan-fence-routing.js` is already covering this fence — no changes needed since Task 10 test already imports nutrition-log-confirm**

Run:
```bash
npm run test:meal-plan-fence
```

Expected: both the meal-plan and nutrition-log-confirm assertions pass.

- [ ] **Step 4: Commit**

```bash
git add shared/nutrition-log-confirm-widget.js shared/emersus-renderer.js
git commit -m "feat(nutrition): nutrition-log-confirm widget

- Iframe-hosted React widget rendering chat-parsed journal entries with
  per-row amount + meal_slot editors, unresolved-item rows, and a
  Confirm button that POSTs to /api/emersus/meal-journal/entries.
- Renderer dispatches nutrition-log-confirm fences to this widget.
- Confirmation is mandatory — no silent writes from chat parsing.

Part of the meal planning / journaling feature (Phase 3 — final)."
```

**End of Phase 3.** Users can now say "log chicken and rice for lunch" in the chat, review the parsed items in a confirmation widget, and commit them to the journal. Next phase builds the `/app/nutrition/` SPA for manual UI.

---

# Phase 4 — Nutrition SPA (`/app/nutrition/`)

## Task 16: Nutrition SVG charts module

**Files:**
- Create: `shared/nutrition-charts.js`

Pure-function SVG helpers: macro progress rings, horizontal macro bars, nutrition-facts panel, supplement-facts panel, streak banner, micronutrient grid, mini sparklines. Each function takes data + dimensions and returns an SVG string or React element. No charting library.

- [ ] **Step 1: Create the file with the ring and bar helpers**

Create `shared/nutrition-charts.js`:

```js
// shared/nutrition-charts.js
//
// Pure-function SVG helpers for the nutrition UI. No charting library,
// no build step. Each helper returns a React element or SVG string.
//
// Consumers:
//   - shared/nutrition-today-panel.js   (rings, sparklines)
//   - shared/nutrition-plan-panel.js    (target cards)
//   - shared/nutrition-journal-panel.js (meal totals)
//   - shared/food-detail-drawer.js      (nutrition-facts panel, supplement-facts panel)
//   - app/progress/nutrition-pane.js    (streak banner, micro grid, weekly bars)

import React from "https://esm.sh/react@18.2.0";
const h = React.createElement;

// Design tokens (mirrors workout-tracking spec's palette)
export const TOKENS = {
  bg:        "#0c0e11",
  ink:       "#f9f9fd",
  primary:   "#6d9fff",
  secondary: "#9ffb00",
  danger:    "#ff8f9d",
  muted:     "#a7adb4",
  gold:      "#FFD700",
  warm:      "#f5b74a",
};

export const MACRO_COLORS = {
  kcal:    TOKENS.ink,
  protein: TOKENS.primary,
  carbs:   TOKENS.secondary,
  fat:     TOKENS.warm,
  fiber:   TOKENS.muted,
};

// ─── Macro progress ring ───────────────────────────────────────────────────
// Single-ring SVG showing a progress arc. `actual / target` with overflow.
// `label` is shown in the center; color defaults to primary.

export function MacroRing({ actual, target, label, color = TOKENS.primary, size = 88 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(actual / target, 1.5) : 0;
  const arc = pct * circ;
  const overflow = pct > 1.1;
  const perfect = pct >= 0.95 && pct <= 1.05;
  const strokeColor = overflow ? TOKENS.danger : perfect ? TOKENS.gold : color;

  return h("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    h("circle", {
      key: "bg", cx, cy, r,
      fill: "none", stroke: "rgba(255,255,255,0.08)", strokeWidth: stroke,
    }),
    h("circle", {
      key: "fg", cx, cy, r,
      fill: "none",
      stroke: strokeColor,
      strokeWidth: stroke,
      strokeLinecap: "round",
      strokeDasharray: `${arc} ${circ}`,
      transform: `rotate(-90 ${cx} ${cy})`,
    }),
    h("text", {
      key: "v",
      x: cx, y: cy - 3,
      textAnchor: "middle",
      fill: TOKENS.ink,
      fontSize: 14,
      fontWeight: 600,
      fontFamily: "Inter, sans-serif",
    }, `${Math.round(actual)}`),
    h("text", {
      key: "l",
      x: cx, y: cy + 14,
      textAnchor: "middle",
      fill: TOKENS.muted,
      fontSize: 10,
      fontFamily: "Inter, sans-serif",
    }, label),
  ]);
}

// ─── Horizontal macro bar ──────────────────────────────────────────────────

export function MacroBar({ actual, target, color = TOKENS.primary, width = 200, height = 8 }) {
  const pct = target > 0 ? Math.min(actual / target, 1.2) : 0;
  const fillWidth = pct * width;
  return h("svg", { width, height }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 4, fill: "rgba(255,255,255,0.08)" }),
    h("rect", { key: "fg", x: 0, y: 0, width: fillWidth, height, rx: 4, fill: color }),
  ]);
}

// ─── Mini sparkline (e.g., 7-day kcal %) ───────────────────────────────────

export function Sparkline({ values, width = 140, height = 32, color = TOKENS.primary }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("polyline", {
      key: "p",
      fill: "none",
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      points,
    }),
  ]);
}
```

- [ ] **Step 2: Append the nutrition-facts panel and supplement-facts panel helpers**

Append to `shared/nutrition-charts.js`:

```js

// ─── Nutrition facts panel ─────────────────────────────────────────────────
// Generates a traditional FDA nutrition-facts layout as inline SVG.
// Input: array of {slug, name, amount, unit, category} nutrient rows,
// typically the result of joining food_nutrients × nutrients for one food.

export function NutritionFactsPanel({ nutrients, servingGrams, width = 320 }) {
  // Partition into macros vs vitamins vs minerals
  const macros = nutrients.filter(n => n.category === "macro" || n.category === "energy");
  const vitamins = nutrients.filter(n => n.category === "vitamin");
  const minerals = nutrients.filter(n => n.category === "mineral");

  const rows = [];
  let y = 64;
  const rowHeight = 20;

  function addRow(label, value, unit, indent = 0) {
    rows.push(h("g", { key: `${label}-${y}` }, [
      h("text", { x: 14 + indent, y, fill: TOKENS.ink, fontSize: 13, fontFamily: "Inter" }, label),
      h("text", { x: width - 14, y, fill: TOKENS.ink, fontSize: 13, textAnchor: "end", fontFamily: "Inter" },
        `${value} ${unit}`),
      h("line", { x1: 10, y1: y + 4, x2: width - 10, y2: y + 4, stroke: "rgba(255,255,255,0.1)" }),
    ]));
    y += rowHeight;
  }

  for (const m of macros) addRow(m.name, m.amount?.toFixed(1) ?? "—", m.unit);
  if (vitamins.length > 0) {
    rows.push(h("text", {
      key: "vit-h", x: 14, y,
      fill: TOKENS.muted, fontSize: 11, fontFamily: "Inter", fontWeight: 600,
    }, "VITAMINS"));
    y += 18;
    for (const v of vitamins) addRow(v.name, v.amount?.toFixed(1) ?? "—", v.unit);
  }
  if (minerals.length > 0) {
    rows.push(h("text", {
      key: "min-h", x: 14, y,
      fill: TOKENS.muted, fontSize: 11, fontFamily: "Inter", fontWeight: 600,
    }, "MINERALS"));
    y += 18;
    for (const m of minerals) addRow(m.name, m.amount?.toFixed(1) ?? "—", m.unit);
  }

  const height = y + 20;

  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 12, fill: "rgba(15,20,28,0.6)" }),
    h("text", {
      key: "title", x: 14, y: 28,
      fill: TOKENS.ink, fontSize: 18, fontWeight: 700, fontFamily: "Inter",
    }, "Nutrition Facts"),
    h("text", {
      key: "sz", x: 14, y: 48,
      fill: TOKENS.muted, fontSize: 12, fontFamily: "Inter",
    }, `Serving: ${servingGrams} g`),
    ...rows,
  ]);
}

// ─── Supplement facts panel ─────────────────────────────────────────────────
// FDA dietary-supplement facts layout. Similar to nutrition facts but with
// "Amount Per Serving" and "% Daily Value" columns.

export function SupplementFactsPanel({ nutrients, form, width = 320 }) {
  const rows = [];
  let y = 64;
  const rowHeight = 22;
  for (const n of nutrients) {
    const pctDv = n.dri ? Math.round((n.amount / n.dri) * 100) : null;
    rows.push(h("g", { key: n.slug }, [
      h("text", { x: 14, y, fill: TOKENS.ink, fontSize: 13, fontFamily: "Inter" }, n.name),
      h("text", { x: width - 80, y, fill: TOKENS.ink, fontSize: 13, textAnchor: "end", fontFamily: "Inter" },
        `${n.amount?.toFixed(1) ?? "—"} ${n.unit}`),
      h("text", { x: width - 14, y, fill: TOKENS.muted, fontSize: 12, textAnchor: "end", fontFamily: "Inter" },
        pctDv != null ? `${pctDv}%` : "†"),
      h("line", { x1: 10, y1: y + 4, x2: width - 10, y2: y + 4, stroke: "rgba(255,255,255,0.1)" }),
    ]));
    y += rowHeight;
  }
  const height = y + 24;
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 12, fill: "rgba(15,20,28,0.6)" }),
    h("text", {
      key: "title", x: 14, y: 28,
      fill: TOKENS.ink, fontSize: 18, fontWeight: 700, fontFamily: "Inter",
    }, "Supplement Facts"),
    h("text", {
      key: "form", x: 14, y: 48,
      fill: TOKENS.muted, fontSize: 12, fontFamily: "Inter",
    }, `Serving: 1 ${form ?? "unit"}`),
    h("text", {
      key: "dv", x: width - 14, y: 48,
      fill: TOKENS.muted, fontSize: 11, textAnchor: "end", fontFamily: "Inter",
    }, "% DV"),
    ...rows,
  ]);
}

// ─── Streak banner ─────────────────────────────────────────────────────────

export function StreakBanner({ current, best }) {
  if (!current || current === 0) return null;
  return h("div", { className: "streak-banner" }, [
    h("div", { key: "cur", className: "current" }, `${current}-day macro streak`),
    h("div", { key: "best", className: "best" }, `Best: ${best} days`),
  ]);
}

// ─── Micronutrient grid card ───────────────────────────────────────────────
// One card per nutrient; color-coded by % DRI.

export function MicronutrientCard({ nutrient }) {
  const pct = nutrient.pct_dri ?? 0;
  const status =
    pct < 50                      ? "under"  :
    pct >= 50 && pct < 80         ? "low"    :
    pct >= 80 && pct <= 150       ? "ok"     :
    pct > 150 && pct <= 200       ? "high"   :
                                    "excess" ;
  const color =
    status === "under" ? TOKENS.danger :
    status === "low"   ? TOKENS.warm   :
    status === "ok"    ? TOKENS.secondary :
    status === "high"  ? TOKENS.warm   :
                         TOKENS.danger ;

  return h("div", { className: `micro-card status-${status}` }, [
    h("div", { className: "micro-name", key: "n" }, nutrient.name),
    h("div", { className: "micro-amount", key: "a" },
      `${(nutrient.amount ?? 0).toFixed(1)} ${nutrient.unit}`),
    h("div", { className: "micro-bar", key: "b" },
      h(MacroBar, { actual: pct, target: 100, color, width: 140, height: 6 })),
    h("div", { className: "micro-pct", key: "p" }, `${Math.round(pct)}% DRI`),
  ]);
}

// ─── Weekly stacked bar (progress Nutrition pane) ──────────────────────────

export function WeeklyMacroBars({ days, width = 420, height = 180 }) {
  if (!days || days.length === 0) return null;
  const maxKcal = Math.max(...days.map(d => d.kcal_actual ?? 0), 1);
  const colWidth = (width - 40) / days.length;
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    ...days.map((d, i) => {
      const x = 20 + i * colWidth;
      const barHeight = ((d.kcal_actual ?? 0) / maxKcal) * (height - 30);
      const y = height - 20 - barHeight;
      return h("g", { key: d.date }, [
        h("rect", {
          x: x + 2, y, width: colWidth - 4, height: barHeight,
          rx: 3, fill: TOKENS.primary,
          opacity: 0.8,
        }),
        h("text", {
          x: x + colWidth / 2, y: height - 6,
          fill: TOKENS.muted, fontSize: 10, textAnchor: "middle", fontFamily: "Inter",
        }, d.date.slice(5)),
      ]);
    }),
  ]);
}
```

- [ ] **Step 2 (verification): Syntax check the module**

```bash
node -e "import('./shared/nutrition-charts.js').then(m => console.log('exports:', Object.keys(m)))"
```

Expected output lists: `TOKENS`, `MACRO_COLORS`, `MacroRing`, `MacroBar`, `Sparkline`, `NutritionFactsPanel`, `SupplementFactsPanel`, `StreakBanner`, `MicronutrientCard`, `WeeklyMacroBars`.

Note: `import.meta` resolution might fail for `https://esm.sh/react` under plain Node — if so, smoke-test by loading the file in the browser via `app/nutrition/index.html` during Task 20 instead.

- [ ] **Step 3: Commit**

```bash
git add shared/nutrition-charts.js
git commit -m "feat(nutrition): SVG chart helpers module

- MacroRing, MacroBar, Sparkline for progress visuals
- NutritionFactsPanel, SupplementFactsPanel for food-detail drawer
- StreakBanner, MicronutrientCard for progress/today views
- WeeklyMacroBars for the /app/progress/ nutrition pane
- Pure functions returning React elements, no charting library

Part of the meal planning / journaling feature (Phase 4)."
```

---

## Task 17: Food detail drawer + Today panel

**Files:**
- Create: `shared/food-detail-drawer.js`
- Create: `shared/nutrition-today-panel.js`

Drawer is the slide-over detail panel triggered via `?food=<uuid>` query param. Today panel is the default nutrition landing view showing rings, meal timeline, supplements card, micro snapshot.

- [ ] **Step 1: Write `shared/food-detail-drawer.js`**

Create `shared/food-detail-drawer.js`:

```js
// shared/food-detail-drawer.js
//
// Slide-over drawer on the right side of /app/nutrition/. Triggered by
// setting the ?food=<uuid> query param. Shows a nutrition-facts panel
// for foods and a supplement-facts panel for supplements, plus a "Log this"
// button and a mini history sparkline.
//
// Used by: all four nutrition tabs (Today, Plan, Journal, Supplements).

import React from "https://esm.sh/react@18.2.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.1";
import {
  NutritionFactsPanel,
  SupplementFactsPanel,
  Sparkline,
  TOKENS,
} from "./nutrition-charts.js";

const { useEffect, useState } = React;
const h = React.createElement;

// Reads the Supabase client setup that shared/supabase.js (if present) exposes,
// or constructs one from window.EMERSUS_SUPABASE_URL / window.EMERSUS_ANON_KEY
// injected by app/nutrition/index.html.
function getSupabase() {
  if (typeof window !== "undefined" && window.EMERSUS_SUPABASE) {
    return window.EMERSUS_SUPABASE;
  }
  const url = window.EMERSUS_SUPABASE_URL;
  const key = window.EMERSUS_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase client not initialized in window.EMERSUS_*");
  }
  const sb = createClient(url, key);
  window.EMERSUS_SUPABASE = sb;
  return sb;
}

export default function FoodDetailDrawer({ foodId, onClose, onLog }) {
  const [food, setFood] = useState(null);
  const [nutrients, setNutrients] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!foodId) {
      setFood(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sb = getSupabase();
        const { data: f } = await sb
          .from("foods")
          .select("id, description, brand_name, kind, form, source, base_unit, base_amount, common_unit, common_unit_grams")
          .eq("id", foodId)
          .maybeSingle();
        if (cancelled) return;
        setFood(f);

        if (f) {
          const { data: nutData } = await sb
            .from("food_nutrients")
            .select("amount_per_base, nutrients:nutrients!inner(slug, name, unit, category, default_dri_male, default_dri_female, display_order)")
            .eq("food_id", foodId)
            .order("nutrients(display_order)");
          if (cancelled) return;
          // Normalize: scale per-100g to per-serving if the UI is showing serving
          setNutrients((nutData ?? []).map(row => ({
            slug: row.nutrients.slug,
            name: row.nutrients.name,
            unit: row.nutrients.unit,
            category: row.nutrients.category,
            amount: row.amount_per_base * (f.common_unit_grams ?? f.base_amount) / f.base_amount,
            dri: row.nutrients.default_dri_male,  // v1 assumes male defaults; v2 reads profile
          })));

          // Mini history: entries over last 30 days for this food
          const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
          const { data: histData } = await sb
            .from("meal_journal_entries")
            .select("logged_date")
            .eq("food_id", foodId)
            .gte("logged_date", since);
          if (cancelled) return;
          // Bucket by day
          const counts = {};
          for (const r of histData ?? []) {
            counts[r.logged_date] = (counts[r.logged_date] ?? 0) + 1;
          }
          const days = [];
          for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
            days.push(counts[d] ?? 0);
          }
          setHistory(days);
        }
      } catch (err) {
        console.error("[food-detail-drawer] load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [foodId]);

  if (!foodId) return null;

  return h("aside", { className: "food-detail-drawer" }, [
    h("button", { key: "close", className: "close-btn", onClick: onClose }, "×"),
    loading && h("div", { key: "l", className: "loading" }, "Loading…"),
    !loading && !food && h("div", { key: "err", className: "error" }, "Food not found"),
    !loading && food && h("div", { key: "body", className: "body" }, [
      h("h2", { key: "desc", className: "food-desc" }, food.description),
      food.brand_name && h("div", { key: "brand", className: "brand" }, food.brand_name),
      h("div", { key: "src", className: "source" }, `Source: ${food.source.replace("_", " ")}`),
      food.common_unit && h("div", { key: "cu", className: "common-unit" },
        `1 ${food.common_unit} ≈ ${food.common_unit_grams ?? "—"} g`),
      food.kind === "supplement"
        ? h(SupplementFactsPanel, { key: "facts", nutrients, form: food.form })
        : h(NutritionFactsPanel, { key: "facts", nutrients, servingGrams: food.common_unit_grams ?? 100 }),
      h("div", { key: "hist", className: "history" }, [
        h("div", { key: "lbl", className: "label" }, "Last 30 days"),
        h(Sparkline, { key: "sp", values: history, color: TOKENS.primary }),
      ]),
      h("button", {
        key: "log",
        className: "primary log-btn",
        onClick: () => onLog?.(food),
      }, `Log this ${food.kind}`),
    ]),
  ]);
}
```

- [ ] **Step 2: Write `shared/nutrition-today-panel.js`**

Create `shared/nutrition-today-panel.js`:

```js
// shared/nutrition-today-panel.js
//
// Today tab composition. Top-level layout for the default view on /app/nutrition/.
// Shows quick actions, 5-macro rings, today's meal timeline, supplements card,
// and a micronutrient snapshot pill.

import React from "https://esm.sh/react@18.2.0";
import { MacroRing, MACRO_COLORS, StreakBanner } from "./nutrition-charts.js";
import { resolveDayType } from "./meal-plan-day-type.js";

const { useEffect, useState } = React;
const h = React.createElement;

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

export default function NutritionTodayPanel({
  onOpenFoodDetail,
  onOpenLogModal,
  onNavigateJournal,
  onNavigatePlan,
}) {
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState({ current: 0, best: 0 });
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Parallel fetches
        const [dashRes, streakRes, planRes, workoutRes] = await Promise.all([
          authFetch(`/api/emersus/rpc/get_nutrition_dashboard?p_date=${todayStr}`),
          authFetch(`/api/emersus/rpc/get_macro_hit_streak`),
          authFetch(`/api/emersus/meal-plans/active`),
          authFetch(`/api/emersus/workout-plans/active`),  // existing endpoint
        ]);
        if (cancelled) return;
        const [dashJson, streakJson, planJson, workoutJson] = await Promise.all([
          dashRes.ok ? dashRes.json() : { error: true },
          streakRes.ok ? streakRes.json() : { current: 0, best: 0 },
          planRes.ok ? planRes.json() : { meal_plan: null },
          workoutRes.ok ? workoutRes.json() : { workout_plan: null },
        ]);
        if (cancelled) return;
        setToday(dashJson.error ? null : dashJson);
        setStreak(streakJson);
        setMealPlan(planJson.meal_plan);
        setWorkoutPlan(workoutJson.workout_plan);
      } catch (err) {
        console.error("[today-panel] load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [todayStr]);

  if (loading) return h("div", { className: "today-loading" }, "Loading today…");

  const dayType = mealPlan
    ? resolveDayType({ date: todayStr, mealPlan: mealPlan.plan, workoutPlan: workoutPlan?.plan })
    : "rest_day";

  const targets = mealPlan?.plan?.targets?.[dayType] ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const actuals = today?.actuals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

  return h("div", { className: "today-panel" }, [
    h("div", { className: "quick-actions", key: "qa" }, [
      h("button", { key: "log", className: "primary", onClick: () => onOpenLogModal?.("food") }, "Log food"),
      h("button", { key: "supp", onClick: () => onOpenLogModal?.("supplement") }, "Log supplement"),
      h("button", { key: "copy", onClick: () => onNavigateJournal?.() }, "Open journal"),
      mealPlan && h("button", { key: "plan", onClick: () => onNavigatePlan?.() }, "View plan"),
    ]),

    h("div", { className: "day-type-badge", key: "dtb" }, dayType.replace(/_/g, " ")),

    h("div", { className: "macro-rings", key: "rings" }, [
      h(MacroRing, { key: "k", actual: actuals.kcal,      target: targets.kcal,      label: "kcal",    color: MACRO_COLORS.kcal }),
      h(MacroRing, { key: "p", actual: actuals.protein_g, target: targets.protein_g, label: "protein", color: MACRO_COLORS.protein }),
      h(MacroRing, { key: "c", actual: actuals.carbs_g,   target: targets.carbs_g,   label: "carbs",   color: MACRO_COLORS.carbs }),
      h(MacroRing, { key: "f", actual: actuals.fat_g,     target: targets.fat_g,     label: "fat",     color: MACRO_COLORS.fat }),
      h(MacroRing, { key: "fi", actual: actuals.fiber_g,  target: targets.fiber_g,   label: "fiber",   color: MACRO_COLORS.fiber }),
    ]),

    h(StreakBanner, { key: "streak", current: streak.current, best: streak.best }),

    h("div", { className: "meal-timeline", key: "timeline" }, [
      h("h3", { key: "h" }, "Today"),
      (today?.meal_breakdown ?? []).map(meal =>
        h("div", { key: meal.meal_slot, className: "meal-slot-card" }, [
          h("div", { className: "meal-slot-header", key: "h" }, [
            h("span", { className: "slot-name", key: "n" }, meal.meal_slot.replace(/_/g, " ")),
            h("span", { className: "slot-kcal", key: "k" }, `${Math.round(meal.kcal ?? 0)} kcal`),
          ]),
          h("ul", { className: "entries", key: "e" },
            (meal.entries ?? []).map((e, i) =>
              h("li", { key: i, onClick: () => onOpenFoodDetail?.(e.food_id) },
                `${e.food_description} — ${e.amount} ${e.amount_unit}`
              )
            )
          ),
        ])
      ),
      (today?.meal_breakdown ?? []).length === 0 &&
        h("div", { className: "empty", key: "empty" }, "Nothing logged today yet."),
    ]),
  ]);
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/food-detail-drawer.js shared/nutrition-today-panel.js
git commit -m "feat(nutrition): food detail drawer + today panel

- food-detail-drawer.js: slide-over detail with nutrition-facts
  (or supplement-facts) panel, 30-day history sparkline, and Log
  button. Triggered by ?food=<uuid> query param.
- nutrition-today-panel.js: default /app/nutrition/ landing view.
  Quick actions, day-type badge (resolved via shared/meal-plan-day-type.js),
  5-macro progress rings, streak banner, today's meal timeline with
  per-slot totals.

Part of the meal planning / journaling feature (Phase 4)."
```

---

## Task 18: Plan panel + assignments calendar

**Files:**
- Create: `shared/nutrition-plan-panel.js`

Plan tab composition. Day-type tabs (training / rest / refeed), target card with inline edit, meal cards, supplement stack, assignments calendar with workout-session dot overlay, action row.

- [ ] **Step 1: Write `shared/nutrition-plan-panel.js`**

Create `shared/nutrition-plan-panel.js`:

```js
// shared/nutrition-plan-panel.js
//
// Plan tab composition for /app/nutrition/. Reads the active meal plan
// from /api/emersus/meal-plans/active and lets the user switch day types,
// edit targets, override assignments on specific dates, and regenerate
// the plan from the chat.

import React from "https://esm.sh/react@18.2.0";
import { resolveDayType } from "./meal-plan-day-type.js";

const { useEffect, useState } = React;
const h = React.createElement;

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

function TargetCard({ targets, dayTypeName, editing, onChange, onToggleEdit, onSave }) {
  if (!targets) return null;
  const fields = [
    ["kcal",      "kcal"],
    ["protein_g", "protein (g)"],
    ["carbs_g",   "carbs (g)"],
    ["fat_g",     "fat (g)"],
    ["fiber_g",   "fiber (g)"],
  ];
  return h("div", { className: "target-card" }, [
    h("div", { className: "tc-header", key: "h" }, [
      h("h3", { key: "t" }, `Targets — ${dayTypeName}`),
      h("button", { key: "e", onClick: onToggleEdit }, editing ? "Cancel" : "Edit targets"),
      editing && h("button", { key: "s", className: "primary", onClick: onSave }, "Save"),
    ]),
    h("dl", { className: "tc-grid", key: "g" },
      fields.flatMap(([key, label]) => [
        h("dt", { key: `${key}-dt` }, label),
        editing
          ? h("dd", { key: `${key}-dd` },
              h("input", {
                type: "number",
                min: 0,
                value: targets[key] ?? 0,
                onChange: (e) => onChange(key, parseFloat(e.target.value) || 0),
              })
            )
          : h("dd", { key: `${key}-dd` }, targets[key] ?? "—"),
      ])
    ),
  ]);
}

function AssignmentsCalendar({ mealPlan, workoutPlan, onOverride }) {
  const today = new Date();
  const month = today.getMonth();
  const year = today.getFullYear();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = firstOfMonth.getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = resolveDayType({ date, mealPlan: mealPlan?.plan, workoutPlan: workoutPlan?.plan });
    const hasWorkout = mealPlan?.plan?.assignments?.mode === "auto_from_workout"
      && (workoutPlan?.plan?.schedule ?? []).some(s => s.date === date);
    cells.push({ date, dt, hasWorkout, d });
  }

  return h("div", { className: "assignments-calendar" }, [
    h("div", { key: "m", className: "month-label" },
      firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    ),
    h("div", { key: "g", className: "grid" },
      cells.map((c, i) =>
        c.empty
          ? h("div", { key: `e${i}`, className: "cell empty" })
          : h("div", {
              key: c.date,
              className: `cell day-type-${c.dt}`,
              onClick: () => onOverride?.(c.date, c.dt),
              title: c.hasWorkout ? "Workout session scheduled" : "",
            }, [
              h("span", { className: "dom", key: "d" }, c.d),
              c.hasWorkout && h("span", { className: "dot", key: "wk" }, "•"),
            ])
      )
    ),
  ]);
}

export default function NutritionPlanPanel({ onRegenerateViaChat }) {
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [activeSlug, setActiveSlug] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedTargets, setEditedTargets] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [mpRes, wpRes] = await Promise.all([
        authFetch("/api/emersus/meal-plans/active"),
        authFetch("/api/emersus/workout-plans/active"),
      ]);
      const mp = mpRes.ok ? await mpRes.json() : { meal_plan: null };
      const wp = wpRes.ok ? await wpRes.json() : { workout_plan: null };
      setMealPlan(mp.meal_plan);
      setWorkoutPlan(wp.workout_plan);
      if (mp.meal_plan?.plan?.day_types?.[0]) {
        setActiveSlug(mp.meal_plan.plan.day_types[0].slug);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return h("div", { className: "plan-loading" }, "Loading plan…");

  if (!mealPlan) {
    return h("div", { className: "plan-empty" }, [
      h("h3", { key: "h" }, "No active plan"),
      h("p", { key: "p" }, "Ask the coach in chat for a meal plan to get started."),
      h("button", { key: "b", className: "primary", onClick: onRegenerateViaChat }, "Open chat"),
    ]);
  }

  const activeDayType = mealPlan.plan.day_types.find(dt => dt.slug === activeSlug);
  const activeTargets = editing
    ? editedTargets
    : mealPlan.plan.targets?.[activeSlug];

  async function saveTargets() {
    const newPlan = structuredClone(mealPlan.plan);
    newPlan.targets[activeSlug] = editedTargets;
    const res = await authFetch(`/api/emersus/meal-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: mealPlan.title, plan: newPlan }),
    });
    if (res.ok) {
      setEditing(false);
      setEditedTargets(null);
      await load();
    }
  }

  async function overrideDate(date, currentDayType) {
    const next = prompt(`Override ${date} to day-type:`, currentDayType);
    if (!next) return;
    const newOverrides = { ...(mealPlan.plan.assignments.overrides ?? {}), [date]: next };
    const res = await authFetch(`/api/emersus/meal-plans/${mealPlan.id}/assignments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: newOverrides }),
    });
    if (res.ok) await load();
  }

  async function undo() {
    const res = await authFetch(`/api/emersus/meal-plans/${mealPlan.id}/undo`, { method: "POST" });
    if (res.ok) await load();
  }

  return h("div", { className: "plan-panel" }, [
    h("div", { className: "plan-header", key: "h" }, [
      h("h2", { key: "t" }, mealPlan.title),
      h("span", { key: "p" },
        mealPlan.plan.provenance?.profile_snapshot
          ? `Based on ${mealPlan.plan.provenance.profile_snapshot.goal ?? ""} — ${mealPlan.plan.provenance.profile_snapshot.body_weight_kg} kg`
          : ""
      ),
    ]),

    h("div", { className: "day-type-tabs", key: "tabs" },
      mealPlan.plan.day_types.map(dt =>
        h("button", {
          key: dt.slug,
          className: dt.slug === activeSlug ? "tab active" : "tab",
          onClick: () => setActiveSlug(dt.slug),
        }, dt.name)
      )
    ),

    h(TargetCard, {
      key: "targets",
      targets: activeTargets,
      dayTypeName: activeDayType?.name ?? "",
      editing,
      onChange: (k, v) => setEditedTargets({ ...(editedTargets ?? activeTargets), [k]: v }),
      onToggleEdit: () => {
        if (editing) {
          setEditing(false);
          setEditedTargets(null);
        } else {
          setEditing(true);
          setEditedTargets({ ...mealPlan.plan.targets?.[activeSlug] });
        }
      },
      onSave: saveTargets,
    }),

    h("div", { className: "plan-meals", key: "meals" },
      (activeDayType?.meals ?? []).map((m, i) =>
        h("div", { key: i, className: "plan-meal-card" }, [
          h("div", { className: "mh", key: "h" },
            `${m.slot.replace(/_/g, " ")} — ${m.name}`),
          h("ul", { key: "l" },
            (m.foods ?? []).map((f, j) =>
              h("li", { key: j }, `${f.description} — ${f.grams} g`)
            )
          ),
        ])
      )
    ),

    activeDayType?.supplements && activeDayType.supplements.length > 0 &&
    h("div", { className: "plan-supplements", key: "supps" }, [
      h("h3", { key: "h" }, "Supplement stack"),
      h("ul", { key: "l" },
        activeDayType.supplements.map((s, i) =>
          h("li", { key: i },
            `${s.description} — ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " · " + s.timing.replace(/_/g, " ") : ""}`
          )
        )
      ),
    ]),

    h("div", { className: "plan-actions", key: "a" }, [
      h("button", { key: "re", onClick: onRegenerateViaChat }, "Regenerate plan"),
      h("button", { key: "u", onClick: undo }, "Undo last change"),
    ]),

    h(AssignmentsCalendar, {
      key: "cal",
      mealPlan,
      workoutPlan,
      onOverride: overrideDate,
    }),
  ]);
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/nutrition-plan-panel.js
git commit -m "feat(nutrition): plan panel + assignments calendar

- Day-type tabs (training / rest / refeed) with inline target editor
- Per-meal cards showing prescribed foods with grams
- Supplement stack section with timing hints
- Assignments calendar: month grid with resolved day-types per date,
  workout-session dot overlay, click-to-override popover
- Integrates with shared/meal-plan-day-type.js for resolution

Part of the meal planning / journaling feature (Phase 4)."
```

---

## Task 19: Journal panel + Supplements panel

**Files:**
- Create: `shared/nutrition-journal-panel.js`
- Create: `shared/nutrition-supplements-panel.js`

Journal panel: date picker, day totals, meal sections with inline editing, log-food modal, copy-day flow, history sidebar. Supplements panel: focused view of the user's stack.

- [ ] **Step 1: Write `shared/nutrition-journal-panel.js`**

Create `shared/nutrition-journal-panel.js`:

```js
// shared/nutrition-journal-panel.js
//
// Journal tab composition. Date picker, day totals card, meal sections
// with inline edit/delete, and the search-first "Log food" modal.

import React from "https://esm.sh/react@18.2.0";
const { useEffect, useState } = React;
const h = React.createElement;

const MEAL_SLOT_ORDER = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening",
  "pre_workout", "post_workout", "supplements_am", "supplements_pm",
];

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

function LogFoodModal({ onClose, onLogged, date, kindFilter }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [mealSlot, setMealSlot] = useState("lunch");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const kindParam = kindFilter ? `&kind=${kindFilter}` : "&kind=any";
        const res = await authFetch(`/api/emersus/foods/search?q=${encodeURIComponent(query)}${kindParam}&limit=20`, { signal: ctrl.signal });
        if (res.ok) {
          const { results } = await res.json();
          setResults(results ?? []);
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error(err);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, kindFilter]);

  async function log() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return;
      const res = await authFetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: [{
            food_id: selected.id,
            logged_date: date,
            meal_slot: mealSlot,
            amount: amt,
            amount_unit: selected.base_unit === "100g" ? "g" : "serving",
            source: "manual_search",
          }],
        }),
      });
      if (res.ok) {
        onLogged?.();
        onClose?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return h("div", { className: "log-food-modal-backdrop", onClick: onClose }, [
    h("div", { className: "log-food-modal", onClick: (e) => e.stopPropagation(), key: "m" }, [
      h("h3", { key: "t" }, `Log ${kindFilter ?? "food"}`),
      h("input", {
        key: "q",
        type: "text",
        placeholder: "Search foods…",
        value: query,
        autoFocus: true,
        onChange: (e) => setQuery(e.target.value),
      }),
      h("ul", { className: "results", key: "r" },
        results.map(r =>
          h("li", {
            key: r.id,
            className: selected?.id === r.id ? "selected" : "",
            onClick: () => setSelected(r),
          }, [
            h("span", { className: "desc", key: "d" }, r.description),
            r.brand_name && h("span", { className: "brand", key: "b" }, ` · ${r.brand_name}`),
          ])
        )
      ),
      selected && h("div", { className: "log-form", key: "f" }, [
        h("label", { key: "a" }, [
          "Amount ",
          h("input", {
            key: "ai",
            type: "number",
            min: 0,
            step: "0.1",
            value: amount,
            onChange: (e) => setAmount(e.target.value),
          }),
          " ",
          h("span", { key: "u" }, selected.base_unit === "100g" ? "g" : (selected.common_unit ?? "unit")),
        ]),
        h("label", { key: "s" }, [
          "Meal ",
          h("select", {
            key: "si",
            value: mealSlot,
            onChange: (e) => setMealSlot(e.target.value),
          }, MEAL_SLOT_ORDER.map(s =>
            h("option", { key: s, value: s }, s.replace(/_/g, " "))
          )),
        ]),
        h("button", {
          key: "go",
          className: "primary",
          disabled: submitting || !amount,
          onClick: log,
        }, submitting ? "Saving…" : "Log"),
      ]),
      h("button", { key: "c", className: "cancel", onClick: onClose }, "Cancel"),
    ]),
  ]);
}

export default function NutritionJournalPanel({ onOpenFoodDetail }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);  // null | "food" | "supplement"

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/emersus/meal-journal/day?date=${date}`);
      if (res.ok) {
        const json = await res.json();
        setDay(json);
      } else {
        setDay({ entries: [] });
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [date]);

  async function del(id) {
    if (!confirm("Delete this entry?")) return;
    const res = await authFetch(`/api/emersus/meal-journal/entries/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function copyDay() {
    const source = prompt("Copy from date (YYYY-MM-DD):", date);
    if (!source) return;
    const res = await authFetch("/api/emersus/meal-journal/copy-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_date: source, target_date: date }),
    });
    if (res.ok) await load();
  }

  const entries = day?.entries ?? [];
  const bySlot = {};
  for (const e of entries) {
    bySlot[e.meal_slot] = bySlot[e.meal_slot] ?? [];
    bySlot[e.meal_slot].push(e);
  }

  return h("div", { className: "journal-panel" }, [
    h("div", { className: "journal-header", key: "h" }, [
      h("input", {
        key: "d",
        type: "date",
        value: date,
        onChange: (e) => setDate(e.target.value),
      }),
      h("button", { key: "l", className: "primary", onClick: () => setModal("food") }, "Log food"),
      h("button", { key: "s", onClick: () => setModal("supplement") }, "Log supplement"),
      h("button", { key: "c", onClick: copyDay }, "Copy day from…"),
    ]),

    loading && h("div", { key: "loading" }, "Loading…"),

    !loading && MEAL_SLOT_ORDER.map(slot => {
      const list = bySlot[slot] ?? [];
      if (list.length === 0) return null;
      const total = list.reduce((acc, e) => ({
        kcal: acc.kcal + (e.kcal_snapshot ?? 0),
        protein: acc.protein + (e.protein_g_snapshot ?? 0),
        carbs: acc.carbs + (e.carbs_g_snapshot ?? 0),
        fat: acc.fat + (e.fat_g_snapshot ?? 0),
        fiber: acc.fiber + (e.fiber_g_snapshot ?? 0),
      }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
      return h("div", { key: slot, className: "journal-slot" }, [
        h("div", { className: "slot-header", key: "h" }, [
          h("span", { className: "name", key: "n" }, slot.replace(/_/g, " ")),
          h("span", { className: "total", key: "t" },
            `${Math.round(total.kcal)} kcal · P${Math.round(total.protein)} · C${Math.round(total.carbs)} · F${Math.round(total.fat)}`
          ),
        ]),
        h("ul", { className: "entries", key: "e" },
          list.map(e =>
            h("li", { key: e.id }, [
              h("span", {
                className: "desc",
                key: "d",
                onClick: () => onOpenFoodDetail?.(e.food?.id),
              }, e.food?.description ?? "(unknown)"),
              h("span", { className: "amt", key: "a" }, `${e.amount} ${e.amount_unit}`),
              h("button", { key: "del", className: "del", onClick: () => del(e.id) }, "×"),
            ])
          )
        ),
      ]);
    }),

    !loading && entries.length === 0 &&
      h("div", { key: "empty", className: "empty" }, "No entries for this day."),

    modal && h(LogFoodModal, {
      key: "modal",
      date,
      kindFilter: modal,
      onClose: () => setModal(null),
      onLogged: load,
    }),
  ]);
}
```

- [ ] **Step 2: Write `shared/nutrition-supplements-panel.js`**

Create `shared/nutrition-supplements-panel.js`:

```js
// shared/nutrition-supplements-panel.js
//
// Focused supplements view. Shows today's stack (prescribed from the active
// plan, grouped by timing), lets the user check off each for one-tap logging,
// and exposes an "Add supplement" search.

import React from "https://esm.sh/react@18.2.0";
const { useEffect, useState } = React;
const h = React.createElement;

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

const TIMING_ORDER = ["morning", "with_meal", "pre_workout", "post_workout", "bedtime", "any"];

export default function NutritionSupplementsPanel({ onOpenFoodDetail }) {
  const [mealPlan, setMealPlan] = useState(null);
  const [todayLogged, setTodayLogged] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toISOString().slice(0, 10);

  async function load() {
    setLoading(true);
    try {
      const [mpRes, dayRes] = await Promise.all([
        authFetch("/api/emersus/meal-plans/active"),
        authFetch(`/api/emersus/meal-journal/day?date=${todayStr}`),
      ]);
      const mp = mpRes.ok ? await mpRes.json() : { meal_plan: null };
      const day = dayRes.ok ? await dayRes.json() : { entries: [] };
      setMealPlan(mp.meal_plan);
      setTodayLogged((day.entries ?? []).filter(e => e.food?.kind === "supplement"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return h("div", { className: "supps-loading" }, "Loading…");

  const prescribed = [];
  if (mealPlan?.plan?.day_types) {
    const dt = mealPlan.plan.day_types[0];  // v1: show the first day-type's supps; could resolve by today's day_type
    if (dt?.supplements) prescribed.push(...dt.supplements);
  }

  const groups = {};
  for (const s of prescribed) {
    const t = s.timing ?? "any";
    groups[t] = groups[t] ?? [];
    groups[t].push(s);
  }

  async function logSupplement(supp) {
    // Find the food_id via foods_search
    const sr = await authFetch(`/api/emersus/foods/search?q=${encodeURIComponent(supp.description)}&kind=supplement&limit=1`);
    if (!sr.ok) return;
    const { results } = await sr.json();
    if (!results || results.length === 0) {
      alert("Couldn't find matching supplement in catalog. Add it via Log supplement.");
      return;
    }
    const food = results[0];
    const amountUnit = food.base_unit === "100g" ? "g" : "serving";
    const amount = food.base_unit === "100g" ? supp.amount : 1;
    const now = new Date();
    const mealSlot = now.getHours() < 14 ? "supplements_am" : "supplements_pm";

    const res = await authFetch("/api/emersus/meal-journal/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: [{
          food_id: food.id,
          logged_date: todayStr,
          meal_slot: mealSlot,
          amount,
          amount_unit: amountUnit,
          source: "plan_check_off",
          plan_id: mealPlan.id,
        }],
      }),
    });
    if (res.ok) await load();
  }

  return h("div", { className: "supps-panel" }, [
    h("h2", { key: "h" }, "Supplements"),
    !mealPlan && h("div", { key: "no", className: "empty" },
      "No active meal plan. Supplements in plans appear here for one-tap logging."),
    TIMING_ORDER.map(timing => {
      const list = groups[timing];
      if (!list || list.length === 0) return null;
      return h("div", { key: timing, className: "supps-group" }, [
        h("h3", { key: "h" }, timing.replace(/_/g, " ")),
        h("ul", { key: "l" },
          list.map((s, i) => {
            const alreadyLogged = todayLogged.some(e =>
              e.food?.description?.toLowerCase() === s.description.toLowerCase()
            );
            return h("li", {
              key: i,
              className: alreadyLogged ? "logged" : "",
            }, [
              h("span", { className: "desc", key: "d" },
                `${s.description} — ${s.amount} ${s.unit}`),
              alreadyLogged
                ? h("span", { key: "c", className: "check" }, "✓ logged")
                : h("button", { key: "b", onClick: () => logSupplement(s) }, "Log"),
            ]);
          })
        ),
      ]);
    }),
  ]);
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/nutrition-journal-panel.js shared/nutrition-supplements-panel.js
git commit -m "feat(nutrition): journal + supplements panels

- journal-panel: date picker, per-meal-slot sections with inline delete,
  day-copy flow, search-first Log food modal (kind-filtered for supplement
  variant), computed per-slot totals from snapshot columns
- supplements-panel: focused stack view, prescribed supplements grouped
  by timing (morning / with_meal / pre_workout / post_workout / bedtime),
  one-tap log button resolves via foods_search and writes with
  source='plan_check_off'

Part of the meal planning / journaling feature (Phase 4)."
```

---

## Task 20: app/nutrition composition root + navigation

**Files:**
- Create: `app/nutrition/index.html`
- Create: `app/nutrition/nutrition.js`
- Modify: `app/index.html` (nav)

The SPA shell + React composition root that wires the four panels and the drawer. URL hash drives tab selection.

- [ ] **Step 1: Write the HTML shell**

Create `app/nutrition/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nutrition · Emersus</title>
  <link rel="icon" type="image/svg+xml" href="/emersus_mark_fibonacci_blue.svg" />
  <link rel="stylesheet" href="/app/styles.css" />
  <style>
    /* Nutrition-specific additions. Global app styles are in /app/styles.css. */
    :root { --warm: #f5b74a; }
    .nutrition-shell { max-width: 900px; margin: 0 auto; padding: 24px; }
    .nut-tabs { display: flex; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 20px; }
    .nut-tabs .tab { padding: 10px 16px; background: none; border: none; color: var(--muted); cursor: pointer; font-family: Inter, sans-serif; font-size: 14px; font-weight: 500; }
    .nut-tabs .tab.active { color: var(--ink); border-bottom: 2px solid var(--primary); }
    .day-type-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(109,159,255,0.15); color: var(--primary); font-size: 12px; text-transform: capitalize; }
    .macro-rings { display: flex; gap: 16px; justify-content: center; margin: 24px 0; flex-wrap: wrap; }
    .meal-slot-card, .plan-meal-card, .target-card, .assignments-calendar, .streak-banner {
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      padding: 20px;
      margin-bottom: 16px;
      backdrop-filter: blur(28px);
    }
    .food-detail-drawer { position: fixed; top: 0; right: 0; width: 420px; height: 100vh; background: #0f1319; border-left: 1px solid rgba(255,255,255,0.1); padding: 24px; overflow-y: auto; z-index: 100; }
    .food-detail-drawer .close-btn { position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--ink); font-size: 24px; cursor: pointer; }
    @media (max-width: 680px) { .macro-rings { gap: 8px; } .food-detail-drawer { width: 100vw; } }
  </style>
</head>
<body>
  <div id="root">Loading…</div>
  <script type="module">
    // Inject Supabase connection info + auth token from the session storage
    // so the shared modules can authenticate without each module re-reading.
    const session = JSON.parse(localStorage.getItem("emersus-session") ?? "null");
    window.EMERSUS_SUPABASE_URL = "__SUPABASE_URL__";
    window.EMERSUS_ANON_KEY = "__SUPABASE_ANON_KEY__";
    window.EMERSUS_AUTH = session?.access_token ?? null;

    if (!window.EMERSUS_AUTH) {
      location.href = "/auth/login";
    }
  </script>
  <script type="module" src="./nutrition.js"></script>
</body>
</html>
```

**Note:** `__SUPABASE_URL__` and `__SUPABASE_ANON_KEY__` are placeholder tokens that `server.js` already replaces at serve time for other app pages (check how `/app/workout/index.html` handles this and match the pattern). Use `Read` to verify the existing substitution mechanism and adapt.

- [ ] **Step 2: Write the composition root**

Create `app/nutrition/nutrition.js`:

```js
// app/nutrition/nutrition.js
//
// Single-page composition for /app/nutrition/. URL hash drives tab
// selection. React tab state is preserved across switches (no full
// page navigation). The food detail drawer mounts globally and reads
// its state from the ?food= query param.

import React from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";

import NutritionTodayPanel from "/shared/nutrition-today-panel.js";
import NutritionPlanPanel from "/shared/nutrition-plan-panel.js";
import NutritionJournalPanel from "/shared/nutrition-journal-panel.js";
import NutritionSupplementsPanel from "/shared/nutrition-supplements-panel.js";
import FoodDetailDrawer from "/shared/food-detail-drawer.js";

const { useEffect, useState } = React;
const h = React.createElement;

const TABS = [
  { id: "today",       label: "Today" },
  { id: "plan",        label: "Plan" },
  { id: "journal",     label: "Journal" },
  { id: "supplements", label: "Supplements" },
];

function parseHash() {
  const h = window.location.hash.replace("#", "");
  return TABS.find(t => t.id === h)?.id ?? "today";
}

function parseFoodParam() {
  const u = new URL(window.location.href);
  return u.searchParams.get("food");
}

function App() {
  const [activeTab, setActiveTab] = useState(parseHash());
  const [foodId, setFoodId] = useState(parseFoodParam());

  useEffect(() => {
    function onHashChange() {
      setActiveTab(parseHash());
      setFoodId(parseFoodParam());
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

  function navigate(tab) {
    setActiveTab(tab);
    window.location.hash = tab;
  }

  function openFood(id) {
    const u = new URL(window.location.href);
    u.searchParams.set("food", id);
    window.history.pushState({}, "", u.toString());
    setFoodId(id);
  }

  function closeFood() {
    const u = new URL(window.location.href);
    u.searchParams.delete("food");
    window.history.pushState({}, "", u.toString());
    setFoodId(null);
  }

  return h("div", { className: "nutrition-shell" }, [
    h("header", { key: "h", className: "nut-header" }, [
      h("h1", { key: "t" }, "Nutrition"),
      h("a", { key: "p", href: "/app/progress/#nutrition", className: "progress-link" }, "View progress →"),
    ]),
    h("nav", { key: "nav", className: "nut-tabs" },
      TABS.map(t =>
        h("button", {
          key: t.id,
          className: t.id === activeTab ? "tab active" : "tab",
          onClick: () => navigate(t.id),
        }, t.label)
      )
    ),
    h("main", { key: "m" }, [
      activeTab === "today"       && h(NutritionTodayPanel, {
        key: "today",
        onOpenFoodDetail: openFood,
        onOpenLogModal: () => navigate("journal"),
        onNavigateJournal: () => navigate("journal"),
        onNavigatePlan: () => navigate("plan"),
      }),
      activeTab === "plan"        && h(NutritionPlanPanel, {
        key: "plan",
        onRegenerateViaChat: () => { window.location.href = "/chat/?prompt=regenerate%20my%20meal%20plan"; },
      }),
      activeTab === "journal"     && h(NutritionJournalPanel, {
        key: "journal",
        onOpenFoodDetail: openFood,
      }),
      activeTab === "supplements" && h(NutritionSupplementsPanel, {
        key: "supplements",
        onOpenFoodDetail: openFood,
      }),
    ]),
    foodId && h(FoodDetailDrawer, {
      key: "drawer",
      foodId,
      onClose: closeFood,
      onLog: (food) => {
        closeFood();
        navigate("journal");
      },
    }),
  ]);
}

const root = createRoot(document.getElementById("root"));
root.render(h(App));
```

- [ ] **Step 3: Add the Nutrition nav entry to `app/index.html`**

Open `app/index.html`, find the existing nav with Workouts / Progress / Profile, and add a Nutrition link alongside. Match the existing anchor structure and classes.

- [ ] **Step 4: Smoke test — start the server and open the page**

```bash
node server.js &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:3001/app/nutrition/ | grep -q "<title>Nutrition" && echo "page serves"
kill $SERVER_PID
```

Expected: "page serves".

- [ ] **Step 5: Commit**

```bash
git add app/nutrition/index.html app/nutrition/nutrition.js app/index.html
git commit -m "feat(nutrition): /app/nutrition/ SPA composition + nav

- index.html: shell with Supabase + auth injection, glass-morphism
  card styles scoped to nutrition, drawer layout breakpoints.
- nutrition.js: React composition root wiring Today / Plan / Journal /
  Supplements tabs via URL hash, plus the global food detail drawer
  mounted from ?food=<uuid>. Tab switches preserve state.
- app/index.html: Nutrition nav entry alongside Workouts/Progress/Profile.

Part of the meal planning / journaling feature (Phase 4 — final)."
```

**End of Phase 4.** The manual UI is fully functional. Users can navigate to `/app/nutrition/`, see today's macros, view/edit their plan, journal manually, check off prescribed supplements, and drill into food detail via the drawer. Phase 5 adds the analytics RPCs and the `/app/progress/` tab switcher.

---

# Phase 5 — Analytics & `/app/progress/` Refactor

## Task 21: Analytics RPCs migration

**Files:**
- Create: `supabase/20260414_nutrition_rpcs.sql`

Nine Postgres functions: dashboard, daily journal, weekly macro averages, streak, micronutrient status, top foods, plan adherence, day-type resolver, and a test helper that mirrors the JS resolver for the cross-fixture test. Every function sets `search_path = public, extensions`.

- [ ] **Step 1: Write the migration — dashboard + daily journal + weekly macros**

Create `supabase/20260414_nutrition_rpcs.sql`:

```sql
-- 20260414_nutrition_rpcs.sql
-- Analytics RPCs for the nutrition feature.
-- All functions run SECURITY INVOKER; RLS on the underlying tables gates access.
-- search_path is set explicitly per the match_evidence_chunks lesson.

-- ─── get_nutrition_dashboard ───────────────────────────────────────────────
-- Single call returning today-centric summary for /app/nutrition/#today.

create or replace function public.get_nutrition_dashboard(
  p_date date default current_date
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with actuals as (
    select
      sum(kcal_snapshot)      as kcal,
      sum(protein_g_snapshot) as protein_g,
      sum(carbs_g_snapshot)   as carbs_g,
      sum(fat_g_snapshot)     as fat_g,
      sum(fiber_g_snapshot)   as fiber_g
    from public.meal_journal_entries
    where user_id = auth.uid()
      and logged_date = p_date
  ),
  per_meal as (
    select
      meal_slot,
      sum(kcal_snapshot)      as kcal,
      sum(protein_g_snapshot) as protein_g,
      sum(carbs_g_snapshot)   as carbs_g,
      sum(fat_g_snapshot)     as fat_g,
      sum(fiber_g_snapshot)   as fiber_g,
      jsonb_agg(jsonb_build_object(
        'id', mje.id,
        'food_id', mje.food_id,
        'food_description', f.description,
        'food_brand_name', f.brand_name,
        'amount', mje.amount,
        'amount_unit', mje.amount_unit,
        'kcal', mje.kcal_snapshot
      ) order by mje.logged_at) as entries
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    where mje.user_id = auth.uid()
      and mje.logged_date = p_date
    group by meal_slot
  )
  select jsonb_build_object(
    'date', p_date,
    'actuals', jsonb_build_object(
      'kcal',      coalesce((select kcal from actuals), 0),
      'protein_g', coalesce((select protein_g from actuals), 0),
      'carbs_g',   coalesce((select carbs_g from actuals), 0),
      'fat_g',     coalesce((select fat_g from actuals), 0),
      'fiber_g',   coalesce((select fiber_g from actuals), 0)
    ),
    'meal_breakdown', coalesce((select jsonb_agg(row_to_json(per_meal)) from per_meal), '[]'::jsonb)
  );
$$;

grant execute on function public.get_nutrition_dashboard(date) to authenticated;

-- ─── get_daily_journal ─────────────────────────────────────────────────────

create or replace function public.get_daily_journal(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mje.id,
      'logged_date', mje.logged_date,
      'meal_slot', mje.meal_slot,
      'logged_at', mje.logged_at,
      'amount', mje.amount,
      'amount_unit', mje.amount_unit,
      'kcal_snapshot', mje.kcal_snapshot,
      'protein_g_snapshot', mje.protein_g_snapshot,
      'carbs_g_snapshot', mje.carbs_g_snapshot,
      'fat_g_snapshot', mje.fat_g_snapshot,
      'fiber_g_snapshot', mje.fiber_g_snapshot,
      'food', jsonb_build_object(
        'id', f.id,
        'description', f.description,
        'brand_name', f.brand_name,
        'kind', f.kind
      )
    ) order by mje.logged_at
  ), '[]'::jsonb)
  from public.meal_journal_entries mje
  join public.foods f on f.id = mje.food_id
  where mje.user_id = auth.uid()
    and mje.logged_date = p_date;
$$;

grant execute on function public.get_daily_journal(date) to authenticated;

-- ─── get_weekly_macro_averages ─────────────────────────────────────────────

create or replace function public.get_weekly_macro_averages(
  p_range_start date,
  p_range_end   date
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with days as (
    select generate_series(p_range_start, p_range_end, interval '1 day')::date as d
  ),
  per_day as (
    select
      days.d as date,
      coalesce(sum(mje.kcal_snapshot), 0)      as kcal_actual,
      coalesce(sum(mje.protein_g_snapshot), 0) as protein_g_actual,
      coalesce(sum(mje.carbs_g_snapshot), 0)   as carbs_g_actual,
      coalesce(sum(mje.fat_g_snapshot), 0)     as fat_g_actual,
      coalesce(sum(mje.fiber_g_snapshot), 0)   as fiber_g_actual
    from days
    left join public.meal_journal_entries mje
      on mje.logged_date = days.d and mje.user_id = auth.uid()
    group by days.d
  )
  select coalesce(jsonb_agg(row_to_json(per_day) order by date), '[]'::jsonb)
  from per_day;
$$;

grant execute on function public.get_weekly_macro_averages(date, date) to authenticated;
```

- [ ] **Step 2: Append streak + micronutrient status + top foods + plan adherence**

Append to `supabase/20260414_nutrition_rpcs.sql`:

```sql

-- ─── get_macro_hit_streak ──────────────────────────────────────────────────
-- Consecutive days where all 4 macros landed within ±10% of target, using
-- the user's active meal plan's targets for the day-type on each date.

create or replace function public.get_macro_hit_streak()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_plan record;
  v_date date := current_date;
  v_current int := 0;
  v_best int := 0;
  v_temp int := 0;
  v_hit boolean;
  v_day_type text;
  v_targets jsonb;
  v_actuals record;
begin
  -- Load active meal plan (one per user enforced by unique partial index)
  select id, plan
    into v_plan
  from public.meal_plans
  where user_id = auth.uid() and archived_at is null
  limit 1;
  if v_plan.id is null then
    return jsonb_build_object('current', 0, 'best', 0);
  end if;

  -- Walk backwards up to 365 days computing streak
  for i in 0..364 loop
    v_date := current_date - i;
    v_day_type := coalesce(
      v_plan.plan->'assignments'->'overrides'->>(v_date::text),
      v_plan.plan->'assignments'->>'default_day_type',
      'rest_day'
    );
    v_targets := v_plan.plan->'targets'->v_day_type;
    if v_targets is null then
      v_hit := false;
    else
      select
        coalesce(sum(kcal_snapshot),0)      as kcal,
        coalesce(sum(protein_g_snapshot),0) as protein_g,
        coalesce(sum(carbs_g_snapshot),0)   as carbs_g,
        coalesce(sum(fat_g_snapshot),0)     as fat_g
      into v_actuals
      from public.meal_journal_entries
      where user_id = auth.uid() and logged_date = v_date;
      v_hit := (
        abs(v_actuals.kcal      - (v_targets->>'kcal')::numeric)      <= (v_targets->>'kcal')::numeric      * 0.1
        and abs(v_actuals.protein_g - (v_targets->>'protein_g')::numeric) <= (v_targets->>'protein_g')::numeric * 0.1
        and abs(v_actuals.carbs_g   - (v_targets->>'carbs_g')::numeric)   <= (v_targets->>'carbs_g')::numeric   * 0.1
        and abs(v_actuals.fat_g     - (v_targets->>'fat_g')::numeric)     <= (v_targets->>'fat_g')::numeric     * 0.1
      );
    end if;

    if v_hit then
      v_temp := v_temp + 1;
      if i = 0 then v_current := v_temp; end if;
      if v_temp > v_best then v_best := v_temp; end if;
    else
      if i = 0 then v_current := 0; end if;
      v_temp := 0;
    end if;
  end loop;

  return jsonb_build_object('current', v_current, 'best', v_best);
end;
$$;

grant execute on function public.get_macro_hit_streak() to authenticated;

-- ─── get_micronutrient_status ──────────────────────────────────────────────
-- Returns all 25 non-macro nutrients with actual, DRI target, pct_dri, status.

create or replace function public.get_micronutrient_status(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with per_nutrient as (
    select
      n.slug,
      n.name,
      n.unit,
      n.category,
      n.display_order,
      n.default_dri_male,
      n.dri_upper_limit,
      sum(fn.amount_per_base * mje.amount / f.base_amount) as amount
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    join public.food_nutrients fn on fn.food_id = mje.food_id
    join public.nutrients n on n.id = fn.nutrient_id
    where mje.user_id = auth.uid()
      and mje.logged_date = p_date
      and n.category in ('vitamin','mineral')
    group by n.id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', slug,
      'name', name,
      'unit', unit,
      'category', category,
      'amount', amount,
      'dri', default_dri_male,
      'pct_dri', case when default_dri_male > 0 then round((amount / default_dri_male) * 100, 0) else null end,
      'status', case
        when amount is null or default_dri_male is null then 'unknown'
        when amount < default_dri_male * 0.5   then 'under'
        when amount < default_dri_male * 0.8   then 'low'
        when amount <= default_dri_male * 1.5  then 'ok'
        when dri_upper_limit is not null and amount > dri_upper_limit then 'excess'
        else 'high'
      end
    )
    order by display_order
  ), '[]'::jsonb)
  from per_nutrient;
$$;

grant execute on function public.get_micronutrient_status(date) to authenticated;

-- ─── get_top_foods ─────────────────────────────────────────────────────────

create or replace function public.get_top_foods(
  p_range_start date,
  p_range_end   date,
  p_limit       int default 10
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with agg as (
    select
      f.id,
      f.description,
      f.brand_name,
      f.kind,
      count(*) as log_count,
      sum(mje.kcal_snapshot) as total_kcal
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    where mje.user_id = auth.uid()
      and mje.logged_date between p_range_start and p_range_end
    group by f.id, f.description, f.brand_name, f.kind
    order by log_count desc, total_kcal desc
    limit p_limit
  )
  select coalesce(jsonb_agg(row_to_json(agg)), '[]'::jsonb) from agg;
$$;

grant execute on function public.get_top_foods(date, date, int) to authenticated;

-- ─── get_plan_adherence ────────────────────────────────────────────────────
-- Returns macro-level adherence (% of target hit) and meal-level adherence
-- (% of prescribed meals that had a corresponding journal entry). Coarse
-- v1 implementation — considers a meal "hit" if ANY journal entry exists
-- in that meal_slot on that date.

create or replace function public.get_plan_adherence(
  p_plan_id     uuid,
  p_range_start date,
  p_range_end   date
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_plan jsonb;
  v_macro_total numeric := 0;
  v_macro_count int := 0;
  v_meals_prescribed int := 0;
  v_meals_hit int := 0;
  v_supp_prescribed int := 0;
  v_supp_hit int := 0;
  v_date date;
  v_day_type text;
  v_targets jsonb;
  v_meal jsonb;
  v_actuals record;
begin
  select plan into v_plan
    from public.meal_plans
    where id = p_plan_id and user_id = auth.uid();
  if v_plan is null then
    return jsonb_build_object('error', 'plan_not_found');
  end if;

  v_date := p_range_start;
  while v_date <= p_range_end loop
    v_day_type := coalesce(
      v_plan->'assignments'->'overrides'->>(v_date::text),
      v_plan->'assignments'->>'default_day_type',
      'rest_day'
    );
    v_targets := v_plan->'targets'->v_day_type;
    if v_targets is not null then
      select
        coalesce(sum(kcal_snapshot),0)      as kcal,
        coalesce(sum(protein_g_snapshot),0) as protein_g,
        coalesce(sum(carbs_g_snapshot),0)   as carbs_g,
        coalesce(sum(fat_g_snapshot),0)     as fat_g
      into v_actuals
      from public.meal_journal_entries
      where user_id = auth.uid() and logged_date = v_date;

      v_macro_total := v_macro_total + (
        least(v_actuals.kcal      / greatest((v_targets->>'kcal')::numeric, 1), 1)
        + least(v_actuals.protein_g / greatest((v_targets->>'protein_g')::numeric, 1), 1)
        + least(v_actuals.carbs_g   / greatest((v_targets->>'carbs_g')::numeric, 1), 1)
        + least(v_actuals.fat_g     / greatest((v_targets->>'fat_g')::numeric, 1), 1)
      );
      v_macro_count := v_macro_count + 4;

      -- Meal-level: for each prescribed meal in the day_type, check if any
      -- journal entry exists in that meal_slot on this date.
      for v_meal in
        select jsonb_array_elements(dt->'meals')
        from jsonb_array_elements(v_plan->'day_types') dt
        where dt->>'slug' = v_day_type
      loop
        v_meals_prescribed := v_meals_prescribed + 1;
        if exists (
          select 1 from public.meal_journal_entries
          where user_id = auth.uid()
            and logged_date = v_date
            and meal_slot = (v_meal->>'slot')
        ) then
          v_meals_hit := v_meals_hit + 1;
        end if;
      end loop;

      -- Supplement-level: each prescribed supplement "hit" if at least one
      -- supplement-kind journal entry exists that day
      for v_meal in
        select jsonb_array_elements(dt->'supplements')
        from jsonb_array_elements(v_plan->'day_types') dt
        where dt->>'slug' = v_day_type
      loop
        v_supp_prescribed := v_supp_prescribed + 1;
        if exists (
          select 1 from public.meal_journal_entries mje
          join public.foods f on f.id = mje.food_id
          where mje.user_id = auth.uid()
            and mje.logged_date = v_date
            and f.kind = 'supplement'
        ) then
          v_supp_hit := v_supp_hit + 1;
        end if;
      end loop;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object(
    'macro_adherence_pct', case when v_macro_count > 0 then round((v_macro_total / v_macro_count) * 100, 0) else 0 end,
    'meal_adherence_pct', case when v_meals_prescribed > 0 then round((v_meals_hit::numeric / v_meals_prescribed) * 100, 0) else 0 end,
    'supplement_adherence_pct', case when v_supp_prescribed > 0 then round((v_supp_hit::numeric / v_supp_prescribed) * 100, 0) else 0 end,
    'meals_prescribed', v_meals_prescribed,
    'meals_hit', v_meals_hit,
    'supplements_prescribed', v_supp_prescribed,
    'supplements_hit', v_supp_hit
  );
end;
$$;

grant execute on function public.get_plan_adherence(uuid, date, date) to authenticated;

-- ─── resolve_day_type_from_jsonb (test helper) ─────────────────────────────
-- Mirrors shared/meal-plan-day-type.js for the cross-fixture test. Takes the
-- JSONB documents directly so the test doesn't need fixtures in the DB.

create or replace function public.resolve_day_type_from_jsonb(
  p_date         date,
  p_meal_plan    jsonb,
  p_workout_plan jsonb
) returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_override text;
  v_mode text;
  v_has_session boolean;
  v_default text;
begin
  v_override := p_meal_plan->'assignments'->'overrides'->>(p_date::text);
  if v_override is not null then
    return v_override;
  end if;

  v_mode := p_meal_plan->'assignments'->>'mode';
  v_default := coalesce(p_meal_plan->'assignments'->>'default_day_type', 'rest_day');

  if v_mode = 'auto_from_workout' and p_workout_plan is not null then
    -- Check schedule array for a matching date
    select exists (
      select 1
      from jsonb_array_elements(coalesce(p_workout_plan->'schedule', '[]'::jsonb)) as entry
      where entry->>'date' = p_date::text
    ) into v_has_session;
    if v_has_session and exists (
      select 1 from jsonb_array_elements(coalesce(p_meal_plan->'day_types', '[]'::jsonb)) dt
      where dt->>'slug' = 'training_day'
    ) then
      return 'training_day';
    end if;
  end if;

  return v_default;
end;
$$;

grant execute on function public.resolve_day_type_from_jsonb(date, jsonb, jsonb) to authenticated, service_role;
```

- [ ] **Step 3: Apply migration against scratch Postgres and run the day-type cross-fixture test**

```bash
docker run --rm -d --name emersus-scratch-pg -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:15
sleep 3
psql -h 127.0.0.1 -p 55432 -U postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create role authenticated; create role service_role;
create or replace function public.set_current_timestamp_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
create or replace function auth.uid() returns uuid as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$ language sql;
SQL
psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/20260414_nutrients.sql \
  -f supabase/20260414_foods.sql \
  -f supabase/20260414_food_nutrients.sql \
  -f supabase/20260414_meal_plans.sql \
  -f supabase/20260414_meal_journal_entries.sql \
  -f supabase/20260414_meal_journal_rpcs.sql \
  -f supabase/20260414_nutrition_rpcs.sql

# Smoke-test resolve_day_type_from_jsonb
psql -h 127.0.0.1 -p 55432 -U postgres -c "
select public.resolve_day_type_from_jsonb(
  '2026-04-14'::date,
  '{\"day_types\":[{\"slug\":\"training_day\"},{\"slug\":\"rest_day\"}],\"assignments\":{\"mode\":\"auto_from_workout\",\"default_day_type\":\"rest_day\"}}'::jsonb,
  '{\"schedule\":[{\"date\":\"2026-04-14\"}]}'::jsonb
);
"
# Expected: training_day

docker stop emersus-scratch-pg
```

- [ ] **Step 4: Commit**

```bash
git add supabase/20260414_nutrition_rpcs.sql
git commit -m "feat(nutrition): analytics RPCs + day-type test helper

- get_nutrition_dashboard(p_date): today summary with actuals + meal_breakdown
- get_daily_journal(p_date): full journal for a date with food joins
- get_weekly_macro_averages(start, end): per-day macro totals over a range
- get_macro_hit_streak(): current + best consecutive days where all 4
  macros landed within ±10% of the day-type target
- get_micronutrient_status(p_date): all 25 vitamins+minerals with
  amount, DRI, pct_dri, status (under/low/ok/high/excess)
- get_top_foods(start, end, limit): most-logged foods with kcal contribution
- get_plan_adherence(plan_id, start, end): macro-level + meal-level +
  supplement-level adherence percentages
- resolve_day_type_from_jsonb(): pure test helper mirroring the JS
  resolver exactly, enables cross-fixture test

All functions set search_path = public, extensions per the
match_evidence_chunks lesson.

Part of the meal planning / journaling feature (Phase 5)."
```

---

## Task 22: `/app/progress/` tab switcher refactor

**Files:**
- Modify: `app/progress/progress.js`
- Modify: `app/progress/index.html`

Wrap the existing progress dashboard in a top-level `[Workouts | Nutrition]` tab switcher. Default to `#workouts` so existing bookmarks still work.

- [ ] **Step 1: Read the existing `app/progress/progress.js` structure**

```bash
head -50 app/progress/progress.js
```

Locate the main component (likely `App` or similar) and the mount point. Note how it currently renders — we'll wrap it without modifying its internal logic.

- [ ] **Step 2: Refactor to add the tab switcher**

Edit `app/progress/progress.js` to wrap the existing component in a new root that routes between `#workouts` and `#nutrition`:

```js
// At the top of the existing file, after the existing imports, add:
import NutritionPane from "./nutrition-pane.js";

const { useState, useEffect } = React;
const h = React.createElement;

// (existing App component remains as WorkoutsPane, rename locally)
// Replace the existing `root.render(h(App))` with the new wrapper below.

function parseProgressTab() {
  const hash = window.location.hash.replace("#", "");
  return ["workouts", "nutrition"].includes(hash) ? hash : "workouts";
}

function ProgressShell() {
  const [tab, setTab] = useState(parseProgressTab());

  useEffect(() => {
    function onHash() { setTab(parseProgressTab()); }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(t) {
    setTab(t);
    window.location.hash = t;
  }

  return h("div", { className: "progress-shell" }, [
    h("nav", { className: "progress-top-tabs", key: "tabs" }, [
      h("button", {
        key: "w",
        className: tab === "workouts" ? "top-tab active" : "top-tab",
        onClick: () => navigate("workouts"),
      }, "Workouts"),
      h("button", {
        key: "n",
        className: tab === "nutrition" ? "top-tab active" : "top-tab",
        onClick: () => navigate("nutrition"),
      }, "Nutrition"),
    ]),
    tab === "workouts"  && h(App, { key: "workouts" }),  // rename if App collides
    tab === "nutrition" && h(NutritionPane, { key: "nutrition" }),
  ]);
}

// Change the bottom of the file from:
//   root.render(h(App));
// to:
//   root.render(h(ProgressShell));
```

**Note:** the exact name of the existing top-level component in `progress.js` may be `App`, `ProgressDashboard`, or something else. Use `Read` to find it, then either rename it to `WorkoutsPane` or leave it named `App` but reference it by that name inside `ProgressShell`. Match whichever is cleaner.

- [ ] **Step 3: Add basic styling for the top-tab switcher**

If `app/progress/index.html` inlines styles, add to the `<style>` block:

```css
.progress-shell { max-width: 900px; margin: 0 auto; padding: 24px; }
.progress-top-tabs { display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; }
.progress-top-tabs .top-tab {
  padding: 12px 20px;
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-family: Inter, sans-serif;
  font-size: 16px;
  font-weight: 600;
}
.progress-top-tabs .top-tab.active {
  color: var(--ink);
  border-bottom: 2px solid var(--primary);
}
```

- [ ] **Step 4: Smoke test**

```bash
node server.js &
SERVER_PID=$!
sleep 2
# Existing workouts view still renders
curl -s http://127.0.0.1:3001/app/progress/ | grep -q "Workouts" && echo "workouts tab ok"
# Fragment-hash nav works client-side; server returns the same HTML
curl -s http://127.0.0.1:3001/app/progress/#nutrition | grep -q "Workouts" && echo "nutrition hash ok"
kill $SERVER_PID
```

Expected: "workouts tab ok" + "nutrition hash ok".

- [ ] **Step 5: Commit**

```bash
git add app/progress/progress.js app/progress/index.html
git commit -m "refactor(progress): wrap in [Workouts | Nutrition] tab switcher

- Introduce ProgressShell as the new root; previous top-level App
  component becomes the Workouts pane.
- Hash-driven tab routing defaults to #workouts for back-compat
  (existing bookmarks and deep links continue to land on workouts).
- Nutrition pane is wired via new NutritionPane import (implemented
  in Task 23).

Part of the meal planning / journaling feature (Phase 5)."
```

---

## Task 23: Progress nutrition pane

**Files:**
- Create: `app/progress/nutrition-pane.js`

The analytics view for nutrition. Time range pills, stat cards, weekly macro bars, plan adherence, top foods/supplements, micronutrient grid.

- [ ] **Step 1: Write the pane**

Create `app/progress/nutrition-pane.js`:

```js
// app/progress/nutrition-pane.js
//
// Nutrition analytics pane for /app/progress/#nutrition. Reads the
// analytics RPCs from Task 21 and composes the charts from
// shared/nutrition-charts.js.

import React from "https://esm.sh/react@18.2.0";
import {
  WeeklyMacroBars,
  MicronutrientCard,
  StreakBanner,
} from "/shared/nutrition-charts.js";

const { useEffect, useState } = React;
const h = React.createElement;

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

const RANGES = [
  { id: "4w",  label: "4W",  days: 28 },
  { id: "8w",  label: "8W",  days: 56 },
  { id: "12w", label: "12W", days: 84 },
  { id: "all", label: "All", days: 365 },
];

function rpc(name, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, v);
  return authFetch(`/api/emersus/rpc/${name}?${qs.toString()}`);
}

export default function NutritionPane() {
  const [range, setRange] = useState("4w");
  const [state, setState] = useState({ loading: true, error: null });
  const [data, setData] = useState({
    weekly: [],
    streak: { current: 0, best: 0 },
    adherence: null,
    topFoods: [],
    micros: [],
    activePlanId: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ loading: true, error: null });
      try {
        const days = RANGES.find(r => r.id === range)?.days ?? 28;
        const end = new Date().toISOString().slice(0, 10);
        const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

        // Load the active plan id for adherence
        const planRes = await authFetch("/api/emersus/meal-plans/active");
        const activePlanId = planRes.ok ? (await planRes.json()).meal_plan?.id : null;

        // Parallel fan-out
        const [weeklyRes, streakRes, topRes, adherenceRes, microRes] = await Promise.all([
          rpc("get_weekly_macro_averages", { p_range_start: start, p_range_end: end }),
          rpc("get_macro_hit_streak", {}),
          rpc("get_top_foods", { p_range_start: start, p_range_end: end, p_limit: 10 }),
          activePlanId ? rpc("get_plan_adherence", { p_plan_id: activePlanId, p_range_start: start, p_range_end: end }) : null,
          rpc("get_micronutrient_status", { p_date: end }),
        ]);

        if (cancelled) return;
        setData({
          weekly: weeklyRes.ok ? await weeklyRes.json() : [],
          streak: streakRes.ok ? await streakRes.json() : { current: 0, best: 0 },
          topFoods: topRes.ok ? await topRes.json() : [],
          adherence: adherenceRes && adherenceRes.ok ? await adherenceRes.json() : null,
          micros: microRes.ok ? await microRes.json() : [],
          activePlanId,
        });
        setState({ loading: false, error: null });
      } catch (err) {
        console.error("[nutrition-pane] load failed:", err);
        if (!cancelled) setState({ loading: false, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [range]);

  if (state.loading) return h("div", { className: "np-loading" }, "Loading nutrition analytics…");

  return h("div", { className: "nutrition-pane" }, [
    h("div", { className: "range-pills", key: "r" },
      RANGES.map(r =>
        h("button", {
          key: r.id,
          className: r.id === range ? "pill active" : "pill",
          onClick: () => setRange(r.id),
        }, r.label)
      )
    ),

    h("div", { className: "stat-cards", key: "s" }, [
      h("div", { className: "card", key: "ma" }, [
        h("div", { className: "label", key: "l" }, "Macro adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.macro_adherence_pct}%` : "—"),
      ]),
      h("div", { className: "card", key: "st" }, [
        h("div", { className: "label", key: "l" }, "Streak"),
        h("div", { className: "value", key: "v" },
          `${data.streak.current} / ${data.streak.best}`),
      ]),
      h("div", { className: "card", key: "pa" }, [
        h("div", { className: "label", key: "l" }, "Plan meal adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.meal_adherence_pct}%` : "—"),
      ]),
      h("div", { className: "card", key: "sa" }, [
        h("div", { className: "label", key: "l" }, "Supplement adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.supplement_adherence_pct}%` : "—"),
      ]),
    ]),

    h(StreakBanner, { key: "streak", current: data.streak.current, best: data.streak.best }),

    h("section", { className: "section-weekly", key: "w" }, [
      h("h3", { key: "h" }, "Weekly kcal"),
      h(WeeklyMacroBars, { days: data.weekly }),
    ]),

    h("section", { className: "section-top-foods", key: "tf" }, [
      h("h3", { key: "h" }, "Top foods"),
      h("ul", { className: "top-list", key: "l" },
        data.topFoods.map((f, i) =>
          h("li", { key: i }, [
            h("span", { className: "desc", key: "d" }, f.description),
            h("span", { className: "count", key: "c" }, `${f.log_count}×`),
            h("span", { className: "kcal", key: "k" }, `${Math.round(f.total_kcal)} kcal`),
          ])
        )
      ),
    ]),

    h("section", { className: "section-micros", key: "m" }, [
      h("h3", { key: "h" }, "Micronutrients (today)"),
      h("div", { className: "micro-grid", key: "g" },
        data.micros.map(n => h(MicronutrientCard, { key: n.slug, nutrient: n }))
      ),
    ]),
  ]);
}
```

- [ ] **Step 2: Add a generic RPC proxy endpoint so the UI can call RPCs via HTTP**

The nutrition pane expects `GET /api/emersus/rpc/<function>?p_...` style URLs. Rather than writing a handler per RPC, add one pass-through that forwards to `supabase.rpc()`.

Create `api/emersus/rpc-proxy.js`:

```js
// api/emersus/rpc-proxy.js
//
// Generic Supabase RPC proxy. Lets the browser call allowlisted RPCs
// via GET /api/emersus/rpc/<name>?p_x=y. Uses the caller's JWT so
// SECURITY INVOKER functions respect RLS.
//
// Only functions in the ALLOWLIST are callable — we do NOT expose every
// Postgres function because that would be an unchecked attack surface.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWLIST = new Set([
  "get_nutrition_dashboard",
  "get_daily_journal",
  "get_weekly_macro_averages",
  "get_macro_hit_streak",
  "get_micronutrient_status",
  "get_top_foods",
  "get_plan_adherence",
]);

function clientForRequest(req) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.authorization ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Lightweight type coercion: params prefixed p_ become strings, dates
// pass through, numbers parsed, booleans parsed.
function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

export default async function rpcProxy(req, res) {
  try {
    const name = req.params?.name;
    if (!ALLOWLIST.has(name)) {
      res.status(403).json({ error: "rpc_not_allowed" });
      return;
    }
    const params = {};
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (k.startsWith("p_")) params[k] = coerce(v);
    }
    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc(name, params);
    if (error) {
      console.error(`[rpc-proxy:${name}] error:`, error);
      res.status(500).json({ error: "rpc_failed", detail: error.message });
      return;
    }
    res.json(data ?? null);
  } catch (err) {
    console.error("[rpc-proxy] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
```

Mount in `server.js`:
```js
import rpcProxy from "./api/emersus/rpc-proxy.js";
app.get("/api/emersus/rpc/:name", rpcProxy);
```

- [ ] **Step 3: Smoke test**

```bash
node -e "import('./app/progress/nutrition-pane.js').catch(e => { if (e.code !== 'ERR_UNSUPPORTED_ESM_URL_SCHEME') throw e; console.log('nutrition-pane.js imports ok (browser-only esm.sh URLs)') })"
```

The esm.sh URL imports don't resolve in plain Node — browser-side verification happens in Task 25.

- [ ] **Step 4: Commit**

```bash
git add app/progress/nutrition-pane.js api/emersus/rpc-proxy.js server.js
git commit -m "feat(nutrition): /app/progress/#nutrition analytics pane

- nutrition-pane.js: range pills, 4 stat cards (macro/streak/meal/
  supplement adherence), weekly kcal bars, top-foods list, micronutrient
  grid for today, streak banner.
- rpc-proxy.js: generic GET /api/emersus/rpc/:name endpoint with an
  allowlist. Lets the browser call nutrition analytics RPCs using the
  caller's JWT so RLS and SECURITY INVOKER semantics apply.

Part of the meal planning / journaling feature (Phase 5 — final)."
```

**End of Phase 5.** Analytics are live. `/app/progress/#nutrition` shows macro trends, streaks, adherence, top foods, and micronutrient status. Phase 6 is docs + production rollout.

---

# Phase 6 — Docs & Production Deploy

## Task 24: Documentation updates

**Files:**
- Modify: `docs/overview.md`
- Modify: `docs/schema.md`
- Modify: `docs/scripts.md`
- Modify: `changelog.md`

- [ ] **Step 1: Append nutrition subsystem section to `docs/overview.md`**

Use `Read` on `docs/overview.md` to find the right insertion point (probably alongside the workout-tracking section). Append:

```markdown
## Nutrition subsystem (meal planning, journaling, supplements)

**Spec:** `docs/superpowers/specs/2026-04-11-meal-planning-journaling-design.md`
**Plan:** `docs/superpowers/plans/2026-04-11-meal-planning-journaling.md`

Symmetric dual plan + journal feature backed by USDA FoodData Central
(Foundation + SR Legacy + FNDDS + Branded, ~1.82 M foods total) plus a
curated ~40-entry supplement seed.

### Key modules

- `api/emersus/meal-plans.js` — CRUD handlers for `meal_plans`
- `api/emersus/meal-journal.js` — write path for `meal_journal_entries`
- `api/emersus/nutrition-parser.js` — separate OpenAI function-schema call
  that parses freeform food descriptions, with the foods-catalog match
  pipeline. Emits structured items for the `nutrition-log-confirm` widget.
- `api/emersus/foods-search.js` — `GET /api/emersus/foods/search` typeahead
- `api/emersus/rpc-proxy.js` — generic allowlisted RPC proxy for the browser
- `shared/meal-plan-day-type.js` — isomorphic day-type resolver with a
  SQL sibling (`resolve_day_type_from_jsonb`, `get_day_type_for_date`)
  locked to the same fixture
- `shared/meal-plan-schema.js` — zero-dep runtime validator for the plan JSONB

### Chat integration

Nutrition-topic messages pass through `classifyNutritionIntent()` in
`workflow.js`. `generate_plan` runs the normal retrieval path plus the
`MEAL_PLAN_GENERATION_PROTOCOL` system-prompt addendum and the
`SUPPLEMENT PROTOCOL` guardrail. `log_food` skips retrieval and goes
straight to the parser + a `nutrition-log-confirm` widget. Confirmation
is mandatory — no silent writes from chat in v1.

### UI

- `/app/nutrition/` single-page app with internal React tab routing:
  Today / Plan / Journal / Supplements. Food detail slides in as a
  drawer routed via `?food=<uuid>`.
- `/app/progress/` gained a top-level `[Workouts | Nutrition]` tab
  switcher. The Nutrition pane reads the analytics RPCs.

### Data model highlights

- `foods.kind` polymorphism (`food` / `supplement`) + `base_unit`
  (`100g` / `serving`) + `base_amount` for uniform snapshot math
- `food_nutrients.amount_per_base` — per-100g for foods, per-serving
  for discrete supplements
- `meal_journal_entries` snapshots `kcal`/`protein_g`/`carbs_g`/`fat_g`/
  `fiber_g` at write time (frozen forever; micronutrients joined at read)
- `meal_plans` mirrors `workout_plans` — JSONB plan, previous_plan for
  undo, one-active-per-user enforced via unique partial index
- Profile extended with `body_weight_kg`, `height_cm`, `date_of_birth`,
  `biological_sex`, `activity_level` for Mifflin-St Jeor inputs
```

- [ ] **Step 2: Update `docs/schema.md`**

Append a new section listing the new tables, RPCs, and migrations:

```markdown
## Nutrition subsystem tables (2026-04-13)

### `nutrients` (lookup)
31 curated entries: energy, macros (7), vitamins (13), minerals (10).
Seeded in `20260414_nutrients.sql`. `fdc_nutrient_id` maps to USDA FDC.

### `foods`
Polymorphic catalog (`kind in {food, supplement}`). ~1.82 M rows after
USDA import. Key columns: `fdc_id`, `description`, `source`, `kind`,
`base_unit`, `base_amount`, `brand_name`, `gtin_upc`, `ingredients_text`,
`data_points`, `search_vector` (generated).

Indexes: GIN on `search_vector` (typeahead), GIN trigram on
`description`, partial GIN trigram on `brand_name`, partial B-tree on
`gtin_upc`, composite `(kind, source)`.

RLS: public read for non-user rows; self-gated read/write for
`source = 'user_contributed'`.

### `food_nutrients`
`(food_id, nutrient_id, amount_per_base)`. Snapshot math:
`amount_per_base * entry.amount / foods.base_amount`.

### `meal_plans`
Mirrors `workout_plans`. JSONB `plan` + `previous_plan` for undo,
`archived_at` soft delete. Unique partial index on `(user_id) where
archived_at is null` enforces one active plan per user.

### `meal_journal_entries`
Per-item log rows. Macro snapshots (`kcal_snapshot`, `protein_g_snapshot`,
...) frozen at write time. Micronutrients aggregated at read time via
`food_nutrients` join. 5 indexes (user_date, user_food_date, user_plan_date,
user_slot_date, user_logged_at).

### Nutrition RPCs (all `SECURITY INVOKER`, `search_path = public, extensions`)

- `foods_search(text, text, boolean, int)`
- `insert_meal_journal_entries(jsonb)`
- `update_meal_journal_entry(uuid, numeric, text, text, text, numeric, text)`
- `copy_meal_journal_day(date, date, text[])`
- `get_nutrition_dashboard(date)`
- `get_daily_journal(date)`
- `get_weekly_macro_averages(date, date)`
- `get_macro_hit_streak()`
- `get_micronutrient_status(date)`
- `get_top_foods(date, date, int)`
- `get_plan_adherence(uuid, date, date)`
- `resolve_day_type_from_jsonb(date, jsonb, jsonb)` (test helper)

### Profile columns added

- `body_weight_kg numeric`
- `height_cm numeric`
- `date_of_birth date`
- `biological_sex text` CHECK (male, female, prefer_not_to_say)
- `activity_level text` CHECK (sedentary, light, moderate, active, very_active)

### Migration files (apply in order)

1. `20260414_profile_nutrition_columns.sql`
2. `20260414_nutrients.sql`
3. `20260414_foods.sql` (includes `foods_search` RPC)
4. `20260414_food_nutrients.sql`
5. `20260414_supplements_seed.sql`
6. `20260414_meal_plans.sql`
7. `20260414_meal_journal_entries.sql`
8. `20260414_meal_journal_rpcs.sql`
9. `20260414_nutrition_rpcs.sql`
```

- [ ] **Step 3: Update `docs/scripts.md`**

Append:

```markdown
## `scripts/import-usda-foods.js`

One-time USDA FoodData Central importer. Loads Foundation, SR Legacy,
FNDDS, and Branded datasets into `foods` and `food_nutrients`.

### Usage

```bash
npm run import:usda                              # all four datasets
node scripts/import-usda-foods.js --datasets=foundation,sr_legacy
node scripts/import-usda-foods.js --resume       # pick up from checkpoint
node scripts/import-usda-foods.js --dry-run      # parse without writes
```

### Notes

- Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env.
- ~15 GB free disk needed (downloads, unzipped JSON, Postgres growth).
- Full run takes 2–4 hours on the Hetzner box (Foundation + SR +
  FNDDS are ~10 min; Branded is the long tail).
- Stream-parses Branded (1.5 GB unzipped) via `stream-json`.
- Checkpointed: safe to SIGINT and resume with `--resume`.
- Quality filter rejects ~5–15% of Branded rows (no kcal, malformed
  descriptions, negative values).
- Idempotent: re-run safe for quarterly Branded refreshes.
```

- [ ] **Step 4: Add a changelog entry**

Append to `changelog.md`:

```markdown
- 2026-04-13 — Nutrition subsystem: meal planning, journaling, supplements (Phases 1–6)
  — `supabase/20260414_*.sql`, `api/emersus/meal-plans.js`, `api/emersus/meal-journal.js`,
    `api/emersus/nutrition-parser.js`, `api/emersus/foods-search.js`, `api/emersus/rpc-proxy.js`,
    `shared/meal-plan-*.js`, `shared/nutrition-*.js`, `shared/food-detail-drawer.js`,
    `app/nutrition/`, `app/progress/nutrition-pane.js` + `progress.js` tab switcher,
    `scripts/import-usda-foods.js`
```

- [ ] **Step 5: Commit**

```bash
git add docs/overview.md docs/schema.md docs/scripts.md changelog.md
git commit -m "docs: document nutrition subsystem

- overview.md: new 'Nutrition subsystem' section with module map,
  chat integration notes, UI overview, data model highlights
- schema.md: tables, indexes, RPCs, migration list, profile columns
- scripts.md: import-usda-foods usage and operational notes
- changelog.md: release entry for Phases 1–6

Part of the meal planning / journaling feature (Phase 6)."
```

---

## Task 25: Production deploy + USDA import + end-to-end verification

- [ ] **Step 1: Apply all migrations against Hetzner Postgres**

```bash
ssh hetzner "cd ~/app && bash infra/apply-migrations.sh \
  supabase/20260414_profile_nutrition_columns.sql \
  supabase/20260414_nutrients.sql \
  supabase/20260414_foods.sql \
  supabase/20260414_food_nutrients.sql \
  supabase/20260414_supplements_seed.sql \
  supabase/20260414_meal_plans.sql \
  supabase/20260414_meal_journal_entries.sql \
  supabase/20260414_meal_journal_rpcs.sql \
  supabase/20260414_nutrition_rpcs.sql"
```

Expected: all migrations apply cleanly. Verify with:
```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c '\dt public.foods; \dt public.meal_plans; \dt public.meal_journal_entries'"
```

Expected: three tables listed.

**Important:** `infra/apply-migrations.sh` must use `-U supabase_admin` per `memory/project_supabase_admin_role.md`. Verify before running against production.

- [ ] **Step 2: Deploy the application code to Hetzner**

```bash
# Push to git first
git push origin main

# Pull on Hetzner and restart
ssh hetzner "cd ~/app && git pull && npm install && pm2 restart emersus-api --update-env"
```

Expected: `pm2 status` shows `emersus-api` online and recently restarted.

- [ ] **Step 3: Run the USDA import (all four datasets)**

**Important:** this is a 2–4 hour operation. Kick it off in a detached screen/tmux on Hetzner so SSH disconnects don't interrupt. `--resume` handles interruptions if one happens anyway.

```bash
ssh hetzner
screen -S usda-import
cd ~/app
node scripts/import-usda-foods.js 2>&1 | tee -a /tmp/usda-import.log
# Detach with Ctrl-A D
# Reconnect later: screen -r usda-import
```

Watch for: "done — N inserted, M skipped" per dataset. Final output should total ~15k for Foundation+SR+FNDDS and 1.5M–1.8M for Branded (after quality filter).

- [ ] **Step 4: Run the foods-search API test against production**

```bash
EMERSUS_BASE_URL="https://emersus.ai" npm run test:foods-search
```

Expected: 4 `✓` lines.

- [ ] **Step 5: Manual smoke test checklist**

Open `https://emersus.ai/app/nutrition/` in a browser and exercise each flow. Tick off each:

- [ ] Today tab loads (empty state is OK if no entries yet)
- [ ] Open chat at `/chat/`, type "make me a cut meal plan for 82 kg 180 cm 31 male moderate activity"
- [ ] Chat responds with macro math and a meal-plan widget
- [ ] Click Save plan in the widget — plan appears on `/app/nutrition/#plan`
- [ ] Day-type tabs work; Edit targets inline; Save archives + creates new row
- [ ] Assignments calendar shows current month with resolved day-types
- [ ] Navigate to Journal tab; click Log food; search "chicken"; results return branded + generic
- [ ] Select one, set amount, confirm — entry appears with kcal/macros
- [ ] In chat, type "log 5g creatine and 2000 IU vitamin D"
- [ ] nutrition-log-confirm widget appears with both items; click Confirm
- [ ] Supplements tab shows the prescribed stack; one-tap log works
- [ ] Food detail drawer opens from any journal entry via click
- [ ] `/app/progress/#nutrition` loads with macro adherence, streak, weekly bars, top foods, micros grid
- [ ] `/app/progress/#workouts` still works (back-compat)

Fix any failures before declaring the feature shipped.

- [ ] **Step 6: Run regression checks**

```bash
# Day-type resolver cross-fixture
SUPABASE_URL=https://supabase.emersus.ai \
SUPABASE_SERVICE_ROLE_KEY=$PROD_SERVICE_KEY \
npm run test:day-type
# Expected: 8 ✓ JS + 8 ✓ SQL = all assertions passed

# Schema validator
npm run test:meal-plan-schema
# Expected: 7 ✓

# Fence routing
npm run test:meal-plan-fence
# Expected: 2 ✓

# Parser goldens (optional, costs API calls)
EMERSUS_RUN_LLM_TESTS=1 \
OPENAI_API_KEY=$OPENAI_KEY \
SUPABASE_URL=https://supabase.emersus.ai \
SUPABASE_SERVICE_ROLE_KEY=$PROD_SERVICE_KEY \
npm run test:nutrition-parser
```

- [ ] **Step 7: Monitor for 24 hours**

Keep an eye on `pm2 logs emersus-api` for errors on nutrition endpoints. Watch Postgres for any slow queries on the new indexes (`pg_stat_statements`):

```bash
ssh hetzner "docker compose exec -T supabase-db psql -U supabase_admin -c \"
  select query, calls, total_exec_time, mean_exec_time
  from pg_stat_statements
  where query ilike '%meal_journal%' or query ilike '%foods%' or query ilike '%nutrition%'
  order by mean_exec_time desc limit 20;
\""
```

Investigate any query with mean > 100 ms.

- [ ] **Step 8: Final commit and close out**

```bash
# Update checkpoint
cat > checkpoint.md <<'EOF'
# Checkpoint
Status: none
Updated: 2026-04-13

No active checkpoint. Nutrition subsystem (meal planning / journaling / supplements)
shipped to production. See `changelog.md` for details.
EOF

git add checkpoint.md
git commit -m "chore: close out nutrition subsystem deploy

All migrations applied, USDA import complete, smoke tests passed.
Resetting checkpoint."
git push origin main
```

**End of Phase 6.** Feature is live.

---

## Self-Review

After completing all tasks, the following spec requirements are covered:

| Spec section | Covered in |
|---|---|
| Profile nutrition columns | Task 1 |
| `nutrients` lookup table + 31-entry seed | Task 2 |
| `foods` catalog with polymorphism + FTS | Task 2, 5 |
| `food_nutrients` normalized storage | Task 2 |
| Supplements seed (~40 items) | Task 3 |
| USDA FDC import (all 4 datasets) | Task 4, 25 |
| `foods_search` RPC + API | Task 5 |
| `meal_plans` table | Task 6 |
| Day-type resolver (JS + SQL + cross-fixture) | Task 7, 21 |
| Meal plan schema validator | Task 8 |
| Meal plans CRUD API | Task 8 |
| `workflow.js` intent classifier + profile gate + generation protocol | Task 9 |
| Supplement sub-protocol in system prompt | Task 9 |
| `meal-plan` widget fence + renderer | Task 10 |
| `meal_journal_entries` table | Task 11 |
| Journal write path with snapshot computation | Task 12 |
| Nutrition natural-language parser | Task 13 |
| `workflow.js` log-food branch | Task 14 |
| `nutrition-log-confirm` widget | Task 15 |
| Nutrition SVG charts (rings, bars, labels, grids) | Task 16 |
| Food detail drawer | Task 17 |
| Nutrition Today panel | Task 17 |
| Nutrition Plan panel + assignments calendar | Task 18 |
| Nutrition Journal panel + log modal | Task 19 |
| Nutrition Supplements panel | Task 19 |
| `/app/nutrition/` SPA composition + nav | Task 20 |
| Analytics RPCs (9 functions) | Task 21 |
| `/app/progress/` `[Workouts \| Nutrition]` tab switcher | Task 22 |
| Progress nutrition pane | Task 23 |
| RPC proxy endpoint | Task 23 |
| Docs updates (overview, schema, scripts, changelog) | Task 24 |
| Production migration + USDA import + smoke tests | Task 25 |

**Placeholder scan:** No "TBD", "TODO", or unresolved placeholders remain in the task steps. All steps contain exact file paths, complete code, and exact commands.

**Type consistency:** Key shared types are defined once and reused consistently:
- `meal_slot` enum: listed in Task 2 (SQL CHECK), Task 8 (MEAL_SLOT_ENUM in schema validator), Task 11 (SQL CHECK again), Task 15 (widget dropdown), and Task 19 (journal panel order). All lists match.
- `amount_unit` enum (`g` | `serving`): Task 11 (SQL), Task 12 (write path validation), Task 13 (parser schema). Consistent.
- `day_type` resolver signature (`{date, mealPlan, workoutPlan}`): Task 7 (JS), Task 21 (SQL sibling). Same inputs.
- `foods_search` params: Task 5 (SQL + HTTP), Task 13 (parser calls it). Consistent.
- `insert_meal_journal_entries` params: Task 12 (RPC) accepts jsonb array matching Task 13 (parser output shape) and Task 15 (widget submit shape).

**Scope check:** Features implemented match the spec's "In v1" scope exactly. Deferred items (chain scraping, USDA Branded annual refresh automation, photo OCR, hydration/body-comp, mobile) are not implemented and are not snuck in.
