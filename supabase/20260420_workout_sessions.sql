-- 2026-04-20 — workout_sessions: durable session metadata for /app/train.
--
-- Phase 3 of the redesign needs a place to store per-session title, modality,
-- timestamps, source-thread link, and finish notes — distinct from the
-- per-set workout_logs rows. workout_logs.session_id (text) is preserved for
-- backwards compat; new sessions store their UUID id here AND in workout_logs.session_id.

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  modality text not null check (modality in ('lift','cardio','swim','climb')),
  title text,
  source_thread_id uuid,
  source_workout_plan_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  exercises jsonb not null default '[]'::jsonb,  -- session-scoped plan ([{ exercise_id, planned_sets }])
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);
create index if not exists workout_sessions_user_modality_idx
  on public.workout_sessions (user_id, modality, started_at desc);
create index if not exists workout_sessions_active_idx
  on public.workout_sessions (user_id, modality)
  where ended_at is null;

alter table public.workout_sessions enable row level security;

drop policy if exists "users own workout_sessions select" on public.workout_sessions;
drop policy if exists "users own workout_sessions insert" on public.workout_sessions;
drop policy if exists "users own workout_sessions update" on public.workout_sessions;
drop policy if exists "users own workout_sessions delete" on public.workout_sessions;

create policy "users own workout_sessions select"
  on public.workout_sessions for select to authenticated using (auth.uid() = user_id);
create policy "users own workout_sessions insert"
  on public.workout_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy "users own workout_sessions update"
  on public.workout_sessions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own workout_sessions delete"
  on public.workout_sessions for delete to authenticated using (auth.uid() = user_id);

comment on table public.workout_sessions is 'Per-session metadata for /app/train. workout_logs.session_id stores the row id as text.';
