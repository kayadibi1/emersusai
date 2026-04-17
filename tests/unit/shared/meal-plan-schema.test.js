import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateMealPlan } from "../../../shared/meal-plan-schema.js";

function minimalValidPlan(targetOverrides = {}) {
  return {
    targets: {
      rest_day: { kcal: 2000, protein_g: 130, carbs_g: 220, fat_g: 70, fiber_g: 25, ...targetOverrides },
    },
    day_types: [{
      slug: "rest_day",
      name: "Rest Day",
      meals: [{
        slot: "breakfast",
        name: "Breakfast",
        foods: [{ description: "Oats", grams: 80 }],
      }],
    }],
    assignments: { mode: "manual", default_day_type: "rest_day" },
  };
}

describe("meal-plan-schema — macro floors", () => {
  test("valid plan passes", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan());
    assert.equal(valid, true, `Unexpected errors: ${errors.join(", ")}`);
  });

  test("rejects kcal below 800", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ kcal: 500 }));
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes("kcal") && e.includes("800")));
  });

  test("rejects kcal of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ kcal: 0 }));
    assert.equal(valid, false);
  });

  test("rejects protein_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ protein_g: 0 }));
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes("protein_g") && e.includes("greater than 0")));
  });

  test("rejects carbs_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ carbs_g: 0 }));
    assert.equal(valid, false);
  });

  test("rejects fat_g of 0", () => {
    const { valid, errors } = validateMealPlan(minimalValidPlan({ fat_g: 0 }));
    assert.equal(valid, false);
  });

  test("allows fiber_g of 0", () => {
    const { valid } = validateMealPlan(minimalValidPlan({ fiber_g: 0 }));
    assert.equal(valid, true);
  });

  test("allows kcal exactly 800", () => {
    const { valid } = validateMealPlan(minimalValidPlan({ kcal: 800 }));
    assert.equal(valid, true);
  });
});
