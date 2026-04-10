-- Exercise catalog for workout tracking.
-- Canonical exercise identifiers with aliases for fuzzy matching.
-- Category: resistance, cardio, bodyweight.
-- muscle_groups drives the volume-by-muscle heatmap.
-- auto_created = true for entries created by the matching fallback.

create extension if not exists pg_trgm;

create table if not exists public.exercises (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  aliases       text[] not null default '{}',
  muscle_groups text[] not null default '{}',
  equipment     text,
  category      text not null default 'resistance',
  movement_type text,
  auto_created  boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists exercises_slug_idx on public.exercises (slug);
create index if not exists exercises_category_idx on public.exercises (category);
create index if not exists exercises_name_trgm_idx on public.exercises using gin (name gin_trgm_ops);

-- RLS: exercises are public-readable, only service_role can mutate.
-- The upsert_workout_logs function runs as SECURITY DEFINER (service context)
-- so it can auto-create entries. Regular users only need SELECT.

alter table public.exercises enable row level security;

drop policy if exists "anyone can read exercises" on public.exercises;
create policy "anyone can read exercises"
on public.exercises
for select
to authenticated
using (true);

drop policy if exists "service role can manage exercises" on public.exercises;
create policy "service role can manage exercises"
on public.exercises
for all
to service_role
using (true)
with check (true);

-- ── Seed data ──────────────────────────────────────────────────────

insert into public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) values
-- Barbell compounds
('barbell_back_squat',         'Barbell Back Squat',         '{"Back Squat","BB Squat","Squat"}',                                       '{"quads","glutes","hamstrings"}',        'barbell',   'resistance', 'compound'),
('barbell_front_squat',        'Barbell Front Squat',        '{"Front Squat"}',                                                         '{"quads","glutes","core"}',              'barbell',   'resistance', 'compound'),
('barbell_bench_press',        'Barbell Bench Press',        '{"Bench Press","Flat Bench","BB Bench Press","Flat Barbell Bench Press"}',  '{"chest","triceps","front_delts"}',      'barbell',   'resistance', 'compound'),
('incline_barbell_bench',      'Incline Barbell Bench Press','{"Incline Bench","Incline Bench Press","Incline BB Bench"}',                '{"upper_chest","triceps","front_delts"}','barbell',   'resistance', 'compound'),
('decline_barbell_bench',      'Decline Barbell Bench Press','{"Decline Bench","Decline Bench Press"}',                                  '{"lower_chest","triceps"}',              'barbell',   'resistance', 'compound'),
('barbell_overhead_press',     'Barbell Overhead Press',     '{"OHP","Overhead Press","Military Press","Barbell Shoulder Press","Standing Press"}', '{"front_delts","side_delts","triceps"}', 'barbell', 'resistance', 'compound'),
('barbell_deadlift',           'Barbell Deadlift',           '{"Deadlift","Conventional Deadlift","DL"}',                                '{"hamstrings","glutes","back","traps"}', 'barbell',   'resistance', 'compound'),
('sumo_deadlift',              'Sumo Deadlift',              '{"Sumo DL"}',                                                             '{"quads","glutes","hamstrings","back"}',  'barbell',   'resistance', 'compound'),
('romanian_deadlift',          'Romanian Deadlift',          '{"RDL","Barbell RDL","Stiff-Leg Deadlift"}',                               '{"hamstrings","glutes","back"}',          'barbell',   'resistance', 'compound'),
('barbell_row',                'Barbell Row',                '{"Bent-Over Row","BB Row","Bent Over Barbell Row"}',                        '{"back","lats","biceps","rear_delts"}',   'barbell',   'resistance', 'compound'),
('pendlay_row',                'Pendlay Row',                '{}',                                                                       '{"back","lats","biceps"}',                'barbell',   'resistance', 'compound'),
('barbell_hip_thrust',         'Barbell Hip Thrust',         '{"Hip Thrust","BB Hip Thrust"}',                                           '{"glutes","hamstrings"}',                 'barbell',   'resistance', 'compound'),
('barbell_curl',               'Barbell Curl',               '{"BB Curl","Barbell Bicep Curl","Standing Barbell Curl"}',                  '{"biceps"}',                              'barbell',   'resistance', 'isolation'),
('close_grip_bench_press',     'Close-Grip Bench Press',     '{"CGBP","Close Grip Bench"}',                                             '{"triceps","chest"}',                     'barbell',   'resistance', 'compound'),

