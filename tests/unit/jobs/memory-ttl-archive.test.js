// tests/unit/jobs/memory-ttl-archive.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryTtlArchiveHandler } from "../../../jobs/memory-ttl-archive.js";

function makeSql({ countN = 0, updated = 0 } = {}) {
  const calls = [];
  const tag = function (strings) {
    const query = strings.join("?");
    calls.push({ query });
    if (query.includes("count(*)")) {
      return Promise.resolve({ rows: [{ n: countN }] });
    }
    if (query.includes("UPDATE public.user_memories")) {
      return Promise.resolve({
        rowCount: updated,
        rows: Array.from({ length: updated }, (_, i) => ({ id: `row-${i}` })),
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(data = {}) {
  const log = [];
  return {
    data,
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

test("memoryTtlArchiveHandler is a function", () => {
  assert.equal(typeof memoryTtlArchiveHandler, "function");
});

test("returns zero when no expired rows", async () => {
  const sql = makeSql({ countN: 0 });
  const ctx = makeCtx();
  const out = await memoryTtlArchiveHandler(ctx, { sql });
  assert.equal(out.archived, 0);
  assert.equal(out.scanned, 0);
  // Did NOT issue an UPDATE
  const updateCall = sql.calls.find(c => c.query.includes("UPDATE"));
  assert.equal(updateCall, undefined);
});

test("dryRun counts but does not update", async () => {
  const sql = makeSql({ countN: 42 });
  const ctx = makeCtx({ dryRun: true });
  const out = await memoryTtlArchiveHandler(ctx, { sql });
  assert.equal(out.dryRun, true);
  assert.equal(out.scanned, 42);
  assert.equal(out.archived, 0);
  const updateCall = sql.calls.find(c => c.query.includes("UPDATE"));
  assert.equal(updateCall, undefined);
});

test("live run archives expired rows via CTE", async () => {
  const sql = makeSql({ countN: 5, updated: 5 });
  const ctx = makeCtx({});
  const out = await memoryTtlArchiveHandler(ctx, { sql });
  assert.equal(out.archived, 5);
  assert.equal(out.scanned, 5);
  const updateCall = sql.calls.find(c => c.query.includes("UPDATE"));
  assert.ok(updateCall, "UPDATE fired");
  assert.ok(updateCall.query.includes("status = 'archived'"), "sets archived");
  assert.ok(updateCall.query.includes("resolved_at = now()"), "stamps resolved_at");
  assert.ok(updateCall.query.includes("expires_at < now()"), "filters on expires_at");
});

test("respects custom limit", async () => {
  const sql = makeSql({ countN: 10, updated: 3 });
  const ctx = makeCtx({ limit: 3 });
  const out = await memoryTtlArchiveHandler(ctx, { sql });
  assert.equal(out.archived, 3);
  assert.equal(out.scanned, 10);
});
