// tests/unit/api/emersus/pipeline/anchor-verify.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForSubstring, verifyAnchor } from "../../../../../api/emersus/pipeline/anchor-verify.js";

test("normalize lowercases", () => {
  assert.equal(normalizeForSubstring("Trained Men"), "trained men");
});

test("normalize collapses whitespace", () => {
  assert.equal(normalizeForSubstring("  trained\nmen  "), "trained men");
});

test("normalize unifies '5 g' / '5g' / '5 grams'", () => {
  assert.equal(normalizeForSubstring("5 g"), "5g");
  assert.equal(normalizeForSubstring("5g"), "5g");
  assert.equal(normalizeForSubstring("5 grams"), "5g");
  assert.equal(normalizeForSubstring("5  G"), "5g");
});

test("normalize unifies week/wk", () => {
  assert.equal(normalizeForSubstring("8 weeks"), "8wk");
  assert.equal(normalizeForSubstring("8 wk"), "8wk");
  assert.equal(normalizeForSubstring("eight weeks"), "8wk");
  assert.equal(normalizeForSubstring("twelve wk"), "12wk");
});

test("normalize converts number-words up to twenty", () => {
  assert.equal(normalizeForSubstring("twenty subjects"), "20 subjects");
});

test("normalize handles null/undefined", () => {
  assert.equal(normalizeForSubstring(null), "");
  assert.equal(normalizeForSubstring(undefined), "");
});

const SCOPE = {
  chunk: "Creatine 5g per day for 8 weeks improved 1RM",
  full_text: "Resistance-trained men aged 20-25 received creatine 5 g per day for 8 weeks. Bench press 1RM rose by 6.8%.",
  abstract: "RCT in trained men of creatine supplementation",
};

test("verifyAnchor FAIL when source_quote is null", async () => {
  const r = await verifyAnchor(
    { text: "5g/day", source_quote: null, attributed_source_id: 1 },
    SCOPE,
    { judge: null },
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.scope_actually_matched, null);
});

test("verifyAnchor PASS_VERBATIM via chunk scope", async () => {
  const r = await verifyAnchor(
    { text: "5g/day", source_quote: "5g per day", attributed_source_id: 1 },
    SCOPE,
    { judge: null },
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "chunk");
});

test("verifyAnchor PASS_VERBATIM via full_text when chunk lacks the anchor", async () => {
  const r = await verifyAnchor(
    { text: "trained men", source_quote: "resistance-trained men", attributed_source_id: 1 },
    SCOPE,
    { judge: null },
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "full_text");
});

test("verifyAnchor PASS_VERBATIM via abstract when neither chunk nor full_text matches", async () => {
  const r = await verifyAnchor(
    { text: "RCT", source_quote: "RCT", attributed_source_id: 1 },
    { chunk: "no methods info", full_text: "results section only", abstract: "RCT in trained men" },
    { judge: null },
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "abstract");
});

test("verifyAnchor substring is case + unit normalized", async () => {
  const r = await verifyAnchor(
    { text: "8 weeks", source_quote: "EIGHT WEEKS", attributed_source_id: 1 },
    SCOPE,
    { judge: null },
  );
  assert.equal(r.result, "PASS_VERBATIM");
});

test("verifyAnchor FAIL when not found anywhere and no judge configured", async () => {
  const r = await verifyAnchor(
    { text: "12 weeks", source_quote: "12 weeks", attributed_source_id: 1 },
    SCOPE,
    { judge: null },
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.scope_actually_matched, null);
});

test("verifyAnchor PASS_JUDGED when substring fails but judge passes", async () => {
  const mockJudge = async () => ({
    passes: true,
    scope_used: "full_text",
    raw_response: "Yes, source states '6.8% improvement' which '7%' rounds to.",
    matched_quote: "6.8% improvement",
  });
  const r = await verifyAnchor(
    { text: "7%", source_quote: "7%", attributed_source_id: 1 },
    { chunk: "no number here", full_text: "creatine improved 1RM by 6.8%", abstract: "" },
    { judge: mockJudge },
  );
  assert.equal(r.result, "PASS_JUDGED");
  assert.equal(r.scope_actually_matched, "full_text");
  assert.ok(r.judge_response.matched_quote);
});

test("verifyAnchor FAIL when both substring and judge fail", async () => {
  const mockJudge = async () => ({ passes: false, raw_response: "No, source does not state this." });
  const r = await verifyAnchor(
    { text: "12 wk", source_quote: "12 weeks", attributed_source_id: 1 },
    { chunk: "8 weeks duration", full_text: null, abstract: null },
    { judge: mockJudge },
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.judge_response.passes, false);
});

test("verifyAnchor treats judge errors as FAIL with metadata", async () => {
  const mockJudge = async () => { throw new Error("judge timeout"); };
  const r = await verifyAnchor(
    { text: "7%", source_quote: "7%", attributed_source_id: 1 },
    { chunk: "no number", full_text: null, abstract: null },
    { judge: mockJudge },
  );
  assert.equal(r.result, "FAIL");
  assert.match(r.judge_response.error || "", /timeout/);
});

import { parseAnchorExtractionResponse } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("anchor parser handles well-formed JSON", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"5g/day","kind_hint":"dose","attributed_source_id":2,"source_quote":"5 g per day","scope_used":"chunk"}]}');
  assert.equal(r.anchors.length, 1);
  assert.equal(r.anchors[0].kind_hint, "dose");
  assert.equal(r.anchors[0].scope_used, "chunk");
});

test("anchor parser tolerates ```json``` fences", () => {
  const r = parseAnchorExtractionResponse('```json\n{"anchors":[]}\n```');
  assert.equal(r.error, null);
  assert.equal(r.anchors.length, 0);
});

test("anchor parser rejects malformed JSON", () => {
  const r = parseAnchorExtractionResponse("not json");
  assert.equal(r.error, "malformed_json");
});

test("anchor parser drops anchors without text", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"","kind_hint":"dose"},{"text":"5g","kind_hint":"dose","attributed_source_id":1,"source_quote":"5g","scope_used":"chunk"}]}');
  assert.equal(r.anchors.length, 1);
});

test("anchor parser nullifies invalid scope_used", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"5g","kind_hint":"dose","attributed_source_id":1,"source_quote":"5g","scope_used":"made_up"}]}');
  assert.equal(r.anchors[0].scope_used, null);
});

test("anchor parser coerces unknown kind_hint to 'other'", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"5g","kind_hint":"flux_capacitor","attributed_source_id":1,"source_quote":"5g","scope_used":"chunk"}]}');
  assert.equal(r.anchors[0].kind_hint, "other");
});

test("anchor parser nullifies scope_used when source_quote is null", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"12 wk","kind_hint":"duration","attributed_source_id":1,"source_quote":null,"scope_used":"chunk"}]}');
  assert.equal(r.anchors[0].source_quote, null);
  assert.equal(r.anchors[0].scope_used, null);
});
