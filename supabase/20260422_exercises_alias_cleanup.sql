-- supabase/20260422_exercises_alias_cleanup.sql
-- Second pass on the exercise library after scanning the live catalog:
--   (1) Clean up three auto-created rows (front_plank, incline_push_up,
--       seated_row_or_band_row). Each has user-logged sets attached so we
--       can't delete them — instead, give them proper names + metadata so
--       they behave like canonical rows in search.
--   (2) Resolve the leg_curl ambiguity. The generic leg_curl row has
--       "Lying Leg Curl" / "Seated Leg Curl" in its aliases, but now
--       dedicated lying_leg_curl / seated_leg_curl slugs exist. Strip
--       the conflicting aliases from leg_curl so the specific rows win.
--   (3) Add aliases to ~20 more entries that are high-search-likelihood
--       and had empty or thin alias arrays.
--
-- All operations idempotent (DISTINCT-via-unnest dedupe on alias merges,
-- UPDATE-by-slug is write-idempotent).

-- ── (1) Fix three auto-created rows ───────────────────────────────
UPDATE public.exercises
SET name         = 'Front Plank',
    aliases      = ARRAY['Plank Front','Elbow Plank','Forearm Plank Hold'],
    muscle_groups= ARRAY['abs','core','shoulders'],
    equipment    = 'bodyweight',
    category     = 'bodyweight',
    auto_created = false
WHERE slug = 'front_plank';

UPDATE public.exercises
SET name         = 'Incline Push-Up',
    aliases      = ARRAY['Hands-Elevated Push-Up','Incline Pushup','Beginner Push-Up','Elevated Push-Up'],
    muscle_groups= ARRAY['lower_chest','triceps'],
    equipment    = 'bodyweight',
    category     = 'bodyweight',
    auto_created = false
WHERE slug = 'incline_push_up';

UPDATE public.exercises
SET name         = 'Seated Row (Machine or Band)',
    aliases      = ARRAY['Seated Row','Machine Seated Row','Band Seated Row','Seated Rowing'],
    muscle_groups= ARRAY['back','lats','rear_delts','biceps'],
    equipment    = 'machine',
    category     = 'resistance',
    movement_type= 'compound',
    auto_created = false
WHERE slug = 'seated_row_or_band_row';

-- ── (2) Resolve leg_curl alias conflict ───────────────────────────
-- Dedicated lying_leg_curl / seated_leg_curl slugs exist in the library,
-- so leg_curl should no longer claim those names as aliases. Keeping it
-- as a generic fallback with hamstring/machine synonyms only.
UPDATE public.exercises
SET aliases = ARRAY['Hamstring Curl','Machine Leg Curl']
WHERE slug = 'leg_curl';

