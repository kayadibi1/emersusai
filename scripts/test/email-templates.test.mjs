import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../email-fixtures.js";
import { renderAuthVerify } from "../../api/lib/email/templates/auth-verify.js";
import { renderAuthReset } from "../../api/lib/email/templates/auth-reset.js";
import { renderAuthWelcome } from "../../api/lib/email/templates/auth-welcome.js";
import { renderAuthPasswordChanged } from "../../api/lib/email/templates/auth-password-changed.js";
import { renderBillingReceipt } from "../../api/lib/email/templates/billing-receipt.js";
import { renderBillingRenewal } from "../../api/lib/email/templates/billing-renewal.js";
import { renderBillingPaymentFailed } from "../../api/lib/email/templates/billing-payment-failed.js";
import { renderBillingCancellation } from "../../api/lib/email/templates/billing-cancellation.js";

test("auth-verify: renders full HTML document", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Confirm your email\./);
});

test("auth-verify: contains the confirmation URL in the CTA", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  assert.match(html, new RegExp(escRe(fx.confirmUrl)));
});

test("auth-verify: escapes hostile strings from fixture", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  // Fixture user name contains <script>alert(1)</script>
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("auth-verify: shows the URL in a code block fallback", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  // The monospace code block uses word-break:break-all
  assert.match(html, /word-break:\s*break-all/);
});

test("auth-reset: includes reset URL + expiry + warning callout", () => {
  const fx = FIXTURES["auth-reset"];
  const html = renderAuthReset(fx);
  assert.match(html, new RegExp(escRe(fx.resetUrl)));
  assert.match(html, /60 minutes/);
  assert.match(html, /rgba\(251,191,36,0\.08\)/);
});

test("auth-welcome: lists sample prompts and app URL", () => {
  const fx = FIXTURES["auth-welcome"];
  const html = renderAuthWelcome(fx);
  assert.match(html, new RegExp(escRe(fx.appUrl)));
  for (const p of fx.samplePrompts) {
    assert.match(html, new RegExp(escRe(p)));
  }
  assert.match(html, /You&#39;re in\./);
});

test("auth-password-changed: shows device, location, IP + danger callout + reset CTA", () => {
  const fx = FIXTURES["auth-password-changed"];
  const html = renderAuthPasswordChanged(fx);
  assert.match(html, /Chrome on macOS/);
  assert.match(html, /Brooklyn, NY/);
  assert.match(html, /24\.186\.xxx\.xxx/);
  assert.match(html, /rgba\(248,113,113,0\.08\)/);
  assert.match(html, new RegExp(escRe(fx.resetUrl)));
});

test("billing-receipt: shows plan, period, amount, card last-4", () => {
  const fx = FIXTURES["billing-receipt"];
  const html = renderBillingReceipt(fx);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /\$9\.00/);
  assert.match(html, /4242/);
  assert.match(html, new RegExp(escRe(fx.invoiceUrl)));
});

test("billing-renewal: shows plan, next charge, amount, manage URL", () => {
  const fx = FIXTURES["billing-renewal"];
  const html = renderBillingRenewal(fx);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /May 1, 2026/);
  assert.match(html, /\$9\.00/);
  assert.match(html, new RegExp(escRe(fx.manageUrl)));
});

test("billing-payment-failed: warning callout, card last-4, retry + final-attempt dates", () => {
  const fx = FIXTURES["billing-payment-failed"];
  const html = renderBillingPaymentFailed(fx);
  assert.match(html, /rgba\(251,191,36,0\.08\)/);
  assert.match(html, /0341/);
  assert.match(html, /Apr 27, 2026/);
  assert.match(html, /May 1, 2026/);
  assert.match(html, new RegExp(escRe(fx.updateUrl)));
});

test("billing-cancellation: shows accessThrough, refund, reactivate URL", () => {
  const fx = FIXTURES["billing-cancellation"];
  const html = renderBillingCancellation(fx);
  assert.match(html, /May 24, 2026/);
  assert.match(html, /No refund/);
  assert.match(html, new RegExp(escRe(fx.reactivateUrl)));
});

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
