-- supabase/20260421_profile_tier_column.sql
--
-- Adds the billing tier column used by the per-user rate-limit middleware
-- and (later) the Polar webhook. Binary enum for now: 'free' | 'pro'.
-- Existing rows default to 'free' so deployment is zero-downtime.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'pro'));

CREATE INDEX IF NOT EXISTS profiles_tier_idx ON public.profiles(tier);
