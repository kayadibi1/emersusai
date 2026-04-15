-- 2026-04-20 — nutrition: water + supplement logs for the time-aware fuel gauge.
--
-- Phase 4 of the redesign needs lightweight per-event tables for water intake
-- and supplement adherence. Distinct from meal_journal_entries (which is
-- food-and-macro centric). Both tables are RLS-scoped to the owning user.

create table if not exists public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now(),
  ml integer not null check (ml > 0 and ml <= 5000),
  created_at timestamptz not null default now()
);

create index if not exists water_log_user_date_idx
  on public.water_log (user_id, consumed_at desc);

alter table public.water_log enable row level security;
drop policy if exists "users own water_log select" on public.water_log;
drop policy if exists "users own water_log insert" on public.water_log;
drop policy if exists "users own water_log update" on public.water_log;
drop policy if exists "users own water_log delete" on public.water_log;
create policy "users own water_log select"
  on public.water_log for select to authenticated using (auth.uid() = user_id);
create policy "users own water_log insert"
  on public.water_log for insert to authenticated with check (auth.uid() = user_id);
create policy "users own water_log update"
  on public.water_log for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own water_log delete"
  on public.water_log for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.supplement_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 120),
  amount numeric(8,2),
  unit text,
  created_at timestamptz not null default now()
);

create index if not exists supplement_log_user_date_idx
  on public.supplement_log (user_id, consumed_at desc);

alter table public.supplement_log enable row level security;
drop policy if exists "users own supplement_log select" on public.supplement_log;
drop policy if exists "users own supplement_log insert" on public.supplement_log;
drop policy if exists "users own supplement_log update" on public.supplement_log;
drop policy if exists "users own supplement_log delete" on public.supplement_log;
create policy "users own supplement_log select"
  on public.supplement_log for select to authenticated using (auth.uid() = user_id);
create policy "users own supplement_log insert"
  on public.supplement_log for insert to authenticated with check (auth.uid() = user_id);
create policy "users own supplement_log update"
  on public.supplement_log for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own supplement_log delete"
  on public.supplement_log for delete to authenticated using (auth.uid() = user_id);
