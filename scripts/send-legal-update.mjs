#!/usr/bin/env node
// scripts/send-legal-update.mjs
// Broadcast a legal update (ToS or Privacy) to all confirmed users.
//
// Usage:
//   node scripts/send-legal-update.mjs --template tos-update \
//     --date 2026-05-15 \
//     --summary "..." \
//     --change "..." --change "..." \
//     [--dry-run] [--limit 100]
//
// Sleeps 1s between sends to stay under Resend's default rate limit.
// Use --dry-run first to confirm the target list before a real broadcast.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendLegalTosUpdate, sendLegalPrivacyUpdate } from "../api/lib/email/senders.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}

const template = arg("template");
const date     = arg("date");
const summary  = arg("summary");
const changes  = args("change");
const dryRun   = process.argv.includes("--dry-run");
const limit    = Number(arg("limit", "0")) || null;

if (!template || !date || !summary || !changes.length) {
  console.error("usage: --template tos-update|privacy-update --date YYYY-MM-DD --summary ... --change ... [--change ...]");
  process.exit(1);
}
const sender = template === "tos-update"     ? sendLegalTosUpdate
             : template === "privacy-update" ? sendLegalPrivacyUpdate
             : null;
if (!sender) {
  console.error(`unknown template ${template}`);
  process.exit(1);
}

const { data: users, error } = await supabaseAdmin
  .from("profiles")
  .select("id, email")
  .not("email", "is", null)
  .limit(limit || 100000);
if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`targeting ${users.length} users${dryRun ? " (DRY RUN)" : ""}`);
let sent = 0;
let failed = 0;
for (const u of users) {
  try {
    if (dryRun) {
      console.log(`[dry] ${u.email}`);
    } else {
      await sender({
        userId: u.id,
        to: u.email,
        summary,
        changes,
        effectiveAt: date,
      });
    }
    sent++;
    if (!dryRun) await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    failed++;
    console.error(`failed ${u.email}: ${err.message}`);
  }
}
console.log(`done: sent=${sent} failed=${failed}`);
