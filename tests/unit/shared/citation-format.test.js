// tests/unit/shared/citation-format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCitationUrl,
  formatCitationLabel,
  SYNTHETIC_PMID_FLOOR,
} from "../../../shared/citation-format.js";

test("SYNTHETIC_PMID_FLOOR constant is 10^10", () => {
  assert.equal(SYNTHETIC_PMID_FLOOR, 10000000000);
});

test("formatCitationUrl returns pubmed URL for pubmed source with real pmid", () => {
  const source = { source: "pubmed", pmid: 12345678 };
  assert.equal(
    formatCitationUrl(source),
    "https://pubmed.ncbi.nlm.nih.gov/12345678/"
  );
});

test("formatCitationUrl returns doi.org URL for non-pubmed source with DOI", () => {
  const source = { source: "openalex", pmid: 10000000042, doi: "10.1186/s12970-021-00412-w" };
  assert.equal(
    formatCitationUrl(source),
    "https://doi.org/10.1186/s12970-021-00412-w"
  );
});

test("formatCitationUrl prefers explicit source.url over constructed URLs", () => {
  const source = { source: "openalex", pmid: 10000000042, doi: "10.1/x", url: "https://example.org/paper" };
  assert.equal(formatCitationUrl(source), "https://example.org/paper");
});

test("formatCitationUrl returns null when pubmed source has synthetic pmid (paranoia fallback)", () => {
  const source = { source: "pubmed", pmid: 10000000042 }; // pubmed source shouldn't have synthetic pmid, but if it does, don't build a broken URL
  assert.equal(formatCitationUrl(source), null);
});

test("formatCitationUrl returns null for non-pubmed source with no DOI and no explicit url", () => {
  const source = { source: "biorxiv", pmid: 10000000042, doi: null };
  assert.equal(formatCitationUrl(source), null);
});

test("formatCitationLabel returns 'PMID N' for pubmed source with real pmid", () => {
  const source = { source: "pubmed", pmid: 12345678 };
  assert.equal(formatCitationLabel(source), "PMID 12345678");
});

test("formatCitationLabel returns '<source>: <doi>' for non-pubmed source with DOI", () => {
  const source = { source: "openalex", pmid: 10000000042, doi: "10.1186/s12970-021-00412-w" };
  assert.equal(
    formatCitationLabel(source),
    "openalex: 10.1186/s12970-021-00412-w"
  );
});

test("formatCitationLabel falls back to external_id when DOI is missing", () => {
  const source = { source: "biorxiv", pmid: 10000000042, doi: null, external_id: "2024.01.15.00042" };
  assert.equal(
    formatCitationLabel(source),
    "biorxiv: 2024.01.15.00042"
  );
});

test("formatCitationLabel returns empty string for null source", () => {
  assert.equal(formatCitationLabel(null), "");
  assert.equal(formatCitationLabel(undefined), "");
});
