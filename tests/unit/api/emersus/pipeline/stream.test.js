import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSSELine,
  extractTokenUsage,
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
});
