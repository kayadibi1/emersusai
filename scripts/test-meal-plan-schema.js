// scripts/test-meal-plan-schema.js
//
// Unit test for shared/meal-plan-schema.js.
// Usage: node scripts/test-meal-plan-schema.js

import assert from "node:assert/strict";
import { validateMealPlan } from "../shared/meal-plan-schema.js";

function expectValid(plan, label) {
  const { valid, errors } = validateMealPlan(plan);
  assert.ok(valid, `${label}: expected valid, got errors: ${errors.join("; ")}`);
  console.log(`  ✓ ${label}`);
}

function expectInvalid(plan, label, matcher) {
  const { valid, errors } = validateMealPlan(plan);
  assert.ok(!valid, `${label}: expected invalid, but passed`);
  if (matcher) {
    assert.ok(
      errors.some(e => matcher.test(e)),
      `${label}: expected an error matching ${matcher}, got: ${errors.join("; ")}`
    );
  }
  console.log(`  ✓ ${label}`);
}

// Minimal valid plan
const validPlan = {
  targets: {
    training_day: { kcal: 2800, protein_g: 190, carbs_g: 340, fat_g: 80, fiber_g: 40 },
    rest_day:     { kcal: 2400, protein_g: 190, carbs_g: 240, fat_g: 80, fiber_g: 40 },
  },
  day_types: [
    {
      slug: "training_day",
      name: "Training day",
      meals: [
        { slot: "breakfast", name: "Oats + whey",
          foods: [{ description: "Oats, raw", grams: 80 }] },
      ],
      supplements: [
        { description: "Creatine monohydrate", amount: 5, unit: "g", timing: "any" },
      ],
    },
    {
      slug: "rest_day",
      name: "Rest day",
      meals: [],
    },
  ],
  assignments: {
    mode: "auto_from_workout",
    default_day_type: "rest_day",
    overrides: { "2026-04-15": "training_day" },
  },
};

console.log("[test-meal-plan-schema] running...");

expectValid(validPlan, "minimal valid plan");

// Missing targets
{
  const bad = structuredClone(validPlan);
  delete bad.targets.training_day;
  expectInvalid(bad, "missing day_type target", /training_day.*missing/i);
}

// Negative grams
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].meals[0].foods[0].grams = -50;
  expectInvalid(bad, "negative grams", /grams.*non-negative/);
}

// Invalid meal slot
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].meals[0].slot = "elevensies";
  expectInvalid(bad, "invalid meal slot", /slot.*must be one of/);
}

// Invalid assignments mode
{
  const bad = structuredClone(validPlan);
  bad.assignments.mode = "vibes";
  expectInvalid(bad, "invalid assignments mode", /assignments\.mode/);
}

// Malformed override date
{
  const bad = structuredClone(validPlan);
  bad.assignments.overrides = { "not-a-date": "training_day" };
  expectInvalid(bad, "malformed override date", /YYYY-MM-DD/);
}

// Day-type slug with uppercase
{
  const bad = structuredClone(validPlan);
  bad.day_types[0].slug = "Training_Day";
  expectInvalid(bad, "day-type slug with uppercase", /slug.*must match/);
}

// Plan missing assignments entirely
{
  const bad = structuredClone(validPlan);
  delete bad.assignments;
  expectInvalid(bad, "missing assignments", /assignments.*expected object/);
}

console.log("[test-meal-plan-schema] all assertions passed.");
