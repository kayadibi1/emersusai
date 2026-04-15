// api/auth/request-access.js
//
// POST /api/auth/request-access { name, email, invite_code? }
//
// - Validates the invite_code (if present) — currently a no-op until the
//   operator-issued invite system lands. Spec calls for HMAC-signed tokens;
//   for MVP we treat invite_code as a hint stored alongside the waitlist
//   row, and the operator manually approves + emails a real invite link.
// - Otherwise appends the request to public.waitlist_signups.
// - Returns { status: "waitlist", position } on success or
//   { status: "invited", next: "/auth/?panel=invite&token=..." } if the
//   invite_code matches a known approval (future work).

import { supabaseAdmin } from "../lib/clients.js";

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const INVITE_MAX = 64;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, EMAIL_MAX);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default async function requestAccessHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: "Auth backend unavailable." });
  }

  const { name = "", email: rawEmail = "", invite_code: rawInvite = "" } = req.body || {};
  const email = normalizeEmail(rawEmail);
  const cleanName = String(name || "").trim().slice(0, NAME_MAX);
  const inviteCode = String(rawInvite || "").trim().slice(0, INVITE_MAX);

  if (!email || !isEmail(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!cleanName) {
    return res.status(400).json({ error: "Name is required." });
  }

  // Future: if invite_code matches an HMAC-signed pre-approval, return
  // { status: "invited", next: "/auth/?panel=invite&token=..." }.
  // For now, pass-through to the waitlist.

  try {
    // Idempotent insert: existing rows (unique on email) update name + invite_code.
    const { error: upsertError } = await supabaseAdmin
      .from("waitlist_signups")
      .upsert(
        {
          email,
          name: cleanName,
          source: inviteCode ? `request-access:invite:${inviteCode}` : "request-access",
          page_url: "/auth/",
          user_agent: String(req.headers["user-agent"] || "").slice(0, 300),
        },
        { onConflict: "email" },
      );
    if (upsertError) throw upsertError;

    // Approximate position = current count (good enough for MVP).
    const { count } = await supabaseAdmin
      .from("waitlist_signups")
      .select("*", { count: "exact", head: true });

    res.json({ status: "waitlist", position: count || 1 });
  } catch (err) {
    console.error("request-access error", err);
    res.status(500).json({ error: "Could not submit your request." });
  }
}
