# Exercise Catalog Expansion — Design Spec

**Date:** 2026-04-12
**Goal:** Quadruple the seeded exercise catalog from 69 to ~276 entries, covering a broad range of training modalities.

## Motivation

The current 69-exercise seed covers standard barbell/dumbbell/machine lifts, basic bodyweight movements, cardio machines, swimming strokes, and climbing styles. Users who train with kettlebells, Olympic lifts, gymnastic rings, bands, sleds, TRX, or who do plyometrics, sport-specific drills, mobility work, or advanced calisthenics hit the `resolve_exercise_id` auto-create fallback constantly. Auto-created entries lack `muscle_groups` (breaking the volume heatmap) and `aliases` (degrading future fuzzy matching).

## Constraints

- **No schema changes.** All new exercises fit the existing `exercises` table schema and existing `category` CHECK values (`resistance`, `cardio`, `bodyweight`, `swimming`, `climbing`, `hybrid`).
- **No new categories.** Stretching/flexibility → `bodyweight`. Plyometrics → `bodyweight`. Sport-specific cardio drills → `cardio`.
- **New equipment values are free** — the `equipment` column has no CHECK constraint. New values: `kettlebell`, `band`, `suspension`, `rings`, `sled`, `landmine`, `trap_bar`.
- **Idempotent** — `ON CONFLICT (slug) DO NOTHING`, same pattern as existing seeds.
- **Aliases must be thorough** — common gym names, abbreviations, app shorthand. This is what powers `resolve_exercise_id`'s fuzzy match pipeline.
- **muscle_groups must be accurate** — these drive the volume-by-muscle heatmap in /app/progress/.

## Deliverable

A single SQL migration file: `supabase/20260412_exercises_quadruple_seed.sql`

One `INSERT INTO public.exercises ... ON CONFLICT (slug) DO NOTHING` statement with ~207 new rows.

## Exercise Breakdown by Modality

### Olympic Lifts (~12) — category: resistance, equipment: barbell

- Power Clean, Hang Clean, Clean & Jerk, Clean Pull, Snatch, Power Snatch, Hang Snatch, Snatch Pull, Clean High Pull, Push Press, Push Jerk, Split Jerk

### Kettlebell (~18) — category: resistance, equipment: kettlebell

- Kettlebell Swing, KB Goblet Squat, KB Clean, KB Snatch, KB Press, Turkish Get-Up, KB Front Squat, KB Windmill, KB Halo, KB Row, KB Deadlift, KB Lunge, KB Thruster, KB High Pull, KB Farmer's Carry, KB Sumo Deadlift, KB Floor Press, KB Rack Walk

### More Barbell (~15) — category: resistance, equipment: barbell

- Barbell Shrug, Barbell Upright Row, Barbell Skull Crusher, Barbell Wrist Curl, Barbell Reverse Curl, Floor Press, Zercher Squat, Anderson Squat, Pause Squat, Deficit Deadlift, Block Pull, Barbell Good Morning, Barbell Lunge, Barbell Step-Up, Pin Press

### More Dumbbell (~20) — category: resistance, equipment: dumbbell

- Dumbbell Shrug, Dumbbell Upright Row, Dumbbell Skull Crusher, Dumbbell Pullover, Dumbbell Front Raise, Dumbbell Arnold Press, Dumbbell Wrist Curl, Dumbbell Step-Up, Dumbbell Bulgarian Split Squat, Incline Dumbbell Curl, Dumbbell Kickback, Dumbbell Calf Raise, Decline Dumbbell Bench Press, Single-Arm Dumbbell Press, Dumbbell Squeeze Press, Dumbbell Thruster, Dumbbell Snatch, Renegade Row, Dumbbell Floor Press, Dumbbell Woodchop

### Cable (~12) — category: resistance, equipment: cable

- Cable Lateral Raise, Cable Curl, Cable Reverse Fly, Cable Woodchop, Cable Kickback, Cable Pull-Through, Cable Crunch, Cable Upright Row, Cable Shrug, Cable Crossover (low-to-high), Cable Crossover (high-to-low), Cable External Rotation

### Machine (~12) — category: resistance, equipment: machine

- Pec Deck, Hip Abductor Machine, Hip Adductor Machine, Seated Row Machine, Reverse Pec Deck, Glute Kickback Machine, Smith Machine Bench Press, Smith Machine Overhead Press, Vertical Leg Press, Preacher Curl Machine, Assisted Pull-Up Machine, Ab Crunch Machine

### Trap Bar / Landmine (~8) — category: resistance, equipment: trap_bar / landmine

- Trap Bar Deadlift, Trap Bar Carry, Trap Bar Shrug, Trap Bar Row, Landmine Press, Landmine Row, Landmine Squat, Landmine Rotation

### Strongman (~10) — category: resistance, equipment: sled / barbell / none

- Sled Push, Sled Pull, Farmer's Walk (barbell/dumbbell variant already exists via KB), Battle Ropes, Tire Flip, Atlas Stone, Yoke Walk, Sandbag Carry, Log Press, Prowler Push

### Bands (~10) — category: resistance, equipment: band

- Band Pull-Apart, Band Squat, Band Deadlift, Band Shoulder Press, Band Curl, Band Tricep Extension, Band Face Pull, Band Lateral Walk, Band Good Morning, Band Hip Thrust

