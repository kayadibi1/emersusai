import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody, PROMPT_CACHE_KEY, fetchWithRetry } from "../../../../../api/emersus/pipeline/synthesize.js";

describe("buildRequestBody", () => {
  it("includes model, stream, max_output_tokens, input, tools", () => {
    const body = buildRequestBody({
      messages: [{ role: "system", content: "test" }, { role: "user", content: "hi" }],
      tools: [{ type: "function", name: "test_tool", parameters: {} }],
      model: "gpt-4.1-mini",
    });
    assert.equal(body.model, "gpt-4.1-mini");
    assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens, 16000);
    assert.equal(body.input.length, 2);
    assert.equal(body.tools.length, 1);
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
