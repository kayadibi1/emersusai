import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingRenewal({ user, plan, nextChargeAt, amount, manageUrl }) {
  const stats = [
    renderStatRow({ label: "Plan",        value: plan }),
    renderStatRow({ label: "Next charge", value: nextChargeAt }),
    renderStatRow({ label: "Amount",      value: amount }),
  ].join("");
  const body = `
    <p style="margin:0 0 18px;">Heads up — your Emersus subscription renews in 7 days. No action needed if you're staying on.</p>
    ${stats}
    <p style="margin:16px 0 0; color:${T.dim}; font-size:13px;">Cancel anytime from Settings → Billing. You keep access through the end of the period.</p>
  `;
  return renderEmail({
    preheader: `Your ${plan} renews ${nextChargeAt} for ${amount}.`,
    eyebrow: "Billing",
    title: "Renewal in 7 days.",
    body,
    cta: { label: "Manage subscription →", href: manageUrl },
    footer: { toEmail: user.email },
  });
}
