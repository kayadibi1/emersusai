// Tests for sectionsToChunks(), the pure helper that turns a
// structured abstract jsonb object into an array of evidence_chunks
// rows keyed by section type.
//
// Run: node scripts/test-abstract-sections-chunks.js

import assert from "node:assert/strict";
import {
  sectionsToChunks,
  normalizeSectionLabel,
} from "./lib/abstract-sections-chunks.js";

// ── normalizeSectionLabel ─────────────────────────────────────────

// Canonical labels map to the expected chunk types.
assert.equal(normalizeSectionLabel("BACKGROUND"), "abstract_background");
assert.equal(normalizeSectionLabel("background"), "abstract_background");
assert.equal(normalizeSectionLabel("  Background  "), "abstract_background");
assert.equal(normalizeSectionLabel("INTRODUCTION"), "abstract_background");
assert.equal(normalizeSectionLabel("PURPOSE"), "abstract_background");
assert.equal(normalizeSectionLabel("AIM"), "abstract_background");
assert.equal(normalizeSectionLabel("AIMS"), "abstract_background");
assert.equal(normalizeSectionLabel("OBJECTIVE"), "abstract_background");
assert.equal(normalizeSectionLabel("OBJECTIVES"), "abstract_background");

assert.equal(normalizeSectionLabel("METHODS"), "abstract_methods");
assert.equal(normalizeSectionLabel("METHOD"), "abstract_methods");
assert.equal(normalizeSectionLabel("METHODOLOGY"), "abstract_methods");
assert.equal(normalizeSectionLabel("DESIGN"), "abstract_methods");
assert.equal(normalizeSectionLabel("PATIENTS AND METHODS"), "abstract_methods");
assert.equal(normalizeSectionLabel("STUDY DESIGN"), "abstract_methods");

assert.equal(normalizeSectionLabel("RESULTS"), "abstract_results");
assert.equal(normalizeSectionLabel("FINDINGS"), "abstract_results");
assert.equal(normalizeSectionLabel("OUTCOMES"), "abstract_results");

assert.equal(normalizeSectionLabel("CONCLUSIONS"), "abstract_conclusions");
assert.equal(normalizeSectionLabel("CONCLUSION"), "abstract_conclusions");
assert.equal(normalizeSectionLabel("INTERPRETATION"), "abstract_conclusions");
assert.equal(normalizeSectionLabel("DISCUSSION"), "abstract_conclusions");

// Unknown labels fall through to abstract_other.
assert.equal(normalizeSectionLabel("GARBAGE"), "abstract_other");
assert.equal(normalizeSectionLabel(""), "abstract_other");
assert.equal(normalizeSectionLabel(null), "abstract_other");

// ── sectionsToChunks ──────────────────────────────────────────────

// Standard BMRC abstract.
{
  const sections = {
    BACKGROUND: "Creatine is a popular ergogenic aid.",
    METHODS: "We enrolled 40 resistance-trained men in a double-blind RCT.",
    RESULTS: "The creatine group gained 8.2% more strength (p<0.01).",
    CONCLUSIONS: "Creatine supplementation improved strength outcomes.",
  };
  const chunks = sectionsToChunks(sections, 1200);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].chunk_type, "abstract_background");
  assert.ok(chunks[0].content.includes("ergogenic aid"));
  assert.equal(chunks[1].chunk_type, "abstract_methods");
  assert.equal(chunks[2].chunk_type, "abstract_results");
  assert.ok(chunks[2].content.includes("8.2%"));
  assert.equal(chunks[3].chunk_type, "abstract_conclusions");
}

// Non-canonical labels still produce chunks, bucketed to abstract_other.
{
  const sections = {
    "KEY POINTS": "This is important.",
    "FUNDING": "Supported by NIH grant R01-XYZ.",
    RESULTS: "Things happened.",
  };
  const chunks = sectionsToChunks(sections, 1200);
  assert.equal(chunks.length, 3);
  const types = chunks.map((c) => c.chunk_type).sort();
  assert.deepEqual(types, [
    "abstract_other",
    "abstract_other",
    "abstract_results",
  ]);
}

// Empty / whitespace-only sections get skipped.
{
  const sections = {
    BACKGROUND: "   ",
    METHODS: "",
    RESULTS: "Real results text.",
    CONCLUSIONS: null,
  };
  const chunks = sectionsToChunks(sections, 1200);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "abstract_results");
}

// Long section gets split into multiple chunks, all keeping the same
// type. Each chunk must stay under the length budget.
{
  const longResults = "Finding one. ".repeat(200); // ~2600 chars
  const sections = { RESULTS: longResults };
  const chunks = sectionsToChunks(sections, 1200);
  assert.ok(chunks.length >= 2, `expected >=2 chunks for long section, got ${chunks.length}`);
  for (const c of chunks) {
    assert.equal(c.chunk_type, "abstract_results");
    assert.ok(c.content.length <= 1200, `chunk too long: ${c.content.length}`);
  }
}

// If two labels normalize to the same type, both contribute — order
// preserved from the original object.
{
  const sections = {
    AIM: "Aim text.",
    PURPOSE: "Purpose text.",
    RESULTS: "Results text.",
  };
  const chunks = sectionsToChunks(sections, 1200);
  const bg = chunks.filter((c) => c.chunk_type === "abstract_background");
  assert.equal(bg.length, 2);
  assert.equal(bg[0].content, "Aim text.");
  assert.equal(bg[1].content, "Purpose text.");
}

// Defensive: non-object input returns [].
assert.deepEqual(sectionsToChunks(null, 1200), []);
assert.deepEqual(sectionsToChunks(undefined, 1200), []);
assert.deepEqual(sectionsToChunks("not an object", 1200), []);
assert.deepEqual(sectionsToChunks([], 1200), []);
assert.deepEqual(sectionsToChunks({}, 1200), []);

console.log("abstract-sections-chunks tests: OK");
