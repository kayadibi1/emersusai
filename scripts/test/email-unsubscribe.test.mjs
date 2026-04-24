import { test } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";

const sendRows = { "send-1": { id: "send-1", user_id: "u-1" } };
let upserts = [];
const makeStub = () => ({
  from(t) {
    if (t === "email_sends") {
      return {
        select() {
          return {
            eq: (_col, val) => ({
              maybeSingle: async () => ({ data: sendRows[val] || null, error: null }),
            }),
          };
        },
      };
    }
    if (t === "email_unsubscribes") {
      return {
        upsert(row, opts) { upserts.push({ row, opts }); return { error: null }; },
      };
    }
    return {};
  },
});

const { handleUnsubscribe } = await import("../../api/email/unsubscribe.js");
const { signUnsubscribe } = await import("../../api/lib/email/tracking.js");

test("valid signature upserts email_unsubscribes and returns 200 HTML", async () => {
  upserts = [];
  const sig = signUnsubscribe({ sendId: "send-1", bucket: "research_alerts" });
  const res = await handleUnsubscribe(
    { query: { m: "send-1", b: "research_alerts", k: sig } },
    { supabase: makeStub() },
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /unsubscribed/i);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].row.user_id, "u-1");
  assert.equal(upserts[0].row.bucket, "research_alerts");
  assert.equal(upserts[0].row.source, "one_click");
  assert.equal(upserts[0].opts?.onConflict, "user_id,bucket");
});

test("bad signature returns 400", async () => {
  const res = await handleUnsubscribe(
    { query: { m: "send-1", b: "research_alerts", k: "bad" } },
    { supabase: makeStub() },
  );
  assert.equal(res.statusCode, 400);
});

test("unknown bucket returns 400", async () => {
  const sig = signUnsubscribe({ sendId: "send-1", bucket: "research_alerts" });
  const res = await handleUnsubscribe(
    { query: { m: "send-1", b: "bogus", k: sig } },
    { supabase: makeStub() },
  );
  assert.equal(res.statusCode, 400);
});

test("missing params return 400", async () => {
  const res = await handleUnsubscribe({ query: {} }, { supabase: makeStub() });
  assert.equal(res.statusCode, 400);
});
