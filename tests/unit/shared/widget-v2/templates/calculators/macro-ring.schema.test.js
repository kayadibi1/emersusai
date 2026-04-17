import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCalculatorWidget } from "../../../../../../shared/widget-v2/validators/calculator.js";

const VALID = {
  title: "Daily macros",
  display_width: "narrow",
  summary: null,
  follow_up_chips: ["Apply"],
  type: "macro_ring",
  data: {
    kcal_total: 2500,
    phase: "cut",
    protein: { grams: 180, target_grams: 180, kcal: 720 },
    carbs:   { grams: 275, target_grams: 275, kcal: 1100 },
    fat:     { grams: 76,  target_grams: 76,  kcal: 680 },
    tdee_reference: { tdee: 2900, delta_kcal: -400 },
  },
};

test("accepts valid macro_ring payload", () => {
  const r = validateCalculatorWidget(VALID);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("rejects unknown type", () => {
  const bad = { ...VALID, type: "unknown_thing" };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /unknown_thing|type/);
});

test("rejects macro_ring with missing protein field", () => {
  const bad = { ...VALID, data: { ...VALID.data, protein: undefined } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});

test("rejects macro_ring with negative kcal", () => {
  const bad = { ...VALID, data: { ...VALID.data, kcal_total: -100 } };
  const r = validateCalculatorWidget(bad);
  assert.equal(r.valid, false);
});
