// tests/unit/api/emersus/usage.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { usageHandler } from "../../../../api/emersus/usage.js";
import { _resetTierCacheForTests } from "../../../../api/emersus/user-rate-limit.js";

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(c) {
      this._status = c;
      return this;
    },
    json(b) {
      this._body = b;
      return this;
    },
  };
}

// Builds a supabase client stub that answers both the profile (tier) read
// and the daily_message_counts (count) read through a shared chain.
function stubSupabase({ tier, count }) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { tier }, error: null }),
            }),
          }),
        };
      }
      // daily_message_counts
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: count != null ? { count } : null,
                error: null,
              }),
            }),
          }),
        }),
      };
    },
  };
}

describe("GET /api/emersus/usage", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("no row today → used=0, limit=10 for free tier", async () => {
    const req = { verifiedUserId: "u-1" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({ tier: "free", count: null }),
    });
    assert.equal(res._status, 200);
    assert.equal(res._body.tier, "free");
    assert.equal(res._body.used, 0);
    assert.equal(res._body.limit, 10);
    assert.ok(res._body.reset_at.endsWith("T00:00:00.000Z"));
  });

  test("pro tier → limit=100", async () => {
    const req = { verifiedUserId: "u-2" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({ tier: "pro", count: 42 }),
    });
    assert.equal(res._body.tier, "pro");
    assert.equal(res._body.used, 42);
    assert.equal(res._body.limit, 100);
  });

  test("401 when no verifiedUserId", async () => {
    const req = { verifiedUserId: null };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({ tier: "free", count: null }),
    });
    assert.equal(res._status, 401);
  });
});
