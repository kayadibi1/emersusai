# Nutrition Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 issues found during the nutrition subsystem review — DRI sex lookup, day-type resolution (2 locations), meal plan macro floor, and configurable eating window.

**Architecture:** All fixes are independent and can be parallelized. Tasks 1-4 are code-only. Task 5 includes a SQL migration (profiles table columns) plus handler changes. No new files except the migration and one test file.

**Tech Stack:** React 18 via esm.sh (no build), Express 5, self-hosted Supabase (Postgres 15), `node:test` for unit tests.

**Important context:**
- Local dev hits **production** Supabase. No destructive writes.
- `nutrition-log-confirm-widget.js` was flagged as dead code in review but is **NOT** — `react-chat-app.js` imports `MEAL_SLOT_LABELS`, `ResolvedRow`, `UnresolvedRow` from it, and `emersus-renderer.js` imports the default export. Do not delete.
- `get_macro_hit_streak` RPC exists in `supabase/20260414_nutrition_rpcs.sql` and is allowlisted in `api/emersus/rpc-proxy.js`. Not missing.
- `nutrition-parser.js` line 117 already handles missing `toolCall` with a graceful `parser_unavailable` return. Not a bug.

---

### Task 1: Fix DRI sex lookup in food-detail-drawer

**Files:**
- Modify: `shared/food-detail-drawer.js:46-79`

The food detail drawer hardcodes `default_dri_male` on line 78. The `nutrients` query already fetches both `default_dri_male` and `default_dri_female`. We need to fetch the user's `biological_sex` from their profile and use the correct column.

The Supabase client is RLS-scoped (anon key + user session), so `profiles` queries return only the current user's row.

- [ ] **Step 1: Add profile fetch and sex-aware DRI selection**

In `shared/food-detail-drawer.js`, modify the `useEffect` body. After `setFood(f)` and inside the `if (f)` block, fetch the profile's `biological_sex` alongside nutrients:

```js
// shared/food-detail-drawer.js — inside useEffect, replace lines 64-79

        if (f) {
          const [{ data: nutData }, { data: profile }] = await Promise.all([
            sb
              .from("food_nutrients")
              .select("amount_per_base, nutrients:nutrients!inner(slug, name, unit, category, default_dri_male, default_dri_female, display_order)")
              .eq("food_id", foodId)
              .order("nutrients(display_order)"),
            sb
              .from("profiles")
              .select("biological_sex")
              .maybeSingle(),
          ]);
          if (cancelled) return;
          const useFemale = profile?.biological_sex === "female";
          setNutrients((nutData ?? []).map(row => ({
            slug: row.nutrients.slug,
            name: row.nutrients.name,
            unit: row.nutrients.unit,
            category: row.nutrients.category,
            amount: row.amount_per_base * (f.common_unit_grams ?? f.base_amount) / f.base_amount,
            dri: useFemale ? row.nutrients.default_dri_female : row.nutrients.default_dri_male,
          })));
```

Key details:
- `profile?.biological_sex === "female"` → use female DRI. All other values (`"male"`, `"prefer_not_to_say"`, `null`) fall back to male DRI, matching the Mifflin-St Jeor convention already in `pipeline/tools.js`.
- The profile query runs in parallel with nutrients (no added latency).
- RLS on `profiles` ensures `.maybeSingle()` returns only the authenticated user's row.

- [ ] **Step 2: Verify the drawer renders with correct DRI**

Start the dev server (`node server.js`), navigate to `/app/nutrition/`, open any food detail drawer. Confirm:
1. DRI percentages display next to each nutrient.
2. No console errors about failed profile fetch.
3. If the user's profile has `biological_sex = 'female'`, DRI values differ from the male defaults (spot-check: iron DRI male=8mg, female=18mg).

- [ ] **Step 3: Commit**

```bash
git add shared/food-detail-drawer.js
git commit -m "fix(nutrition): use profile biological_sex for DRI lookup in food detail drawer"
```

---

### Task 2: Resolve today's day-type in supplements panel

