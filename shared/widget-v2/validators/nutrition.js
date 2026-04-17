import { validateBase } from "./index.js";

const NUTRITION_TYPES = new Set(["protein_distribution_bar", "meal_macro_stack"]);

// `meals` was renamed to `protein_meals` (protein_distribution_bar) and
// `macro_meals` (meal_macro_stack) to avoid an item-shape collision in the
// superset `data` schema required by strict:true.

function validateProteinDistribution(data) {
  const errors = [];
  if (typeof data.daily_target_g !== "number" || data.daily_target_g <= 0) {
    errors.push("data.daily_target_g must be positive number");
  }
  if (!Array.isArray(data.protein_meals) || data.protein_meals.length < 1) {
    errors.push("data.protein_meals must be non-empty array");
  } else {
    data.protein_meals.forEach((m, i) => {
      if (typeof m.slot !== "string" || !m.slot.trim()) errors.push(`protein_meals[${i}].slot`);
      if (typeof m.grams !== "number" || m.grams < 0) errors.push(`protein_meals[${i}].grams`);
      if (!Number.isInteger(m.hour) || m.hour < 0 || m.hour > 23) errors.push(`protein_meals[${i}].hour`);
    });
  }
  return errors;
}

function validateMealMacroStack(data) {
  const errors = [];
  if (typeof data.daily_total_kcal !== "number" || data.daily_total_kcal <= 0) {
    errors.push("data.daily_total_kcal must be positive number");
  }
  if (!Array.isArray(data.macro_meals) || data.macro_meals.length < 1) {
    errors.push("data.macro_meals must be non-empty array");
  } else {
    data.macro_meals.forEach((m, i) => {
      if (typeof m.name !== "string" || !m.name.trim()) errors.push(`macro_meals[${i}].name`);
      for (const f of ["protein_kcal", "carbs_kcal", "fat_kcal"]) {
        if (typeof m[f] !== "number" || m[f] < 0) errors.push(`macro_meals[${i}].${f}`);
      }
    });
  }
  return errors;
}

export function validateNutritionWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!NUTRITION_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown nutrition type: ${payload.type}`] };
  }
  const typeErrors =
    payload.type === "protein_distribution_bar" ? validateProteinDistribution(payload.data) :
    payload.type === "meal_macro_stack" ? validateMealMacroStack(payload.data) :
    [];
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
