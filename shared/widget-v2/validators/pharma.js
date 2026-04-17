import { validateBase } from "./index.js";

const PHARMA_TYPES = new Set(["dose_response_curve", "half_life_decay"]);

function validateDoseResponse(data) {
  const errors = [];
  if (typeof data.compound !== "string" || !data.compound.trim()) errors.push("data.compound");
  if (!["mg", "mg/kg", "g", "IU"].includes(data.unit)) errors.push("data.unit");
  if (!Array.isArray(data.points) || data.points.length < 2) errors.push("data.points (need >=2)");
  else {
    data.points.forEach((p, i) => {
      if (typeof p.dose !== "number" || p.dose < 0) errors.push(`points[${i}].dose`);
      if (typeof p.effect_pct !== "number") errors.push(`points[${i}].effect_pct`);
    });
  }
  if (data.recommended_range && (
    typeof data.recommended_range.min !== "number" ||
    typeof data.recommended_range.max !== "number" ||
    data.recommended_range.max < data.recommended_range.min
  )) errors.push("data.recommended_range");
  return errors;
}

function validateHalfLifeDecay(data) {
  const errors = [];
  if (typeof data.compound !== "string" || !data.compound.trim()) errors.push("data.compound");
  if (typeof data.half_life_hours !== "number" || data.half_life_hours <= 0) errors.push("data.half_life_hours");
  if (typeof data.initial_dose !== "number" || data.initial_dose <= 0) errors.push("data.initial_dose");
  if (typeof data.dose_unit !== "string" || !data.dose_unit.trim()) errors.push("data.dose_unit");
  if (!Number.isInteger(data.horizon_hours) || data.horizon_hours <= 0) errors.push("data.horizon_hours");
  return errors;
}

export function validatePharmaWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!PHARMA_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown pharma type: ${payload.type}`] };
  }
  const typeErrors =
    payload.type === "dose_response_curve" ? validateDoseResponse(payload.data) :
    payload.type === "half_life_decay" ? validateHalfLifeDecay(payload.data) :
    [];
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
