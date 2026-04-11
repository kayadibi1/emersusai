// tests/unit/jobs/fetch-feed.test.js
// Uses the real registry singleton to register test plugins, and fake
// sql/boss objects to simulate DB and job queue interactions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fetchFeedHandler } from "../../../jobs/fetch-feed.js";
import { registerDiscovery, getDiscoverySource } from "../../../scripts/sources/_registry.js";

// --- Test plugin IDs (unique so they don't clash with real adapters) ---
const TEST_PLUGIN_OK   = "test-fetch-feed-ok";
const TEST_PLUGIN_FAIL = "test-fetch-feed-fail";

// --- Generate fake items ---
function makeFakeItems(count, baseDate = new Date("2024-06-15T12:00:00Z")) {
  return Array.from({ length: count }, (_, i) => ({
    url:         `https://example.com/item-${i}`,
    title:       `Item ${i}`,
    abstract:    `Abstract for item ${i}`,
    publishedAt: new Date(baseDate.getTime() + i * 60_000), // each 1 min newer
    feedId:      TEST_PLUGIN_OK,
  }));
}

// --- Register test plugins once before all tests ---
before(() => {
  // Plugin that returns 50 items
  registerDiscovery({
    id: TEST_PLUGIN_OK,
    name: "Test OK Feed",
    kind: "rss",
    fetchNew: async () => makeFakeItems(50),
  });

  // Plugin that always throws
  registerDiscovery({
    id: TEST_PLUGIN_FAIL,
    name: "Test Failing Feed",
    kind: "rss",
    fetchNew: async () => { throw new Error("network timeout"); },
  });
});

// --- sql tag helper factory ---

/**
 * Build a fake sql template tag. Tracks all calls; each simulated table
 * response is keyed on a substring of the query template string.
 *
 * Callers can override per-table responses via the `responses` map.
 */
function makeSql({
  feedRows = null,
  consecutive_failures = 0,
  status = "active",
  source_plugin = TEST_PLUGIN_OK,
} = {}) {
  const defaultFeedRow = {
    id: TEST_PLUGIN_OK,
    status,
    source_plugin,
    url: "https://example.com/feed",
    last_item_at: null,
    consecutive_failures,
  };
  const rows = feedRows ?? [defaultFeedRow];

  const calls = [];
  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });
    // SELECT from discovery_feeds
    if (query.includes("discovery_feeds") && query.includes("SELECT")) {
      return Promise.resolve({ rows });
    }
    // All UPDATE/INSERT → success
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeBoss() {
  const sent = [];
  return {
    send: async (name, payload) => { sent.push({ name, payload }); },
    sent,
  };
}