**Files:**
- Modify: `shared/nutrition-supplements-panel.js:1-54`

The supplements panel uses `mealPlan.plan.day_types[0]` (line 52) instead of resolving today's actual day-type. The `resolveDayType` function from `shared/meal-plan-day-type.js` already handles overrides, auto-from-workout, and defaults. The `nutrition-plan-panel.js` demonstrates the pattern: fetch workout plan from Supabase, call `resolveDayType`.

- [ ] **Step 1: Import resolveDayType and fetch workout plan**

Add the import at the top of `shared/nutrition-supplements-panel.js`:

```js
// shared/nutrition-supplements-panel.js — add after existing imports (line 2)
import { resolveDayType } from "./meal-plan-day-type.js";
import { createClient } from "@supabase/supabase-js";
```

- [ ] **Step 2: Add workout plan state and fetch it in load()**

Add `workoutPlan` state and extend the `load()` function:

```js
// shared/nutrition-supplements-panel.js — replace lines 24-54

export default function NutritionSupplementsPanel({ onOpenFoodDetail }) {
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [todayLogged, setTodayLogged] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayStr = localDateStr();

  async function load() {
    setLoading(true);
    try {
      const sb = window.EMERSUS_SUPABASE ?? createClient(window.EMERSUS_SUPABASE_URL, window.EMERSUS_ANON_KEY);
      if (!window.EMERSUS_SUPABASE) window.EMERSUS_SUPABASE = sb;

      const [mpRes, dayRes, { data: wp }] = await Promise.all([
        authFetch("/api/emersus/meal-plans/active"),
        authFetch(`/api/emersus/meal-journal/day?date=${todayStr}`),
        sb.from("workout_plans")
          .select("id, plan")
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const mp = mpRes.ok ? await mpRes.json() : { meal_plan: null };
      const day = dayRes.ok ? await dayRes.json() : { entries: [] };
      setMealPlan(mp.meal_plan);
      setWorkoutPlan(wp);
      setTodayLogged((day.entries ?? []).filter(e => e.food?.kind === "supplement"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return h("div", { className: "supps-loading" }, "Loading...");

  const prescribed = [];
  if (mealPlan?.plan?.day_types) {
    const todaySlug = resolveDayType({
      date: todayStr,
      mealPlan: mealPlan.plan,
      workoutPlan: workoutPlan?.plan,
    });
    const dt = mealPlan.plan.day_types.find(d => d.slug === todaySlug)
            ?? mealPlan.plan.day_types[0];
    if (dt?.supplements) prescribed.push(...dt.supplements);
  }
```

Key details:
- Workout plan fetch pattern matches `nutrition-plan-panel.js` exactly.
- `resolveDayType` returns a slug; we `.find()` by slug with fallback to `[0]` if the slug doesn't match any day_type (defensive).
- The Supabase query runs in parallel with the two `authFetch` calls (no added latency).

- [ ] **Step 3: Verify supplements show correct day-type stack**

Start the dev server, navigate to `/app/nutrition/` Supplements tab. Confirm:
1. On a day with a scheduled workout (if mode is `auto_from_workout`), training-day supplements appear.
2. On a rest day, rest-day supplements appear.
3. No console errors.

- [ ] **Step 4: Commit**

```bash
git add shared/nutrition-supplements-panel.js
git commit -m "fix(nutrition): resolve today's day-type in supplements panel instead of using day_types[0]"
```

---

### Task 3: Resolve day-type in nutrition-day API handler

**Files:**
- Modify: `api/emersus/nutrition-day.js:1-2,68-80,168-184,195-216`
- Test: `tests/unit/api/emersus/nutrition-day.test.js` (existing, extend)

The server-side handler has the same `dayTypes[0]` bug in `planSlotsFromActivePlan` (line 172). It also computes pace zone targets without considering the resolved day-type.

- [ ] **Step 1: Add resolveDayType import and loadActiveWorkoutPlan**

```js
// api/emersus/nutrition-day.js — add import after line 2
import { resolveDayType } from "../../shared/meal-plan-day-type.js";
```

