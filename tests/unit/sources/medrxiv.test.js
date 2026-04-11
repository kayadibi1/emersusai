// tests/unit/sources/medrxiv.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { medrxiv } from "../../../scripts/sources/medrxiv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/medrxiv/${name}`), "utf8");
}

test("medrxiv.fetchPapers yields normalized IngestedPaper items matching query", async () => {
  const fixture = loadFixture("details-rehab.json");
  const emptyResp = JSON.stringify({ messages: [{ status: "ok", total: 3, count: 0 }], collection: [] });

  // First call returns the fixture; all subsequent chunk requests get an empty collection.
  nock("https://api.biorxiv.org")
    .get(/\/details\/medrxiv\//)
    .reply(200, fixture);
  nock("https://api.biorxiv.org")
    .get(/\/details\/medrxiv\//)
    .times(50)
    .reply(200, emptyResp);

  const results = [];
  // "rehabilitation" (stem "rehabilit") appears in the fixture's first record
  for await (const paper of medrxiv.fetchPapers("rehabilitation", { target: 5 })) {
    results.push(paper);
  }

  assert.ok(results.length >= 1, "should yield at least one matching paper");
  for (const p of results) {
    assert.equal(p.source, "medrxiv");
    assert.equal(p.peerReviewed, false);
    assert.ok(p.externalId, "externalId (doi) must be set");
    assert.ok(p.title, "title must be set");
    assert.equal(p.journal, "medRxiv");
  }
  nock.cleanAll();
});

test("medrxiv adapter registers itself in ingestion and discovery registries", async () => {
  const { listIngestionSources, listDiscoverySources } = await import(
    "../../../scripts/sources/_registry.js"
  );
  assert.ok(
    listIngestionSources().find(s => s.id === "medrxiv"),
    "medrxiv should be in the ingestion registry"
  );
  assert.ok(
    listDiscoverySources().find(s => s.id === "medrxiv"),
    "medrxiv should be in the discovery registry"
  );
});

test("medrxiv.fetchNew returns DiscoveredItems newer than watermark", async () => {
  const fixture = loadFixture("details-rehab.json");

  nock("https://api.biorxiv.org")
    .get(/\/details\/medrxiv\//)
    .reply(200, fixture);

  const feedRow = {
    id: "feed-medrxiv-1",
    last_item_at: null,
  };

  const items = await medrxiv.fetchNew(feedRow);
  assert.ok(Array.isArray(items), "fetchNew should return an array");
  assert.ok(items.length > 0, "should return at least one item with null watermark");
  for (const item of items) {
    assert.ok(item.url, "url must be set");
    assert.ok(item.title !== undefined, "title must be present");
    assert.equal(item.feedId, feedRow.id);
  }
});
