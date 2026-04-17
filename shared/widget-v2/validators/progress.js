import { validateBase } from "./index.js";

const PROGRESS_TYPES = new Set(["pr_timeline", "volume_trend"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validatePRTimeline(data) {
  const errors = [];
  if (typeof data.lift !== "string" || !data.lift.trim()) errors.push("data.lift");
  if (!["kg", "lb"].includes(data.unit)) errors.push("data.unit must be kg|lb");
  if (!Array.isArray(data.entries) || data.entries.length < 1) errors.push("data.entries must be non-empty");
  else {
    data.entries.forEach((e, i) => {
      if (!ISO_DATE.test(e.date || "")) errors.push(`entries[${i}].date must be YYYY-MM-DD`);
      if (typeof e.load !== "number" || e.load <= 0) errors.push(`entries[${i}].load`);
      if (!Number.isInteger(e.reps) || e.reps < 1) errors.push(`entries[${i}].reps`);
    });
  }
  return errors;
}

function validateVolumeTrend(data) {
  const errors = [];
  if (typeof data.metric !== "string" || !data.metric.trim()) errors.push("data.metric");
  if (!Array.isArray(data.points) || data.points.length < 2) errors.push("data.points (need >=2)");
  else {
    data.points.forEach((p, i) => {
      if (!ISO_DATE.test(p.week_start || "")) errors.push(`points[${i}].week_start must be YYYY-MM-DD`);
      if (typeof p.value !== "number" || p.value < 0) errors.push(`points[${i}].value`);
    });
  }
  return errors;
}

export function validateProgressWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!PROGRESS_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown progress type: ${payload.type}`] };
  }
  const typeErrors =
    payload.type === "pr_timeline" ? validatePRTimeline(payload.data) :
    payload.type === "volume_trend" ? validateVolumeTrend(payload.data) :
    [];
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
