import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonBody } from "../../../../../api/emersus/workflow-v2.js";

describe("parseJsonBody", () => {
  it("parses string body", () => {
    const result = parseJsonBody({ body: '{"question":"hi"}' });
    assert.equal(result.question, "hi");
  });
  it("returns object body as-is", () => {
    const result = parseJsonBody({ body: { question: "hi" } });
    assert.equal(result.question, "hi");
  });
  it("throws on invalid JSON string", () => {
    assert.throws(() => parseJsonBody({ body: "not json" }), (err) => err.statusCode === 400);
  });
});
