import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { WidgetV2 } from "../../../../shared/widget-v2/dispatcher.js";

const VALID_CALC = {
  family: "calculator",
  payload: {
    title: "Macros", display_width: "narrow", summary: null, follow_up_chips: [],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  },
};

test("routes calculator.macro_ring to MacroRing component", () => {
  const el = WidgetV2(VALID_CALC);
  assert.ok(el);
  assert.match(JSON.stringify(el), /Macros/);
  assert.match(JSON.stringify(el), /2500/);
});

test("returns diagnostic component for unknown family", () => {
  const el = WidgetV2({ family: "unknown", payload: { title: "T" } });
  assert.match(JSON.stringify(el), /unsupported family/i);
});

test("returns diagnostic component for unknown type", () => {
  const el = WidgetV2({
    family: "calculator",
    payload: { ...VALID_CALC.payload, type: "not_a_type" },
  });
  assert.match(JSON.stringify(el), /unknown type/i);
});
