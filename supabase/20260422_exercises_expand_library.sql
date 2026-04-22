-- supabase/20260422_exercises_expand_library.sql
-- Expand the exercise library:
--   (1) Add an alias-aware search RPC so "dumbbell chest press" actually
--       finds "Dumbbell Bench Press" (the old /api/exercises handler only
--       ILIKE'd the name column, ignoring the aliases[] array entirely).
--   (2) Expand aliases on common workhorse entries so the natural-language
--       terms people actually type show up.
--   (3) Insert ~40 new basic exercises that were genuinely missing
--       (cable pec deck, EZ-bar curls, band press, machine leg curls,
--       reverse/lateral lunge, etc.).
--
-- All three blocks are idempotent — alias UPDATEs dedupe via DISTINCT,
-- INSERTs use ON CONFLICT (slug) DO NOTHING.

-- ── (1) Alias-aware search RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_exercises(
  p_q         text    DEFAULT NULL,
  p_limit     int     DEFAULT 20,
  p_equipment text    DEFAULT NULL,
  p_category  text    DEFAULT NULL,
  p_muscle    text    DEFAULT NULL
)
RETURNS SETOF public.exercises
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT e.*
  FROM public.exercises e
  WHERE
    (p_q IS NULL OR p_q = '' OR
      e.name ILIKE '%' || p_q || '%' OR
      EXISTS (
        SELECT 1 FROM unnest(e.aliases) AS a
        WHERE a ILIKE '%' || p_q || '%'
      ))
    AND (p_equipment IS NULL OR e.equipment = p_equipment)
    AND (p_category  IS NULL OR e.category  = p_category)
    AND (p_muscle    IS NULL OR p_muscle = ANY(e.muscle_groups))
  ORDER BY
    -- Exact/starts-with name match first.
    CASE
      WHEN p_q IS NULL OR p_q = ''  THEN 1
      WHEN lower(e.name) = lower(p_q) THEN 0
      WHEN e.name ILIKE p_q || '%' THEN 1
      ELSE 2
    END,
    -- Then trigram similarity (pg_trgm extension already enabled).
    CASE
      WHEN p_q IS NULL OR p_q = '' THEN 0
      ELSE -similarity(e.name, p_q)
    END,
    e.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_exercises(text, int, text, text, text)
  TO authenticated, anon;

-- ── (2) Expand aliases on the most-searched existing entries ──────
-- Idempotent: DISTINCT-via-unnest dedupes if run multiple times.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT slug, new_aliases FROM (VALUES
      -- Chest
      ('dumbbell_bench_press',      ARRAY['Dumbbell Chest Press','DB Chest Press','Flat Dumbbell Chest Press','Flat Chest Press Dumbbell']),
      ('incline_dumbbell_bench',    ARRAY['Incline Dumbbell Chest Press','Incline DB Chest Press','Incline Chest Press Dumbbell']),
      ('decline_dumbbell_bench',    ARRAY['Decline Dumbbell Chest Press','Decline DB Chest Press','Decline Chest Press Dumbbell']),
      ('barbell_bench_press',       ARRAY['Barbell Chest Press','Flat Barbell Chest Press','Bench','Flat Bench']),
      ('chest_press_machine',       ARRAY['Chest Press','Machine Chest Press','Seated Chest Press Machine','Plate-Loaded Chest Press']),
      ('dumbbell_fly',              ARRAY['Dumbbell Pec Fly','DB Chest Fly','Flat Dumbbell Fly','DB Fly','Chest Fly']),
      ('cable_fly',                 ARRAY['Cable Crossover','Cable Pec Fly','Standing Cable Fly']),
      ('cable_high_to_low_fly',     ARRAY['High-to-Low Cable Fly','Cable Crossover High']),
      ('cable_low_to_high_fly',     ARRAY['Low-to-High Cable Fly','Cable Crossover Low','Cable Incline Fly']),
      -- Back
      ('barbell_row',               ARRAY['Bent-Over Row','Bent Over Row','BB Bent Over Row']),
      ('lat_pulldown',              ARRAY['Lat Pull Down','Pulldown','Wide-Grip Pulldown']),
      ('pull_up',                   ARRAY['Pullup','Pull Ups','Bodyweight Pull-Up']),
      ('chin_up',                   ARRAY['Chinup','Chin Ups','Underhand Pull-Up']),
      ('dumbbell_row',              ARRAY['DB Row','Single-Arm DB Row','One-Arm Dumbbell Row','Kroc Row']),
      ('face_pull',                 ARRAY['Cable Face Pull','Rope Face Pull']),
      -- Legs
      ('barbell_back_squat',        ARRAY['Squat','BB Back Squat','High-Bar Back Squat','Low-Bar Back Squat']),
      ('goblet_squat',              ARRAY['Dumbbell Squat','DB Squat','Kettlebell Goblet Squat','KB Goblet Squat']),
      ('leg_press',                 ARRAY['Leg Press Machine','45-Degree Leg Press','Horizontal Leg Press']),
      ('walking_lunge',             ARRAY['Lunge','Walking Lunges','BB Walking Lunge','DB Walking Lunge']),
      ('bulgarian_split_squat',     ARRAY['BSS','Split Squat','Rear-Foot Elevated Split Squat','RFESS']),
      ('romanian_deadlift',         ARRAY['RDL','Barbell RDL','Hinge','Stiff-Leg Deadlift']),
      ('dumbbell_rdl',              ARRAY['DB RDL','Dumbbell Romanian Deadlift','Stiff-Leg Deadlift Dumbbell']),
      ('barbell_hip_thrust',        ARRAY['Hip Thrust','BB Hip Thrust','Barbell Glute Bridge']),
      ('calf_raise',                ARRAY['Standing Calf Raise','Calves']),
      -- Shoulders
      ('barbell_overhead_press',    ARRAY['Standing OHP','Shoulder Press','BB Shoulder Press','Military Press']),
      ('dumbbell_shoulder_press',   ARRAY['DB Shoulder Press','Seated DB Shoulder Press','DB OHP','Dumbbell OHP']),
      ('dumbbell_lateral_raise',    ARRAY['Lateral Raise','Side Lateral Raise','DB Lat Raise','Side Raise']),
      ('dumbbell_front_raise',      ARRAY['Front Raise','DB Front Raise']),
      ('dumbbell_reverse_fly',      ARRAY['Rear Delt Fly','DB Rear Delt Raise','Bent-Over Rear Delt Fly']),
      -- Arms
      ('barbell_curl',              ARRAY['Bicep Curl','BB Curl','Barbell Bicep Curl','Standing Barbell Curl']),
      ('dumbbell_curl',             ARRAY['DB Curl','Dumbbell Bicep Curl','DB Bicep Curl','Standing DB Curl']),
      ('hammer_curl',               ARRAY['Dumbbell Hammer Curl','DB Hammer','Neutral-Grip Curl']),
      ('incline_dumbbell_curl',     ARRAY['Incline DB Curl','Incline Bench Curl']),
      ('overhead_tricep_extension', ARRAY['Overhead Extension','Tricep Extension','DB Tricep Extension','Seated Tricep Extension']),
      ('tricep_pushdown',           ARRAY['Cable Pushdown','Pushdown','Rope Pushdown','Tricep Pushdown Rope']),
      ('close_grip_bench_press',    ARRAY['Close-Grip Bench','CGBP','Narrow-Grip Bench Press']),
      -- Core + misc
      ('kettlebell_swing',          ARRAY['KB Swing','Russian Swing','Two-Handed Kettlebell Swing']),
      ('plank',                     ARRAY['Front Plank','Forearm Plank','RKC Plank']),
      ('hanging_leg_raise',         ARRAY['HLR','Leg Raises','Hanging Leg Raises']),
      ('cable_crunch',              ARRAY['Kneeling Cable Crunch','Cable Crunches','Rope Crunch'])
    ) AS t(slug, new_aliases)
  LOOP
    UPDATE public.exercises
    SET aliases = ARRAY(
      SELECT DISTINCT a
      FROM unnest(COALESCE(exercises.aliases, '{}'::text[]) || r.new_aliases) AS a
      WHERE a IS NOT NULL AND a <> ''
    )
    WHERE exercises.slug = r.slug;
  END LOOP;
END $$;

-- ── (3) Insert genuinely missing basic exercises ──────────────────
INSERT INTO public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) VALUES

