-- 20260414_meal_journal_entries.sql
-- Per-food/per-supplement log rows. Mirrors workout_logs structure.
--
-- Snapshots (kcal/protein/carbs/fat/fiber) are frozen at write time and
-- never updated. If USDA updates a food's nutrient profile in a future
-- import, historical journal entries retain the numbers the user saw
-- at the time. Micronutrients are aggregated at read-time via join
-- (display-only, not on the critical macro path).
--
-- amount_unit is 'g' for foods and powder supplements, 'serving' for
-- discrete-unit supplements. The write path validates that amount_unit
-- is compatible with the parent food's base_unit.

create table if not exists public.meal_journal_entries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  food_id             uuid not null references public.foods(id),
  plan_id             uuid references public.meal_plans(id) on delete set null,
  logged_date         date not null,
  meal_slot           text not null
                      check (meal_slot in (
                        'breakfast','mid_morning','lunch','afternoon','dinner','evening',
                        'pre_workout','post_workout','supplements_am','supplements_pm'
                      )),
  logged_at           timestamptz not null default now(),
  amount              numeric(10,2) not null check (amount >= 0),
  amount_unit         text not null check (amount_unit in ('g','serving')),
  servings            numeric(6,2),
  servings_unit       text,
  source              text not null
                      check (source in (
                        'chat_parser','manual_search','quick_add','copied','plan_check_off'
                      )),
  confidence          numeric(3,2),
  notes               text,
  kcal_snapshot       numeric(8,2),
  protein_g_snapshot  numeric(7,2),
  carbs_g_snapshot    numeric(7,2),
  fat_g_snapshot      numeric(7,2),
  fiber_g_snapshot    numeric(7,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists meal_journal_user_date_idx
  on public.meal_journal_entries (user_id, logged_date desc);

create index if not exists meal_journal_user_food_date_idx
  on public.meal_journal_entries (user_id, food_id, logged_date desc);

create index if not exists meal_journal_user_plan_date_idx
  on public.meal_journal_entries (user_id, plan_id, logged_date);

create index if not exists meal_journal_user_slot_date_idx
  on public.meal_journal_entries (user_id, meal_slot, logged_date);

create index if not exists meal_journal_user_logged_at_idx
  on public.meal_journal_entries (user_id, logged_at desc);

alter table public.meal_journal_entries enable row level security;

drop policy if exists "users can read own journal entries" on public.meal_journal_entries;
create policy "users can read own journal entries"
on public.meal_journal_entries
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert own journal entries" on public.meal_journal_entries;
create policy "users can insert own journal entries"
on public.meal_journal_entries
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can update own journal entries" on public.meal_journal_entries;
create policy "users can update own journal entries"
on public.meal_journal_entries
for update
to authenticated
using  (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own journal entries" on public.meal_journal_entries;
create policy "users can delete own journal entries"
on public.meal_journal_entries
for delete
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_meal_journal_updated_at on public.meal_journal_entries;
create trigger set_meal_journal_updated_at
before update on public.meal_journal_entries
for each row
execute function public.set_current_timestamp_updated_at();
