-- supabase/20260421_profile_billing_columns.sql
--
-- Denormalizes the latest Polar subscription state onto public.profiles
-- so the UI + usage endpoint can render "Renews on Y" or "Cancels on Y"
-- without scanning billing_events on every request. The webhook handler
-- writes all three columns on every subscription.* event with a user_id.
--
-- All columns are nullable so the migration is zero-downtime on existing
-- rows. A nightly reconciliation job (jobs/reconcile-billing-tiers.js)
-- patches any rows that get out of sync with Polar — belt-and-braces
-- against dropped webhook events.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_until             timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_status   text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end  boolean NOT NULL DEFAULT false;
