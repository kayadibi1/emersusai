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
