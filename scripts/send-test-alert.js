// scripts/send-test-alert.js
// CLI wrapper to manually enqueue a send-alert job with a dummy payload.
// For smoke-testing the email pipeline without waiting for a real
// failure cluster or daily digest.
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    subject: { type: "string", default: "[Emersus] Test alert" },
    body:    { type: "string", default: "This is a test alert from send-test-alert.js" },
    detach:  { type: "boolean", default: false },
  },
});

// Note: the send-alert job handler doesn't exist yet — it's added in
// Milestone 10. Until then, this wrapper will enqueue a job that
// fails with "no handler for send-alert". That's expected — we're
// building the CLI surface here, not the delivery infrastructure.
await runAsJob("send-alert", {
  subject: values.subject,
  body: values.body,
}, { detach: values.detach });
