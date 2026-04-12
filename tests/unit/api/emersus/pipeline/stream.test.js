import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSSELine, extractTokenUsage } from "../../../../../api/emersus/pipeline/stream.js";

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
