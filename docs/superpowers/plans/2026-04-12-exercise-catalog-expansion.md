# Exercise Catalog Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quadruple the seeded exercise catalog from 69 to ~276 entries, covering Olympic lifts, kettlebell, calisthenics, plyometrics, strongman, bands, suspension, cable, machine, core, cardio, sport drills, swimming drills, climbing, and flexibility.

**Architecture:** Single idempotent SQL migration inserting ~207 new rows into the existing `exercises` table. No schema changes, no new categories, no RPC or UI changes. New `equipment` values (kettlebell, band, suspension, rings, sled, landmine, trap_bar) are free — no CHECK constraint on that column.

**Tech Stack:** PostgreSQL, SQL migration

**Spec:** `docs/superpowers/specs/2026-04-12-exercise-catalog-expansion-design.md`

---

### Task 1: Write the SQL migration — Olympic Lifts

**Files:**
- Create: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Create migration file with header and Olympic lifts section**

Create `supabase/20260412_exercises_quadruple_seed.sql`:

```sql
-- Quadruple the exercise catalog from 69 → ~276 seeds.
-- Covers: Olympic lifts, kettlebell, barbell, dumbbell, cable, machine,
-- trap bar, landmine, strongman, bands, suspension/TRX, gymnastics/calisthenics,
-- plyometrics, core, cardio, sport drills, swimming drills, climbing, flexibility.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- No schema changes — all rows fit existing category CHECK values.
-- New equipment values: kettlebell, band, suspension, rings, sled, landmine, trap_bar.

INSERT INTO public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) VALUES

-- ── Olympic Lifts ─────────────────────────────────────────────────
('power_clean',           'Power Clean',           '{"PC","Power Clean"}',                                      '{"quads","glutes","hamstrings","traps","back","front_delts"}', 'barbell', 'resistance', 'compound'),
('hang_clean',            'Hang Clean',            '{"Hang Power Clean"}',                                      '{"quads","glutes","hamstrings","traps","back"}',              'barbell', 'resistance', 'compound'),
('clean_and_jerk',        'Clean & Jerk',          '{"Clean and Jerk","C&J","CJ"}',                             '{"quads","glutes","hamstrings","traps","front_delts","triceps"}', 'barbell', 'resistance', 'compound'),
('clean_pull',            'Clean Pull',            '{"Clean Deadlift Pull"}',                                   '{"hamstrings","glutes","back","traps"}',                      'barbell', 'resistance', 'compound'),
('snatch',                'Snatch',                '{"Full Snatch","Squat Snatch"}',                            '{"quads","glutes","hamstrings","traps","back","front_delts"}', 'barbell', 'resistance', 'compound'),
('power_snatch',          'Power Snatch',          '{"P Snatch"}',                                              '{"quads","glutes","hamstrings","traps","back","front_delts"}', 'barbell', 'resistance', 'compound'),
('hang_snatch',           'Hang Snatch',           '{"Hang Power Snatch"}',                                     '{"quads","glutes","hamstrings","traps","back"}',              'barbell', 'resistance', 'compound'),
('snatch_pull',           'Snatch Pull',           '{"Snatch Deadlift Pull"}',                                  '{"hamstrings","glutes","back","traps"}',                      'barbell', 'resistance', 'compound'),
('clean_high_pull',       'Clean High Pull',       '{"High Pull"}',                                             '{"traps","front_delts","back","biceps"}',                     'barbell', 'resistance', 'compound'),
('push_press',            'Push Press',            '{"BB Push Press"}',                                         '{"front_delts","side_delts","triceps","quads"}',              'barbell', 'resistance', 'compound'),
('push_jerk',             'Push Jerk',             '{"Power Jerk"}',                                            '{"front_delts","side_delts","triceps","quads"}',              'barbell', 'resistance', 'compound'),
('split_jerk',            'Split Jerk',            '{"Jerk","Clean Jerk"}',                                     '{"front_delts","side_delts","triceps","quads","glutes"}',     'barbell', 'resistance', 'compound')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify syntax locally**

Run:
```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Lines:', sql.split('\n').length); console.log('INSERTs:', (sql.match(/^\('/gm)||[]).length, 'rows')"
```
Expected: Lines ~20+, INSERTs: 12 rows

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed Olympic lifts (12 exercises)"
```

---

### Task 2: Add Kettlebell exercises

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Replace the trailing `ON CONFLICT` with a comma and add the kettlebell block**

Remove the `ON CONFLICT (slug) DO NOTHING;` at the end and replace with a comma, then append:

```sql
,
-- ── Kettlebell ────────────────────────────────────────────────────
('kettlebell_swing',      'Kettlebell Swing',      '{"KB Swing","Russian Swing","KBS"}',                        '{"glutes","hamstrings","back","core"}',                       'kettlebell', 'resistance', 'compound'),
('kb_goblet_squat',       'Kettlebell Goblet Squat','{"KB Goblet Squat"}',                                      '{"quads","glutes","core"}',                                   'kettlebell', 'resistance', 'compound'),
('kb_clean',              'Kettlebell Clean',      '{"KB Clean"}',                                              '{"glutes","hamstrings","back","biceps"}',                     'kettlebell', 'resistance', 'compound'),
('kb_snatch',             'Kettlebell Snatch',     '{"KB Snatch"}',                                             '{"glutes","hamstrings","back","front_delts"}',                'kettlebell', 'resistance', 'compound'),
('kb_press',              'Kettlebell Press',      '{"KB Press","KB Overhead Press","KB OHP"}',                  '{"front_delts","side_delts","triceps"}',                      'kettlebell', 'resistance', 'compound'),
('turkish_get_up',        'Turkish Get-Up',        '{"TGU","Turkish Getup","Get-Up"}',                          '{"core","front_delts","glutes","quads"}',                     'kettlebell', 'resistance', 'compound'),
('kb_front_squat',        'Kettlebell Front Squat','{"KB Front Squat","Double KB Squat"}',                      '{"quads","glutes","core"}',                                   'kettlebell', 'resistance', 'compound'),
('kb_windmill',           'Kettlebell Windmill',   '{"KB Windmill","Windmill"}',                                '{"core","obliques","hamstrings","front_delts"}',              'kettlebell', 'resistance', 'compound'),
('kb_halo',               'Kettlebell Halo',       '{"KB Halo","Halo"}',                                       '{"front_delts","side_delts","core"}',                         'kettlebell', 'resistance', 'isolation'),
('kb_row',                'Kettlebell Row',        '{"KB Row","Single-Arm KB Row"}',                            '{"back","lats","biceps"}',                                    'kettlebell', 'resistance', 'compound'),
('kb_deadlift',           'Kettlebell Deadlift',   '{"KB Deadlift","KB DL"}',                                   '{"hamstrings","glutes","back"}',                              'kettlebell', 'resistance', 'compound'),
('kb_lunge',              'Kettlebell Lunge',      '{"KB Lunge","KB Rack Lunge"}',                              '{"quads","glutes","hamstrings"}',                             'kettlebell', 'resistance', 'compound'),
('kb_thruster',           'Kettlebell Thruster',   '{"KB Thruster"}',                                           '{"quads","glutes","front_delts","triceps"}',                  'kettlebell', 'resistance', 'compound'),
('kb_high_pull',          'Kettlebell High Pull',  '{"KB High Pull"}',                                          '{"traps","front_delts","back","glutes"}',                     'kettlebell', 'resistance', 'compound'),
('kb_farmers_carry',      'Kettlebell Farmer''s Carry','{"KB Farmer Walk","KB Farmer''s Walk","KB Carry"}',      '{"forearms","traps","core"}',                                 'kettlebell', 'resistance', 'compound'),
('kb_sumo_deadlift',      'Kettlebell Sumo Deadlift','{"KB Sumo DL"}',                                          '{"quads","glutes","hamstrings","back"}',                      'kettlebell', 'resistance', 'compound'),
('kb_floor_press',        'Kettlebell Floor Press','{"KB Floor Press"}',                                        '{"chest","triceps"}',                                         'kettlebell', 'resistance', 'compound'),
('kb_rack_walk',          'Kettlebell Rack Walk',  '{"KB Rack Carry","Rack Walk"}',                             '{"core","front_delts","forearms"}',                           'kettlebell', 'resistance', 'compound')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: 30 rows (12 Olympic + 18 KB)

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed kettlebell exercises (18 exercises)"
```