-- Chest / pressing
('cable_chest_press',           'Cable Chest Press',           '{"Dual Cable Chest Press","Standing Cable Press","Cable Press"}',                '{"chest","triceps","front_delts"}',      'cable',     'resistance', 'compound'),
('cable_pec_deck',              'Cable Pec Deck',              '{"Standing Cable Pec Deck","Cable Chest Fly Machine-Style"}',                    '{"chest","front_delts"}',                 'cable',     'resistance', 'isolation'),
('smith_incline_bench_press',   'Smith Machine Incline Bench', '{"Smith Incline Press","Smith Incline Bench Press","Incline Smith Press"}',      '{"upper_chest","triceps","front_delts"}', 'machine',   'resistance', 'compound'),
('smith_decline_bench_press',   'Smith Machine Decline Bench', '{"Smith Decline Press","Smith Decline Bench Press","Decline Smith Press"}',      '{"lower_chest","triceps"}',               'machine',   'resistance', 'compound'),
('incline_chest_press_machine', 'Incline Chest Press Machine', '{"Machine Incline Chest Press","Plate-Loaded Incline Press"}',                   '{"upper_chest","triceps","front_delts"}', 'machine',   'resistance', 'compound'),
('band_chest_press',            'Band Chest Press',            '{"Resistance Band Chest Press","Standing Band Press"}',                          '{"chest","triceps","front_delts"}',       'band',      'resistance', 'compound'),
('band_chest_fly',              'Band Chest Fly',              '{"Resistance Band Fly","Band Pec Fly"}',                                         '{"chest","front_delts"}',                 'band',      'resistance', 'isolation'),
('decline_push_up',             'Decline Push-Up',             '{"Feet-Elevated Push-Up","Decline Pushup"}',                                     '{"upper_chest","triceps","front_delts"}', 'bodyweight','bodyweight','compound'),
('incline_push_up',             'Incline Push-Up',             '{"Hands-Elevated Push-Up","Incline Pushup","Beginner Push-Up"}',                 '{"lower_chest","triceps"}',               'bodyweight','bodyweight','compound'),
('knee_push_up',                'Knee Push-Up',                '{"Modified Push-Up","Beginner Pushup","Knee Pushup"}',                           '{"chest","triceps"}',                     'bodyweight','bodyweight','compound'),

