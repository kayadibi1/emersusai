// tests/unit/sources/sportrxiv.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { sportrxiv } from "../../../scripts/sources/sportrxiv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/sportrxiv/${name}`), "utf8");
}

test("sportrxiv.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("osf-nodes.json");

  nock("https://api.osf.io")
    .get(/\/v2\/preprints\//)
    .query(true)
    .reply(200, fixture);

  const results = [];
  // Use a term broad enough to match; OSF fixture has sports/kinematic titles
  for await (const paper of sportrxiv.fetchPapers("jump", { target: 5 })) {
    results.push(paper);
  }

  assert.ok(results.length >= 1, "should yield at least one matching paper");
  for (const p of results) {
    assert.equal(p.source, "sportrxiv");
    assert.equal(p.peerReviewed, false);
    assert.ok(p.externalId, "externalId (OSF id) must be set");
    assert.ok(p.title, "title must be set");
    assert.equal(p.journal, "SportRxiv");
    assert.deepEqual(p.authors, [], "authors are empty in v1 (no secondary fetch)");
  }
  assert.ok(nock.isDone(), "endpoint should have been called");
});

test("sportrxiv adapter registers itself in ingestion and discovery registries", async () => {
  const { listIngestionSources, listDiscoverySources } = await import(
    "../../../scripts/sources/_registry.js"
  );
  assert.ok(
    listIngestionSources().find(s => s.id === "sportrxiv"),
    "sportrxiv should be in the ingestion registry"
  );
  assert.ok(
    listDiscoverySources().find(s => s.id === "sportrxiv"),
    "sportrxiv should be in the discovery registry"
  );
});

test("sportrxiv.fetchNew returns DiscoveredItems newer than watermark", async () => {
  const fixture = loadFixture("osf-nodes.json");

  nock("https://api.osf.io")
    .get(/\/v2\/preprints\//)
    .query(true)
    .reply(200, fixture);

  const feedRow = {
    id: "feed-sportrxiv-1",
    url: null,
    last_item_at: null,
  };

  const items = await sportrxiv.fetchNew(feedRow);
  assert.ok(Array.isArray(items), "fetchNew should return an array");
  assert.ok(items.length > 0, "should return items with null watermark");
  for (const item of items) {
    assert.ok(item.url, "url must be set");
    assert.ok(item.title !== undefined, "title must be present");
    assert.equal(item.feedId, feedRow.id);
  }
});