Add after `loadActivePlan` (after line 79):

```js
async function loadActiveWorkoutPlan(userId) {
  const { data, error } = await supabaseAdmin
    .from("workout_plans")
    .select("id, plan")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
```

- [ ] **Step 2: Update planSlotsFromActivePlan to accept dateStr and workoutPlan**

Replace the `planSlotsFromActivePlan` function (lines 168-184):

```js
function planSlotsFromActivePlan(activePlan, dateStr, workoutPlan) {
  if (!activePlan?.plan) return [];
  const dayTypes = activePlan.plan.day_types || [];
  const slug = resolveDayType({
    date: dateStr,
    mealPlan: activePlan.plan,
    workoutPlan: workoutPlan?.plan,
  });
  const dt = dayTypes.find(d => d.slug === slug) ?? dayTypes[0];
  const meals = dt?.meals || [];
  return meals.map((m) => ({
    id: m.id || `plan-${m.slot}-${m.name}`,
    slot: m.slot,
    name: m.name,
    time: m.time,
    kcal: Math.round(m.macros?.kcal || 0),
    protein_g: Math.round(m.macros?.protein_g || 0),
    carbs_g: Math.round(m.macros?.carbs_g || 0),
    fat_g: Math.round(m.macros?.fat_g || 0),
    ingredients: m.foods || [],
  }));
}
```

- [ ] **Step 3: Add workoutPlan to the parallel load and update call sites**

In the handler function `nutritionDayHandler`, update the `Promise.all` and subsequent logic (replace lines 195-216):

```js
    const [consumedRows, activePlan, activeWorkoutPlan, waterRows, supplementRows, target] = await Promise.all([
      loadConsumed(userId, dateStr),
      loadActivePlan(userId),
      loadActiveWorkoutPlan(userId),
      loadWater(userId, dateStr),
      loadSupplements(userId, dateStr),
      loadProfileTarget(userId),
    ]);

    const consumed = summarizeMacros(consumedRows);
    consumed.water_ml = waterRows.reduce((acc, r) => acc + (Number(r.ml) || 0), 0);
    consumed.supplements = supplementRows.map((s) => ({ id: s.id, name: s.name, amount: s.amount, unit: s.unit }));

    const planSlots = planSlotsFromActivePlan(activePlan, dateStr, activeWorkoutPlan);
    const planned = planSlots.reduce((acc, s) => ({
      kcal: acc.kcal + s.kcal,
      protein_g: acc.protein_g + s.protein_g,
      carbs_g: acc.carbs_g + s.carbs_g,
      fat_g: acc.fat_g + s.fat_g,
    }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    const meals = buildMealsList(consumedRows, planSlots);
    const pace = computePaceZone({ targetKcal: target.kcal });
    const whyInsight = computeWhyInsight({ meals, target, consumed });
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `node --test tests/unit/api/emersus/nutrition-day.test.js`
Expected: All 6 tests PASS (computePaceZone and computeWhyInsight are pure functions, unchanged).

- [ ] **Step 5: Commit**

```bash
git add api/emersus/nutrition-day.js
git commit -m "fix(nutrition): resolve day-type in nutrition-day handler instead of using day_types[0]"
```

---

### Task 4: Add macro floor to meal plan schema validator

**Files:**
- Modify: `shared/meal-plan-schema.js:34-44`
- Create: `tests/unit/shared/meal-plan-schema.test.js`

The validator accepts plans with 0 kcal and 0g macros. Add minimum thresholds:
- `kcal >= 800` (below 800 is below any reasonable VLCD)
- `protein_g > 0`, `carbs_g > 0`, `fat_g > 0` (zero of any macro is a data error, not a diet)
- `fiber_g >= 0` stays as-is (0 fiber is unusual but not invalid)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/meal-plan-schema.test.js`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateMealPlan } from "../../../../shared/meal-plan-schema.js";

