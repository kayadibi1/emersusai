// jobs/reconcile-billing-tiers.js
//
// Nightly safety net: finds profiles with tier='pro' whose Polar
// subscription is no longer active/trialing, and demotes them. Also
// refreshes pro_until / subscription_status / cancel_at_period_end from
// Polar so the UI stays honest even when a webhook event was dropped.
//
// Why: the webhook is the primary source of truth, but (a) Polar can
// drop events (we saw this once on 2026-04-20 — see project memory),
// and (b) historical deliveries that failed with old code stopped
// retrying. This cron closes those loops. It is read-mostly from
// Polar and write-only on divergence, so concurrent runs are safe.
//
// Payload: { dryRun?: boolean, batchSize?: number, concurrency?: number }
//   batchSize  — max profiles to check per run (default 500)
//   concurrency — how many Polar SDK calls run in parallel (default 4)
// Returns: { scanned, demoted, synced, errors, dryRun }

import { requirePolar } from "../api/billing/polar-client.js";
import { invalidateTier } from "../api/emersus/user-rate-limit.js";

const DEFAULT_BATCH = 500;
// Keep parallelism low: a bad Polar API day should cost us a few extra
// seconds of runtime, not a rate-limit ban. 2 in-flight is more than
// enough for any realistic pro-user count in the near future and still
// lets the job finish a 500-row batch in well under the job timeout.
const DEFAULT_CONCURRENCY = 2;
const ACTIVE_POLAR_STATUSES = new Set(["active", "trialing"]);

/**
 * Pure reconciliation — iterates profile rows, asks Polar about each
 * user's current subscription, and calls the injected updateProfile
 * whenever it diverges from what we store. Kept deliberately
 * dep-injected so the unit test can stub polar + the update sink.
 *
 * @param {object} args
 * @param {Array<{id,tier,pro_until,subscription_status,cancel_at_period_end}>} args.profiles
 * @param {{subscriptions:{list:Function}}} args.polar
 * @param {(id:string, patch:object)=>Promise<{error?:any}>} args.updateProfile
 * @param {boolean} [args.dryRun]
 * @param {number}  [args.concurrency]
 * @param {(id:string)=>void} [args.onInvalidate]
 * @param {{warn?:Function}}  [args.log]
 */
