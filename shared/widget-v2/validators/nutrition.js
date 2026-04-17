import { validateBase } from "./index.js";

const NUTRITION_TYPES = new Set([
  "protein_distribution_bar", "meal_macro_stack",
  "food_nutrient_scatter", "hydration_timeline", "micronutrient_radar",
  "calorie_balance_ledger", "meal_timing_strip", "tdee_waterfall",
  "macro_ring_nutrition",
]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function validateProteinDist(d) {
  const e = [];
  if (!isNum(d.daily_target_g) || d.daily_target_g <= 0) e.push("daily_target_g");
  if (!Array.isArray(d.protein_meals) || d.protein_meals.length < 1) e.push("protein_meals");
  else d.protein_meals.forEach((m, i) => {
    if (!isStr(m.slot)) e.push(`protein_meals[${i}].slot`);
    if (!isNum(m.grams) || m.grams < 0) e.push(`protein_meals[${i}].grams`);
    if (!isInt(m.hour) || m.hour < 0 || m.hour > 23) e.push(`protein_meals[${i}].hour`);
  });
  return e;
}
function validateMealStack(d) {
  const e = [];
  if (!isNum(d.daily_total_kcal) || d.daily_total_kcal <= 0) e.push("daily_total_kcal");
  if (!Array.isArray(d.macro_meals) || d.macro_meals.length < 1) e.push("macro_meals");
  else d.macro_meals.forEach((m, i) => {
    if (!isStr(m.name)) e.push(`macro_meals[${i}].name`);
    for (const f of ["protein_kcal", "carbs_kcal", "fat_kcal"]) if (!isNum(m[f]) || m[f] < 0) e.push(`macro_meals[${i}].${f}`);
  });
  return e;
}
function validateScatter(d) {
  const e = [];
  if (!isStr(d.x_label)) e.push("x_label");
  if (!isStr(d.y_label)) e.push("y_label");
  if (!Array.isArray(d.foods) || d.foods.length < 2) e.push("foods (≥2)");
  else d.foods.forEach((f, i) => {
    if (!isStr(f.name)) e.push(`foods[${i}].name`);
    if (!isNum(f.x) || f.x < 0) e.push(`foods[${i}].x`);
    if (!isNum(f.y) || f.y < 0) e.push(`foods[${i}].y`);
  });
  return e;
}
function validateHydration(d) {
  const e = [];
  if (!isNum(d.target_ml) || d.target_ml <= 0) e.push("target_ml");
  if (!Array.isArray(d.events) || d.events.length < 1) e.push("events");
  else d.events.forEach((ev, i) => {
    if (!isInt(ev.hour) || ev.hour < 0 || ev.hour > 23) e.push(`events[${i}].hour`);
    if (!isNum(ev.volume_ml) || ev.volume_ml < 0) e.push(`events[${i}].volume_ml`);
    if (ev.kind != null && !["fluid", "meal", "workout"].includes(ev.kind)) e.push(`events[${i}].kind`);
  });
  return e;
}
function validateRadar(d) {
  const e = [];
  if (!Array.isArray(d.axes) || d.axes.length < 3 || d.axes.length > 10) e.push("axes (3-10)");
  else d.axes.forEach((a, i) => {
    if (!isStr(a.name)) e.push(`axes[${i}].name`);
    if (!isNum(a.pct) || a.pct < 0) e.push(`axes[${i}].pct`);
  });
  return e;
}
function validateCalorieLedger(d) {
  const e = [];
  if (!Array.isArray(d.days) || d.days.length < 1) e.push("days");
  else d.days.forEach((day, i) => {
    if (!isStr(day.date)) e.push(`days[${i}].date`);
    if (!isNum(day.intake) || day.intake < 0) e.push(`days[${i}].intake`);
    if (!isNum(day.expenditure) || day.expenditure < 0) e.push(`days[${i}].expenditure`);
  });
  return e;
}
function validateMealTiming(d) {
  const e = [];
  if (!isNum(d.workout_hour) || d.workout_hour < 0 || d.workout_hour > 23) e.push("workout_hour");
  if (!Array.isArray(d.logged) || d.logged.length < 1) e.push("logged");
  else d.logged.forEach((m, i) => {
    if (!isNum(m.hour)) e.push(`logged[${i}].hour`);
    if (!isStr(m.label)) e.push(`logged[${i}].label`);
  });
  if (d.recommended_window && (!isNum(d.recommended_window.start) || !isNum(d.recommended_window.end))) e.push("recommended_window");
  return e;
}
function validateTdeeWaterfall(d) {
  const e = [];
  for (const f of ["bmr", "tea", "neat", "tef", "tdee"]) if (!isNum(d[f]) || d[f] < 0) e.push(f);
  return e;
}
function validateMacroRingNutrition(d) {
  const e = [];
  if (!isNum(d.kcal_total) || d.kcal_total < 0) e.push("kcal_total");
  for (const leg of ["protein", "carbs", "fat"]) {
    const v = d[leg];
    if (!v || typeof v !== "object") { e.push(leg); continue; }
    for (const f of ["grams", "kcal"]) if (!isNum(v[f]) || v[f] < 0) e.push(`${leg}.${f}`);
  }
  return e;
}

export function validateNutritionWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!NUTRITION_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown nutrition type: ${payload.type}`] };
  }
  const map = {
    protein_distribution_bar: validateProteinDist,
    meal_macro_stack: validateMealStack,
    food_nutrient_scatter: validateScatter,
    hydration_timeline: validateHydration,
    micronutrient_radar: validateRadar,
    calorie_balance_ledger: validateCalorieLedger,
    meal_timing_strip: validateMealTiming,
    tdee_waterfall: validateTdeeWaterfall,
    macro_ring_nutrition: validateMacroRingNutrition,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
