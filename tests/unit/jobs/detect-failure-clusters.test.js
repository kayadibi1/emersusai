// tests/unit/jobs/detect-failure-clusters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFailureClustersHandler } from "../../../jobs/detect-failure-clusters.js";

// --- Helpers ---

function makeSendAlert() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); return { sent: true }; };
  fn.calls = calls;
  return fn;
}

function makeSql({ clusterRows = [], priorAlertRows = [] } = {}) {
  const calls = [];

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    // pgboss failure cluster query
    if (query.includes("pgboss.job") && query.includes("failure_count")) {
      return Promise.resolve({ rows: clusterRows });
    }
    // Check for prior alert in alert_log
    if (query.includes("alert_log") && query.includes("SELECT")) {
      return Promise.resolve({ rows: priorAlertRows });
    }
    // All INSERT / other queries → success
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(data = {}) {
  const log = [];
  return {
    data,
    progress: async (msg, level) => { log.push({ msg, level }); },
    log,
  };
}

// --- Tests ---

test("no clusters → returns {clustersDetected: 0, alertsSent: 0}", async () => {
  const sql = makeSql({ clusterRows: [] });
  const ctx = makeCtx();
  const sendAlert = makeSendAlert();

  const out = await detectFailureClustersHandler(ctx, { sql, sendAlert });

  assert.equal(out.clustersDetected, 0);
  assert.equal(out.alertsSent, 0);
  assert.equal(sendAlert.calls.length, 0, "sendAlert should not be called with no clusters");
});

test("cluster detected, no prior alert → inserts alert_log row and calls sendAlert", async () => {
  const clusterRows = [{ name: "fetch-feed", failure_count: "7" }];
  const sql = makeSql({ clusterRows, priorAlertRows: [] });
  const ctx = makeCtx();
  const sendAlert = makeSendAlert();

  const out = await detectFailureClustersHandler(ctx, { sql, sendAlert });

  assert.equal(out.clustersDetected, 1);
  assert.equal(out.alertsSent, 1, "alertsSent should be 1");
  assert.equal(sendAlert.calls.length, 1, "sendAlert should have been called once");
  assert.equal(sendAlert.calls[0].type, "failure_cluster");

  const insertCall = sql.calls.find(c =>
    c.query.includes("alert_log") && c.query.includes("INSERT")
  );
  assert.ok(insertCall, "should INSERT into alert_log");
});

test("prior alert within 1h → skips alert (cooldown)", async () => {
  const clusterRows = [{ name: "embed-batch", failure_count: "6" }];
  const priorAlertRows = [{ id: 1 }]; // prior alert exists
  const sql = makeSql({ clusterRows, priorAlertRows });
  const ctx = makeCtx();
  const sendAlert = makeSendAlert();

  const out = await detectFailureClustersHandler(ctx, { sql, sendAlert });

  assert.equal(out.clustersDetected, 1);
  assert.equal(out.alertsSent, 0, "should not send when prior alert within 1h");
  assert.equal(sendAlert.calls.length, 0, "sendAlert should not be called during cooldown");

  const insertCall = sql.calls.find(c =>
    c.query.includes("alert_log") && c.query.includes("INSERT")
  );
  assert.equal(insertCall, undefined, "should not INSERT alert_log when cooldown active");
});

test("multiple clusters, some with cooldowns", async () => {
  const clusterRows = [
    { name: "fetch-feed", failure_count: "10" },
    { name: "embed-batch", failure_count: "5" },
  ];
  let alertCheckCall = 0;
  const sendAlert = makeSendAlert();

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    if (query.includes("pgboss.job") && query.includes("failure_count")) {
      return Promise.resolve({ rows: clusterRows });
    }
    if (query.includes("alert_log") && query.includes("SELECT")) {
      alertCheckCall++;
      // First cluster: no prior alert. Second cluster: has prior alert.
      return Promise.resolve({ rows: alertCheckCall === 1 ? [] : [{ id: 1 }] });
    }
    return Promise.resolve({ rows: [] });
  };

  const ctx = makeCtx();
  const out = await detectFailureClustersHandler(ctx, { sql: tag, sendAlert });

  assert.equal(out.clustersDetected, 2);
  assert.equal(out.alertsSent, 1, "only 1 alert sent; second cluster has cooldown");
  assert.equal(sendAlert.calls.length, 1, "sendAlert called exactly once");
  assert.ok(alertCheckCall >= 2, "should check alert_log for each cluster");
});

test("queries pgboss.job with correct failure state and 10min window", async () => {
  const sql = makeSql({ clusterRows: [] });
  const ctx = makeCtx();
  const sendAlert = makeSendAlert();

  await detectFailureClustersHandler(ctx, { sql, sendAlert });

  const clusterQuery = sql.calls.find(c =>
    c.query.includes("pgboss.job") && c.query.includes("failed")
  );
  assert.ok(clusterQuery, "should query pgboss.job");
  assert.ok(clusterQuery.query.includes("10 minutes"), "should filter to last 10 minutes");
  assert.ok(clusterQuery.query.includes("5"), "should have HAVING threshold of 5");
});
