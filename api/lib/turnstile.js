const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileConfig() {
  return {
    siteKey: String(process.env.TURNSTILE_SITE_KEY || "").trim(),
    secretKey: String(process.env.TURNSTILE_SECRET_KEY || "").trim(),
  };
}

export function isTurnstileEnabled() {
  const { siteKey, secretKey } = getTurnstileConfig();
  return Boolean(siteKey && secretKey);
}

export async function verifyTurnstileToken({
  token,
  secretKey,
  remoteIp,
  idempotencyKey,
}) {
  const body = new URLSearchParams({
    secret: secretKey,
    response: String(token || ""),
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }
  if (idempotencyKey) {
    body.set("idempotency_key", idempotencyKey);
  }

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Turnstile verification failed with status ${response.status}`);
  }

  return response.json();
}