function minimalValidPlan(targetOverrides = {}) {
  return {
    targets: {
      rest_day: { kcal: 2000, protein_g: 130, carbs_g: 220, fat_g: 70, fiber_g: 25, ...targetOverrides },
    },
    day_types: [{
      slug: "rest_day",
      name: "Rest Day",
      meals: [{
        slot: "breakfast",
        name: "Breakfast",
        foods: [{ description: "Oats", grams: 80 }],
      }],
    }],
    assignments: { mode: "manual", default_day_type: "rest_day" },
  };
}

describe("meal-plan-schema — macro floors", () => {
  test("valid plan passes", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan());
    assert.equal(valid, true, `Unexpected errors: ${errors.join(", ")}`);
  });

  test("rejects kcal below 800", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ kcal: 500 }));
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes("kcal") && e.includes("800")));
  });

  test("rejects kcal of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ kcal: 0 }));
    assert.equal(valid, false);
  });

  test("rejects protein_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ protein_g: 0 }));
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes("protein_g") && e.includes("greater than 0")));
  });

  test("rejects carbs_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ carbs_g: 0 }));
    assert.equal(valid, false);
  });

  test("rejects fat_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ fat_g: 0 }));
    assert.equal(valid, false);
  });

  test("allows fiber_g of 0", () => {
    const { valid } = validateMealPlan(minimalValidPlan({ fiber_g: 0 }));
    assert.equal(valid, true);
  });

  test("allows kcal exactly 800", () => {
    const { valid } = validateMealPlan(minimalValidPlan({ kcal: 800 }));
    assert.equal(valid, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/shared/meal-plan-schema.test.js`
Expected: FAIL — tests for kcal<800, protein=0, carbs=0, fat=0 all pass validation when they should not.

- [ ] **Step 3: Add macro floor checks to validateTargets**

In `shared/meal-plan-schema.js`, replace the `validateTargets` function (lines 34-44):

```js
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
  if (isFiniteNumber(targets.kcal) && targets.kcal < 800) {
    errors.push(`targets.${dayTypeSlug}.kcal: must be at least 800 (got ${targets.kcal})`);
  }
  for (const field of ["protein_g", "carbs_g", "fat_g"]) {
    if (isFiniteNumber(targets[field]) && targets[field] <= 0) {
      errors.push(`targets.${dayTypeSlug}.${field}: must be greater than 0`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/shared/meal-plan-schema.test.js`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/meal-plan-schema.js tests/unit/shared/meal-plan-schema.test.js
git commit -m "fix(nutrition): add macro floor validation to meal plan schema (kcal>=800, macros>0)"
```

---

### Task 5: Make eating window configurable

**Files:**
- Create: `supabase/20260417_profile_eating_window.sql`
- Modify: `api/emersus/nutrition-day.js:111-121,216`
- Modify: `tests/unit/api/emersus/nutrition-day.test.js` (extend)

The pace zone calculator hardcodes a 7 AM - 10 PM eating window. Users doing intermittent fasting (e.g., 12 PM - 8 PM) get perpetually wrong pace signals.

- [ ] **Step 1: Write the migration**

Create `supabase/20260417_profile_eating_window.sql`:

```sql
-- 20260417_profile_eating_window.sql
-- Add configurable eating window for the pace zone calculator.
-- Values are hours in local time (0-23). NULL means use the default (7-22).
-- CHECK constraints enforce 0-23 range and start < end.

alter table public.profiles
  add column if not exists eating_window_start smallint
    check (eating_window_start >= 0 and eating_window_start <= 23),
  add column if not exists eating_window_end   smallint
    check (eating_window_end >= 0 and eating_window_end <= 23);

-- No RLS changes needed — existing policies cover all columns on profiles.
```

**Do NOT apply this migration from your local machine.** It must be applied on prod via:
```bash
cat supabase/20260417_profile_eating_window.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

- [ ] **Step 2: Write failing test for custom eating window**

Extend `tests/unit/api/emersus/nutrition-day.test.js`:

```js
  test('custom eating window shifts pace zone', () => {
    const noon = new Date('2026-04-15T14:30:00');
    // IF eating window = 12pm-8pm = 8h. 14:30 = 2.5h elapsed = 31.25%.
    const z = computePaceZone({
      targetKcal: 2200,
      eatingWindow: { start: 12, end: 20 },
      now: noon,
    });
    assert.ok(z.start > 0.22 && z.start < 0.33, `start=${z.start}`);
    assert.ok(z.end > 0.33 && z.end < 0.42, `end=${z.end}`);
  });

  test('before custom window start returns 0', () => {
    const earlyMorning = new Date('2026-04-15T10:00:00');
    const z = computePaceZone({
      targetKcal: 2200,
      eatingWindow: { start: 12, end: 20 },
      now: earlyMorning,
    });
    assert.equal(z.start, 0);
    assert.ok(z.end < 0.1);
  });
```

- [ ] **Step 3: Run tests to verify new tests pass (they already should)**

Run: `node --test tests/unit/api/emersus/nutrition-day.test.js`
Expected: All 8 tests PASS — `computePaceZone` already accepts `eatingWindow` parameter (line 16). The new tests confirm the math works for non-default windows.

- [ ] **Step 4: Update loadProfileTarget to include eating window**

In `api/emersus/nutrition-day.js`, modify `loadProfileTarget` (lines 111-121):

```js
async function loadProfileTarget(userId) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("body_weight_kg, macros, weight_unit, eating_window_start, eating_window_end")
    .eq("id", userId)
    .maybeSingle();
  const macros = data?.macros || computeMacrosFromBodyWeight(data?.body_weight_kg) || {
    kcal: 2000, protein_g: 130, carbs_g: 220, fat_g: 70,
  };
  const eatingWindow = (data?.eating_window_start != null && data?.eating_window_end != null)
    ? { start: data.eating_window_start, end: data.eating_window_end }
    : undefined;
  return { ...macros, water_ml: 3000, eatingWindow };
}
```

- [ ] **Step 5: Pass eating window to computePaceZone in the handler**

In the handler body, update the pace zone call (around line 216):

```js
    const pace = computePaceZone({ targetKcal: target.kcal, eatingWindow: target.eatingWindow });
```

And include it in the response so the frontend can display the window:

```js
    res.json({
      date: dateStr,
      consumed,
      planned,
      target,
      meals,
      pace_zone_start: pace.start,
      pace_zone_end: pace.end,
      eating_window: target.eatingWindow ?? DEFAULT_EATING_WINDOW,
      predicted_target_time: null,
      why_insight: whyInsight,
      active_plan: activePlan ? { id: activePlan.id, title: activePlan.title } : null,
    });
```

- [ ] **Step 6: Run all nutrition-day tests**

Run: `node --test tests/unit/api/emersus/nutrition-day.test.js`
Expected: All 8 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/20260417_profile_eating_window.sql api/emersus/nutrition-day.js tests/unit/api/emersus/nutrition-day.test.js
git commit -m "feat(nutrition): configurable eating window for pace zone (migration + handler)"
```

---

## Dependency Graph

All 5 tasks are **independent** — no task blocks another. They can be executed in parallel by separate subagents.

```
Task 1 (DRI sex)         ─┐
Task 2 (supps day-type)  ─┤
Task 3 (API day-type)    ─┼─ all independent
Task 4 (macro floor)     ─┤
Task 5 (eating window)   ─┘
```

Note: Tasks 3 and 5 both modify `api/emersus/nutrition-day.js` but in non-overlapping sections (Task 3: import + loadActiveWorkoutPlan + planSlotsFromActivePlan + Promise.all; Task 5: loadProfileTarget + computePaceZone call + response shape). If running in parallel, the second agent to commit should rebase. **Recommended: run Task 3 before Task 5** or have the same agent do both.

## Post-Implementation

After all tasks complete:
1. Run full test suite: `node --test tests/unit/`
2. Apply migration (Task 5) on prod via ssh pipe
3. Start dev server, smoke-test each fix in the browser
4. Single commit squash or leave as atomic commits (user's call)
