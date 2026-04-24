// jobs/email-renewal-reminder.js
// pg-boss handler: daily 10:00 NY. Emails Pro subscribers whose renewal
// is ~7 days away. Idempotency key: `renewal:${userId}:${proUntil}`
// guarantees one email per renewal cycle even if the cron fires twice.
//
// Schema notes (no user_subscriptions table):
//   Renewal date lives on profiles.pro_until (timestamptz).
//   profiles.id is the user_id (uuid PK, mirrors auth.users.id).
//   profiles.email is populated by the handle_new_user_profile trigger.
//   profiles.tier = 'pro' identifies active subscribers.
//   profiles.subscription_status = 'manual' are admin-granted rows
//   that have no Polar subscription — skip them to avoid false reminders.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendBillingRenewal } from "../api/lib/email/senders.js";

export async function emailRenewalReminderHandler(ctx, { log } = {}) {
  await ctx.progress?.("querying pro profiles renewing in ~7 days");

  const now = new Date();
  const sixDays   = new Date(now.getTime() + 6 * 86_400_000);
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000);

  // Query profiles directly — there is no user_subscriptions table.
  // pro_until maps to "current_period_end" from Polar webhooks.
  // Exclude manual admin grants (subscription_status = 'manual') since
  // they have no Polar subscription and would produce spurious reminders.
  const { data: rows, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, tier, pro_until, subscription_status")
    .eq("tier", "pro")
    .neq("subscription_status", "manual")
    .gte("pro_until", sixDays.toISOString())
    .lte("pro_until", sevenDays.toISOString());

  if (error) {
    log?.warn?.("[email-renewal-reminder] profiles query failed", { err: error.message });
    return { sent: 0, skipped: 0, reason: "query_failed" };
  }

  await ctx.progress?.(`found ${rows?.length || 0} renewals to remind`);

  let sent = 0;
  let skipped = 0;

  for (const profile of rows || []) {
    try {
      if (!profile.email) {
        log?.warn?.("[email-renewal-reminder] no email on profile", { user_id: profile.id });
        skipped++;
        continue;
      }

      // Idempotency key: one email per (user, renewal cycle).
      // pro_until is the canonical end of the current billing period.
      const idempotencyKey = `renewal:${profile.id}:${profile.pro_until}`;

      const fmt = new Date(profile.pro_until).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });

      const res = await sendBillingRenewal({
        userId: profile.id,
        to: profile.email,
        plan: "Pro",
        nextChargeAt: fmt,
        amount: "$9.00",
        idempotencyKey,
      });

      if (res?.skipped) skipped++;
      else sent++;
    } catch (err) {
      log?.warn?.("[email-renewal-reminder] per-row failure", {
        err: err.message,
        user_id: profile.id,
      });
      skipped++;
    }
  }

  await ctx.progress?.(`sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}
