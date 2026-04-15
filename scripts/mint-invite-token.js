#!/usr/bin/env node
// scripts/mint-invite-token.js
//
// Operator helper: mint an HMAC-signed invite token for a given email.
// By default prints the full /auth/?panel=invite&token=<jwt> link plus
// the bare token to stdout. Pass --email to also send the invite via
// Resend so the recipient gets a clickable email (avoids terminal
// line-wrapping on long tokens).
//
// Usage:
//   EMERSUS_INVITE_SECRET=... node scripts/mint-invite-token.js <email> [ttlDays] [--email]
//
// Defaults: ttlDays=14, max 90.

import "../api/lib/load-env.js";
import { mintInviteToken } from "../api/auth/invite-tokens.js";
import { sendResendEmail } from "../api/lib/resend-mail.js";

const positional = [];
let sendEmail = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "--email") sendEmail = true;
  else if (arg === "--help" || arg === "-h") {
    console.log("usage: node scripts/mint-invite-token.js <email> [ttlDays] [--email]");
    process.exit(0);
  }
  else positional.push(arg);
}

const [emailArg, ttlArg] = positional;

if (!emailArg || !emailArg.includes("@")) {
  console.error("usage: node scripts/mint-invite-token.js <email> [ttlDays] [--email]");
  process.exit(2);
}
if (!process.env.EMERSUS_INVITE_SECRET) {
  console.error("EMERSUS_INVITE_SECRET env var is required.");
  process.exit(2);
}

const ttlDays = ttlArg ? Number(ttlArg) : 14;
if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
  console.error(`ttlDays must be a positive number (got ${ttlArg}).`);
  process.exit(2);
}

const token = mintInviteToken(emailArg, ttlDays);
const base = process.env.EMERSUS_BASE_URL || "https://emersus.ai";
const link = `${base}/auth/?panel=invite&token=${token}`;

console.log(`Email:  ${emailArg.toLowerCase()}`);
console.log(`TTL:    ${Math.min(ttlDays, 90)} days`);
console.log(`Token:  ${token}`);
console.log(`Link:   ${link}`);

if (!sendEmail) {
  process.exit(0);
}

// --email mode: deliver the invite via Resend so long tokens don't
// line-wrap when pasted from a terminal.
if (!process.env.RESEND_API_KEY) {
  console.error("\n--email requires RESEND_API_KEY in the environment.");
  process.exit(2);
}
const from = process.env.RESEND_FROM_EMAIL || "Emersus AI <info@emersus.ai>";
const subject = "You're invited to Emersus AI beta";
const text = [
  "You're invited to the Emersus AI private beta.",
  "",
  `Accept your invite and create your account:`,
  link,
  "",
  `Link is valid for ${Math.min(ttlDays, 90)} days.`,
  "Emersus AI · info@emersus.ai",
].join("\n");
const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0b;color:#ededee;padding:32px;margin:0;">
  <div style="max-width:520px;margin:0 auto;background:#141417;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:32px;">
    <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#34d399;margin-bottom:8px;">Emersus Private Beta</div>
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;letter-spacing:-0.01em;">You're in.</h1>
    <p style="margin:0 0 24px;color:#8a8a8f;line-height:1.55;">Click the button below to accept your invite and create your Emersus account. The link is valid for ${Math.min(ttlDays, 90)} days.</p>
    <p style="margin:0 0 28px;">
      <a href="${link}" style="display:inline-block;background:#34d399;color:#04221a;padding:12px 22px;border-radius:8px;font-weight:600;text-decoration:none;">Accept invite</a>
    </p>
    <p style="margin:0;font-size:12px;color:#55555a;line-height:1.55;word-break:break-all;">If the button doesn't work, paste this into your browser:<br><span style="color:#8a8a8f;">${link}</span></p>
  </div>
  <p style="text-align:center;margin:24px 0 0;font-size:11px;color:#55555a;">Emersus AI · info@emersus.ai</p>
</body></html>`;

try {
  const result = await sendResendEmail({
    from,
    to: emailArg,
    subject,
    text,
    html,
    tags: [{ name: "category", value: "invite" }],
  });
  if (result?.error) {
    console.error("\nResend returned an error:", result.error);
    process.exit(1);
  }
  console.log(`\nEmail sent to ${emailArg.toLowerCase()} (id: ${result?.data?.id || "unknown"}).`);
} catch (err) {
  console.error("\nFailed to send invite email:", err.message || err);
  process.exit(1);
}
