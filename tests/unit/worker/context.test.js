// tests/unit/worker/context.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "../../../worker/context.js";

test("makeContext exposes data, signal, progress, abort", () => {
  const inserts = [];
  const fakeSql = async (strings, ...vals) => {
    inserts.push({ strings: strings.join("?"), vals });
    return { rows: [] };
  };
  const jobRow = { id: "job-1", data: { limit: 10 } };
  const ctx = makeContext(jobRow, fakeSql);

  assert.deepEqual(ctx.data, { limit: 10 });
  assert.equal(typeof ctx.abort, "function");
  assert.equal(ctx.signal.aborted, false);

  ctx.abort();
  assert.equal(ctx.signal.aborted, true);
});

test("progress() inserts into job_progress via the sql tag", async () => {
  const inserts = [];
  const fakeSql = async (strings, ...vals) => {
    inserts.push({ strings: strings.join("?"), vals });
    return { rows: [] };
  };
  const ctx = makeContext({ id: "job-2", data: {} }, fakeSql);

  await ctx.progress("hello");
  await ctx.progress("warning!", "warn");

  assert.equal(inserts.length, 2);
  assert.match(inserts[0].strings, /INSERT INTO job_progress/);
  assert.deepEqual(inserts[0].vals, ["job-2", "info", "hello"]);
  assert.deepEqual(inserts[1].vals, ["job-2", "warn", "warning!"]);
});
