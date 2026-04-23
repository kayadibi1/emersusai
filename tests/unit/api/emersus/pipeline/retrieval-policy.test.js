import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decideRetrieval,
  planRetrieval,
} from "../../../../../api/emersus/pipeline/retrieval-policy.js";

describe("decideRetrieval", () => {
  it("skips retrieval for food-log requests", () => {
    const result = decideRetrieval({ question: "I just had a whey shake and a banana" });
    assert.deepStrictEqual(result, { mode: "skip", reason: "food_log_request" });
  });

  it("keeps retrieval on for meal-plan requests", () => {
    const result = decideRetrieval({ question: "Make me a meal plan for a cut" });
    assert.deepStrictEqual(result, { mode: "run", reason: "meal_plan_request" });
  });

  it("keeps retrieval on for workout-plan requests", () => {
    const result = decideRetrieval({ question: "Build me a 4-day upper lower workout plan" });
    assert.deepStrictEqual(result, { mode: "run", reason: "workout_plan_request" });
  });

  it("keeps retrieval on for workout adjustments when a current plan is loaded", () => {
    const result = decideRetrieval({
      question: "I missed Friday, can you move the lower day and reduce the volume?",
      workoutPlan: { id: "plan_1" },
    });
    assert.deepStrictEqual(result, { mode: "run", reason: "workout_adjustment_request" });
  });

  it("keeps retrieval on for explicit evidence requests", () => {
    const result = decideRetrieval({
      question: "What does the research say about creatine dosing?",
    });
    assert.deepStrictEqual(result, { mode: "run", reason: "explicit_evidence_request" });
  });

  it("keeps retrieval on for default coaching questions", () => {
    const result = decideRetrieval({ question: "How should I structure zone 2 this week?" });
    assert.deepStrictEqual(result, { mode: "run", reason: "default" });
  });
});

describe("planRetrieval", () => {
  it("stores the retrieval policy on ctx", () => {
    const ctx = { question: "Log this breakfast for me", workoutPlan: null };
    const next = planRetrieval(ctx);
    assert.equal(next, ctx);
    assert.deepStrictEqual(next.retrievalPolicy, { mode: "skip", reason: "food_log_request" });
  });
});
