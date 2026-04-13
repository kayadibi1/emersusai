// api/me/role.js
//
// Returns the authenticated user's role. Replaces the client-side
// ADMIN_EMAILS check in shared/supabase.js so the admin email list
// isn't shipped to every browser.

import { supabaseAdmin } from "../lib/clients.js";

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !supabaseAdmin) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.email) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    const email = data.user.email.trim().toLowerCase();
    const isAdmin = parseAdminEmails().includes(email);

    return res.json({ role: isAdmin ? "admin" : "user" });
  } catch {
    return res.status(401).json({ error: "Authentication failed." });
  }
}
