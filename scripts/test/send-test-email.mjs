#!/usr/bin/env node
// scripts/test/send-test-email.mjs
// Render a single template with fixture data and actually send it via
// Resend. Use once per template during real-client QA.
//
// Usage:
//   node scripts/test/send-test-email.mjs --template auth-welcome --to sid@example.com

import { FIXTURES } from "../email-fixtures.js";
import * as senders from "../../api/lib/email/senders.js";

const SENDER_MAP = {
  "auth-verify":            senders.sendAuthVerify,
  "auth-reset":             senders.sendAuthReset,
  "auth-welcome":           senders.sendAuthWelcome,
  "auth-password-changed":  senders.sendAuthPasswordChanged,
  "billing-receipt":        senders.sendBillingReceipt,
  "billing-renewal":        senders.sendBillingRenewal,
  "billing-payment-failed": senders.sendBillingPaymentFailed,
  "billing-cancellation":   senders.sendBillingCancellation,
  "legal-tos-update":       senders.sendLegalTosUpdate,
  "legal-privacy-update":   senders.sendLegalPrivacyUpdate,
  "data-export-ready":      senders.sendDataExportReady,
  "research-new-paper":     senders.sendResearchNewPaper,
};

function arg(n, fb) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : fb; }

const template = arg("template");
const to       = arg("to");
if (!template || !to || !SENDER_MAP[template]) {
  console.error(`usage: --template <${Object.keys(SENDER_MAP).join("|")}> --to <email>`);
  process.exit(1);
}

const fx = FIXTURES[template];
const sender = SENDER_MAP[template];
// Unpack — most senders don't take `user`, they take `to` directly.
const { user: _ignored, ...rest } = fx;
const res = await sender({ userId: "qa-test-user", to, ...rest });
console.log(JSON.stringify(res, null, 2));
