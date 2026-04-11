// Tests for iCite URL builder + response parser.
// The real API is not hit here — we feed mock JSON bodies and verify
// extraction/filter behavior.
//
// Run: node scripts/test-icite.js

import assert from "node:assert/strict";
import {
  ICITE_ENDPOINT,
  ICITE_MAX_PMIDS_PER_REQUEST,
  buildIciteUrl,
  parseIciteResponse,
} from "./lib/icite.js";

// ── buildIciteUrl ─────────────────────────────────────────────────

{
  const url = buildIciteUrl([1, 2, 3]);
  assert.ok(url.startsWith(ICITE_ENDPOINT));
  assert.ok(url.endsWith("pmids=1,2,3"));
}
{
  // Single-element array should still work.
  assert.equal(buildIciteUrl([42]), `${ICITE_ENDPOINT}?pmids=42`);
}
assert.throws(() => buildIciteUrl([]), /non-empty/);
assert.throws(() => buildIciteUrl(null), /non-empty/);
assert.throws(() => buildIciteUrl(undefined), /non-empty/);
assert.throws(
  () => buildIciteUrl(Array.from({ length: ICITE_MAX_PMIDS_PER_REQUEST + 1 }, (_, i) => i + 1)),
  /at most/
);
// Exactly at the cap is allowed.
assert.doesNotThrow(() =>
  buildIciteUrl(Array.from({ length: ICITE_MAX_PMIDS_PER_REQUEST }, (_, i) => i + 1))
);

// ── parseIciteResponse ────────────────────────────────────────────

{
  // Healthy response with a mix of good RCRs and nulls.
  const body = {
    meta: { some: "metadata" },
    data: [
      { pmid: 100, relative_citation_ratio: 1.23 },
      { pmid: 200, relative_citation_ratio: null },      // should be filtered
      { pmid: 300, relative_citation_ratio: 4.56 },
      { pmid: 400 },                                       // missing field
      { pmid: 500, relative_citation_ratio: "2.1" },     // string number OK
    ],
  };
  const out = parseIciteResponse(body);
  assert.deepEqual(
    out,
    [
      { pmid: 100, rcr: 1.23 },
      { pmid: 300, rcr: 4.56 },
      { pmid: 500, rcr: 2.1 },
    ]
  );
}

// Defensive cases should return [] without throwing.
assert.deepEqual(parseIciteResponse(null), []);
assert.deepEqual(parseIciteResponse(undefined), []);
assert.deepEqual(parseIciteResponse({}), []);
assert.deepEqual(parseIciteResponse({ data: "not an array" }), []);
assert.deepEqual(parseIciteResponse({ data: [] }), []);
assert.deepEqual(parseIciteResponse({ data: [null, "junk", 42] }), []);
assert.deepEqual(
  parseIciteResponse({ data: [{ pmid: "not a number", relative_citation_ratio: 1 }] }),
  []
);
assert.deepEqual(
  parseIciteResponse({ data: [{ pmid: 100, relative_citation_ratio: "nope" }] }),
  []
);

console.log("icite tests: OK");
