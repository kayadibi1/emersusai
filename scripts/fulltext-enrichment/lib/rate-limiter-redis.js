// Cross-process token-bucket rate limiter backed by Redis.
//
// Why Redis: phase2f-supervisor spawns N parallel shards (or two manual
// instances do the same). The in-process RateLimiter is per-process, so 5
// shards × 10 RPS = 50 RPS to CORE — instant 429 cascade and silent signal
// loss as the script marks throttled rows phase2f_exhausted. A shared bucket
// keeps the cluster total under the upstream's RPS budget.
//
// Algorithm: classic token bucket via atomic Lua script. One Redis round-trip
// per take() in the common case; on starvation the caller sleeps and retries.
//
// API matches the in-memory RateLimiter:
//   const limiter = getRateLimiter('core', { rps: 10 });
//   await limiter.take();
//
// Falls back to in-memory if REDIS_URL is unset or Redis is unreachable —
// callers don't need to special-case that path.

import Redis from 'ioredis';
import { RateLimiter } from './rate-limiter.js';

const TAKE_LUA = `
local key = KEYS[1]
local rps = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens = tonumber(data[1])
local last_ms = tonumber(data[2])
if tokens == nil then tokens = burst end
if last_ms == nil then last_ms = now_ms end

local elapsed_ms = now_ms - last_ms
if elapsed_ms < 0 then elapsed_ms = 0 end
tokens = math.min(burst, tokens + (elapsed_ms / 1000.0) * rps)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
  redis.call('PEXPIRE', key, 60000)
  return 0
end

local wait_ms = math.ceil((1 - tokens) / rps * 1000)
return wait_ms
`;

let _redis = null;
let _redisFailed = false;

function getRedis() {
  if (_redisFailed) return null;
  if (_redis) return _redis;
  if (!process.env.REDIS_URL) {
    _redisFailed = true;
    console.warn('[rate-limiter-redis] REDIS_URL not set, falling back to in-memory limiter');
    return null;
  }
  try {
    _redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      // enableOfflineQueue: true (default) — short queue while connection
      // initializes prevents the first dozen calls from failing on cold start.
      // If Redis is genuinely down, maxRetriesPerRequest=2 caps per-command
      // wait at ~200ms before falling back to in-memory.
    });
    _redis.on('error', (err) => {
      // Swallow recurring connection errors; the eval call will throw if Redis
      // is genuinely down and we'll fall back per-call.
      if (!_redisFailed) {
        console.warn(`[rate-limiter-redis] redis error: ${err.code || err.message}`);
      }
    });
  } catch (err) {
    console.warn(`[rate-limiter-redis] init failed (${err.message}), falling back to in-memory`);
    _redisFailed = true;
    return null;
  }
  return _redis;
}

class RedisRateLimiter {
  constructor({ key, rps, burst }) {
    this.key = `rl:${key}`;
    this.rps = rps;
    this.burst = burst ?? rps;
    this.fallback = new RateLimiter({ rps: this.rps, burst: this.burst });
  }

  async take() {
    const redis = getRedis();
    if (!redis) return this.fallback.take();

    while (true) {
      let waitMs;
      try {
        waitMs = await redis.eval(TAKE_LUA, 1, this.key, this.rps, this.burst, Date.now());
      } catch (err) {
        // Redis hiccup → degrade to in-memory for this request. Don't lose work.
        console.warn(`[rate-limiter-redis] eval failed for ${this.key}: ${err.message}`);
        return this.fallback.take();
      }
      const wait = Number(waitMs);
      if (wait === 0) return;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const _limiters = new Map();

// Singleton per key — adapter modules can call this at module scope.
export function getRateLimiter(key, opts) {
  const cached = _limiters.get(key);
  if (cached) return cached;
  const limiter = new RedisRateLimiter({ key, ...opts });
  _limiters.set(key, limiter);
  return limiter;
}

// For tests + clean shutdown.
export async function closeRedis() {
  if (_redis) {
    await _redis.quit().catch(() => {});
    _redis = null;
  }
}
