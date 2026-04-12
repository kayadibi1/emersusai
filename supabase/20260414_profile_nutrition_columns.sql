-- 20260414_profile_nutrition_columns.sql
-- Add Mifflin-St Jeor inputs for the meal plan generator.
--
-- All columns nullable: the chat fills them in conversationally when the
-- user asks for a plan and a required field is empty. No UI form for these
-- in v1 — the chat IS the form.
--
-- biological_sex is documented explicitly as a BMR formula input
-- (+5 male, -161 female in Mifflin-St Jeor), not a gender label.
--
-- Existing RLS policies on public.profiles cover all columns, so nothing
-- new is needed here.

alter table public.profiles
  add column if not exists body_weight_kg numeric(6,2),
  add column if not exists height_cm       numeric(6,2),
  add column if not exists date_of_birth   date,
  add column if not exists biological_sex  text
    check (biological_sex in ('male','female','prefer_not_to_say')),
  add column if not exists activity_level  text
    check (activity_level in ('sedentary','light','moderate','active','very_active'));
