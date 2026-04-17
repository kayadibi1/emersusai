import { validateBase } from "./index.js";

const TRAINING_TYPES = new Set(["periodization_ladder", "volume_intensity_grid"]);

function validatePeriodization(data) {
  const errors = [];
  if (!Number.isInteger(data.weeks) || data.weeks < 1) errors.push("data.weeks must be positive integer");
  if (!["volume", "intensity", "frequency"].includes(data.focus_metric)) {
    errors.push("data.focus_metric must be volume|intensity|frequency");
  }
  if (!Array.isArray(data.phases) || data.phases.length < 1) {
    errors.push("data.phases must be non-empty array");
  } else {
    data.phases.forEach((p, i) => {
      if (typeof p.name !== "string" || !p.name.trim()) errors.push(`phases[${i}].name`);
      if (!Number.isInteger(p.start_week)) errors.push(`phases[${i}].start_week`);
      if (!Number.isInteger(p.end_week)) errors.push(`phases[${i}].end_week`);
      if (p.end_week < p.start_week) errors.push(`phases[${i}] end_week < start_week`);
      if (typeof p.relative_load !== "number" || p.relative_load < 0) errors.push(`phases[${i}].relative_load`);
    });
  }
  return errors;
}

function validateVolumeIntensityGrid(data) {
  const errors = [];
  if (!Array.isArray(data.lifts) || data.lifts.length < 1) errors.push("data.lifts must be non-empty");
  if (!Array.isArray(data.weeks) || data.weeks.length < 1) errors.push("data.weeks must be non-empty");
  if (!Array.isArray(data.cells)) {
    errors.push("data.cells must be array");
  } else {
    data.cells.forEach((c, i) => {
      if (typeof c.lift !== "string") errors.push(`cells[${i}].lift`);
      if (!Number.isInteger(c.week)) errors.push(`cells[${i}].week`);
      if (typeof c.volume !== "number" || c.volume < 0) errors.push(`cells[${i}].volume`);
    });
  }
  return errors;
}

export function validateTrainingWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!TRAINING_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown training type: ${payload.type}`] };
  }
  const typeErrors =
    payload.type === "periodization_ladder" ? validatePeriodization(payload.data) :
    payload.type === "volume_intensity_grid" ? validateVolumeIntensityGrid(payload.data) :
    [];
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
