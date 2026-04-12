import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../../../../../api/emersus/pipeline/synthesize.js";

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
});
