# Database schema reference

Source of truth is `supabase/*.sql` migrations. This file is a cheat sheet — if it disagrees with the SQL, the SQL wins. Update this file when you add/change a migration.

## Migrations (chronological)
| File | Adds |
|---|---|
| `supabase/waitlist.sql` | `waitlist` table (landing-page signups). |
| `supabase/20260402_auth_profiles_and_contact.sql` | User profile extensions + contact form storage. |
| `supabase/20260404_emersus_knowledge.sql` | `knowledge_documents` table + pgvector column + `match_knowledge_documents` RPC. |
| `supabase/20260405_guardrail_events.sql` | `guardrail_events` log table. |
| `supabase/20260406_chat_token_usage_events.sql` | `chat_token_usage_events` — per-request token accounting. |
| `supabase/20260408_email_provider_allowlist.sql` | Allowlist gating signup by email domain/provider. |
| `supabase/20260408_workout_plans.sql` | `workout_plans` — saved training plans (JSON v1 schema). |
| `supabase/20260408_chat_token_usage_cached.sql` | Adds `cached_prompt_tokens` column to `chat_token_usage_events`. |
| `supabase/20260409_guardrail_events_hard_refusal.sql` | Loosens `guardrail_events.event_type` CHECK to accept `hard_refusal`. |
| `supabase/20260409_match_evidence_chunks_search_path.sql` | Sets `search_path = public, extensions` on `match_evidence_chunks` RPC. |
| `supabase/20260410_guardrail_events_bot_cooldown.sql` | Adds `guardrail_cooldown` + `suspected_bot` event types; index on `(stable_user_id, created_at DESC)`. |
| `supabase/20260410_profile_extended_columns.sql` | Adds `primary_use_case`, `equipment_access`, `available_days_per_week`, `available_minutes_per_session`, `sleep_stress_context` to `profiles`. |
| `supabase/20260411_exercises.sql` | `exercises` catalog table (59 seeded) + `pg_trgm` + trigram GIN index on name for fuzzy matching. Public-readable RLS. |
| `supabase/20260411_workout_logs.sql` | `workout_logs` flat log table (per-set rows, cardio/swim rows with duration/distance) + `resolve_exercise_id(text)` (SECURITY DEFINER, exact→alias→fuzzy→auto-create) + `upsert_workout_logs` v1 RPC. |
| `supabase/20260411_progress_rpcs.sql` | 8 analytics RPCs: `get_progress_dashboard`, `get_weekly_activity`, `get_muscle_volume`, `get_recent_sessions`, `get_top_exercises`, `get_exercise_history`, `get_session_detail`, `get_personal_records`. All `SECURITY INVOKER` — RLS enforces user isolation. |
| `supabase/20260411_profile_weight_unit.sql` | Adds nullable `profiles.weight_unit` column (`kg`\|`lbs`) with CHECK constraint. Null = locale fallback. |
| `supabase/20260412_workout_logs_cardio_columns.sql` | Adds `gps_path jsonb`, `activity_type text`, `detail jsonb` to `workout_logs` + partial index on `(user_id, activity_type)`. |
| `supabase/20260412_exercises_expanded_categories.sql` | Extends `exercises.category` CHECK to include `swimming`, `climbing`, `hybrid`; seeds 6 swim + 4 climb exercises. |
| `supabase/20260412_profile_share_settings.sql` | Adds `display_name_public`, `mapbox_privacy_radius_m` (default 100), `default_pool_length_m`, `default_grade_system`, `preferred_sports text[]`, `distance_unit` to `profiles`. |
| `supabase/20260412_upsert_workout_logs_v2.sql` | Replaces `upsert_workout_logs` with a version that branches by `block_category` (client-provided, authoritative) into cardio/swimming/climbing/resistance paths. |
| `supabase/20260412_exercises_quadruple_seed.sql` | Seeds 211 additional exercises (Olympic lifts, kettlebell, calisthenics, plyometrics, strongman, bands, suspension, cable, machine, trap bar, landmine, core, cardio, sport drills, swimming drills, climbing, flexibility). New equipment values: `kettlebell`, `band`, `suspension`, `rings`, `sled`, `landmine`, `trap_bar`. |

