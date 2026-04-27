// tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQualifierExtractionResponse,
  buildQualifierExtractor,
} from "../../../../../api/emersus/pipeline/mode2-qualifier-extract.js";

test("parser: well-formed JSON with multiple qualifiers", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"population":"trained men","dose":"5g/day","duration":"8 weeks"}}'
  );
  assert.equal(r.error, null);
  assert.deepEqual(r.qualifiers, {
    population: "trained men",
    dose: "5g/day",
    duration: "8 weeks",
  });
});

test("parser: ```json``` fences tolerated", () => {
  const r = parseQualifierExtractionResponse(
    '```json\n{"qualifiers":{"population":"x"}}\n```'
  );
  assert.equal(r.error, null);
  assert.equal(r.qualifiers.population, "x");
});

test("parser: empty qualifier dict is valid", () => {
  const r = parseQualifierExtractionResponse('{"qualifiers":{}}');
  assert.equal(r.error, null);
  assert.deepEqual(r.qualifiers, {});
});

test("parser: malformed JSON returns error + empty qualifiers", () => {
  const r = parseQualifierExtractionResponse("not json");
  assert.equal(r.error, "malformed_json");
  assert.deepEqual(r.qualifiers, {});
});

test("parser: non-string values coerced to strings", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"sample_size":24,"effect_size":0.07}}'
  );
  assert.equal(r.qualifiers.sample_size, "24");
  assert.equal(r.qualifiers.effect_size, "0.07");
});

test("parser: drops keys with empty values", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"population":"trained men","dose":""}}'
  );
  assert.equal(r.qualifiers.population, "trained men");
  assert.ok(!("dose" in r.qualifiers));
});

test("buildQualifierExtractor: caches per source_id within instance", async () => {
  let callCount = 0;
  const mockCallJudge = async () => {
    callCount += 1;
    return '{"qualifiers":{"population":"trained men"}}';
  };
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  await extractor.extract({ source_id: 1, title: "t", excerpt: "e" }); // same source_id
  await extractor.extract({ source_id: 2, title: "t", excerpt: "e" });
  assert.equal(callCount, 2, "second call for source_id=1 should hit cache");
});

test("buildQualifierExtractor: judge errors fall back to empty qualifiers", async () => {
  const mockCallJudge = async () => { throw new Error("judge timeout"); };
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  const r = await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  assert.deepEqual(r.qualifiers, {});
  assert.match(r.error || "", /judge timeout/);
});

test("buildQualifierExtractor: tracks cost and latency per call", async () => {
  const mockCallJudge = async () => '{"qualifiers":{"population":"x"}}';
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  const r = await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  assert.ok(r.latency_ms >= 0);
  assert.ok(r.cost_usd >= 0);
});
