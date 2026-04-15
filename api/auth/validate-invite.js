// api/auth/validate-invite.js
//
// GET /api/auth/validate-invite?token=...
// Returns { email, expires_at } or 401 with { error }.
//
// Used by the /auth/?panel=invite landing page to validate the link before
// showing the password setup form.

import { verifyInviteToken } from "./invite-tokens.js";

export default async function validateInviteHandler(req, res) {
  const token = String(req.query?.token || "");
  const result = verifyInviteToken(token);
  if (!result.valid) {
    return res.status(401).json({ error: "Invite link is invalid or expired." });
  }
  res.json({ email: result.email, expires_at: result.expiresAt });
}
