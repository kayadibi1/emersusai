# Emersus — Architecture Overview

Deep-context reference. Read only when a task requires understanding a subsystem you don't already know. `CLAUDE.md` is the lightweight entry point.

## What it does
Emersus is an AI chat that synthesizes evidence-based workout and nutrition recommendations from a curated corpus of scientific literature (PubMed / PubMed Central). The LLM is grounded on vector-retrieved passages and emits prose plus inline interactive widgets (calculators, charts, workout calendars).

## Tech stack
| Layer | Choice |
|---|---|
| Frontend | React 18 via esm.sh (no build), vanilla JS, Lucide icons, Chart.js in sandboxed iframes |
| Landing hero | Three.js neuron animation (`script.js`) |
| Backend | Express 5 (`server.js`) mounting handlers from `api/` |
| Database | Self-hosted Supabase on Hetzner — Postgres 15 + pgvector + RLS, exposed at `https://supabase.emersus.ai` |
| LLM | OpenAI (default `gpt-4.1-mini`, configurable via `OPENAI_EMERSUS_MODEL`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Email | Resend (contact, waitlist, transactional) |
| Auth | Supabase Auth (email/password, Google OAuth, magic links) + email allowlist |
| Deploy | Hetzner VPS — Docker Compose stack from `infra/`, fronted by Caddy. No Vercel, no supabase.com. |

## Request flow (chat)
1. Client (`shared/react-chat-app.js`) posts chat message to `/api/emersus/recommendation-stream`.
2. Handler validates user, rate-limits by IP, builds conversation context.
3. `api/emersus/workflow.js` → `generateRecommendation()`:
   - Enforces guardrails (exercise-science topic lock, logged in `guardrail_events`).
   - Calls `retrieveDatabaseEvidence()` → Supabase RPC `match_knowledge_documents` (pgvector cosine search over `knowledge_documents`).
   - `rerank.js` dedupes and orders evidence.
   - Builds system prompt with evidence + widget-fence specification.
   - Streams OpenAI response.
4. `shared/emersus-renderer.js` parses `widget` and `workout-plan` fenced blocks, sanitizes HTML, emits iframes.
5. Client renders prose incrementally; widgets mount after the fence closes.
6. Token usage logged to `chat_token_usage_events`. Final plan (if any) saved to `workout_plans`.

## Key files
- `api/emersus/workflow.js` — orchestrator + LLM system prompt (~4200 lines). Also holds the onboarding flow and per-category block schemas for workout plan generation.
- `api/emersus/retrieveDatabaseEvidence.js` — pgvector query wrapper.
- `api/emersus/rerank.js` — dedup + scoring.
- `api/emersus/embeddings.js` — OpenAI embedding helper.
- `api/emersus/recommendation.js` / `recommendation-stream.js` — HTTP endpoints.
- `api/config.js` — serves public config to browsers (Supabase URL/anon key, Mapbox public token).
- `api/lib/clients.js` — initializes OpenAI + Supabase clients from env.
- `shared/react-chat-app.js` — chat UI, streaming reader, thread history.
- `shared/emersus-renderer.js` — widget fence parser.
- `shared/workout-plan-schema.js` — v1 JSON schema for workout plans + ICS export helpers.
- `shared/supabase.js` — browser-side Supabase client + auth helpers. Includes `upsertWorkoutLogs(userId, planId, plan, targetSessionId)` which enriches `completed_blocks` with `exercise_name` + authoritative `block_category` and calls the RPC.
- `shared/auth-pages.js` — login/signup forms.
- **Workout tracking layer** (`app/workout/**`, `app/progress/**`): resistance/bodyweight sessions use `app/workout/session/`; cardio with GPS → `app/workout/cardio/`; pool swim → `app/workout/swim/`; climbing → `app/workout/climb/`. Planner (`app/workout/workout.js`) routes by first block's exercise category via `sessionViewUrl()` + regex fallback. Progress dashboard (`app/progress/`) pulls RPC analytics and renders SVG charts.
- **Shared utility modules**: `unit-conversion.js` (kg/lbs + km/mi + load-string parsing), `mapbox.js` (polyline + static URL + privacy crop), `gps-tracker.js` (`watchPosition` wrapper with jitter filter and rolling pace), `climbing-grades.js` (V/YDS/Font/French grade systems + `hardestSent`), `share-card.js` (Canvas 2D renderer with 6 variants), `share-modal.js` (React modal with Web Share API), `exercise-icons.js` (SVG icons), `progress-charts.js` (SVG bar/line chart builders), `progress-helpers.js` (RPC wrappers).

## Environment variables
See `.env.example`. Required:
- `SUPABASE_URL` (= `https://supabase.emersus.ai`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- Browser-facing duplicates: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (served at runtime by `/api/config`)
- `OPENAI_API_KEY`, optional `OPENAI_EMERSUS_MODEL`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- Optional Emersus tuning: `EMERSUS_EVIDENCE_TABLE`, `EMERSUS_EVIDENCE_RPC`, `EMERSUS_EVIDENCE_LIMIT`
- Optional `MAPBOX_PUBLIC_TOKEN` — public Mapbox access token (URL-restricted to `emersus.ai/*` in the Mapbox dashboard). Powers the route-map image on the cardio share card via the Mapbox Static API. Missing token → cardio share card falls back to time-only layout (no map).

Env is loaded from `.env.local` (gitignored). The keys are JWTs signed by the Hetzner Supabase instance — not supabase.com tokens.

## Running locally
```
node server.js   # Express on http://127.0.0.1:3001, mounts /api/*
```
There is no separate dev database. Local dev hits the **production** Hetzner Supabase. Be careful with destructive operations and ingestion scripts.

## Deployment (single target)
**Hetzner VPS, Docker Compose stack from `infra/`** (untracked, local-only source of truth):
- `docker-compose.yml` — full self-hosted Supabase stack (Postgres, Kong, GoTrue, PostgREST, Studio, Realtime, Storage).
- `bootstrap.sh` / `apply-migrations.sh` — one-time setup and SQL application.
- `Caddyfile` — TLS reverse proxy. Public hostnames: `emersus.ai` (app), `supabase.emersus.ai` (Supabase API).
- `systemd/` — backup timers (see `infra/backup.sh`).
- `server.js` (repo root) is the Express entry deployed on the VPS.
- `generate-keys.mjs` — generated the JWT secrets, anon key, and service-role key for the self-hosted instance. Output captured in `infra/.env.generated`.

Deploy flow: edit locally → push to Hetzner (rsync/git pull) → restart Express + relevant containers.

## Guardrails & policy
- Topic lock: chat scope is restricted to exercise science. Enforced in `workflow.js`; violations logged to `guardrail_events` table.
- Email allowlist gates signup (see `supabase/20260408_email_provider_allowlist.sql`).
- Rate limiting by client IP in the stream handler.

## Nutrition subsystem (meal planning, journaling, supplements)

**Spec:** `docs/superpowers/specs/2026-04-11-meal-planning-journaling-design.md`
**Plan:** `docs/superpowers/plans/2026-04-11-meal-planning-journaling.md`

Symmetric dual plan + journal feature backed by USDA FoodData Central
(Foundation + SR Legacy + FNDDS + Branded, ~1.82 M foods total) plus a
curated ~40-entry supplement seed.

### Key modules

- `api/emersus/meal-plans.js` — CRUD handlers for `meal_plans`
- `api/emersus/meal-journal.js` — write path for `meal_journal_entries`
- `api/emersus/nutrition-parser.js` — separate OpenAI function-schema call
  that parses freeform food descriptions, with the foods-catalog match
  pipeline. Emits structured items for the `nutrition-log-confirm` widget.
- `api/emersus/foods-search.js` — `GET /api/emersus/foods/search` typeahead
- `api/emersus/rpc-proxy.js` — generic allowlisted RPC proxy for the browser
- `shared/meal-plan-day-type.js` — isomorphic day-type resolver with a
  SQL sibling (`resolve_day_type_from_jsonb`, `get_day_type_for_date`)
  locked to the same fixture
- `shared/meal-plan-schema.js` — zero-dep runtime validator for the plan JSONB

### Chat integration

Nutrition-topic messages pass through `classifyNutritionIntent()` in
`workflow.js`. `generate_plan` runs the normal retrieval path plus the
`MEAL_PLAN_GENERATION_PROTOCOL` system-prompt addendum and the
`SUPPLEMENT PROTOCOL` guardrail. `log_food` skips retrieval and goes
straight to the parser + a `nutrition-log-confirm` widget. Confirmation
is mandatory — no silent writes from chat in v1.

### UI

- `/app/nutrition/` single-page app with internal React tab routing:
  Today / Plan / Journal / Supplements. Food detail slides in as a
  drawer routed via `?food=<uuid>`.
- `/app/progress/` gained a top-level `[Workouts | Nutrition]` tab
  switcher. The Nutrition pane reads the analytics RPCs.

### Data model highlights

- `foods.kind` polymorphism (`food` / `supplement`) + `base_unit`
  (`100g` / `serving`) + `base_amount` for uniform snapshot math
- `food_nutrients.amount_per_base` — per-100g for foods, per-serving
  for discrete supplements
- `meal_journal_entries` snapshots `kcal`/`protein_g`/`carbs_g`/`fat_g`/
  `fiber_g` at write time (frozen forever; micronutrients joined at read)
- `meal_plans` mirrors `workout_plans` — JSONB plan, previous_plan for
  undo, one-active-per-user enforced via unique partial index
- Profile extended with `body_weight_kg`, `height_cm`, `date_of_birth`,
  `biological_sex`, `activity_level` for Mifflin-St Jeor inputs

## Frontend notes
- No bundler. Browser imports React/ReactDOM from esm.sh at runtime.
- Widgets render inside sandboxed `<iframe srcdoc>` — isolated from the host page.
- Landing page (`index.html` + `script.js`) is independent from the app (`app/`, `chat/`).
