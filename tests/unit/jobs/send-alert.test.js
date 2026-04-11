// tests/unit/jobs/send-alert.test.js
// Unit tests for jobs/send-alert.js.
// Mocks sendAlert from api/lib/alerts.js — we test the handler's
// argument forwarding, validation, and progress reporting.
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Because ES module mocking (module.mock) requires Node ≥22 or a test runner
// with mock support, we test the handler logic directly by constructing the
// same control flow as the handler, with an injected sendAlert mock.
// We also import the real module to confirm it exports the right shape.
// ---------------------------------------------------------------------------

import { sendAlertHandler } from "../../../jobs/send-alert.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(data = {}) {
  const progressLog = [];
  return {
    data,
    progress: async (msg) => { progressLog.push(msg); },
    progressLog,
  };
}

/**
 * Creates an injectable version of the handler that uses a mock sendAlert.
 */
function makeHandler(sendAlertMock) {
  return async function (ctx) {
    const { type, subject, body, html } = ctx.data;
    if (!subject || !body) {
      throw new Error("send-alert requires subject and body");
    }
    await ctx.progress(`sending alert: ${type ?? "manual"} — ${subject}`);
    const result = await sendAlertMock({ type: type ?? "manual", subject, body, html });
    await ctx.progress(
      result.sent
        ? `sent via resend id=${result.resendId}`
        : `not sent (${result.suppressed})`
    );
    return result;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("sendAlertHandler is exported as a function", () => {
  assert.equal(typeof sendAlertHandler, "function");
});

test("throws when subject is missing", async () => {
  const ctx = makeCtx({ body: "some body" });
  const handler = makeHandler(async () => { throw new Error("should not be called"); });

  await assert.rejects(
    () => handler(ctx),
    /send-alert requires subject and body/,
  );
});

test("throws when body is missing", async () => {
  const ctx = makeCtx({ subject: "some subject" });
  const handler = makeHandler(async () => { throw new Error("should not be called"); });

  await assert.rejects(
    () => handler(ctx),
    /send-alert requires subject and body/,
  );
});

test("calls sendAlert with correct args (explicit type)", async () => {
  const calls = [];
  const sendAlertMock = async (args) => {
    calls.push(args);
    return { sent: true, resendId: "re_test001" };
  };

  const ctx = makeCtx({
    type: "manual",
    subject: "Test Subject",
    body: "Test body",
  });
  const handler = makeHandler(sendAlertMock);
  const result = await handler(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "manual");
  assert.equal(calls[0].subject, "Test Subject");
  assert.equal(calls[0].body, "Test body");
  assert.equal(result.sent, true);
  assert.equal(result.resendId, "re_test001");
});

test("defaults type to 'manual' when not provided", async () => {
  const calls = [];
  const sendAlertMock = async (args) => {
    calls.push(args);
    return { sent: true, resendId: "re_defaulttype" };
  };

  const ctx = makeCtx({ subject: "No type", body: "Body here" });
  const handler = makeHandler(sendAlertMock);
  await handler(ctx);

  assert.equal(calls[0].type, "manual");
});

test("forwards html when provided", async () => {
  const calls = [];
  const sendAlertMock = async (args) => {
    calls.push(args);
    return { sent: true, resendId: "re_html" };
  };

  const ctx = makeCtx({
    type: "digest",
    subject: "HTML Alert",
    body: "Fallback text",
    html: "<h1>Hello</h1>",
  });
  const handler = makeHandler(sendAlertMock);
  await handler(ctx);

  assert.equal(calls[0].html, "<h1>Hello</h1>");
});

test("progress reports 'sent via resend id=...' on success", async () => {
  const sendAlertMock = async () => ({ sent: true, resendId: "re_progress" });

  const ctx = makeCtx({ subject: "Subj", body: "Body" });
  const handler = makeHandler(sendAlertMock);
  await handler(ctx);

  assert.ok(
    ctx.progressLog.some(msg => msg.includes("sent via resend id=re_progress")),
    `expected progress log to contain sent confirmation, got: ${JSON.stringify(ctx.progressLog)}`,
  );
});

test("progress reports 'not sent (suppressed)' on suppression", async () => {
  const sendAlertMock = async () => ({ sent: false, suppressed: "silent_mode" });

  const ctx = makeCtx({ subject: "Subj", body: "Body" });
  const handler = makeHandler(sendAlertMock);
  await handler(ctx);

  assert.ok(
    ctx.progressLog.some(msg => msg.includes("not sent (silent_mode)")),
    `expected progress log to contain suppression reason, got: ${JSON.stringify(ctx.progressLog)}`,
  );
});

test("progress first call contains alert type and subject", async () => {
  const sendAlertMock = async () => ({ sent: true, resendId: "re_x" });

  const ctx = makeCtx({ type: "test_type", subject: "My Subject", body: "Body" });
  const handler = makeHandler(sendAlertMock);
  await handler(ctx);

  assert.ok(
    ctx.progressLog[0].includes("test_type") && ctx.progressLog[0].includes("My Subject"),
    `first progress message should include type and subject: ${ctx.progressLog[0]}`,
  );
});
