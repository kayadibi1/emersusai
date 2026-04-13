import crypto from "node:crypto";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

function toBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(encodedPayload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function normalizePayload(payload = {}) {
  return {
    email: String(payload.email || "").trim().toLowerCase().slice(0, 320),
    name: payload.name ? String(payload.name).trim().slice(0, 255) : null,
    surname: payload.surname ? String(payload.surname).trim().slice(0, 255) : null,
    company: payload.company ? String(payload.company).trim().slice(0, 255) : null,
    source: String(payload.source || "landing-page").trim().slice(0, 100),
  };
}

export function createWaitlistVerificationToken(payload, secret, ttlMs = DEFAULT_TTL_MS) {
  if (!secret) {
    throw new Error("Missing waitlist verification secret.");
  }

  const now = Date.now();
  const body = {
    v: 1,
    ...normalizePayload(payload),
    iat: now,
    exp: now + ttlMs,
  };
  const encodedPayload = toBase64Url(JSON.stringify(body));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyWaitlistVerificationToken(token, secret) {
  if (!secret) {
    throw new Error("Missing waitlist verification secret.");
  }

  const [encodedPayload, encodedSignature, ...rest] = String(token || "").split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) {
    throw new Error("Invalid verification token.");
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  const provided = Buffer.from(encodedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new Error("Invalid verification token.");
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch {
    throw new Error("Invalid verification token.");
  }

  if (!payload?.email || payload.v !== 1) {
    throw new Error("Invalid verification token.");
  }

  if (!payload.exp || Date.now() > Number(payload.exp)) {
    throw new Error("Verification link expired.");
  }

  return normalizePayload(payload);
}

export function getWaitlistVerificationSecret() {
  return (
    process.env.WAITLIST_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

export function getPublicBaseUrl(req) {
  const configured = String(process.env.EMERSUS_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const protoHeader = req?.headers?.["x-forwarded-proto"];
  const hostHeader = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  const proto = String(Array.isArray(protoHeader) ? protoHeader[0] : protoHeader || "https")
    .split(",")[0]
    .trim();
  const host = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader || "")
    .split(",")[0]
    .trim();

  if (!host) {
    return "https://emersus.ai";
  }

  return `${proto}://${host}`.replace(/\/+$/, "");
}
