// tests/unit/sources/ratelimit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../../../scripts/sources/_ratelimit.js";

test("createLimiter paces requests to the given RPS", async () => {
  const wait = createLimiter(10); // 10 RPS -> 100ms between slots
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await wait();
  const elapsed = Date.now() - t0;
  // First call is immediate; next two are ~100ms each. Allow slop.
  assert.ok(elapsed >= 180, `expected >=180ms, got ${elapsed}`);
  assert.ok(elapsed < 400, `expected <400ms, got ${elapsed}`);
});
