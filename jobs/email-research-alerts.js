// jobs/email-research-alerts.js
// pg-boss handler: daily 12:00 NY. Matches newly-ingested research papers
// against user topic follows, emails one marketing alert per match.
// Suppression-aware via sendResearchNewPaper (which consults email_unsubscribes).
//
// DEPENDS ON infrastructure that may not yet exist:
//   - `user_topic_follows` table
//   - `research_alerts_since(since_ts)` RPC returning rows with
//     {user_id, article_id, topic_label/topic_query, title, journal, year,
//      grade, abstract_short, doi}
// If either is missing, this handler logs + no-ops instead of throwing,
// so the worker doesn't go into a crash loop on startup.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendResearchNewPaper } from "../api/lib/email/senders.js";

const WINDOW_HOURS = 24;

export async function emailResearchAlertsHandler(ctx, { log } = {}) {
  await ctx.progress?.("finding newly-ingested papers + follows");
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  const { data: matches, error } = await supabaseAdmin.rpc("research_alerts_since", { since_ts: since });
  if (error) {
    log?.warn?.("[email-research-alerts] RPC missing or failed; skipping", { err: error.message });
    return { sent: 0, skipped: 0, reason: "rpc_missing" };
  }

  let sent = 0;
  let skipped = 0;
  for (const m of matches || []) {
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", m.user_id)
        .maybeSingle();
      const email = profile?.email;
      if (!email) { skipped++; continue; }

      const idempotencyKey = `research-alert:${m.user_id}:${m.article_id}`;
      const res = await sendResearchNewPaper({
        userId: m.user_id,
        to: email,
        topic: m.topic_label || m.topic_query || "your follow list",
        paper: {
          title: m.title,
          journal: m.journal || "—",
          year: m.year,
          grade: m.grade || "limited",
          abstract: (m.abstract_short || "").slice(0, 240),
          doi: m.doi,
        },
        reason: `Matches your follow on "${m.topic_label || m.topic_query}".`,
        idempotencyKey,
      });
      if (res?.skipped) skipped++;
      else sent++;
    } catch (err) {
      log?.warn?.("[email-research-alerts] per-match send failed", { err: err.message, user_id: m.user_id });
      skipped++;
    }
  }

  await ctx.progress?.(`sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}
