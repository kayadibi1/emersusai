import assert from "node:assert/strict";
import { test } from "node:test";
import { TDEECalculator } from "../../../../../../shared/widget-v2/templates/calculators/tdee-calculator.js";
import { OneRMEstimator } from "../../../../../../shared/widget-v2/templates/calculators/one-rm-estimator.js";
import { validateCalculatorWidget } from "../../../../../../shared/widget-v2/validators/calculator.js";

const TDEE_PAYLOAD = {
  title: "Your TDEE",
  display_width: "medium",
  summary: null,
  follow_up_chips: [],
  type: "tdee_calculator",
  data: {
    weight_kg: 80, height_cm: 180, age: 32, sex: "male",
    activity_level: "moderate",
    bmr: 1810, tdee: 2805,
  },
};

test("validator accepts tdee_calculator", () => {
  const r = validateCalculatorWidget(TDEE_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects bad sex", () => {
  const bad = { ...TDEE_PAYLOAD, data: { ...TDEE_PAYLOAD.data, sex: "other" } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects unknown activity_level", () => {
  const bad = { ...TDEE_PAYLOAD, data: { ...TDEE_PAYLOAD.data, activity_level: "extreme" } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("tdee component renders bmr + tdee", () => {
  const el = TDEECalculator(TDEE_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /1810/);
  assert.match(s, /2805/);
  assert.match(s, /BMR/);
  assert.match(s, /TDEE/);
});

const ORM_PAYLOAD = {
  title: "Estimated 1RM",
  display_width: "medium",
  summary: null,
  follow_up_chips: [],
  type: "one_rm_estimator",
  data: {
    lift: "Back Squat",
    unit: "kg",
    load: 100, reps: 5,
    epley_1rm: 116.7,
    brzycki_1rm: 112.5,
  },
};

test("validator accepts one_rm_estimator", () => {
  const r = validateCalculatorWidget(ORM_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects reps outside 1-20", () => {
  const bad = { ...ORM_PAYLOAD, data: { ...ORM_PAYLOAD.data, reps: 25 } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects 1rm estimate below working load", () => {
  const bad = { ...ORM_PAYLOAD, data: { ...ORM_PAYLOAD.data, epley_1rm: 50 } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("1rm component renders lift + both estimates", () => {
  const el = OneRMEstimator(ORM_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Back Squat/);
  assert.match(s, /100/);
  assert.match(s, /117/);       // Epley rounded
  assert.match(s, /113/);       // Brzycki rounded (~112.5 → 113)
});
