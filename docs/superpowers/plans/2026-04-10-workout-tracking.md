# Workout Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see their training history, exercise progression, volume trends, PRs, and muscle group distribution from logged workout sessions.

**Architecture:** Flat `workout_logs` table as a queryable projection of existing `completed_blocks` JSONB. Canonical `exercises` catalog with fuzzy matching pipeline. Postgres RPCs for all analytics. Client calls `upsert_workout_logs` RPC after each session save. Dashboard + drill-down pages built with React via esm.sh (same pattern as session view).

**Tech Stack:** Postgres 15 (pg_trgm, pgcrypto), Supabase RLS, React 18.2.0 via esm.sh, inline SVG charts, Express 5 (API-only, no changes needed for static pages).

**Spec:** `docs/superpowers/specs/2026-04-10-workout-tracking-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/20260411_exercises.sql` | Exercises catalog table + seed data (~80 exercises) |
| `supabase/20260411_workout_logs.sql` | Workout logs table + indexes + RLS + upsert RPC |
| `supabase/20260411_progress_rpcs.sql` | All analytics Postgres functions (7 RPCs) |
| `shared/exercise-icons.js` | SVG icon strings for resistance/cardio/bodyweight/trophy |
| `shared/progress-charts.js` | Functions that return SVG markup for bar/line charts |
| `shared/progress-helpers.js` | Supabase RPC wrappers + formatting utils for progress pages |
| `app/progress/index.html` | Progress dashboard HTML shell |
| `app/progress/progress.js` | Dashboard React component |
| `app/progress/exercise/index.html` | Exercise detail HTML shell |
| `app/progress/exercise/exercise.js` | Exercise detail React component |
| `app/progress/session/index.html` | Session detail HTML shell |
| `app/progress/session/session-detail.js` | Session detail React component |
| `scripts/backfill-workout-logs.js` | One-time backfill script for existing data |

### Modified files

| File | Change |
|------|--------|
| `shared/supabase.js` | Add `upsertWorkoutLogs()` wrapper that calls the RPC after session save |
| `app/workout/session/session.js` | Call `upsertWorkoutLogs()` after `applyManualWorkoutPlanEdit()` succeeds |
| `app/workout/workout.js` | Add stats strip + "View progress" link below plan header |
| `app/workout/index.html` | Add "Progress" link to nav if not already present |

---

## Task 1: Create exercises catalog table + seed data

**Files:**
- Create: `supabase/20260411_exercises.sql`

This migration creates the canonical exercise catalog and seeds it with common exercises across resistance, cardio, and bodyweight categories.

- [ ] **Step 1: Write the migration**

Create `supabase/20260411_exercises.sql`:

```sql
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
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd "C:/Users/Sidar/Desktop/emersus" && grep -c "insert into" supabase/20260411_exercises.sql`
Expected: confirms the insert statement count.

- [ ] **Step 3: Commit**

```bash
git add supabase/20260411_exercises.sql
git commit -m "feat: add exercises catalog table with seed data"
```

---

## Task 2: Create workout_logs table + upsert RPC

**Files:**
- Create: `supabase/20260411_workout_logs.sql`

The workout_logs table is the flat, queryable projection of completed_blocks. The `upsert_workout_logs` RPC handles exercise matching and row insertion in a single server-side call.

- [ ] **Step 1: Write the migration**

Create `supabase/20260411_workout_logs.sql`:

```sql
-- Flat workout log table — queryable projection of completed_blocks JSONB.
-- Written to by upsert_workout_logs() RPC on each session save.
-- Source of truth remains completed_blocks in workout_plans.plan.

create table if not exists public.workout_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  exercise_id      uuid not null references public.exercises(id) on delete cascade,
  plan_id          uuid references public.workout_plans(id) on delete set null,
  session_id       text,
  performed_at     date not null,
  set_number       smallint,
  reps             smallint,
  load_kg          numeric(6,2),
  rpe              numeric(3,1),
  duration_seconds integer,
  distance_meters  numeric(10,2),
  avg_heart_rate   smallint,
  calories         smallint,
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists workout_logs_user_exercise_date_idx
  on public.workout_logs (user_id, exercise_id, performed_at);

create index if not exists workout_logs_user_date_idx
  on public.workout_logs (user_id, performed_at);

create index if not exists workout_logs_user_plan_session_idx
  on public.workout_logs (user_id, plan_id, session_id);

alter table public.workout_logs enable row level security;

drop policy if exists "users can read own workout_logs" on public.workout_logs;
create policy "users can read own workout_logs"
on public.workout_logs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own workout_logs" on public.workout_logs;
create policy "users can insert own workout_logs"
on public.workout_logs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own workout_logs" on public.workout_logs;
create policy "users can update own workout_logs"
on public.workout_logs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own workout_logs" on public.workout_logs;
create policy "users can delete own workout_logs"
on public.workout_logs
for delete
to authenticated
using (auth.uid() = user_id);

-- ── Exercise matching + log upsert RPC ─────────────────────────────
--
-- resolve_exercise_id(p_name text) → uuid
-- Tries: exact name → alias → pg_trgm fuzzy (>= 0.5) → auto-create.
-- Called internally by upsert_workout_logs. SECURITY DEFINER so it can
-- insert into exercises (which is service_role-only for regular users).

create or replace function public.resolve_exercise_id(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_slug text;
begin
  -- 1. Exact name match (case-insensitive)
  select id into v_id
  from public.exercises
  where lower(name) = lower(p_name)
  limit 1;
  if v_id is not null then return v_id; end if;

  -- 2. Alias match
  select id into v_id
  from public.exercises
  where lower(p_name) = any(
    select lower(a) from unnest(aliases) as a
  )
  limit 1;
  if v_id is not null then return v_id; end if;

  -- 3. Fuzzy match via pg_trgm
  select id into v_id
  from (
    select id, greatest(
      similarity(lower(name), lower(p_name)),
      coalesce((
        select max(similarity(lower(a), lower(p_name)))
        from unnest(aliases) as a
      ), 0)
    ) as sim
    from public.exercises
  ) sub
  where sub.sim >= 0.5
  order by sub.sim desc
  limit 1;
  if v_id is not null then return v_id; end if;

  -- 4. Auto-create
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_|_$', '', 'g');

  insert into public.exercises (slug, name, category, auto_created)
  values (v_slug, trim(p_name), 'resistance', true)
  on conflict (slug) do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$$;

-- ── upsert_workout_logs(user_id, plan_id, session_id, performed_at, blocks jsonb)
--
-- blocks is the completed_blocks array from a single session:
-- [{ "block_id": "b_s_w1d1_0", "actual_sets": [...], "exercise_name": "Bench Press" }, ...]
--
-- The caller must include "exercise_name" on each block (extracted from
-- the plan's blocks array by matching block_id).

create or replace function public.upsert_workout_logs(
  p_user_id      uuid,
  p_plan_id      uuid,
  p_session_id   text,
  p_performed_at date,
  p_blocks       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block     jsonb;
  v_set       jsonb;
  v_ex_id     uuid;
  v_ex_name   text;
  v_set_num   int;
  v_matched   int := 0;
  v_inserted  int := 0;
begin
  -- Delete existing logs for this session to handle re-saves cleanly
  delete from public.workout_logs
  where user_id = p_user_id
    and plan_id = p_plan_id
    and session_id = p_session_id;

  -- Process each block
  for v_block in select * from jsonb_array_elements(p_blocks)
  loop
    v_ex_name := v_block ->> 'exercise_name';
    if v_ex_name is null or v_ex_name = '' then
      continue;
    end if;

    v_ex_id := resolve_exercise_id(v_ex_name);
    v_matched := v_matched + 1;

    -- Check if this is a cardio block (has duration_seconds, no actual_sets)
    if v_block ? 'duration_seconds' then
      insert into public.workout_logs (
        user_id, exercise_id, plan_id, session_id, performed_at,
        duration_seconds, distance_meters, avg_heart_rate, calories, notes
      ) values (
        p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
        (v_block ->> 'duration_seconds')::int,
        (v_block ->> 'distance_meters')::numeric,
        (v_block ->> 'avg_heart_rate')::smallint,
        (v_block ->> 'calories')::smallint,
        v_block ->> 'session_notes'
      );
      v_inserted := v_inserted + 1;
    else
      -- Resistance / bodyweight: iterate actual_sets
      v_set_num := 0;
      for v_set in select * from jsonb_array_elements(
        coalesce(v_block -> 'actual_sets', '[]'::jsonb)
      )
      loop
        -- Skip sets not marked done
        if (v_set ->> 'done')::boolean is not true then
          continue;
        end if;

        v_set_num := v_set_num + 1;

        insert into public.workout_logs (
          user_id, exercise_id, plan_id, session_id, performed_at,
          set_number, reps, load_kg, rpe, notes
        ) values (
          p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
          v_set_num,
          nullif(trim(v_set ->> 'reps'), '')::smallint,
          nullif(trim(v_set ->> 'load'), '')::numeric,
          nullif(trim(v_set ->> 'rpe'), '')::numeric,
          nullif(trim(v_set ->> 'notes'), '')
        );
        v_inserted := v_inserted + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'exercises_matched', v_matched,
    'rows_inserted', v_inserted
  );
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/20260411_workout_logs.sql
git commit -m "feat: add workout_logs table and upsert RPC with exercise matching"
```