---

### Task 3: Add more Barbell and Dumbbell variations

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Remove trailing `ON CONFLICT`, append barbell section**

```sql
,
-- ── More Barbell ──────────────────────────────────────────────────
('barbell_shrug',         'Barbell Shrug',         '{"BB Shrug","Shrug"}',                                      '{"traps"}',                                                   'barbell', 'resistance', 'isolation'),
('barbell_upright_row',   'Barbell Upright Row',   '{"BB Upright Row","Upright Row"}',                          '{"traps","side_delts","biceps"}',                             'barbell', 'resistance', 'compound'),
('barbell_skull_crusher', 'Barbell Skull Crusher', '{"Skull Crusher","BB Skull Crusher","Lying Tricep Extension"}', '{"triceps"}',                                              'barbell', 'resistance', 'isolation'),
('barbell_wrist_curl',    'Barbell Wrist Curl',    '{"BB Wrist Curl","Wrist Curl"}',                            '{"forearms"}',                                                'barbell', 'resistance', 'isolation'),
('barbell_reverse_curl',  'Barbell Reverse Curl',  '{"BB Reverse Curl","Reverse Curl"}',                        '{"forearms","biceps"}',                                       'barbell', 'resistance', 'isolation'),
('barbell_floor_press',   'Barbell Floor Press',   '{"BB Floor Press","Floor Press"}',                          '{"chest","triceps"}',                                         'barbell', 'resistance', 'compound'),
('zercher_squat',         'Zercher Squat',         '{}',                                                        '{"quads","glutes","core","biceps"}',                          'barbell', 'resistance', 'compound'),
('anderson_squat',        'Anderson Squat',        '{"Pin Squat","Bottom-Up Squat"}',                           '{"quads","glutes"}',                                          'barbell', 'resistance', 'compound'),
('pause_squat',           'Pause Squat',           '{"Paused Squat","Tempo Squat"}',                            '{"quads","glutes","hamstrings"}',                             'barbell', 'resistance', 'compound'),
('deficit_deadlift',      'Deficit Deadlift',      '{"Deficit DL"}',                                            '{"hamstrings","glutes","back","quads"}',                      'barbell', 'resistance', 'compound'),
('block_pull',            'Block Pull',            '{"Rack Pull","Elevated Deadlift"}',                         '{"back","traps","glutes"}',                                   'barbell', 'resistance', 'compound'),
('barbell_good_morning',  'Barbell Good Morning',  '{"Good Morning","BB Good Morning"}',                        '{"hamstrings","glutes","back"}',                              'barbell', 'resistance', 'compound'),
('barbell_lunge',         'Barbell Lunge',         '{"BB Lunge","Barbell Lunges"}',                             '{"quads","glutes","hamstrings"}',                             'barbell', 'resistance', 'compound'),
('barbell_step_up',       'Barbell Step-Up',       '{"BB Step-Up","Step-Up"}',                                  '{"quads","glutes"}',                                          'barbell', 'resistance', 'compound'),
('pin_press',             'Pin Press',             '{"Dead Bench","Board Press"}',                              '{"chest","triceps"}',                                         'barbell', 'resistance', 'compound'),

-- ── More Dumbbell ─────────────────────────────────────────────────
('dumbbell_shrug',        'Dumbbell Shrug',        '{"DB Shrug"}',                                              '{"traps"}',                                                   'dumbbell', 'resistance', 'isolation'),
('dumbbell_upright_row',  'Dumbbell Upright Row',  '{"DB Upright Row"}',                                        '{"traps","side_delts","biceps"}',                             'dumbbell', 'resistance', 'compound'),
('dumbbell_skull_crusher','Dumbbell Skull Crusher', '{"DB Skull Crusher","DB Lying Extension"}',                 '{"triceps"}',                                                 'dumbbell', 'resistance', 'isolation'),
('dumbbell_pullover',     'Dumbbell Pullover',     '{"DB Pullover","Pullover"}',                                '{"lats","chest"}',                                            'dumbbell', 'resistance', 'compound'),
('dumbbell_front_raise',  'Dumbbell Front Raise',  '{"DB Front Raise","Front Raise"}',                          '{"front_delts"}',                                             'dumbbell', 'resistance', 'isolation'),
('dumbbell_arnold_press', 'Dumbbell Arnold Press', '{"Arnold Press","DB Arnold Press"}',                        '{"front_delts","side_delts","triceps"}',                      'dumbbell', 'resistance', 'compound'),
('dumbbell_wrist_curl',   'Dumbbell Wrist Curl',   '{"DB Wrist Curl"}',                                        '{"forearms"}',                                                'dumbbell', 'resistance', 'isolation'),
('dumbbell_step_up',      'Dumbbell Step-Up',      '{"DB Step-Up"}',                                            '{"quads","glutes"}',                                          'dumbbell', 'resistance', 'compound'),
('dumbbell_bss',          'Dumbbell Bulgarian Split Squat','{"DB BSS","DB Bulgarian Split Squat"}',              '{"quads","glutes","hamstrings"}',                             'dumbbell', 'resistance', 'compound'),
('incline_dumbbell_curl', 'Incline Dumbbell Curl', '{"Incline DB Curl","Incline Curl"}',                       '{"biceps"}',                                                  'dumbbell', 'resistance', 'isolation'),
('dumbbell_kickback',     'Dumbbell Kickback',     '{"DB Kickback","Tricep Kickback"}',                        '{"triceps"}',                                                 'dumbbell', 'resistance', 'isolation'),
('dumbbell_calf_raise',   'Dumbbell Calf Raise',   '{"DB Calf Raise"}',                                        '{"calves"}',                                                  'dumbbell', 'resistance', 'isolation'),
('decline_dumbbell_bench','Decline Dumbbell Bench Press','{"Decline DB Bench","Decline Dumbbell Press"}',        '{"lower_chest","triceps"}',                                   'dumbbell', 'resistance', 'compound'),
('single_arm_db_press',   'Single-Arm Dumbbell Press','{"SA DB Press","One-Arm Dumbbell Press"}',               '{"front_delts","side_delts","triceps","core"}',               'dumbbell', 'resistance', 'compound'),
('dumbbell_squeeze_press','Dumbbell Squeeze Press', '{"DB Squeeze Press","Hex Press"}',                         '{"chest","triceps"}',                                         'dumbbell', 'resistance', 'compound'),
('dumbbell_thruster',     'Dumbbell Thruster',     '{"DB Thruster"}',                                           '{"quads","glutes","front_delts","triceps"}',                  'dumbbell', 'resistance', 'compound'),
('dumbbell_snatch',       'Dumbbell Snatch',       '{"DB Snatch","One-Arm DB Snatch"}',                        '{"glutes","hamstrings","back","front_delts"}',                'dumbbell', 'resistance', 'compound'),
('renegade_row',          'Renegade Row',          '{"Plank Row","DB Renegade Row"}',                           '{"back","lats","core","biceps"}',                             'dumbbell', 'resistance', 'compound'),
('dumbbell_floor_press',  'Dumbbell Floor Press',  '{"DB Floor Press"}',                                       '{"chest","triceps"}',                                         'dumbbell', 'resistance', 'compound'),
('dumbbell_woodchop',     'Dumbbell Woodchop',     '{"DB Woodchop","DB Wood Chop"}',                           '{"core","obliques","front_delts"}',                           'dumbbell', 'resistance', 'compound')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: 65 rows (12 + 18 + 15 + 20)

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed barbell + dumbbell variations (35 exercises)"
```

