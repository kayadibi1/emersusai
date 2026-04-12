-- 20260414_supplements_seed.sql
-- Curated supplement seed: ~40 common generic supplements.
--
-- Source: source='seed_supplement', kind='supplement'. No brand names.
-- Nutrient amounts are typical label values, not medical advice.
--
-- base_unit / base_amount convention (NOTE: foods table defaults are
-- base_unit='100g', base_amount=100 — which is correct for generic foods
-- and powder supplements. Discrete-unit supplements below EXPLICITLY
-- override both to base_unit='serving', base_amount=1 so their
-- food_nutrients rows can store "amount per 1 capsule/tablet/softgel"):
--
--   POWDER / MASS-MEASURED (creatine, whey, BCAA, caffeine powder, collagen, etc.)
--     base_unit='100g', base_amount=100 → nutrients stored per 100 g
--     journal logs use amount_unit='g'
--
--   DISCRETE-UNIT (D3 capsules, B-complex tablets, fish oil softgels, etc.)
--     base_unit='serving', base_amount=1 → nutrients stored per 1 unit
--     journal logs use amount_unit='serving'
--
--   LIQUID (fish oil drops, etc.) treated as base_unit='100g' with
--     1 ml ≈ 1 g for nutrient math at this precision.

-- Helper: resolve a nutrient slug to its id, used inline below.
-- We use a one-off CTE per supplement insert to keep the SQL declarative and
-- the file self-contained (no functions created just for seeding).

-- ═══════════════════════════════════════════════════════════════════════════
-- POWDERS (base_unit='100g')
-- ═══════════════════════════════════════════════════════════════════════════

-- Creatine monohydrate: 100% creatine
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Creatine monohydrate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',   0),
    ('protein',       0),
    ('carbohydrate',  0),
    ('total_fat',     0)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Whey protein isolate: ~90% protein, low carb, low fat
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Whey protein isolate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',    370),
    ('protein',        90),
    ('carbohydrate',   3),
    ('total_fat',      1),
    ('saturated_fat',  0.5),
    ('sodium',         200),
    ('calcium',        350)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Casein protein: slow-digesting
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Casein protein, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  360),
    ('protein',      85),
    ('carbohydrate', 5),
    ('total_fat',    1),
    ('calcium',      1800)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Pea protein
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Pea protein isolate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 30, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  380),
    ('protein',      80),
    ('carbohydrate', 3),
    ('total_fat',    4),
    ('iron',         10)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- BCAA powder (2:1:1)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('BCAA powder (2:1:1 leucine:isoleucine:valine)', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 7, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Beta-alanine
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Beta-alanine, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 3, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Citrulline malate
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Citrulline malate, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 6, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Caffeine anhydrous powder (highly concentrated — 1 g = 1000 mg caffeine)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Caffeine anhydrous, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 0.2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- L-theanine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('L-theanine, powder', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 0.2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Taurine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Taurine, powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 2, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Glycine powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Glycine, powder', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 3, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- EAA powder
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Essential amino acids (EAA), powder', 'supplement', 'seed_supplement', 'performance', 'powder_g', 'scoop', 10, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0), ('protein', 90)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Collagen peptides
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Collagen peptides, hydrolyzed', 'supplement', 'seed_supplement', 'recovery', 'powder_g', 'scoop', 10, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal', 360),
    ('protein',     90),
    ('sodium',      150)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Inulin fiber
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Inulin fiber, powder', 'supplement', 'seed_supplement', 'gut', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  150),
    ('carbohydrate', 90),
    ('fiber',        85)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Psyllium husk
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Psyllium husk, powder', 'supplement', 'seed_supplement', 'gut', 'powder_g', 'scoop', 5, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  200),
    ('carbohydrate', 85),
    ('fiber',        80)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Electrolyte blend (Na/K/Mg/Cl)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, common_unit_grams, base_unit, base_amount)
  values ('Electrolyte blend, powder', 'supplement', 'seed_supplement', 'hydration', 'powder_g', 'scoop', 7, '100g', 100)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  0),
    ('sodium',       14000),
    ('potassium',    3000),
    ('magnesium',    700)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- ═══════════════════════════════════════════════════════════════════════════
-- DISCRETE UNIT (base_unit='serving', base_amount=1)
-- Nutrient amounts are PER SINGLE UNIT (one capsule, one tablet, one softgel).
-- ═══════════════════════════════════════════════════════════════════════════

-- Vitamin D3 2000 IU capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 2000 IU, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_d', 50)) as v(slug, amount)  -- 2000 IU ≈ 50 mcg
  join public.nutrients n on n.slug = v.slug;

-- Vitamin D3 1000 IU capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 1000 IU, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_d', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin D3 + K2 combo softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin D3 2000 IU + K2 100 mcg, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_d', 50),
    ('vitamin_k', 100)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin K2 (MK-7) softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin K2 (MK-7) 100 mcg, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_k', 100)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin C 500 mg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin C 500 mg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_c', 500)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin E 400 IU softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin E 400 IU, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_e', 268)) as v(slug, amount)  -- 400 IU = 268 mg d-alpha
  join public.nutrients n on n.slug = v.slug;

-- Vitamin A 5000 IU softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin A 5000 IU, softgel', 'supplement', 'seed_supplement', 'vitamin', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_a_rae', 1500)) as v(slug, amount)  -- 5000 IU ≈ 1500 mcg RAE
  join public.nutrients n on n.slug = v.slug;