-- Dumbbell
('dumbbell_bench_press',       'Dumbbell Bench Press',       '{"DB Bench Press","DB Bench","Flat DB Bench"}',                            '{"chest","triceps","front_delts"}',       'dumbbell',  'resistance', 'compound'),
('incline_dumbbell_bench',     'Incline Dumbbell Bench Press','{"Incline DB Bench","Incline Dumbbell Press"}',                           '{"upper_chest","triceps","front_delts"}', 'dumbbell',  'resistance', 'compound'),
('dumbbell_shoulder_press',    'Dumbbell Shoulder Press',    '{"DB Shoulder Press","DB OHP","Seated Dumbbell Press"}',                   '{"front_delts","side_delts","triceps"}',  'dumbbell',  'resistance', 'compound'),
('dumbbell_row',               'Dumbbell Row',               '{"DB Row","One-Arm DB Row","Single-Arm Dumbbell Row"}',                    '{"back","lats","biceps"}',                'dumbbell',  'resistance', 'compound'),
('goblet_squat',               'Goblet Squat',               '{}',                                                                       '{"quads","glutes"}',                      'dumbbell',  'resistance', 'compound'),
('dumbbell_lunge',             'Dumbbell Lunge',             '{"DB Lunge","Dumbbell Lunges","Lunges"}',                                  '{"quads","glutes","hamstrings"}',         'dumbbell',  'resistance', 'compound'),
('walking_lunge',              'Walking Lunge',              '{"Walking Lunges","DB Walking Lunge"}',                                    '{"quads","glutes","hamstrings"}',         'dumbbell',  'resistance', 'compound'),
('dumbbell_rdl',               'Dumbbell Romanian Deadlift', '{"DB RDL","Dumbbell RDL"}',                                               '{"hamstrings","glutes"}',                 'dumbbell',  'resistance', 'compound'),
('dumbbell_curl',              'Dumbbell Curl',              '{"DB Curl","Dumbbell Bicep Curl","DB Bicep Curl"}',                        '{"biceps"}',                              'dumbbell',  'resistance', 'isolation'),
('hammer_curl',                'Hammer Curl',                '{"DB Hammer Curl","Dumbbell Hammer Curl"}',                                '{"biceps","forearms"}',                   'dumbbell',  'resistance', 'isolation'),
('dumbbell_lateral_raise',     'Dumbbell Lateral Raise',     '{"Lateral Raise","DB Lateral Raise","Side Raise","Side Lateral Raise"}',   '{"side_delts"}',                          'dumbbell',  'resistance', 'isolation'),
('dumbbell_fly',               'Dumbbell Fly',               '{"DB Fly","Flat Dumbbell Fly","Chest Fly"}',                               '{"chest"}',                               'dumbbell',  'resistance', 'isolation'),
('dumbbell_reverse_fly',       'Dumbbell Reverse Fly',       '{"Reverse Fly","DB Reverse Fly","Rear Delt Fly"}',                         '{"rear_delts"}',                          'dumbbell',  'resistance', 'isolation'),
('concentration_curl',         'Concentration Curl',         '{}',                                                                       '{"biceps"}',                              'dumbbell',  'resistance', 'isolation'),

-- Cable / machine
('cable_fly',                  'Cable Fly',                  '{"Cable Crossover","Cable Chest Fly"}',                                    '{"chest"}',                               'cable',     'resistance', 'isolation'),
('face_pull',                  'Face Pull',                  '{"Cable Face Pull"}',                                                      '{"rear_delts","traps","rotator_cuff"}',   'cable',     'resistance', 'isolation'),
('tricep_pushdown',            'Tricep Pushdown',            '{"Cable Pushdown","Rope Pushdown","Tricep Rope Pushdown"}',                '{"triceps"}',                             'cable',     'resistance', 'isolation'),
('overhead_tricep_extension',  'Overhead Tricep Extension',  '{"Overhead Cable Extension","Cable Overhead Extension"}',                  '{"triceps"}',                             'cable',     'resistance', 'isolation'),
('cable_row',                  'Cable Row',                  '{"Seated Cable Row","Low Row"}',                                           '{"back","lats","biceps"}',                'cable',     'resistance', 'compound'),
('lat_pulldown',               'Lat Pulldown',               '{"Cable Lat Pulldown","Wide-Grip Pulldown"}',                              '{"lats","biceps","back"}',                'cable',     'resistance', 'compound'),
('leg_press',                  'Leg Press',                  '{"Machine Leg Press","45-Degree Leg Press"}',                              '{"quads","glutes"}',                      'machine',   'resistance', 'compound'),
('hack_squat',                 'Hack Squat',                 '{"Machine Hack Squat"}',                                                  '{"quads","glutes"}',                      'machine',   'resistance', 'compound'),
('leg_extension',              'Leg Extension',              '{"Machine Leg Extension","Quad Extension"}',                               '{"quads"}',                               'machine',   'resistance', 'isolation'),
('leg_curl',                   'Leg Curl',                   '{"Lying Leg Curl","Seated Leg Curl","Hamstring Curl","Machine Leg Curl"}', '{"hamstrings"}',                          'machine',   'resistance', 'isolation'),
('calf_raise',                 'Calf Raise',                 '{"Standing Calf Raise","Machine Calf Raise","Seated Calf Raise"}',         '{"calves"}',                              'machine',   'resistance', 'isolation'),
('chest_press_machine',        'Chest Press Machine',        '{"Machine Chest Press","Seated Chest Press"}',                             '{"chest","triceps"}',                     'machine',   'resistance', 'compound'),
('shoulder_press_machine',     'Shoulder Press Machine',     '{"Machine Shoulder Press"}',                                               '{"front_delts","side_delts","triceps"}',  'machine',   'resistance', 'compound'),
('smith_machine_squat',        'Smith Machine Squat',        '{"Smith Squat"}',                                                          '{"quads","glutes"}',                      'machine',   'resistance', 'compound'),

