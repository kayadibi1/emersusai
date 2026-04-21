import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  buildRequestBody,
  PROMPT_CACHE_KEY,
  fetchWithRetry,
  resolveMaxOutputTokens,
  isPreviousResponseNotFound,
  synthesize,
} from "../../../../../api/emersus/pipeline/synthesize.js";

describe("buildRequestBody", () => {
  it("includes model, stream, max_output_tokens, input, tools", () => {
    const body = buildRequestBody({
      messages: [{ role: "system", content: "test" }, { role: "user", content: "hi" }],
      tools: [{ type: "function", name: "test_tool", parameters: {} }],
      model: "gpt-4.1-mini",
    });
    assert.equal(body.model, "gpt-4.1-mini");
    assert.equal(body.stream, true);
    // Default kind is "synthesis" -> 8000 cap.
    assert.equal(body.max_output_tokens, 8000);
    assert.equal(body.input.length, 2);
    assert.equal(body.tools.length, 1);
  });
  it("resolves per-kind output caps", () => {
    assert.equal(resolveMaxOutputTokens("synthesis"), 8000);
    assert.equal(resolveMaxOutputTokens("onboarding"), 1500);
    assert.equal(resolveMaxOutputTokens("memory_extract"), 1000);
    assert.equal(resolveMaxOutputTokens("tool_followup"), 4000);
    assert.equal(resolveMaxOutputTokens("unknown"), 8000);
    assert.equal(resolveMaxOutputTokens(), 8000);
  });
  it("honors `kind` param when building the body", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5.4-mini",
      kind: "tool_followup",
    });
    assert.equal(body.max_output_tokens, 4000);
  });
  it("omits tools when array is empty", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-4.1-mini",
    });
    assert.equal(body.tools, undefined);
  });
  it("sets prompt_cache_key and 24h retention for stable cache routing", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5.4-mini",
    });
    assert.equal(body.prompt_cache_key, PROMPT_CACHE_KEY);
    assert.equal(body.prompt_cache_retention, "24h");
  });
  it("includes metadata when provided", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5.4-mini",
      metadata: { thread_id: "t1", user_id: "u1" },
    });
    assert.deepEqual(body.metadata, { thread_id: "t1", user_id: "u1" });
  });
  it("omits metadata when empty", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5.4-mini",
      metadata: {},
    });
    assert.equal(body.metadata, undefined);
  });
  it("sets store:true for OpenAI server-side state retention", () => {
    const body = buildRequestBody({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5.4-mini",
    });
    assert.equal(body.store, true);
  });

  it("with chaining enabled sends previous_response_id and trims messages to system + latest user turn", () => {
    const messages = [
      { role: "system", content: "sys1" },
      { role: "system", content: "sys2" },
      { role: "user", content: "old user" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "NEW user turn" },
    ];
    const body = buildRequestBody({
      model: "gpt-5.4-mini",
      messages,
      tools: [],
      chainingContext: { shouldChain: true, previousResponseId: "resp_123", reason: "ok" },
    });

    assert.equal(body.previous_response_id, "resp_123");
    assert.equal(body.input.length, 3);
    assert.equal(body.input[0].role, "system");
    assert.equal(body.input[0].content, "sys1");
    assert.equal(body.input[1].role, "system");
    assert.equal(body.input[2].role, "user");
    assert.equal(body.input[2].content, "NEW user turn");
    assert.ok(!body.input.some((m) => m.content === "old user"), "stale user turn dropped");
    assert.ok(!body.input.some((m) => m.role === "assistant"), "assistant turns dropped");
    assert.equal(messages.length, 5, "caller's messages array must not be mutated");
  });

  it("without chainingContext preserves full messages and no previous_response_id", () => {
    const body = buildRequestBody({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
      ],
      tools: [],
    });

    assert.ok(!("previous_response_id" in body), "should not set previous_response_id");
    assert.equal(body.input.length, 4);
  });

  it("with chainingContext.shouldChain=false ignores chaining", () => {
    const body = buildRequestBody({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
      ],
      tools: [],
      chainingContext: { shouldChain: false, reason: "flag_disabled" },
    });

    assert.ok(!("previous_response_id" in body));
    assert.equal(body.input.length, 2);
  });

  it("with chainingContext but no user message falls through to full history", () => {
    // Defensive: shouldn't happen in practice but shouldn't crash.
    const body = buildRequestBody({
      model: "gpt-5.4-mini",
      messages: [{ role: "system", content: "sys" }],
      tools: [],
      chainingContext: { shouldChain: true, previousResponseId: "resp_x", reason: "ok" },
    });

    // No user message → don't trim, don't add previous_response_id
    assert.ok(!("previous_response_id" in body));
    assert.equal(body.input.length, 1);
  });
});

