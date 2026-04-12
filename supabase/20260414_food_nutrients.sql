-- 20260414_food_nutrients.sql
-- Normalized nutrient storage. amount_per_base is interpreted via the parent
-- food's base_unit + base_amount:
--   base_unit='100g', base_amount=100  => amount per 100 g
--   base_unit='serving', base_amount=1 => amount per 1 serving (capsule, etc.)
--
-- Snapshot formula used by api/emersus/meal-journal.js:
--   snapshot = food_nutrients.amount_per_base
--            * meal_journal_entries.amount
--            / foods.base_amount

create table if not exists public.food_nutrients (
  food_id          uuid not null references public.foods(id) on delete cascade,
  nutrient_id      uuid not null references public.nutrients(id),
  amount_per_base  numeric not null,
  primary key (food_id, nutrient_id)
);

create index if not exists food_nutrients_nutrient_id_idx
  on public.food_nutrients (nutrient_id);

alter table public.food_nutrients enable row level security;

-- food_nutrients inherits visibility from the parent foods row.
-- We cannot reference the parent row's columns directly in a policy without
-- a subquery, so we gate reads behind an EXISTS against a visible food.
drop policy if exists "read food_nutrients for visible foods" on public.food_nutrients;
create policy "read food_nutrients for visible foods"
on public.food_nutrients
for select
to authenticated
using (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and (f.source <> 'user_contributed' or f.created_by = auth.uid())
  )
);

drop policy if exists "users can manage nutrients for own user foods" on public.food_nutrients;
create policy "users can manage nutrients for own user foods"
on public.food_nutrients
for all
to authenticated
using (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and f.source = 'user_contributed'
      and f.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.foods f
    where f.id = food_nutrients.food_id
      and f.source = 'user_contributed'
      and f.created_by = auth.uid()
  )
);

drop policy if exists "service role can manage food_nutrients" on public.food_nutrients;
create policy "service role can manage food_nutrients"
on public.food_nutrients
for all
to service_role
using (true)
with check (true);
