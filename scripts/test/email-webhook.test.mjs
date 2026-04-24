import { test, mock } from "node:test";
import assert from "node:assert/strict";

// whsec_ prefix + base64(32 'a' bytes) — valid svix secret format
process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("a".repeat(32)).toString("base64");

const calls = { events: [], unsubs: [] };
const stubSupabase = {
  from(table) {
    if (table === "email_sends") {
      return {
        select() {
          return { eq: () => ({ maybeSingle: async () => ({ data: { id: "send-1", user_id: "u-1" }, error: null }) }) };
        },
      };
    }
    if (table === "email_events") {
      return {
        insert(row) { calls.events.push(row); return { error: null }; },
      };
    }
    if (table === "email_unsubscribes") {
      return {
        upsert(row) { calls.unsubs.push(row); return { error: null }; },
      };
    }
    return {};
  },
};
mock.module("../../api/lib/clients.js", {
  namedExports: { supabaseAdmin: stubSupabase },
});

const { Webhook } = await import("svix");
const { handleResendWebhook } = await import("../../api/email/webhook-resend.js");

function makeReq(body) {
  const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
  const id = "msg_" + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(body);
  const signature = wh.sign(id, new Date(timestamp * 1000), payload);
  return {
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signature,
    },
    rawBody: payload,
  };
}

test("valid 'email.delivered' event writes email_events row", async () => {
  calls.events.length = 0;
  const body = { type: "email.delivered", created_at: "2026-04-24T12:00:00Z", data: { email_id: "re_001" } };
  const res = await handleResendWebhook(makeReq(body));
  assert.equal(res.statusCode, 202);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].kind, "delivered");
  assert.equal(calls.events[0].resend_id, "re_001");
});

test("'email.complained' upserts into email_unsubscribes", async () => {
  calls.events.length = 0;
  calls.unsubs.length = 0;
  const body = { type: "email.complained", created_at: "2026-04-24T12:01:00Z", data: { email_id: "re_002" } };
  await handleResendWebhook(makeReq(body));
  assert.equal(calls.unsubs.length, 1);
  assert.equal(calls.unsubs[0].bucket, "all_marketing");
  assert.equal(calls.unsubs[0].source, "complaint");
});

test("invalid signature returns 401", async () => {
  const req = {
    headers: { "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,nope" },
    rawBody: JSON.stringify({ type: "email.delivered", data: { email_id: "re_x" } }),
  };
  const res = await handleResendWebhook(req);
  assert.equal(res.statusCode, 401);
});
