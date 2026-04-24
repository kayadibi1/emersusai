// api/lib/email/tracking.js
// HMAC signing for email click + one-click-unsubscribe URLs.
// Constant-time compare; no early returns that leak timing.

import crypto from "node:crypto";

function secret() {
  const s = process.env.EMAIL_CLICK_SECRET;
  if (!s || s.length < 16) {
    throw new Error("EMAIL_CLICK_SECRET is not configured (must be 16+ chars)");
  }
  return s;
}

function hmacHex(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("hex");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Sign a click: HMAC over `sendId|target`. */
export function signClick({ sendId, target }) {
  return hmacHex(`${sendId}|${target}`);
}

export function verifyClick({ sendId, target, sig }) {
  return safeEqualHex(sig, signClick({ sendId, target }));
}

/** Sign an unsubscribe: HMAC over `sendId|bucket`. */
export function signUnsubscribe({ sendId, bucket }) {
  return hmacHex(`unsub|${sendId}|${bucket}`);
}

export function verifyUnsubscribe({ sendId, bucket, sig }) {
  return safeEqualHex(sig, signUnsubscribe({ sendId, bucket }));
}

/**
 * Build the tracked redirect URL.
 * - Adds UTM params to `target` first.
 * - Signs (sendId, target-with-utm) and base64url-encodes the target.
 */
export function buildTrackedUrl({
  sendId,
  target,
  utmCampaign,
  marketing = false,
  userId,
  baseUrl = "https://emersus.ai",
}) {
  const u = new URL(target);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", marketing ? "marketing" : "transactional");
  u.searchParams.set("utm_campaign", utmCampaign);
  if (userId) u.searchParams.set("u", userId);
  const finalTarget = u.toString();
  const sig = signClick({ sendId, target: finalTarget });
  const encoded = Buffer.from(finalTarget, "utf8").toString("base64url");
  const q = new URLSearchParams({ m: sendId, to: encoded, k: sig, utm_campaign: utmCampaign });
  return `${baseUrl}/api/email/track/click?${q.toString()}`;
}
