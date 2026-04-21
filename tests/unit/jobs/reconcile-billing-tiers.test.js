// tests/unit/jobs/reconcile-billing-tiers.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconcileProfiles } from "../../../jobs/reconcile-billing-tiers.js";

function stubPolar(subsByCustomer) {
  return {
    subscriptions: {
      list: async ({ externalCustomerId }) => ({
        result: { items: subsByCustomer[externalCustomerId] ?? [] },
      }),
    },
  };
}

function stubUpdater() {
  const calls = [];
  const updateProfile = async (id, patch) => {
    calls.push({ id, patch });
    return { error: null };
  };
  return { updateProfile, calls };
}

describe("reconcileProfiles", () => {
  test("demotes a pro profile when Polar reports no subscription at all", async () => {
    const profiles = [{ id: "u-gone", tier: "pro", pro_until: "2026-05-01T00:00:00Z", subscription_status: "active", cancel_at_period_end: false }];
    const polar = stubPolar({ "u-gone": [] });
    const { updateProfile, calls } = stubUpdater();
    const invalidated = [];
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile,
      onInvalidate: (id) => invalidated.push(id),
    });
    assert.equal(summary.demoted, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].patch.tier, "free");
    assert.equal(calls[0].patch.pro_until, null);
    assert.deepEqual(invalidated, ["u-gone"]);
  });

  test("demotes when Polar's latest sub is revoked/canceled (non-active)", async () => {
    const profiles = [{ id: "u-rev", tier: "pro", pro_until: "2026-05-01T00:00:00Z", subscription_status: "active", cancel_at_period_end: false }];
    const polar = stubPolar({ "u-rev": [{ status: "revoked", currentPeriodEnd: "2026-04-20T00:00:00Z" }] });
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, onInvalidate: () => {},
    });
    assert.equal(summary.demoted, 1);
    assert.equal(calls[0].patch.tier, "free");
    assert.equal(calls[0].patch.subscription_status, "revoked");
  });

  test("no-op when Polar state matches stored state (active, same period_end)", async () => {
    const profiles = [{
      id: "u-ok",
      tier: "pro",
      pro_until: "2026-05-20T00:00:00.000Z",
      subscription_status: "active",
      cancel_at_period_end: false,
    }];
    const polar = stubPolar({
      "u-ok": [{
        status: "active",
        currentPeriodEnd: "2026-05-20T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      }],
    });
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, onInvalidate: () => {},
    });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.demoted, 0);
    assert.equal(summary.synced, 0);
    assert.equal(calls.length, 0);
  });

  test("syncs pro_until forward when Polar has advanced it (renewal drift)", async () => {
    const profiles = [{
      id: "u-renew",
      tier: "pro",
      pro_until: "2026-05-20T00:00:00.000Z",
      subscription_status: "active",
      cancel_at_period_end: false,
    }];
    const polar = stubPolar({
      "u-renew": [{
        status: "active",
        currentPeriodEnd: "2026-06-20T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      }],
    });
    const { updateProfile, calls } = stubUpdater();
    const invalidated = [];
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile,
      onInvalidate: (id) => invalidated.push(id),
    });
    assert.equal(summary.synced, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].patch.pro_until, "2026-06-20T00:00:00.000Z");
    // Tier didn't change → invalidateTier not called
    assert.deepEqual(invalidated, []);
  });

  test("syncs cancel_at_period_end when Polar portal action happened between webhooks", async () => {
    const profiles = [{
      id: "u-cancel",
      tier: "pro",
      pro_until: "2026-05-20T00:00:00.000Z",
      subscription_status: "active",
      cancel_at_period_end: false,
    }];
    const polar = stubPolar({
      "u-cancel": [{
        status: "active",
        currentPeriodEnd: "2026-05-20T00:00:00.000Z",
        cancelAtPeriodEnd: true,
      }],
    });
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, onInvalidate: () => {},
    });
    assert.equal(summary.synced, 1);
    assert.equal(calls[0].patch.cancel_at_period_end, true);
    assert.equal(calls[0].patch.tier, "pro");
  });

  test("dryRun counts divergences without calling updateProfile", async () => {
    const profiles = [
      { id: "u-a", tier: "pro", pro_until: null, subscription_status: "active", cancel_at_period_end: false },
      { id: "u-b", tier: "pro", pro_until: null, subscription_status: "active", cancel_at_period_end: false },
    ];
    const polar = stubPolar({ "u-a": [], "u-b": [{ status: "active", currentPeriodEnd: "2026-06-20T00:00:00Z" }] });
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, dryRun: true, onInvalidate: () => {},
    });
    assert.equal(calls.length, 0);
    assert.equal(summary.demoted, 1);
    assert.equal(summary.synced, 1);
  });

  test("unexpected Polar response shape is an error, NOT a mass demotion", async () => {
    const profiles = [
      { id: "u-shape", tier: "pro", pro_until: "2026-05-20", subscription_status: "active", cancel_at_period_end: false },
    ];
    const polar = {
      subscriptions: {
        // Simulate a future SDK where items moves elsewhere — the bad
        // path here would be silently treating this as "no sub".
        list: async () => ({ result: { data: [] } }),
      },
    };
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, onInvalidate: () => {},
      log: { warn: () => {} },
    });
    assert.equal(summary.errors, 1);
    assert.equal(summary.demoted, 0);
    assert.equal(calls.length, 0);
  });

  test("Polar API failure increments errors and skips that user", async () => {
    const profiles = [
      { id: "u-err", tier: "pro", pro_until: null, subscription_status: null, cancel_at_period_end: false },
      { id: "u-ok",  tier: "pro", pro_until: null, subscription_status: null, cancel_at_period_end: false },
    ];
    const polar = {
      subscriptions: {
        list: async ({ externalCustomerId }) => {
          if (externalCustomerId === "u-err") throw new Error("polar 503");
          return { result: { items: [] } };
        },
      },
    };
    const { updateProfile, calls } = stubUpdater();
    const summary = await reconcileProfiles({
      profiles, polar, updateProfile, onInvalidate: () => {},
      log: { warn: () => {} },
    });
    assert.equal(summary.errors, 1);
    assert.equal(summary.demoted, 1); // u-ok got demoted
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "u-ok");
  });
});
