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

  // Probe for the helper function. If resolve_day_type_from_jsonb is not
  // yet deployed (running this test pre-Phase-5), skip the SQL half gracefully.
  let helperExists = false;
  try {
    const { error } = await sb.rpc("resolve_day_type_from_jsonb", {
      p_date: "2026-01-01",
      p_meal_plan: { day_types: [], assignments: { mode: "manual", default_day_type: "rest_day" } },
      p_workout_plan: null,
    });
    helperExists = !error;
  } catch {
    helperExists = false;
  }

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