export async function reconcileProfiles({
  profiles,
  polar,
  updateProfile,
  dryRun = false,
  concurrency = DEFAULT_CONCURRENCY,
  onInvalidate = invalidateTier,
  log = console,
}) {
  const summary = { scanned: 0, demoted: 0, synced: 0, errors: 0 };
  if (!profiles?.length) return summary;

  // Bounded parallelism so a nightly sweep can't accidentally stampede
  // Polar. Exact published rate-limit numbers vary by account and
  // endpoint, so we stay conservative rather than pretend to know them.
  for (let i = 0; i < profiles.length; i += concurrency) {
    const slice = profiles.slice(i, i + concurrency);
    await Promise.all(slice.map(async (profile) => {
      summary.scanned++;
      let polarRes;
      try {
        polarRes = await polar.subscriptions.list({
          externalCustomerId: profile.id,
          limit: 5,
        });
      } catch (err) {
        summary.errors++;
        log.warn?.(`[reconcile] polar list failed for ${profile.id}:`, err?.message || err);
        return;
      }

      // Polar's SDK returns a PageIterator; depending on version the
      // items live on .result.items or .items. If the shape is anything
      // else, treat it as an error rather than falling back to an empty
      // list — a silent [] would look like "user has no subscription"
      // and demote every pro user if Polar ever changes the envelope.
      const itemsRaw = polarRes?.result?.items ?? polarRes?.items;
      if (!Array.isArray(itemsRaw)) {
        summary.errors++;
        log.warn?.(
          `[reconcile] unexpected Polar response shape for ${profile.id}`,
          { keys: polarRes ? Object.keys(polarRes) : null }
        );
        return;
      }
      const items = itemsRaw;
      const latestActive = items.find((s) => ACTIVE_POLAR_STATUSES.has(s.status));
      const latestAny = items[0] || null;
      const source = latestActive || latestAny;

      if (!source) {
        // No sub on Polar → user shouldn't be pro. Demote.
        if (profile.tier === "pro") summary.demoted++;
        if (dryRun) return;
        const { error } = await updateProfile(profile.id, {
          tier: "free",
          subscription_status: null,
          cancel_at_period_end: false,
          pro_until: null,
        });
        if (error) {
          summary.errors++;
          log.warn?.(`[reconcile] demote update failed for ${profile.id}:`, error.message);
          return;
        }
        onInvalidate(profile.id);
        return;
      }

      const nextTier = latestActive ? "pro" : "free";
      const nextStatus = source.status ?? null;
      const nextCancelFlag = Boolean(source.cancelAtPeriodEnd ?? source.cancel_at_period_end);
      const nextProUntil =
        source.currentPeriodEnd ??
        source.current_period_end ??
        source.endsAt ??
        source.ends_at ??
        null;

      const diverges =
        profile.tier !== nextTier ||
        (profile.subscription_status ?? null) !== (nextStatus ?? null) ||
        Boolean(profile.cancel_at_period_end) !== nextCancelFlag ||
        (profile.pro_until ?? null) !== (nextProUntil ?? null);

      if (!diverges) return;

      if (profile.tier === "pro" && nextTier === "free") summary.demoted++;
      else summary.synced++;

      if (dryRun) return;

      const { error } = await updateProfile(profile.id, {
        tier: nextTier,
        subscription_status: nextStatus,
        cancel_at_period_end: nextCancelFlag,
        pro_until: nextProUntil,
      });
      if (error) {
        summary.errors++;
        log.warn?.(`[reconcile] sync update failed for ${profile.id}:`, error.message);
        return;
      }
      if (profile.tier !== nextTier) onInvalidate(profile.id);
    }));
  }

  return summary;
}

export async function reconcileBillingTiersHandler(ctx, deps) {
  const {
    dryRun = false,
    batchSize = DEFAULT_BATCH,
    concurrency = DEFAULT_CONCURRENCY,
  } = ctx.data || {};
  const { sql, log } = deps;

  await ctx.progress(`reconcile start (dryRun=${dryRun}, batch=${batchSize})`);

  // Load candidates: every pro profile. Free→pro recovery is explicitly
  // NOT done here — missed "activate" events are rarer than missed
  // "revoked" ones, and scanning every free row nightly isn't cheap.
  const { rows: profiles } = await sql`
    SELECT id, tier, pro_until, subscription_status, cancel_at_period_end
    FROM public.profiles
    WHERE tier = 'pro'
    ORDER BY pro_until NULLS FIRST
    LIMIT ${batchSize}
  `;

  if (!profiles.length) {
    await ctx.progress("no pro profiles to reconcile");
    return { scanned: 0, demoted: 0, synced: 0, errors: 0, dryRun };
  }

  const polar = requirePolar();

  // Fixed 4-column update — the shape of every patch we produce below.
  // Keeps us on the tagged-template sql helper without dynamic SQL.
  const updateProfile = async (id, patch) => {
    try {
      await sql`
        UPDATE public.profiles
        SET tier = ${patch.tier},
            subscription_status = ${patch.subscription_status},
            cancel_at_period_end = ${patch.cancel_at_period_end},
            pro_until = ${patch.pro_until}
        WHERE id = ${id}
      `;
      return { error: null };
    } catch (err) {
      return { error: { message: err.message } };
    }
  };

  const summary = await reconcileProfiles({
    profiles,
    polar,
    updateProfile,
    dryRun,
    concurrency,
    log,
  });

  await ctx.progress(
    `reconcile done: scanned=${summary.scanned} demoted=${summary.demoted} ` +
    `synced=${summary.synced} errors=${summary.errors}`
  );
  return { ...summary, dryRun };
}
