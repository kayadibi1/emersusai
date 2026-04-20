// tests/unit/api/emersus/user-rate-limit.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  readTier,
  invalidateTier,
  userRateLimit,
  _resetTierCacheForTests,
} from "../../../../api/emersus/user-rate-limit.js";

function stubSupabase(tier) {
  let calls = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls++;
            return { data: tier ? { tier } : null, error: null };
          },
        }),
      }),
    }),
    _calls: () => calls,
  };
}

describe("readTier", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("returns 'free' when profile row missing", async () => {
    const db = stubSupabase(null);
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "free");
  });

  test("returns the tier from the DB", async () => {
    const db = stubSupabase("pro");
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "pro");
  });

  test("caches for 60s — second call does not hit DB", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 1, "only one DB call for two reads");
  });

  test("invalidateTier forces a refresh", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    invalidateTier("u-1");
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 2);
  });
});

function stubSupabaseWithRpc({ tier, rpc }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tier }, error: null }),
        }),
      }),
    }),
    rpc: async () => rpc,
  };
}

function mockReqRes(userId = "u-42") {
  const headers = {};
  const res = {
    _status: 200,
    _body: null,
    setHeader: (k, v) => {
      headers[k] = String(v);
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  const req = { verifiedUserId: userId, headers: {} };
  return { req, res, headers };
}

describe("userRateLimit middleware", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("allows under the cap; sets headers + rateLimitInfo", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: {
        data: [
          {
            allowed: true,
            new_count: 3,
            day_limit: 10,
            reset_at: "2026-04-21T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res, headers } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.rateLimitInfo.tier, "free");
    assert.equal(req.rateLimitInfo.used, 3);
    assert.equal(req.rateLimitInfo.limit, 10);
    assert.equal(headers["X-RateLimit-Limit"], "10");
    assert.equal(headers["X-RateLimit-Remaining"], "7");
  });

  test("blocks at the cap with 429 + upgrade_url for Free", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: {
        data: [
          {
            allowed: false,
            new_count: 10,
            day_limit: 10,
            reset_at: "2026-04-21T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res._status, 429);
    assert.equal(res._body.error, "daily_limit_reached");
    assert.equal(res._body.tier, "free");
    assert.equal(res._body.upgrade_url, "/pricing");
  });

  test("blocks Pro with null upgrade_url", async () => {
    const db = stubSupabaseWithRpc({
      tier: "pro",
      rpc: {
        data: [
          {
            allowed: false,
            new_count: 100,
            day_limit: 100,
            reset_at: "2026-04-21T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    await mw(req, res, () => {});
    assert.equal(res._status, 429);
    assert.equal(res._body.upgrade_url, null);
  });

  test("fails open on RPC error — calls next, flags bypassed", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: null, error: { message: "connection reset" } },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.rateLimitInfo.bypassed, true);
    assert.equal(res._status, 200);
  });

  test("401 when req.verifiedUserId missing", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: [{ allowed: true }], error: null },
    });
    const mw = userRateLimit({ supabase: db });
    const { res } = mockReqRes();
    const req = { verifiedUserId: null, headers: {} };
    await mw(req, res, () => {});
    assert.equal(res._status, 401);
  });
});
