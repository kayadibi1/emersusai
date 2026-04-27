// tests/unit/api/emersus/pipeline/mode2-validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseValidationResponse,
  validateQualifierPreservation,
  computeQualifiersDroppedBreakdown,
} from "../../../../../api/emersus/pipeline/mode2-validate.js";

test("parseValidationResponse: well-formed", () => {
  const r = parseValidationResponse(JSON.stringify({
    per_claim: [
      { claim_text: "creatine improves strength", source_idx: 2, missing: ["population", "dose"] },
      { claim_text: "vitamin D helps athletes", source_idx: 4, missing: [] },
    ],
  }));
  assert.equal(r.error, null);
  assert.equal(r.per_claim.length, 2);
  assert.deepEqual(r.per_claim[0].missing, ["population", "dose"]);
});

test("parseValidationResponse: ```json fences tolerated", () => {
  const r = parseValidationResponse('```json\n{"per_claim":[]}\n```');
  assert.equal(r.error, null);
  assert.deepEqual(r.per_claim, []);
});

test("parseValidationResponse: malformed", () => {
  const r = parseValidationResponse("not json");
  assert.equal(r.error, "malformed_json");
  assert.deepEqual(r.per_claim, []);
});

test("parseValidationResponse: drops invalid entries (no claim_text)", () => {
  const r = parseValidationResponse(JSON.stringify({
    per_claim: [
      { claim_text: "", source_idx: 1, missing: ["population"] },
      { claim_text: "valid claim", source_idx: 2, missing: ["dose"] },
    ],
  }));
  assert.equal(r.per_claim.length, 1);
  assert.equal(r.per_claim[0].claim_text, "valid claim");
});

test("computeQualifiersDroppedBreakdown sums by qualifier type", () => {
  const perClaim = [
    { claim_text: "a", source_idx: 1, missing: ["population", "dose"] },
    { claim_text: "b", source_idx: 1, missing: ["population", "duration"] },
    { claim_text: "c", source_idx: 2, missing: [] },
  ];
  const b = computeQualifiersDroppedBreakdown(perClaim);
  assert.equal(b.population, 2);
  assert.equal(b.dose, 1);
  assert.equal(b.duration, 1);
  assert.ok(!("study_design" in b));
});

test("validateQualifierPreservation: returns no missing when all preserved", async () => {
  const mockCallJudge = async () => JSON.stringify({ per_claim: [] });
  const r = await validateQualifierPreservation({
    prose: "creatine 5g/day for 8 weeks improved 1RM in trained men citesrc1",
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day" } }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.total_missing, 0);
  assert.deepEqual(r.qualifiers_dropped_breakdown, {});
});

test("validateQualifierPreservation: returns missing list when judge flags drops", async () => {
  const mockCallJudge = async () => JSON.stringify({
    per_claim: [
      { claim_text: "creatine improves strength", source_idx: 1, missing: ["population", "dose"] },
    ],
  });
  const r = await validateQualifierPreservation({
    prose: "creatine improves strength citesrc1",
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day" } }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.total_missing, 2);
  assert.equal(r.per_claim_missing.length, 1);
  assert.deepEqual(r.qualifiers_dropped_breakdown, { population: 1, dose: 1 });
});

test("validateQualifierPreservation: judge error returns empty result with error", async () => {
  const mockCallJudge = async () => { throw new Error("judge timeout"); };
  const r = await validateQualifierPreservation({
    prose: "x",
    citedSources: [{ id: 1, qualifiers: {} }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.error, "judge timeout");
  assert.equal(r.total_missing, 0);
});

test("validateQualifierPreservation: skips disabled qualifier types", async () => {
  // The judge returned effect_size as missing, but our config disables that type.
  const mockCallJudge = async () => JSON.stringify({
    per_claim: [
      { claim_text: "x", source_idx: 1, missing: ["effect_size", "population"] },
    ],
  });
  const r = await validateQualifierPreservation({
    prose: "x",
    citedSources: [{ id: 1, qualifiers: {} }],
    callJudge: mockCallJudge,
    disabledQualifiers: ["effect_size"],
  });
  // population is still missing, but effect_size was filtered out
  assert.equal(r.total_missing, 1);
  assert.equal(r.qualifiers_dropped_breakdown.population, 1);
  assert.ok(!("effect_size" in r.qualifiers_dropped_breakdown));
});
