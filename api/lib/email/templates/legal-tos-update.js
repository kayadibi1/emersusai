import { renderEmail } from "../shell.js";
import { renderCallout, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderLegalTosUpdate({ user, summary, changes = [], effectiveAt, termsUrl }) {
  const bullets = changes.map(c => `<li style="padding:4px 0; color:${T.muted}; line-height:1.55;">${esc(c)}</li>`).join("");
  const body = `
    ${renderCallout({ tone: "info", title: "Summary", body: summary })}
    <div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">What's changing</div>
    <ul style="margin:0 0 18px; padding-left:20px;">${bullets}</ul>
    <p style="margin:14px 0 0; color:${T.muted}; font-size:14px;">Effective <strong style="color:${T.ink};">${esc(effectiveAt)}</strong>. Continued use of Emersus after that date constitutes acceptance.</p>
  `;
  return renderEmail({
    preheader: `Updated Terms of Service — effective ${effectiveAt}.`,
    eyebrow: "Legal",
    title: "We're updating our terms.",
    body,
    cta: { label: "Read the updated terms →", href: termsUrl },
    footer: { toEmail: user.email },
  });
}
