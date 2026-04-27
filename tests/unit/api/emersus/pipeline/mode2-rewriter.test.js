// tests/unit/api/emersus/pipeline/mode2-rewriter.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteForQualifierPreservation,
  isLengthRatioAcceptable,
} from "../../../../../api/emersus/pipeline/mode2-rewriter.js";

test("isLengthRatioAcceptable: accepts ratios in [0.6, 1.5]", () => {
  assert.equal(isLengthRatioAcceptable(100, 100), true);
  assert.equal(isLengthRatioAcceptable(100, 60), true);
  assert.equal(isLengthRatioAcceptable(100, 150), true);
});

test("isLengthRatioAcceptable: rejects ratios outside [0.6, 1.5]", () => {
  assert.equal(isLengthRatioAcceptable(100, 50), false);
  assert.equal(isLengthRatioAcceptable(100, 200), false);
});

test("isLengthRatioAcceptable: handles zero original gracefully", () => {
  assert.equal(isLengthRatioAcceptable(0, 100), false);
});

test("rewriteForQualifierPreservation: mode=preserve produces rewrite", async () => {
  const mockCallJudge = async ({ system }) => {
    assert.match(system, /preserve.*qualifier/i);
    assert.doesNotMatch(system, /OR explicitly hedge/i);
    return "Creatine 5g/day in trained men over 8 weeks improved 1RM by 7% citesrc1.";
  };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Creatine improves strength citesrc1.",
    validationResult: {
      per_claim_missing: [
        { claim_text: "Creatine improves strength", source_idx: 1, missing: ["population", "dose", "duration"] },
      ],
    },
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day", duration: "8 weeks" } }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.match(r.prose, /trained men/i);
  assert.equal(r.length_ratio_acceptable, true);
});

test("rewriteForQualifierPreservation: mode=preserve_or_hedge passes hedge instruction", async () => {
  let observedSystem = null;
  const mockCallJudge = async ({ system }) => {
    observedSystem = system;
    return "Creatine improves strength; the cited source is in trained men, generalization beyond is uncertain citesrc1.";
  };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Creatine improves strength citesrc1.",
    validationResult: { per_claim_missing: [] },
    citedSources: [{ id: 1, qualifiers: { population: "trained men" } }],
    mode: "preserve_or_hedge",
    callJudge: mockCallJudge,
  });
  assert.match(observedSystem, /preserve.*OR explicitly hedge/i);
  assert.match(r.prose, /uncertain/i);
});

test("rewriteForQualifierPreservation: length-ratio fallback returns original", async () => {
  const mockCallJudge = async () => "x"; // wildly short
  const r = await rewriteForQualifierPreservation({
    originalProse: "This is a fairly long original prose response that should not be replaced by a much shorter rewrite.",
    validationResult: { per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["dose"] }] },
    citedSources: [{ id: 1, qualifiers: { dose: "5g" } }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.equal(r.length_ratio_acceptable, false);
  assert.equal(r.prose, "This is a fairly long original prose response that should not be replaced by a much shorter rewrite.");
  assert.match(r.error || "", /length_ratio_out_of_bounds/);
});

test("rewriteForQualifierPreservation: judge error returns original prose", async () => {
  const mockCallJudge = async () => { throw new Error("rewrite timeout"); };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Original.",
    validationResult: { per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["dose"] }] },
    citedSources: [{ id: 1, qualifiers: {} }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.equal(r.prose, "Original.");
  assert.match(r.error || "", /rewrite timeout/);
});
