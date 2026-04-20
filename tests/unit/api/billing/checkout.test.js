// tests/unit/api/billing/checkout.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutHandler,
  _setPolarClientForTests,
} from "../../../../api/billing/checkout.js";

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

describe("POST /api/billing/polar/checkout", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      POLAR_PRODUCT_ID_MONTHLY: process.env.POLAR_PRODUCT_ID_MONTHLY,
      POLAR_PRODUCT_ID_YEARLY: process.env.POLAR_PRODUCT_ID_YEARLY,
      SITE_URL: process.env.SITE_URL,
    };
    process.env.POLAR_PRODUCT_ID_MONTHLY = "prod-monthly-test";
    process.env.POLAR_PRODUCT_ID_YEARLY = "prod-yearly-test";
    process.env.SITE_URL = "https://test.emersus.ai";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("creates checkout for monthly plan", async () => {
    const calls = [];
    _setPolarClientForTests({
      checkouts: {
        create: async (args) => {
          calls.push(args);
          return { id: "ck_123", url: "https://buy.polar.sh/xyz" };
        },
      },
    });
    const req = {
      verifiedUserId: "user-1",
      supabaseUser: { email: "user1@example.com" },
      body: { plan: "monthly" },
    };
    const res = mockRes();
    await checkoutHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.url, "https://buy.polar.sh/xyz");
    assert.deepEqual(calls[0].products, ["prod-monthly-test"]);
    assert.equal(calls[0].customerEmail, "user1@example.com");
    assert.equal(calls[0].externalCustomerId, "user-1");
    assert.equal(calls[0].metadata.user_id, "user-1");
    assert.equal(calls[0].metadata.plan, "monthly");
    assert.equal(
      calls[0].successUrl,
      "https://test.emersus.ai/app/profile?upgraded=1"
    );
  });

  test("creates checkout for yearly plan", async () => {
    const calls = [];
    _setPolarClientForTests({
      checkouts: {
        create: async (args) => {
          calls.push(args);
          return { id: "ck_456", url: "https://buy.polar.sh/abc" };
        },
      },
    });
    const req = {
      verifiedUserId: "user-2",
      supabaseUser: { email: "user2@example.com" },
      body: { plan: "yearly" },
    };
    const res = mockRes();
    await checkoutHandler(req, res);
    assert.equal(res._body.url, "https://buy.polar.sh/abc");
    assert.deepEqual(calls[0].products, ["prod-yearly-test"]);
    assert.equal(calls[0].metadata.plan, "yearly");
  });

  test("400 on unknown plan", async () => {
    _setPolarClientForTests({
      checkouts: { create: async () => ({}) },
    });
    const req = {
      verifiedUserId: "user-3",
      supabaseUser: { email: "x@x.com" },
      body: { plan: "lifetime" },
    };
    const res = mockRes();
    await checkoutHandler(req, res);
    assert.equal(res._status, 400);
  });

  test("401 when unauthenticated", async () => {
    _setPolarClientForTests({
      checkouts: { create: async () => ({}) },
    });
    const req = { verifiedUserId: null, body: { plan: "monthly" } };
    const res = mockRes();
    await checkoutHandler(req, res);
    assert.equal(res._status, 401);
  });

  test("502 when Polar throws", async () => {
    _setPolarClientForTests({
      checkouts: {
        create: async () => {
          throw new Error("polar is down");
        },
      },
    });
    const req = {
      verifiedUserId: "user-4",
      supabaseUser: { email: "a@b.com" },
      body: { plan: "monthly" },
    };
    const res = mockRes();
    await checkoutHandler(req, res);
    assert.equal(res._status, 502);
  });
});
