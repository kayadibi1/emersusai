// api/emersus/integrations-waitlist.js
//
// POST /api/integrations/waitlist { integration_key }
//
// Authenticated. Records the user's interest in an upcoming integration so we
// can email them when it ships. Reuses the existing waitlist_signups table —
// each integration appends to the `source` field with `integration:<key>`.

import { supabaseAdmin } from "../lib/clients.js";

const ALLOWED_KEYS = new Set([
  "smartwatch_sync",
  "hr_chest_strap",
  "running_watch",
  "activity_platform",
  "scale_metrics",
  "cycling_computer",
]);

// Plain handler function; mounted under requireAuth in server.js so this file
// doesn't have to re-implement auth.
export default async function integrationsWaitlistHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });

  const key = String(req.body?.integration_key || "").trim();
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ error: "Unknown integration_key." });
  }
  const email = req.supabaseUser?.email;
  if (!email) return res.status(401).json({ error: "Email required." });

  try {
    const source = `integration:${key}`;
    const { data: existing } = await supabaseAdmin
      .from("waitlist_signups")
      .select("source")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const sources = String(existing.source || "").split(/\s*,\s*/).filter(Boolean);
      if (!sources.includes(source)) sources.push(source);
      await supabaseAdmin
        .from("waitlist_signups")
        .update({ source: sources.join(",") })
        .eq("email", email);
    } else {
      await supabaseAdmin
        .from("waitlist_signups")
        .insert({ email, source });
    }
    res.json({ ok: true, integration_key: key });
  } catch (err) {
    console.error("integrations waitlist error", err);
    res.status(500).json({ error: "Could not join waitlist." });
  }
}
