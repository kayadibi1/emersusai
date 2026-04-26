import { test } from "node:test";
import assert from "node:assert/strict";

import { assignBucket, parseExtractionResponse } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("assignBucket: contradicted cited source -> mode_4", () => {
  const scores = [
    { source_index: 1, direction: "contradicts", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_4_contradicted");
});

test("assignBucket: no support and no contradiction -> mode_3", () => {
  const scores = [
    { source_index: 1, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_3_fabrication");
});

test("assignBucket: uncited source scores 2, cited scores 0 -> mode_1", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_1_misattribution");
});

test("assignBucket: cited source scores 1 -> mode_2", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 1, qualifiers_missing: [] },
    { source_index: 2, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_2_overgen");
});

test("assignBucket: cited scores 2 with qualifier diff -> mode_2", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: ["trained men only"] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_2_overgen");
});

test("assignBucket: cited scores 2 with no qualifier diff -> correct", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "correct");
});

test("assignBucket: both cited and uncited score 2 -> correct + alternate_supporting_sources", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "correct");
  assert.deepEqual(result.alternate_supporting_sources, [2]);
});

test("assignBucket: empty cited_ids -> no_marker", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [], source_scores: scores });
  assert.equal(result.mode, "no_marker");
});

test("assignBucket: multi-cite [1,2] one contradicts -> mode_4", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
    { source_index: 2, direction: "contradicts", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1, 2], source_scores: scores });
  assert.equal(result.mode, "mode_4_contradicted");
});

test("parseExtractionResponse: well-formed JSON", () => {
  const raw = JSON.stringify({
    claims: [
      { claim_text: "Creatine improves 1RM by 5%", cited_ids: [3] },
      { claim_text: "Creatine reduces fatigue", cited_ids: [3, 7] },
    ],
  });
  const out = parseExtractionResponse(raw);
  assert.equal(out.claims.length, 2);
  assert.deepEqual(out.claims[0].cited_ids, [3]);
});

test("parseExtractionResponse: strips markdown code fences", () => {
  const raw = "```json\n" + JSON.stringify({ claims: [{ claim_text: "x", cited_ids: [1] }] }) + "\n```";
  const out = parseExtractionResponse(raw);
  assert.equal(out.claims.length, 1);
});

test("parseExtractionResponse: malformed -> error", () => {
  const out = parseExtractionResponse("not json at all");
  assert.equal(out.error, "malformed_json");
  assert.deepEqual(out.claims, []);
});

test("parseExtractionResponse: missing claims array -> error", () => {
  const raw = JSON.stringify({ wrong_key: [] });
  const out = parseExtractionResponse(raw);
  assert.equal(out.error, "malformed_json");
});
