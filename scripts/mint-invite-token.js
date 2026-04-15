#!/usr/bin/env node
// scripts/mint-invite-token.js
//
// Operator helper: mint an HMAC-signed invite token for a given email.
// Prints the full /auth/?panel=invite&token=<jwt> link plus the bare token.
//
// Usage:
//   EMERSUS_INVITE_SECRET=... node scripts/mint-invite-token.js <email> [ttlDays]
//
// Defaults: ttlDays=14, max 90.

import { mintInviteToken } from "../api/auth/invite-tokens.js";

const [, , emailArg, ttlArg] = process.argv;

if (!emailArg || !emailArg.includes("@")) {
  console.error("usage: node scripts/mint-invite-token.js <email> [ttlDays]");
  process.exit(2);
}
if (!process.env.EMERSUS_INVITE_SECRET) {
  console.error("EMERSUS_INVITE_SECRET env var is required.");
  process.exit(2);
}

const ttlDays = ttlArg ? Number(ttlArg) : 14;
if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
  console.error(`ttlDays must be a positive number (got ${ttlArg}).`);
  process.exit(2);
}

const token = mintInviteToken(emailArg, ttlDays);
const base = process.env.EMERSUS_BASE_URL || "https://emersus.ai";

console.log(`Email:  ${emailArg.toLowerCase()}`);
console.log(`TTL:    ${Math.min(ttlDays, 90)} days`);
console.log(`Token:  ${token}`);
console.log(`Link:   ${base}/auth/?panel=invite&token=${token}`);
