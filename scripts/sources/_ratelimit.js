// scripts/sources/_ratelimit.js
// Concurrency-safe rate limiter: reserves each caller's slot synchronously
// (before any `await`) so that N concurrent callers are spread across N
// intervals rather than colliding in a single burst.
//
// Earlier implementation read `nextSlotAt`, awaited setTimeout, THEN updated
// `nextSlotAt` — under concurrency, all callers read the same stale value
// and woke up in the same event-loop tick. See the "spreads N concurrent
// callers across N intervals" regression test.
export function createLimiter(requestsPerSecond) {
  const intervalMs = 1000 / requestsPerSecond;
  let nextSlotAt = 0;
  return async function waitForSlot() {
    const now = Date.now();
    // Critical section: reserve this slot and advance the cursor before
    // any await. JS single-threaded semantics guarantee no other caller
    // can observe the stale nextSlotAt.
    const slotAt = Math.max(now, nextSlotAt);
    nextSlotAt = slotAt + intervalMs;
    const delay = slotAt - now;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  };
}