-- Back / pulling
('chest_supported_row_db',      'Chest-Supported Dumbbell Row','{"Chest-Supported Row","Incline DB Row","Chest-Supported DB Row"}',              '{"back","lats","rear_delts","biceps"}',   'dumbbell',  'resistance', 'compound'),
('t_bar_row',                   'T-Bar Row',                   '{"T Bar Row","Landmine T-Bar Row"}',                                             '{"back","lats","rear_delts","biceps"}',   'barbell',   'resistance', 'compound'),
('seal_row',                    'Seal Row',                    '{"Bench Seal Row","Prone Row"}',                                                 '{"back","lats","rear_delts","biceps"}',   'barbell',   'resistance', 'compound'),
('single_arm_cable_row',        'Single-Arm Cable Row',        '{"One-Arm Cable Row","Standing Cable Row"}',                                     '{"back","lats","biceps"}',                'cable',     'resistance', 'compound'),
('straight_arm_pulldown',       'Straight-Arm Pulldown',       '{"Straight Arm Cable Pulldown","Stiff-Arm Pulldown"}',                           '{"lats"}',                                'cable',     'resistance', 'isolation'),
('reverse_grip_pulldown',       'Reverse-Grip Lat Pulldown',   '{"Underhand Lat Pulldown","Supinated Pulldown"}',                                '{"lats","biceps"}',                       'cable',     'resistance', 'compound'),
('band_row',                    'Band Row',                    '{"Resistance Band Row","Seated Band Row"}',                                      '{"back","lats","biceps"}',                'band',      'resistance', 'compound'),
('band_pulldown',               'Band Lat Pulldown',           '{"Band Pulldown","Resistance Band Pulldown"}',                                   '{"lats","biceps"}',                       'band',      'resistance', 'compound'),

-- Legs
('seated_leg_curl',             'Seated Leg Curl',             '{"Seated Hamstring Curl","Seated Hamstring Machine"}',                           '{"hamstrings"}',                          'machine',   'resistance', 'isolation'),
('lying_leg_curl',              'Lying Leg Curl',              '{"Prone Leg Curl","Lying Hamstring Curl"}',                                      '{"hamstrings"}',                          'machine',   'resistance', 'isolation'),
('seated_calf_raise',           'Seated Calf Raise',           '{"Seated Calves","Machine Seated Calf Raise"}',                                  '{"calves"}',                              'machine',   'resistance', 'isolation'),
('reverse_lunge',               'Reverse Lunge',               '{"DB Reverse Lunge","Dumbbell Reverse Lunge","Backward Lunge"}',                 '{"quads","glutes","hamstrings"}',         'dumbbell',  'resistance', 'compound'),
('lateral_lunge',               'Lateral Lunge',               '{"Side Lunge","Cossack Lunge"}',                                                 '{"quads","glutes","adductors"}',          'bodyweight','bodyweight','compound'),
('curtsy_lunge',                'Curtsy Lunge',                '{"Crossover Lunge","DB Curtsy Lunge"}',                                          '{"glutes","quads","adductors"}',          'dumbbell',  'resistance', 'compound'),
('single_leg_rdl',              'Single-Leg Romanian Deadlift','{"SL RDL","Single-Leg RDL","One-Leg RDL","DB Single-Leg RDL"}',                  '{"hamstrings","glutes","core"}',          'dumbbell',  'resistance', 'compound'),
('glute_bridge',                'Glute Bridge',                '{"Bodyweight Glute Bridge","Floor Glute Bridge"}',                               '{"glutes","hamstrings"}',                 'bodyweight','bodyweight','compound'),
('single_leg_glute_bridge',     'Single-Leg Glute Bridge',     '{"SL Glute Bridge","One-Leg Glute Bridge"}',                                     '{"glutes","hamstrings","core"}',          'bodyweight','bodyweight','compound'),
('hip_thrust_machine',          'Hip Thrust Machine',          '{"Machine Hip Thrust","Plate-Loaded Hip Thrust"}',                               '{"glutes","hamstrings"}',                 'machine',   'resistance', 'compound'),

