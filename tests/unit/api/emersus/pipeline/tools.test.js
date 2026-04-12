import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS, validateToolCall } from "../../../../../api/emersus/pipeline/tools.js";

describe("TOOL_DEFINITIONS", () => {
  it("exports exactly 4 tool definitions", () => {
    assert.equal(TOOL_DEFINITIONS.length, 4);
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    assert.deepStrictEqual(names, ["emit_meal_plan", "emit_widget", "emit_workout_plan", "log_food"]);
  });

  it("all tools have type function and strict true", () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(tool.type, "function");
      assert.equal(tool.strict, true);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.parameters, `${tool.name} missing parameters`);
    }
  });

  it("all tool parameter schemas have additionalProperties false", () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(tool.parameters.additionalProperties, false,
        `${tool.name} top-level missing additionalProperties:false`);
    }
  });
});

describe("validateToolCall", () => {
  it("validates a correct log_food call", () => {
    const args = {
      meal_slot: "lunch",
      foods: [{ description: "chicken breast", grams: 200, kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7.2 }],
    };
    const result = validateToolCall("log_food", args);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.data, args);
  });

  it("rejects log_food with missing required field", () => {
    const result = validateToolCall("log_food", { meal_slot: "lunch" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects log_food with invalid meal_slot enum", () => {
    const result = validateToolCall("log_food", {
      meal_slot: "midnight_snack",
      foods: [{ description: "x", grams: 1, kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    assert.equal(result.valid, false);
  });

  it("validates a correct emit_widget call", () => {
    const result = validateToolCall("emit_widget", {
      title: "Test",
      html: "<div>hello</div>",
    });
    assert.equal(result.valid, true);
  });

  it("rejects emit_widget with external script", () => {
    const result = validateToolCall("emit_widget", {
      title: "Test",
      html: '<div><script src="https://evil.com/x.js"></script></div>',
    });
    assert.equal(result.valid, false);
  });

  it("returns invalid for unknown tool name", () => {
    const result = validateToolCall("unknown_tool", {});
    assert.equal(result.valid, false);
  });

  it("validates a minimal emit_meal_plan call", () => {
    const result = validateToolCall("emit_meal_plan", {
      targets: {
        training_day: { kcal: 2400, protein_g: 180, carbs_g: 260, fat_g: 70, fiber_g: 34 },
        rest_day: { kcal: 2000, protein_g: 180, carbs_g: 200, fat_g: 85, fiber_g: 34 },
        refeed_day: { kcal: 2200, protein_g: 180, carbs_g: 240, fat_g: 75, fiber_g: 34 },
      },
      day_types: [{
        slug: "training_day", name: "Training Day",
        meals: [{ slot: "breakfast", name: "Breakfast", foods: [{ description: "eggs", grams: 200 }] }],
        supplements: [],
      }],
      assignments: { mode: "auto_from_workout", default_day_type: "training_day" },
    });
    assert.equal(result.valid, true);
  });

  it("validates a minimal emit_workout_plan call", () => {
    const result = validateToolCall("emit_workout_plan", {
      schema_version: 1,
      title: "PPL",
      goal: "hypertrophy",
      experience_level: "intermediate",
      start_date: "2026-04-14",
      weeks: 4,
      days_per_week: 3,
      sessions: [{
        id: "s_w1d1", week: 1, day_of_week: 1, date: "2026-04-14",
        title: "Push A",
        blocks: [{ name: "Bench Press", sets: 4, reps: "8-10", load: "75kg", rpe: 8, rest_seconds: 120, category: "resistance", notes: null }],
      }],
    });
    assert.equal(result.valid, true);
  });
});
