import { validateBase } from "./index.js";

const TRAINING_TYPES = new Set([
  "periodization_ladder", "volume_intensity_grid",
  "mev_mrv_range", "rpe_histogram", "rep_scheme_grid",
  "training_stress_balance", "fatigue_readiness_composite",
  "weekly_plan_calendar", "deload_protocol",
]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function validatePeriodization(d) {
  const e = [];
  if (!isInt(d.weeks) || d.weeks < 1) e.push("data.weeks");
  if (!["volume", "intensity", "frequency"].includes(d.focus_metric)) e.push("data.focus_metric");
  if (!Array.isArray(d.phases) || d.phases.length < 1) e.push("data.phases");
  else d.phases.forEach((p, i) => {
    if (!isStr(p.name)) e.push(`phases[${i}].name`);
    if (!isInt(p.start_week) || !isInt(p.end_week)) e.push(`phases[${i}].weeks`);
    if (p.end_week < p.start_week) e.push(`phases[${i}] inverted`);
    if (!isNum(p.relative_load) || p.relative_load < 0) e.push(`phases[${i}].load`);
  });
  return e;
}
function validateVolumeGrid(d) {
  const e = [];
  if (!Array.isArray(d.lifts) || d.lifts.length < 1) e.push("data.lifts");
  if (!Array.isArray(d.grid_weeks) || d.grid_weeks.length < 1) e.push("data.grid_weeks");
  if (!Array.isArray(d.cells)) e.push("data.cells");
  else d.cells.forEach((c, i) => {
    if (!isStr(c.lift)) e.push(`cells[${i}].lift`);
    if (!isInt(c.week)) e.push(`cells[${i}].week`);
    if (!isNum(c.volume) || c.volume < 0) e.push(`cells[${i}].volume`);
  });
  return e;
}
function validateMevMrv(d) {
  const e = [];
  if (!Array.isArray(d.muscles) || d.muscles.length < 1) e.push("data.muscles");
  else d.muscles.forEach((m, i) => {
    if (!isStr(m.name)) e.push(`muscles[${i}].name`);
    for (const f of ["mev", "mav", "mrv", "current"]) {
      if (!isNum(m[f]) || m[f] < 0) e.push(`muscles[${i}].${f}`);
    }
    if (m.mev > m.mav || m.mav > m.mrv) e.push(`muscles[${i}] zone inversion`);
  });
  if (!isStr(d.metric_label)) e.push("data.metric_label");
  return e;
}
function validateRpeHistogram(d) {
  const e = [];
  if (!Array.isArray(d.buckets) || d.buckets.length < 3) e.push("data.buckets");
  else d.buckets.forEach((b, i) => {
    if (!isNum(b.rpe) || b.rpe < 0 || b.rpe > 10) e.push(`buckets[${i}].rpe`);
    if (!isInt(b.count) || b.count < 0) e.push(`buckets[${i}].count`);
  });
  if (d.target_rpe != null && (!isNum(d.target_rpe) || d.target_rpe < 0 || d.target_rpe > 10)) e.push("data.target_rpe");
  return e;
}
function validateRepSchemeGrid(d) {
  const e = [];
  if (!Array.isArray(d.schemes) || d.schemes.length < 1) e.push("data.schemes");
  else d.schemes.forEach((s, i) => {
    if (!isStr(s.label)) e.push(`schemes[${i}].label`);
    if (!isNum(s.reps_low) || !isNum(s.reps_high)) e.push(`schemes[${i}].reps`);
    if (s.reps_low > s.reps_high) e.push(`schemes[${i}] rep inversion`);
    if (!isNum(s.pct_low) || !isNum(s.pct_high)) e.push(`schemes[${i}].pct`);
    if (!["STR", "HYP", "END", "POW"].includes(s.focus)) e.push(`schemes[${i}].focus`);
  });
  return e;
}
function validateTSB(d) {
  const e = [];
  if (!Array.isArray(d.series) || d.series.length < 5) e.push("data.series (need ≥5 days)");
  else d.series.forEach((s, i) => {
    if (!isStr(s.date)) e.push(`series[${i}].date`);
    for (const f of ["ctl", "atl", "tsb"]) if (!isNum(s[f])) e.push(`series[${i}].${f}`);
  });
  return e;
}
function validateFatigueReadiness(d) {
  const e = [];
  if (!isNum(d.readiness_score) || d.readiness_score < 0 || d.readiness_score > 100) e.push("data.readiness_score");
  if (!Array.isArray(d.signals) || d.signals.length < 1) e.push("data.signals");
  else d.signals.forEach((s, i) => {
    if (!isStr(s.name)) e.push(`signals[${i}].name`);
    if (!isNum(s.score) || s.score < 0 || s.score > 100) e.push(`signals[${i}].score`);
  });
  return e;
}
function validateWeeklyCalendar(d) {
  const e = [];
  if (!Array.isArray(d.days) || d.days.length !== 7) e.push("data.days (need exactly 7)");
  else d.days.forEach((day, i) => {
    if (!isStr(day.label)) e.push(`days[${i}].label`);
    if (day.intensity != null && (!isNum(day.intensity) || day.intensity < 0 || day.intensity > 1)) e.push(`days[${i}].intensity (0-1)`);
    if (day.session != null && !isStr(day.session)) e.push(`days[${i}].session`);
  });
  return e;
}
function validateDeload(d) {
  const e = [];
  for (const phase of ["before", "during", "after"]) {
    if (!d[phase] || typeof d[phase] !== "object") { e.push(`data.${phase}`); continue; }
    for (const f of ["sets", "rpe"]) {
      if (!isNum(d[phase][f]) || d[phase][f] < 0) e.push(`${phase}.${f}`);
    }
  }
  if (!Array.isArray(d.fatigue_curve) || d.fatigue_curve.length < 3) e.push("data.fatigue_curve");
  else d.fatigue_curve.forEach((pt, i) => {
    if (!isStr(pt.label)) e.push(`fatigue_curve[${i}].label`);
    if (!isNum(pt.value)) e.push(`fatigue_curve[${i}].value`);
  });
  return e;
}

export function validateTrainingWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!TRAINING_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown training type: ${payload.type}`] };
  }
  const map = {
    periodization_ladder: validatePeriodization,
    volume_intensity_grid: validateVolumeGrid,
    mev_mrv_range: validateMevMrv,
    rpe_histogram: validateRpeHistogram,
    rep_scheme_grid: validateRepSchemeGrid,
    training_stress_balance: validateTSB,
    fatigue_readiness_composite: validateFatigueReadiness,
    weekly_plan_calendar: validateWeeklyCalendar,
    deload_protocol: validateDeload,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
