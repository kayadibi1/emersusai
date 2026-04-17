import assert from "node:assert/strict";
import { test } from "node:test";
import { MealMacroStack } from "../../../../../../shared/widget-v2/templates/nutrition/meal-macro-stack.js";
import { validateNutritionWidget } from "../../../../../../shared/widget-v2/validators/nutrition.js";

const VALID = {
  title: "Meals for a 2400 kcal cut",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "meal_macro_stack",
  data: {
    daily_total_kcal: 2400,
    macro_meals: [
      { name: "Breakfast", protein_kcal: 180, carbs_kcal: 240, fat_kcal: 160 },
      { name: "Lunch", protein_kcal: 240, carbs_kcal: 320, fat_kcal: 180 },
      { name: "Snack", protein_kcal: 120, carbs_kcal: 160, fat_kcal: 60 },
      { name: "Dinner", protein_kcal: 240, carbs_kcal: 360, fat_kcal: 140 },
    ],
  },
};

test("validator accepts full payload", () => {
  const r = validateNutritionWidget(VALID);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects missing protein_kcal", () => {
  const bad = {
    ...VALID,
    data: { ...VALID.data, macro_meals: [{ name: "X", carbs_kcal: 100, fat_kcal: 50 }] },
  };
  const r = validateNutritionWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects zero total kcal", () => {
  const bad = { ...VALID, data: { ...VALID.data, daily_total_kcal: 0 } };
  const r = validateNutritionWidget(bad);
  assert.equal(r.valid, false);
});

test("component renders every meal name + total kcal", () => {
  const el = MealMacroStack(VALID);
  const s = JSON.stringify(el);
  assert.match(s, /Breakfast/);
  assert.match(s, /Lunch/);
  assert.match(s, /Dinner/);
  assert.match(s, /2400/);
});
