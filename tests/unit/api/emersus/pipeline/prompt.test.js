import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "../../../../../api/emersus/pipeline/prompt.js";

describe("buildMessages", () => {
  it("returns an array of 5 input messages", () => {
    const msgs = buildMessages({
      question: "best creatine dose?",
      profile: { goal: "strength" },
      threadState: {},
      recentMessages: [],
      evidence: { formatted: "No database evidence retrieved." },
      workoutPlan: null,
    });
    assert.ok(Array.isArray(msgs));
    assert.equal(msgs.length, 5);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "system");
    assert.equal(msgs[2].role, "user");
    assert.equal(msgs[3].role, "assistant");
    assert.equal(msgs[4].role, "user");
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
