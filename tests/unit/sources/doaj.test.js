// tests/unit/sources/doaj.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { doaj } from "../../../scripts/sources/doaj.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/doaj/${name}`), "utf8");
}

test("doaj.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("articles-creatine.json");
  // The fixture reports total=8085; after page 1 the loop would request page 2.
  // Return an empty page to terminate pagination cleanly.
  const emptyResp = JSON.stringify({ results: [], total: 3 });

  nock("https://doaj.org")
    .get(/\/api\/v2\/search\/articles\//)
    .query(true)
    .reply(200, fixture);
  nock("https://doaj.org")
    .get(/\/api\/v2\/search\/articles\//)
    .query(true)
    .times(5)
    .reply(200, emptyResp);

  const results = [];
  for await (const paper of doaj.fetchPapers("creatine", { target: 5 })) {
    results.push(paper);
  }

  assert.ok(results.length >= 1, "should yield at least one paper");
  for (const p of results) {
    assert.equal(p.source, "doaj");
    assert.equal(p.peerReviewed, true);
    assert.ok(p.externalId, "externalId (DOI) must be set");
    assert.ok(p.title, "title must be set");
    assert.ok(p.doi, "doi must be set");
  }
  nock.cleanAll();
});

test("doaj adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(
    listIngestionSources().find(s => s.id === "doaj"),
    "doaj should be in the ingestion registry"
  );
});
