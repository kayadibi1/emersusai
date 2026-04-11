// tests/unit/sources/crossref.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { crossref } from "../../../scripts/sources/crossref.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/crossref/${name}`), "utf8");
}

test("crossref.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("works-creatine.json");

  nock("https://api.crossref.org")
    .get("/works")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of crossref.fetchPapers("creatine supplementation", { target: 10 })) {
    results.push(paper);
  }

  assert.ok(results.length >= 1, "should yield at least one paper with abstract");
  for (const p of results) {
    assert.equal(p.source, "crossref");
    assert.equal(p.peerReviewed, true);
    assert.ok(p.externalId, "externalId (DOI) must be set");
    assert.ok(p.title, "title must be set");
    assert.ok(p.doi, "doi must be set");
    assert.ok(p.abstract, "abstract must be set (records without abstract are skipped)");
  }
  assert.ok(nock.isDone(), "endpoint should have been called");
});

test("crossref adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(
    listIngestionSources().find(s => s.id === "crossref"),
    "crossref should be in the ingestion registry"
  );
});