---

## Task 3: Create analytics RPCs

**Files:**
- Create: `supabase/20260411_progress_rpcs.sql`

Seven Postgres functions that power the progress dashboard and drill-down views.

- [ ] **Step 1: Write the migration**

Create `supabase/20260411_progress_rpcs.sql`:

```sql
-- Analytics RPCs for the progress dashboard.
-- All functions take user_id + date range and return JSON.
-- Called from the frontend via supabase.rpc().

-- ── get_progress_dashboard ──────────────────────────────────────────

create or replace function public.get_progress_dashboard(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'sessions_completed', count(distinct case
      when e.category <> 'cardio' then wl.session_id
    end),
    'total_volume_kg', coalesce(sum(
      case when e.category <> 'cardio' and wl.reps is not null and wl.load_kg is not null
           then wl.reps * wl.load_kg
           else 0
      end
    ), 0)::numeric,
    'total_cardio_seconds', coalesce(sum(
      case when e.category = 'cardio' then wl.duration_seconds else 0 end
    ), 0),
    'cardio_session_count', count(distinct case
      when e.category = 'cardio' then wl.session_id
    end),
    'unique_exercises', count(distinct wl.exercise_id),
    -- Adherence: count scheduled sessions from the active plan JSONB
    'sessions_scheduled', (
      select count(*)
      from public.workout_plans wp,
           lateral jsonb_array_elements(wp.plan -> 'sessions') as s
      where wp.user_id = p_user_id
        and wp.archived_at is null
        and (s ->> 'date')::date between p_range_start and p_range_end
    ),
    'adherence_pct', case
      when (
        select count(*)
        from public.workout_plans wp,
             lateral jsonb_array_elements(wp.plan -> 'sessions') as s
        where wp.user_id = p_user_id
          and wp.archived_at is null
          and (s ->> 'date')::date between p_range_start and p_range_end
      ) > 0 then round(
        count(distinct case when e.category <> 'cardio' then wl.session_id end)::numeric * 100 /
        (select count(*)
         from public.workout_plans wp,
              lateral jsonb_array_elements(wp.plan -> 'sessions') as s
         where wp.user_id = p_user_id
           and wp.archived_at is null
           and (s ->> 'date')::date between p_range_start and p_range_end
        )
      ) else 0 end
  ) into v_result
  from public.workout_logs wl
  join public.exercises e on e.id = wl.exercise_id
  where wl.user_id = p_user_id
    and wl.performed_at between p_range_start and p_range_end;

  return v_result;
end;
$$;

-- ── get_weekly_activity ─────────────────────────────────────────────

create or replace function public.get_weekly_activity(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub) order by sub.week_start)
    from (
      select
        date_trunc('week', wl.performed_at::timestamp)::date as week_start,
        coalesce(sum(case
          when e.category <> 'cardio' and wl.reps is not null and wl.load_kg is not null
          then wl.reps * wl.load_kg else 0
        end), 0)::numeric as resistance_volume_kg,
        coalesce(sum(case
          when e.category = 'cardio' then wl.duration_seconds else 0
        end), 0) as cardio_duration_seconds
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
      group by 1
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_muscle_volume ───────────────────────────────────────────────

create or replace function public.get_muscle_volume(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub) order by sub.volume_kg desc)
    from (
      select
        mg as muscle_group,
        sum(wl.reps * wl.load_kg)::numeric as volume_kg
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id,
      lateral unnest(e.muscle_groups) as mg
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
        and e.category <> 'cardio'
        and wl.reps is not null
        and wl.load_kg is not null
      group by mg
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_recent_sessions ─────────────────────────────────────────────

create or replace function public.get_recent_sessions(
  p_user_id uuid,
  p_limit   int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        wl.plan_id,
        wl.session_id,
        wl.performed_at,
        count(distinct wl.exercise_id) as exercise_count,
        coalesce(sum(
          case when wl.reps is not null and wl.load_kg is not null
               then wl.reps * wl.load_kg else 0 end
        ), 0)::numeric as volume_kg,
        coalesce(sum(wl.duration_seconds), 0) as cardio_seconds,
        case
          when bool_or(e.category = 'cardio') and not bool_or(e.category <> 'cardio') then 'cardio'
          when bool_or(e.category <> 'cardio') and not bool_or(e.category = 'cardio') then 'resistance'
          else 'mixed'
        end as category
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
      group by wl.plan_id, wl.session_id, wl.performed_at
      order by wl.performed_at desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_top_exercises ───────────────────────────────────────────────

create or replace function public.get_top_exercises(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date,
  p_limit       int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        e.id as exercise_id,
        e.slug,
        e.name,
        e.category,
        e.movement_type,
        count(distinct (wl.plan_id, wl.session_id)) as session_count,
        case when e.category <> 'cardio' then
          max(wl.load_kg)
        end as best_load_kg,
        case when e.category <> 'cardio' then
          max(case when wl.reps is not null and wl.load_kg is not null
                   then wl.load_kg * (1 + wl.reps::numeric / 30)
          end)::numeric(6,1)
        end as best_e1rm_kg,
        case when e.category = 'cardio' then
          sum(wl.duration_seconds)
        end as total_duration_seconds,
        case when e.category = 'cardio' then
          sum(wl.distance_meters)::numeric(10,1)
        end as total_distance_meters
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
      group by e.id, e.slug, e.name, e.category, e.movement_type
      order by session_count desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_exercise_history ────────────────────────────────────────────

create or replace function public.get_exercise_history(
  p_user_id     uuid,
  p_exercise_id uuid,
  p_limit       int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        wl.performed_at,
        wl.plan_id,
        wl.session_id,
        count(*) as set_count,
        max(wl.load_kg) as max_load_kg,
        max(wl.reps) as max_reps,
        sum(case when wl.reps is not null and wl.load_kg is not null
                 then wl.reps * wl.load_kg else 0 end)::numeric as volume_kg,
        max(case when wl.reps is not null and wl.load_kg is not null
                 then wl.load_kg * (1 + wl.reps::numeric / 30)
        end)::numeric(6,1) as e1rm_kg,
        sum(wl.duration_seconds) as total_duration_seconds,
        sum(wl.distance_meters)::numeric(10,1) as total_distance_meters
      from public.workout_logs wl
      where wl.user_id = p_user_id
        and wl.exercise_id = p_exercise_id
      group by wl.performed_at, wl.plan_id, wl.session_id
      order by wl.performed_at desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_session_detail ──────────────────────────────────────────────

create or replace function public.get_session_detail(
  p_user_id    uuid,
  p_plan_id    uuid,
  p_session_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        e.name as exercise_name,
        e.slug as exercise_slug,
        e.category,
        wl.set_number,
        wl.reps,
        wl.load_kg,
        wl.rpe,
        wl.duration_seconds,
        wl.distance_meters,
        wl.avg_heart_rate,
        wl.calories,
        wl.notes,
        wl.performed_at
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.plan_id = p_plan_id
        and wl.session_id = p_session_id
      order by e.name, wl.set_number
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_personal_records ────────────────────────────────────────────

create or replace function public.get_personal_records(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      -- For each exercise, find the all-time best e1RM and check if
      -- it was achieved within the requested date range.
      select
        e.name as exercise_name,
        e.slug,
        e.category,
        'e1rm' as pr_type,
        best_in_range.e1rm as value,
        best_in_range.performed_at as achieved_at
      from (
        select
          wl.exercise_id,
          wl.performed_at,
          (wl.load_kg * (1 + wl.reps::numeric / 30))::numeric(6,1) as e1rm,
          row_number() over (
            partition by wl.exercise_id
            order by (wl.load_kg * (1 + wl.reps::numeric / 30)) desc
          ) as rn
        from public.workout_logs wl
        join public.exercises e2 on e2.id = wl.exercise_id
        where wl.user_id = p_user_id
          and e2.category <> 'cardio'
          and wl.reps is not null
          and wl.load_kg is not null
          and wl.load_kg > 0
      ) best_in_range
      join public.exercises e on e.id = best_in_range.exercise_id
      where best_in_range.rn = 1
        and best_in_range.performed_at between p_range_start and p_range_end
      order by best_in_range.e1rm desc
    ) sub
  ), '[]'::jsonb);
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/20260411_progress_rpcs.sql
git commit -m "feat: add progress analytics RPCs (dashboard, weekly, muscle, sessions, exercises, PRs)"
```

