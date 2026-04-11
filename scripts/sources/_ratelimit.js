// scripts/sources/_ratelimit.js
// Simple token-bucket-ish limiter: enforces a minimum interval between
// successive awaits. Each source plugin creates one limiter at import time.
export function createLimiter(requestsPerSecond) {
  const intervalMs = 1000 / requestsPerSecond;
  let nextSlotAt = 0;
  return async function waitForSlot() {
    const now = Date.now();
    if (now < nextSlotAt) {
      await new Promise(r => setTimeout(r, nextSlotAt - now));
    }
    nextSlotAt = Math.max(now, nextSlotAt) + intervalMs;
  };
}
