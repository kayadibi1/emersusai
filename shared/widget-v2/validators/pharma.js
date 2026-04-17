import { validateBase } from "./index.js";

const PHARMA_TYPES = new Set([
  "dose_response_curve", "half_life_decay",
  "supplement_stack_schedule", "loading_vs_maintenance",
  "absorption_multi_protein", "effect_duration_strip",
  "dose_threshold_band",
]);

function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

// ── existing ──
function validateDoseResponse(data) {
  const errors = [];
  if (!isStr(data.compound)) errors.push("data.compound");
  if (!["mg", "mg/kg", "g", "IU"].includes(data.unit)) errors.push("data.unit");
  if (!Array.isArray(data.points) || data.points.length < 2) errors.push("data.points");
  else data.points.forEach((p, i) => {
    if (!isNum(p.dose) || p.dose < 0) errors.push(`points[${i}].dose`);
    if (!isNum(p.effect_pct)) errors.push(`points[${i}].effect_pct`);
  });
  if (data.recommended_range && (!isNum(data.recommended_range.min) || !isNum(data.recommended_range.max) || data.recommended_range.max < data.recommended_range.min)) {
    errors.push("data.recommended_range");
  }
  return errors;
}
function validateHalfLifeDecay(data) {
  const errors = [];
  if (!isStr(data.compound)) errors.push("data.compound");
  if (!isNum(data.half_life_hours) || data.half_life_hours <= 0) errors.push("data.half_life_hours");
  if (!isNum(data.initial_dose) || data.initial_dose <= 0) errors.push("data.initial_dose");
  if (!isStr(data.dose_unit)) errors.push("data.dose_unit");
  if (!Number.isInteger(data.horizon_hours) || data.horizon_hours <= 0) errors.push("data.horizon_hours");
  return errors;
}

// ── new ──
function validateSupplementStack(data) {
  const errors = [];
  if (!Array.isArray(data.supplements) || data.supplements.length < 1) errors.push("data.supplements");
  else data.supplements.forEach((s, i) => {
    if (!isStr(s.name)) errors.push(`supplements[${i}].name`);
    if (!Array.isArray(s.doses) || s.doses.length < 1) errors.push(`supplements[${i}].doses`);
    else s.doses.forEach((d, j) => {
      if (!isNum(d.hour) || d.hour < 0 || d.hour > 23) errors.push(`supplements[${i}].doses[${j}].hour`);
      if (!isNum(d.amount) || d.amount <= 0) errors.push(`supplements[${i}].doses[${j}].amount`);
      if (!isStr(d.unit)) errors.push(`supplements[${i}].doses[${j}].unit`);
    });
  });
  return errors;
}
function validateLoadingVsMaintenance(data) {
  const errors = [];
  if (!Array.isArray(data.protocols) || data.protocols.length !== 2) errors.push("data.protocols (need exactly 2)");
  else data.protocols.forEach((p, i) => {
    if (!isStr(p.label)) errors.push(`protocols[${i}].label`);
    if (!Array.isArray(p.points) || p.points.length < 2) errors.push(`protocols[${i}].points`);
    else p.points.forEach((pt, j) => {
      if (!isNum(pt.x)) errors.push(`protocols[${i}].points[${j}].x`);
      if (!isNum(pt.y)) errors.push(`protocols[${i}].points[${j}].y`);
    });
  });
  if (data.saturation_y != null && !isNum(data.saturation_y)) errors.push("data.saturation_y");
  if (!isStr(data.x_label)) errors.push("data.x_label");
  if (!isStr(data.y_label)) errors.push("data.y_label");
  return errors;
}
function validateAbsorption(data) {
  const errors = [];
  if (!Array.isArray(data.curves) || data.curves.length < 2 || data.curves.length > 4) errors.push("data.curves (2-4)");
  else data.curves.forEach((c, i) => {
    if (!isStr(c.label)) errors.push(`curves[${i}].label`);
    if (c.peak_hour != null && !isNum(c.peak_hour)) errors.push(`curves[${i}].peak_hour`);
    if (!Array.isArray(c.points) || c.points.length < 2) errors.push(`curves[${i}].points`);
    else c.points.forEach((pt, j) => {
      if (!isNum(pt.hour) || pt.hour < 0) errors.push(`curves[${i}].points[${j}].hour`);
      if (!isNum(pt.amount) || pt.amount < 0) errors.push(`curves[${i}].points[${j}].amount`);
    });
  });
  if (!Number.isInteger(data.total_hours) || data.total_hours <= 0) errors.push("data.total_hours");
  return errors;
}
function validateEffectDuration(data) {
  const errors = [];
  if (!Array.isArray(data.compounds) || data.compounds.length < 1) errors.push("data.compounds");
  else data.compounds.forEach((c, i) => {
    if (!isStr(c.name)) errors.push(`compounds[${i}].name`);
    for (const f of ["onset_hour", "peak_start_hour", "peak_end_hour", "wearoff_hour"]) {
      if (!isNum(c[f]) || c[f] < 0) errors.push(`compounds[${i}].${f}`);
    }
    if (c.peak_start_hour > c.peak_end_hour) errors.push(`compounds[${i}] peak inversion`);
    if (c.onset_hour > c.peak_start_hour) errors.push(`compounds[${i}] onset after peak`);
  });
  if (!isNum(data.total_hours) || data.total_hours <= 0) errors.push("data.total_hours");
  return errors;
}
function validateDoseThresholdBand(data) {
  const errors = [];
  if (!isStr(data.compound)) errors.push("data.compound");
  if (!isStr(data.dose_unit)) errors.push("data.dose_unit");
  if (!isNum(data.current_dose) || data.current_dose < 0) errors.push("data.current_dose");
  if (!data.zones || typeof data.zones !== "object") errors.push("data.zones");
  else for (const f of ["sub_max", "therapeutic_min", "therapeutic_max", "over_min"]) {
    if (!isNum(data.zones[f])) errors.push(`zones.${f}`);
  }
  if (!isNum(data.axis_max) || data.axis_max <= 0) errors.push("data.axis_max");
  return errors;
}

export function validatePharmaWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!PHARMA_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown pharma type: ${payload.type}`] };
  }
  const map = {
    dose_response_curve: validateDoseResponse,
    half_life_decay: validateHalfLifeDecay,
    supplement_stack_schedule: validateSupplementStack,
    loading_vs_maintenance: validateLoadingVsMaintenance,
    absorption_multi_protein: validateAbsorption,
    effect_duration_strip: validateEffectDuration,
    dose_threshold_band: validateDoseThresholdBand,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
