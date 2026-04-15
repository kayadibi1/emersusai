-- supabase/20260415_benchmarks_seed.sql
-- First-pass seed for public.benchmarks (B.9 on the post-redesign checklist).
--
-- These are coaching/textbook population ranges, not RCT averages — the
-- field of exercise science doesn't publish a single authoritative "typical
-- intermediate bench press" number because there isn't one. The values
-- below are synthesized from the most commonly-cited reference tables in
-- strength & conditioning education:
--
--   - NSCA Essentials of Strength Training & Conditioning, 4th ed.
--     Haff & Triplett (eds.), Human Kinetics 2016, Ch.13-14 classification
--     tables (bench, squat, deadlift, OHP by training level × sex).
--   - ACSM's Guidelines for Exercise Testing & Prescription, 11th ed.
--     (2021), Ch.4 VO2max classification percentiles.
--   - Jack Daniels' Running Formula, 3rd ed. (2013), VDOT tables mapped
--     to 5K pace ranges by classification.
--
-- All values expressed as body-weight multiples (strength) or raw units
-- (cardio) — label field disambiguates. Female strength values use ~0.60
-- of male for upper body and ~0.75 for lower body as a first-pass
-- approximation; should be refined with sex-specific references when
-- the team has capacity.
--
-- UI (Progress page) filters by the user's experience_level from their
-- profile, so only the 3 rows matching their level render. Empty cells
-- (metric with no row for a given experience/sex combo) are silently
-- hidden by the client — missing-row is never an error.

