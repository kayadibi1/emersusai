#!/usr/bin/env node
// scripts/test/simulate-resend-webhook.mjs
// Post a Svix-signed webhook payload to the local dev server.
// Usage:
//   node scripts/test/simulate-resend-webhook.mjs \
//     --kind delivered|bounced|complained|clicked \
//     --resend-id re_001 [--base http://localhost:3000]

import { Webhook } from "svix";

function arg(n, fb) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : fb; }

const kind     = arg("kind", "delivered");
const resendId = arg("resend-id", "re_" + Math.random().toString(36).slice(2, 10));
const base     = arg("base", "http://localhost:3000");
const secret   = process.env.RESEND_WEBHOOK_SECRET;
if (!secret) {
  console.error("RESEND_WEBHOOK_SECRET not set");
  process.exit(1);
}

const body = {
  type: `email.${kind}`,
  created_at: new Date().toISOString(),
  data: { email_id: resendId, to: "qa@example.com", subject: "QA" },
};
const payload = JSON.stringify(body);
const wh = new Webhook(secret);
const msgId = "msg_" + Math.random().toString(36).slice(2);
const signature = wh.sign(msgId, new Date(), payload);

const res = await fetch(`${base}/api/email/webhook/resend`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": signature,
  },
  body: payload,
});
console.log(res.status, await res.text());
