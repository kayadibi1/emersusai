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