---

## Task 4: Apply migrations to production

**Files:**
- No new files

- [ ] **Step 1: Copy migrations to Hetzner**

```bash
scp supabase/20260411_exercises.sql supabase/20260411_workout_logs.sql supabase/20260411_progress_rpcs.sql hetzner:~/app/supabase/
```

- [ ] **Step 2: Apply migrations**

```bash
ssh hetzner 'cd ~/infra && bash apply-migrations.sh'
```

Expected: All three migrations apply without errors.

- [ ] **Step 3: Verify tables and functions exist**

```bash
ssh hetzner 'cd ~/infra && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c "\dt public.exercises; \dt public.workout_logs; \df public.resolve_exercise_id; \df public.upsert_workout_logs; \df public.get_progress_dashboard;"'
```

Expected: Tables and functions listed.

- [ ] **Step 4: Verify exercise seed data**

```bash
ssh hetzner 'cd ~/infra && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c "select count(*), category from public.exercises group by category order by category;"'
```

Expected: ~50+ resistance, ~8 cardio, ~9 bodyweight.

- [ ] **Step 5: Commit** (no code changes, just verification)

No commit needed — migrations are already committed.

---

## Task 5: SVG icon module

**Files:**
- Create: `shared/exercise-icons.js`

Export SVG markup strings for the four exercise type icons. Used by all three progress pages.

- [ ] **Step 1: Write the module**

Create `shared/exercise-icons.js`:

```javascript
// SVG icon strings for exercise types.
// Usage: element.innerHTML = ICONS.resistance;
// All icons are 18x18 viewBox, stroke-based, no fill.

const ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  resistance: `<svg ${ATTRS} stroke="currentColor">
    <line x1="2" y1="12" x2="6" y2="12"/><rect x="6" y="8" width="3" height="8" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/><rect x="15" y="8" width="3" height="8" rx="1"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
  </svg>`,

  cardio: `<svg ${ATTRS} stroke="currentColor">
    <path d="M12 6C12 6 8.5 2 5 4.5S2.5 11 12 20c9.5-9 9-12.5 5.5-15.5S12 6 12 6z"/>
    <polyline points="4,13 9,13 10.5,10 13.5,16 15,13 20,13"/>
  </svg>`,

  bodyweight: `<svg ${ATTRS} stroke="currentColor">
    <circle cx="12" cy="5" r="2.5"/><line x1="12" y1="7.5" x2="12" y2="16"/>
    <line x1="8" y1="11" x2="16" y2="11"/>
    <line x1="12" y1="16" x2="8.5" y2="22"/><line x1="12" y1="16" x2="15.5" y2="22"/>
  </svg>`,

  trophy: `<svg ${ATTRS} stroke="currentColor">
    <path d="M8 2h8v10a4 4 0 0 1-8 0V2z"/>
    <path d="M8 4H5a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4"/>
    <path d="M16 4h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4"/>
    <line x1="12" y1="14" x2="12" y2="18"/><line x1="8" y1="18" x2="16" y2="18"/>
  </svg>`,
};

// Background color classes per category
export const ICON_COLORS = {
  resistance: { bg: "rgba(109,159,255,0.13)", color: "var(--primary)" },
  cardio:     { bg: "rgba(159,251,0,0.10)",   color: "var(--secondary)" },
  bodyweight: { bg: "rgba(255,255,255,0.06)",  color: "var(--muted)" },
};

// Type dot color
export const DOT_COLORS = {
  resistance: "var(--primary)",
  cardio:     "var(--secondary)",
  bodyweight: "var(--muted)",
  mixed:      "var(--primary-dim)",
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/exercise-icons.js
git commit -m "feat: add SVG exercise type icons module"
```

---

## Task 6: SVG chart helpers

**Files:**
- Create: `shared/progress-charts.js`

Functions that return SVG markup strings for bar charts and line charts. No charting library — just coordinate math and SVG template strings.

- [ ] **Step 1: Write the chart module**

Create `shared/progress-charts.js`:

