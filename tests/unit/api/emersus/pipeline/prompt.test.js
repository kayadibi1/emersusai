import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "../../../../../api/emersus/pipeline/prompt.js";

describe("buildMessages", () => {
  it("returns an array of 3 input messages (2 system + 1 user)", () => {
    // Few-shot was removed 2026-04-16: the prior assistant example ended with
    // prose-only and no tool call, training the model to skip emit_widget on
    // chart-shaped requests. Behavior now lives in tool descriptions per
    // OpenAI Responses API guidance.
    const msgs = buildMessages({
      question: "best creatine dose?",
      profile: { goal: "strength" },
      threadState: {},
      recentMessages: [],
      evidence: { formatted: "No database evidence retrieved." },
      workoutPlan: null,
    });
    assert.ok(Array.isArray(msgs));
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "system");
    assert.equal(msgs[2].role, "user");
  });

  it("includes user question in the final user message", () => {
    const msgs = buildMessages({
      question: "creatine loading protocol",
      profile: {},
      threadState: {},
      recentMessages: [],
      evidence: { formatted: "" },
      workoutPlan: null,
    });
    const lastMsg = msgs[msgs.length - 1];
    assert.ok(lastMsg.content.includes("creatine loading protocol"));
  });

  it("includes retrieval metadata in the final user message", () => {
    const msgs = buildMessages({
      question: "log this breakfast",
      profile: {},
      threadState: {},
      recentMessages: [],
      evidence: { status: "skipped", reason: "food_log_request", formatted: null },
      workoutPlan: null,
    });
    const payload = JSON.parse(msgs[msgs.length - 1].content);
    assert.equal(payload.retrieval_status, "skipped");
    assert.equal(payload.retrieval_reason, "food_log_request");
    assert.equal(payload.retrieved_evidence, null);
  });

  it("system prompt contains identity and wheelhouse", () => {
    const msgs = buildMessages({
      question: "test", profile: {}, threadState: {},
      recentMessages: [], evidence: { formatted: "" }, workoutPlan: null,
    });
    assert.ok(msgs[0].content.includes("EMERSUS"));
    assert.ok(msgs[0].content.includes("wheelhouse"));
  });

  it("system prompt 2 contains design tokens", () => {
    const msgs = buildMessages({
      question: "test", profile: {}, threadState: {},
      recentMessages: [], evidence: { formatted: "" }, workoutPlan: null,
    });
    assert.ok(msgs[1].content.includes("--color-background-primary"));
  });
});
