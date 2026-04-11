// tests/unit/sources/openalex.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { openalex } from "../../../scripts/sources/openalex.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/openalex/${name}`), "utf8");
}

test("openalex.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("works-creatine.json");

  nock("https://api.openalex.org")
    .get("/works")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of openalex.fetchPapers("creatine", { target: 3 })) {
    results.push(paper);
  }

  assert.equal(results.length, 3);
  for (const p of results) {
    assert.equal(p.source, "openalex");
    assert.ok(p.externalId, "externalId must be set (OpenAlex work id)");
    assert.ok(p.title, "title must be set");
  }

  // First result should have DOI stripped of the "https://doi.org/" prefix
  assert.equal(results[0].doi, "10.1186/1550-2783-4-6");
  assert.equal(results[0].externalId, "W2087402540");
  assert.equal(results[0].journal, "Journal of the International Society of Sports Nutrition");
  assert.deepEqual(results[0].authors, ["Richard B. Kreider", "Chad M. Kerksick"]);
  assert.ok(results[0].abstract.includes("Creatine"), "abstract should be reconstructed from inverted index");
  assert.equal(results[0].publishedAt.getFullYear(), 2007);

  // Third result has no DOI — verify graceful null handling
  assert.equal(results[2].doi, null);

  assert.ok(nock.isDone(), "openalex /works should have been called");
});

test("openalex URL includes mailto polite-pool param when configured", async () => {
  const originalEmail = process.env.OPENALEX_POLITE_EMAIL;
  process.env.OPENALEX_POLITE_EMAIL = "info@emersus.ai";
  try {
    const fixture = loadFixture("works-creatine.json");
    let capturedQuery = null;
    nock("https://api.openalex.org")
      .get("/works")
      .query((q) => { capturedQuery = q; return true; })
      .reply(200, fixture);

    for await (const _p of openalex.fetchPapers("creatine", { target: 1 })) {
      break;
    }

    assert.equal(capturedQuery.mailto, "info@emersus.ai");
    assert.ok(capturedQuery.search.includes("creatine"));
  } finally {
    if (originalEmail === undefined) delete process.env.OPENALEX_POLITE_EMAIL;
    else process.env.OPENALEX_POLITE_EMAIL = originalEmail;
    nock.cleanAll();
  }
});

test("openalex adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "openalex"), "openalex should be in registry");
});
