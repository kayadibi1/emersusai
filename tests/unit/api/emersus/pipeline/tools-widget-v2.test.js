import assert from "node:assert/strict";
import { test } from "node:test";
import { buildToolDefinitions, validateToolCall } from "../../../../../api/emersus/pipeline/tools.js";

test("emit_calculator_widget is in tool definitions", () => {
  const tools = buildToolDefinitions();
  const t = tools.find((x) => x.name === "emit_calculator_widget");
  assert.ok(t, "emit_calculator_widget missing from buildToolDefinitions()");
  assert.equal(t.strict, true);
});

test("emit_calculator_widget schema includes macro_ring type", () => {
  const tools = buildToolDefinitions();
  const t = tools.find((x) => x.name === "emit_calculator_widget");
  const typeEnum = t.parameters.properties.type.enum;
  assert.ok(Array.isArray(typeEnum));
  assert.ok(typeEnum.includes("macro_ring"));
});

test("validateToolCall('emit_calculator_widget') rejects bad payload", () => {
  const r = validateToolCall("emit_calculator_widget", { title: "T" });
  assert.equal(r.valid, false);
});

test("validateToolCall('emit_calculator_widget') accepts valid macro_ring", () => {
  const r = validateToolCall("emit_calculator_widget", {
    title: "Macros", display_width: "narrow", summary: null, follow_up_chips: [],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  });
  assert.equal(r.valid, true, r.errors?.join("; "));
});
