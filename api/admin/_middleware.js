// api/admin/_middleware.js
import { supabaseAdmin } from "../lib/clients.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

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

    const email = data.user.email.trim().toLowerCase();
    if (ADMIN_EMAILS.length === 0 || !ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: "forbidden" });
    }

    req.adminUser = data.user;
    next();
  } catch (err) {
    console.error("[admin-auth] error:", err);
    return res.status(500).json({ error: "auth failure" });
  }
}
