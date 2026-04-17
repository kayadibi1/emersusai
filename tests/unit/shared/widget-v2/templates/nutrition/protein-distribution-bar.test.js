import assert from "node:assert/strict";
import { test } from "node:test";
import { ProteinDistributionBar } from "../../../../../../shared/widget-v2/templates/nutrition/protein-distribution-bar.js";
import { validateNutritionWidget } from "../../../../../../shared/widget-v2/validators/nutrition.js";

const VALID = {
  title: "Protein across the day",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "protein_distribution_bar",
  data: {
    daily_target_g: 180,
    protein_meals: [
      { slot: "breakfast", grams: 40, hour: 8 },
      { slot: "lunch", grams: 50, hour: 13 },
      { slot: "post-workout", grams: 40, hour: 18 },
      { slot: "dinner", grams: 50, hour: 20 },
    ],
  },
};

test("validator accepts full payload", () => {
  const r = validateNutritionWidget(VALID);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects bad hour", () => {
  const bad = { ...VALID, data: { ...VALID.data, protein_meals: [{ slot: "x", grams: 10, hour: 25 }] } };
  const r = validateNutritionWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects negative grams", () => {
  const bad = { ...VALID, data: { ...VALID.data, protein_meals: [{ slot: "x", grams: -1, hour: 8 }] } };
  const r = validateNutritionWidget(bad);
  assert.equal(r.valid, false);
});

test("component renders meal slots + grams + target", () => {
  const el = ProteinDistributionBar(VALID);
  const s = JSON.stringify(el);
  assert.match(s, /breakfast/);
  assert.match(s, /lunch/);
  assert.match(s, /180/);
  assert.match(s, /40g/);
});

test("component sorts meals by hour", () => {
  const unsorted = {
    ...VALID,
    data: {
      daily_target_g: 120,
      protein_meals: [
        { slot: "lunch", grams: 40, hour: 13 },
        { slot: "breakfast", grams: 30, hour: 7 },
        { slot: "dinner", grams: 50, hour: 20 },
      ],
    },
  };
  const el = ProteinDistributionBar(unsorted);
  const s = JSON.stringify(el);
  // Find positions of each slot name - breakfast should appear before lunch.
  const iBreakfast = s.indexOf("breakfast");
  const iLunch = s.indexOf("lunch");
  const iDinner = s.indexOf("dinner");
  assert.ok(iBreakfast < iLunch && iLunch < iDinner, "meals should be rendered in hour order");
});
