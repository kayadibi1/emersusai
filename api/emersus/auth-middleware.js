// api/emersus/auth-middleware.js
//
// Server-side JWT verification for recommendation endpoints.
// Extracts the Supabase user from the Authorization header so the
// pipeline uses a verified userId — never the self-asserted one from
// the request body.

import { supabaseAdmin } from "../lib/clients.js";

/**
 * Express middleware that verifies a Supabase JWT from the Authorization
 * header. On success, sets req.supabaseUser (the full user object) and
 * req.verifiedUserId (the UUID). On failure, returns 401.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !supabaseAdmin) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    req.supabaseUser = data.user;
    req.verifiedUserId = data.user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Authentication failed." });
  }
}

/**
 * Same as requireAuth, but also checks the ADMIN_EMAILS env var.
 * Used by the debug/recommendation-stream endpoint.
 */
export async function requireAuthAdmin(req, res, next) {
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

    const allow = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length === 0 || !allow.includes(data.user.email)) {
      return res.status(403).json({ error: "Forbidden." });
    }

    req.supabaseUser = data.user;
    req.verifiedUserId = data.user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Authentication failed." });
  }
}
