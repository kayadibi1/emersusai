// tests/unit/worker/heartbeat.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startHeartbeat, stopHeartbeat } from "../../../worker/heartbeat.js";

test("startHeartbeat writes immediately and then every interval", async (t) => {
  const writes = [];
  const fakeSql = async (strings, ...vals) => {
    writes.push(vals);
    return { rows: [] };
  };
  const handle = startHeartbeat({
    sql: fakeSql,
    workerId: "test-worker",
    intervalMs: 50,
  });
  await new Promise(r => setTimeout(r, 130));
  stopHeartbeat(handle);

  assert.ok(writes.length >= 2, `expected >=2 writes, got ${writes.length}`);
  assert.ok(writes[0].includes("test-worker"), "worker id should appear in first write");
});
