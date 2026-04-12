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

-- ───── foods_search RPC ────────────────────────────────────────────────────
-- Used by api/emersus/foods-search.js for typeahead, and by the nutrition
-- parser's match pipeline. Runs SECURITY INVOKER so RLS on public.foods
-- enforces user-contributed visibility.
--
-- Ranking formula:
--   primary  = ts_rank_cd(search_vector, tsquery)      -- FTS relevance
--   fuzz     = similarity(description, query)          -- pg_trgm on description
--   brand    = similarity(brand_name, query)           -- pg_trgm on brand
--   tie      = source rank CASE (foundation=7 .. chain_scrape=1)
--   data_pts = COALESCE(data_points, 0) / 1000.0       -- prefer complete branded
--
-- Final order: (primary + fuzz + brand) desc, tie desc, data_pts desc, description asc

create or replace function public.foods_search(
  p_query         text,
  p_kind          text default 'any',
  p_generic_only  boolean default false,
  p_limit         int default 20
) returns table (
  id            uuid,
  description   text,
  brand_name    text,
  source        text,
  kind          text,
  category      text,
  common_unit   text,
  common_unit_grams numeric,
  base_unit     text,
  base_amount   numeric,
  form          text,
  rank          numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select
      plainto_tsquery('english', p_query) as tsq,
      lower(p_query) as lq
  )
  select
    f.id,
    f.description,
    f.brand_name,
    f.source,
    f.kind,
    f.category,
    f.common_unit,
    f.common_unit_grams,
    f.base_unit,
    f.base_amount,
    f.form,
    (
      ts_rank_cd(f.search_vector, q.tsq)
      + greatest(similarity(f.description, q.lq), 0) * 0.5
      + greatest(similarity(coalesce(f.brand_name, ''), q.lq), 0) * 0.5
    )::numeric as rank
  from public.foods f, q
  where (f.search_vector @@ q.tsq
         or f.description % q.lq
         or (f.brand_name is not null and f.brand_name % q.lq))
    and (p_kind = 'any' or f.kind = p_kind)
    and (not p_generic_only or f.source <> 'usda_branded')
  order by
    rank desc,
    case f.source
      when 'usda_foundation'  then 7
      when 'usda_sr_legacy'   then 6
      when 'usda_branded'     then 5
      when 'usda_fndds'       then 4
      when 'seed_supplement'  then 3
      when 'user_contributed' then 2
      when 'chain_scrape'     then 1
      else 0
    end desc,
    coalesce(f.data_points, 0) desc,
    f.description asc
  limit p_limit
$$;

grant execute on function public.foods_search(text, text, boolean, int) to authenticated, service_role;
