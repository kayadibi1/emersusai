import { validateBase } from "./index.js";

const CALC_TYPES = new Set([
  "macro_ring",
  // Future: one_rm_estimator, tdee_calculator, macro_calculator, plate_loader_visual,
  // rpe_to_percent_rm, body_fat_estimator, carb_cycling_calculator,
  // protein_target_calculator, pace_calculator
]);

function validateMacroRing(data) {
  const errors = [];
  if (typeof data.kcal_total !== "number" || data.kcal_total < 0) {
    errors.push("data.kcal_total must be a non-negative number");
  }
  if (!["cut", "maintenance", "bulk"].includes(data.phase)) {
    errors.push(`data.phase must be cut|maintenance|bulk, got ${data.phase}`);
  }
  for (const leg of ["protein", "carbs", "fat"]) {
    const v = data[leg];
    if (!v || typeof v !== "object") {
      errors.push(`data.${leg} must be an object`);
      continue;
    }
    for (const f of ["grams", "target_grams", "kcal"]) {
      if (typeof v[f] !== "number" || v[f] < 0) {
        errors.push(`data.${leg}.${f} must be non-negative number`);
      }
    }
  }
  return errors;
}

export function validateCalculatorWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!CALC_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown calculator type: ${payload.type}`] };
  }
  let typeErrors = [];
  if (payload.type === "macro_ring") typeErrors = validateMacroRing(payload.data);
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