---

### Task 4: Add Cable and Machine exercises

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Remove trailing `ON CONFLICT`, append cable + machine section**

```sql
,
-- ── Cable ─────────────────────────────────────────────────────────
('cable_lateral_raise',   'Cable Lateral Raise',   '{"Cable Side Raise"}',                                      '{"side_delts"}',                                              'cable', 'resistance', 'isolation'),
('cable_curl',            'Cable Curl',            '{"Cable Bicep Curl","Standing Cable Curl"}',                '{"biceps"}',                                                  'cable', 'resistance', 'isolation'),
('cable_reverse_fly',     'Cable Reverse Fly',     '{"Cable Rear Delt Fly","Reverse Cable Fly"}',               '{"rear_delts"}',                                              'cable', 'resistance', 'isolation'),
('cable_woodchop',        'Cable Woodchop',        '{"Cable Wood Chop","Cable Chop","Woodchop"}',               '{"core","obliques"}',                                         'cable', 'resistance', 'compound'),
('cable_kickback',        'Cable Kickback',        '{"Cable Tricep Kickback","Cable Glute Kickback"}',          '{"triceps"}',                                                 'cable', 'resistance', 'isolation'),
('cable_pull_through',    'Cable Pull-Through',    '{"Pull-Through","Cable Pull Through"}',                     '{"glutes","hamstrings"}',                                     'cable', 'resistance', 'compound'),
('cable_crunch',          'Cable Crunch',          '{"Kneeling Cable Crunch","Rope Crunch"}',                   '{"abs"}',                                                     'cable', 'resistance', 'isolation'),
('cable_upright_row',     'Cable Upright Row',     '{"Cable Upright"}',                                         '{"traps","side_delts","biceps"}',                             'cable', 'resistance', 'compound'),
('cable_shrug',           'Cable Shrug',           '{}',                                                        '{"traps"}',                                                   'cable', 'resistance', 'isolation'),
('cable_low_to_high_fly', 'Cable Low-to-High Fly', '{"Low Cable Fly","Low-to-High Crossover"}',                 '{"upper_chest","front_delts"}',                               'cable', 'resistance', 'isolation'),
('cable_high_to_low_fly', 'Cable High-to-Low Fly', '{"High Cable Fly","High-to-Low Crossover"}',                '{"lower_chest"}',                                             'cable', 'resistance', 'isolation'),
('cable_external_rotation','Cable External Rotation','{"Cable ER","External Rotation"}',                         '{"rotator_cuff"}',                                            'cable', 'resistance', 'isolation'),

-- ── Machine ───────────────────────────────────────────────────────
('pec_deck',              'Pec Deck',              '{"Pec Deck Fly","Machine Fly","Butterfly Machine"}',        '{"chest"}',                                                   'machine', 'resistance', 'isolation'),
('hip_abductor_machine',  'Hip Abductor Machine',  '{"Abductor Machine","Hip Abduction"}',                      '{"abductors","glutes"}',                                      'machine', 'resistance', 'isolation'),
('hip_adductor_machine',  'Hip Adductor Machine',  '{"Adductor Machine","Hip Adduction","Inner Thigh Machine"}','{"adductors"}',                                               'machine', 'resistance', 'isolation'),
('seated_row_machine',    'Seated Row Machine',    '{"Machine Row","Chest-Supported Row Machine"}',             '{"back","lats","biceps"}',                                    'machine', 'resistance', 'compound'),
('reverse_pec_deck',      'Reverse Pec Deck',      '{"Machine Reverse Fly","Rear Delt Machine"}',               '{"rear_delts"}',                                              'machine', 'resistance', 'isolation'),
('glute_kickback_machine','Glute Kickback Machine','{"Machine Glute Kickback","Glute Machine"}',                '{"glutes"}',                                                  'machine', 'resistance', 'isolation'),
('smith_bench_press',     'Smith Machine Bench Press','{"Smith Bench"}',                                         '{"chest","triceps","front_delts"}',                           'machine', 'resistance', 'compound'),
('smith_overhead_press',  'Smith Machine Overhead Press','{"Smith OHP","Smith Shoulder Press"}',                  '{"front_delts","side_delts","triceps"}',                      'machine', 'resistance', 'compound'),
('vertical_leg_press',    'Vertical Leg Press',    '{"Seated Vertical Leg Press"}',                             '{"quads","glutes"}',                                          'machine', 'resistance', 'compound'),
('preacher_curl_machine', 'Preacher Curl Machine', '{"Machine Preacher Curl"}',                                 '{"biceps"}',                                                  'machine', 'resistance', 'isolation'),
('assisted_pull_up',      'Assisted Pull-Up Machine','{"Gravitron","Assisted Pull Up","Assisted Chin Up"}',      '{"lats","biceps","back"}',                                    'machine', 'resistance', 'compound'),
('ab_crunch_machine',     'Ab Crunch Machine',     '{"Machine Crunch","Ab Machine"}',                           '{"abs"}',                                                     'machine', 'resistance', 'isolation')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: 89 rows (65 + 12 + 12)

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed cable + machine variations (24 exercises)"
```

