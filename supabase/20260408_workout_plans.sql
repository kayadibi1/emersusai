-- Workout plans — Phase 1 of the long-term workout planner feature.
--
-- Design decisions baked in (see plans/dynamic-sparking-boole.md):
--   - plan stored as jsonb, not normalized per-session rows. Sessions are
--     always read/written together, editing is a single jsonb swap, and the
--     schema is still evolving. Normalize later only if cross-session
--     queries become a real need.
--   - previous_plan column holds the immediately prior version, powering
--     "Undo last change" without committing to a full revision-history
--     table (one-way street #12).
--   - archived_at for soft-delete. Phase 2 deletion still has a hard path
--     for propagating deletes to Google Calendar, but the default surface
--     is archive so users don't nuke synced state by accident.
--   - RLS mirrors profiles (20260402_auth_profiles_and_contact.sql):
--     users can only see, insert, update, and delete their own rows.
--   - updated_at trigger reuses the existing set_current_timestamp_updated_at
--     function from 20260402_auth_profiles_and_contact.sql.

create extension if not exists pgcrypto;

create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  schema_version integer not null default 1,
  plan jsonb not null,
  previous_plan jsonb,
  source_thread_id uuid,
  last_adjusted_via text,
  last_adjusted_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_plans_user_id_idx
  on public.workout_plans (user_id);

create index if not exists workout_plans_user_active_idx
  on public.workout_plans (user_id, updated_at desc)
  where archived_at is null;

alter table public.workout_plans enable row level security;

drop policy if exists "users can read own workout_plans" on public.workout_plans;
create policy "users can read own workout_plans"
on public.workout_plans
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own workout_plans" on public.workout_plans;
create policy "users can insert own workout_plans"
on public.workout_plans
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own workout_plans" on public.workout_plans;
create policy "users can update own workout_plans"
on public.workout_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own workout_plans" on public.workout_plans;
create policy "users can delete own workout_plans"
on public.workout_plans
for delete
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_workout_plans_updated_at on public.workout_plans;
create trigger set_workout_plans_updated_at
before update on public.workout_plans
for each row
execute function public.set_current_timestamp_updated_at();