## Key tables
- **`knowledge_documents`** — evidence corpus. Columns include source id, title, abstract/body text, topic tags, pgvector embedding. RLS enabled. Populated by the `scripts/fill-*` and `scripts/embed-evidence.js` pipelines.
- **`auth.users`** — Supabase managed. Signup gated by email allowlist.
- **`user_chat_threads`** — per-user chat history.
- **`workout_plans`** — structured plans produced by the chat; schema version tracked via `shared/workout-plan-schema.js`. `plan.sessions[].completed_blocks[]` is the source of truth for logged workout data (resistance sets, cardio gps_path, swim laps, climb routes).
- **`workout_logs`** — flat queryable projection of `completed_blocks`, populated by the `upsert_workout_logs` RPC on each session save. Resistance = one row per logged set. Cardio/swim = one row per block with `duration_seconds`, `distance_meters`, `gps_path`, `activity_type`. Climbing = one row per block with `detail = {style, routes: [...]}`. RLS enforces user isolation.
- **`exercises`** — canonical exercise catalog (280 seeded). Categories: `resistance`, `bodyweight`, `cardio`, `swimming`, `climbing`, `hybrid`. `auto_created=true` flag marks entries created by the fuzzy-match fallback for manual review. Public-readable; only `service_role` can mutate directly (regular users mutate via `resolve_exercise_id` SECURITY DEFINER helper).
- **`profiles`** — user preferences beyond auth. Includes onboarding-captured fields (goal, experience_level, equipment_access, etc.) plus unit preferences (`weight_unit`, `distance_unit`), sports (`preferred_sports text[]`), and share-card settings (`display_name_public`, `mapbox_privacy_radius_m`, `default_pool_length_m`, `default_grade_system`). Null values trigger locale-based defaults client-side.
- **`guardrail_events`** — guardrail trips and bot detection events. `event_type` values: `hard_refusal`, `guardrail_cooldown`, `suspected_bot` (plus legacy: `allowed_with_caution`, `medical_boundary`, `disallowed_unsafe`, `prompt_injection_or_system_probe`, `off_topic`). Sub-category detail in `reasons` JSONB column. Indexed on `(stable_user_id, created_at DESC)` for abuse review.
- **`chat_token_usage_events`** — prompt/completion token counts per request.
- **`waitlist`**, **`contact_messages`** — marketing/landing capture.

## RPCs
- **`public.match_knowledge_documents(query_embedding, match_count, …)`** — pgvector cosine similarity search. Called by `api/emersus/retrieveDatabaseEvidence.js`. Table/RPC names are overridable via `EMERSUS_EVIDENCE_TABLE` and `EMERSUS_EVIDENCE_RPC` env vars.
- **`public.resolve_exercise_id(p_name text) → uuid`** — exact name → alias → pg_trgm fuzzy (≥0.6) → auto-create fallback. SECURITY DEFINER so it can insert into `exercises` (restricted to service_role for regular users). Called internally by `upsert_workout_logs`.
- **`public.upsert_workout_logs(user_id, plan_id, session_id, performed_at, blocks jsonb) → jsonb`** — projects `completed_blocks` into flat `workout_logs` rows. SECURITY DEFINER with explicit `auth.uid()` guard. Branches by `block_category` field on each block (client-provided, authoritative) into cardio / swimming / climbing / resistance paths. Deletes existing rows for the session first, then re-inserts. Returns `{exercises_matched, rows_inserted}`. Called client-side after `applyManualWorkoutPlanEdit` succeeds (fire-and-forget).
- **Progress analytics RPCs** — all `SECURITY INVOKER` (RLS enforces user isolation). Called via `shared/progress-helpers.js` wrappers:
  - `get_progress_dashboard(user, range_start, range_end)` — summary card stats (sessions_completed, total_volume_kg, total_cardio_seconds, adherence_pct from plan JSONB, etc.)
  - `get_weekly_activity(user, range)` — weekly buckets of resistance volume + cardio duration
  - `get_muscle_volume(user, range)` — volume aggregated by unnested `exercises.muscle_groups`
  - `get_recent_sessions(user, limit)` — chronological sessions with `session_title` pulled from plan JSONB, volume, category detection
  - `get_top_exercises(user, range, limit)` — most-frequent exercises with best load / e1RM / cardio totals, branches by category
  - `get_exercise_history(user, exercise_id, limit)` — per-exercise session history for drill-down
  - `get_session_detail(user, plan_id, session_id)` — all log rows for a single session, flat structure (client groups by exercise)
  - `get_personal_records(user, range)` — e1RM PRs using Epley formula (`load × (1 + reps/30)`); cardio PRs deferred

