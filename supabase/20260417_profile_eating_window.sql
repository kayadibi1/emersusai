-- 20260417_profile_eating_window.sql
-- Add configurable eating window for the pace zone calculator.
-- Values are hours in local time (0-23). NULL means use the default (7-22).

alter table public.profiles
  add column if not exists eating_window_start smallint
    check (eating_window_start >= 0 and eating_window_start <= 23),
  add column if not exists eating_window_end   smallint
    check (eating_window_end >= 0 and eating_window_end <= 23);
