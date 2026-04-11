// tests/unit/sources/biorxiv.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { biorxiv } from "../../../scripts/sources/biorxiv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/biorxiv/${name}`), "utf8");
}

test("biorxiv.fetchPapers yields normalized IngestedPaper items matching query", async () => {
  const fixture = loadFixture("details-muscle.json");
  // Empty-collection response used to terminate all subsequent chunk requests
  const emptyResp = JSON.stringify({ messages: [{ status: "ok", total: 3, count: 0 }], collection: [] });

  // biorxiv uses date-based URLs — match any path under api.biorxiv.org.
  // The first call returns our fixture; all subsequent chunk requests get an
  // empty collection so the iterator terminates cleanly.
  nock("https://api.biorxiv.org")
    .get(/\/details\/biorxiv\//)
    .reply(200, fixture);
  nock("https://api.biorxiv.org")
    .get(/\/details\/biorxiv\//)
    .times(50)
    .reply(200, emptyResp);

  const results = [];
  // "muscle" appears in the fixture's first record title/abstract
  for await (const paper of biorxiv.fetchPapers("muscle", { target: 5 })) {
    results.push(paper);
  }

  assert.ok(results.length >= 1, "should yield at least one matching paper");
  for (const p of results) {
    assert.equal(p.source, "biorxiv");
    assert.equal(p.peerReviewed, false);
    assert.ok(p.externalId, "externalId (doi) must be set");
    assert.ok(p.title, "title must be set");
    assert.equal(p.journal, "bioRxiv");
  }
  // The first nock should be consumed; subsequent ones may or may not fire.
  nock.cleanAll();
});

test("biorxiv adapter registers itself in ingestion and discovery registries", async () => {
  const { listIngestionSources, listDiscoverySources } = await import(
    "../../../scripts/sources/_registry.js"
  );
  assert.ok(
    listIngestionSources().find(s => s.id === "biorxiv"),
    "biorxiv should be in the ingestion registry"
  );
  assert.ok(
    listDiscoverySources().find(s => s.id === "biorxiv"),
    "biorxiv should be in the discovery registry"
  );
});

test("biorxiv.fetchNew returns DiscoveredItems newer than watermark", async () => {
  const fixture = loadFixture("details-muscle.json");

  nock("https://api.biorxiv.org")
    .get(/\/details\/biorxiv\//)
    .reply(200, fixture);

  const feedRow = {
    id: "feed-biorxiv-1",
    last_item_at: null, // null watermark → return all items
  };

  const items = await biorxiv.fetchNew(feedRow);
  assert.ok(Array.isArray(items), "fetchNew should return an array");
  assert.ok(items.length > 0, "should return at least one item with null watermark");
  for (const item of items) {
    assert.ok(item.url, "url must be set");
    assert.ok(item.title !== undefined, "title must be present");
    assert.equal(item.feedId, feedRow.id);
  }
});
