import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout, renderCodeBlock } from "../components.js";
import { T } from "../tokens.js";

export function renderDataExportReady({ user, downloadUrl, size, rows, format, expiresIn, sha256 }) {
  const body = `
    <p style="margin:0 0 18px;">Your Emersus data export is ready. Download it below.</p>
    ${renderStatRow({ label: "Size",    value: size })}
    ${renderStatRow({ label: "Contents", value: rows })}
    ${renderStatRow({ label: "Format",  value: format })}
    ${renderCallout({ tone: "warning", title: "Link expires in " + expiresIn, body: "After that the file is deleted from our servers. You can always request a fresh export from your profile." })}
    <div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">SHA-256 checksum</div>
    ${renderCodeBlock({ code: sha256 })}
  `;
  return renderEmail({
    preheader: `Your ${size} export is ready — download link inside.`,
    eyebrow: "Data",
    title: "Your export is ready.",
    body,
    cta: { label: "Download export →", href: downloadUrl },
    footer: { toEmail: user.email },
  });
}
