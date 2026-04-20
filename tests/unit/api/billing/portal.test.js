// tests/unit/api/billing/portal.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  portalHandler,
  _setPolarClientForTests,
} from "../../../../api/billing/portal.js";

function mockRes() {
  return {
    _status: 200,
    _body: null,
    _redirect: null,
    status(c) {
      this._status = c;
      return this;
    },
    json(b) {
      this._body = b;
      return this;
    },
    redirect(u) {
      this._redirect = u;
      this._status = 302;
    },
  };
}

describe("GET /api/billing/polar/portal", () => {
  test("redirects to the Polar customer portal URL for the authed user", async () => {
    const calls = [];
    _setPolarClientForTests({
      customerPortal: {
        sessions: {
          create: async (args) => {
            calls.push(args);
            return { customerPortalUrl: "https://customer.polar.sh/abc" };
          },
        },
      },
    });
    const req = { verifiedUserId: "user-123", query: {} };
    const res = mockRes();
    await portalHandler(req, res);
    assert.equal(res._redirect, "https://customer.polar.sh/abc");
    assert.equal(res._status, 302);
    assert.equal(calls[0].customerExternalId, "user-123");
  });

  test("?json=1 returns JSON {url} instead of redirecting (for fetch callers)", async () => {
    _setPolarClientForTests({
      customerPortal: {
        sessions: {
          create: async () => ({ customerPortalUrl: "https://customer.polar.sh/xyz" }),
        },
      },
    });
    const req = { verifiedUserId: "user-json", query: { json: "1" } };
    const res = mockRes();
    await portalHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.url, "https://customer.polar.sh/xyz");
    assert.equal(res._redirect, null);
  });

  test("401 when not authed", async () => {
    _setPolarClientForTests({
      customerPortal: { sessions: { create: async () => ({}) } },
    });
    const req = { verifiedUserId: null, query: {} };
    const res = mockRes();
    await portalHandler(req, res);
    assert.equal(res._status, 401);
  });

  test("404 when Polar has no matching customer (user never checked out)", async () => {
    _setPolarClientForTests({
      customerPortal: {
        sessions: {
          create: async () => {
            const err = new Error("Resource not found");
            err.statusCode = 404;
            throw err;
          },
        },
      },
    });
    const req = { verifiedUserId: "user-404", query: {} };
    const res = mockRes();
    await portalHandler(req, res);
    assert.equal(res._status, 404);
    assert.match(res._body.error || "", /no.*customer|not.*found/i);
  });

  test("502 on transient Polar errors", async () => {
    _setPolarClientForTests({
      customerPortal: {
        sessions: {
          create: async () => {
            throw new Error("polar 500");
          },
        },
      },
    });
    const req = { verifiedUserId: "user-err", query: {} };
    const res = mockRes();
    await portalHandler(req, res);
    assert.equal(res._status, 502);
  });
});
