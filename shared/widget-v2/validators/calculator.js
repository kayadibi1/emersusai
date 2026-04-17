import { validateBase } from "./index.js";

const CALC_TYPES = new Set([
  "macro_ring",
  "tdee_calculator",
  "one_rm_estimator",
  // Future: macro_calculator, plate_loader_visual, rpe_to_percent_rm,
  // body_fat_estimator, carb_cycling_calculator, protein_target_calculator,
  // pace_calculator
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

function validateTDEE(data) {
  const errors = [];
  for (const f of ["weight_kg", "height_cm", "age", "bmr", "tdee"]) {
    if (typeof data[f] !== "number" || data[f] <= 0) errors.push(`data.${f}`);
  }
  if (!["male", "female"].includes(data.sex)) errors.push("data.sex must be male|female");
  if (!["sedentary", "light", "moderate", "active", "very_active"].includes(data.activity_level)) {
    errors.push("data.activity_level");
  }
  return errors;
}

function validateOneRM(data) {
  const errors = [];
  if (typeof data.lift !== "string" || !data.lift.trim()) errors.push("data.lift");
  if (!["kg", "lb"].includes(data.unit)) errors.push("data.unit must be kg|lb");
  if (typeof data.load !== "number" || data.load <= 0) errors.push("data.load");
  if (!Number.isInteger(data.reps) || data.reps < 1 || data.reps > 20) errors.push("data.reps must be 1-20");
  if (typeof data.epley_1rm !== "number" || data.epley_1rm < data.load) errors.push("data.epley_1rm");
  if (typeof data.brzycki_1rm !== "number" || data.brzycki_1rm < data.load) errors.push("data.brzycki_1rm");
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
  else if (payload.type === "tdee_calculator") typeErrors = validateTDEE(payload.data);
  else if (payload.type === "one_rm_estimator") typeErrors = validateOneRM(payload.data);
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