```javascript
// SVG chart helpers for the progress dashboard.
// Each function returns an SVG markup string.
// No dependencies — pure functions that map data to coordinates.

/**
 * Stacked bar chart for weekly activity.
 * @param {Array<{week_start: string, resistance_volume_kg: number, cardio_duration_seconds: number}>} data
 * @param {{width?: number, height?: number}} opts
 * @returns {string} SVG markup
 */
export function weeklyActivityChart(data, { width = 400, height = 120 } = {}) {
  if (!data || data.length === 0) return emptyChart(width, height, "No activity data");

  const pad = { top: 4, bottom: 20, left: 0, right: 0 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const barGap = 6;
  const barW = Math.max(8, (chartW - barGap * (data.length - 1)) / data.length);

  // Normalize: resistance by max volume, cardio by max seconds
  const maxVol = Math.max(...data.map(d => d.resistance_volume_kg || 0), 1);
  const maxCardio = Math.max(...data.map(d => d.cardio_duration_seconds || 0), 1);

  // Scale both to share the chart height (stacked visually)
  const bars = data.map((d, i) => {
    const x = pad.left + i * (barW + barGap);
    const rH = ((d.resistance_volume_kg || 0) / maxVol) * chartH * 0.7;
    const cH = ((d.cardio_duration_seconds || 0) / maxCardio) * chartH * 0.3;
    const rY = pad.top + chartH - rH;
    const cY = rY - cH - 2; // 2px gap between stacks
    const label = weekLabel(d.week_start);
    return { x, rH, rY, cH, cY, label, barW };
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  for (const b of bars) {
    if (b.cH > 0) {
      svg += `<rect x="${b.x}" y="${b.cY}" width="${b.barW}" height="${b.cH}" rx="3" fill="rgba(159,251,0,0.4)"/>`;
    }
    if (b.rH > 0) {
      svg += `<rect x="${b.x}" y="${b.rY}" width="${b.barW}" height="${b.rH}" rx="3" fill="rgba(109,159,255,0.55)"/>`;
    }
    svg += `<text x="${b.x + b.barW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="Inter,system-ui,sans-serif">${b.label}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Line chart for exercise progression (e1RM or load over time).
 * @param {Array<{performed_at: string, value: number}>} data
 * @param {{width?: number, height?: number, color?: string, prDate?: string}} opts
 * @returns {string} SVG markup
 */
export function progressionLineChart(data, { width = 400, height = 140, color = "#6d9fff", prDate = null } = {}) {
  if (!data || data.length < 2) return emptyChart(width, height, "Not enough data");

  const pad = { top: 12, bottom: 24, left: 8, right: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const values = data.map(d => d.value);
  const minV = Math.min(...values) * 0.9;
  const maxV = Math.max(...values) * 1.05;
  const range = maxV - minV || 1;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + chartH - ((d.value - minV) / range) * chartH,
    date: d.performed_at,
    value: d.value,
    isPR: prDate && d.performed_at === prDate,
  }));

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");

  // Area fill path
  const areaPath = `M${points[0].x},${points[0].y} ` +
    points.slice(1).map(p => `L${p.x},${p.y}`).join(" ") +
    ` L${points[points.length - 1].x},${pad.top + chartH} L${points[0].x},${pad.top + chartH} Z`;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Grid lines
  for (let i = 0; i < 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
  }

  // Area
  svg += `<path d="${areaPath}" fill="${color}" opacity="0.08"/>`;

  // Line
  svg += `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Data points
  for (const p of points) {
    if (p.isPR) {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="none" stroke="#FFD700" stroke-width="1.5"/>`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#FFD700"/>`;
    } else {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}"/>`;
    }
  }

  // X-axis labels (first, mid, last)
  const labelIndices = [0, Math.floor(points.length / 2), points.length - 1];
  for (const idx of [...new Set(labelIndices)]) {
    const p = points[idx];
    svg += `<text x="${p.x}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="Inter,system-ui,sans-serif">${shortDate(p.date)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Horizontal bar for muscle volume display.
 * @param {number} pct - 0 to 100
 * @param {{color?: string}} opts
 * @returns {string} SVG markup (single bar, 100% width, 4px height)
 */
export function muscleBar(pct, { color = "var(--primary)" } = {}) {
  return `<div style="height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden">
    <div style="height:100%;width:${Math.min(100, pct)}%;border-radius:2px;background:linear-gradient(90deg,${color},var(--primary-dim));transition:width 500ms ease"></div>
  </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function weekLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.toLocaleString("en", { month: "short" });
  return `${month} ${d.getDate()}`;
}

function shortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.toLocaleString("en", { month: "short" })} ${d.getDate()}`;
}

function emptyChart(w, h, msg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.2)" font-family="Inter,system-ui,sans-serif">${msg}</text>
  </svg>`;
}

// ── Formatting helpers ──────────────────────────────────────────────