-- Bodyweight
('pull_up',                    'Pull-Up',                    '{"Pull Up","Pullup","Weighted Pull-Up","Weighted Pull Up"}',                '{"lats","biceps","back"}',                'bodyweight', 'bodyweight', 'compound'),
('chin_up',                    'Chin-Up',                    '{"Chin Up","Chinup","Weighted Chin-Up"}',                                  '{"biceps","lats","back"}',                'bodyweight', 'bodyweight', 'compound'),
('push_up',                    'Push-Up',                    '{"Push Up","Pushup","Press-Up"}',                                          '{"chest","triceps","front_delts"}',       'bodyweight', 'bodyweight', 'compound'),
('dip',                        'Dip',                        '{"Parallel Bar Dip","Chest Dip","Tricep Dip","Weighted Dip"}',             '{"chest","triceps","front_delts"}',       'bodyweight', 'bodyweight', 'compound'),
('bodyweight_squat',           'Bodyweight Squat',           '{"Air Squat","BW Squat"}',                                                '{"quads","glutes"}',                      'bodyweight', 'bodyweight', 'compound'),
('plank',                      'Plank',                      '{"Forearm Plank"}',                                                       '{"core","abs"}',                          'bodyweight', 'bodyweight', 'isolation'),
('hanging_leg_raise',          'Hanging Leg Raise',          '{"Leg Raise","Hanging Knee Raise"}',                                      '{"abs","hip_flexors"}',                   'bodyweight', 'bodyweight', 'isolation'),
('inverted_row',               'Inverted Row',               '{"Body Row","Australian Pull-Up"}',                                       '{"back","biceps","rear_delts"}',          'bodyweight', 'bodyweight', 'compound'),
('bulgarian_split_squat',      'Bulgarian Split Squat',      '{"BSS","Rear-Foot Elevated Split Squat"}',                                '{"quads","glutes","hamstrings"}',         'bodyweight', 'bodyweight', 'compound'),

-- Cardio
('running',                    'Running',                    '{"Run","Jog","Jogging","Treadmill Run","Treadmill"}',                      '{}',                                      'cardio_machine', 'cardio', null),
('cycling',                    'Cycling',                    '{"Bike","Stationary Bike","Cycle","Indoor Cycling","Spin"}',                '{}',                                      'cardio_machine', 'cardio', null),
('rowing',                     'Rowing',                     '{"Row Machine","Rowing Machine","Erg","Concept 2","C2 Row"}',              '{}',                                      'cardio_machine', 'cardio', null),
('swimming',                   'Swimming',                   '{"Swim","Lap Swimming","Pool"}',                                           '{}',                                      'none',            'cardio', null),
('elliptical',                 'Elliptical',                 '{"Elliptical Trainer","Cross Trainer"}',                                   '{}',                                      'cardio_machine', 'cardio', null),
('stair_climber',              'Stair Climber',              '{"StairMaster","Stair Machine","Stair Stepper"}',                          '{}',                                      'cardio_machine', 'cardio', null),
('jump_rope',                  'Jump Rope',                  '{"Skipping","Skip Rope"}',                                                '{}',                                      'none',            'cardio', null),
('walking',                    'Walking',                    '{"Walk","Treadmill Walk","Incline Walk"}',                                 '{}',                                      'none',            'cardio', null)

on conflict (slug) do nothing;
