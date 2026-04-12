-- 20260414_meal_plans.sql
-- Mirrors supabase/20260408_workout_plans.sql. Stores the plan document as
-- JSONB with previous_plan for undo and archived_at for soft delete.
--
-- JSONB shape is validated at write-time by shared/meal-plan-schema.js;
-- we do NOT add Postgres CHECK constraints on the jsonb structure because
-- the shape is still evolving and schema_version gives us a migration path.
--
-- RLS: users can only see, insert, update, and delete their own rows.
-- At most one active plan per user enforced via a unique partial index.

create extension if not exists pgcrypto;

create table if not exists public.meal_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  schema_version    int not null default 1,
  plan              jsonb not null,
  previous_plan     jsonb,
  source_thread_id  uuid,
  last_adjusted_via text,
  last_adjusted_at  timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists meal_plans_user_id_idx
  on public.meal_plans (user_id);

create index if not exists meal_plans_user_active_idx
  on public.meal_plans (user_id, updated_at desc)
  where archived_at is null;

create unique index if not exists meal_plans_one_active_per_user_uq
  on public.meal_plans (user_id)
  where archived_at is null;

alter table public.meal_plans enable row level security;

drop policy if exists "users can read own meal_plans" on public.meal_plans;
create policy "users can read own meal_plans"
on public.meal_plans
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own meal_plans" on public.meal_plans;
create policy "users can insert own meal_plans"
on public.meal_plans
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own meal_plans" on public.meal_plans;
create policy "users can update own meal_plans"
on public.meal_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own meal_plans" on public.meal_plans;
create policy "users can delete own meal_plans"
on public.meal_plans
for delete
to authenticated
using (auth.uid() = user_id);

-- Reuse the same set_current_timestamp_updated_at function from the
-- profiles migration (20260402_auth_profiles_and_contact.sql).
drop trigger if exists set_meal_plans_updated_at on public.meal_plans;
create trigger set_meal_plans_updated_at
before update on public.meal_plans
for each row
execute function public.set_current_timestamp_updated_at();
