import test from "node:test";
import assert from "node:assert/strict";

import {
  createWaitlistVerificationToken,
  getPublicBaseUrl,
  verifyWaitlistVerificationToken,
} from "../../../api/lib/waitlist-verification.js";

test("create/verify round-trip preserves normalized waitlist payload", () => {
  const token = createWaitlistVerificationToken(
    {
      email: "  SIDAR@Example.COM ",
      name: " Sidar ",
      surname: " Arslanoglu ",
      company: " Emersus ",
      source: " landing-page ",
    },
    "test-secret"
  );

  const payload = verifyWaitlistVerificationToken(token, "test-secret");

  assert.deepEqual(payload, {
    email: "sidar@example.com",
    name: "Sidar",
    surname: "Arslanoglu",
    company: "Emersus",
    source: "landing-page",
  });
});

test("verify rejects tampered tokens", () => {
  const token = createWaitlistVerificationToken(
    { email: "user@example.com", source: "landing-page" },
    "test-secret"
  );
  const [payload, signature] = token.split(".");
  const tampered = `${payload}.${signature.slice(0, -1)}x`;

  assert.throws(
    () => verifyWaitlistVerificationToken(tampered, "test-secret"),
    /Invalid verification token/
  );
});

test("verify rejects expired tokens", () => {
  const token = createWaitlistVerificationToken(
    { email: "user@example.com", source: "landing-page" },
    "test-secret",
    -1
  );

  assert.throws(
    () => verifyWaitlistVerificationToken(token, "test-secret"),
    /Verification link expired/
  );
});

test("getPublicBaseUrl prefers configured env value", () => {
  const saved = process.env.EMERSUS_BASE_URL;
  process.env.EMERSUS_BASE_URL = "https://emersus.ai/";
  try {
    assert.equal(getPublicBaseUrl({ headers: { host: "ignored.example.com" } }), "https://emersus.ai");
  } finally {
    if (saved === undefined) delete process.env.EMERSUS_BASE_URL;
    else process.env.EMERSUS_BASE_URL = saved;
  }
});

test("getPublicBaseUrl falls back to forwarded headers", () => {
  delete process.env.EMERSUS_BASE_URL;
  const baseUrl = getPublicBaseUrl({
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "emersus.ai",
    },
  });
  assert.equal(baseUrl, "https://emersus.ai");
});
