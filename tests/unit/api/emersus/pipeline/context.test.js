import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ShortCircuit, createContext, TimeTracker } from "../../../../../api/emersus/pipeline/context.js";

describe("ShortCircuit", () => {
  it("carries a response payload", () => {
    const payload = { answer_text: "refused", guardrail: { status: "hard_refusal" } };
    const err = new ShortCircuit(payload);
    assert.equal(err instanceof Error, true);
    assert.deepStrictEqual(err.response, payload);
    assert.equal(err.message, "ShortCircuit");
  });
});

describe("createContext", () => {
  it("builds ctx from raw input with defaults", () => {
    const ctx = createContext({ question: "test?", userId: "u1" });
    assert.equal(ctx.question, "test?");
    assert.equal(ctx.userId, "u1");
    assert.equal(ctx.prose, "");
    assert.deepStrictEqual(ctx.toolResults, {});
    assert.deepStrictEqual(ctx.sources, []);
    assert.equal(ctx.evidence, null);
  });

  it("passes through all input fields", () => {
    const raw = {
      question: "q", userId: "u", threadId: "t",
      threadState: { primary_topic: "creatine" },
      recentMessages: [{ role: "user", text: "hi" }],
      requestMeta: { clientIp: "1.2.3.4" },
      profile: { goal: "hypertrophy" },
    };
    const ctx = createContext(raw);
    assert.equal(ctx.threadId, "t");
    assert.deepStrictEqual(ctx.threadState, { primary_topic: "creatine" });
    assert.deepStrictEqual(ctx.recentMessages, [{ role: "user", text: "hi" }]);
    assert.deepStrictEqual(ctx.requestMeta, { clientIp: "1.2.3.4" });
    assert.deepStrictEqual(ctx.profile, { goal: "hypertrophy" });
  });
});

describe("TimeTracker", () => {
  it("records and retrieves stage timings", () => {
    const t = new TimeTracker();
    t.record("profile_load_ms", 42);
    t.record("retrieval_ms", 310);
    const timings = t.all();
    assert.equal(timings.profile_load_ms, 42);
    assert.equal(timings.retrieval_ms, 310);
  });
});
