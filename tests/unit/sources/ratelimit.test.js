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

test("createLimiter spreads N concurrent callers across N intervals", async () => {
  // Regression test for the race where N concurrent awaits all read the
  // same stale nextSlotAt, sleep the same duration, and return in the
  // same ms — producing a burst of N requests instead of N requests
  // spaced across N intervals.
  const wait = createLimiter(10); // 100ms between slots
  const start = Date.now();
  const timestamps = [];

  await Promise.all(
    Array.from({ length: 5 }, async () => {
      await wait();
      timestamps.push(Date.now() - start);
    })
  );

  timestamps.sort((a, b) => a - b);
  // Call i (0-indexed) should fire at roughly i*100ms. Allow 15ms slop
  // per slot for timer noise. Reject bursts that collapse calls together.
  for (let i = 0; i < timestamps.length; i++) {
    const expected = i * 100;
    const floor = Math.max(0, expected - 15);
    assert.ok(
      timestamps[i] >= floor,
      `call ${i} fired at ${timestamps[i]}ms, expected >= ${floor}ms (target ${expected}ms)`
    );
  }
});