---

### Task 5: Add Trap Bar, Landmine, Strongman, Band, and Suspension exercises

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Remove trailing `ON CONFLICT`, append sections**

```sql
,
-- ── Trap Bar / Landmine ───────────────────────────────────────────
('trap_bar_deadlift',     'Trap Bar Deadlift',     '{"Hex Bar Deadlift","Hex Bar DL","TB Deadlift"}',           '{"quads","glutes","hamstrings","back","traps"}',              'trap_bar', 'resistance', 'compound'),
('trap_bar_carry',        'Trap Bar Carry',        '{"Hex Bar Carry","Trap Bar Farmer Walk"}',                  '{"traps","forearms","core"}',                                 'trap_bar', 'resistance', 'compound'),
('trap_bar_shrug',        'Trap Bar Shrug',        '{"Hex Bar Shrug"}',                                        '{"traps"}',                                                   'trap_bar', 'resistance', 'isolation'),
('trap_bar_row',          'Trap Bar Row',          '{"Hex Bar Row"}',                                           '{"back","lats","biceps"}',                                    'trap_bar', 'resistance', 'compound'),
('landmine_press',        'Landmine Press',        '{"Landmine Shoulder Press","Single-Arm Landmine Press"}',   '{"front_delts","triceps","core"}',                            'landmine', 'resistance', 'compound'),
('landmine_row',          'Landmine Row',          '{"Meadows Row","Single-Arm Landmine Row"}',                 '{"back","lats","biceps","rear_delts"}',                       'landmine', 'resistance', 'compound'),
('landmine_squat',        'Landmine Squat',        '{"Landmine Goblet Squat"}',                                 '{"quads","glutes","core"}',                                   'landmine', 'resistance', 'compound'),
('landmine_rotation',     'Landmine Rotation',     '{"Landmine Twist","Russian Landmine Twist"}',               '{"core","obliques"}',                                         'landmine', 'resistance', 'compound'),

-- ── Strongman ─────────────────────────────────────────────────────
('sled_push',             'Sled Push',             '{"Prowler Push","Sled Drive"}',                             '{"quads","glutes","calves","core"}',                          'sled', 'resistance', 'compound'),
('sled_pull',             'Sled Pull',             '{"Sled Drag","Sled Row Pull","Prowler Pull"}',              '{"back","hamstrings","glutes","biceps"}',                     'sled', 'resistance', 'compound'),
('farmers_walk',          'Farmer''s Walk',        '{"Farmer Walk","Farmer''s Carry","Farmers Carry"}',         '{"traps","forearms","core","glutes"}',                        'dumbbell', 'resistance', 'compound'),
('battle_ropes',          'Battle Ropes',          '{"Battle Rope","Battling Ropes","Rope Slams"}',             '{"front_delts","core","back"}',                               'none', 'resistance', 'compound'),
('tire_flip',             'Tire Flip',             '{"Tyre Flip"}',                                             '{"quads","glutes","hamstrings","back","front_delts"}',        'none', 'resistance', 'compound'),
('atlas_stone',           'Atlas Stone',           '{"Atlas Stone Lift","Stone to Shoulder"}',                   '{"quads","glutes","back","biceps","core"}',                   'none', 'resistance', 'compound'),
('yoke_walk',             'Yoke Walk',             '{"Yoke Carry"}',                                            '{"traps","core","quads","glutes"}',                           'none', 'resistance', 'compound'),
('sandbag_carry',         'Sandbag Carry',         '{"Sandbag Bear Hug Carry"}',                                '{"core","biceps","back","quads"}',                            'none', 'resistance', 'compound'),
('log_press',             'Log Press',             '{"Log Clean and Press"}',                                   '{"front_delts","triceps","core"}',                            'none', 'resistance', 'compound'),
('prowler_drag',          'Prowler Drag',          '{"Reverse Sled Drag","Backward Sled Pull"}',                '{"quads","hamstrings","calves"}',                             'sled', 'resistance', 'compound'),

-- ── Bands ─────────────────────────────────────────────────────────
('band_pull_apart',       'Band Pull-Apart',       '{"Band Pull Apart","Banded Pull-Apart"}',                   '{"rear_delts","traps","rotator_cuff"}',                       'band', 'resistance', 'isolation'),
('band_squat',            'Band Squat',            '{"Banded Squat","Resistance Band Squat"}',                  '{"quads","glutes"}',                                          'band', 'resistance', 'compound'),
('band_deadlift',         'Band Deadlift',         '{"Banded Deadlift","Resistance Band Deadlift"}',            '{"hamstrings","glutes","back"}',                              'band', 'resistance', 'compound'),
('band_shoulder_press',   'Band Shoulder Press',   '{"Banded OHP","Band OHP"}',                                 '{"front_delts","side_delts","triceps"}',                      'band', 'resistance', 'compound'),
('band_curl',             'Band Curl',             '{"Banded Curl","Resistance Band Curl"}',                    '{"biceps"}',                                                  'band', 'resistance', 'isolation'),
('band_tricep_extension', 'Band Tricep Extension', '{"Banded Tricep Extension","Band Pushdown"}',               '{"triceps"}',                                                 'band', 'resistance', 'isolation'),
('band_face_pull',        'Band Face Pull',        '{"Banded Face Pull"}',                                      '{"rear_delts","traps","rotator_cuff"}',                       'band', 'resistance', 'isolation'),
('band_lateral_walk',     'Band Lateral Walk',     '{"Banded Side Step","Monster Walk","Band Side Walk"}',      '{"abductors","glutes"}',                                      'band', 'resistance', 'isolation'),
('band_good_morning',     'Band Good Morning',     '{"Banded Good Morning"}',                                   '{"hamstrings","glutes","back"}',                              'band', 'resistance', 'compound'),
('band_hip_thrust',       'Band Hip Thrust',       '{"Banded Hip Thrust"}',                                     '{"glutes","hamstrings"}',                                     'band', 'resistance', 'compound'),

-- ── Suspension / TRX ──────────────────────────────────────────────
('trx_row',               'TRX Row',               '{"Suspension Row","TRX Inverted Row"}',                     '{"back","lats","biceps","rear_delts"}',                       'suspension', 'resistance', 'compound'),
('trx_chest_press',       'TRX Chest Press',       '{"Suspension Push-Up","TRX Push-Up"}',                      '{"chest","triceps","core"}',                                  'suspension', 'resistance', 'compound'),
('trx_y_fly',             'TRX Y-Fly',             '{"TRX Y Raise","Suspension Y Fly"}',                        '{"rear_delts","traps"}',                                      'suspension', 'resistance', 'isolation'),
('trx_pike',              'TRX Pike',              '{"Suspension Pike","TRX Ab Pike"}',                         '{"abs","core","front_delts"}',                                'suspension', 'resistance', 'compound'),
('trx_hamstring_curl',    'TRX Hamstring Curl',    '{"Suspension Hamstring Curl","TRX Leg Curl"}',              '{"hamstrings","glutes"}',                                     'suspension', 'resistance', 'isolation'),
('trx_single_leg_squat',  'TRX Single-Leg Squat',  '{"TRX Pistol Squat","Suspension Single-Leg Squat"}',        '{"quads","glutes","core"}',                                   'suspension', 'resistance', 'compound'),
('trx_tricep_extension',  'TRX Tricep Extension',  '{"Suspension Tricep Extension"}',                           '{"triceps"}',                                                 'suspension', 'resistance', 'isolation'),
('trx_face_pull',         'TRX Face Pull',         '{"Suspension Face Pull"}',                                  '{"rear_delts","traps","rotator_cuff"}',                       'suspension', 'resistance', 'isolation')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: 135 rows (89 + 8 + 10 + 10 + 10 + 8)

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed trap bar, landmine, strongman, bands, suspension (46 exercises)"
```

