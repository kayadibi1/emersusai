// tests/unit/sources/europepmc.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { europepmc } from "../../../scripts/sources/europepmc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/europepmc/${name}`), "utf8");
}

test("europepmc.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("search-creatine.json");

  nock("https://www.ebi.ac.uk")
    .get("/europepmc/webservices/rest/search")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of europepmc.fetchPapers("creatine", { target: 3 })) {
    results.push(paper);
    if (results.length >= 3) break;
  }

  assert.ok(results.length > 0, "should yield at least one result");
  for (const p of results) {
    assert.equal(p.source, "europepmc");
    assert.equal(p.peerReviewed, true);
    assert.ok(p.externalId, "externalId must be set (pmid or doi)");
    assert.ok(p.title, "title must be set");
  }
  assert.ok(nock.isDone(), "endpoint should have been called");
});

test("europepmc adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(
    listIngestionSources().find(s => s.id === "europepmc"),
    "europepmc should be in the ingestion registry"
  );
});
