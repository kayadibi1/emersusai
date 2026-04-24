import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";
process.env.RESEND_API_KEY = "re_test_do_not_use";
process.env.RESEND_FROM_EMAIL = "Emersus <noreply@emersus.ai>";

// Stub the resend module BEFORE importing senders.
const resendSpy = mock.fn(async () => ({ data: { id: "re_fake_001" }, error: null }));
mock.module("../../api/lib/resend-mail.js", {
  namedExports: { sendResendEmail: resendSpy, getResendTemplateId: () => "" },
});

// Stub the supabase admin client.
const sends = [];
const supabaseStub = {
  from(table) {
    return {
      insert(row) {
        if (table === "email_sends") {
          const id = `send-${sends.length + 1}`;
          sends.push({ id, ...row });
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        }
        return { select: async () => ({ data: null, error: null }) };
      },
      update(_patch) {
        return { eq: async () => ({ error: null }) };
      },
      select() {
        return {
          eq: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
            in: () => Promise.resolve({ data: [], error: null }),
          }),
          contains: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      },
    };
  },
};
mock.module("../../api/lib/clients.js", {
  namedExports: { supabaseAdmin: supabaseStub },
});

const { sendAuthVerify, sendResearchNewPaper } = await import("../../api/lib/email/senders.js");

test("sendAuthVerify writes email_sends row + calls resend + returns sendId", async () => {
  resendSpy.mock.resetCalls();
  sends.length = 0;
  const res = await sendAuthVerify({
    userId: "u-1",
    to: "sid@example.com",
    confirmUrl: "https://emersus.ai/auth/confirm?token=xyz",
  });
  assert.equal(res.sendId, "send-1");
  assert.equal(resendSpy.mock.callCount(), 1);
  const [call] = resendSpy.mock.calls[0].arguments;
  assert.equal(call.to, "sid@example.com");
  assert.match(call.subject, /Confirm your email/);
  assert.ok(Array.isArray(call.tags));
  assert.ok(call.tags.find(t => t.name === "template" && t.value === "auth-verify"));
});

test("sendResearchNewPaper attaches List-Unsubscribe headers", async () => {
  resendSpy.mock.resetCalls();
  sends.length = 0;
  await sendResearchNewPaper({
    userId: "u-2",
    to: "foo@example.com",
    topic: "creatine",
    paper: {
      title: "T",
      journal: "J",
      year: 2026,
      grade: "high",
      abstract: "abs",
      doi: "10.0/x",
    },
    reason: "matches your follow",
  });
  assert.equal(resendSpy.mock.callCount(), 1);
  const [call] = resendSpy.mock.calls[0].arguments;
  assert.ok(call.headers, "headers forwarded");
  assert.match(call.headers["List-Unsubscribe"], /\/api\/email\/unsubscribe/);
  assert.equal(call.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});
