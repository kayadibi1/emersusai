# Meal Planning, Journaling & Supplements — Design Spec

**Date:** 2026-04-11
**Status:** Draft
**Adjacent spec:** `2026-04-10-workout-tracking-design.md` — this feature structurally mirrors workout tracking and integrates with it (day-type linking, shared `/app/progress/` analytics dashboard).

---

## Goal

Give Emersus a first-class nutrition subsystem alongside workouts. Users can:

- Generate an evidence-based meal plan from their profile (macro targets via Mifflin-St Jeor, day-type templates, per-meal food prescriptions, supplement stack).
- Log what they actually ate and what supplements they took — via the chat in natural language ("I had chicken and rice and took 5 g creatine"), via a search-first modal, or by checking off prescribed items from the plan.
- See daily and multi-day analytics: macro adherence, plan adherence, streaks, micronutrient status, top foods.

Meal planning and journaling are designed as a **symmetric pair** — plans set targets, the journal records actual intake, adherence compares them. Either flow is usable without the other, but they compose naturally through shared day-type resolution.

Supplements are treated as **a polymorphic specialization of foods**: same data model, same logging pipeline, same micronutrient math, dedicated UI surface where it matters.

## Scope

### In v1

- **Tiered meal plan:** macro + fiber targets at the top, day-type meal prescriptions below.
- **Day-type templates** (`training_day` / `rest_day` / `refeed_day`) auto-linked to the active workout plan's session calendar, with per-date user override.
- **Per-food journal entries** with `meal_slot` tag and timestamp.
- **Food catalog** imported from USDA FoodData Central (Foundation + SR Legacy + FNDDS Survey, ~15k items, ~200 MB).
- **LLM natural-language parser** for free-form logging ("I had a chicken caesar wrap and an iced latte for lunch").
- **Chat integration:** new `meal-plan` widget fence for plan generation, new `nutrition-log-confirm` widget fence for journal entry confirmation. Confirmation is mandatory in v1 — no silent writes from chat.
- **Single `/app/nutrition/` page** for active work (today + plan + journal + supplements), internal tab routing, food detail as a slide-over drawer.
- **`/app/progress/` refactor** to gain a top-level `[Workouts | Nutrition]` tab switcher, with a new nutrition analytics pane (macro trends, streaks, plan adherence, micronutrient status, top foods).
- **Hybrid macro-target computation:** LLM auto-computes via Mifflin-St Jeor from profile, shows the math conversationally, user can override inline before saving.
- **User-contributed foods and supplements:** private per user, `source = 'user_contributed'`, `created_by` gate in RLS.
- **Profile schema extension:** `body_weight_kg`, `height_cm`, `date_of_birth`, `biological_sex`, `activity_level` — all nullable, filled conversationally when missing.
- **Supplements as polymorphic foods** (`kind = 'supplement'`): curated seed of ~60 common generics, supplement-facts detail panel, dedicated plan section with timing hints, inclusion in the chat parser, included by default in LLM-generated plans under a conservative evidence-based protocol.

### Out of scope (deferred, some documented as future paths)

- **Restaurant chain nutrition data.** Deferred to v1.5 via one of two paths: (a) MenuStat.org bulk import, contingent on a license check for commercial use; (b) targeted polite crawls of the top ~20 US chains' public nutrition pages, storing only numeric facts with provenance (`source_url`, `scraped_at`). Neither ships in v1. UI shows a "log individual components" helper for users trying to log chain items.
- **USDA Branded Foods** (~1 M rows). Opt-in v1.5 import.
- **Photo / OCR food logging, barcode scanning.**
- **Hydration tracking, body composition tracking.**
- **Meal-prep lists, grocery-list generation, recipe-from-URL import.**
- **Multi-week progression plans** (the plan is a day-type pattern, not a 12-week ramp — users regenerate periodically instead).
- **TDEE auto-adjustment from weigh-in trend.**
- **Social / sharing.**
- **Community-shared user foods.**
- **Age-bracket DRIs** for micronutrients (v1 uses adult male/female averages).
- **Mobile native.**

---

## Data Model

### Lookup tables (seeded once)

#### `nutrients`

31 curated entries, seeded via migration.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `fdc_nutrient_id` | int UNIQUE | USDA FDC nutrient ID for import mapping |
| `slug` | text UNIQUE | e.g. `energy_kcal`, `protein`, `vitamin_c` |
| `name` | text | Display name |
| `unit` | text | `g` · `mg` · `mcg` · `kcal` · `iu` |
| `category` | text | `energy` · `macro` · `vitamin` · `mineral` · `other` |
| `default_dri_male` | numeric | Daily reference intake (adult male) |
| `default_dri_female` | numeric | Daily reference intake (adult female) |
| `dri_upper_limit` | numeric | Tolerable upper intake (nullable) |
| `display_order` | int | Sort for the micronutrient UI |

**Curated nutrient set (31 total):**
- **Energy:** kcal
- **Macros:** protein, carbohydrate, total fat, fiber, total sugars, saturated fat, sodium
- **Vitamins (13):** A (RAE), C, D, E, K, B1 (thiamin), B2 (riboflavin), B3 (niacin), B5 (pantothenic acid), B6, B7 (biotin), B9 (folate), B12
- **Minerals (10):** Calcium, Iron, Magnesium, Potassium, Zinc, Selenium, Copper, Manganese, Iodine, Phosphorus

### Food catalog

#### `foods`

One row per food or supplement. USDA imports, user-contributed entries, supplement seeds, and (v1.5) chain-scraped entries all live here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `fdc_id` | int UNIQUE nullable | USDA FDC ID (null for user-contributed, supplements, chain entries) |
| `description` | text NOT NULL | "Chicken, broiler, breast, cooked, roasted" |
| `kind` | text NOT NULL DEFAULT `'food'` | `food` · `supplement` (CHECK constraint) |
| `source` | text NOT NULL | `usda_foundation` · `usda_sr_legacy` · `usda_fndds` · `seed_supplement` · `user_contributed` · `chain_scrape` |
| `category` | text | USDA food group, supplement class, or chain name |
| `common_unit` | text | `medium` · `cup` · `slice` · `piece` · `tablespoon` · `capsule` · `scoop` · `ml` |
| `common_unit_grams` | numeric | Grams per one common unit (nullable when not applicable, e.g. liquids, capsules where mass is not the dose-driver) |
| `base_unit` | text NOT NULL DEFAULT `'100g'` | `100g` (foods, powder supplements measured by mass) or `serving` (discrete-unit supplements: capsules, tablets, softgels, gummies). Determines how `food_nutrients.amount_per_base` is interpreted. |
| `base_amount` | numeric NOT NULL DEFAULT 100 | Default `100` when `base_unit='100g'`. Default `1` when `base_unit='serving'`. Multiplier used in snapshot math. |
| `form` | text | Supplements only: `capsule` · `tablet` · `softgel` · `scoop` · `powder_g` · `liquid_ml` · `gummy`. Null for foods. |
| `brand_name` | text | Nullable; for user-contributed or v1.5 chain entries |
| `created_by` | uuid | FK `auth.users`, nullable, set only for `source = 'user_contributed'` |
| `search_vector` | tsvector | `GENERATED ALWAYS AS (to_tsvector('english', coalesce(description,'') || ' ' || coalesce(brand_name,''))) STORED` |
| `created_at` | timestamptz | `default now()` |

**Indexes:**
- Unique on `fdc_id`
- B-tree on `source`, `kind`
- GIN on `search_vector`
- GIN (`gin_trgm_ops`) on `description`
- Partial B-tree on `(created_by)` where `source = 'user_contributed'`

