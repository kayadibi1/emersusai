-- 20260420_profiles_onboarding_progress.sql
-- Adds progress tracking + skip timestamp to profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_progress real NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at timestamptz;

COMMENT ON COLUMN public.profiles.onboarding_progress IS
  'Fraction 0.0–1.0 of required onboarding fields captured. Computed server-side.';
COMMENT ON COLUMN public.profiles.onboarding_skipped_at IS
  'Non-null if the user dismissed onboarding before completing it.';

-- Backfill existing completed users to 1.0 so we don''t regress their UI.
UPDATE public.profiles
   SET onboarding_progress = 1.0
 WHERE onboarding_completed = true
   AND onboarding_progress < 1.0;