export function formatVolume(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

export function formatDuration(seconds) {
  if (!seconds) return "0min";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m > 0 ? m + "m" : ""}`.trim();
  return `${m}min`;
}

export function formatE1rm(loadKg, reps) {
  if (!loadKg || !reps) return null;
  return Math.round(loadKg * (1 + reps / 30));
}

export function formatPace(distanceMeters, seconds) {
  if (!distanceMeters || !seconds) return null;
  const minPerKm = (seconds / 60) / (distanceMeters / 1000);
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/progress-charts.js
git commit -m "feat: add SVG chart helpers for progress pages"
```

---

## Task 7: Supabase helper wrappers + client integration

**Files:**
- Create: `shared/progress-helpers.js`
- Modify: `shared/supabase.js`
- Modify: `app/workout/session/session.js`

Wire up the `upsert_workout_logs` RPC call to fire after each session save.

- [ ] **Step 1: Create progress-helpers.js**

Create `shared/progress-helpers.js`:

```javascript
// Supabase RPC wrappers for progress pages.
// Thin layer over supabase.rpc() — handles auth and date range defaults.

import { getSupabase, getSession } from "/shared/supabase.js";

export async function fetchDashboard(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_progress_dashboard", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data;
}

export async function fetchWeeklyActivity(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_weekly_activity", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchMuscleVolume(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_muscle_volume", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchRecentSessions(userId, limit = 10) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_recent_sessions", {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchTopExercises(userId, rangeStart, rangeEnd, limit = 10) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_top_exercises", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchExerciseHistory(userId, exerciseId, limit = 20) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_exercise_history", {
    p_user_id: userId,
    p_exercise_id: exerciseId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchSessionDetail(userId, planId, sessionId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_session_detail", {
    p_user_id: userId,
    p_plan_id: planId,
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchPersonalRecords(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_personal_records", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchExerciseBySlug(slug) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("exercises")
    .select("id,slug,name,aliases,muscle_groups,equipment,category,movement_type")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Date range helpers ──────────────────────────────────────────────

export function dateRange(weeks) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - weeks * 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 2: Add upsertWorkoutLogs to shared/supabase.js**

Add the following export to the end of `shared/supabase.js` (before the closing of the module):

```javascript
/**
 * Flatten completed_blocks into workout_logs via the upsert_workout_logs RPC.
 * Called after applyManualWorkoutPlanEdit succeeds.
 * Non-blocking — errors are logged but don't fail the save.
 */
export async function upsertWorkoutLogs(userId, planId, plan) {
  const supabase = await getSupabase();

  for (const session of (plan.sessions || [])) {
    const completed = session.completed_blocks;
    if (!completed || completed.length === 0) continue;

    // Enrich each block with its exercise name from the plan's blocks array
    const blocks = completed.map(cb => {
      const planBlock =
        (session.blocks || []).find(b => b.id === cb.block_id) ||
        (session.warmup_blocks || []).find(b => b.id === cb.block_id);
      return {
        ...cb,
        exercise_name: planBlock?.name || "",
      };
    }).filter(b => b.exercise_name);

    if (blocks.length === 0) continue;

    const performedAt = session.date || new Date().toISOString().slice(0, 10);

    try {
      await supabase.rpc("upsert_workout_logs", {
        p_user_id: userId,
        p_plan_id: planId,
        p_session_id: session.id,
        p_performed_at: performedAt,
        p_blocks: blocks,
      });
    } catch (err) {
      console.error("[upsertWorkoutLogs] Failed for session", session.id, err);
    }
  }
}
```

- [ ] **Step 3: Call upsertWorkoutLogs from session save**

In `app/workout/session/session.js`, find the `flushSave` callback where `applyManualWorkoutPlanEdit` is called (around line 237-241). After the successful save, add the `upsertWorkoutLogs` call.

Find the line that looks like:

```javascript
const saved = await applyManualWorkoutPlanEdit(authSession.user.id, planRef.current.id, planToSave);
```

Add after it:

```javascript
// Sync completed_blocks to workout_logs (non-blocking)
import("/shared/supabase.js").then(m =>
  m.upsertWorkoutLogs(authSession.user.id, planRef.current.id, planToSave)
    .catch(err => console.error("[workout-logs]", err))
);
```

Alternatively, if dynamic import is unwieldy, add `upsertWorkoutLogs` to the existing import at the top of the file:

```javascript
import {
  applyManualWorkoutPlanEdit,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
```

Then after the save:

```javascript
const saved = await applyManualWorkoutPlanEdit(authSession.user.id, planRef.current.id, planToSave);
// Sync to workout_logs (fire and forget — don't block the save UX)
upsertWorkoutLogs(authSession.user.id, planRef.current.id, planToSave).catch(err =>
  console.error("[workout-logs sync]", err)
);
```

- [ ] **Step 4: Commit**

```bash
git add shared/progress-helpers.js shared/supabase.js app/workout/session/session.js
git commit -m "feat: wire upsert_workout_logs RPC into session save path"
```

---

## Task 8: Progress dashboard page

**Files:**
- Create: `app/progress/index.html`
- Create: `app/progress/progress.js`

The main dashboard page. React component via esm.sh, matching the session.js pattern.

- [ ] **Step 1: Create the HTML shell**

Create `app/progress/index.html`. Copy the boilerplate from `app/workout/session/index.html` — same `<head>`, same site shell, same nav. Key differences:

- Title: `Progress | Emersus AI`
- Root element: `<div id="progress-root"></div>`
- Script: `<script type="module" src="/app/progress/progress.js"></script>`
- Add a `<link rel="stylesheet" href="/shared/site.css">` in the head
- Page-specific `<style>` block with all CSS from the design mockup (stat cards, glass cards, chart containers, session items, exercise rows, PR banner, time pills, etc.)
- Add a "Progress" nav link as the active item in the nav

The CSS should use the exact design tokens from the mockup (v3): `var(--bg)`, `var(--ink)`, `var(--primary)`, `var(--secondary)`, `var(--muted)`, `var(--line)`, `var(--shadow)`. All the class names from the mockup HTML (`.card`, `.stat-card`, `.stat-label`, `.stat-value`, `.time-pill`, `.session-item`, `.exercise-row`, `.pr-banner`, etc.) should be defined here.

- [ ] **Step 2: Create progress.js — imports and state**

Create `app/progress/progress.js`:

```javascript
import React, { useCallback, useEffect, useMemo, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth } from "/shared/supabase.js";
import {
  fetchDashboard,
  fetchWeeklyActivity,
  fetchMuscleVolume,
  fetchRecentSessions,
  fetchTopExercises,
  fetchPersonalRecords,
  dateRange,
} from "/shared/progress-helpers.js";
import { weeklyActivityChart, muscleBar, formatVolume, formatDuration } from "/shared/progress-charts.js";
import { ICONS, ICON_COLORS, DOT_COLORS } from "/shared/exercise-icons.js";

const h = React.createElement;

const RANGES = [
  { label: "4W", weeks: 4 },
  { label: "8W", weeks: 8 },
  { label: "12W", weeks: 12 },
  { label: "All", weeks: 520 },
];

function ProgressDashboard({ session }) {
  const userId = session.user.id;
  const [rangeIdx, setRangeIdx] = useState(1); // default 8W
  const [dashboard, setDashboard] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [muscles, setMuscles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => dateRange(RANGES[rangeIdx].weeks), [rangeIdx]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, w, m, s, e, p] = await Promise.all([
        fetchDashboard(userId, range.start, range.end),
        fetchWeeklyActivity(userId, range.start, range.end),
        fetchMuscleVolume(userId, range.start, range.end),
        fetchRecentSessions(userId, 5),
        fetchTopExercises(userId, range.start, range.end, 6),
        fetchPersonalRecords(userId, range.start, range.end),
      ]);
      setDashboard(d);
      setWeekly(w);
      setMuscles(m);
      setSessions(s);
      setExercises(e);
      setPrs(p);
    } catch (err) {
      console.error("[progress] Load failed:", err);
    }
    setLoading(false);
  }, [userId, range]);

  useEffect(() => { load(); }, [load]);

  if (loading && !dashboard) {
    return h("div", { className: "progress-loading" }, "Loading...");
  }

  const maxMuscleVol = muscles.length > 0 ? muscles[0].volume_kg : 1;

  return h(React.Fragment, null,
    // Page header
    h("div", { className: "page-header" },
      h("h1", null, "Progress"),
      h("p", null, "Your training history and analytics"),
    ),

    // Time range pills
    h("div", { className: "time-range" },
      RANGES.map((r, i) =>
        h("button", {
          key: r.label,
          className: `time-pill${i === rangeIdx ? " active" : ""}`,
          onClick: () => setRangeIdx(i),
        }, r.label)
      )
    ),

    // Stat cards
    dashboard && h("div", { className: "stats-grid" },
      statCard("Sessions", dashboard.sessions_completed || 0, null, "neutral"),
      statCard("Volume", formatVolume(dashboard.total_volume_kg || 0), null, "positive"),
      statCard("Cardio", formatDuration(dashboard.total_cardio_seconds || 0),
        `${dashboard.cardio_session_count || 0} sessions`, "neutral"),
      statCard("PRs", String(prs.length), "this period", "neutral",
        prs.length > 0 ? "var(--gold)" : null),
    ),

    // Two-col: weekly chart + muscle volume
    h("div", { className: "two-col" },
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Weekly Activity"),
          h("div", { className: "chart-meta" }, "volume + duration"),
        ),
        h("div", { dangerouslySetInnerHTML: { __html: weeklyActivityChart(weekly) } }),
        h("div", { className: "chart-legend" },
          h("div", { className: "legend-item" },
            h("div", { className: "legend-dot resistance" }), "Resistance"),
          h("div", { className: "legend-item" },
            h("div", { className: "legend-dot cardio" }), "Cardio"),
        ),
      ),

      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Muscle Volume"),
        ),
        ...muscles.map(m =>
          h("div", { key: m.muscle_group, className: "muscle-row" },
            h("div", { className: "muscle-meta" },
              h("span", { className: "muscle-name" }, formatMuscleName(m.muscle_group)),
              h("span", { className: "muscle-vol" }, formatVolume(m.volume_kg)),
            ),
            h("div", { dangerouslySetInnerHTML: {
              __html: muscleBar((m.volume_kg / maxMuscleVol) * 100)
            }}),
          )
        ),
      ),
    ),

    // Two-col: recent sessions + top exercises
    h("div", { className: "two-col" },
      // Recent sessions
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Recent Sessions"),
        ),
        ...sessions.map(s =>
          h("a", {
            key: `${s.plan_id}-${s.session_id}`,
            className: "session-item",
            href: `/app/progress/session/?plan=${s.plan_id}&s=${s.session_id}`,
          },
            h("div", { className: "session-top" },
              h("div", { className: "session-name-row" },
                h("div", {
                  className: "type-dot",
                  style: { background: DOT_COLORS[s.category] || DOT_COLORS.resistance },
                }),
                h("span", { className: "session-name" }, s.session_id),
              ),
              h("span", { className: "session-status done" }, "completed"),
            ),
            h("div", { className: "session-detail" },
              `${s.performed_at} · ${s.exercise_count} exercises · ${formatVolume(s.volume_kg)}`
            ),
          )
        ),
      ),

      // Top exercises
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Top Exercises"),
        ),
        ...exercises.map(ex =>
          h("a", {
            key: ex.slug,
            className: "exercise-row",
            href: `/app/progress/exercise/?slug=${ex.slug}`,
          },
            h("div", {
              className: "icon-type",
              style: {
                background: (ICON_COLORS[ex.category] || ICON_COLORS.resistance).bg,
                color: (ICON_COLORS[ex.category] || ICON_COLORS.resistance).color,
              },
              dangerouslySetInnerHTML: { __html: ICONS[ex.category] || ICONS.resistance },
            }),
            h("div", { className: "exercise-info" },
              h("div", { className: "exercise-name" }, ex.name),
              h("div", { className: "exercise-meta" },
                `${ex.session_count} sessions` + (ex.movement_type ? ` · ${ex.movement_type}` : "")),
            ),
            h("div", { className: "exercise-stat" },
              ex.category !== "cardio"
                ? h(React.Fragment, null,
                    h("div", { className: "exercise-primary" }, ex.best_load_kg ? `${ex.best_load_kg}kg` : "-"),
                    h("div", { className: "exercise-secondary" }, ex.best_e1rm_kg ? `e1RM ${ex.best_e1rm_kg}kg` : ""),
                  )
                : h(React.Fragment, null,
                    h("div", { className: "exercise-primary" }, formatDuration(ex.total_duration_seconds)),
                    h("div", { className: "exercise-secondary" },
                      ex.total_distance_meters ? `${(ex.total_distance_meters / 1000).toFixed(1)}km` : ""),
                  ),
            ),
          )
        ),
      ),
    ),

    // PR banner
    prs.length > 0 && h("div", { className: "pr-banner" },
      h("div", { className: "pr-title" },
        h("span", { dangerouslySetInnerHTML: { __html: ICONS.trophy } }),
        " Recent PRs",
      ),
      h("div", { className: "pr-list" },
        ...prs.slice(0, 5).map((pr, i) =>
          h("div", { key: i, className: "pr-item" },
            h("span", { className: "pr-exercise" }, pr.exercise_name),
            h("span", { className: "pr-value" }, `e1RM ${pr.value}kg`),
            h("span", { className: "pr-date" }, pr.achieved_at),
          )
        ),
      ),
    ),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function statCard(label, value, sub, subClass, valueColor) {
  return h("div", { className: "stat-card" },
    h("div", { className: "stat-label" }, label),
    h("div", { className: "stat-value", style: valueColor ? { color: valueColor } : null }, value),
    sub && h("div", { className: `stat-sub ${subClass}` }, sub),
  );
}

