import { validateBase } from "./index.js";

const CALC_TYPES = new Set([
  "macro_ring", "tdee_calculator", "one_rm_estimator",
  "macro_calculator", "plate_loader_visual", "rpe_to_percent_rm",
  "body_fat_estimator", "carb_cycling_calculator",
  "protein_target_calculator", "pace_calculator",
]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function vMacroRing(d) {
  const e = [];
  if (!isNum(d.kcal_total) || d.kcal_total < 0) e.push("kcal_total");
  if (!["cut", "maintenance", "bulk"].includes(d.phase)) e.push("phase");
  for (const leg of ["protein", "carbs", "fat"]) {
    const v = d[leg];
    if (!v) { e.push(leg); continue; }
    for (const f of ["grams", "target_grams", "kcal"]) if (!isNum(v[f]) || v[f] < 0) e.push(`${leg}.${f}`);
  }
  return e;
}
function vTdee(d) {
  const e = [];
  for (const f of ["weight_kg", "height_cm", "age", "bmr", "tdee"]) if (!isNum(d[f]) || d[f] <= 0) e.push(f);
  if (!["male", "female"].includes(d.sex)) e.push("sex");
  if (!["sedentary", "light", "moderate", "active", "very_active"].includes(d.activity_level)) e.push("activity_level");
  return e;
}
function v1RM(d) {
  const e = [];
  if (!isStr(d.lift)) e.push("lift");
  if (!["kg", "lb"].includes(d.unit)) e.push("unit");
  if (!isNum(d.load) || d.load <= 0) e.push("load");
  if (!isInt(d.reps) || d.reps < 1 || d.reps > 20) e.push("reps");
  if (!isNum(d.epley_1rm) || d.epley_1rm < d.load) e.push("epley_1rm");
  if (!isNum(d.brzycki_1rm) || d.brzycki_1rm < d.load) e.push("brzycki_1rm");
  return e;
}
function vMacroCalc(d) {
  const e = [];
  if (!isNum(d.kcal_total) || d.kcal_total <= 0) e.push("kcal_total");
  if (!isNum(d.protein_g_per_kg) || d.protein_g_per_kg <= 0) e.push("protein_g_per_kg");
  if (!isNum(d.fat_pct) || d.fat_pct < 0 || d.fat_pct > 1) e.push("fat_pct");
  if (!isNum(d.body_weight_kg) || d.body_weight_kg <= 0) e.push("body_weight_kg");
  for (const f of ["protein_g", "fat_g", "carbs_g"]) if (!isNum(d[f]) || d[f] < 0) e.push(f);
  return e;
}
function vPlateLoader(d) {
  const e = [];
  if (!isNum(d.target_kg) || d.target_kg <= 0) e.push("target_kg");
  if (!isNum(d.bar_kg) || d.bar_kg < 0) e.push("bar_kg");
  if (!Array.isArray(d.plates_per_side) || d.plates_per_side.length < 1) e.push("plates_per_side");
  else d.plates_per_side.forEach((p, i) => {
    if (!isNum(p.kg) || p.kg <= 0) e.push(`plates_per_side[${i}].kg`);
    if (!isInt(p.count) || p.count < 1) e.push(`plates_per_side[${i}].count`);
  });
  return e;
}
function vRpeTable(d) {
  const e = [];
  if (!Array.isArray(d.rows) || d.rows.length < 2) e.push("rows");
  else d.rows.forEach((r, i) => {
    if (!isInt(r.reps) || r.reps < 1) e.push(`rows[${i}].reps`);
    if (!Array.isArray(r.pcts_by_rpe) || r.pcts_by_rpe.length !== 5) e.push(`rows[${i}].pcts_by_rpe (need 5: RPE 6,7,8,9,10)`);
    else r.pcts_by_rpe.forEach((pct, j) => { if (!isNum(pct) || pct < 0 || pct > 100) e.push(`rows[${i}].pcts_by_rpe[${j}]`); });
  });
  return e;
}
function vBodyFat(d) {
  const e = [];
  if (!["male", "female"].includes(d.sex)) e.push("sex");
  for (const f of ["neck_cm", "waist_cm", "height_cm", "body_fat_pct"]) if (!isNum(d[f]) || d[f] <= 0) e.push(f);
  if (d.sex === "female" && (!isNum(d.hip_cm) || d.hip_cm <= 0)) e.push("hip_cm (required for female)");
  return e;
}
function vCarbCycling(d) {
  const e = [];
  if (!isNum(d.weekly_avg_g) || d.weekly_avg_g <= 0) e.push("weekly_avg_g");
  if (!Array.isArray(d.plan) || d.plan.length !== 7) e.push("plan (need 7)");
  else d.plan.forEach((day, i) => {
    if (!isStr(day.day)) e.push(`plan[${i}].day`);
    if (!["high", "med", "low"].includes(day.tier)) e.push(`plan[${i}].tier`);
    if (!isNum(day.carbs_g) || day.carbs_g < 0) e.push(`plan[${i}].carbs_g`);
  });
  return e;
}
function vProteinTarget(d) {
  const e = [];
  if (!isNum(d.body_weight_kg) || d.body_weight_kg <= 0) e.push("body_weight_kg");
  if (!isInt(d.meal_count) || d.meal_count < 1 || d.meal_count > 8) e.push("meal_count");
  if (!isNum(d.total_g) || d.total_g <= 0) e.push("total_g");
  if (!isNum(d.per_meal_g) || d.per_meal_g <= 0) e.push("per_meal_g");
  if (!isNum(d.leucine_threshold_g)) e.push("leucine_threshold_g");
  return e;
}
function vPace(d) {
  const e = [];
  if (!isNum(d.distance_km) || d.distance_km <= 0) e.push("distance_km");
  if (!isNum(d.time_sec) || d.time_sec <= 0) e.push("time_sec");
  if (!isNum(d.pace_sec_per_km) || d.pace_sec_per_km <= 0) e.push("pace_sec_per_km");
  if (!isNum(d.speed_kmh) || d.speed_kmh <= 0) e.push("speed_kmh");
  if (d.zone != null && !["Z1", "Z2", "Z3", "Z4", "Z5"].includes(d.zone)) e.push("zone");
  return e;
}

export function validateCalculatorWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!CALC_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown calculator type: ${payload.type}`] };
  }
  const map = {
    macro_ring: vMacroRing,
    tdee_calculator: vTdee,
    one_rm_estimator: v1RM,
    macro_calculator: vMacroCalc,
    plate_loader_visual: vPlateLoader,
    rpe_to_percent_rm: vRpeTable,
    body_fat_estimator: vBodyFat,
    carb_cycling_calculator: vCarbCycling,
    protein_target_calculator: vProteinTarget,
    pace_calculator: vPace,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
