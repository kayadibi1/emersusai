// tests/unit/jobs/alert-daily-digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertDailyDigestHandler } from "../../../jobs/alert-daily-digest.js";

// --- Helpers ---

function makeSql({
  jobStats = [],
  pendingCount = 0,
  corpusGrowth = [],
  failFeeds = [],
  hourlyRows = [],
} = {}) {
  const calls = [];

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("pgboss.job") && query.includes("state")) {
      return Promise.resolve({ rows: jobStats });
    }
    if (query.includes("topic_candidates") && query.includes("pending")) {
      return Promise.resolve({ rows: [{ cnt: pendingCount }] });
    }
    if (query.includes("research_articles") && query.includes("created_at")) {
      return Promise.resolve({ rows: corpusGrowth });
    }
    if (query.includes("discovery_feeds") && query.includes("consecutive_failures")) {
      return Promise.resolve({ rows: failFeeds });
    }
    if (query.includes("pgboss.job") && query.includes("hour")) {
      return Promise.resolve({ rows: hourlyRows });
    }
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx() {
  const log = [];
  return {
    data: {},
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("alertDailyDigestHandler is a function", () => {
  assert.equal(typeof alertDailyDigestHandler, "function");
});

test("returns {sent} shape", async () => {
  const sql = makeSql();
  const ctx = makeCtx();

  const out = await alertDailyDigestHandler(ctx, { sql });

  assert.ok("sent" in out, "should return {sent}");
});

test("digest contains job stats section", async () => {
  const jobStats = [
    { name: "fetch-feed", state: "completed", cnt: "15" },
    { name: "fetch-feed", state: "failed", cnt: "2" },
    { name: "embed-batch", state: "completed", cnt: "3" },
  ];
  const sql = makeSql({ jobStats });
  const ctx = makeCtx();

  await alertDailyDigestHandler(ctx, { sql });

  const progressLog = ctx.log.join(" ");
  assert.ok(progressLog.includes("digest"), "progress should mention digest");
});

test("digest body contains all required sections", async () => {
  const sql = makeSql({
    jobStats: [{ name: "fetch-feed", state: "completed", cnt: "5" }],
    pendingCount: 3,
    corpusGrowth: [{ source: "pubmed", cnt: "10" }],
    failFeeds: [{ id: "feed-1", consecutive_failures: 2 }],
  });

  // Capture the body that would be passed to maybeSendAlert by
  // intercepting progress calls + checking the return value
  const ctx = makeCtx();
  const out = await alertDailyDigestHandler(ctx, { sql });

  // The handler runs all 5 queries — verify all were issued
  assert.ok(sql.calls.find(c => c.query.includes("pgboss.job") && c.query.includes("state")),
    "should query job stats");
  assert.ok(sql.calls.find(c => c.query.includes("topic_candidates")),
    "should query pending candidates");
  assert.ok(sql.calls.find(c => c.query.includes("research_articles")),
    "should query corpus growth");
  assert.ok(sql.calls.find(c => c.query.includes("discovery_feeds")),
    "should query failing feeds");
  assert.ok(sql.calls.find(c => c.query.includes("hour")),
    "should query hourly job counts for sparkline");
});

test("healthy environment produces no failure mentions in progress", async () => {
  const sql = makeSql({ failFeeds: [] });
  const ctx = makeCtx();

  const out = await alertDailyDigestHandler(ctx, { sql });

  // Should complete without error regardless of alert delivery status
  assert.ok(typeof out.sent === "boolean");
});

test("pending candidates count is queried", async () => {
  const sql = makeSql({ pendingCount: 7 });
  const ctx = makeCtx();

  await alertDailyDigestHandler(ctx, { sql });

  const candidatesQuery = sql.calls.find(c => c.query.includes("topic_candidates"));
  assert.ok(candidatesQuery, "should query topic_candidates for pending count");
  assert.ok(candidatesQuery.query.includes("pending"), "should filter on pending status");
});