-- ── (3) Add aliases to high-traffic entries that were empty/thin ──
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT slug, new_aliases FROM (VALUES
      -- Core / bodyweight
      ('bird_dog',                  ARRAY['Quadruped Opposite Arm Leg','Bird-Dog']),
      ('dead_bug',                  ARRAY['Deadbug','Dying Bug']),
      ('side_plank',                ARRAY['Side Forearm Plank','Lateral Plank']),
      ('hollow_hold',               ARRAY['Hollow Body Hold','Hollow Body','Hollow Rock Hold']),
      ('concentration_curl',        ARRAY['DB Concentration Curl','Dumbbell Concentration Curl','Seated Concentration Curl']),
      ('shrimp_squat',              ARRAY['Advanced Single-Leg Squat']),
      ('human_flag',                ARRAY['Flag','Side Flag']),
      ('zercher_squat',             ARRAY['Zercher','Front-Rack Elbow Squat']),
      ('dumbbell_thruster',         ARRAY['Dumbbell Thrusters','DB Thruster','DB Thrusters']),
      ('kb_thruster',               ARRAY['Kettlebell Thrusters','Double KB Thruster']),
      ('pendlay_row',               ARRAY['Dead-Stop Row','Dead Stop Row','Barbell Pendlay Row']),
      ('cable_shrug',               ARRAY['Cable Neck Shrug','Standing Cable Shrug']),
      -- Compounds / Olympic
      ('barbell_deadlift',          ARRAY['Barbell DL','Conventional DL','Conv DL','BB Deadlift']),
      ('sumo_deadlift',             ARRAY['Sumo Pull','Sumo-Stance Deadlift']),
      ('romanian_deadlift',         ARRAY['Barbell Romanian Deadlift']),
      ('trap_bar_deadlift',         ARRAY['Trap Bar DL','Hex Bar Pull']),
      ('power_clean',               ARRAY['PC','Clean Pull','Barbell Power Clean']),
      ('clean_and_jerk',            ARRAY['Barbell Clean & Jerk','Olympic Clean and Jerk']),
      ('snatch',                    ARRAY['Barbell Snatch','Olympic Snatch']),
      ('power_snatch',              ARRAY['PSnatch','Barbell Power Snatch']),
      ('push_press',                ARRAY['BB Push Press','Barbell Push Press','Jerk Press']),
      -- Barbell / accessory lift
      ('barbell_skull_crusher',     ARRAY['Lying Tricep Extension','Lying Triceps Extension','Nose Breakers','Skullcrushers']),
      ('dumbbell_skull_crusher',    ARRAY['DB Skullcrusher','DB Skull Crushers','Dumbbell Lying Tricep Extension']),
      ('barbell_shrug',             ARRAY['Barbell Trap Shrug','BB Shoulder Shrug']),
      ('barbell_upright_row',       ARRAY['BB Upright','Barbell High Pull']),
      ('barbell_wrist_curl',        ARRAY['BB Wrist Curl','Forearm Curl']),
      ('barbell_reverse_curl',      ARRAY['Reverse EZ Curl','BB Reverse Bicep Curl']),
      ('barbell_lunge',             ARRAY['Barbell Lunges','Stationary Barbell Lunge']),
      ('barbell_step_up',           ARRAY['Barbell Step Up','BB Box Step-Up']),
      -- Dumbbell / KB
      ('dumbbell_lunge',            ARRAY['DB Walking Lunge','DB Stationary Lunge','DB Reverse Lunge']),
      ('dumbbell_pullover',         ARRAY['DB Pullover','Bent-Arm Pullover','Straight-Arm DB Pullover']),
      ('dumbbell_kickback',         ARRAY['Tricep Dumbbell Kickback','DB Tricep Kickback']),
      ('dumbbell_step_up',          ARRAY['DB Box Step-Up','Weighted Step-Up']),
      ('dumbbell_snatch',           ARRAY['Single-Arm DB Snatch','SA DB Snatch']),
      ('kb_goblet_squat',           ARRAY['Goblet Squat Kettlebell','KB Goblet','KB Front-Rack Goblet']),
      ('kettlebell_swing',          ARRAY['Hardstyle Swing','Hardstyle Kettlebell Swing']),
      -- Cables / machine
      ('cable_curl',                ARRAY['Cable Bicep Curl Rope','Rope Cable Curl']),
      ('cable_kickback',            ARRAY['Standing Cable Kickback','Cable Donkey Kick']),
      ('shoulder_press_machine',    ARRAY['Seated Shoulder Press Machine','Plate-Loaded Shoulder Press']),
      ('preacher_curl_machine',     ARRAY['Preacher Machine Curl','Plate-Loaded Preacher Curl']),
      ('pec_deck',                  ARRAY['Pec Fly Machine','Pec Deck Machine']),
      ('reverse_pec_deck',          ARRAY['Reverse Fly Machine','Rear Delt Pec Deck','Machine Rear Delt Fly']),
      ('leg_extension',             ARRAY['Leg Extensions','Machine Quad Extension']),
      ('hack_squat',                ARRAY['Machine Hack Squat','Plate-Loaded Hack Squat']),
      -- Cardio common terms
      ('running',                   ARRAY['Road Run','Easy Run','Tempo Run','Long Run']),
      ('rowing',                    ARRAY['Row Erg','Indoor Rowing','Concept2 Row']),
      ('swimming',                  ARRAY['Lap Swim','Pool Swim']),
      ('stair_climber',             ARRAY['Stairmill','Step Mill','StepMill']),
      ('cycling',                   ARRAY['Peloton','Zwift','Indoor Bike']),
      -- Climbing
      ('bouldering',                ARRAY['Indoor Bouldering','Outdoor Bouldering','V-Scale Bouldering']),
      ('sport_climbing',            ARRAY['Lead Climbing','Route Climbing']),
      ('hangboard',                 ARRAY['Hangboard Repeaters','Fingerboard Repeaters']),
      -- Swim drills
      ('swimming_freestyle',        ARRAY['Freestyle Swimming','Front Crawl Swim']),
      ('swimming_backstroke',       ARRAY['Backstroke Swim']),
      ('swimming_breaststroke',     ARRAY['Breaststroke Swim']),
      ('swimming_butterfly',        ARRAY['Butterfly Stroke']),
      -- Deadlift variants
      ('deficit_deadlift',          ARRAY['Deficit DL','Elevated Deadlift Deficit']),
      ('block_pull',                ARRAY['Block Pulls','Elevated Deadlift','Block Deadlift']),
      ('pin_press',                 ARRAY['Pin Bench Press','Dead Bench Press','Board Press']),
      -- Bodyweight / gymnastic
      ('muscle_up',                 ARRAY['Kipping Muscle-Up','Strict Muscle-Up']),
      ('ring_muscle_up',            ARRAY['RMU','Strict Ring Muscle-Up']),
      ('front_lever',               ARRAY['Front Lever Hold','Tuck Front Lever']),
      ('back_lever',                ARRAY['Back Lever Hold','Tuck Back Lever'])
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