**RLS:**
- `SELECT` allowed if `source != 'user_contributed'` OR `created_by = auth.uid()`
- `INSERT` allowed only for rows where `source = 'user_contributed'` AND `created_by = auth.uid()`
- `UPDATE` / `DELETE` self-only on user-contributed rows
- USDA and seed rows are service-role-only writes (seeded via migration + import script)

**Extension required:** `pg_trgm` (already needed by workout-tracking's exercise matching; `CREATE EXTENSION IF NOT EXISTS pg_trgm` is idempotent in the foods migration).

#### `food_nutrients`

Normalized nutrient storage. USDA FDC ships data in this shape, so the importer is near-1:1 for foods.

| Column | Type | Notes |
|---|---|---|
| `food_id` | uuid FK foods ON DELETE CASCADE | |
| `nutrient_id` | uuid FK nutrients | |
| `amount_per_base` | numeric(12,4) | Amount of this nutrient per one base unit of the parent food, where the base unit is defined by `foods.base_unit` + `foods.base_amount`. For foods and powder supplements, this is per 100 g. For discrete-unit supplements (capsules, tablets, softgels, gummies), this is per 1 serving (one capsule / tablet / etc.). |

**Primary key:** `(food_id, nutrient_id)`. **Secondary index:** `(nutrient_id)` for "top foods by vitamin C" style queries. **RLS:** readable whenever the parent `foods` row is readable; writes service-role + user-contributed owner via parent food.

**Snapshot math** (used by the journal write path):

```
kcal_snapshot = food_nutrients.amount_per_base
              * meal_journal_entries.amount
              / foods.base_amount
```

This formula is uniform across foods and supplements. For a food with `base_unit='100g'`, `base_amount=100`, it reduces to the classic `per-100g × grams / 100`. For a discrete supplement with `base_unit='serving'`, `base_amount=1`, it reduces to `per-serving × serving_count`. The write path validates that `meal_journal_entries.amount_unit` is compatible with the parent food's `base_unit` (`g` for `100g` foods; `serving` for discrete supplements).

### Plan side

#### `meal_plans`

Structural twin of `workout_plans`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL FK auth.users ON DELETE CASCADE | |
| `title` | text NOT NULL | |
| `schema_version` | int NOT NULL default 1 | |
| `plan` | jsonb NOT NULL | Full plan document (shape below) |
| `previous_plan` | jsonb | One-step undo |
| `source_thread_id` | uuid | Chat thread that generated it |
| `last_adjusted_via` | text | `chat` · `manual` |
| `last_adjusted_at` | timestamptz | |
| `archived_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | `updated_at` trigger reuses `set_current_timestamp_updated_at` |

**RLS:** mirrors `workout_plans` — `auth.uid() = user_id` on all four CRUD operations.

**Indexes:**
- `(user_id)`
- Partial `(user_id, updated_at desc)` where `archived_at is null` — active plan lookup
- Unique partial `(user_id)` where `archived_at is null` — enforce at most one active meal plan per user (matching workout plan convention)

#### `meal_plans.plan` JSONB shape (v1, frozen under `schema_version = 1`)

```json
{
  "targets": {
    "training_day": { "kcal": 2800, "protein_g": 190, "carbs_g": 340, "fat_g": 80, "fiber_g": 40 },
    "rest_day":     { "kcal": 2400, "protein_g": 190, "carbs_g": 240, "fat_g": 80, "fiber_g": 40 },
    "refeed_day":   { "kcal": 3200, "protein_g": 190, "carbs_g": 440, "fat_g": 80, "fiber_g": 50 }
  },
  "day_types": [
    {
      "slug": "training_day",
      "name": "Training day",
      "meals": [
        {
          "slot": "breakfast",
          "name": "Oats + whey",
          "foods": [
            { "fdc_id": 169705, "description": "Oats, raw", "grams": 80 },
            { "fdc_id": 174608, "description": "Whey protein isolate", "grams": 30 },
            { "fdc_id": 173946, "description": "Blueberries, raw", "grams": 150 }
          ]
        },
        { "slot": "lunch",        "name": "...", "foods": [] },
        { "slot": "dinner",       "name": "...", "foods": [] },
        { "slot": "post_workout", "name": "...", "foods": [] }
      ],
      "supplements": [
        { "food_id": "uuid", "description": "Creatine monohydrate", "amount": 5,    "unit": "g",  "timing": "any" },
        { "food_id": "uuid", "description": "Vitamin D3",           "amount": 2000, "unit": "iu", "timing": "morning" },
        { "food_id": "uuid", "description": "Omega-3 (EPA+DHA)",    "amount": 1000, "unit": "mg", "timing": "with_meal" },
        { "food_id": "uuid", "description": "Caffeine anhydrous",   "amount": 200,  "unit": "mg", "timing": "pre_workout" }
      ]
    },
    { "slug": "rest_day",   "name": "Rest day",   "meals": [], "supplements": [] },
    { "slug": "refeed_day", "name": "Refeed day", "meals": [], "supplements": [] }
  ],
  "assignments": {
    "mode": "auto_from_workout",
    "default_day_type": "rest_day",
    "overrides": { "2026-04-15": "refeed_day", "2026-04-18": "rest_day" }
  },
  "provenance": {
    "generated_at": "2026-04-11T19:32:00Z",
    "model": "gpt-5.4-mini",
    "profile_snapshot": {
      "body_weight_kg": 82, "height_cm": 180, "age": 31,
      "biological_sex": "male", "activity_level": "moderate", "goal": "cut"
    },
    "formula": "mifflin_st_jeor_moderate_activity_500_deficit"
  }
}
```

**Notes on the shape:**

- **`assignments.mode = "auto_from_workout"`** means day-type on any date is resolved at read-time by checking the active workout plan for a scheduled session on that date — if there is one, day-type is `training_day`; otherwise `default_day_type`. The `overrides` map wins over auto logic.
- **Meal slot enum:** `breakfast` · `mid_morning` · `lunch` · `afternoon` · `dinner` · `evening` · `pre_workout` · `post_workout` · `supplements_am` · `supplements_pm`. Plans may omit any.
- **Supplements are a distinct array on each day_type**, not inlined into `meals`, because they have different semantics (timing hints, dose units that aren't grams) and a dedicated UI surface.
- **Supplement `timing` enum:** `any` · `morning` · `with_meal` · `pre_workout` · `post_workout` · `bedtime`. Used by the UI to group supplements visibly and to pre-select meal slots when the user logs them.
- **Plan-document supplement `unit` field** (e.g. `"unit": "iu"`, `"unit": "mg"`) is a **display hint** — it tells the user "take 2000 IU of vitamin D3." It is not the storage format. When the user clicks "log this" on a plan supplement, the widget resolves `food_id` → the catalog entry, reads the food's `base_unit` and its per-base nutrient content (e.g. "1 capsule = 1000 IU"), and writes a journal row with `amount=2, amount_unit='serving'`. For powder supplements (`base_unit='100g'`), the widget computes grams from the prescribed dose instead (e.g. "5 g creatine" → `amount=5, amount_unit='g'`).

### Journal side

#### `meal_journal_entries`

Denormalized log rows, structural twin of `workout_logs`. Each row is one consumed item — food or supplement.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL FK auth.users | RLS self-only |
| `food_id` | uuid NOT NULL FK foods | Always set; supplement entries point at supplement rows in `foods` |
| `plan_id` | uuid FK meal_plans | Nullable; set when entry originated from a plan check-off |
| `logged_date` | date NOT NULL | Calendar date the item was consumed |
| `meal_slot` | text NOT NULL | Enum above |
| `logged_at` | timestamptz NOT NULL DEFAULT now() | Exact timestamp for within-day ordering |
| `amount` | numeric(10,2) NOT NULL | Canonical amount in the parent food's base unit (see `amount_unit`) |
| `amount_unit` | text NOT NULL | `g` (when parent food's `base_unit='100g'`) or `serving` (when parent food's `base_unit='serving'`). Validated against `foods.base_unit` in the write path — a log row for a food with `base_unit='100g'` must have `amount_unit='g'`. |
| `servings` | numeric(6,2) | Convenience display: "1.5 cups" |
| `servings_unit` | text | `cup` · `slice` · `piece` · `medium` · `tbsp` · etc. |
| `source` | text NOT NULL | `chat_parser` · `manual_search` · `quick_add` · `copied` · `plan_check_off` |
| `confidence` | numeric(3,2) | LLM parser confidence 0–1, null when not parser-sourced |
| `notes` | text | |
| `kcal_snapshot` | numeric(8,2) | |
| `protein_g_snapshot` | numeric(7,2) | |
| `carbs_g_snapshot` | numeric(7,2) | |
| `fat_g_snapshot` | numeric(7,2) | |
| `fiber_g_snapshot` | numeric(7,2) | |
| `created_at` / `updated_at` | timestamptz | |

**Why `amount` + `amount_unit` instead of just `grams`:** discrete-unit supplements (capsules, tablets, softgels) can't meaningfully store nutrient data "per 100 g of capsule mass" — a vitamin D3 capsule's dose is tied to one capsule, not to capsule mass. The `foods.base_unit` / `base_amount` / `food_nutrients.amount_per_base` triple makes snapshot math uniform for both worlds (see the snapshot formula under `food_nutrients`). Foods and powder supplements use `base_unit='100g'` and log rows use grams; discrete supplements use `base_unit='serving'` and log rows use serving-count. Display conversion between grams and user-facing units (cups, slices, capsules) happens in the UI via `servings` + `servings_unit`.

**Snapshots.** Computed at insert time from `food_nutrients × amount`. They never rewrite — a journal entry from three months ago shows the numbers the user saw at the time, regardless of USDA updates. Only macros + fiber are snapshotted inline; micronutrient values are aggregated at read-time via join because they're display-only and 30+ inline columns per row would be wasteful. Food rows are effectively append-only under their `fdc_id` key: USDA refreshes update the existing row in place, and snapshot protection means prior journal entries keep their original numbers.

**Indexes:**
- `(user_id, logged_date DESC)` — today/timeline queries
- `(user_id, food_id, logged_date DESC)` — "how often do I eat X"
- `(user_id, plan_id, logged_date)` — adherence joins
- `(user_id, meal_slot, logged_date)` — "my usual breakfast" suggestions
- `(user_id, logged_at DESC)` — rolling activity feed

**RLS:** self-only on all CRUD operations.

### Profile extension

`supabase/20260413_profile_nutrition_columns.sql`:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS body_weight_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS height_cm       numeric(6,2),
  ADD COLUMN IF NOT EXISTS date_of_birth   date,
  ADD COLUMN IF NOT EXISTS biological_sex  text
    CHECK (biological_sex IN ('male','female','prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS activity_level  text
    CHECK (activity_level IN ('sedentary','light','moderate','active','very_active'));
```

All nullable. `biological_sex` is documented explicitly as an input to the Mifflin-St Jeor BMR formula (`+5` for male, `-161` for female), not a gender label — this framing matters for the LLM system prompt so it doesn't conflate the two. The field appears in the formula context only; it is not surfaced as a profile UI toggle.

---

## USDA FoodData Central Import

### One-time import script: `scripts/import-usda-foods.js`

Pulls and loads three USDA FDC dataset bundles.

**Sources:**
- **Foundation Foods** (~200 items, research-grade nutrient data)
- **SR Legacy** (~7,800 items, classic USDA national nutrient database)
- **Survey FNDDS** (~7,000 items, prepared/mixed foods from national food survey)

Downloaded from `https://fdc.nal.usda.gov/fdc-datasets.html` as JSON bundles per dataset.

**Behavior:**
1. Download and unzip each dataset to a temp directory.
2. For each food:
   - Upsert into `foods` keyed on `fdc_id`. Sets `source` to the dataset type, `kind = 'food'`, `base_unit = '100g'`, `base_amount = 100`.
   - Compute `common_unit` / `common_unit_grams` from FDC's `portions` field when available.
3. For each food's nutrient rows:
   - Look up the local `nutrient_id` via the seeded `nutrients.fdc_nutrient_id` mapping. Skip any nutrient not in our curated 31-entry set.
   - FDC ships nutrient amounts in units of "per 100 g edible portion," so values map directly into `amount_per_base` under our `base_unit='100g'` convention.
   - Upsert into `food_nutrients` keyed on `(food_id, nutrient_id)`.
4. Transactional in batches of 500 foods for resumability.
5. Reports: foods inserted/updated, food_nutrients rows written, skipped nutrients, elapsed time.

**Tiebreaker priority in match ranking** (used later by the parser): `usda_foundation` > `usda_sr_legacy` > `usda_fndds` > `seed_supplement` > `user_contributed`. This prefers research-grade over survey data and prefers components over mixed dishes when scores are close.

**Expected output:** ~15 k foods × ~25 nutrients per food on average ≈ 350–500 k `food_nutrients` rows. Comfortably within Postgres' capacity.

**Expected run time:** 5–15 minutes on the Hetzner box (8 vCPU / 16 GB).

**Invocation:** runs on the Hetzner box via `ssh hetzner && cd ~/app && node scripts/import-usda-foods.js`. Idempotent — safe to re-run for USDA annual refreshes.

### Supplement seed: `supabase/20260413_supplements_seed.sql`

Not an import — a hand-curated SQL insert of ~60 common generic supplements as `foods` rows with `kind='supplement'`, `source='seed_supplement'`, plus corresponding `food_nutrients` rows for their active ingredients (most supplements have 1–3 nutrients; some like B-complex or multis have many).

**Base unit convention for the seed:**
- **Powder / mass-measured supplements** (creatine monohydrate, whey protein, BCAA, caffeine anhydrous powder, collagen peptides): `base_unit='100g'`, `base_amount=100`. Nutrients stored per 100 g. Journal logs use grams. A 5 g creatine scoop is logged as `amount=5, amount_unit='g'`.
- **Discrete-unit supplements** (vitamin D3 capsules, omega-3 softgels, magnesium tablets, melatonin tablets, multivitamin tablets, probiotic capsules): `base_unit='serving'`, `base_amount=1`, `common_unit='capsule'` or `'tablet'` or `'softgel'` per `form`. Nutrients stored per 1 unit (one capsule or one tablet). Journal logs use serving-count. "Took 1 vitamin D3 capsule" is logged as `amount=1, amount_unit='serving'`.
- **Liquid supplements** (liquid D3 drops, liquid fish oil): `base_unit='100g'`, `base_amount=100` (treated as mass; 1 ml ≈ 1 g is acceptable for the nutrient math at this precision). `common_unit='ml'` for display.

**Curated seed list:**
- **Performance:** creatine monohydrate, whey protein isolate, casein, pea protein, plant protein blend, EAA, BCAA, beta-alanine, citrulline malate, caffeine anhydrous, l-theanine, taurine, electrolyte blend (Na/K/Mg)
- **Vitamins (single):** D3, K2 (MK-7), C, A, E, B12, folate, biotin
- **B-complex:** generic B-complex-50, methylated B-complex
- **Minerals:** magnesium glycinate, magnesium citrate, magnesium malate, zinc picolinate, iron bisglycinate, iodine (potassium iodide), selenium (selenomethionine)
- **Omega-3:** fish oil EPA/DHA, algae-based EPA/DHA
- **Recovery / sleep:** glycine, melatonin, GABA, ashwagandha (generic), rhodiola (generic)
- **Gut / fiber:** probiotics (generic strain-mix), inulin, psyllium husk, collagen peptides
- **General:** generic adult multivitamin, generic women's multivitamin, generic prenatal multivitamin, coenzyme Q10, curcumin (with black pepper extract), vitamin D3 + K2 combo

All entries use generic names — no brand names in the seed. User-contributed entries cover brand-specific items.

**Not seeded (deferred):** pre-workout blends (inconsistent formulations), fat burners (no strong evidence base), most "nootropic stacks", most adaptogens beyond ashwagandha/rhodiola.

---

## Chat Integration & Runtime Flow

### Intent classification (cheap, pre-LLM)

Before running retrieval, `api/emersus/workflow.js` runs a regex/keyword classifier against the user message to pick one of four nutrition sub-intents:

- **`generate_plan`** — triggers on phrases like `meal plan`, `diet plan`, `cut/bulk/recomp macros for`, `macros for`, `what should I eat to`, `nutrition plan`.
- **`log_food`** — triggers on `^(log|track|add|I (had|ate|just ate|drank|took))\b`, or `^(for|at) (breakfast|lunch|dinner|snack|supps?|supplements)` paired with a food/supplement phrase. Supplement shorthand (`supps`, `stack`, `took my`) also routes here.
- **`query`** — any other nutrition-related question; normal retrieval path, no fences emitted.
- **`none`** — non-nutrition; this feature never interferes.

This is **regex-first, deterministic, and free**. False positives are harmless because both the plan and log paths have explicit confirmation UI before writing anything.

### Natural-language food parser — `api/emersus/nutrition-parser.js`

A **separate OpenAI call** from the main chat completion. Deterministic, tool-schema'd, narrow. Keeping it separate prevents the main chat response from hallucinating foods into a log write.

**Entry point:** `parseFoodDescription(text, { userId })`.

**Flow:**

1. Call OpenAI with a strict function schema:
   ```json
   { "items": [
       { "raw_text": "string",
         "description": "string",
         "amount": "number",
         "amount_unit": "string",
         "kind": "food|supplement",
         "meal_slot": "string|null",
         "confidence": "number 0..1" }
   ]}
   ```
   System prompt (abbreviated): "Parse into discrete items with canonical units. For foods, always produce `amount` in grams — convert common household units (1 cup cooked white rice = 195 g, 1 medium banana = 118 g, 1 slice bread = 28 g). Set `amount_unit = 'g'`. For powder or mass-measured supplements (creatine, whey, BCAA, caffeine powder, collagen), also produce grams and set `amount_unit = 'g'`. For discrete-unit supplements (vitamin D3 capsules, omega-3 softgels, magnesium tablets, multivitamin, probiotic capsules), produce the count of units taken and set `amount_unit = 'serving'`. Distinguish foods from supplements in the `kind` field. Descriptions must be generic — no brand unless the user explicitly named one. Do not invent items. If you cannot determine a canonical amount, set `confidence` below 0.5 so the user can correct it in the confirmation widget."
   Temperature `0`. Model via `OPENAI_EMERSUS_PARSER_MODEL` env with a cheaper default (`gpt-4.1-mini`-class).

2. For each parsed item, run the **match pipeline** against `foods`:
   - Exact match on `lower(description)` → `foods.description`
   - Postgres FTS: `search_vector @@ plainto_tsquery('english', :description)`, ranked by `ts_rank_cd`
   - pg_trgm `similarity(description, :description)` tiebreak
   - Filter by `kind` from the parser output (don't match a supplement phrase to a food row and vice versa)
   - Combined score ≥ 0.35 → auto-match
   - Below threshold → flag as `needs_review` with top 5 candidates for the confirmation widget
   - Source-tier tiebreaker: `usda_foundation` > `usda_sr_legacy` > `usda_fndds` > `seed_supplement` > `user_contributed`

3. Returns:
   ```json
   {
     "items": [
       { "food_id": "uuid", "description": "Chicken, broiler, breast, cooked",
         "amount": 200, "amount_unit": "g", "kind": "food",
         "meal_slot": "lunch", "confidence": 0.92,
         "match_method": "fts", "alternates": [] }
     ],
     "unresolved": []
   }
   ```

**No caching** at parser level — each utterance is parsed fresh. The SQL match hits indexes hard; cheap. On OpenAI error, return `{ error: 'parser_unavailable', suggest_manual: true }` and the chat replies with "use the Log food button" fallback.

### Plan generation path — `meal-plan` widget fence

When `intent === 'generate_plan'`:

1. **Profile gate.** Check `profiles` for `body_weight_kg`, `height_cm`, `date_of_birth`, `biological_sex`, `activity_level`. If any are missing, inject a system-level hint:

   > "Before generating, ask the user for: \[list of missing fields]. Do not guess. Do not emit a meal-plan fence until profile is complete."

   The LLM asks conversationally. User answers in chat. Client PATCHes `/api/profile` with the new values. Next turn re-triggers plan generation. **No guessing ever.**

2. **Normal retrieval still runs.** Plan generation hits `retrieveDatabaseEvidence` with the user's query so the model's macro-split reasoning is grounded in PubMed evidence (e.g., protein at 1.6–2.2 g/kg in a cut is evidence-backed; the citation appears in the chat response above the fence). This matches Emersus' "real numbers, real specifics, cite the evidence" voice and differentiates plan generation from a generic AI nutrition bot.

3. **System prompt addendum** (new guarded section in `workflow.js`, emitted only when `intent === 'generate_plan'`):

   ```
   MEAL PLAN GENERATION PROTOCOL

   1. Compute macro targets using Mifflin-St Jeor:
        BMR = 10*weight_kg + 6.25*height_cm - 5*age + (5 if male, -161 if female)
        TDEE = BMR * activity_multiplier
          (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very_active 1.9)
        Adjust for goal:
          cut:      TDEE - 500 kcal (aggressive cut: -750, sustainable minimum: -300)
          maintain: TDEE
          bulk:     TDEE + 250..400 kcal (lean bulk) or +500 (traditional)
        Protein: 1.6–2.2 g/kg body weight.
          Default 1.8 for maintenance, 2.0–2.2 for cut, 1.6–1.8 for bulk.
        Fat: 20–35% of kcal, absolute minimum 0.6 g/kg.
        Carbs: remainder.
        Fiber: 14 g per 1000 kcal target, rounded to nearest 5 g.

   2. Show the user the math briefly in conversational form BEFORE the plan.
      ("82 kg / 180 cm / 31 / male / moderate / cut → BMR 1820, TDEE 2820,
        target 2300 kcal, protein 180 g, fat 65 g, carbs 235 g, fiber 35 g.")

   3. Emit THREE day types in the meal-plan fence: training_day, rest_day, refeed_day.
      training_day:  computed targets with carbs weighted higher
      rest_day:      carbs -60 g, fat +15 g, same protein
      refeed_day:    carbs at ~maintenance carb share, same protein

   4. For meals within each day_type:
        - Use USDA FDC generic foods ONLY. Reference by fdc_id when known; fall
          back to description otherwise.
        - 3 meals + 1 snack by default. More if user prefers.
        - Respect dietary_preferences from profile (vegan, halal, etc.).
        - No restaurant chain items. No brand names unless the user asked.

   5. Include a supplements array on each day_type using the SUPPLEMENT PROTOCOL
      below. Generate an empty array if the user has said they don't want
      supplements.

   6. Emit the plan as a JSON document in a fenced ```meal-plan block.
      Never emit the fence if profile fields are missing. Ask first.


   SUPPLEMENT PROTOCOL (evidence-based only)

   Include ONLY supplements with strong evidence for the user's goal:
     - Creatine monohydrate 3-5 g/day: strength, hypertrophy. Broad safety.
     - Whey/casein/pea protein: as a tool to hit the protein target.
     - Vitamin D3 1000-2000 IU/day: general sufficiency baseline.
       Frame as "if deficient or low sun exposure." No megadoses.
     - Omega-3 EPA+DHA 1-2 g/day: anti-inflammatory, cardiovascular.
     - Caffeine 3-6 mg/kg body weight pre-workout: ergogenic.
     - Electrolytes (Na/K/Mg): in heat or on low-sodium diet.
     - Magnesium glycinate 200-400 mg: sleep and recovery, when baseline low.

   Do NOT recommend:
     - Anything requiring prescription or clinical monitoring.
     - Megadoses above tolerable upper intake levels.
     - Supplements with weak or conflicting evidence (most fat burners,
       most nootropic stacks, most adaptogens at claimed doses).
     - Anything targeting a medical condition. The existing medical-advice
       guardrail still applies — condition-specific supplement questions
       ("ashwagandha for my anxiety", "magnesium for my RLS") route through
       the refusal path, not plan generation.

   Frame every recommendation with ONE evidence sentence ("creatine: meta-
   analyses show ~5-10% strength gain over 8-12 weeks"). Never more than a
   sentence.

   Let the user opt out. If their profile preferences or prior chat mentions
   indicate "no supplements," generate an empty supplements array.
   ```

4. **Fence shape** (parsed by `shared/widget-fence-parser.js`):

   ````
   ```meal-plan
   { "targets": {...}, "day_types": [...], "assignments": {...}, "provenance": {...} }
   ```
   ````

5. **Renderer:** new React component `shared/meal-plan-widget.js`, iframe-embedded, matches existing widget-token CSS. Displays:
   - Three target cards (training / rest / refeed) with kcal + 4 macros + fiber each
   - Day-type selector (tabs)
   - Meal cards for the selected day-type (meal name, foods with grams, per-meal kcal/macros)
   - Supplement stack card for the selected day-type (name, amount, timing)
   - **`[Save plan]`** → POSTs to `POST /api/emersus/meal-plans`
   - **`[Edit targets]`** → inline numeric inputs, recomputes macros, saves modified plan (this is the override half of hybrid target-setting)

### Plan save path — `api/emersus/meal-plans.js`

| Route | Purpose |
|---|---|
| `POST /api/emersus/meal-plans` | Validates plan against `shared/meal-plan-schema.js` (runtime Zod-style validator). Archives any existing active plan for this user by moving it into `previous_plan` on the new row. Inserts new row. Sets `source_thread_id` from originating chat thread. |
| `GET /api/emersus/meal-plans/active` | Returns user's active plan. |
| `PATCH /api/emersus/meal-plans/:id/assignments` | Updates `assignments.overrides` map only. Used by the assignments calendar UI for one-off day-type overrides. |
| `POST /api/emersus/meal-plans/:id/archive` | Sets `archived_at`. |
| `POST /api/emersus/meal-plans/:id/undo` | Swaps `plan` ↔ `previous_plan`. |

All handlers run with the user's JWT; RLS handles authorization. Pattern matches the workout-plan handler conventions.

### Chat-initiated journaling — `nutrition-log-confirm` widget

When `intent === 'log_food'`:

1. **Skip retrieval entirely.** Logging doesn't need PubMed context.

2. Call `parseFoodDescription(userMessage, { userId })`.

3. Infer missing `meal_slot` from current time of day (breakfast 5–10, mid_morning 10–12, lunch 12–15, afternoon 15–17, dinner 17–21, evening 21+). Supplement entries without meal_slot default to `supplements_am` or `supplements_pm` based on time. This inference is displayed in the widget and editable — never a silent write.

4. Emit a `nutrition-log-confirm` fence:
   ````
   ```nutrition-log-confirm
   { "parsed": {...}, "resolved_items": [...], "meal_slot": "lunch",
     "logged_date": "2026-04-11", "unresolved": [...] }
   ```
   ````

5. **Widget UI** (`shared/nutrition-log-confirm-widget.js`):
   - One row per resolved item with editable amount + amount_unit + meal_slot
   - Supplement rows are visually distinguished (different icon + subtle background tint)
   - Unresolved items show an inline search box ("chicken — couldn't match — pick one") with top-5 alternates
   - Totals line: kcal, protein, carbs, fat, fiber
   - Buttons: **`[Confirm log]`** · **`[Edit]`** · **`[Cancel]`**
   - On **Confirm**: POST to `POST /api/emersus/meal-journal/entries` with the full resolved item array. Server validates, writes rows with snapshots, returns success. Widget collapses to "Logged 4 items to lunch."

6. **Confirmation is mandatory in v1.** No silent writes from chat, ever. v1.5 can add a per-user profile flag for "auto-confirm when confidence > 0.9 for all items," but it is opt-in and post-ship.

7. **Rate limit:** max 10 chat-initiated log operations per user per minute via `api/emersus/rate-limit.js` (existing module).

8. **Guardrail interaction:** if the existing guardrail classifier tags the message as off-topic, medical, or crisis, the nutrition branches are never reached — the refusal path runs unmodified.

### Manual journaling UI (search-first modal)

For users who prefer clicking:

- **Search typeahead** hits `GET /api/emersus/foods/search?q=...&kind=food|supplement|any&limit=20`. Same FTS + trigram ranking as the parser. `kind` parameter lets the supplement tab filter to supplements.
- User picks a food → enters amount (grams for foods; amount + unit for supplements, with `common_unit` presets: "1 medium", "1 cup", "1 capsule", "1 scoop") → picks meal_slot (pre-filled from time) → POST.
- **`[Copy yesterday]`** — one-click clone of yesterday's entries for the selected meal_slot.
- **`[Quick add]`** — raw kcal + macros without picking a food. Stored with a synthetic "Manual entry" food row and `source = 'quick_add'`.
- **Inline edit** — tap a logged row, adjust amount, snapshots recompute server-side.
- **Delete** — self-explanatory.

### Write-path module — `api/emersus/meal-journal.js`

Mirrors `api/emersus/workout-logs.js`. Core exports:

```js
writeMealJournalEntries(userId, entries, { planId? })
deleteMealJournalEntry(userId, entryId)
updateMealJournalEntry(userId, entryId, patch)
copyMealJournalDay(userId, sourceDate, targetDate, { mealSlots? })
```

Snapshots are computed server-side in a single SQL CTE that joins `food_nutrients` for the five snapshotted nutrients (`energy_kcal`, `protein`, `carbohydrate`, `total_fat`, `fiber`) and multiplies each by the row's `amount`. Batched for multi-item writes from the chat parser — one transaction per confirmation.

### `workflow.js` integration summary

The existing file gains:

- `classifyNutritionIntent(text)` — the cheap regex classifier
- `NUTRITION_MEAL_PLAN_PROTOCOL` — system-prompt string injected when intent is `generate_plan`
- `NUTRITION_SUPPLEMENT_PROTOCOL` — appended to the meal plan protocol
- A branch after topic classification: if intent is `log_food`, short-circuit retrieval and call `parseFoodDescription` → emit `nutrition-log-confirm` fence
- A profile-gate helper that checks required nutrition fields and injects the "ask first" system hint when any are missing
- Fence recognition wiring for `meal-plan` and `nutrition-log-confirm` (via edits to `shared/widget-fence-parser.js` and `shared/emersus-renderer.js`)

The existing guardrail classifier remains upstream and gates all nutrition branches.

---

## Day-Type Resolution

**`shared/meal-plan-day-type.js`** — pure function, isomorphic (loaded via esm.sh in the browser, imported directly in Node).

```js
export function resolveDayType({ date, mealPlan, workoutPlan }) {
  // 1. Explicit override wins
  if (mealPlan?.assignments?.overrides?.[date]) {
    return mealPlan.assignments.overrides[date];
  }
  // 2. Auto-link to workout session calendar
  if (
    mealPlan?.assignments?.mode === 'auto_from_workout' &&
    hasWorkoutSessionOnDate(workoutPlan, date) &&
    dayTypeExists(mealPlan, 'training_day')
  ) {
    return 'training_day';
  }
  // 3. Default
  return mealPlan?.assignments?.default_day_type ?? 'rest_day';
}
```

**Used by:**
- `/app/nutrition/` today panel (what's today's day-type?)
- Chat plan-generation branch answering "what should I eat today?"
- `get_plan_adherence` and `get_nutrition_dashboard` RPCs (via the SQL sibling below)
- `nutrition-log-confirm` widget meal-slot inference

**SQL sibling:** `get_day_type_for_date(p_user_id uuid, p_date date)` in `supabase/20260413_nutrition_rpcs.sql` implements identical logic by reading the user's active `meal_plans.plan->'assignments'` and joining against `workout_plans.plan->'schedule'` for session lookup. A shared test fixture (`tests/fixtures/day-type-resolution.json`) covers both the JS and SQL implementations with the same input/output cases so they can't drift silently.

---

## Analytics RPCs

All Postgres functions. Every function sets `search_path = public, extensions` (per the `match_evidence_chunks` lesson — this is enforced by review).

| Function | Purpose |
|---|---|
| `get_nutrition_dashboard(p_user_id, p_date)` | Single call returning today's targets + actuals + progress % + per-meal breakdown + resolved day_type + supplement check-off status |
| `get_daily_journal(p_user_id, p_date)` | All journal entries for a day joined with food descriptions, grouped by meal_slot |
| `get_weekly_macro_averages(p_user_id, p_range_start, p_range_end)` | 7-day rolling macro averages per day over the range, for charting |
| `get_macro_hit_streak(p_user_id)` | Consecutive days where all 4 macros landed within ±10% of target. Returns `{current, best}`. |
| `get_micronutrient_status(p_user_id, p_date)` | Joins `meal_journal_entries` × `food_nutrients` × `nutrients` for the day. Returns all 25 non-macro nutrients with `amount`, `unit`, `dri_target`, `pct_dri`, `status` bucket (`under` · `ok` · `excess`), and a `from_food` / `from_supplement` split. |
| `get_top_foods(p_user_id, p_range_start, p_range_end, p_limit)` | Most-logged foods by frequency and by kcal contribution. Separate ranking for supplements. |
| `get_plan_adherence(p_user_id, p_plan_id, p_range_start, p_range_end)` | Two metrics: (a) meal-level adherence (% of prescribed meals that had a corresponding journal entry in that meal_slot on the right day_type), (b) macro-level adherence (avg % of target hit across kcal/P/C/F/fiber). Separately reports supplement adherence (% of prescribed supplements logged). |
| `get_day_type_for_date(p_user_id, p_date)` | SQL sibling of `shared/meal-plan-day-type.js` |

Error handling: all functions return `null` or empty arrays gracefully when the user has no active plan. RLS is enforced via the underlying tables (functions are `SECURITY INVOKER`).

---

## UI Structure — Option C

Two navigation changes:

1. **New single-page `/app/nutrition/`** — all active nutrition work (today + plan + journal + supplements) lives here, with internal React tab routing (no full navigations). State is preserved across tab switches.
2. **`/app/progress/` gains a top-level `[Workouts | Nutrition]` tab switcher.** The existing workout-progress view becomes the "Workouts" pane; a new nutrition analytics pane is added alongside.

**Food detail** is a slide-over drawer (right side, 420 px wide) that can open from any page, routed via `?food=<uuid>` query param for deep-linking.

### `/app/nutrition/` — the active page

**Top navigation (shared header):** "Nutrition" title, day-type pill badge ("Training day" / "Rest day" / "Refeed day"), link to `/app/progress/#nutrition`.

**Internal tabs** (React state, URL hash-synced `#today` `#plan` `#journal` `#supplements`):

#### Today tab (`#today`, default)

1. **Quick action strip** — `[Log food]` · `[Log supplement]` · `[Copy yesterday]` · `[Edit plan]`
2. **Macro ring row** — 5 SVG rings (kcal, protein, carbs, fat, fiber) showing actual / target. Gold glow if all 5 land within ±5% ("perfect hit").
3. **Meal timeline for today** — cards for each meal_slot that has entries OR is prescribed. Each card:
   - Slot name + aggregated kcal/macros for the slot
   - Logged items (tap to edit grams; tap trash to delete)
   - Prescribed-but-not-yet-logged items from today's day-type (ghosted, `[Log this]` button clones the prescription into a real entry)
   - `+ Add food` link
4. **Supplements today** — compact card showing today's supplement stack (prescribed from plan, ghosted until logged; logged in solid). One-tap check-off. Grouped by timing (morning → with-meal → pre/post-workout → bedtime).
5. **Micronutrient snapshot** — compact row: "22 / 25 micros at DRI today". Tap → opens the drawer to the micronutrient detail.

#### Plan tab (`#plan`)

1. **Header** — plan title, generation provenance shown on hover ("Based on 82 kg / 180 cm / 31 / male / moderate / cut / 2026-04-11 / gpt-5.4-mini").
2. **Day-type tabs** — Training · Rest · Refeed (nested tabs inside the Plan tab).
3. **Target card** for the selected day-type — kcal + 5 macros. `[Edit targets]` → inline numeric inputs; on save, PATCHes through the same save path, archiving prior version into `previous_plan`.
4. **Meal cards** — one per slot in the day-type. Prescribed foods with grams, per-meal totals. `[Swap]` button is a v1 placeholder; v1.5 opens a search modal for alternates.
5. **Supplement stack section** — separate card below the meal cards, grouped by timing. Each supplement: name, amount, unit, timing hint, one-line evidence sentence from the LLM generation.
6. **Action row** — `[Regenerate plan]` (opens chat with pre-filled prompt) · `[Archive plan]` · `[Undo last change]`.
7. **Assignments calendar** — month grid showing the resolved day-type for each date (inferred from `assignments.mode` + workout plan). Workout-session dots appear alongside for visual correlation. Click any date → override popover (`training_day` / `rest_day` / `refeed_day` / "clear override"), PATCHes `/api/emersus/meal-plans/:id/assignments`.

#### Journal tab (`#journal`)

1. **Date picker** — defaults to today; URL query `?date=` supported.
2. **Day totals card** — full-width, kcal + 5 macros for the selected day against resolved day-type targets.
3. **Meal sections** — one per meal_slot (enum order). Each section: slot name, per-slot totals, entry rows (food description, amount, per-entry kcal/macros, edit, delete), `[Add food]` per-slot.
4. **Supplements section** — at the bottom of each day, grouped by timing. Same row style as meal entries but with supplement-facts styling.
5. **Action row** — `[Log food]` (search modal) · `[Log supplement]` · `[Quick add]` · `[Copy day from...]` (date picker clones all entries from a source date).
6. **History sidebar** — last 14 days with % kcal target hit each, clickable. Hidden on mobile.

#### Supplements tab (`#supplements`)

A focused view — lets a user manage their supplement stack without navigating through the full plan view.

1. **Active stack** — today's prescribed supplements (if a plan exists) grouped by timing. Check-off each.
2. **Stack editor** — list of supplements in the active plan, editable inline: amount, timing. Changes PATCH through the plan save path.
3. **History** — compact chart showing supplement-adherence % over last 30 days.
4. **Add supplement** — search-first modal filtered to `kind = 'supplement'`.

### `/app/progress/` — analytics

Refactored to add a top-level `[Workouts | Nutrition]` tab switcher above the existing content. State in URL hash (`#workouts`, `#nutrition`), default `#workouts` for back-compat.

#### Workouts pane (`#workouts`)

The existing workout-tracking dashboard, unchanged except wrapped in the tab switcher.

#### Nutrition pane (`#nutrition`, new)

1. **Time range pills** — 4W / 8W / 12W / All (default 4W for nutrition since adherence trends move faster than training).
2. **Stat cards row (4-col)** — Macro adherence % · Streak (current / best) · Plan adherence % · Top food.
3. **Two-column layout:**
   - Left: **Weekly macro averages** — 5-series SVG bar chart (kcal, protein, carbs, fat, fiber) over the range. Colored per macro token.
   - Right: **Streak banner** — large card with current streak + best streak + "days until new best" progress bar.
4. **Two-column layout:**
   - Left: **Plan adherence** — two bars: meal-level % and macro-level % for the range, split by day-type. Includes supplement adherence below.
   - Right: **Top foods / top supplements** — tabs; most-logged items with frequency + kcal contribution.
5. **Micronutrient grid** — 25 non-macro nutrients, 3-col responsive grid, each card: nutrient name, unit, avg actual / DRI for the range, horizontal bar showing % DRI, green (80–150%), yellow (50–80% or 150–UL), red (<50% or >UL). Click any → drawer with daily values chart + top contributing foods + supplement split ("70% from food, 130% from supplements").

### Food / supplement detail drawer (`shared/food-detail-drawer.js`)

Slide-over drawer that can open from any page. Routed via `?food=<uuid>` query param.

**Food variant:**
1. Header — description, source badge, common unit info
2. **Nutrition label panel** — traditional FDA nutrition-facts layout generated from `food_nutrients`. Serving size selector (`100 g` · `1 medium` · `1 cup` · custom grams). Inline SVG, no image.
3. `[Log this food]` button → pre-selects the food in the log modal.
4. **My history** — mini bar sparkline of last-30-days log count.

**Supplement variant:**
1. Header — name, form pill (capsule / tablet / scoop), source badge
2. **Supplement-facts panel** — standard FDA dietary-supplement facts layout: serving size, active ingredients, % DV where applicable.
3. Same `[Log this supplement]` button + history.

Both variants share `shared/nutrition-charts.js` for the SVG helpers.

### Navigation: adding the Nutrition entry

`app/index.html` adds `Nutrition` alongside `Workouts` / `Progress` / `Profile` in the top nav. Link goes to `/app/nutrition/`. `/app/progress/` nav entry remains — when a user arrives from nutrition wanting trends, they land on the Nutrition tab via `#nutrition`.

### Visual design — unchanged from workout-tracking

- **Font:** Inter 400–700
- **Tokens:** `--bg #0c0e11`, `--ink #f9f9fd`, `--primary #6d9fff`, `--secondary #9ffb00`, `--danger #ff8f9d`, `--muted #a7adb4`, `--gold #FFD700`, plus new `--warm #f5b74a` for fat color-coding
- **Macro color coding:** kcal `--ink`, protein `--primary`, carbs `--secondary`, fat `--warm`, fiber `--muted`
- **Cards:** glass morphism — `backdrop-filter: blur(28px)`, gradient background, 1 px border, 24 px radius
- **Icons:** custom inline SVG (meal-slot icons, nutrient group icons, pill/capsule/scoop icons for supplement forms, trophy for streaks). **No emojis anywhere in the UI.**
- **Charts:** inline SVG only — rings, stacked bars, nutrition-label panels, sparklines, micronutrient grids. No charting library.
- **Responsive:** 2-col grids collapse to 1-col below 680 px. Max-width 900 px on the dashboard, 520 px on drill-downs, 420 px on the drawer.

---

## Supplements — Summary

Concentrated reference of how supplements are woven into the rest of the design. See the relevant sections above for the detail.

- **Schema:** polymorphic on `foods` via `kind = 'supplement'`, with `form` and `brand_name` as supplement-only optional columns. Supplement log rows live in `meal_journal_entries` just like food entries — same snapshot columns, same micronutrient join.
- **Seed:** `supabase/20260413_supplements_seed.sql` inserts ~60 curated generics as `foods` rows with `source='seed_supplement'`, plus their `food_nutrients` rows for active ingredients.
- **Plan JSONB:** each `day_types[i]` gets a `supplements` array alongside `meals`, with `food_id`, `description`, `amount`, `unit`, and a `timing` hint (`any` · `morning` · `with_meal` · `pre_workout` · `post_workout` · `bedtime`).
- **Meal slot enum additions:** `supplements_am`, `supplements_pm`.
- **LLM plan generation:** default-on, follows the conservative SUPPLEMENT PROTOCOL (evidence-only, no megadoses, no condition-specific dosing). User can opt out.
- **Chat parser:** distinguishes supplements from foods via the schema `kind` field; supplement shorthand (`supps`, `stack`, `took my`) routes to `intent = log_food`.
- **UI surfaces:**
  - Today tab — "Supplements today" card with one-tap check-off
  - Plan tab — dedicated supplement stack section per day-type, with timing groups and evidence sentences
  - Journal tab — supplements section at the bottom of each day
  - Supplements tab — focused management view
  - Food detail drawer — renders the supplement-facts layout variant for `kind='supplement'` rows
  - Progress nutrition pane — supplement adherence bar, top supplements list, micronutrient from-supplement split
- **Medical-advice guardrail:** unchanged. Supplement questions targeting specific conditions route through the existing refusal path, not plan generation.

---

## Migration Plan

All migrations applied via `infra/apply-migrations.sh` against the Hetzner Postgres using `-U supabase_admin` (per the known constraint on self-hosted Supabase — see `memory/project_supabase_admin_role.md`).

| Order | File | Purpose |
|---|---|---|
| 1 | `supabase/20260413_profile_nutrition_columns.sql` | Add `body_weight_kg`, `height_cm`, `date_of_birth`, `biological_sex`, `activity_level` to `profiles` |
| 2 | `supabase/20260413_nutrients.sql` | `nutrients` lookup table + seed 31 curated entries with FDC nutrient ID mapping + DRI defaults |
| 3 | `supabase/20260413_foods.sql` | `foods` table + `kind` / `form` / `brand_name` columns + indexes (unique `fdc_id`, GIN on `search_vector`, pg_trgm GIN on `description`, partial index on `created_by`) + RLS (public read for non-user rows, self-gated read/write for user-contributed). Also `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| 4 | `supabase/20260413_food_nutrients.sql` | `food_nutrients` join table + composite PK + secondary index + RLS via parent food |
| 5 | `supabase/20260413_meal_plans.sql` | `meal_plans` table mirroring `workout_plans` — columns, indexes (including unique partial for one-active-per-user), RLS, `updated_at` trigger |
| 6 | `supabase/20260413_meal_journal_entries.sql` | `meal_journal_entries` table + 5 snapshot columns + 4 indexes + RLS (self-only) |
| 7 | `supabase/20260413_nutrition_rpcs.sql` | All 9 Postgres functions (dashboard, journal, weekly averages, streak, micros, top foods, plan adherence, day-type resolver) — each with `SET search_path = public, extensions` |
| 8 | `supabase/20260413_supplements_seed.sql` | Insert ~60 curated supplement entries into `foods` (kind='supplement', source='seed_supplement') + corresponding `food_nutrients` rows |

**Post-migration one-time step:** run `scripts/import-usda-foods.js` on the Hetzner box to populate `foods` + `food_nutrients` with USDA FDC data.

---

## File Plan

| File | Action | Purpose |
|---|---|---|
| `supabase/20260413_profile_nutrition_columns.sql` | New | Profile columns for BMR/TDEE inputs |
| `supabase/20260413_nutrients.sql` | New | Nutrients lookup + 31-entry seed with FDC ID mapping + DRI defaults |
| `supabase/20260413_foods.sql` | New | Foods catalog table (with `kind` / `form` / `brand_name`) + indexes + RLS + `pg_trgm` extension |
| `supabase/20260413_food_nutrients.sql` | New | Food/nutrient join table + indexes + RLS via parent |
| `supabase/20260413_meal_plans.sql` | New | Meal plans table mirroring `workout_plans` |
| `supabase/20260413_meal_journal_entries.sql` | New | Journal log table + snapshot columns + indexes + RLS |
| `supabase/20260413_nutrition_rpcs.sql` | New | All 9 analytics + day-type resolver RPCs |
| `supabase/20260413_supplements_seed.sql` | New | Curated supplement seed rows |
| `scripts/import-usda-foods.js` | New | One-time USDA FDC import (Foundation + SR Legacy + FNDDS) |
| `api/emersus/meal-plans.js` | New | CRUD handlers for meal plans (save / archive / override / undo) |
| `api/emersus/meal-journal.js` | New | Write-path for journal entries with snapshot computation |
| `api/emersus/nutrition-parser.js` | New | LLM natural-language food/supplement parser + match pipeline |
| `api/emersus/foods-search.js` | New | `GET /api/emersus/foods/search` FTS + trigram endpoint with `kind` filter |
| `api/emersus/workflow.js` | Edit | Intent classifier; meal-plan generation protocol; log-food branch; profile gate; fence recognition wiring |
| `shared/meal-plan-schema.js` | New | Runtime validator for the `meal_plans.plan` JSONB shape (Zod-style) |
| `shared/meal-plan-day-type.js` | New | Isomorphic day-type resolver (JS sibling of the SQL RPC) |
| `shared/widget-fence-parser.js` | Edit | Recognize `meal-plan` and `nutrition-log-confirm` fences alongside existing types |
| `shared/emersus-renderer.js` | Edit | Wire new fence types to their React components |
| `shared/meal-plan-widget.js` | New | Meal plan display widget (targets, day-type tabs, meal cards, supplement stack card, save/edit) |
| `shared/nutrition-log-confirm-widget.js` | New | Journal confirmation widget for chat-parsed entries (food + supplement) |
| `shared/nutrition-charts.js` | New | SVG helpers: progress rings, macro bars, nutrition-label panel, supplement-facts panel, streak banner, micronutrient grid, sparklines |
| `shared/food-detail-drawer.js` | New | Slide-over food/supplement detail drawer, triggered via `?food=` query param |
| `shared/nutrition-today-panel.js` | New | Today tab composition (rings, meal timeline, supplements card, micro snapshot) |
| `shared/nutrition-plan-panel.js` | New | Plan tab composition (targets, meals, supplement stack, assignments calendar) |
| `shared/nutrition-journal-panel.js` | New | Journal tab composition (date picker, meal sections, supplements section, history) |
| `shared/nutrition-supplements-panel.js` | New | Supplements tab composition (active stack, editor, history, add flow) |
| `app/nutrition/index.html` | New | Single-page shell for `/app/nutrition/` |
| `app/nutrition/nutrition.js` | New | Composition root — React tab routing, wires the four panel modules + drawer |
| `app/progress/progress.js` | Edit | Add top-level `[Workouts | Nutrition]` tab switcher; wrap existing content in Workouts pane |
| `app/progress/nutrition-pane.js` | New | Nutrition analytics pane (trends, streak, plan adherence, top foods, micros grid) |
| `app/index.html` | Edit | Add `Nutrition` nav entry alongside `Workouts` / `Progress` / `Profile` |
| `docs/overview.md` | Edit | Add nutrition subsystem section |
| `docs/schema.md` | Edit | Document new tables, columns, RPCs, migration list |
| `docs/scripts.md` | Edit | Document the USDA import script |

---

## Open Questions / Risks

1. **Parser latency.** Each chat-initiated log operation incurs a dedicated OpenAI call for the parser on top of the main chat completion. Budget: ~1–2 s added latency at a cheaper model tier. If a user journals 5 times per day that is ~5 extra API calls. Acceptable at current scale; re-evaluate at 10 k DAU.
2. **DRI granularity.** The `default_dri_male` / `default_dri_female` split is a simplification — real DRIs vary by age bracket (14–18, 19–50, 51+) and life stage. v1 uses adult averages; v2 can add age-bracket logic.
3. **FNDDS mixed dishes.** USDA's Survey dataset includes prepared mixes like "Lasagna, meat, homemade" that have good data but can compete with component foods in matching. The source-tier tiebreaker (`usda_foundation` > `usda_sr_legacy` > `usda_fndds`) prefers components when scores are close. Acceptable trade-off.
4. **Restaurant chain gap.** Users will notice day one. Mitigation: in-UI helper text ("log individual components"), user-contributed foods path, roadmap mention. v1.5 adds real chain data via MenuStat (license-permitting) or polite crawls.
5. **`dietary_preferences` is still freeform text.** The LLM reads the existing field and honors "vegan" / "halal" / "no pork" / "lactose intolerant" in plan generation. Structured allergy/restriction enforcement (dangerous allergen flags, "do not show any food containing peanuts" hard filters) is deferred. v1 relies on LLM instruction-following.
6. **Progress dashboard refactor.** Adding the `[Workouts | Nutrition]` tab switcher is an edit to shipped code. Testing focus: the existing Workouts pane must continue to work exactly as today — no regressions in time-range pills, stat cards, chart rendering, or drill-down links. A visual regression check on `/app/progress/` is part of the merge checklist.
7. **USDA refresh cadence.** USDA ships FDC updates annually. No scheduled auto-refresh in v1 — we run `import-usda-foods.js` manually when we want the latest data.
8. **Supplement liability.** The supplement protocol in plan generation is conservative and evidence-gated, but it is not medical advice. The existing medical-advice guardrail continues to route condition-specific supplement questions through the refusal path. The design avoids dosing recommendations for anyone with a named condition.
9. **Production uses `gpt-5.4-mini`.** Per `memory/reference_production_openai_model.md`, the `OPENAI_EMERSUS_MODEL` env override is what production actually runs — the `workflow.js` default is `gpt-4.1-mini`. The parser uses a separate `OPENAI_EMERSUS_PARSER_MODEL` env with its own default, so they can be tuned independently.
10. **One active meal plan per user.** Matches workout-plan convention but may feel tight. Archived plans remain in the table, queryable; a future `/app/nutrition/plans/archive/` page can surface them read-only if users ask.

---

## Testing Plan

1. **Migration dry-runs** against a Hetzner staging database copy before applying to production.
2. **USDA import tested in staging** end-to-end; verify row counts match expectations and randomly sampled `food_nutrients` match the source FDC JSON.
3. **Day-type resolution test fixture** covers both `shared/meal-plan-day-type.js` and the SQL `get_day_type_for_date` RPC with the same input/output cases (override wins · auto-from-workout · default fallback · missing plan handling).
4. **Chat parser golden tests** — a fixture of ~30 realistic utterances ("I had a chicken caesar wrap and an iced coffee for lunch", "took my supps — 5 g creatine, 2000 IU vitamin D, 1 g omega-3", "log: 200 g rice, 150 g chicken, broccoli") with expected parse + match results. Run against the real model in CI gated by an env flag to avoid incidental API costs.
5. **RLS smoke tests** — user A can never read user B's meal plans, journal entries, or user-contributed foods. Attempted cross-user queries return zero rows.
6. **Snapshot immutability test** — create a journal entry, update the parent food row's nutrient values, verify the snapshot columns on the journal row are unchanged.
7. **Plan generation integration test** — with a complete profile, the chat returns a `meal-plan` fence whose JSON parses successfully against `shared/meal-plan-schema.js`; with a missing profile field, no fence is emitted and the assistant asks for the missing value.
8. **Progress dashboard regression check** — manual walkthrough of the workout-progress view on a fresh deploy to confirm the tab switcher refactor did not break existing charts, pills, drill-downs, or the session detail links.
9. **Supplement evidence gate smoke test** — ask the LLM for a "fat burner stack" and verify it refuses or returns a conservative protocol-compliant answer, not a megadose recommendation.
