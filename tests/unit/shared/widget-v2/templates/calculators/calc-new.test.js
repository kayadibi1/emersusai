import assert from "node:assert/strict";
import { test } from "node:test";
import { MacroCalculator } from "../../../../../../shared/widget-v2/templates/calculators/macro-calculator.js";
import { PlateLoaderVisual } from "../../../../../../shared/widget-v2/templates/calculators/plate-loader-visual.js";
import { RpeToPercentRM } from "../../../../../../shared/widget-v2/templates/calculators/rpe-to-percent-rm.js";
import { BodyFatEstimator } from "../../../../../../shared/widget-v2/templates/calculators/body-fat-estimator.js";
import { CarbCyclingCalculator } from "../../../../../../shared/widget-v2/templates/calculators/carb-cycling-calculator.js";
import { ProteinTargetCalculator } from "../../../../../../shared/widget-v2/templates/calculators/protein-target-calculator.js";
import { PaceCalculator } from "../../../../../../shared/widget-v2/templates/calculators/pace-calculator.js";
import { validateCalculatorWidget } from "../../../../../../shared/widget-v2/validators/calculator.js";

const b = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("macro_calculator", () => {
  const p = { ...b, type: "macro_calculator", data: { kcal_total: 2400, protein_g_per_kg: 2.2, fat_pct: 0.3, body_weight_kg: 80, protein_g: 176, fat_g: 80, carbs_g: 264 } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(MacroCalculator(p)), /176/);
});
test("plate_loader_visual", () => {
  const p = { ...b, type: "plate_loader_visual", data: { target_kg: 140, bar_kg: 20, plates_per_side: [{ kg: 25, count: 2 }, { kg: 5, count: 1 }, { kg: 2.5, count: 1 }, { kg: 1.25, count: 2 }] } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(PlateLoaderVisual(p)), /140/);
});
test("rpe_to_percent_rm", () => {
  const p = { ...b, type: "rpe_to_percent_rm", data: { rows: [
    { reps: 1, pcts_by_rpe: [84, 87, 91, 95, 100] },
    { reps: 3, pcts_by_rpe: [79, 82, 86, 90, 94] },
    { reps: 5, pcts_by_rpe: [73, 77, 81, 85, 89] },
  ] } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(RpeToPercentRM(p)), /RPE 10/);
});
test("body_fat_estimator", () => {
  const p = { ...b, type: "body_fat_estimator", data: { sex: "male", neck_cm: 38, waist_cm: 88, height_cm: 180, hip_cm: 0, body_fat_pct: 16.4 } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(BodyFatEstimator(p)), /Fit/);
});
test("body_fat_estimator requires hip_cm for female", () => {
  const p = { ...b, type: "body_fat_estimator", data: { sex: "female", neck_cm: 32, waist_cm: 74, height_cm: 170, body_fat_pct: 24, hip_cm: 0 } };
  assert.equal(validateCalculatorWidget(p).valid, false);
});
test("carb_cycling_calculator", () => {
  const p = { ...b, type: "carb_cycling_calculator", data: { weekly_avg_g: 260, plan: [
    { day: "Mon", tier: "high", carbs_g: 350 },
    { day: "Tue", tier: "med", carbs_g: 260 },
    { day: "Wed", tier: "low", carbs_g: 170 },
    { day: "Thu", tier: "high", carbs_g: 350 },
    { day: "Fri", tier: "med", carbs_g: 260 },
    { day: "Sat", tier: "low", carbs_g: 170 },
    { day: "Sun", tier: "low", carbs_g: 170 },
  ] } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(CarbCyclingCalculator(p)), /Mon/);
});
test("protein_target_calculator", () => {
  const p = { ...b, type: "protein_target_calculator", data: { body_weight_kg: 80, meal_count: 4, total_g: 176, per_meal_g: 44, leucine_threshold_g: 30 } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(ProteinTargetCalculator(p)), /176/);
});
test("pace_calculator", () => {
  const p = { ...b, type: "pace_calculator", data: { distance_km: 10, time_sec: 2700, pace_sec_per_km: 270, speed_kmh: 13.33, zone: "Z3" } };
  assert.equal(validateCalculatorWidget(p).valid, true);
  assert.match(JSON.stringify(PaceCalculator(p)), /4:30/);
});
