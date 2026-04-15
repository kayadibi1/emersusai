-- 2026-04-20 — benchmarks: literature-backed typical ranges per metric.
--
-- Phase 5 of the redesign uses these to render benchmark bars
-- ("typical intermediate" range band + your tick). Initial seed is
-- empty — operator/research team populates rows as they're vetted.
-- The Progress page hides any metric × experience combo that has no
-- benchmark row yet, so an empty table is safe to ship.

create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  metric text not null,
  experience text not null check (experience in ('beginner','intermediate','advanced')),
  sex text check (sex in ('male','female','other')),
  body_weight_band text,
  low numeric not null,
  high numeric not null,
  label text not null,
  source_citation text not null,
  created_at timestamptz not null default now(),
  unique (metric, experience, sex, body_weight_band)
);

comment on table public.benchmarks is 'Literature-backed typical ranges per metric × experience × sex × body-weight band. Drives the Progress benchmark bars.';

-- Read-only to authenticated users; only service_role inserts.
alter table public.benchmarks enable row level security;
drop policy if exists "anyone reads benchmarks" on public.benchmarks;
drop policy if exists "service inserts benchmarks" on public.benchmarks;
create policy "anyone reads benchmarks"
  on public.benchmarks for select to authenticated using (true);
create policy "service inserts benchmarks"
  on public.benchmarks for all to service_role using (true) with check (true);
