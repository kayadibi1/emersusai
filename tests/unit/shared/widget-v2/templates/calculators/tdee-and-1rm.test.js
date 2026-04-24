import assert from "node:assert/strict";
import { test } from "node:test";
import { TDEECalculator } from "../../../../../../shared/widget-v2/templates/calculators/tdee-calculator.js";
import { OneRMEstimator } from "../../../../../../shared/widget-v2/templates/calculators/one-rm-estimator.js";
import { validateCalculatorWidget } from "../../../../../../shared/widget-v2/validators/calculator.js";

// Post 2026-04-23 diagnostic: BMR/TDEE/Epley/Brzycki are now renderer-
// computed from atomic inputs. The model may pass these as null or supply
// a hint value; the component ignores the hint and recomputes.
const TDEE_PAYLOAD = {
  title: "Your TDEE",
  display_width: "medium",
  summary: null,
  follow_up_chips: [],
  type: "tdee_calculator",
  data: {
    weight_kg: 80, height_cm: 180, age: 32, sex: "male",
    activity_level: "moderate",
    bmr: null, tdee: null,
  },
};

test("validator accepts tdee_calculator with null bmr/tdee (renderer-computed)", () => {
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

test("tdee component renders renderer-computed Mifflin-St Jeor BMR + TDEE", () => {
  const el = TDEECalculator(TDEE_PAYLOAD);
  const s = JSON.stringify(el);
  // Mifflin-St Jeor male 80kg 180cm 32y = 1770; TDEE @1.55 = 2744
  assert.match(s, /1770/);
  assert.match(s, /2744/);
  assert.match(s, /BMR/);
  assert.match(s, /TDEE/);
});

test("tdee component female formula", () => {
  const el = TDEECalculator({
    ...TDEE_PAYLOAD,
    data: { ...TDEE_PAYLOAD.data, weight_kg: 65, height_cm: 168, age: 28, sex: "female", activity_level: "light" },
  });
  const s = JSON.stringify(el);
  // Mifflin female: 10×65 + 6.25×168 − 5×28 − 161 = 650 + 1050 − 140 − 161 = 1399
  // TDEE @1.375 = 1924
  assert.match(s, /1399/);
  assert.match(s, /1924/);
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
    epley_1rm: null, brzycki_1rm: null,
  },
};

test("validator accepts one_rm_estimator with null epley/brzycki", () => {
  const r = validateCalculatorWidget(ORM_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects reps outside 1-20", () => {
  const bad = { ...ORM_PAYLOAD, data: { ...ORM_PAYLOAD.data, reps: 25 } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("1rm component renders renderer-computed Epley + Brzycki", () => {
  const el = OneRMEstimator(ORM_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Back Squat/);
  assert.match(s, /100/);
  // Epley 100×(1+5/30) = 116.67 → 117; Brzycki 100×36/(37-5) = 112.5 → 113
  assert.match(s, /117/);
  assert.match(s, /113/);
});
