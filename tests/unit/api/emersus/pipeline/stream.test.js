import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSSELine,
  extractTokenUsage,
  stream,
  streamToBuffer,
} from "../../../../../api/emersus/pipeline/stream.js";

describe("parseSSELine", () => {
  it("parses a data line", () => {
    const result = parseSSELine('data: {"type":"response.output_text.delta","delta":"hello"}');
    assert.equal(result.type, "response.output_text.delta");
    assert.equal(result.delta, "hello");
  });
  it("returns null for empty lines", () => {
    assert.equal(parseSSELine(""), null);
    assert.equal(parseSSELine("\n"), null);
  });
  it("returns null for [DONE]", () => {
    assert.equal(parseSSELine("data: [DONE]"), null);
  });
  it("returns null for non-data lines", () => {
    assert.equal(parseSSELine("event: something"), null);
  });
});

describe("extractTokenUsage", () => {
  it("extracts usage from response.completed event", () => {
    const event = {
      type: "response.completed",
      response: {
        id: "resp_123",
        usage: { input_tokens: 500, output_tokens: 200, total_tokens: 700,
          input_tokens_details: { cached_tokens: 400 } },
      },
    };
    const usage = extractTokenUsage(event);
    assert.equal(usage.input_tokens, 500);
    assert.equal(usage.output_tokens, 200);
    assert.equal(usage.cached_tokens, 400);
  });
});

function createCtx(streamLines) {
  async function* openaiStream() {
    for (const line of streamLines) {
      yield `${line}\n`;
    }
  }

  return {
    _openaiStream: openaiStream(),
    toolResults: {},
    evidence: { items: [] },
    _timer: {
      record() {},
      all() { return {}; },
    },
    _synthesisStartMs: Date.now(),
    _abortController: { abort() {} },
  };
}

describe("streamToBuffer", () => {
  it("drops invalid emit_widget payloads after validation failure", async () => {
    const ctx = createCtx([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"call_1","name":"emit_widget"}}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"call_1","name":"emit_widget","arguments":"{\\"title\\":\\"Bad widget\\",\\"html\\":\\"<style>body{min-height:100vh}</style><div>bad</div>\\"}"}}',
      'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
    ]);

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await streamToBuffer(ctx);
    } finally {
      console.error = originalConsoleError;
    }

    assert.deepStrictEqual(ctx.toolResults, {});
  });

  it("keeps valid emit_widget payloads", async () => {
    const ctx = createCtx([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"call_1","name":"emit_widget"}}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"call_1","name":"emit_widget","arguments":"{\\"title\\":\\"Good widget\\",\\"html\\":\\"<div>ok</div>\\"}"}}',
      'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
    ]);

    await streamToBuffer(ctx);

    assert.deepStrictEqual(ctx.toolResults.emit_widget, {
      title: "Good widget",
      html: "<div>ok</div>",
    });
  });

  it("flags unknown tools early on output_item.added without aborting the stream", async () => {
    const ctx = createCtx([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"call_1","name":"launch_missiles"}}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"call_1","name":"launch_missiles","arguments":"{}"}}',
      'data: {"type":"response.output_text.delta","delta":"still streaming prose"}',
      'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
    ]);

    // Spy on onToolError by monkey-patching after streamToBuffer sets it up.
    // streamToBuffer leaves onToolError null; wire our own handler into the
    // processEvent path by using the public streamToBuffer wrapper plus a
    // state shim via ctx. Simplest route: use processEvent directly.
    const { __testables } = await import("../../../../../api/emersus/pipeline/stream.js");
    const captured = [];
    const state = {
      ctx,
      proseBuffer: "",
      toolBuffers: {},
      serverToolCalls: [],
      onToolError: (name, errors) => captured.push({ name, errors }),
    };
    for await (const line of ctx._openaiStream) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") continue;
      const event = JSON.parse(payload);
      __testables.processEvent(event, state);
    }
    // One error on added (unknown_tool), one from the done-stage JSON parse
    // fallback is fine — the key guarantee is that the unknown-tool error
    // was emitted BEFORE the full-arg event would have parsed.
    const unknownErrors = captured.filter(
      (c) => c.name === "launch_missiles" && Array.isArray(c.errors) && c.errors.includes("unknown_tool")
    );
    assert.equal(unknownErrors.length, 1, "unknown_tool error should surface once on output_item.added");
    // Prose after the bad tool still accumulates — stream didn't abort.
    assert.equal(state.proseBuffer, "still streaming prose");
  });
});

function createMockRes() {
  const writes = [];
  const listeners = {};
  return {
    headersSent: false,
    writes,
    setHeader() {},
    flushHeaders() {},
    write(chunk) { writes.push(String(chunk)); return true; },
    end() {},
    on(event, fn) { listeners[event] = fn; },
    // helper to decode SSE payloads written during the stream
    sseEvents() {
      const events = [];
      for (const w of writes) {
        const trimmed = String(w).trim();
        if (!trimmed.startsWith("data: ")) continue;
        try { events.push(JSON.parse(trimmed.slice(6))); } catch { /* noop */ }
      }
      return events;
    },
  };
}

describe("stream() done event — chainingUsed", () => {
  it("emits chainingUsed:true when ctx._chainingUsed is true", async () => {
    const ctx = createCtx([
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      'data: {"type":"response.completed","response":{"id":"resp_c","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15,"input_tokens_details":{"cached_tokens":8}}}}',
    ]);
    ctx._chainingUsed = true;
    const res = createMockRes();

    await stream(ctx, res);

    const events = res.sseEvents();
    const done = events.find((e) => e.type === "done");
    assert.ok(done, "done event should be emitted");
    assert.equal(done.chainingUsed, true);
    assert.equal(typeof done.chainingUsed, "boolean");
  });

  it("emits chainingUsed:false by default (when flag/context is absent)", async () => {
    const ctx = createCtx([
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      'data: {"type":"response.completed","response":{"id":"resp_d","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
    ]);
    // ctx._chainingUsed intentionally unset
    const res = createMockRes();

    await stream(ctx, res);

    const events = res.sseEvents();
    const done = events.find((e) => e.type === "done");
    assert.ok(done, "done event should be emitted");
    assert.equal(done.chainingUsed, false);
    assert.equal(typeof done.chainingUsed, "boolean");
  });
});