---

### Task 6: Add Gymnastics, Plyometrics, and Core exercises

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Remove trailing `ON CONFLICT`, append bodyweight sections**

```sql
,
-- ── Gymnastics / Calisthenics ─────────────────────────────────────
('muscle_up',             'Muscle-Up',             '{"Muscle Up","Bar Muscle-Up","Bar Muscle Up"}',             '{"lats","chest","triceps","biceps","core"}',                  'bodyweight', 'bodyweight', 'compound'),
('ring_muscle_up',        'Ring Muscle-Up',        '{"Ring Muscle Up","Rings Muscle-Up"}',                      '{"lats","chest","triceps","biceps","core"}',                  'rings', 'bodyweight', 'compound'),
('handstand_push_up',     'Handstand Push-Up',     '{"HSPU","Handstand Pushup","Wall HSPU"}',                   '{"front_delts","side_delts","triceps","core"}',               'bodyweight', 'bodyweight', 'compound'),
('ring_dip',              'Ring Dip',              '{"Rings Dip","Gymnastic Ring Dip"}',                        '{"chest","triceps","front_delts","core"}',                    'rings', 'bodyweight', 'compound'),
('ring_push_up',          'Ring Push-Up',          '{"Ring Pushup","Rings Push-Up"}',                           '{"chest","triceps","core"}',                                  'rings', 'bodyweight', 'compound'),
('ring_row',              'Ring Row',              '{"Rings Row","Gymnastic Ring Row"}',                        '{"back","lats","biceps","rear_delts"}',                       'rings', 'bodyweight', 'compound'),
('l_sit',                 'L-Sit',                 '{"L Sit","Parallel Bar L-Sit"}',                            '{"abs","hip_flexors","triceps"}',                             'bodyweight', 'bodyweight', 'isolation'),
('v_sit',                 'V-Sit',                 '{"V Sit"}',                                                 '{"abs","hip_flexors"}',                                       'bodyweight', 'bodyweight', 'isolation'),
('front_lever',           'Front Lever',           '{"FL"}',                                                    '{"lats","core","abs","back"}',                                'bodyweight', 'bodyweight', 'compound'),
('back_lever',            'Back Lever',            '{"BL"}',                                                    '{"front_delts","chest","core","biceps"}',                     'bodyweight', 'bodyweight', 'compound'),
('pistol_squat',          'Pistol Squat',          '{"Single-Leg Squat","One-Leg Squat"}',                      '{"quads","glutes","core"}',                                   'bodyweight', 'bodyweight', 'compound'),
('shrimp_squat',          'Shrimp Squat',          '{}',                                                        '{"quads","glutes"}',                                          'bodyweight', 'bodyweight', 'compound'),
('archer_push_up',        'Archer Push-Up',        '{"Archer Pushup"}',                                         '{"chest","triceps","core"}',                                  'bodyweight', 'bodyweight', 'compound'),
('diamond_push_up',       'Diamond Push-Up',       '{"Diamond Pushup","Close-Grip Push-Up","Triangle Push-Up"}','{"triceps","chest"}',                                         'bodyweight', 'bodyweight', 'compound'),
('wide_push_up',          'Wide Push-Up',          '{"Wide Pushup","Wide-Grip Push-Up"}',                       '{"chest","front_delts"}',                                     'bodyweight', 'bodyweight', 'compound'),
('pike_push_up',          'Pike Push-Up',          '{"Pike Pushup","Pike Press"}',                              '{"front_delts","triceps"}',                                   'bodyweight', 'bodyweight', 'compound'),
('handstand_hold',        'Handstand Hold',        '{"Wall Handstand","Handstand"}',                            '{"front_delts","core","traps"}',                              'bodyweight', 'bodyweight', 'compound'),
('human_flag',            'Human Flag',            '{}',                                                        '{"obliques","lats","front_delts","core"}',                    'bodyweight', 'bodyweight', 'compound'),
('dragon_flag',           'Dragon Flag',           '{"Bruce Lee Flag"}',                                        '{"abs","core","hip_flexors"}',                                'bodyweight', 'bodyweight', 'compound'),
('tuck_planche',          'Tuck Planche',          '{"Planche Tuck","Tuck Planche Hold"}',                      '{"front_delts","chest","core","triceps"}',                    'bodyweight', 'bodyweight', 'compound'),

-- ── Plyometrics ───────────────────────────────────────────────────
('box_jump',              'Box Jump',              '{"Box Jumps","Plyo Box Jump"}',                             '{"quads","glutes","calves"}',                                 'bodyweight', 'bodyweight', 'compound'),
('depth_jump',            'Depth Jump',            '{"Drop Jump"}',                                             '{"quads","glutes","calves"}',                                 'bodyweight', 'bodyweight', 'compound'),
('broad_jump',            'Broad Jump',            '{"Standing Long Jump","Standing Broad Jump"}',              '{"quads","glutes","hamstrings","calves"}',                    'bodyweight', 'bodyweight', 'compound'),
('tuck_jump',             'Tuck Jump',             '{"Knee Tuck Jump"}',                                        '{"quads","glutes","calves","core"}',                          'bodyweight', 'bodyweight', 'compound'),
('squat_jump',            'Squat Jump',            '{"Jump Squat","Jumping Squat"}',                            '{"quads","glutes","calves"}',                                 'bodyweight', 'bodyweight', 'compound'),
('lunge_jump',            'Lunge Jump',            '{"Jump Lunge","Jumping Lunge","Split Jump"}',               '{"quads","glutes","hamstrings"}',                             'bodyweight', 'bodyweight', 'compound'),
('burpee',                'Burpee',                '{"Burpees"}',                                               '{"quads","chest","front_delts","core"}',                      'bodyweight', 'bodyweight', 'compound'),
('clapping_push_up',      'Clapping Push-Up',      '{"Clapping Pushup","Plyo Push-Up"}',                        '{"chest","triceps"}',                                         'bodyweight', 'bodyweight', 'compound'),
('skater_jump',           'Skater Jump',           '{"Skater Hop","Ice Skater"}',                               '{"quads","glutes","abductors"}',                              'bodyweight', 'bodyweight', 'compound'),
('lateral_bound',         'Lateral Bound',         '{"Side Bound","Lateral Jump"}',                             '{"quads","glutes","abductors","calves"}',                     'bodyweight', 'bodyweight', 'compound'),
('single_leg_hop',        'Single-Leg Hop',        '{"Single Leg Hop","One-Leg Hop"}',                          '{"quads","glutes","calves"}',                                 'bodyweight', 'bodyweight', 'compound'),
('ankle_bounce',          'Ankle Bounce',          '{"Pogo Jump","Pogo Hop"}',                                  '{"calves"}',                                                  'bodyweight', 'bodyweight', 'isolation'),

-- ── Core / Abs ────────────────────────────────────────────────────
('ab_wheel_rollout',      'Ab Wheel Rollout',      '{"Ab Roller","Ab Wheel","Rollout"}',                        '{"abs","core","lats"}',                                       'bodyweight', 'bodyweight', 'compound'),
('russian_twist',         'Russian Twist',         '{"Seated Twist"}',                                          '{"obliques","abs","core"}',                                   'bodyweight', 'bodyweight', 'isolation'),
('bicycle_crunch',        'Bicycle Crunch',        '{"Bicycle","Bicycle Crunches"}',                            '{"abs","obliques"}',                                          'bodyweight', 'bodyweight', 'isolation'),
('dead_bug',              'Dead Bug',              '{}',                                                        '{"abs","core"}',                                              'bodyweight', 'bodyweight', 'isolation'),
('bird_dog',              'Bird Dog',              '{}',                                                        '{"core","glutes","back"}',                                    'bodyweight', 'bodyweight', 'isolation'),
('mountain_climber',      'Mountain Climber',      '{"Mountain Climbers"}',                                     '{"abs","core","hip_flexors","quads"}',                        'bodyweight', 'bodyweight', 'compound'),
('side_plank',            'Side Plank',            '{}',                                                        '{"obliques","core"}',                                         'bodyweight', 'bodyweight', 'isolation'),
('pallof_press',          'Pallof Press',          '{"Anti-Rotation Press","Pallof"}',                          '{"core","obliques"}',                                         'cable', 'bodyweight', 'isolation'),
('hollow_hold',           'Hollow Hold',           '{"Hollow Body Hold","Hollow Body"}',                        '{"abs","core","hip_flexors"}',                                'bodyweight', 'bodyweight', 'isolation'),
('superman',              'Superman',              '{"Superman Hold","Back Extension Hold"}',                   '{"back","glutes"}',                                           'bodyweight', 'bodyweight', 'isolation'),
('windshield_wiper',      'Windshield Wiper',      '{"Lying Windshield Wiper"}',                                '{"obliques","abs","core"}',                                   'bodyweight', 'bodyweight', 'isolation'),
('toe_touch',             'Toe Touch',             '{"Lying Toe Touch","V-Up Toe Touch"}',                      '{"abs"}',                                                     'bodyweight', 'bodyweight', 'isolation'),
('sit_up',                'Sit-Up',                '{"Sit Up","Situp","Crunches","Crunch"}',                    '{"abs","hip_flexors"}',                                       'bodyweight', 'bodyweight', 'isolation'),
('v_up',                  'V-Up',                  '{"V Up","Jackknife"}',                                      '{"abs","hip_flexors"}',                                       'bodyweight', 'bodyweight', 'isolation'),
('flutter_kick',          'Flutter Kick',          '{"Flutter Kicks","Scissor Kicks"}',                         '{"abs","hip_flexors"}',                                       'bodyweight', 'bodyweight', 'isolation')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: 182 rows (135 + 20 + 12 + 15)

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): seed gymnastics, plyometrics, core exercises (47 exercises)"
```