function makeCtx(feedId) {
  const log = [];
  return {
    data: { feedId },
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("fetches 50 items → 2 classify-candidates jobs enqueued (50/25)", async () => {
  const sql  = makeSql();
  const boss = makeBoss();
  const ctx  = makeCtx(TEST_PLUGIN_OK);

  const out = await fetchFeedHandler(ctx, { sql, boss });
  assert.equal(out.itemCount, 50, "should report 50 items fetched");
  assert.equal(out.jobsEnqueued, 2, "50 items / 25 = 2 jobs");
  assert.equal(boss.sent.length, 2, "2 jobs should have been sent to boss");
  assert.equal(boss.sent[0].name, "classify-candidates");
  assert.equal(boss.sent[0].payload.items.length, 25);
  assert.equal(boss.sent[1].payload.items.length, 25);
});

test("updates watermark to newest item's publishedAt", async () => {
  const sql  = makeSql();
  const boss = makeBoss();
  const ctx  = makeCtx(TEST_PLUGIN_OK);

  await fetchFeedHandler(ctx, { sql, boss });

  // Find the UPDATE call for discovery_feeds
  const updateCall = sql.calls.find(c => c.query.includes("UPDATE discovery_feeds"));
  assert.ok(updateCall, "should have issued an UPDATE to discovery_feeds");

  // values order: [last_item_count, newestAt, feedId]
  // (consecutive_failures = 0 is a literal in the query, not a bound value)
  const newestAt = updateCall.values[1];
  assert.ok(newestAt instanceof Date, "newestAt must be a Date");
  // The newest item is item 49 = base + 49 min
  const expectedNewest = new Date(new Date("2024-06-15T12:00:00Z").getTime() + 49 * 60_000);
  assert.equal(newestAt.getTime(), expectedNewest.getTime(), "watermark must be newest item's date");
});

test("resets consecutive_failures to 0 on success", async () => {
  // Start with existing failures count of 2
  const sql  = makeSql({ consecutive_failures: 2 });
  const boss = makeBoss();
  const ctx  = makeCtx(TEST_PLUGIN_OK);

  await fetchFeedHandler(ctx, { sql, boss });

  const updateCall = sql.calls.find(c => c.query.includes("UPDATE discovery_feeds"));
  assert.ok(updateCall, "should have issued UPDATE");
  // consecutive_failures = 0 is a literal in the query template (not a bound param)
  const queryText = updateCall.query;
  assert.ok(queryText.includes("consecutive_failures"), "UPDATE should include consecutive_failures");
  // The literal 0 appears in the template string joined with "?"
  assert.ok(queryText.includes("0"), "UPDATE query should contain literal 0 for consecutive_failures reset");
});

test("plugin throws → increments consecutive_failures", async () => {
  const sql  = makeSql({ source_plugin: TEST_PLUGIN_FAIL, consecutive_failures: 0,
                         feedRows: [{
                           id: TEST_PLUGIN_FAIL, status: "active",
                           source_plugin: TEST_PLUGIN_FAIL,
                           url: "https://example.com/fail",
                           last_item_at: null, consecutive_failures: 0,
                         }] });
  const boss = makeBoss();
  const ctx  = { data: { feedId: TEST_PLUGIN_FAIL }, progress: async () => {}, log: [] };

  await assert.rejects(
    () => fetchFeedHandler(ctx, { sql, boss }),
    /network timeout/,
    "should rethrow the plugin error"
  );

  const updateCall = sql.calls.find(c => c.query.includes("UPDATE discovery_feeds"));
  assert.ok(updateCall, "should have issued UPDATE on failure");
  // new count = 0 + 1 = 1, passed as values[0]
  assert.equal(updateCall.values[0], 1, "consecutive_failures should be incremented to 1");
});

test("3rd failure → status set to disabled + warning candidate row inserted", async () => {
  const sql  = makeSql({ source_plugin: TEST_PLUGIN_FAIL, consecutive_failures: 2,
                         feedRows: [{
                           id: TEST_PLUGIN_FAIL, status: "active",
                           source_plugin: TEST_PLUGIN_FAIL,
                           url: "https://example.com/fail",
                           last_item_at: null, consecutive_failures: 2,
                         }] });
  const boss = makeBoss();
  const ctx  = { data: { feedId: TEST_PLUGIN_FAIL }, progress: async () => {}, log: [] };

  await assert.rejects(
    () => fetchFeedHandler(ctx, { sql, boss }),
    /network timeout/
  );

  const updateCall = sql.calls.find(c => c.query.includes("UPDATE discovery_feeds"));
  assert.ok(updateCall, "should have UPDATE");
  // new count = 2 + 1 = 3, should trigger disable path
  assert.equal(updateCall.values[0], 3, "consecutive_failures should become 3");

  // The CASE WHEN in the UPDATE handles disabling — check it's in the query
  assert.ok(updateCall.query.includes("CASE WHEN"), "UPDATE should include CASE WHEN for status");

  // A warning INSERT into topic_candidates should also fire
  const insertCall = sql.calls.find(c => c.query.includes("topic_candidates") && c.query.includes("INSERT"));
  assert.ok(insertCall, "should have inserted a warning topic_candidate row");
  // The topic_key should contain feed_dead_
  const topicKey = insertCall.values.find(v => typeof v === "string" && v.includes("feed_dead_"));
  assert.ok(topicKey, "warning row topic_key should contain feed_dead_");
});

test("feed with status !== active is skipped without calling plugin", async () => {
  let pluginCalled = false;
  const pausedPlugin = {
    id: "test-paused-plugin",
    name: "Paused",
    kind: "rss",
    fetchNew: async () => { pluginCalled = true; return []; },
  };
  // Register inline (won't conflict with before() plugins)
  registerDiscovery(pausedPlugin);

  const sql = makeSql({
    source_plugin: "test-paused-plugin",
    status: "paused",
    feedRows: [{
      id: "test-paused-feed", status: "paused",
      source_plugin: "test-paused-plugin",
      url: "https://example.com/paused",
      last_item_at: null, consecutive_failures: 0,
    }],
  });
  const boss = makeBoss();
  const ctx  = { data: { feedId: "test-paused-feed" }, progress: async () => {}, log: [] };

  const out = await fetchFeedHandler(ctx, { sql, boss });
  assert.equal(out.skipped, true, "should return { skipped: true }");
  assert.equal(pluginCalled, false, "plugin.fetchNew should not be called for paused feed");
});

test("unknown feed id throws SourcePermanentError", async () => {
  const sql = makeSql({ feedRows: [] }); // empty → feed not found
  const boss = makeBoss();
  const ctx  = { data: { feedId: "nonexistent-feed" }, progress: async () => {}, log: [] };

  await assert.rejects(
    () => fetchFeedHandler(ctx, { sql, boss }),
    /no discovery_feeds row/,
    "should throw with helpful message"
  );
});
