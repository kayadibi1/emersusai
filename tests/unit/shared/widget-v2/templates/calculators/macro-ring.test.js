import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { MacroRing } from "../../../../../../shared/widget-v2/templates/calculators/macro-ring.js";

const VALID_DATA = {
  kcal_total: 2500, phase: "cut",
  protein: { grams: 180, target_grams: 180, kcal: 720 },
  carbs: { grams: 275, target_grams: 275, kcal: 1100 },
  fat: { grams: 76, target_grams: 76, kcal: 680 },
  tdee_reference: { tdee: 2900, delta_kcal: -400 },
};

function stringify(el) { return JSON.stringify(el); }

test("renders title, calories, macro values", () => {
  const el = MacroRing({
    title: "Daily macros", display_width: "narrow", summary: null,
    follow_up_chips: [], data: VALID_DATA,
  });
  const s = stringify(el);
  assert.match(s, /Daily macros/);
  assert.match(s, /2500/);
  assert.match(s, /180/);       // protein grams
  assert.match(s, /275/);       // carbs
  assert.match(s, /76/);        // fat
});

test("renders follow-up chips when provided", () => {
  const el = MacroRing({
    title: "T", display_width: "narrow", summary: null,
    follow_up_chips: ["Apply"], data: VALID_DATA,
  });
  assert.match(stringify(el), /Apply/);
});

test("renders summary when provided", () => {
  const el = MacroRing({
    title: "T", display_width: "narrow", summary: "400 kcal deficit",
    follow_up_chips: [], data: VALID_DATA,
  });
  assert.match(stringify(el), /400 kcal deficit/);
});