-- Shoulders
('cable_front_raise',           'Cable Front Raise',           '{"Standing Cable Front Raise","Cable Anterior Raise"}',                          '{"front_delts"}',                         'cable',     'resistance', 'isolation'),
('plate_front_raise',           'Plate Front Raise',           '{"Plate-Loaded Front Raise","45-lb Plate Raise"}',                               '{"front_delts"}',                         'plate',     'resistance', 'isolation'),
('band_lateral_raise',          'Band Lateral Raise',          '{"Resistance Band Lat Raise","Band Side Raise"}',                                '{"side_delts"}',                          'band',      'resistance', 'isolation'),
('machine_lateral_raise',       'Machine Lateral Raise',       '{"Plate-Loaded Lateral Raise","Seated Lateral Raise Machine"}',                  '{"side_delts"}',                          'machine',   'resistance', 'isolation'),
('landmine_lateral_raise',      'Landmine Lateral Raise',      '{"Landmine Side Raise"}',                                                        '{"side_delts","front_delts"}',            'landmine',  'resistance', 'isolation'),

-- Arms — biceps
('ez_bar_curl',                 'EZ-Bar Curl',                 '{"EZ Bar Curl","EZ Curl","W-Bar Curl"}',                                         '{"biceps","forearms"}',                   'ez_bar',    'resistance', 'isolation'),
('ez_bar_preacher_curl',        'EZ-Bar Preacher Curl',        '{"EZ Preacher Curl","Preacher Curl EZ Bar"}',                                    '{"biceps"}',                              'ez_bar',    'resistance', 'isolation'),
('spider_curl',                 'Spider Curl',                 '{"Prone Incline Curl","DB Spider Curl"}',                                        '{"biceps"}',                              'dumbbell',  'resistance', 'isolation'),
('zottman_curl',                'Zottman Curl',                '{"DB Zottman Curl","Dumbbell Zottman Curl"}',                                    '{"biceps","forearms"}',                   'dumbbell',  'resistance', 'isolation'),

-- Arms — triceps
('ez_bar_skull_crusher',        'EZ-Bar Skull Crusher',        '{"EZ-Bar Lying Tricep Extension","Skull Crushers EZ Bar","Nose Breakers EZ"}',   '{"triceps"}',                             'ez_bar',    'resistance', 'isolation'),
('rope_pushdown',               'Rope Tricep Pushdown',        '{"Cable Rope Pushdown","Rope Tricep Extension"}',                                '{"triceps"}',                             'cable',     'resistance', 'isolation'),
('v_bar_pushdown',              'V-Bar Tricep Pushdown',       '{"Straight Bar Pushdown","V-Handle Pushdown"}',                                  '{"triceps"}',                             'cable',     'resistance', 'isolation'),
('bench_dip',                   'Bench Dip',                   '{"Tricep Bench Dip","Chair Dip"}',                                               '{"triceps","front_delts"}',               'bodyweight','bodyweight','compound'),

-- Core
('reverse_crunch',              'Reverse Crunch',              '{"Lying Reverse Crunch","Floor Reverse Crunch"}',                                '{"abs","hip_flexors"}',                   'bodyweight','bodyweight','isolation'),
('hanging_knee_raise',          'Hanging Knee Raise',          '{"Knee Raise","Bar Knee Raise","Hanging Knee Tucks"}',                           '{"abs","hip_flexors"}',                   'bodyweight','bodyweight','isolation'),
('decline_sit_up',              'Decline Sit-Up',              '{"Decline Bench Sit-Up","Decline Crunch"}',                                      '{"abs"}',                                 'bodyweight','bodyweight','isolation'),
('weighted_russian_twist',      'Weighted Russian Twist',      '{"Plate Russian Twist","DB Russian Twist","Med Ball Russian Twist"}',            '{"obliques","abs"}',                      'plate',     'resistance', 'isolation'),

-- Conditioning
('medicine_ball_slam',          'Medicine Ball Slam',          '{"Med Ball Slam","Ball Slam"}',                                                  '{"core","shoulders","lats"}',             'medicine_ball','hybrid',  'compound'),
('wall_ball',                   'Wall Ball',                   '{"Wall Ball Shot","Med Ball Wall Throw"}',                                       '{"quads","glutes","shoulders","core"}',   'medicine_ball','hybrid',  'compound')

ON CONFLICT (slug) DO NOTHING;