---

### Task 7: Add Cardio, Sport Drills, Swimming, Climbing, and Flexibility exercises

**Files:**
- Modify: `supabase/20260412_exercises_quadruple_seed.sql`

- [ ] **Step 1: Remove trailing `ON CONFLICT`, append remaining sections**

```sql
,
-- ── More Cardio ───────────────────────────────────────────────────
('assault_bike',          'Assault Bike',          '{"Air Bike","Echo Bike","Fan Bike","Airdyne"}',             '{}',                                                          'cardio_machine', 'cardio', null),
('ski_erg',               'Ski Erg',               '{"SkiErg","Ski Machine","Concept 2 Ski"}',                  '{}',                                                          'cardio_machine', 'cardio', null),
('hiking',                'Hiking',                '{"Hike","Trail Hike"}',                                     '{}',                                                          'none', 'cardio', null),
('incline_treadmill_walk','Incline Treadmill Walk','{"Treadmill Incline Walk","12-3-30"}',                      '{}',                                                          'cardio_machine', 'cardio', null),
('recumbent_bike',        'Recumbent Bike',        '{"Recumbent Cycle"}',                                      '{}',                                                          'cardio_machine', 'cardio', null),
('outdoor_cycling',       'Outdoor Cycling',       '{"Road Cycling","Bike Ride","Road Bike"}',                  '{}',                                                          'none', 'cardio', null),
('trail_running',         'Trail Running',         '{"Trail Run"}',                                             '{}',                                                          'none', 'cardio', null),
('rucking',               'Rucking',               '{"Ruck","Ruck March","Weighted Walk"}',                     '{}',                                                          'none', 'cardio', null),

-- ── Sport-Specific Drills ─────────────────────────────────────────
('sprint',                'Sprint',                '{"Sprints","Dash","100m Sprint"}',                          '{}',                                                          'none', 'cardio', null),
('hill_sprint',           'Hill Sprint',           '{"Hill Sprints","Incline Sprint"}',                         '{}',                                                          'none', 'cardio', null),
('agility_ladder',        'Agility Ladder',        '{"Ladder Drills","Speed Ladder"}',                          '{}',                                                          'none', 'cardio', null),
('shuttle_run',           'Shuttle Run',           '{"Suicide Run","Beep Test","Shuttle Sprint"}',              '{}',                                                          'none', 'cardio', null),
('bear_crawl',            'Bear Crawl',            '{"Bear Crawls"}',                                           '{"core","front_delts","quads"}',                              'none', 'cardio', null),
('crab_walk',             'Crab Walk',             '{"Crab Walks"}',                                            '{"triceps","core","glutes"}',                                 'none', 'cardio', null),
('sled_sprint',           'Sled Sprint',           '{"Prowler Sprint","Sled Run"}',                             '{}',                                                          'sled', 'cardio', null),
('prowler_reverse_drag',  'Prowler Reverse Drag',  '{"Backward Sled Walk"}',                                    '{}',                                                          'sled', 'cardio', null),

-- ── More Swimming Drills ──────────────────────────────────────────
('kickboard',             'Kickboard',             '{"Kick Board","Kick Set","Kicking Drill"}',                 '{}',                                                          'pool', 'swimming', null),
('pull_buoy',             'Pull Buoy',             '{"Pull Buoy Set","Arms-Only Swim"}',                        '{}',                                                          'pool', 'swimming', null),
('fins_drill',            'Fins Drill',            '{"Fin Swim","Fins Set"}',                                   '{}',                                                          'pool', 'swimming', null),
('catch_up_drill',        'Catch-Up Drill',        '{"Catch Up","Catch-Up Swim"}',                              '{}',                                                          'pool', 'swimming', null),
('side_kick_drill',       'Side Kick Drill',       '{"Side Kick","Side Kicking"}',                              '{}',                                                          'pool', 'swimming', null),
('sculling_drill',        'Sculling Drill',        '{"Sculling","Scull Drill"}',                                '{}',                                                          'pool', 'swimming', null),

-- ── More Climbing ─────────────────────────────────────────────────
('campus_board',          'Campus Board',          '{"Campus","Campusing"}',                                    '{}',                                                          'wall', 'climbing', null),
('hangboard',             'Hangboard',             '{"Fingerboard","Hang Board","Dead Hang"}',                  '{}',                                                          'wall', 'climbing', null),
('speed_climbing',        'Speed Climbing',        '{"Speed Climb"}',                                           '{}',                                                          'wall', 'climbing', null),
('crack_climbing',        'Crack Climbing',        '{"Crack Climb","Jamming"}',                                 '{}',                                                          'wall', 'climbing', null),

-- ── Flexibility / Stretching ──────────────────────────────────────
('downward_dog',          'Downward Dog',          '{"Down Dog","Adho Mukha Svanasana"}',                       '{"hamstrings","calves","back","front_delts"}',                'bodyweight', 'bodyweight', 'isolation'),
('pigeon_stretch',        'Pigeon Stretch',        '{"Pigeon Pose","Half Pigeon"}',                             '{"glutes","hip_flexors"}',                                    'bodyweight', 'bodyweight', 'isolation'),
('hip_flexor_stretch',    'Hip Flexor Stretch',    '{"Kneeling Hip Flexor Stretch","Couch Stretch"}',           '{"hip_flexors","quads"}',                                     'bodyweight', 'bodyweight', 'isolation'),
('hamstring_stretch',     'Hamstring Stretch',     '{"Standing Hamstring Stretch","Seated Hamstring Stretch"}', '{"hamstrings"}',                                              'bodyweight', 'bodyweight', 'isolation'),
('quad_stretch',          'Quad Stretch',          '{"Standing Quad Stretch"}',                                 '{"quads","hip_flexors"}',                                     'bodyweight', 'bodyweight', 'isolation'),
('calf_stretch',          'Calf Stretch',          '{"Wall Calf Stretch","Standing Calf Stretch"}',             '{"calves"}',                                                  'bodyweight', 'bodyweight', 'isolation'),
('cat_cow',               'Cat-Cow',               '{"Cat Cow","Cat-Cow Stretch"}',                             '{"back","core","abs"}',                                       'bodyweight', 'bodyweight', 'isolation'),
('childs_pose',           'Child''s Pose',         '{"Child Pose","Balasana"}',                                 '{"back","lats"}',                                             'bodyweight', 'bodyweight', 'isolation'),
('worlds_greatest_stretch','World''s Greatest Stretch','{"WGS","Greatest Stretch"}',                             '{"hip_flexors","hamstrings","back","core"}',                  'bodyweight', 'bodyweight', 'isolation'),
('ninety_ninety_hip',     '90/90 Hip Stretch',     '{"90/90 Stretch","90 90 Hip","Shinbox Stretch"}',           '{"glutes","hip_flexors","adductors"}',                        'bodyweight', 'bodyweight', 'isolation'),
('thoracic_rotation',     'Thoracic Spine Rotation','{"T-Spine Rotation","Open Book Stretch"}',                 '{"back","core","obliques"}',                                  'bodyweight', 'bodyweight', 'isolation'),
('banded_shoulder_distraction','Banded Shoulder Distraction','{"Band Shoulder Stretch","Shoulder Distraction"}', '{"front_delts","rotator_cuff"}',                              'band', 'bodyweight', 'isolation'),
('foam_roll',             'Foam Roll',             '{"Foam Rolling","Roller","SMR","Self-Myofascial Release"}', '{}',                                                          'none', 'bodyweight', 'isolation')

ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Verify final row count**

```bash
node -e "const fs=require('fs'); const sql=fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql','utf8'); console.log('Rows:', (sql.match(/^\('/gm)||[]).length)"
```
Expected: ~207 rows (182 + 8 + 8 + 6 + 4 + 13 = 221 — may vary slightly, but should be in the 200-220 range)

- [ ] **Step 3: Full slug uniqueness check**

Verify no duplicate slugs within the new migration, and no collisions with the existing 69 seeds:

```bash
node -e "
const fs = require('fs');
const newSql = fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql', 'utf8');
const oldSql = fs.readFileSync('supabase/20260411_exercises.sql', 'utf8');
const old2 = fs.readFileSync('supabase/20260412_exercises_expanded_categories.sql', 'utf8');
const extract = s => [...s.matchAll(/^\('([a-z_]+)'/gm)].map(m => m[1]);
const newSlugs = extract(newSql);
const oldSlugs = [...extract(oldSql), ...extract(old2)];
const dupsNew = newSlugs.filter((s, i) => newSlugs.indexOf(s) !== i);
const collisions = newSlugs.filter(s => oldSlugs.includes(s));
console.log('New slugs:', newSlugs.length);
console.log('Duplicate new slugs:', dupsNew.length ? dupsNew : 'none');
console.log('Collisions with existing:', collisions.length ? collisions : 'none');
"
```
Expected: 0 duplicate new slugs, 0 collisions with existing.

- [ ] **Step 4: Validate SQL syntax by dry-running against a throw-away parse**

```bash
node -e "
const fs = require('fs');
const sql = fs.readFileSync('supabase/20260412_exercises_quadruple_seed.sql', 'utf8');
// Check balanced parens in the VALUES clause
const opens = (sql.match(/\('/g) || []).length;
const closes = (sql.match(/'\)/g) || []).length;
console.log('Opening value rows:', opens, '| Closing value rows:', closes);
if (opens !== closes) console.error('MISMATCH — check for unbalanced parentheses');
else console.log('OK — balanced');
// Check single quotes are properly escaped
const lines = sql.split('\n');
lines.forEach((line, i) => {
  // Skip comment lines
  if (line.trim().startsWith('--')) return;
  // Find unescaped single quotes (odd count means broken)
  const stripped = line.replace(/''/g, '');  // remove escaped quotes
  const count = (stripped.match(/'/g) || []).length;
  if (count % 2 !== 0) console.error('Line ' + (i+1) + ': odd single-quote count (unescaped quote?)');
});
console.log('Quote validation done');
"
```
Expected: "OK — balanced" and "Quote validation done" with no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/20260412_exercises_quadruple_seed.sql
git commit -m "feat(exercises): complete quadruple seed — cardio, drills, swimming, climbing, flexibility (final ~207 exercises)"
```

---

### Task 8: Apply migration to production

**Files:**
- No file changes — operational task

**Note:** This task requires SSH access to the Hetzner VPS. Confirm with the user before executing.

- [ ] **Step 1: Confirm with user before applying to production**

This writes to the production database. Ask user for explicit go-ahead.

- [ ] **Step 2: Apply migration**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -f ~/app/supabase/20260412_exercises_quadruple_seed.sql'
```

Expected: `INSERT 0 NNN` where NNN is ~207.

- [ ] **Step 3: Verify total exercise count**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT category, count(*) FROM exercises WHERE auto_created = false GROUP BY category ORDER BY category;"'
```

Expected output (approximately):
```
 category   | count
------------+-------
 bodyweight  |  ~76
 cardio      |  ~24
 climbing    |   ~8
 resistance  | ~148
 swimming    |  ~12
```

Total: ~268-276 seeded exercises (69 original + ~207 new).

- [ ] **Step 4: Spot-check a few exercises**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT name, aliases, muscle_groups, equipment, category FROM exercises WHERE slug IN ('"'"'kettlebell_swing'"'"', '"'"'muscle_up'"'"', '"'"'cable_woodchop'"'"', '"'"'trap_bar_deadlift'"'"', '"'"'box_jump'"'"');"'
```

Expected: 5 rows with correct aliases and muscle_groups.

- [ ] **Step 5: Verify fuzzy matching works for new exercises**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT name, similarity(name, '"'"'KB Swing'"'"') AS sim FROM exercises WHERE name % '"'"'KB Swing'"'"' ORDER BY sim DESC LIMIT 3;"'
```

Expected: `Kettlebell Swing` should appear with high similarity score.

- [ ] **Step 6: Commit and update docs**

Update `docs/schema.md` to note the new migration:

Add to the migrations table:
```markdown
| `supabase/20260412_exercises_quadruple_seed.sql` | Seeds ~207 additional exercises (Olympic lifts, kettlebell, calisthenics, plyometrics, strongman, bands, suspension, cable, machine, trap bar, landmine, core, cardio, sport drills, swimming drills, climbing, flexibility). New equipment values: kettlebell, band, suspension, rings, sled, landmine, trap_bar. |
```

Update the `exercises` key tables entry count from 69 to ~276.

```bash
git add docs/schema.md
git commit -m "docs: update schema.md with exercise quadruple seed migration"
```

Append to `changelog.md`:

```markdown
2026-04-12 — Quadrupled exercise seed catalog from 69 → ~276 exercises. Added Olympic lifts, kettlebell, calisthenics, plyometrics, strongman, bands, TRX, cable, machine, trap bar, landmine, core, cardio drills, swimming drills, climbing, flexibility. New equipment values: kettlebell, band, suspension, rings, sled, landmine, trap_bar. Migration: `supabase/20260412_exercises_quadruple_seed.sql`.
```

```bash
git add changelog.md
git commit -m "docs: changelog entry for exercise catalog expansion"
```
