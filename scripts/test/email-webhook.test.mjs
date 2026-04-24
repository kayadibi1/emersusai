import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { handleResendWebhook } from "../../api/email/webhook-resend.js";

const SECRET = "whsec_" + Buffer.from("a".repeat(32)).toString("base64");

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
        upsert(row, opts) { calls.unsubs.push({ row, opts }); return { error: null }; },
      };
    }
    return {};
  },
};

function makeReq(body) {
  const wh = new Webhook(SECRET);
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
  const res = await handleResendWebhook(makeReq(body), { supabase: stubSupabase, secret: SECRET });
  assert.equal(res.statusCode, 202);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].kind, "delivered");
  assert.equal(calls.events[0].resend_id, "re_001");
});

test("'email.complained' upserts into email_unsubscribes", async () => {
  calls.events.length = 0;
  calls.unsubs.length = 0;
  const body = { type: "email.complained", created_at: "2026-04-24T12:01:00Z", data: { email_id: "re_002" } };
  await handleResendWebhook(makeReq(body), { supabase: stubSupabase, secret: SECRET });
  assert.equal(calls.unsubs.length, 1);
  assert.equal(calls.unsubs[0].row.bucket, "all_marketing");
  assert.equal(calls.unsubs[0].row.source, "complaint");
  assert.equal(calls.unsubs[0].opts?.onConflict, "user_id,bucket");
});

test("invalid signature returns 401", async () => {
  const req = {
    headers: { "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,nope" },
    rawBody: JSON.stringify({ type: "email.delivered", data: { email_id: "re_x" } }),
  };
  const res = await handleResendWebhook(req, { supabase: stubSupabase, secret: SECRET });
  assert.equal(res.statusCode, 401);
});

test("complaint upsert DB error throws (so Resend retries)", async () => {
  const failingSupabase = {
    from(table) {
      if (table === "email_sends") {
        return { select() { return { eq: () => ({ maybeSingle: async () => ({ data: { id: "s1", user_id: "u1" }, error: null }) }) }; } };
      }
      if (table === "email_events") {
        return { insert() { return { error: null }; } };
      }
      if (table === "email_unsubscribes") {
        return { upsert() { return { error: { code: "23503", message: "FK violation" } }; } };
      }
      return {};
    },
  };
  const body = { type: "email.complained", created_at: "2026-04-24T12:02:00Z", data: { email_id: "re_003" } };
  await assert.rejects(
    handleResendWebhook(makeReq(body), { supabase: failingSupabase, secret: SECRET }),
    /unsubscribe upsert/,
  );
});
