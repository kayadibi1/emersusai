// api/lib/email/templates/auth-welcome.js
// Email sent to users upon successful account creation. Introduces the app
// with sample prompts and highlights the key value propositions.

import { renderEmail } from "../shell.js";
import { renderStatRow, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthWelcome({ user, appUrl, samplePrompts = [] }) {
  const statsBlock = [
    renderStatRow({ label: "Ask anything", value: "Training, nutrition, supplements, recovery — all cited." }),
    renderStatRow({ label: "Every answer grounded", value: "Pulled from 2M+ peer-reviewed papers. No hallucinated references." }),
    renderStatRow({ label: "Your profile shapes the plan", value: "Injuries, equipment, and goals respected — no cookie-cutter programs." }),
  ].join("");

  const promptList = samplePrompts.length
    ? `<div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">Try asking</div>` +
      `<ul style="margin:0 0 16px; padding:0; list-style:none;">` +
      samplePrompts.map(p => `<li style="padding:10px 14px; margin:6px 0; background:${T.surfaceAlt}; border:1px solid ${T.line}; font-size:14px; color:${T.ink};">${esc(p)}</li>`).join("") +
      `</ul>`
    : "";

  const body = `
    <p style="margin:0 0 18px;">Your account is live. Here's what changes when you ask Emersus something:</p>
    ${statsBlock}
    ${promptList}
  `;
  return renderEmail({
    preheader: "Your Emersus account is live — start with a question.",
    eyebrow: "Account",
    title: "You're in.",
    body,
    cta: { label: "Open Emersus →", href: appUrl },
    footer: { toEmail: user.email },
  });
}
