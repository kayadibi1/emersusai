-- 20260410_profile_extended_columns.sql
-- Add columns for conversational onboarding fields that the profile form
-- never captured. Existing RLS policies cover the full row, so no new
-- policies are needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_use_case text,
  ADD COLUMN IF NOT EXISTS equipment_access text,
  ADD COLUMN IF NOT EXISTS available_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS available_minutes_per_session smallint,
  ADD COLUMN IF NOT EXISTS sleep_stress_context text;
