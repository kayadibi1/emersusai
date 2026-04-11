// Tests for Semantic Scholar batch URL/body builders and response parser.
//
// Run: node scripts/test-semantic-scholar.js

import assert from "node:assert/strict";
import {
  S2_BATCH_ENDPOINT,
  S2_MAX_IDS_PER_REQUEST,
  buildSemanticScholarBatchUrl,
  buildSemanticScholarBatchBody,
  parseSemanticScholarResponse,
} from "./lib/semantic-scholar.js";

// ── buildSemanticScholarBatchUrl ──────────────────────────────────

{
  const url = buildSemanticScholarBatchUrl();
  assert.ok(url.startsWith(S2_BATCH_ENDPOINT));
  assert.ok(url.includes("citationCount"));
  assert.ok(url.includes("influentialCitationCount"));
  assert.ok(url.includes("externalIds"));
}

// ── buildSemanticScholarBatchBody ─────────────────────────────────

{
  const body = buildSemanticScholarBatchBody([123, 456, 789]);
  assert.deepEqual(body, {
    ids: ["PMID:123", "PMID:456", "PMID:789"],
  });
}
assert.throws(() => buildSemanticScholarBatchBody([]), /non-empty/);
assert.throws(() => buildSemanticScholarBatchBody(null), /non-empty/);
assert.throws(
  () =>
    buildSemanticScholarBatchBody(
      Array.from({ length: S2_MAX_IDS_PER_REQUEST + 1 }, (_, i) => i)
    ),
  /at most/
);
// Exactly at the cap should be allowed.
assert.doesNotThrow(() =>
  buildSemanticScholarBatchBody(
    Array.from({ length: S2_MAX_IDS_PER_REQUEST }, (_, i) => i)
  )
);

// ── parseSemanticScholarResponse ──────────────────────────────────

{
  const body = [
    {
      paperId: "abc",
      externalIds: { PubMed: "111" },
      citationCount: 42,
      influentialCitationCount: 5,
    },
    null, // paper not found
    {
      paperId: "def",
      externalIds: { PubMed: "222" },
      citationCount: 0,
      influentialCitationCount: 0,
    },
    {
      paperId: "ghi",
      externalIds: { PubMed: "333" },
      citationCount: 10,
      // influentialCitationCount missing — should map to null
    },
  ];
  const out = parseSemanticScholarResponse(body);
  assert.deepEqual(out, [
    { pmid: 111, citation_count: 42, influential_citation_count: 5 },
    { pmid: 222, citation_count: 0, influential_citation_count: 0 },
    { pmid: 333, citation_count: 10, influential_citation_count: null },
  ]);
}

// Defensive: entries without externalIds or without PubMed id are dropped.
{
  const body = [
    { paperId: "xyz", citationCount: 5 }, // no externalIds
    { paperId: "xyz", externalIds: {}, citationCount: 5 }, // no PubMed
    { paperId: "xyz", externalIds: { DOI: "10.1" }, citationCount: 5 }, // PubMed missing
  ];
  assert.deepEqual(parseSemanticScholarResponse(body), []);
}

// Entries without citationCount are dropped (S2 sometimes returns
// papers with no count yet).
{
  const body = [
    {
      paperId: "q",
      externalIds: { PubMed: "444" },
      citationCount: null,
      influentialCitationCount: 1,
    },
  ];
  assert.deepEqual(parseSemanticScholarResponse(body), []);
}

// Defensive: non-array inputs produce empty output without throwing.
assert.deepEqual(parseSemanticScholarResponse(null), []);
assert.deepEqual(parseSemanticScholarResponse(undefined), []);
assert.deepEqual(parseSemanticScholarResponse({}), []);
assert.deepEqual(parseSemanticScholarResponse("not json"), []);

console.log("semantic-scholar tests: OK");
