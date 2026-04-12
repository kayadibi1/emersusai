-- 20260414_foods.sql
-- Polymorphic foods + supplements catalog. Populated by:
--   - scripts/import-usda-foods.js (USDA FDC: Foundation, SR Legacy, FNDDS, Branded)
--   - supabase/20260414_supplements_seed.sql (curated ~60 supplements)
--   - User-contributed rows inserted at runtime via api/emersus/foods-search.js
--
-- kind='food' vs kind='supplement' is the polymorphism switch.
-- base_unit + base_amount + food_nutrients.amount_per_base give uniform
-- snapshot math for both foods (per 100 g) and discrete supplements
-- (per 1 capsule / tablet / softgel).
--
-- search_vector is a generated column concatenating description + brand_name
-- so brand hits surface naturally in FTS queries without extra joins.

create extension if not exists pg_trgm;

create table if not exists public.foods (
  id                uuid primary key default gen_random_uuid(),
  fdc_id            int unique,
  description       text not null,
  kind              text not null default 'food'
                    check (kind in ('food','supplement')),
  source            text not null
                    check (source in (
                      'usda_foundation','usda_sr_legacy','usda_fndds','usda_branded',
                      'seed_supplement','user_contributed','chain_scrape'
                    )),
  category          text,
  common_unit       text,
  common_unit_grams numeric,
  base_unit         text not null default '100g'
                    check (base_unit in ('100g','serving')),
  base_amount       numeric not null default 100,
  form              text
                    check (form is null or form in (
                      'capsule','tablet','softgel','scoop','powder_g','liquid_ml','gummy'
                    )),
  brand_name        text,
  gtin_upc          text,
  ingredients_text  text,
  data_points       int,
  created_by        uuid references auth.users(id) on delete cascade,
  search_vector     tsvector generated always as (
                      to_tsvector('english',
                        coalesce(description,'') || ' ' || coalesce(brand_name,''))
                    ) stored,
  created_at        timestamptz not null default now()
);

-- Indexes
create index if not exists foods_source_idx   on public.foods (source);
create index if not exists foods_kind_idx     on public.foods (kind);
create index if not exists foods_kind_source_idx on public.foods (kind, source);
create index if not exists foods_search_vector_idx
  on public.foods using gin (search_vector);
create index if not exists foods_description_trgm_idx
  on public.foods using gin (description gin_trgm_ops);
create index if not exists foods_brand_name_trgm_idx
  on public.foods using gin (brand_name gin_trgm_ops)
  where brand_name is not null;
create index if not exists foods_gtin_upc_idx
  on public.foods (gtin_upc)
  where gtin_upc is not null;
create index if not exists foods_created_by_user_idx
  on public.foods (created_by)
  where source = 'user_contributed';

-- RLS
alter table public.foods enable row level security;

drop policy if exists "read non-user foods and own user foods" on public.foods;
create policy "read non-user foods and own user foods"
on public.foods
for select
to authenticated
using (source <> 'user_contributed' or created_by = auth.uid());

drop policy if exists "users can insert own user_contributed foods" on public.foods;
create policy "users can insert own user_contributed foods"
on public.foods
for insert
to authenticated
with check (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "users can update own user_contributed foods" on public.foods;
create policy "users can update own user_contributed foods"
on public.foods
for update
to authenticated
using  (source = 'user_contributed' and created_by = auth.uid())
with check (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "users can delete own user_contributed foods" on public.foods;
create policy "users can delete own user_contributed foods"
on public.foods
for delete
to authenticated
using (source = 'user_contributed' and created_by = auth.uid());

drop policy if exists "service role can manage foods" on public.foods;
create policy "service role can manage foods"
on public.foods
for all
to service_role
using (true)
with check (true);
