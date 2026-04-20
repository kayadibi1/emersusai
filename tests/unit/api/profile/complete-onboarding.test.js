// tests/unit/api/profile/complete-onboarding.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import completeOnboardingHandler from "../../../../api/profile/complete-onboarding.js";

function mockReq(overrides = {}) {
  return {
    verifiedUserId: "user-abc-123",
    body: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe("POST /api/profile/complete-onboarding", () => {
  test("natural completion sets onboarding_completed=true, skipped_at remains null", async () => {
    const fetchCalls = [];
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body || "{}") });
      return { ok: true, json: async () => [{ id: "user-abc-123" }] };
    };
    const req = mockReq({ body: { reason: "completed" } });
    const res = mockRes();
    await completeOnboardingHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchCalls[0].body.onboarding_completed, true);
    assert.equal(fetchCalls[0].body.onboarding_skipped_at, undefined);
  });

  test("skip sets both onboarding_completed=true AND onboarding_skipped_at", async () => {
    const fetchCalls = [];
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body || "{}") });
      return { ok: true, json: async () => [{ id: "user-abc-123" }] };
    };
    const req = mockReq({ body: { reason: "user_skipped" } });
    const res = mockRes();
    await completeOnboardingHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchCalls[0].body.onboarding_completed, true);
    assert.ok(fetchCalls[0].body.onboarding_skipped_at, "skipped_at should be set");
  });

  test("rejects unauthenticated request", async () => {
    const req = { body: {} };
    const res = mockRes();
    await completeOnboardingHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test("double-skip is idempotent (returns 200)", async () => {
    global.fetch = async () => ({ ok: true, json: async () => [{ id: "user-abc-123" }] });
    const req = mockReq({ body: { reason: "user_skipped" } });
    const res = mockRes();
    await completeOnboardingHandler(req, res);
    await completeOnboardingHandler(req, res);
    assert.equal(res.statusCode, 200);
  });
});
