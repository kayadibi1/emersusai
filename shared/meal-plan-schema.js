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
  if (isFiniteNumber(targets.kcal) && targets.kcal < 800) {
    errors.push(`targets.${dayTypeSlug}.kcal: must be at least 800 (got ${targets.kcal})`);
  }
  for (const field of ["protein_g", "carbs_g", "fat_g"]) {
    if (isFiniteNumber(targets[field]) && targets[field] <= 0) {
      errors.push(`targets.${dayTypeSlug}.${field}: must be greater than 0`);
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
    // fdc_id optional — the LLM may not always know it. Strict-mode tool
    // schema types this as ["integer", "null"], so null is a legitimate
    // value meaning "no FDC match available"; treat it the same as absent.
    if (food.fdc_id !== undefined && food.fdc_id !== null && !Number.isInteger(food.fdc_id)) {
      errors.push(`${fpath}.fdc_id: expected integer or null if present`);
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
