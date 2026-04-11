// tests/unit/jobs/discovery-weekly.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryWeeklyHandler } from "../../../jobs/discovery-weekly.js";

function makeSql({ feedRows = [] } = {}) {
  const calls = [];
  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("discovery_feeds") && query.includes("SELECT")) {
      return Promise.resolve({ rows: feedRows });
    }
    // housekeeping UPDATE + any other queries → success
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

function makeCtx() {
  const log = [];
  return {
    data: {},
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

test("dispatches fetch-feed for each active feed", async () => {
  const feedRows = [{ id: "feed-1" }, { id: "feed-2" }, { id: "feed-3" }];
  const sql = makeSql({ feedRows });
  const boss = makeBoss();
  const ctx = makeCtx();

  const out = await discoveryWeeklyHandler(ctx, { sql, boss });

  assert.equal(out.feedsDispatched, 3);
  assert.equal(boss.sent.length, 3);
  assert.equal(boss.sent[0].name, "fetch-feed");
  assert.equal(boss.sent[0].payload.feedId, "feed-1");
  assert.equal(boss.sent[1].payload.feedId, "feed-2");
  assert.equal(boss.sent[2].payload.feedId, "feed-3");
});

test("with zero active feeds, sends nothing", async () => {
  const sql = makeSql({ feedRows: [] });
  const boss = makeBoss();
  const ctx = makeCtx();

  const out = await discoveryWeeklyHandler(ctx, { sql, boss });

  assert.equal(out.feedsDispatched, 0);
  assert.equal(boss.sent.length, 0);
});

test("issues housekeeping UPDATE for snoozed candidates", async () => {
  const sql = makeSql({ feedRows: [] });
  const boss = makeBoss();
  const ctx = makeCtx();

  await discoveryWeeklyHandler(ctx, { sql, boss });

  const updateCall = sql.calls.find(c => c.query.includes("topic_candidates") && c.query.includes("UPDATE"));
  assert.ok(updateCall, "should issue UPDATE for snoozed candidates");
  assert.ok(updateCall.query.includes("snoozed"), "UPDATE should reference 'snoozed' status");
  assert.ok(updateCall.query.includes("snooze_until"), "UPDATE should check snooze_until");
});

test("progress message includes feed count", async () => {
  const feedRows = [{ id: "feed-a" }, { id: "feed-b" }];
  const sql = makeSql({ feedRows });
  const boss = makeBoss();
  const ctx = makeCtx();

  await discoveryWeeklyHandler(ctx, { sql, boss });

  assert.ok(ctx.log.some(m => m.includes("2")), "progress should mention count");
});
