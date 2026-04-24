#!/usr/bin/env node
// scripts/upload-resend-templates.mjs
// Emit the auth-verify or auth-reset email HTML with Supabase Auth template
// placeholders ({{ .ConfirmationURL }}, {{ .Email }}) baked into the CTA +
// fallback URL. Operator pastes stdout into the Supabase dashboard
// (Authentication → Email Templates → Confirm signup / Reset password).
//
// Variables Supabase substitutes at send time:
//   {{ .ConfirmationURL }}   full confirm/reset URL
//   {{ .Email }}              recipient email
//   {{ .SiteURL }}            configured site URL
//
// Usage:
//   node scripts/upload-resend-templates.mjs verify
//   node scripts/upload-resend-templates.mjs reset

import { renderAuthVerify } from "../api/lib/email/templates/auth-verify.js";
import { renderAuthReset  } from "../api/lib/email/templates/auth-reset.js";

const MODE = process.argv[2];
if (!MODE || !["verify", "reset"].includes(MODE)) {
  console.error("usage: node scripts/upload-resend-templates.mjs verify|reset");
  process.exit(1);
}

const SUPABASE_CONFIRM_URL = "{{ .ConfirmationURL }}";
const SUPABASE_EMAIL       = "{{ .Email }}";

let html;
if (MODE === "verify") {
  html = renderAuthVerify({
    user: { email: SUPABASE_EMAIL },
    confirmUrl: SUPABASE_CONFIRM_URL,
  });
} else {
  html = renderAuthReset({
    user: { email: SUPABASE_EMAIL },
    resetUrl: SUPABASE_CONFIRM_URL,
    expiresIn: "60 minutes",
  });
}

process.stdout.write(html);
