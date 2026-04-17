import { validateBase } from "./index.js";

const PROGRESS_TYPES = new Set([
  "pr_timeline", "volume_trend",
  "pr_progression_line", "lift_progress_grid", "weekly_volume_trend",
  "adherence_calendar_heatmap", "body_comp_trend", "goal_trajectory_dual",
  "intervention_slopegraph", "session_consistency_strip", "vo2max_trend",
  "sleep_consistency_bars", "pr_celebration_card", "streak_counter_card",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isISO = (v) => isStr(v) && ISO_DATE.test(v);

function vPrTimeline(d) {
  const e = [];
  if (!isStr(d.lift)) e.push("lift");
  if (!["kg", "lb"].includes(d.unit)) e.push("unit");
  if (!Array.isArray(d.entries) || d.entries.length < 1) e.push("entries");
  else d.entries.forEach((x, i) => {
    if (!isISO(x.date)) e.push(`entries[${i}].date`);
    if (!isNum(x.load) || x.load <= 0) e.push(`entries[${i}].load`);
    if (!isInt(x.reps) || x.reps < 1) e.push(`entries[${i}].reps`);
  });
  return e;
}
function vVolumeTrend(d) {
  const e = [];
  if (!isStr(d.metric)) e.push("metric");
  if (!Array.isArray(d.trend_points) || d.trend_points.length < 2) e.push("trend_points");
  else d.trend_points.forEach((p, i) => {
    if (!isISO(p.week_start)) e.push(`trend_points[${i}].week_start`);
    if (!isNum(p.value) || p.value < 0) e.push(`trend_points[${i}].value`);
  });
  return e;
}
function vLiftGrid(d) {
  const e = [];
  if (!Array.isArray(d.lifts) || d.lifts.length < 1 || d.lifts.length > 9) e.push("lifts (1-9)");
  else d.lifts.forEach((l, i) => {
    if (!isStr(l.name)) e.push(`lifts[${i}].name`);
    if (!isNum(l.current) || l.current <= 0) e.push(`lifts[${i}].current`);
    if (!isNum(l.delta_pct)) e.push(`lifts[${i}].delta_pct`);
    if (!Array.isArray(l.sparkline) || l.sparkline.length < 2) e.push(`lifts[${i}].sparkline`);
    if (l.plateau != null && typeof l.plateau !== "boolean") e.push(`lifts[${i}].plateau`);
  });
  return e;
}
function vWeeklyVolume(d) {
  const e = [];
  if (!Array.isArray(d.weeks) || d.weeks.length < 2) e.push("weeks");
  else d.weeks.forEach((w, i) => {
    if (!isISO(w.week_start)) e.push(`weeks[${i}].week_start`);
    if (!Array.isArray(w.muscle_sets)) e.push(`weeks[${i}].muscle_sets`);
    else w.muscle_sets.forEach((m, j) => {
      if (!isStr(m.muscle)) e.push(`weeks[${i}].muscle_sets[${j}].muscle`);
      if (!isNum(m.sets) || m.sets < 0) e.push(`weeks[${i}].muscle_sets[${j}].sets`);
    });
  });
  if (!Array.isArray(d.muscle_order) || d.muscle_order.length < 1) e.push("muscle_order");
  return e;
}
function vAdherence(d) {
  const e = [];
  if (!Array.isArray(d.cells) || d.cells.length < 1) e.push("cells");
  else d.cells.forEach((c, i) => {
    if (!isISO(c.date)) e.push(`cells[${i}].date`);
    if (!isNum(c.intensity) || c.intensity < 0 || c.intensity > 1) e.push(`cells[${i}].intensity`);
  });
  return e;
}
function vBodyComp(d) {
  const e = [];
  if (!Array.isArray(d.comp_points) || d.comp_points.length < 2) e.push("comp_points");
  else d.comp_points.forEach((p, i) => {
    if (!isISO(p.date)) e.push(`comp_points[${i}].date`);
    if (!isNum(p.bw)) e.push(`comp_points[${i}].bw`);
    if (!isNum(p.lbm)) e.push(`comp_points[${i}].lbm`);
    if (!isNum(p.fm)) e.push(`comp_points[${i}].fm`);
  });
  return e;
}
function vGoalTrajectory(d) {
  const e = [];
  if (!Array.isArray(d.actual) || d.actual.length < 2) e.push("actual");
  else d.actual.forEach((p, i) => {
    if (!isISO(p.date)) e.push(`actual[${i}].date`);
    if (!isNum(p.value)) e.push(`actual[${i}].value`);
  });
  if (!Array.isArray(d.projected) || d.projected.length < 2) e.push("projected");
  else d.projected.forEach((p, i) => {
    if (!isISO(p.date)) e.push(`projected[${i}].date`);
    if (!isNum(p.low) || !isNum(p.high) || p.high < p.low) e.push(`projected[${i}]`);
  });
  if (!isNum(d.goal_value)) e.push("goal_value");
  return e;
}
function vSlopegraph(d) {
  const e = [];
  if (!isStr(d.before_label)) e.push("before_label");
  if (!isStr(d.after_label)) e.push("after_label");
  if (!Array.isArray(d.people) || d.people.length < 1) e.push("people");
  else d.people.forEach((p, i) => {
    if (!isStr(p.label)) e.push(`people[${i}].label`);
    if (!isNum(p.before) || !isNum(p.after)) e.push(`people[${i}].values`);
  });
  return e;
}
function vConsistency(d) {
  const e = [];
  if (!Array.isArray(d.sessions) || d.sessions.length < 5) e.push("sessions");
  else d.sessions.forEach((s, i) => {
    if (!isISO(s.date)) e.push(`sessions[${i}].date`);
    if (!isNum(s.hour) || s.hour < 0 || s.hour > 23.99) e.push(`sessions[${i}].hour`);
  });
  return e;
}
function vVo2max(d) {
  const e = [];
  if (!Array.isArray(d.vo2_points) || d.vo2_points.length < 2) e.push("vo2_points");
  else d.vo2_points.forEach((p, i) => {
    if (!isISO(p.date)) e.push(`vo2_points[${i}].date`);
    if (!isNum(p.value) || p.value <= 0) e.push(`vo2_points[${i}].value`);
  });
  if (!isStr(d.age_group)) e.push("age_group");
  return e;
}
function vSleepBars(d) {
  const e = [];
  if (!Array.isArray(d.nights) || d.nights.length < 3) e.push("nights");
  else d.nights.forEach((n, i) => {
    if (!isISO(n.date)) e.push(`nights[${i}].date`);
    if (!isNum(n.bed_hour)) e.push(`nights[${i}].bed_hour`);
    if (!isNum(n.wake_hour)) e.push(`nights[${i}].wake_hour`);
  });
  return e;
}
function vPrCelebration(d) {
  const e = [];
  if (!isStr(d.lift)) e.push("lift");
  if (!isNum(d.value) || d.value <= 0) e.push("value");
  if (!isStr(d.unit)) e.push("unit");
  if (d.previous != null && !isNum(d.previous)) e.push("previous");
  if (!isStr(d.context)) e.push("context");
  return e;
}
function vStreakCard(d) {
  const e = [];
  if (!isInt(d.current) || d.current < 0) e.push("current");
  if (!isInt(d.best) || d.best < 0) e.push("best");
  if (!Array.isArray(d.last_14) || d.last_14.length !== 14) e.push("last_14 (need exactly 14)");
  else d.last_14.forEach((v, i) => { if (typeof v !== "boolean") e.push(`last_14[${i}]`); });
  return e;
}

export function validateProgressWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!PROGRESS_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown progress type: ${payload.type}`] };
  }
  const map = {
    pr_timeline: vPrTimeline,
    volume_trend: vVolumeTrend,
    pr_progression_line: vPrTimeline,  // alias of pr_timeline per spec
    lift_progress_grid: vLiftGrid,
    weekly_volume_trend: vWeeklyVolume,
    adherence_calendar_heatmap: vAdherence,
    body_comp_trend: vBodyComp,
    goal_trajectory_dual: vGoalTrajectory,
    intervention_slopegraph: vSlopegraph,
    session_consistency_strip: vConsistency,
    vo2max_trend: vVo2max,
    sleep_consistency_bars: vSleepBars,
    pr_celebration_card: vPrCelebration,
    streak_counter_card: vStreakCard,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
