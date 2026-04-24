import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signClick,
  verifyClick,
  buildTrackedUrl,
  signUnsubscribe,
  verifyUnsubscribe,
} from "../../api/lib/email/tracking.js";

const SECRET = "test-secret-do-not-use-in-prod";
process.env.EMAIL_CLICK_SECRET = SECRET;

test("signClick + verifyClick round-trip", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/app/", sig }), true);
});

test("verifyClick rejects tampered target", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s1", target: "https://evil.example/", sig }), false);
});

test("verifyClick rejects tampered sendId", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s2", target: "https://emersus.ai/app/", sig }), false);
});

test("verifyClick rejects malformed signature", () => {
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/", sig: "nope" }), false);
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/", sig: "" }), false);
});

test("buildTrackedUrl produces /api/email/track/click with utm params on target", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/app/",
    utmCampaign: "auth-verify",
    marketing: false,
    userId: "u-123",
  });
  assert.match(url, /\/api\/email\/track\/click\?/);
  assert.match(url, /m=s1/);
  const m = url.match(/[?&]to=([^&]+)/);
  assert.ok(m, "to= param present");
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /utm_source=email/);
  assert.match(decoded, /utm_medium=transactional/);
  assert.match(decoded, /utm_campaign=auth-verify/);
  assert.match(decoded, /u=u-123/);
});

test("buildTrackedUrl marketing uses utm_medium=marketing", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/chat",
    utmCampaign: "research-new-paper",
    marketing: true,
    userId: "u-1",
  });
  const m = url.match(/[?&]to=([^&]+)/);
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /utm_medium=marketing/);
});

test("buildTrackedUrl preserves existing query on target", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/chat?q=1",
    utmCampaign: "welcome",
    marketing: false,
    userId: "u-1",
  });
  const m = url.match(/[?&]to=([^&]+)/);
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /\?q=1&utm_source=email/);
});

test("signUnsubscribe + verifyUnsubscribe round-trip", () => {
  const sig = signUnsubscribe({ sendId: "s1", bucket: "research_alerts" });
  assert.equal(verifyUnsubscribe({ sendId: "s1", bucket: "research_alerts", sig }), true);
  assert.equal(verifyUnsubscribe({ sendId: "s1", bucket: "engagement", sig }), false);
});