-- B-complex 50 tablet (standard "B-50" formulation)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin B-complex 50, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('thiamin',           50),
    ('riboflavin',        50),
    ('niacin',            50),
    ('pantothenic_acid',  50),
    ('vitamin_b6',        50),
    ('biotin',            50),
    ('folate',            400),
    ('vitamin_b12',       50)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Methylated B-complex tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Methylated B-complex, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('thiamin',           25),
    ('riboflavin',        25),
    ('niacin',            25),
    ('pantothenic_acid',  25),
    ('vitamin_b6',        25),
    ('biotin',            400),
    ('folate',            400),
    ('vitamin_b12',       500)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Vitamin B12 1000 mcg tablet (standalone)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Vitamin B12 (methylcobalamin) 1000 mcg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('vitamin_b12', 1000)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Folate 400 mcg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Folate (L-methylfolate) 400 mcg, tablet', 'supplement', 'seed_supplement', 'vitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('folate', 400)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Biotin 5000 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Biotin 5000 mcg, capsule', 'supplement', 'seed_supplement', 'vitamin', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('biotin', 5000)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium glycinate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium glycinate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium citrate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium citrate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Magnesium malate 200 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Magnesium malate 200 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('magnesium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Zinc picolinate 25 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Zinc picolinate 25 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('zinc', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Iron bisglycinate 25 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Iron bisglycinate 25 mg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('iron', 25)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Selenium (selenomethionine) 200 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Selenium (selenomethionine) 200 mcg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('selenium', 200)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Iodine (potassium iodide) 150 mcg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Iodine (potassium iodide) 150 mcg, capsule', 'supplement', 'seed_supplement', 'mineral', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('iodine', 150)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Fish oil 1200 mg softgel (360 mg EPA + 240 mg DHA typical, stored as total fat)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Fish oil (EPA 360 mg + DHA 240 mg), softgel', 'supplement', 'seed_supplement', 'omega3', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal',  10),
    ('total_fat',    1.2)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Algae-based omega-3 softgel (vegan EPA+DHA)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Algae omega-3 (EPA 200 mg + DHA 400 mg), softgel', 'supplement', 'seed_supplement', 'omega3', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('energy_kcal', 9),
    ('total_fat',   1.0)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Generic adult multivitamin tablet (rough representative values)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Adult multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',     900),
    ('vitamin_c',         60),
    ('vitamin_d',         25),
    ('vitamin_e',         30),
    ('vitamin_k',         80),
    ('thiamin',           1.5),
    ('riboflavin',        1.7),
    ('niacin',            20),
    ('pantothenic_acid',  10),
    ('vitamin_b6',        2),
    ('biotin',            30),
    ('folate',            400),
    ('vitamin_b12',       6),
    ('calcium',           200),
    ('iron',              18),
    ('magnesium',         100),
    ('zinc',              15),
    ('selenium',          55),
    ('copper',            0.9),
    ('manganese',         2),
    ('iodine',            150)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Women's multivitamin (higher iron)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Women''s multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',     700),
    ('vitamin_c',         75),
    ('vitamin_d',         25),
    ('vitamin_e',         15),
    ('vitamin_k',         90),
    ('folate',            600),
    ('vitamin_b12',       6),
    ('calcium',           500),
    ('iron',              27),
    ('magnesium',         100),
    ('zinc',              8)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Prenatal multivitamin (400 mcg folate minimum, iron, DHA optional)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Prenatal multivitamin, tablet', 'supplement', 'seed_supplement', 'multivitamin', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values
    ('vitamin_a_rae',  770),
    ('vitamin_c',      85),
    ('vitamin_d',      15),
    ('folate',         800),
    ('vitamin_b12',    2.6),
    ('calcium',        200),
    ('iron',           27),
    ('zinc',           11),
    ('iodine',         220)
  ) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Melatonin 3 mg tablet
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Melatonin 3 mg, tablet', 'supplement', 'seed_supplement', 'sleep', 'tablet', 'tablet', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Ashwagandha (KSM-66) 600 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Ashwagandha (KSM-66) 600 mg, capsule', 'supplement', 'seed_supplement', 'adaptogen', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Rhodiola rosea 500 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Rhodiola rosea 500 mg, capsule', 'supplement', 'seed_supplement', 'adaptogen', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Curcumin (with black pepper extract) 500 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Curcumin (+ piperine) 500 mg, capsule', 'supplement', 'seed_supplement', 'antioxidant', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- CoQ10 100 mg softgel
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('CoQ10 (ubiquinone) 100 mg, softgel', 'supplement', 'seed_supplement', 'antioxidant', 'softgel', 'softgel', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Caffeine 100 mg capsule
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Caffeine 100 mg, capsule', 'supplement', 'seed_supplement', 'performance', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;

-- Probiotic capsule (multi-strain, CFU data isn't a tracked nutrient)
with f as (
  insert into public.foods (description, kind, source, category, form, common_unit, base_unit, base_amount)
  values ('Probiotic multi-strain, capsule', 'supplement', 'seed_supplement', 'gut', 'capsule', 'capsule', 'serving', 1)
  returning id
)
insert into public.food_nutrients (food_id, nutrient_id, amount_per_base)
select f.id, n.id, v.amount from f
  cross join (values ('energy_kcal', 0)) as v(slug, amount)
  join public.nutrients n on n.slug = v.slug;
