// tests/unit/sources/openaire.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { openaire } from "../../../scripts/sources/openaire.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/openaire/${name}`), "utf8");
}

test("openaire.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("publications-creatine.json");

  nock("https://api.openaire.eu")
    .get("/search/publications")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of openaire.fetchPapers("creatine", { target: 2 })) {
    results.push(paper);
  }

  assert.equal(results.length, 2);
  for (const p of results) {
    assert.equal(p.source, "openaire");
    assert.ok(p.externalId, "externalId must be set");
    assert.ok(p.title, "title must be set");
  }

  assert.equal(results[0].title, "Creatine supplementation and muscle strength: a meta-analysis");
  assert.equal(results[0].doi, "10.1519/JSC.0b013e318028a73d");
  assert.equal(results[0].journal, "Journal of Strength and Conditioning Research");
  assert.deepEqual(results[0].authors, ["Branch JD", "Smith KA"]);
  assert.equal(results[0].publishedAt.getFullYear(), 2003);

  assert.ok(nock.isDone(), "openaire /search/publications should have been called");
});

test("openaire adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "openaire"), "openaire should be in registry");
});
