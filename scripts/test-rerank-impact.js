// Tests for the RCR-based impact scoring added to api/emersus/rerank.js.
// Verifies that:
//   1. scoreEvidenceImpact handles the full RCR range + null/edge cases
//   2. rankEvidence weights impact at 15% and only reorders when the
//      other signals are tied
//   3. a paper with high RCR can outrank an otherwise-identical paper
//      with median or missing RCR
//
// Run: node scripts/test-rerank-impact.js

import assert from "node:assert/strict";
import {
  scoreEvidenceImpact,
  rankEvidence,
} from "../api/emersus/rerank.js";

// ── scoreEvidenceImpact ────────────────────────────────────────────

// NULL / undefined / non-numeric → neutral (0.5). Papers too new for
// NIH to have computed RCR must not be penalized.
assert.equal(scoreEvidenceImpact(null), 0.5);
assert.equal(scoreEvidenceImpact(undefined), 0.5);
assert.equal(scoreEvidenceImpact("not a number"), 0.5);
assert.equal(scoreEvidenceImpact(NaN), 0.5);

// Median (RCR = 1.0) is exactly neutral. A huge number of papers
// cluster here so getting this right is load-bearing.
assert.equal(scoreEvidenceImpact(1), 0.5);

// Very low RCR is mildly penalized but never less than the floor.
{
  const score = scoreEvidenceImpact(0);
  assert.ok(score < 0.5, "RCR=0 should score below neutral");
  assert.ok(score >= 0.25, "RCR=0 should not score below the 0.25 floor");
}
assert.equal(scoreEvidenceImpact(-1), 0.25); // garbage input → floor

// Above-median RCR (cited more than peers) gets a boost.
{
  const rcr5 = scoreEvidenceImpact(5);
  assert.ok(rcr5 > 0.5, "RCR=5 should score above neutral");
  assert.ok(rcr5 < 1.0, "RCR=5 should not saturate");
}

// Very high RCR saturates at 1.0 so a RCR=911 outlier doesn't wreck
// the ranking scale.
assert.equal(scoreEvidenceImpact(50), 1);
assert.equal(scoreEvidenceImpact(911), 1);
assert.equal(scoreEvidenceImpact(10000), 1);

// Monotonicity: higher RCR → higher score across the full range.
{
  const rcrs = [0, 0.5, 1, 2, 5, 10, 25];
  const scores = rcrs.map(scoreEvidenceImpact);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(
      scores[i] >= scores[i - 1],
      `impact score must be monotonically non-decreasing in RCR (rcr=${rcrs[i]} got ${scores[i]} < rcr=${rcrs[i - 1]} got ${scores[i - 1]})`
    );
  }
}

// ── rankEvidence with impact ───────────────────────────────────────

function makeItem(overrides) {
  return {
    pmid: overrides.pmid,
    similarity: 0.8,
    published_at: "2024-01-15",
    evidence_level: "Randomized Controlled Trial",
    source_type: "pubmed_vector",
    rcr: null,
    ...overrides,
  };
}

// Given two otherwise-identical papers, the higher RCR one should
// rank higher.
{
  const low = makeItem({ pmid: 1, rcr: 0.1 });
  const high = makeItem({ pmid: 2, rcr: 20 });
  const ranked = rankEvidence([low, high]);
  assert.equal(
    ranked[0].pmid,
    2,
    `high-RCR paper should win when other signals tie; got order ${ranked.map((r) => r.pmid).join(",")}`
  );
}

// Impact_score is exposed on the result alongside freshness_score /
// quality_score / ranking_score so the UI can surface it.
{
  const ranked = rankEvidence([makeItem({ pmid: 1, rcr: 5 })]);
  assert.equal(typeof ranked[0].impact_score, "number");
  assert.ok(
    ranked[0].impact_score > 0.5 && ranked[0].impact_score < 1,
    `RCR=5 should give impact_score between 0.5 and 1, got ${ranked[0].impact_score}`
  );
}

// A paper with NULL rcr should score identically to one with rcr=1
// (median), since both resolve to impact 0.5 — important so that
// papers too new for an RCR aren't unfairly demoted.
{
  const missing = makeItem({ pmid: 1, rcr: null });
  const median = makeItem({ pmid: 2, rcr: 1 });
  const ranked = rankEvidence([missing, median]);
  assert.equal(
    ranked[0].ranking_score,
    ranked[1].ranking_score,
    "missing RCR should score the same as median RCR"
  );
}

// Semantic similarity still dominates: a paper with much better
// similarity should outrank a paper with high RCR but much worse
// similarity. Impact is a secondary signal (15% weight).
{
  const semanticMatch = makeItem({
    pmid: 1,
    similarity: 0.95,
    rcr: 0.5, // slightly below median
  });
  const impactMatch = makeItem({
    pmid: 2,
    similarity: 0.55, // much worse semantic match
    rcr: 100, // saturated impact
  });
  const ranked = rankEvidence([semanticMatch, impactMatch]);
  assert.equal(
    ranked[0].pmid,
    1,
    "strong semantic match must beat weak semantic match + high impact"
  );
}

// Ranking weights must sum to 1.0. We verify indirectly: construct
// an item with all components at 1.0 and confirm the score equals 1.0.
{
  const perfect = makeItem({
    pmid: 1,
    similarity: 1,
    published_at: new Date().toISOString(), // < 180 days → freshness 1.0
    evidence_level: "Systematic Review",    // → quality 1.0
    rcr: 1000,                                 // → impact 1.0
  });
  const ranked = rankEvidence([perfect]);
  assert.ok(
    Math.abs(ranked[0].ranking_score - 1) < 0.01,
    `perfect item should score ~1.0, got ${ranked[0].ranking_score}`
  );
}

console.log("rerank impact tests: OK");