### Suspension / TRX (~8) — category: resistance, equipment: suspension

- TRX Row, TRX Chest Press, TRX Y-Fly, TRX Pike, TRX Hamstring Curl, TRX Single-Leg Squat, TRX Tricep Extension, TRX Face Pull

### Gymnastics / Calisthenics (~20) — category: bodyweight, equipment: bodyweight / rings

- Muscle-Up, Ring Muscle-Up, Handstand Push-Up, Ring Dip, Ring Push-Up, Ring Row, L-Sit, V-Sit, Front Lever, Back Lever, Pistol Squat, Shrimp Squat, Archer Push-Up, Diamond Push-Up, Wide Push-Up, Pike Push-Up, Handstand Hold, Human Flag, Dragon Flag, Tuck Planche

### Plyometrics (~12) — category: bodyweight, equipment: bodyweight

- Box Jump, Depth Jump, Broad Jump, Tuck Jump, Squat Jump, Lunge Jump, Burpee, Clapping Push-Up, Skater Jump, Lateral Bound, Single-Leg Hop, Ankle Bounce

### Core / Abs Expanded (~15) — category: bodyweight, equipment: bodyweight

- Ab Wheel Rollout, Russian Twist, Bicycle Crunch, Dead Bug, Bird Dog, Mountain Climber, Side Plank, Pallof Press, Hollow Hold, Superman, Windshield Wiper, Toe Touch, Sit-Up, V-Up, Flutter Kick

### More Cardio (~8) — category: cardio, equipment: cardio_machine / none

- Assault Bike, Ski Erg, Hiking, Incline Treadmill Walk, Recumbent Bike, Outdoor Cycling, Trail Running, Rucking

### Sport-Specific Drills (~8) — category: cardio, equipment: none

- Sprint, Hill Sprint, Agility Ladder, Shuttle Run, Bear Crawl, Crab Walk, Sled Sprint, Prowler Drag

### More Swimming (~6) — category: swimming, equipment: pool

- Kickboard, Pull Buoy, Fins Drill, Catch-Up Drill, Side Kick Drill, Sculling Drill

### More Climbing (~4) — category: climbing, equipment: wall

- Campus Board, Hangboard, Speed Climbing, Crack Climbing

### Flexibility / Stretching (~13) — category: bodyweight, equipment: bodyweight, movement_type: isolation

- Downward Dog, Pigeon Stretch, Hip Flexor Stretch, Hamstring Stretch, Quad Stretch, Calf Stretch, Cat-Cow, Child's Pose, World's Greatest Stretch, 90/90 Hip Stretch, Thoracic Spine Rotation, Banded Shoulder Distraction, Foam Roll (generic)

## Data Quality Rules

1. **slug** — lowercase, underscored, globally unique. Pattern: `{equipment_prefix}_{exercise_name}` where ambiguous, otherwise just `{exercise_name}`.
2. **name** — Title Case, canonical gym name.
3. **aliases** — include: common abbreviations (KB, DB, BB, TRX), alternative names, spelling variants (Push-Up vs Push Up vs Pushup). Minimum 1 alias for any exercise with a well-known alternate name.
4. **muscle_groups** — use the existing vocabulary from the 69 seeds: `quads`, `glutes`, `hamstrings`, `chest`, `upper_chest`, `lower_chest`, `back`, `lats`, `traps`, `front_delts`, `side_delts`, `rear_delts`, `biceps`, `triceps`, `forearms`, `core`, `abs`, `hip_flexors`, `calves`, `rotator_cuff`. Add new groups only if genuinely needed (e.g., `obliques`, `adductors`, `abductors`).
5. **equipment** — existing: `barbell`, `dumbbell`, `cable`, `machine`, `bodyweight`, `cardio_machine`, `none`, `pool`, `open`, `wall`. New: `kettlebell`, `band`, `suspension`, `rings`, `sled`, `landmine`, `trap_bar`.
6. **movement_type** — `compound` or `isolation` for resistance/bodyweight. `null` for cardio/swimming/climbing. Stretches → `isolation`.
7. **No duplicates** — check every proposed exercise against the existing 69 seeds. If an exercise overlaps (e.g., Farmer's Walk vs KB Farmer's Carry), either skip it or differentiate by equipment.

## Downstream Impact

- **resolve_exercise_id** — no changes needed. More seeds = fewer auto-creates = better data quality.
- **Volume heatmap** — more exercises with accurate muscle_groups = richer heatmap.
- **LLM workout plans** — the system prompt in workflow.js doesn't enumerate exercises, so no changes needed. The LLM generates exercise names freely; `resolve_exercise_id` matches them.
- **Admin review** — fewer `auto_created = true` rows to manually review over time.
- **Migration size** — single INSERT, ~207 rows, ~30 KB of SQL. Apply via `infra/apply-migrations.sh -U supabase_admin`.

## Non-Goals

- No new `category` CHECK values.
- No changes to `resolve_exercise_id`, `upsert_workout_logs`, or any RPC.
- No UI changes (exercise catalog isn't browsable in the app yet).
- No changes to the LLM system prompt.

## Rollback

`DELETE FROM exercises WHERE slug IN (...)` with the list of new slugs. Or simpler: restore from the daily backup (these are seed rows, not user data — the only user-facing rows are `auto_created = true` entries which this migration doesn't touch).
