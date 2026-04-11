// tests/unit/jobs/cleanup-job-progress.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupJobProgressHandler } from "../../../jobs/cleanup-job-progress.js";

// --- Helpers ---

function makeSql({ rowCount = 0 } = {}) {
  const calls = [];

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("job_progress") && query.includes("DELETE")) {
      return Promise.resolve({ rowCount, rows: [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(data = {}) {
  const log = [];
  return {
    data: { olderThanDays: 30, ...data },
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("cleanupJobProgressHandler is a function", () => {
  assert.equal(typeof cleanupJobProgressHandler, "function");
});

test("issues DELETE on job_progress with correct interval", async () => {
  const sql = makeSql({ rowCount: 5 });
  const ctx = makeCtx({ olderThanDays: 30 });

  const out = await cleanupJobProgressHandler(ctx, { sql });

  const deleteCall = sql.calls.find(c =>
    c.query.includes("job_progress") && c.query.includes("DELETE")
  );
  assert.ok(deleteCall, "should issue DELETE on job_progress");
  assert.ok(deleteCall.query.includes("now()"), "DELETE should reference now()");
  assert.ok(deleteCall.query.includes("interval"), "DELETE should use interval cast");
});

test("returns {deleted} with rowCount from DB", async () => {
  const sql = makeSql({ rowCount: 42 });
  const ctx = makeCtx({ olderThanDays: 7 });

  const out = await cleanupJobProgressHandler(ctx, { sql });

  assert.equal(out.deleted, 42);
});

test("default olderThanDays is 30", async () => {
  const sql = makeSql();
  const ctx = makeCtx({}); // no olderThanDays in payload → defaults to 30

  await cleanupJobProgressHandler(ctx, { sql });

  const deleteCall = sql.calls.find(c => c.query.includes("DELETE"));
  assert.ok(deleteCall, "should issue DELETE");
  // The value 30 should appear in the bound values (as a string)
  const has30 = deleteCall.values.some(v => v === "30" || v === 30);
  assert.ok(has30, "default olderThanDays should be 30 in the query values");
});

test("progress messages include day count", async () => {
  const sql = makeSql({ rowCount: 100 });
  const ctx = makeCtx({ olderThanDays: 14 });

  await cleanupJobProgressHandler(ctx, { sql });

  assert.ok(ctx.log.some(m => m.includes("14")), "progress should mention 14 days");
  assert.ok(ctx.log.some(m => m.includes("100") || m.includes("deleted")), "progress should report deletion");
});
