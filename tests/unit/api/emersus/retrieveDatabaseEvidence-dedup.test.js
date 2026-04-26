// tests/unit/api/emersus/retrieveDatabaseEvidence-dedup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupByDoi } from "../../../../api/emersus/retrieveDatabaseEvidence.js";

// The rows returned by retrieveDatabaseEvidence are flat objects shaped
// like { pmid, source, doi, similarity, title, ... } — dedupByDoi operates
// on that flat shape, NOT on nested {article: {...}} matches.

test("dedupByDoi keeps the highest-similarity chunk per DOI", () => {
  const rows = [
    { pmid: 1, source: "pubmed", similarity: 0.90, doi: "10.1/a" },
    { pmid: 10000000001, source: "openalex", similarity: 0.95, doi: "10.1/a" },
    { pmid: 2, source: "pubmed", similarity: 0.85, doi: "10.1/b" },
  ];

  const result = dedupByDoi(rows);

  assert.equal(result.length, 2);
  // DOI 10.1/a should be represented by the openalex version (similarity 0.95)
  const aMatch = result.find((m) => m.doi === "10.1/a");
  assert.equal(aMatch.similarity, 0.95);
  assert.equal(aMatch.source, "openalex");
  // DOI 10.1/b is unique, survives as-is
  const bMatch = result.find((m) => m.doi === "10.1/b");
  assert.equal(bMatch.similarity, 0.85);
});

test("dedupByDoi preserves rows without DOI", () => {
  const rows = [
    { pmid: 1, source: "biorxiv", similarity: 0.80, doi: null, external_id: "bx-1" },
    { pmid: 2, source: "biorxiv", similarity: 0.75, doi: null, external_id: "bx-2" },
    { pmid: 3, source: "pubmed", similarity: 0.90, doi: "10.1/c" },
  ];

  const result = dedupByDoi(rows);

  assert.equal(result.length, 3, "both null-doi rows should survive alongside the DOI row");
});

test("dedupByDoi handles empty input", () => {
  assert.deepEqual(dedupByDoi([]), []);
});

test("dedupByDoi treats empty-string doi as missing", () => {
  const rows = [
    { pmid: 1, source: "biorxiv", similarity: 0.80, doi: "" },
    { pmid: 2, source: "pubmed", similarity: 0.90, doi: "10.1/d" },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 2, "empty-string doi should be treated as no-DOI");
});

test("dedupByDoi handles missing similarity as 0", () => {
  const rows = [
    { pmid: 1, source: "pubmed", doi: "10.1/e" }, // no similarity
    { pmid: 2, source: "openalex", similarity: 0.01, doi: "10.1/e" },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 1);
  // The one with similarity 0.01 wins over the undefined (treated as 0)
  assert.equal(result[0].source, "openalex");
});

test("dedupByDoi tiebreaker uses _zerank_score when both rows have it", () => {
  // In practice when zerank runs, every surviving candidate carries a
  // _zerank_score (the rerank pool is a top-N slice, not a partial set).
  // The tiebreaker is the highest-available signal per row; for the
  // common case both rows are in the same signal class.
  const rows = [
    { pmid: 1, source: "pubmed",   doi: "10.1/y", similarity: 0.95, _zerank_score: 0.20 },
    { pmid: 2, source: "openalex", doi: "10.1/y", similarity: 0.50, _zerank_score: 0.85 },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "openalex", "higher _zerank_score wins (despite lower similarity)");
});

test("dedupByDoi collapses DOIs that differ only by case", () => {
  // Real-world Willardson 2006: Semantic Scholar stores '10.1519/R-17995.1',
  // OpenAire stores '10.1519/r-17995.1'. DOIs are case-insensitive per spec.
  const rows = [
    { pmid: 10000012023, source: "semantic-scholar", doi: "10.1519/R-17995.1", title: "A brief review", publication_year: 2006, similarity: 0.74 },
    { pmid: 10000013662, source: "openaire",         doi: "10.1519/r-17995.1", title: "A Brief Review", publication_year: 2006, similarity: 0.71 },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 1, "case-different DOIs should collapse to one");
});

test("dedupByDoi collapses cross-source duplicates by title+year when one row lacks DOI", () => {
  // Real-world Willardson 2006: PubMed has the paper with empty DOI,
  // Semantic Scholar has it with a DOI. Title+year fallback should merge them.
  const rows = [
    { pmid: 17194236,    source: "pubmed",           doi: null,             title: "A brief review: factors affecting the length of the rest interval between resistance exercise sets", publication_year: 2006, similarity: 0.78 },
    { pmid: 10000012023, source: "semantic-scholar", doi: "10.1519/R-17995.1", title: "A brief review: factors affecting the length of the rest interval between resistance exercise sets.", publication_year: 2006, similarity: 0.74 },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 1, "title+year fallback should collapse no-DOI + DOI cross-source duplicates");
  assert.equal(result[0].source, "pubmed", "higher-similarity row wins");
});

test("dedupByDoi does not collapse different papers with similar short titles", () => {
  // Title-key only triggers on titles >= 12 chars after normalization, so
  // generic short titles ("Editorial", "Errata") fall through to unkeyed.
  const rows = [
    { pmid: 1, source: "pubmed", doi: null, title: "Editorial", publication_year: 2020, similarity: 0.50 },
    { pmid: 2, source: "pubmed", doi: null, title: "Editorial", publication_year: 2020, similarity: 0.49 },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 2, "short titles should not falsely merge");
});

test("dedupByDoi: _zerank_score takes precedence over _jina_score on the same row", () => {
  // When a row carries both scores, _zerank_score is the one the
  // tiebreaker compares against the other row's score.
  const rows = [
    // pubmed: zerank 0.85, jina 0.10 → effective score 0.85
    { pmid: 1, source: "pubmed",   doi: "10.1/z", _zerank_score: 0.85, _jina_score: 0.10 },
    // openalex: jina only (0.95) → effective score 0.95
    { pmid: 2, source: "openalex", doi: "10.1/z", _jina_score: 0.95 },
  ];
  const result = dedupByDoi(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "openalex", "openalex's 0.95 jina beats pubmed's 0.85 zerank");
});