function formatMuscleName(slug) {
  return slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Boot ─────────────────────────────────────────────────────────────

async function boot() {
  const rootEl = document.getElementById("progress-root");
  if (!rootEl) return;

  const session = await requireAuth();
  if (!session) return;

  const root = createRoot(rootEl);
  root.render(h(ProgressDashboard, { session }));
}

boot().catch(err => {
  console.error("[progress] Boot failed:", err);
  const el = document.getElementById("progress-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load progress data.</div>';
});
```

- [ ] **Step 3: Verify the page loads**

Open `http://localhost:3001/app/progress/` (or the static server equivalent). Should render the dashboard skeleton. With no logged data yet, charts show "No activity data" placeholder.

- [ ] **Step 4: Commit**

```bash
git add app/progress/index.html app/progress/progress.js
git commit -m "feat: add progress dashboard page with stats, charts, and session/exercise lists"
```

---

## Task 9: Exercise detail page

**Files:**
- Create: `app/progress/exercise/index.html`
- Create: `app/progress/exercise/exercise.js`

Drill-down view for a single exercise — stats, progression chart, session history table.

- [ ] **Step 1: Create HTML shell**

Create `app/progress/exercise/index.html`. Same boilerplate as the dashboard page. Root element: `<div id="exercise-root"></div>`. Script: `/app/progress/exercise/exercise.js`. Include CSS for mini-stat cards, chart-area, set-table, and history entries from the drill-down mockup.

- [ ] **Step 2: Create exercise.js**

Create `app/progress/exercise/exercise.js`:

```javascript
import React, { useCallback, useEffect, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth } from "/shared/supabase.js";
import { fetchExerciseBySlug, fetchExerciseHistory } from "/shared/progress-helpers.js";
import { progressionLineChart, formatVolume, formatE1rm } from "/shared/progress-charts.js";
import { ICONS, ICON_COLORS } from "/shared/exercise-icons.js";

const h = React.createElement;

function ExerciseDetail({ session }) {
  const userId = session.user.id;
  const slug = new URLSearchParams(window.location.search).get("slug");
  const [exercise, setExercise] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      try {
        const ex = await fetchExerciseBySlug(slug);
        if (!ex) { setLoading(false); return; }
        setExercise(ex);
        const hist = await fetchExerciseHistory(userId, ex.id, 20);
        setHistory(hist || []);
      } catch (err) {
        console.error("[exercise-detail]", err);
      }
      setLoading(false);
    })();
  }, [slug, userId]);

  if (loading) return h("div", { className: "progress-loading" }, "Loading...");
  if (!exercise) return h("div", { className: "progress-loading" }, "Exercise not found.");

  const isCardio = exercise.category === "cardio";
  const chartData = history.slice().reverse().map(h => ({
    performed_at: h.performed_at,
    value: isCardio
      ? (h.total_duration_seconds || 0) / 60  // minutes for cardio
      : (h.e1rm_kg || 0),
  })).filter(d => d.value > 0);

  const bestE1rm = !isCardio ? Math.max(...history.map(h => h.e1rm_kg || 0)) : null;
  const bestLoad = !isCardio ? Math.max(...history.map(h => h.max_load_kg || 0)) : null;
  const totalVol = !isCardio ? history.reduce((s, h) => s + (h.volume_kg || 0), 0) : null;
  const totalDur = isCardio ? history.reduce((s, h) => s + (h.total_duration_seconds || 0), 0) : null;

  const bestEntry = !isCardio ? history.find(h => h.e1rm_kg === bestE1rm) : null;
  const prDate = bestEntry?.performed_at || null;

  const colors = ICON_COLORS[exercise.category] || ICON_COLORS.resistance;
  const icon = ICONS[exercise.category] || ICONS.resistance;

  return h(React.Fragment, null,
    h("a", { className: "back", href: "/app/progress/" }, "\u2190 Back to Progress"),

    // Header
    h("div", { className: "exercise-header" },
      h("div", { className: "icon-type", style: { background: colors.bg, color: colors.color },
        dangerouslySetInnerHTML: { __html: icon } }),
      h("div", null,
        h("div", { className: "page-title" }, exercise.name),
        h("div", { className: "exercise-subtitle" },
          [exercise.movement_type, exercise.muscle_groups.join(", ")].filter(Boolean).join(" · ")
        ),
      ),
    ),
    h("div", { className: "page-subtitle" }, `${history.length} sessions logged`),

    // Mini stats
    h("div", { className: "stat-row" },
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Best e1RM"),
        h("div", { className: "mini-stat-value" }, bestE1rm ? `${bestE1rm}kg` : "-"),
        prDate && h("div", { className: "mini-stat-sub" }, prDate),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Heaviest Set"),
        h("div", { className: "mini-stat-value" }, bestLoad ? `${bestLoad}kg` : "-"),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Total Volume"),
        h("div", { className: "mini-stat-value" }, totalVol ? formatVolume(totalVol) : "-"),
      ),
      isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Total Time"),
        h("div", { className: "mini-stat-value" }, totalDur ? `${Math.round(totalDur / 60)}min` : "-"),
      ),
    ),

    // Progression chart
    chartData.length >= 2 && h("div", { className: "card" },
      h("div", { className: "card-title" },
        isCardio ? "Duration Over Time" : "Weight Progression (e1RM)"),
      h("div", { className: "chart-area", dangerouslySetInnerHTML: {
        __html: progressionLineChart(chartData, {
          color: isCardio ? "#9ffb00" : "#6d9fff",
          prDate,
        }),
      }}),
    ),

    // Session history table
    h("div", { className: "section-label" }, "Session History"),
    h("div", { className: "card" },
      h("table", { className: "set-table" },
        h("thead", null,
          h("tr", null,
            h("th", null, "Date"),
            h("th", null, "Sets"),
            !isCardio && h("th", null, "Best Set"),
            !isCardio && h("th", null, "Volume"),
            !isCardio && h("th", null, "e1RM"),
            isCardio && h("th", null, "Duration"),
            isCardio && h("th", null, "Distance"),
          ),
        ),
        h("tbody", null,
          ...history.map((row, i) =>
            h("tr", { key: i },
              h("td", null, row.performed_at),
              h("td", null, row.set_count),
              !isCardio && h("td", null,
                row.max_load_kg ? `${row.max_load_kg}kg x ${row.max_reps}` : "-",
                row.e1rm_kg === bestE1rm && bestE1rm > 0
                  ? h("span", { className: "pr-flag" }, "PR") : null,
              ),
              !isCardio && h("td", null, row.volume_kg ? formatVolume(row.volume_kg) : "-"),
              !isCardio && h("td", null, row.e1rm_kg ? `${row.e1rm_kg}kg` : "-"),
              isCardio && h("td", null, row.total_duration_seconds
                ? `${Math.round(row.total_duration_seconds / 60)}min` : "-"),
              isCardio && h("td", null, row.total_distance_meters
                ? `${(row.total_distance_meters / 1000).toFixed(1)}km` : "-"),
            )
          ),
        ),
      ),
    ),
  );
}

async function boot() {
  const rootEl = document.getElementById("exercise-root");
  if (!rootEl) return;
  const session = await requireAuth();
  if (!session) return;
  const root = createRoot(rootEl);
  root.render(h(ExerciseDetail, { session }));
}

boot().catch(err => {
  console.error("[exercise-detail] Boot failed:", err);
  const el = document.getElementById("exercise-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load.</div>';
});
```

- [ ] **Step 3: Commit**

```bash
git add app/progress/exercise/index.html app/progress/exercise/exercise.js
git commit -m "feat: add exercise detail page with progression chart and history table"
```

---

## Task 10: Session detail page

**Files:**
- Create: `app/progress/session/index.html`
- Create: `app/progress/session/session-detail.js`

Shows all exercises and sets for a single past session.

- [ ] **Step 1: Create HTML shell**

Create `app/progress/session/index.html`. Same boilerplate. Root: `<div id="session-detail-root"></div>`. Script: `/app/progress/session/session-detail.js`. Include CSS for exercise blocks, set rows, cardio stat grid, mini stats.

- [ ] **Step 2: Create session-detail.js**

Create `app/progress/session/session-detail.js`:

```javascript
import React, { useEffect, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth } from "/shared/supabase.js";
import { fetchSessionDetail } from "/shared/progress-helpers.js";
import { formatVolume, formatDuration } from "/shared/progress-charts.js";
import { DOT_COLORS } from "/shared/exercise-icons.js";

const h = React.createElement;

function SessionDetail({ session }) {
  const userId = session.user.id;
  const params = new URLSearchParams(window.location.search);
  const planId = params.get("plan");
  const sessionId = params.get("s");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!planId || !sessionId) return;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchSessionDetail(userId, planId, sessionId);
        setRows(data || []);
      } catch (err) {
        console.error("[session-detail]", err);
      }
      setLoading(false);
    })();
  }, [userId, planId, sessionId]);

  if (loading) return h("div", { className: "progress-loading" }, "Loading...");
  if (rows.length === 0) return h("div", { className: "progress-loading" }, "No data for this session.");

  // Group rows by exercise
  const exerciseMap = new Map();
  for (const row of rows) {
    const key = row.exercise_name;
    if (!exerciseMap.has(key)) {
      exerciseMap.set(key, { ...row, sets: [] });
    }
    exerciseMap.get(key).sets.push(row);
  }
  const exercises = [...exerciseMap.values()];

  const performedAt = rows[0]?.performed_at || "";
  const isCardio = exercises.every(e => e.category === "cardio");
  const isMixed = exercises.some(e => e.category === "cardio") && exercises.some(e => e.category !== "cardio");
  const category = isCardio ? "cardio" : isMixed ? "mixed" : "resistance";

  const totalVolume = rows.reduce((s, r) =>
    s + ((r.reps || 0) * (r.load_kg || 0)), 0);
  const totalCardioSec = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);
  const exerciseCount = exercises.length;

  return h(React.Fragment, null,
    h("a", { className: "back", href: "/app/progress/" }, "\u2190 Back to Progress"),

    // Header
    h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" } },
      h("div", { className: "type-dot", style: { background: DOT_COLORS[category] } }),
      h("div", { className: "page-title" }, sessionId),
    ),
    h("div", { className: "page-subtitle" }, performedAt),

    // Stats
    h("div", { className: "stat-row" },
      h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Exercises"),
        h("div", { className: "mini-stat-value" }, String(exerciseCount)),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Volume"),
        h("div", { className: "mini-stat-value" }, formatVolume(totalVolume)),
      ),
      totalCardioSec > 0 && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Cardio"),
        h("div", { className: "mini-stat-value" }, formatDuration(totalCardioSec)),
      ),
    ),

    // Exercise blocks
    h("div", { className: "section-label" }, "Exercises"),

    ...exercises.map((ex) =>
      ex.category === "cardio"
        // Cardio block
        ? h("div", { key: ex.exercise_name, className: "cardio-block" },
            h("div", { className: "exercise-block-name" }, ex.exercise_name),
            h("div", { className: "cardio-stat-grid" },
              ex.duration_seconds && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, formatDuration(ex.duration_seconds)),
                h("div", { className: "cardio-stat-label" }, "Duration"),
              ),
              ex.distance_meters && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, `${(ex.distance_meters / 1000).toFixed(1)}km`),
                h("div", { className: "cardio-stat-label" }, "Distance"),
              ),
              ex.avg_heart_rate && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, String(ex.avg_heart_rate)),
                h("div", { className: "cardio-stat-label" }, "Avg HR"),
              ),
              ex.calories && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, String(ex.calories)),
                h("div", { className: "cardio-stat-label" }, "Calories"),
              ),
            ),
          )
        // Resistance / bodyweight block
        : h("div", { key: ex.exercise_name, className: "exercise-block" },
            h("div", { className: "exercise-block-header" },
              h("span", { className: "exercise-block-name" }, ex.exercise_name),
              h("span", { className: "exercise-block-vol" },
                formatVolume(ex.sets.reduce((s, r) => s + ((r.reps || 0) * (r.load_kg || 0)), 0)) + " vol"),
            ),
            ...ex.sets.map((set, i) =>
              h("div", { key: i, className: "set-row" },
                h("span", { className: "set-label" }, `Set ${set.set_number || i + 1}`),
                h("span", { className: "set-data" },
                  set.load_kg ? `${set.load_kg}kg x ${set.reps}` : `${set.reps} reps`),
                set.rpe && h("span", { className: "set-rpe" }, `RPE ${set.rpe}`),
              )
            ),
          )
    ),
  );
}

async function boot() {
  const rootEl = document.getElementById("session-detail-root");
  if (!rootEl) return;
  const session = await requireAuth();
  if (!session) return;
  const root = createRoot(rootEl);
  root.render(h(SessionDetail, { session }));
}

boot().catch(err => {
  console.error("[session-detail] Boot failed:", err);
  const el = document.getElementById("session-detail-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load.</div>';
});
```

- [ ] **Step 3: Commit**

```bash
git add app/progress/session/index.html app/progress/session/session-detail.js
git commit -m "feat: add session detail page for resistance and cardio sessions"
```

---

## Task 11: Planner page integration

**Files:**
- Modify: `app/workout/workout.js`
- Modify: `app/workout/index.html`

Add a compact stats strip and "View progress" link to the existing workout planner page.

- [ ] **Step 1: Add stats strip to workout.js**

In `app/workout/workout.js`, in the `renderDetail()` function that renders the selected plan, add a stats strip below the plan title/header. Import `fetchDashboard` and `dateRange` from `/shared/progress-helpers.js` and `formatVolume` from `/shared/progress-charts.js`.

After the plan header element, insert:

```javascript
// Stats strip
const statsStrip = el("div", { class: "plan-stats-strip" },
  el("span", { class: "plan-stats-text", id: "plan-stats-text" }, "Loading stats..."),
  el("a", { class: "plan-stats-link", href: "/app/progress/" }, "View progress"),
);
```

Then load stats asynchronously and update the text:

```javascript
fetchDashboard(state.session.user.id, dateRange(8).start, dateRange(8).end).then(d => {
  const text = document.getElementById("plan-stats-text");
  if (text && d) {
    text.textContent = `${d.sessions_completed || 0} sessions · ${formatVolume(d.total_volume_kg || 0)} volume`;
  }
}).catch(() => {});
```

- [ ] **Step 2: Add CSS for the stats strip**

In `app/workout/index.html`, add to the page-specific `<style>`:

```css
.plan-stats-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--line);
  border-radius: 14px;
  margin-bottom: 16px;
}
.plan-stats-text {
  font-size: 0.8rem;
  color: var(--muted);
}
.plan-stats-link {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
}
```

- [ ] **Step 3: Add Progress nav link**

In `app/workout/index.html`, add `<a href="/app/progress/">Progress</a>` to the `<nav class="site-nav">` if not already present.

- [ ] **Step 4: Commit**

```bash
git add app/workout/workout.js app/workout/index.html
git commit -m "feat: add stats strip and progress link to workout planner page"
```

---

## Task 12: Backfill script

**Files:**
- Create: `scripts/backfill-workout-logs.js`

Populates `workout_logs` from existing `completed_blocks` data in all workout plans.

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-workout-logs.js`:

```javascript
// One-time backfill: populate workout_logs from existing completed_blocks.
// Run: node scripts/backfill-workout-logs.js
// Safe to re-run (upsert_workout_logs deletes + re-inserts per session).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log("Fetching all workout plans...");

  const { data: plans, error: plansErr } = await supabase
    .from("workout_plans")
    .select("id, user_id, plan")
    .is("archived_at", null);

  if (plansErr) throw plansErr;
  console.log(`Found ${plans.length} active plans.`);

  let totalSessions = 0;
  let totalRows = 0;

  for (const planRow of plans) {
    const sessions = planRow.plan?.sessions || [];

    for (const session of sessions) {
      const completed = session.completed_blocks;
      if (!completed || completed.length === 0) continue;

      // Enrich with exercise names from the plan's blocks
      const blocks = completed.map(cb => {
        const planBlock =
          (session.blocks || []).find(b => b.id === cb.block_id) ||
          (session.warmup_blocks || []).find(b => b.id === cb.block_id);
        return { ...cb, exercise_name: planBlock?.name || "" };
      }).filter(b => b.exercise_name);

      if (blocks.length === 0) continue;

      const performedAt = session.date || planRow.plan.start_date || new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase.rpc("upsert_workout_logs", {
        p_user_id: planRow.user_id,
        p_plan_id: planRow.id,
        p_session_id: session.id,
        p_performed_at: performedAt,
        p_blocks: blocks,
      });

      if (error) {
        console.error(`  ERROR session ${session.id} in plan ${planRow.id}:`, error.message);
        continue;
      }

      totalSessions++;
      totalRows += data?.rows_inserted || 0;
      console.log(`  Plan ${planRow.id} / ${session.id}: ${data?.rows_inserted || 0} rows`);
    }
  }

  console.log(`\nDone. ${totalSessions} sessions backfilled, ${totalRows} total log rows.`);
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the backfill**

```bash
node scripts/backfill-workout-logs.js
```

Expected: Lists each plan/session processed and total row count. May be 0 if no sessions have been logged yet.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-workout-logs.js
git commit -m "feat: add backfill script for workout_logs from existing completed_blocks"
```

---

## Task 13: Add Progress link to all app page navs

**Files:**
- Modify: all `app/*/index.html` files that have a site-nav

- [ ] **Step 1: Add Progress nav link**

In every `index.html` under `app/` that has the `<nav class="site-nav">` block, add `<a href="/app/progress/">Progress</a>` after the Workout link (if not already present). Files to check:

- `app/index.html`
- `app/profile/index.html`
- `app/workout/session/index.html`
- `chat/chat.html`

- [ ] **Step 2: Commit**

```bash
git add app/index.html app/profile/index.html app/workout/session/index.html chat/chat.html
git commit -m "feat: add Progress nav link across all app pages"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Verify migrations are applied**

```bash
ssh hetzner 'cd ~/infra && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c "select count(*) from public.exercises;"'
```

Expected: 55+ rows.

- [ ] **Step 2: Test exercise matching**

```bash
ssh hetzner 'cd ~/infra && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c "select public.resolve_exercise_id('\''Bench Press'\'');"'
```

Expected: Returns the UUID of `barbell_bench_press`.

- [ ] **Step 3: Test upsert RPC with sample data**

Via the Supabase client or psql, call `upsert_workout_logs` with a test user and sample blocks. Verify rows appear in `workout_logs`.

- [ ] **Step 4: Load dashboard in browser**

Navigate to `/app/progress/`. Verify:
- Stat cards render (may show zeros with no data)
- Time range pills switch ranges
- Chart areas render (empty state or with data if backfill populated)
- Session items link to `/app/progress/session/`
- Exercise items link to `/app/progress/exercise/`

- [ ] **Step 5: Test drill-down pages**

Click an exercise → verify history table and progression chart render.
Click a session → verify exercise blocks with set rows render.

- [ ] **Step 6: Test live logging**

Open `/app/workout/session/` with a real plan. Log a few sets. Save. Navigate to `/app/progress/`. Verify the session appears in recent sessions and the exercise appears in top exercises.

- [ ] **Step 7: Commit all remaining changes**

```bash
git add -A && git status
```

Review staged files — no secrets, no `infra/` files. Then commit:

```bash
git commit -m "feat: workout tracking — progress dashboard, exercise/session detail, analytics RPCs"
```
