// Simple token-bucket rate limiter for polite API consumption.
// Usage:
//   const limiter = new RateLimiter({ rps: 10 });
//   await limiter.take();                // blocks until a token is available
//
// Per-source script should instantiate one limiter and `await take()`
// before every outbound API call. Default burst = rps (one second of tokens).

export class RateLimiter {
  constructor({ rps, burst }) {
    this.rps = rps;
    this.burst = burst ?? rps;
    this.tokens = this.burst;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rps);
    this.lastRefill = now;
  }

  async take() {
    this._refill();
    while (this.tokens < 1) {
      const waitMs = Math.ceil((1 - this.tokens) / this.rps * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
      this._refill();
    }
    this.tokens -= 1;
  }
}