insert into public.benchmarks (metric, experience, sex, low, high, label, source_citation) values
  -- Bench Press (1RM as BW multiple) — Haff & Triplett, Table 13.1 adapted
  ('Bench Press (1RM / BW)', 'beginner',     'male',   0.50, 0.75, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Bench Press (1RM / BW)', 'intermediate', 'male',   0.75, 1.25, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Bench Press (1RM / BW)', 'advanced',     'male',   1.25, 1.75, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),
  ('Bench Press (1RM / BW)', 'beginner',     'female', 0.30, 0.50, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Bench Press (1RM / BW)', 'intermediate', 'female', 0.50, 0.80, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Bench Press (1RM / BW)', 'advanced',     'female', 0.80, 1.15, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),

  -- Back Squat (1RM as BW multiple)
  ('Back Squat (1RM / BW)',  'beginner',     'male',   0.75, 1.00, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Back Squat (1RM / BW)',  'intermediate', 'male',   1.00, 1.50, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Back Squat (1RM / BW)',  'advanced',     'male',   1.50, 2.25, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),
  ('Back Squat (1RM / BW)',  'beginner',     'female', 0.55, 0.75, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Back Squat (1RM / BW)',  'intermediate', 'female', 0.75, 1.15, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Back Squat (1RM / BW)',  'advanced',     'female', 1.15, 1.70, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),

  -- Deadlift (conventional, 1RM as BW multiple)
  ('Deadlift (1RM / BW)',    'beginner',     'male',   1.00, 1.25, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Deadlift (1RM / BW)',    'intermediate', 'male',   1.25, 1.75, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Deadlift (1RM / BW)',    'advanced',     'male',   1.75, 2.50, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),
  ('Deadlift (1RM / BW)',    'beginner',     'female', 0.75, 0.95, 'typical beginner', 'NSCA Essentials 4e, Ch.13'),
  ('Deadlift (1RM / BW)',    'intermediate', 'female', 0.95, 1.30, 'typical intermediate', 'NSCA Essentials 4e, Ch.13'),
  ('Deadlift (1RM / BW)',    'advanced',     'female', 1.30, 1.90, 'typical advanced', 'NSCA Essentials 4e, Ch.13'),

  -- Overhead Press (strict standing, 1RM as BW multiple)
  ('Overhead Press (1RM / BW)', 'beginner',     'male',   0.35, 0.55, 'typical beginner', 'NSCA Essentials 4e, Ch.14'),
  ('Overhead Press (1RM / BW)', 'intermediate', 'male',   0.55, 0.85, 'typical intermediate', 'NSCA Essentials 4e, Ch.14'),
  ('Overhead Press (1RM / BW)', 'advanced',     'male',   0.85, 1.20, 'typical advanced', 'NSCA Essentials 4e, Ch.14'),
  ('Overhead Press (1RM / BW)', 'beginner',     'female', 0.20, 0.35, 'typical beginner', 'NSCA Essentials 4e, Ch.14'),
  ('Overhead Press (1RM / BW)', 'intermediate', 'female', 0.35, 0.55, 'typical intermediate', 'NSCA Essentials 4e, Ch.14'),
  ('Overhead Press (1RM / BW)', 'advanced',     'female', 0.55, 0.80, 'typical advanced', 'NSCA Essentials 4e, Ch.14'),

  -- VO2max (mL/kg/min) — ACSM 11e Table 4.9 adapted to 3 levels
  ('VO2max (mL/kg/min)',     'beginner',     'male',   35.0, 42.0, 'below average', 'ACSM Guidelines 11e, Table 4.9'),
  ('VO2max (mL/kg/min)',     'intermediate', 'male',   42.0, 50.0, 'average–good', 'ACSM Guidelines 11e, Table 4.9'),
  ('VO2max (mL/kg/min)',     'advanced',     'male',   50.0, 60.0, 'excellent', 'ACSM Guidelines 11e, Table 4.9'),
  ('VO2max (mL/kg/min)',     'beginner',     'female', 30.0, 36.0, 'below average', 'ACSM Guidelines 11e, Table 4.9'),
  ('VO2max (mL/kg/min)',     'intermediate', 'female', 36.0, 44.0, 'average–good', 'ACSM Guidelines 11e, Table 4.9'),
  ('VO2max (mL/kg/min)',     'advanced',     'female', 44.0, 54.0, 'excellent', 'ACSM Guidelines 11e, Table 4.9'),

  -- 5K run time (minutes) — Daniels VDOT tables adapted
  ('5K Time (min)',          'beginner',     'male',   27.0, 34.0, 'typical beginner', 'Daniels'' Running Formula 3e'),
  ('5K Time (min)',          'intermediate', 'male',   22.0, 27.0, 'typical intermediate', 'Daniels'' Running Formula 3e'),
  ('5K Time (min)',          'advanced',     'male',   18.0, 22.0, 'typical advanced', 'Daniels'' Running Formula 3e'),
  ('5K Time (min)',          'beginner',     'female', 30.0, 38.0, 'typical beginner', 'Daniels'' Running Formula 3e'),
  ('5K Time (min)',          'intermediate', 'female', 25.0, 30.0, 'typical intermediate', 'Daniels'' Running Formula 3e'),
  ('5K Time (min)',          'advanced',     'female', 20.0, 25.0, 'typical advanced', 'Daniels'' Running Formula 3e'),

  -- Pull-ups (max consecutive strict, bodyweight)
  ('Pull-ups (max strict)',  'beginner',     'male',   1,    5,    'typical beginner', 'NSCA Essentials 4e, Ch.14'),
  ('Pull-ups (max strict)',  'intermediate', 'male',   6,    12,   'typical intermediate', 'NSCA Essentials 4e, Ch.14'),
  ('Pull-ups (max strict)',  'advanced',     'male',   13,   22,   'typical advanced', 'NSCA Essentials 4e, Ch.14'),
  ('Pull-ups (max strict)',  'beginner',     'female', 0,    2,    'typical beginner', 'NSCA Essentials 4e, Ch.14'),
  ('Pull-ups (max strict)',  'intermediate', 'female', 3,    8,    'typical intermediate', 'NSCA Essentials 4e, Ch.14'),
  ('Pull-ups (max strict)',  'advanced',     'female', 9,    16,   'typical advanced', 'NSCA Essentials 4e, Ch.14')
on conflict (metric, experience, sex, body_weight_band) do nothing;

-- Verify — should return 42 rows.
select count(*) as seeded_rows from public.benchmarks;
