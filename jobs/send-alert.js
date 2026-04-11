// jobs/send-alert.js
// Pg-boss handler wrapping api/lib/alerts.js#sendAlert. Enables any
// part of the system to enqueue an alert via boss.send("send-alert", payload)
// instead of importing sendAlert directly. Used by scripts/send-test-alert.js
// and potentially future admin buttons.
import { sendAlert } from "../api/lib/alerts.js";

export async function sendAlertHandler(ctx) {
  const { type, subject, body, html } = ctx.data;
  if (!subject || !body) {
    throw new Error("send-alert requires subject and body");
  }
  await ctx.progress(`sending alert: ${type ?? "manual"} — ${subject}`);
  const result = await sendAlert({ type: type ?? "manual", subject, body, html });
  await ctx.progress(
    result.sent
      ? `sent via resend id=${result.resendId}`
      : `not sent (${result.suppressed})`
  );
  return result;
}
