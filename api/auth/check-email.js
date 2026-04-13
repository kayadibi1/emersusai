// api/auth/check-email.js
//
// Server-side email domain validation for signup. Replaces the client-side
// auth-email-allowlist.js so the 800-line domain list isn't shipped to
// every browser (reveals signup gating strategy).

import { ALLOWED_EMAIL_DOMAINS } from "./email-allowlist.js";

function isAllowedEmailDomain(email) {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ allowed: false, reason: "missing_email" });
  }

  return res.json({ allowed: isAllowedEmailDomain(email) });
}