## Nutrition subsystem tables (2026-04-13)

### `nutrients` (lookup)
31 curated entries: energy, macros (7), vitamins (13), minerals (10).
Seeded in `20260414_nutrients.sql`. `fdc_nutrient_id` maps to USDA FDC.

### `foods`
Polymorphic catalog (`kind in {food, supplement}`). ~1.82 M rows after
USDA import. Key columns: `fdc_id`, `description`, `source`, `kind`,
`base_unit`, `base_amount`, `brand_name`, `gtin_upc`, `ingredients_text`,
`data_points`, `search_vector` (generated).

Indexes: GIN on `search_vector` (typeahead), GIN trigram on
`description`, partial GIN trigram on `brand_name`, partial B-tree on
`gtin_upc`, composite `(kind, source)`.

RLS: public read for non-user rows; self-gated read/write for
`source = 'user_contributed'`.

### `food_nutrients`
`(food_id, nutrient_id, amount_per_base)`. Snapshot math:
`amount_per_base * entry.amount / foods.base_amount`.

### `meal_plans`
Mirrors `workout_plans`. JSONB `plan` + `previous_plan` for undo,
`archived_at` soft delete. Unique partial index on `(user_id) where
archived_at is null` enforces one active plan per user.

### `meal_journal_entries`
Per-item log rows. Macro snapshots (`kcal_snapshot`, `protein_g_snapshot`,
...) frozen at write time. Micronutrients aggregated at read time via
`food_nutrients` join. 5 indexes (user_date, user_food_date, user_plan_date,
user_slot_date, user_logged_at).

### Nutrition RPCs (all `SECURITY INVOKER`, `search_path = public, extensions`)

- `foods_search(text, text, boolean, int)`
- `insert_meal_journal_entries(jsonb)`
- `update_meal_journal_entry(uuid, numeric, text, text, text, numeric, text)`
- `copy_meal_journal_day(date, date, text[])`
- `get_nutrition_dashboard(date)`
- `get_daily_journal(date)`
- `get_weekly_macro_averages(date, date)`
- `get_macro_hit_streak()`
- `get_micronutrient_status(date)`
- `get_top_foods(date, date, int)`
- `get_plan_adherence(uuid, date, date)`
- `resolve_day_type_from_jsonb(date, jsonb, jsonb)` (test helper)

### Profile columns added

- `body_weight_kg numeric`
- `height_cm numeric`
- `date_of_birth date`
- `biological_sex text` CHECK (male, female, prefer_not_to_say)
- `activity_level text` CHECK (sedentary, light, moderate, active, very_active)

### Migration files (apply in order)

1. `20260414_profile_nutrition_columns.sql`
2. `20260414_nutrients.sql`
3. `20260414_foods.sql` (includes `foods_search` RPC)
4. `20260414_food_nutrients.sql`
5. `20260414_supplements_seed.sql`
6. `20260414_meal_plans.sql`
7. `20260414_meal_journal_entries.sql`
8. `20260414_meal_journal_rpcs.sql`
9. `20260414_nutrition_rpcs.sql`

## Where the database lives
The database is the **self-hosted Supabase Postgres on Hetzner**, exposed at `https://supabase.emersus.ai`. There is no supabase.com project. Apply migrations against this instance via `infra/apply-migrations.sh` or `infra/migrate/` (Docker-side wrapper scripts around the same `supabase/*.sql` files).
