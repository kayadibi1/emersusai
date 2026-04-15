// api/auth/accept-invite.js
//
// POST /api/auth/accept-invite { token, password }
//
// Validates the invite token; creates a Supabase user with the bound email
// + provided password (admin API, email confirmed=true so no extra round
// trip); returns the session payload so the client can store it.
//
// Idempotent for re-clicks: if a user already exists with the bound email,
// returns 409 with a hint to log in instead.

import { supabaseAdmin } from "../lib/clients.js";
import { verifyInviteToken } from "./invite-tokens.js";

export default async function acceptInviteHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!supabaseAdmin) return res.status(500).json({ error: "Auth backend unavailable." });

  const { token, password } = req.body || {};
  const verified = verifyInviteToken(String(token || ""));
  if (!verified.valid) return res.status(401).json({ error: "Invite link is invalid or expired." });
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: verified.email,
      password,
      email_confirm: true,
      user_metadata: { invite_accepted_at: new Date().toISOString() },
    });
    if (createError) {
      const code = createError.code || "";
      const msg = String(createError.message || "");
      // Supabase returns code: "email_exists" / "user_already_exists" with
      // status 422 when the account is already in auth.users. Fall back to a
      // message-pattern check for older versions / local Supabase forks.
      if (
        code === "email_exists" ||
        code === "user_already_exists" ||
        /already registered|already exists|email_exists/i.test(msg)
      ) {
        return res.status(409).json({ error: "An account with this email already exists. Please log in." });
      }
      throw createError;
    }
    res.json({ ok: true, user: { id: created.user?.id, email: created.user?.email } });
  } catch (err) {
    console.error("accept-invite error", err);
    res.status(500).json({ error: "Could not complete account setup." });
  }
}
