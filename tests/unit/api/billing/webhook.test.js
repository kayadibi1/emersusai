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

function evt({
  type,
  userId = "u-99",
  subStatus = "active",
  subId = "sub_1",
  cancelAtPeriodEnd = false,
  currentPeriodEnd = "2026-05-20T17:40:55.000Z",
}) {
  return {
    type,
    data: {
      id: subId,
      status: subStatus,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: currentPeriodEnd,
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

  test("subscription.active → tier='pro' + billing_events row + state columns synced", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.active", userId: "u-1" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    assert.equal(state.billingEventsInserted.length, 1);
    assert.equal(state.billingEventsInserted[0].user_id, "u-1");
    assert.equal(state.billingEventsInserted[0].event_type, "subscription.active");
    assert.equal(state.profileUpdates.length, 1);
    const { patch, col, val } = state.profileUpdates[0];
    assert.equal(col, "id");
    assert.equal(val, "u-1");
    assert.equal(patch.tier, "pro");
    assert.equal(patch.subscription_status, "active");
    assert.equal(patch.cancel_at_period_end, false);
    assert.equal(patch.pro_until, "2026-05-20T17:40:55.000Z");
    assert.deepEqual(invalidated, ["u-1"]);
  });

  test("subscription.revoked → tier='free' + clears pending cancel flag", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.revoked", userId: "u-2", subStatus: "revoked" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    assert.equal(state.profileUpdates.length, 1);
    assert.equal(state.profileUpdates[0].patch.tier, "free");
    assert.equal(state.profileUpdates[0].patch.subscription_status, "revoked");
    assert.deepEqual(invalidated, ["u-2"]);
  });

  test("subscription.canceled keeps tier=pro but flips cancel_at_period_end flag", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({
        type: "subscription.canceled",
        userId: "u-3",
        subStatus: "canceled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-06-20T00:00:00.000Z",
      }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    // billing_events row still written for audit
    assert.equal(state.billingEventsInserted.length, 1);
    // Profile update DOES happen now — persist the cancel flag and period end
    // so the UI can show "Cancels on Y". But tier is unchanged.
    assert.equal(state.profileUpdates.length, 1);
    const { patch } = state.profileUpdates[0];
    assert.equal(patch.tier, undefined);
    assert.equal(patch.cancel_at_period_end, true);
    assert.equal(patch.pro_until, "2026-06-20T00:00:00.000Z");
    assert.equal(patch.subscription_status, "canceled");
    assert.deepEqual(invalidated, []);
  });

  test("subscription.updated with status=active → tier='pro' + advances pro_until", async () => {
    const { supabase, state } = stubSupabase();
    await handleVerifiedEvent(
      evt({
        type: "subscription.updated",
        userId: "u-4",
        subStatus: "active",
        currentPeriodEnd: "2026-06-20T17:40:55.000Z",
      }),
      { supabase, invalidateTier: () => {} }
    );
    assert.equal(state.profileUpdates.length, 1);
    assert.equal(state.profileUpdates[0].patch.tier, "pro");
    assert.equal(state.profileUpdates[0].patch.pro_until, "2026-06-20T17:40:55.000Z");
  });

  test("subscription.updated with status=past_due does NOT demote — Polar dunning owns the grace window", async () => {
    const { supabase, state } = stubSupabase();
    const invalidated = [];
    await handleVerifiedEvent(
      evt({ type: "subscription.updated", userId: "u-5", subStatus: "past_due" }),
      { supabase, invalidateTier: (id) => invalidated.push(id) }
    );
    // Audit row still written
    assert.equal(state.billingEventsInserted.length, 1);
    // Profile patch runs — we sync subscription_status='past_due' so the UI
    // could surface a "payment failed, retrying" banner — but tier stays.
    assert.equal(state.profileUpdates.length, 1);
    assert.equal(state.profileUpdates[0].patch.tier, undefined);
    assert.equal(state.profileUpdates[0].patch.subscription_status, "past_due");
    assert.deepEqual(invalidated, []);
  });

  test("non-duplicate insert error throws — so HTTP handler returns 500 and Polar retries", async () => {
    const supabase = {
      from() {
        return {
          insert: () => ({ error: { code: "23502", message: "null in external_id" } }),
          update() { return { eq: () => ({ error: null }) }; },
        };
      },
    };
    await assert.rejects(
      () =>
        handleVerifiedEvent(
          evt({ type: "subscription.active", userId: "u-err" }),
          { supabase, invalidateTier: () => {} }
        ),
      /billing_events insert failed|profile update failed/
    );
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
    assert.equal(state.profileUpdates.length, 1);
    const { patch } = state.profileUpdates[0];
    assert.equal(patch.tier, "free");
    // Refund also clears the denormalized subscription columns so the
    // profile doesn't end up in a weird tier=free + pro_until=future state.
    assert.equal(patch.subscription_status, null);
    assert.equal(patch.cancel_at_period_end, false);
    assert.equal(patch.pro_until, null);
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
    assert.equal(state.profileUpdates.length, 1);
    assert.equal(state.profileUpdates[0].patch.tier, "pro");
    assert.equal(state.profileUpdates[0].val, "u-7");
  });
});
