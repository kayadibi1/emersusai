import assert from "node:assert/strict";
import { test } from "node:test";
import { FoodNutrientScatter } from "../../../../../../shared/widget-v2/templates/nutrition/food-nutrient-scatter.js";
import { HydrationTimeline } from "../../../../../../shared/widget-v2/templates/nutrition/hydration-timeline.js";
import { MicronutrientRadar } from "../../../../../../shared/widget-v2/templates/nutrition/micronutrient-radar.js";
import { CalorieBalanceLedger } from "../../../../../../shared/widget-v2/templates/nutrition/calorie-balance-ledger.js";
import { MealTimingStrip } from "../../../../../../shared/widget-v2/templates/nutrition/meal-timing-strip.js";
import { TdeeWaterfall } from "../../../../../../shared/widget-v2/templates/nutrition/tdee-waterfall.js";
import { MacroRingNutrition } from "../../../../../../shared/widget-v2/templates/nutrition/macro-ring-nutrition.js";
import { validateNutritionWidget } from "../../../../../../shared/widget-v2/validators/nutrition.js";

const b = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("food_nutrient_scatter", () => {
  const p = { ...b, type: "food_nutrient_scatter", data: { x_label: "protein g/100kcal", y_label: "fiber g/100kcal", foods: [{ name: "Broccoli", x: 4, y: 6 }, { name: "Chicken breast", x: 22, y: 0 }] } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(FoodNutrientScatter(p)), /Broccoli/);
});
test("hydration_timeline", () => {
  const p = { ...b, type: "hydration_timeline", data: { target_ml: 3000, events: [{ hour: 8, volume_ml: 500, kind: "fluid" }, { hour: 13, volume_ml: 0, kind: "meal" }, { hour: 18, volume_ml: 0, kind: "workout" }] } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(HydrationTimeline(p)), /3000/);
});
test("micronutrient_radar", () => {
  const p = { ...b, type: "micronutrient_radar", data: { axes: [{ name: "B12", pct: 120 }, { name: "Vit D", pct: 40 }, { name: "Iron", pct: 85 }, { name: "Zinc", pct: 70 }] } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(MicronutrientRadar(p)), /Vit D/);
});
test("micronutrient_radar rejects 2-axis", () => {
  const p = { ...b, type: "micronutrient_radar", data: { axes: [{ name: "X", pct: 50 }, { name: "Y", pct: 50 }] } };
  assert.equal(validateNutritionWidget(p).valid, false);
});
test("calorie_balance_ledger", () => {
  const p = { ...b, type: "calorie_balance_ledger", data: { days: [
    { date: "2026-04-13", intake: 2400, expenditure: 2800 },
    { date: "2026-04-14", intake: 2500, expenditure: 2700 },
    { date: "2026-04-15", intake: 2350, expenditure: 2750 },
  ] } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(CalorieBalanceLedger(p)), /2026-04-14/);
});
test("meal_timing_strip", () => {
  const p = { ...b, type: "meal_timing_strip", data: { workout_hour: 18, logged: [{ hour: 16, label: "Pre" }, { hour: 19.5, label: "Post" }], recommended_window: { start: 19, end: 21 } } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(MealTimingStrip(p)), /Post/);
});
test("tdee_waterfall", () => {
  const p = { ...b, type: "tdee_waterfall", data: { bmr: 1700, tea: 400, neat: 350, tef: 200, tdee: 2650 } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(TdeeWaterfall(p)), /2650/);
});
test("macro_ring_nutrition", () => {
  const p = { ...b, type: "macro_ring_nutrition", data: { kcal_total: 2400, protein: { grams: 180, target_grams: 180, kcal: 720 }, carbs: { grams: 240, target_grams: 260, kcal: 960 }, fat: { grams: 80, target_grams: 80, kcal: 720 } } };
  assert.equal(validateNutritionWidget(p).valid, true);
  assert.match(JSON.stringify(MacroRingNutrition(p)), /2400/);
});
