// api/profile/complete-onboarding.js
//
// POST /api/profile/complete-onboarding
//
// Marks the authenticated user's onboarding as complete.
// Accepts an optional { reason } body:
//   - "completed"    (default) — natural completion; onboarding_skipped_at stays null
//   - "user_skipped" — user explicitly skipped; onboarding_skipped_at is stamped
//
// Uses fetch + Supabase REST directly so the handler is easily testable without
// mocking the @supabase/supabase-js client.

import { capture } from "../lib/analytics.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function completeOnboardingHandler(req, res) {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const reason = String(req.body?.reason || "completed");
  const patch = { onboarding_completed: true };
  if (reason === "user_skipped") {
    patch.onboarding_skipped_at = new Date().toISOString();
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      },
    );
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("complete-onboarding patch failed", resp.status, errText);
      return res.status(502).json({ error: "profile_update_failed" });
    }
    const body = await resp.json();
    const progressAtSkip = body?.[0]?.onboarding_progress ?? null;

    capture(userId, reason === "user_skipped" ? "onboarding_skipped" : "onboarding_completed", {
      progress_at_event: progressAtSkip,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("complete-onboarding handler error", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
