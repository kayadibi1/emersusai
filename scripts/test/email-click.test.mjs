import { test } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";

const events = [];
const stubSupabase = {
  from(t) {
    if (t === "email_events") {
      return { insert(row) { events.push(row); return { error: null }; } };
    }
    return {};
  },
};

const { handleTrackClick } = await import("../../api/email/track-click.js");
const { signClick } = await import("../../api/lib/email/tracking.js");

test("valid signature 302s to target and logs a click event", async () => {
  events.length = 0;
  const target = "https://emersus.ai/app/?utm_source=email&utm_campaign=auth-welcome";
  const sendId = "send-1";
  const sig = signClick({ sendId, target });
  const to = Buffer.from(target).toString("base64url");
  const res = await handleTrackClick(
    { query: { m: sendId, to, k: sig, utm_campaign: "auth-welcome" } },
    { supabase: stubSupabase },
  );
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, target);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "clicked");
  assert.equal(events[0].send_id, sendId);
});

test("bad signature returns 400 and logs no event", async () => {
  events.length = 0;
  const target = "https://emersus.ai/app/";
  const to = Buffer.from(target).toString("base64url");
  const res = await handleTrackClick(
    { query: { m: "send-1", to, k: "bad", utm_campaign: "x" } },
    { supabase: stubSupabase },
  );
  assert.equal(res.statusCode, 400);
  assert.equal(events.length, 0);
});

test("missing params return 400", async () => {
  const res = await handleTrackClick({ query: {} }, { supabase: stubSupabase });
  assert.equal(res.statusCode, 400);
});

test("malformed base64url 'to' returns 400", async () => {
  const target = "https://emersus.ai/app/";
  const sig = signClick({ sendId: "s1", target });
  const res = await handleTrackClick(
    { query: { m: "s1", to: "!!!not-valid-b64url!!!", k: sig } },
    { supabase: stubSupabase },
  );
  assert.equal(res.statusCode, 400);
});
