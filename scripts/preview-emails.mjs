#!/usr/bin/env node
// scripts/preview-emails.mjs
// Render every template to ./.email-preview/<name>.html + an index.html
// linking to them. Optional filter arg = substring match on template name.
//
// Usage:
//   node scripts/preview-emails.mjs             # render all 12
//   node scripts/preview-emails.mjs receipt     # render only templates whose name contains 'receipt'

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./email-fixtures.js";

import { renderAuthVerify }            from "../api/lib/email/templates/auth-verify.js";
import { renderAuthReset }             from "../api/lib/email/templates/auth-reset.js";
import { renderAuthWelcome }           from "../api/lib/email/templates/auth-welcome.js";
import { renderAuthPasswordChanged }   from "../api/lib/email/templates/auth-password-changed.js";
import { renderBillingReceipt }        from "../api/lib/email/templates/billing-receipt.js";
import { renderBillingRenewal }        from "../api/lib/email/templates/billing-renewal.js";
import { renderBillingPaymentFailed }  from "../api/lib/email/templates/billing-payment-failed.js";
import { renderBillingCancellation }   from "../api/lib/email/templates/billing-cancellation.js";
import { renderLegalTosUpdate }        from "../api/lib/email/templates/legal-tos-update.js";
import { renderLegalPrivacyUpdate }    from "../api/lib/email/templates/legal-privacy-update.js";
import { renderDataExportReady }       from "../api/lib/email/templates/data-export-ready.js";
import { renderResearchNewPaper }      from "../api/lib/email/templates/research-new-paper.js";

const RENDERERS = {
  "auth-verify":            renderAuthVerify,
  "auth-reset":             renderAuthReset,
  "auth-welcome":           renderAuthWelcome,
  "auth-password-changed":  renderAuthPasswordChanged,
  "billing-receipt":        renderBillingReceipt,
  "billing-renewal":        renderBillingRenewal,
  "billing-payment-failed": renderBillingPaymentFailed,
  "billing-cancellation":   renderBillingCancellation,
  "legal-tos-update":       renderLegalTosUpdate,
  "legal-privacy-update":   renderLegalPrivacyUpdate,
  "data-export-ready":      renderDataExportReady,
  "research-new-paper":     (fx) => renderResearchNewPaper({
    ...fx,
    unsubscribeUrl: "https://emersus.ai/api/email/unsubscribe?m=preview&b=research_alerts&k=demo",
  }),
};

async function main() {
  const filter = process.argv[2] || "";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = path.join(root, ".email-preview");
  await fs.mkdir(outDir, { recursive: true });

  const entries = Object.entries(RENDERERS).filter(([k]) => k.includes(filter));
  if (!entries.length) {
    console.error(`no templates match filter ${JSON.stringify(filter)}`);
    process.exit(1);
  }

  for (const [name, fn] of entries) {
    const fx = FIXTURES[name];
    if (!fx) {
      console.error(`no fixture for ${name}`);
      continue;
    }
    const html = fn(fx);
    await fs.writeFile(path.join(outDir, `${name}.html`), html);
    console.log(`rendered ${name}.html`);
  }

  const links = entries.map(([k]) => `<li><a href="./${k}.html">${k}</a></li>`).join("\n");
  const index = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Emersus email preview</title>
<style>body{background:#0a0a0b;color:#ededee;font-family:monospace;padding:32px;}
a{color:#34d399;text-decoration:none;}a:hover{text-decoration:underline;}
h1{font-size:16px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8a8f;}</style></head><body>
<h1>Emersus email preview — ${entries.length} template${entries.length === 1 ? "" : "s"}</h1>
<ul>${links}</ul></body></html>`;
  await fs.writeFile(path.join(outDir, "index.html"), index);

  console.log(`\nOpen: file://${path.join(outDir, "index.html").replace(/\\/g, "/")}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
