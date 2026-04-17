import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS, validateToolCall, REMEMBER_FACT, RECALL_MEMORY, buildToolDefinitions, SERVER_SIDE_TOOLS, MEMORY_CATEGORY_ENUM } from "../../../../../api/emersus/pipeline/tools.js";

// widget-v2 multi-type tools (emit_<family>_widget with >1 `type` enum value)
// use strict:false because OpenAI strict mode can't represent a
// type-dependent data shape. Server-side validators cover correctness.
const MULTI_TYPE_WIDGET_V2 = new Set([
  // Under Plan 9.5 families are migrating to strict:true via superset-data.
  // Pharma + Progress + Evidence have landed; Nutrition + Training remain.
  "emit_nutrition_widget", "emit_training_widget",
]);

describe("TOOL_DEFINITIONS", () => {
  it("exports exactly 11 tool definitions", () => {
    assert.equal(TOOL_DEFINITIONS.length, 11);
    const names = TOOL_DEFINITIONS.map(t => t.name).sort();
    assert.deepStrictEqual(names, ["emit_calculator_widget", "emit_evidence_widget", "emit_meal_plan", "emit_nutrition_widget", "emit_pharma_widget", "emit_progress_widget", "emit_training_widget", "emit_widget", "emit_workout_plan", "get_user_profile", "log_food"]);
  });

  it("all tools have type function and strict true (except multi-type widget-v2)", () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(tool.type, "function");
      if (MULTI_TYPE_WIDGET_V2.has(tool.name)) {
        assert.equal(tool.strict, false, `${tool.name} expected strict:false`);
      } else {
        assert.equal(tool.strict, true, `${tool.name} expected strict:true`);
      }
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
  function makeValidWorkoutPlan(overrides = {}) {
    return {
      schema_version: 1,
      title: "PPL",
      goal: "hypertrophy",
      experience_level: "intermediate",
      start_date: "2026-04-14",
      weeks: 4,
      days_per_week: 3,
      sessions: [{
        id: "s_w1d1",
        week: 1,
        day_of_week: 1,
        date: "2026-04-14",
        title: "Push A",
        warmup_blocks: null,
        blocks: [{
          name: "Bench Press",
          sets: 4,
          reps: "8-10",
          load: "75kg",
          rpe: 8,
          rest_seconds: 120,
          category: "resistance",
          notes: null,
        }],
      }],
      updates_plan_id: null,
      ...overrides,
    };
  }

  it("validates a correct log_food call", () => {
    const args = {
      meal_slot: "lunch",
      foods: [{ description: "chicken breast", amount: 200, amount_unit: "g", kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7.2 }],
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
      foods: [{ description: "x", amount: 1, amount_unit: "g", kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    assert.equal(result.valid, false);
  });

  it("rejects log_food that uses the legacy grams field instead of amount + amount_unit", () => {
    const result = validateToolCall("log_food", {
      meal_slot: "lunch",
      foods: [{ description: "x", grams: 1, kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("amount")));
  });

  it("rejects log_food with invalid amount_unit", () => {
    const result = validateToolCall("log_food", {
      meal_slot: "lunch",
      foods: [{ description: "x", amount: 1, amount_unit: "oz", kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("amount_unit")));
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

  it("rejects emit_widget with viewport-height shell", () => {
    const result = validateToolCall("emit_widget", {
      title: "Test",
      html: '<style>body{min-height:100vh}.app{padding:24px}</style><div class="app">hello</div>',
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
    const args = makeValidWorkoutPlan();
    const result = validateToolCall("emit_workout_plan", args);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.data, args);
  });

  it("backfills workout-plan defaults for warmup_blocks and updates_plan_id", () => {
    const result = validateToolCall("emit_workout_plan", {
      schema_version: 1,
      title: "PPL",
      goal: "hypertrophy",
      experience_level: "intermediate",
      start_date: "2026-04-14",
      weeks: 4,
      days_per_week: 3,
      sessions: [{
        id: "s_w1d1",
        week: 1,
        day_of_week: 1,
        date: "2026-04-14",
        title: "Push A",
        blocks: [{
          name: "Bench Press",
          sets: 4,
          reps: "8-10",
          load: "75kg",
          rpe: 8,
          rest_seconds: 120,
          category: "resistance",
          notes: null,
        }],
      }],
    });

    assert.equal(result.valid, true);
    assert.equal(result.data.updates_plan_id, null);
    assert.equal(result.data.sessions[0].warmup_blocks, null);
  });

  it("rejects emit_workout_plan with invalid experience_level", () => {
    const result = validateToolCall("emit_workout_plan", makeValidWorkoutPlan({
      experience_level: "expert",
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("experience_level")));
  });

  it("rejects emit_workout_plan with invalid start_date", () => {
    const result = validateToolCall("emit_workout_plan", makeValidWorkoutPlan({
      start_date: "04/14/2026",
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("start_date")));
  });

  it("rejects emit_workout_plan when a session exceeds the plan week count", () => {
    const result = validateToolCall("emit_workout_plan", makeValidWorkoutPlan({
      weeks: 1,
      sessions: [{
        id: "s_w2d1",
        week: 2,
        day_of_week: 1,
        date: "2026-04-21",
        title: "Push B",
        warmup_blocks: null,
        blocks: [{
          name: "Bench Press",
          sets: 4,
          reps: "8-10",
          load: "75kg",
          rpe: 8,
          rest_seconds: 120,
          category: "resistance",
          notes: null,
        }],
      }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("exceeds weeks")));
  });

  it("rejects emit_workout_plan with duplicate week/day slots", () => {
    const duplicateSession = {
      id: "s_w1d2",
      week: 1,
      day_of_week: 2,
      date: "2026-04-15",
      title: "Pull A",
      warmup_blocks: null,
      blocks: [{
        name: "Row",
        sets: 4,
        reps: "8-10",
        load: "70kg",
        rpe: 8,
        rest_seconds: 120,
        category: "resistance",
        notes: null,
      }],
    };
    const result = validateToolCall("emit_workout_plan", makeValidWorkoutPlan({
      days_per_week: 3,
      sessions: [
        { ...duplicateSession },
        { ...duplicateSession, id: "s_w1d3", title: "Pull B" },
      ],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("duplicates week/day slot")));
  });

  it("rejects emit_workout_plan with invalid block fields", () => {
    const result = validateToolCall("emit_workout_plan", makeValidWorkoutPlan({
      sessions: [{
        id: "s_w1d1",
        week: 1,
        day_of_week: 1,
        date: "2026-04-14",
        title: "Push A",
        warmup_blocks: null,
        blocks: [{
          name: "",
          sets: 0,
          reps: "",
          load: "",
          rpe: 11,
          rest_seconds: -30,
          category: "plyometric",
          notes: 42,
        }],
      }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes(".name")));
    assert.ok(result.errors.some((error) => error.includes(".sets")));
    assert.ok(result.errors.some((error) => error.includes(".rpe")));
    assert.ok(result.errors.some((error) => error.includes(".category")));
  });
});

describe("REMEMBER_FACT tool definition", () => {
  it("has type=function, strict=true, 21-category enum", () => {
    assert.equal(REMEMBER_FACT.type, "function");
    assert.equal(REMEMBER_FACT.name, "remember_fact");
    assert.equal(REMEMBER_FACT.strict, true);
    const p = REMEMBER_FACT.parameters;
    assert.equal(p.additionalProperties, false);
    assert.deepEqual(p.required.slice().sort(), ["category", "fact", "note"].sort());
    assert.deepEqual(p.properties.note.type, ["string", "null"]);
    assert.ok(Array.isArray(p.properties.category.enum));
    assert.equal(p.properties.category.enum.length, 21);
    assert.ok(p.properties.category.enum.includes("injury"));
    assert.ok(p.properties.category.enum.includes("custom"));
  });

  it("every whitelist category appears exactly once", () => {
    const set = new Set(REMEMBER_FACT.parameters.properties.category.enum);
    assert.equal(set.size, 21);
    assert.equal(MEMORY_CATEGORY_ENUM.length, 21);
  });
});

describe("buildToolDefinitions — flag-gated remember_fact", () => {
  it("excludes remember_fact when MEMORY_REMEMBER_FACT_ENABLED unset", () => {
    const saved = process.env.MEMORY_REMEMBER_FACT_ENABLED;
    delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
    try {
      const defs = buildToolDefinitions();
      assert.ok(!defs.some((d) => d.name === "remember_fact"));
      assert.equal(defs.length, 11);
    } finally {
      if (saved === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
      else process.env.MEMORY_REMEMBER_FACT_ENABLED = saved;
    }
  });

  it("includes remember_fact when flag='true'", () => {
    const saved = process.env.MEMORY_REMEMBER_FACT_ENABLED;
    process.env.MEMORY_REMEMBER_FACT_ENABLED = "true";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "remember_fact"));
      assert.equal(defs.length, 12);
    } finally {
      if (saved === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
      else process.env.MEMORY_REMEMBER_FACT_ENABLED = saved;
    }
  });

  it("includes remember_fact when flag='1'", () => {
    const saved = process.env.MEMORY_REMEMBER_FACT_ENABLED;
    process.env.MEMORY_REMEMBER_FACT_ENABLED = "1";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "remember_fact"));
    } finally {
      if (saved === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
      else process.env.MEMORY_REMEMBER_FACT_ENABLED = saved;
    }
  });

  it("SERVER_SIDE_TOOLS contains remember_fact regardless of flag", () => {
    assert.ok(SERVER_SIDE_TOOLS.has("remember_fact"));
  });
});

describe("RECALL_MEMORY tool definition", () => {
  it("has type=function, strict=true, correct parameter shape", () => {
    assert.equal(RECALL_MEMORY.type, "function");
    assert.equal(RECALL_MEMORY.name, "recall_memory");
    assert.equal(RECALL_MEMORY.strict, true);
    const p = RECALL_MEMORY.parameters;
    assert.equal(p.additionalProperties, false);
    assert.deepEqual(p.required.slice().sort(), ["categories", "limit", "query"]);
    assert.deepEqual(p.properties.query.type, ["string", "null"]);
    assert.deepEqual(p.properties.limit.type, ["integer", "null"]);
    // categories is ["array","null"], and its items must enumerate the whitelist
    assert.ok(Array.isArray(p.properties.categories.type));
    assert.ok(p.properties.categories.type.includes("null"));
    assert.ok(p.properties.categories.type.includes("array"));
    assert.ok(Array.isArray(p.properties.categories.items.enum));
    assert.ok(p.properties.categories.items.enum.includes("injury"));
    assert.ok(p.properties.categories.items.enum.includes("custom"));
  });
});

describe("buildToolDefinitions — flag-gated recall_memory", () => {
  it("excludes recall_memory when MEMORY_RECALL_ENABLED unset", () => {
    const saved = process.env.MEMORY_RECALL_ENABLED;
    delete process.env.MEMORY_RECALL_ENABLED;
    try {
      const defs = buildToolDefinitions();
      assert.ok(!defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (saved === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = saved;
    }
  });

  it("includes recall_memory when MEMORY_RECALL_ENABLED='true'", () => {
    const saved = process.env.MEMORY_RECALL_ENABLED;
    process.env.MEMORY_RECALL_ENABLED = "true";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (saved === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = saved;
    }
  });

  it("both remember_fact and recall_memory when both flags on", () => {
    const savedR = process.env.MEMORY_REMEMBER_FACT_ENABLED;
    const savedL = process.env.MEMORY_RECALL_ENABLED;
    process.env.MEMORY_REMEMBER_FACT_ENABLED = "true";
    process.env.MEMORY_RECALL_ENABLED = "true";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "remember_fact"));
      assert.ok(defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (savedR === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
      else process.env.MEMORY_REMEMBER_FACT_ENABLED = savedR;
      if (savedL === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = savedL;
    }
  });

  it("SERVER_SIDE_TOOLS contains recall_memory regardless of flag", () => {
    assert.ok(SERVER_SIDE_TOOLS.has("recall_memory"));
  });
});