describe("fetchWithRetry", () => {
  it("returns on first-attempt success", async () => {
    const mockFetch = mock.method(globalThis, "fetch", async () => new Response("ok", { status: 200 }));
    try {
      const r = await fetchWithRetry("https://example.com", {});
      assert.equal(r.status, 200);
      assert.equal(mockFetch.mock.callCount(), 1);
    } finally { mockFetch.mock.restore(); }
  });
  it("retries transient 503 then succeeds", async () => {
    let n = 0;
    const mockFetch = mock.method(globalThis, "fetch", async () => {
      n++;
      return n < 2
        ? new Response("fail", { status: 503 })
        : new Response("ok", { status: 200 });
    });
    try {
      const r = await fetchWithRetry("https://example.com", {}, { baseDelayMs: 1 });
      assert.equal(r.status, 200);
      assert.equal(mockFetch.mock.callCount(), 2);
    } finally { mockFetch.mock.restore(); }
  });
  it("does not retry 400", async () => {
    const mockFetch = mock.method(globalThis, "fetch", async () => new Response("bad", { status: 400 }));
    try {
      const r = await fetchWithRetry("https://example.com", {}, { baseDelayMs: 1 });
      assert.equal(r.status, 400);
      assert.equal(mockFetch.mock.callCount(), 1);
    } finally { mockFetch.mock.restore(); }
  });
  it("propagates AbortError without retry", async () => {
    const err = new Error("aborted"); err.name = "AbortError";
    const mockFetch = mock.method(globalThis, "fetch", async () => { throw err; });
    try {
      await assert.rejects(
        () => fetchWithRetry("https://example.com", {}, { baseDelayMs: 1 }),
        /aborted/,
      );
      assert.equal(mockFetch.mock.callCount(), 1);
    } finally { mockFetch.mock.restore(); }
  });
});

describe("isPreviousResponseNotFound", () => {
  it("detects error.code shape", () => {
    assert.equal(isPreviousResponseNotFound({ error: { code: "previous_response_not_found" } }), true);
  });
  it("detects error.type shape", () => {
    assert.equal(isPreviousResponseNotFound({ error: { type: "previous_response_not_found" } }), true);
  });
  it("returns false for other 400s", () => {
    assert.equal(isPreviousResponseNotFound({ error: { code: "invalid_request_error" } }), false);
  });
  it("returns false for empty/missing body", () => {
    assert.equal(isPreviousResponseNotFound(null), false);
    assert.equal(isPreviousResponseNotFound({}), false);
    assert.equal(isPreviousResponseNotFound(undefined), false);
  });
});

// Minimal ctx + env setup for synthesize() integration tests. synthesize()
// reads OPENAI_API_KEY from env and expects ctx._timer + ctx._abortController.
function makeCtx() {
  return {
    question: "How much protein per day?",
    threadState: null,
    recentMessages: [],
    evidence: { status: "completed", formatted: null },
    workoutPlan: null,
    crossThreadMemory: null,
    threadId: "t1",
    supabaseUserId: "u1",
    plan: { topic: "nutrition", riskLevel: "low" },
    _timer: { record: () => {} },
    _abortController: new AbortController(),
  };
}

describe("synthesize() stale-chaining recovery", () => {
  it("rebuilds without chaining and retries ONCE on previous_response_not_found", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = (...args) => { warnCalls.push(args); };
    const bodies = [];
    const mockFetch = mock.method(globalThis, "fetch", async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (bodies.length === 1) {
        assert.ok(body.previous_response_id, "first call must carry chaining id");
        return new Response(
          JSON.stringify({ error: { code: "previous_response_not_found", message: "not found" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      // Return a valid streaming-like response so synthesize() proceeds.
      return new Response("ok", { status: 200 });
    });
    try {
      const ctx = makeCtx();
      await synthesize(ctx, {
        chainingContext: { shouldChain: true, previousResponseId: "resp_stale", reason: "ok" },
      });
      assert.equal(mockFetch.mock.callCount(), 2, "exactly one recovery retry");
      assert.ok(bodies[0].previous_response_id, "first body had chaining");
      assert.ok(
        !("previous_response_id" in bodies[1]),
        "recovery body drops previous_response_id",
      );
      // Full-history path — messages array should be intact (system prompt + user).
      assert.ok(bodies[1].input.length >= 2, "recovery body restores full history");
      assert.ok(bodies[1].input.some((m) => m.role === "user"), "user turn preserved");
      assert.ok(
        warnCalls.some((args) => String(args[0] || "").includes("previous_response_id stale")),
        "emits ops warning",
      );
    } finally {
      mockFetch.mock.restore();
      console.warn = originalWarn;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("does NOT retry a 400 with a DIFFERENT error code even when chaining was requested", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    const mockFetch = mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: "invalid_request_error", message: "bad schema" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const ctx = makeCtx();
      await assert.rejects(
        () => synthesize(ctx, {
          chainingContext: { shouldChain: true, previousResponseId: "resp_x", reason: "ok" },
        }),
        /Synthesis failed/,
      );
      assert.equal(calls, 1, "no retry on unrelated 400");
    } finally {
      mockFetch.mock.restore();
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("does NOT trigger recovery when chainingContext was null to begin with", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;
    const mockFetch = mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: "previous_response_not_found" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const ctx = makeCtx();
      // No chainingContext passed → recovery branch must be skipped.
      await assert.rejects(
        () => synthesize(ctx),
        /Synthesis failed/,
      );
      assert.equal(calls, 1, "no retry without chainingContext");
    } finally {
      mockFetch.mock.restore();
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });
});
