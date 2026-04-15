-- 2026-04-20 — profile: structured macro / preferences / reminders / target weight
--
-- Phase 6 of the redesign adds editable Goals/Equipment/Injuries/Billing tabs
-- to /app/profile. The existing schema covers most fields; this migration adds
-- the structured jsonb columns the new UI needs.
--
-- Apply with the standard runbook:
--   ssh hetzner "cd ~/supabase-docker && docker compose exec -T db \
--     psql -U supabase_admin -d postgres" < supabase/20260420_profile_extras.sql

alter table public.profiles
  add column if not exists target_weight_kg numeric(6,2),
  add column if not exists training_env text,
  add column if not exists equipment jsonb not null default '[]'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists macros jsonb,
  add column if not exists macros_overridden_at timestamptz,
  add column if not exists reminders jsonb not null default '{}'::jsonb,
  add column if not exists weekly_targets jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_training_env_check'
  ) then
    alter table public.profiles
      add constraint profiles_training_env_check
      check (training_env is null or training_env in ('home','commercial','outdoor','mixed'));
  end if;
end$$;

comment on column public.profiles.target_weight_kg is 'Optional cut/bulk target. Used for delta UI on Goals tab.';
comment on column public.profiles.training_env is 'home | commercial | outdoor | mixed. Drives default exercise selection.';
comment on column public.profiles.equipment is 'Array of equipment keys + per-key sub-specs.';
comment on column public.profiles.preferences is 'Toggles: injury_aware, auto_deload, metric_units, daily_reminder.';
comment on column public.profiles.macros is 'Computed or user-overridden { kcal, protein_g, carbs_g, fat_g }. Null = use default formula.';
comment on column public.profiles.macros_overridden_at is 'Timestamp of last manual macro edit. When set, body-weight changes do NOT auto-recompute.';
comment on column public.profiles.reminders is 'Notification settings: daily_review { enabled, time, days[] }, etc.';
comment on column public.profiles.weekly_targets is 'sessions, volume_kg, distance_km — feeds benchmark bars on Progress.';
