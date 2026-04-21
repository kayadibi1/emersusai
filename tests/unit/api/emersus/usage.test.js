// tests/unit/api/emersus/usage.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { usageHandler, resolveCancelsAt } from "../../../../api/emersus/usage.js";
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

// Builds a supabase client stub that answers the profile (tier) read,
// the daily_message_counts (count) read, and the billing_events scan
// for cancellation state. billingEvents is the array returned when Pro
// users trigger the subscription-events scan.
function stubSupabase({
  tier,
  count,
  billingEvents = [],
  proUntil = null,
  subscriptionStatus = null,
  cancelAtPeriodEnd = false,
}) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select: (cols) => ({
            eq: () => ({
              maybeSingle: async () => {
                // readTier selects the 'tier' column; the usage handler
                // later selects the billing-state columns. Branch on the
                // SELECT list so one stub serves both callers.
                if (cols && /pro_until|subscription_status|cancel_at_period_end/.test(cols)) {
                  return {
                    data: { pro_until: proUntil, subscription_status: subscriptionStatus, cancel_at_period_end: cancelAtPeriodEnd },
                    error: null,
                  };
                }
                return { data: { tier }, error: null };
              },
            }),
          }),
        };
      }
      if (table === "billing_events") {
        return {
          select: () => ({
            eq: () => ({
              like: () => ({
                order: () => ({
                  limit: async () => ({ data: billingEvents, error: null }),
                }),
              }),
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

  test("free tier never exposes cancels_at (skips billing_events scan)", async () => {
    const req = { verifiedUserId: "u-free" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({ tier: "free", count: 3 }),
    });
    assert.equal(res._body.cancels_at, null);
  });

  test("pro tier surfaces cancels_at when subscription.canceled is latest", async () => {
    const req = { verifiedUserId: "u-cancel" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({
        tier: "pro",
        count: 10,
        billingEvents: [
          {
            event_type: "subscription.canceled",
            raw: { data: { current_period_end: "2026-05-20T00:00:00Z" } },
          },
          { event_type: "subscription.active", raw: { data: {} } },
        ],
      }),
    });
    assert.equal(res._body.cancels_at, "2026-05-20T00:00:00Z");
  });

  test("pro tier uses denormalized columns: renews_at when not cancelling", async () => {
    const req = { verifiedUserId: "u-renew" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({
        tier: "pro",
        count: 7,
        proUntil: "2026-05-20T17:40:55.000Z",
        subscriptionStatus: "active",
        cancelAtPeriodEnd: false,
      }),
    });
    assert.equal(res._body.renews_at, "2026-05-20T17:40:55.000Z");
    assert.equal(res._body.cancels_at, null);
    assert.equal(res._body.subscription_status, "active");
  });

  test("pro tier uses denormalized columns: cancels_at when cancel flag set", async () => {
    const req = { verifiedUserId: "u-cancel-col" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({
        tier: "pro",
        count: 7,
        proUntil: "2026-05-20T17:40:55.000Z",
        subscriptionStatus: "canceled",
        cancelAtPeriodEnd: true,
      }),
    });
    assert.equal(res._body.cancels_at, "2026-05-20T17:40:55.000Z");
    assert.equal(res._body.renews_at, null);
  });

  test("pro tier surfaces past_due status for UI banner", async () => {
    const req = { verifiedUserId: "u-past" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({
        tier: "pro",
        count: 1,
        proUntil: "2026-05-20T17:40:55.000Z",
        subscriptionStatus: "past_due",
        cancelAtPeriodEnd: false,
      }),
    });
    assert.equal(res._body.subscription_status, "past_due");
    assert.equal(res._body.renews_at, "2026-05-20T17:40:55.000Z");
  });

  test("pro tier returns null cancels_at when re-activated after cancel", async () => {
    const req = { verifiedUserId: "u-reactivated" };
    const res = mockRes();
    await usageHandler(req, res, {
      supabase: stubSupabase({
        tier: "pro",
        count: 5,
        billingEvents: [
          { event_type: "subscription.active", raw: { data: {} } },
          {
            event_type: "subscription.canceled",
            raw: { data: { current_period_end: "2026-05-20T00:00:00Z" } },
          },
        ],
      }),
    });
    assert.equal(res._body.cancels_at, null);
  });
});

describe("resolveCancelsAt", () => {
  test("empty/missing input returns null", () => {
    assert.equal(resolveCancelsAt([]), null);
    assert.equal(resolveCancelsAt(null), null);
    assert.equal(resolveCancelsAt(undefined), null);
  });

  test("latest relevant event is canceled → returns current_period_end", () => {
    const rows = [
      {
        event_type: "subscription.canceled",
        raw: { data: { current_period_end: "2026-05-01T00:00:00Z" } },
      },
    ];
    assert.equal(resolveCancelsAt(rows), "2026-05-01T00:00:00Z");
  });

  test("supports camelCase currentPeriodEnd + fallbacks", () => {
    assert.equal(
      resolveCancelsAt([
        { event_type: "subscription.canceled", raw: { data: { currentPeriodEnd: "2026-06-01" } } },
      ]),
      "2026-06-01"
    );
    assert.equal(
      resolveCancelsAt([
        { event_type: "subscription.canceled", raw: { data: { ends_at: "2026-07-01" } } },
      ]),
      "2026-07-01"
    );
  });

  test("revoked after cancel (later in time → earlier in array) → null", () => {
    const rows = [
      { event_type: "subscription.revoked", raw: { data: {} } },
      { event_type: "subscription.canceled", raw: { data: { current_period_end: "2026-05-01" } } },
    ];
    assert.equal(resolveCancelsAt(rows), null);
  });

  test("active after cancel → null (user un-canceled)", () => {
    const rows = [
      { event_type: "subscription.active", raw: { data: {} } },
      { event_type: "subscription.canceled", raw: { data: { current_period_end: "2026-05-01" } } },
    ];
    assert.equal(resolveCancelsAt(rows), null);
  });
});
