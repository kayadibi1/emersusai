// api/auth/invite-tokens.js
//
// HMAC-signed invite tokens — no DB table needed. Operator runs a small
// script to mint a token from an email + expiry, emails it to the user
// as a /auth/?panel=invite&token=<jwt> link.
//
// Token format: base64url(payload).hex(hmac_sha256(payload))
//   payload = { email, exp_unix }
//
// Verification: re-compute HMAC over the payload, constant-time compare.

import crypto from "node:crypto";

const SECRET_ENV = "EMERSUS_INVITE_SECRET";
const DEFAULT_TTL_DAYS = 14;

function getSecret() {
  const secret = process.env[SECRET_ENV];
  if (!secret) throw new Error(`${SECRET_ENV} env var is required for invite tokens`);
  return secret;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}
function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function mintInviteToken(email, ttlDays = DEFAULT_TTL_DAYS) {
  const payload = {
    email: String(email || "").trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + Math.max(1, Math.min(ttlDays, 90)) * 86400,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadEncoded = b64urlEncode(payloadStr);
  const hmac = crypto.createHmac("sha256", getSecret()).update(payloadEncoded).digest("hex");
  return `${payloadEncoded}.${hmac}`;
}

export function verifyInviteToken(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "malformed" };
  }
  const [payloadEncoded, hmac] = token.split(".", 2);
  if (!payloadEncoded || !hmac) return { valid: false, reason: "malformed" };

  let secret;
  try { secret = getSecret(); } catch (err) { return { valid: false, reason: "no_secret" }; }

  const expectedHmac = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("hex");
  // Constant-time compare via Buffer.equals after length check.
  if (hmac.length !== expectedHmac.length) return { valid: false, reason: "bad_signature" };
  const a = Buffer.from(hmac, "hex");
  const b = Buffer.from(expectedHmac, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadEncoded));
  } catch {
    return { valid: false, reason: "bad_payload" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { valid: false, reason: "expired" };
  }
  if (typeof payload.email !== "string" || !payload.email.includes("@")) {
    return { valid: false, reason: "bad_payload" };
  }

  return {
    valid: true,
    email: payload.email,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}
