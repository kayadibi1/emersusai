-- 20260414_nutrients.sql
-- Curated nutrient lookup table + seed. 31 entries covering:
--   energy (kcal), 7 macros, 13 vitamins, 10 minerals.
-- fdc_nutrient_id maps to USDA FoodData Central nutrient IDs, used by
-- scripts/import-usda-foods.js when loading food_nutrients rows.
--
-- default_dri_male / default_dri_female are adult (19–50) reference intakes
-- from the NIH ODS fact sheets. dri_upper_limit is the tolerable upper
-- intake (UL) where one exists. All values are the public DRIs and can
-- be refreshed later.

create table if not exists public.nutrients (
  id                uuid primary key default gen_random_uuid(),
  fdc_nutrient_id   int  unique not null,
  slug              text unique not null,
  name              text not null,
  unit              text not null,  -- g, mg, mcg, kcal, iu
  category          text not null,  -- energy, macro, vitamin, mineral, other
  default_dri_male   numeric,
  default_dri_female numeric,
  dri_upper_limit    numeric,
  display_order     int not null default 0
);

alter table public.nutrients enable row level security;

drop policy if exists "anyone can read nutrients" on public.nutrients;
create policy "anyone can read nutrients"
on public.nutrients
for select
to authenticated
using (true);

drop policy if exists "service role can manage nutrients" on public.nutrients;
create policy "service role can manage nutrients"
on public.nutrients
for all
to service_role
using (true)
with check (true);

-- Seed data.
-- FDC nutrient IDs from https://fdc.nal.usda.gov/docs/FoodData_Central_Supporting_Data_Documentation.pdf
-- Values rounded to practical precision.
insert into public.nutrients
  (fdc_nutrient_id, slug,              name,                   unit,  category,  default_dri_male, default_dri_female, dri_upper_limit, display_order)
values
  -- Energy
  (1008, 'energy_kcal',        'Energy',                'kcal', 'energy',   2500,  2000,  null, 1),
  -- Macros
  (1003, 'protein',             'Protein',               'g',    'macro',    56,    46,    null, 10),
  (1005, 'carbohydrate',        'Carbohydrate',          'g',    'macro',    130,   130,   null, 11),
  (1004, 'total_fat',           'Total fat',             'g',    'macro',    78,    70,    null, 12),
  (1079, 'fiber',               'Fiber',                 'g',    'macro',    38,    25,    null, 13),
  (2000, 'total_sugars',        'Total sugars',          'g',    'macro',    50,    50,    null, 14),
  (1258, 'saturated_fat',       'Saturated fat',         'g',    'macro',    22,    22,    null, 15),
  (1093, 'sodium',              'Sodium',                'mg',   'macro',    1500,  1500,  2300, 16),
  -- Vitamins
  (1106, 'vitamin_a_rae',       'Vitamin A (RAE)',       'mcg',  'vitamin',  900,   700,   3000, 20),
  (1162, 'vitamin_c',           'Vitamin C',             'mg',   'vitamin',  90,    75,    2000, 21),
  (1114, 'vitamin_d',           'Vitamin D',             'mcg',  'vitamin',  15,    15,    100,  22),
  (1109, 'vitamin_e',           'Vitamin E',             'mg',   'vitamin',  15,    15,    1000, 23),
  (1185, 'vitamin_k',           'Vitamin K',             'mcg',  'vitamin',  120,   90,    null, 24),
  (1165, 'thiamin',             'Thiamin (B1)',          'mg',   'vitamin',  1.2,   1.1,   null, 25),
  (1166, 'riboflavin',          'Riboflavin (B2)',       'mg',   'vitamin',  1.3,   1.1,   null, 26),
  (1167, 'niacin',              'Niacin (B3)',           'mg',   'vitamin',  16,    14,    35,   27),
  (1170, 'pantothenic_acid',    'Pantothenic acid (B5)', 'mg',   'vitamin',  5,     5,     null, 28),
  (1175, 'vitamin_b6',          'Vitamin B6',            'mg',   'vitamin',  1.3,   1.3,   100,  29),
  (1176, 'biotin',              'Biotin (B7)',           'mcg',  'vitamin',  30,    30,    null, 30),
  (1177, 'folate',              'Folate (B9)',           'mcg',  'vitamin',  400,   400,   1000, 31),
  (1178, 'vitamin_b12',         'Vitamin B12',           'mcg',  'vitamin',  2.4,   2.4,   null, 32),
  -- Minerals
  (1087, 'calcium',             'Calcium',               'mg',   'mineral',  1000,  1000,  2500, 40),
  (1089, 'iron',                'Iron',                  'mg',   'mineral',  8,     18,    45,   41),
  (1090, 'magnesium',           'Magnesium',             'mg',   'mineral',  420,   320,   350,  42),
  (1092, 'potassium',           'Potassium',             'mg',   'mineral',  3400,  2600,  null, 43),
  (1095, 'zinc',                'Zinc',                  'mg',   'mineral',  11,    8,     40,   44),
  (1103, 'selenium',            'Selenium',              'mcg',  'mineral',  55,    55,    400,  45),
  (1098, 'copper',              'Copper',                'mg',   'mineral',  0.9,   0.9,   10,   46),
  (1101, 'manganese',           'Manganese',             'mg',   'mineral',  2.3,   1.8,   11,   47),
  (1100, 'iodine',              'Iodine',                'mcg',  'mineral',  150,   150,   1100, 48),
  (1091, 'phosphorus',          'Phosphorus',            'mg',   'mineral',  700,   700,   4000, 49)
on conflict (fdc_nutrient_id) do update set
  slug               = excluded.slug,
  name               = excluded.name,
  unit               = excluded.unit,
  category           = excluded.category,
  default_dri_male   = excluded.default_dri_male,
  default_dri_female = excluded.default_dri_female,
  dri_upper_limit    = excluded.dri_upper_limit,
  display_order      = excluded.display_order;
