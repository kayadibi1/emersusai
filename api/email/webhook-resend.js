// api/email/webhook-resend.js
// POST /api/email/webhook/resend — Svix-signed delivery events from Resend.
// Business logic in handleResendWebhook; Express handler wraps with req.rawBody.

import { Webhook } from "svix";
import { supabaseAdmin } from "../lib/clients.js";

const TYPE_TO_KIND = {
  "email.delivered":        "delivered",
  "email.bounced":          "bounced",
  "email.complained":       "complained",
  "email.opened":           "opened",
  "email.clicked":          "clicked",
  "email.delivery_delayed": "delivery_delayed",
};

/** Pure-ish handler. Returns { statusCode, body }. */
export async function handleResendWebhook({ headers, rawBody }, {
  supabase = supabaseAdmin,
  secret = process.env.RESEND_WEBHOOK_SECRET,
} = {}) {
  if (!secret) {
    return { statusCode: 500, body: { error: "webhook secret not configured" } };
  }

  let event;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id":        headers["webhook-id"]        || headers["svix-id"],
      "svix-timestamp": headers["webhook-timestamp"] || headers["svix-timestamp"],
      "svix-signature": headers["webhook-signature"] || headers["svix-signature"],
    });
  } catch (err) {
    return { statusCode: 401, body: { error: "invalid signature", detail: err.message } };
  }

  const kind = TYPE_TO_KIND[event.type];
  if (!kind) return { statusCode: 202, body: { ignored: event.type } };

  const resendId = event?.data?.email_id;
  const occurredAt = event?.created_at || new Date().toISOString();
  if (!resendId) return { statusCode: 202, body: { ignored: "no email_id" } };

  const { data: sendRow } = await supabase
    .from("email_sends")
    .select("id, user_id")
    .eq("resend_id", resendId)
    .maybeSingle();

  const ins = await supabase.from("email_events").insert({
    send_id: sendRow?.id || null,
    resend_id: resendId,
    kind,
    payload: event,
    occurred_at: occurredAt,
  });
  if (ins?.error && ins.error.code !== "23505") {
    throw new Error(`email_events insert: ${ins.error.message}`);
  }

  if (kind === "complained" && sendRow?.user_id) {
    await supabase.from("email_unsubscribes").upsert({
      user_id: sendRow.user_id,
      bucket: "all_marketing",
      source: "complaint",
    });
  }

  return { statusCode: 202, body: { ok: true, kind, send_id: sendRow?.id || null } };
}

/** Express handler. Expects raw body as Buffer or string via middleware. */
export async function resendWebhookExpressHandler(req, res) {
  const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  const result = await handleResendWebhook({ headers: req.headers, rawBody });
  res.status(result.statusCode).json(result.body);
}
