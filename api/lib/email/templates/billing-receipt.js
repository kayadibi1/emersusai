import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingReceipt({ user, plan, period, amount, cardLast4, invoiceUrl }) {
  const stats = [
    renderStatRow({ label: "Plan",     value: plan }),
    renderStatRow({ label: "Period",   value: period }),
    renderStatRow({ label: "Amount",   value: amount }),
    renderStatRow({ label: "Card",     value: `•••• ${cardLast4}` }),
  ].join("");

  const body = `
    <p style="margin:0 0 18px;">Thanks for supporting Emersus. Your receipt is below.</p>
    ${stats}
    <p style="margin:16px 0 0; color:${T.dim}; font-size:13px;">Questions? Reply to this email and we'll sort it.</p>
  `;
  return renderEmail({
    preheader: `Receipt · ${amount} · ${plan}`,
    eyebrow: "Billing",
    title: "Receipt.",
    body,
    cta: { label: "View invoice →", href: invoiceUrl },
    footer: { toEmail: user.email },
  });
}
