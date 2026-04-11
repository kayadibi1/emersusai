-- Profile fields for share card display and tracking preferences.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name_public     text,
  ADD COLUMN IF NOT EXISTS mapbox_privacy_radius_m integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS default_pool_length_m   smallint,
  ADD COLUMN IF NOT EXISTS default_grade_system    text,
  ADD COLUMN IF NOT EXISTS preferred_sports        text[],
  ADD COLUMN IF NOT EXISTS distance_unit           text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_default_grade_system_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_grade_system_check
  CHECK (default_grade_system IS NULL OR default_grade_system IN ('V', 'YDS', 'Font', 'French'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_distance_unit_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_distance_unit_check
  CHECK (distance_unit IS NULL OR distance_unit IN ('km', 'mi'));
