// api/admin/_middleware.js
import { supabaseAdmin } from "../lib/clients.js";

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.email) {
      return res.status(401).json({ error: "invalid session" });
    }

    const allow = parseAdminEmails();
    if (allow.length === 0 || !allow.includes(data.user.email)) {
      return res.status(403).json({ error: "forbidden" });
    }

    req.adminUser = data.user;
    next();
  } catch (err) {
    return res.status(500).json({ error: "auth failure", detail: err.message });
  }
}
