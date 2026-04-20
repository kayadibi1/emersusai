// tests/unit/api/billing/webhook.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleVerifiedEvent } from "../../../../api/billing/webhook.js";

function stubSupabase() {
  const state = {
    billingEventsInserted: [],
    profileUpdates: [],
    billingEventsConflict: false,
  };
  const supabase = {
    from(table) {
      if (table === "billing_events") {
        return {
          insert(row) {
            if (state.billingEventsConflict) {
              return { error: { code: "23505", message: "duplicate key" } };
            }
            state.billingEventsInserted.push(row);
            return { error: null };
          },
        };
      }
      if (table === "profiles") {
        return {
          update(patch) {
            return {
              eq: (col, val) => {
                state.profileUpdates.push({ patch, col, val });
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, state };
}

function evt({ type, userId = "u-99", subStatus = "active", subId = "sub_1" }) {
  return {
    type,
    data: {
      id: subId,
      status: subStatus,
      metadata: { user_id: userId },
      customer: { external_customer_id: userId },
    },
  };
}

function mkOpts(overrides = {}) {
  return {
    externalId: `evt_hdr_${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

describe("handleVerifiedEvent", () => {
  test("external_id uses webhook-id header when provided", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      evt({ type: "subscription.active", userId: "u-h" }),
      { supabase, invalidateTier: () => {}, externalId: "msg_abc123" }
    );
    assert.equal(state.billingEventsInserted[0].external_id, "msg_abc123");
  });

  test("external_id falls back to type:resource_id when header missing", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      evt({ type: "subscription.active", userId: "u-h2", subId: "sub_xyz" }),
      { supabase, invalidateTier: () => {} }
    );
    // Never null — would violate NOT NULL otherwise.
    assert.equal(state.billingEventsInserted[0].external_id, "subscription.active:sub_xyz");
  });

  test("subscription.active → tier='pro' + billing_events row", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.active", userId: "u-1" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    assert.equal(state.billingEventsInserted.length, 1);
    assert.equal(state.billingEventsInserted[0].user_id, "u-1");
    assert.equal(state.billingEventsInserted[0].event_type, "subscription.active");
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "pro" }, col: "id", val: "u-1" },
    ]);
    assert.deepEqual(invalidated, ["u-1"]);
  });

  test("subscription.revoked → tier='free'", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.revoked", userId: "u-2", subStatus: "revoked" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "free" }, col: "id", val: "u-2" },
    ]);
    assert.deepEqual(invalidated, ["u-2"]);
  });

  test("subscription.canceled does NOT change tier (access until period end)", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.canceled", userId: "u-3", subStatus: "canceled" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    // billing_events row still written for audit
    assert.equal(state.billingEventsInserted.length, 1);
    // But no profile update
    assert.deepEqual(state.profileUpdates, []);
    assert.deepEqual(invalidated, []);
  });

  test("subscription.updated with status=active → tier='pro'", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      evt({ type: "subscription.updated", userId: "u-4", subStatus: "active" }),
      { supabase, invalidateTier: () => {} }
    );
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "pro" }, col: "id", val: "u-4" },
    ]);
  });

  test("subscription.updated with status=past_due → tier='free'", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      evt({ type: "subscription.updated", userId: "u-5", subStatus: "past_due" }),
      { supabase, invalidateTier: () => {} }
    );
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "free" }, col: "id", val: "u-5" },
    ]);
  });

  test("duplicate event (conflict on external_id) is a silent no-op", async () => {
    const { supabase, state } = stubSupabase();
    state.billingEventsConflict = true;
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.active", userId: "u-6" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    // Conflict means we already processed this event — skip downstream work
    assert.deepEqual(state.profileUpdates, []);
    assert.deepEqual(invalidated, []);
  });

  test("order.refunded → tier='free' (defensive, even if sub still active)", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    const e = {
      id: "evt_refund",
      type: "order.refunded",
      data: {
        id: "order_1",
        metadata: { user_id: "u-ref" },
        customer: { external_customer_id: "u-ref" },
      },
    };
    await handleVerifiedEvent(e, {
      supabase,
      invalidateTier: (id) => invalidated.push(id),
    });
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "free" }, col: "id", val: "u-ref" },
    ]);
    assert.deepEqual(invalidated, ["u-ref"]);
  });

  test("unknown event types are logged + no-op'd on profile", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      { id: "evt_x", type: "benefit_grant.created", data: { id: "bg_1" } },
      { supabase, invalidateTier: () => {} }
    );
    // We still write billing_events for audit of any event we receive
    assert.equal(state.billingEventsInserted.length, 1);
    assert.deepEqual(state.profileUpdates, []);
  });

  test("falls back to customer.external_customer_id when metadata.user_id missing", async () => {
    const { supabase, state } = stubSupabase();
    const e = {
      id: "evt_fb",
      type: "subscription.active",
      data: {
        id: "sub_fb",
        status: "active",
        metadata: {},
        customer: { external_customer_id: "u-7" },
      },
    };
    await handleVerifiedEvent(e, { supabase, invalidateTier: () => {} });
    assert.deepEqual(state.profileUpdates, [
      { patch: { tier: "pro" }, col: "id", val: "u-7" },
    ]);
  });
});
