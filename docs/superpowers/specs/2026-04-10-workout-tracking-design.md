# Workout Tracking — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Goal

Give users visibility into their training history and progress. Users already log sets during sessions (Phase 1.5); this feature lets them read that data back — session history, exercise progression, volume trends, PRs, adherence, and muscle group distribution. Supports resistance, cardio, and bodyweight exercise types.

## Scope

- Plan-only tracking for v1 (tied to LLM-generated plans). Freestyle logging deferred.
- Exercise catalog with matching pipeline (not LLM-slug-only).
- Denormalized `workout_logs` table as the queryable projection of `completed_blocks`.
- Dashboard + drill-down UI (not tabs, not single scroll).
- Inline SVG charts — no JS charting library, no build step.

### Out of scope

- Freestyle/manual workout creation
- Google Calendar sync
- Body weight / body composition tracking
- Social features, sharing, leaderboards
- Mobile native app

---

## Data Model

### `exercises` table (catalog)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `slug` | text UNIQUE | Canonical identifier, e.g. `barbell_back_squat` |
| `name` | text NOT NULL | Display name: "Barbell Back Squat" |
| `aliases` | text[] DEFAULT '{}' | Alternative names for matching: `{"BB Squat","Back Squat"}` |
| `muscle_groups` | text[] DEFAULT '{}' | `{"quads","glutes","hamstrings"}` — drives heatmap + volume-by-muscle |
| `equipment` | text | `barbell`, `dumbbell`, `cable`, `bodyweight`, `machine`, `cardio_machine`, `none` |
| `category` | text NOT NULL | `resistance`, `cardio`, `bodyweight` |
| `movement_type` | text | `compound`, `isolation`, `null` (cardio/bodyweight) |
| `auto_created` | boolean DEFAULT false | `true` when created by fuzzy-match fallback, flagged for manual review |
| `created_at` | timestamptz DEFAULT now() | |

Seeded with ~150-200 common exercises covering all three categories. Indexed on `slug` (unique), `category`.

### `workout_logs` table (flat projection)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | FK -> auth.users, RLS policy: users see only their own rows |
| `exercise_id` | uuid NOT NULL | FK -> exercises |
| `plan_id` | uuid | FK -> workout_plans, nullable (future freestyle) |
| `session_id` | text | e.g. `s_w1d1`, links back to plan session |
| `performed_at` | date NOT NULL | Date the session was done |
| `set_number` | smallint | 1-indexed within this exercise in this session. Null for cardio. |
| `reps` | smallint | Null for cardio |
| `load_kg` | numeric(6,2) | Weight in kg. Null for bodyweight/cardio. Display converts to user pref. |
| `rpe` | numeric(3,1) | Nullable |
| `duration_seconds` | integer | Cardio: total duration. Null for resistance. |
| `distance_meters` | numeric(10,2) | Cardio: total distance. Nullable. |
| `avg_heart_rate` | smallint | Cardio: average HR. Nullable. |
| `calories` | smallint | Cardio: estimated kcal. Nullable. |
| `notes` | text | Per-set or per-activity notes |
| `created_at` | timestamptz DEFAULT now() | |

**Indexes:**
- `(user_id, exercise_id, performed_at)` — exercise history queries
- `(user_id, performed_at)` — session timeline queries
- `(user_id, plan_id, session_id)` — link back to plan session

**RLS:** `user_id = auth.uid()` on SELECT, INSERT, UPDATE, DELETE.

### Write path

When `completed_blocks` is saved in the session view (`/app/workout/session/`), a server-side `upsertWorkoutLogs()` function:

1. Reads the `completed_blocks` array from the saved session.
2. For each block, resolves the exercise name to an `exercise_id` via the matching pipeline (see below).
3. Flattens actual_sets into individual `workout_logs` rows.
4. Upserts into `workout_logs` keyed on `(user_id, plan_id, session_id, exercise_id, set_number)`.

Source of truth remains `completed_blocks` JSONB in `workout_plans.plan`. `workout_logs` is the derived, queryable projection.

---

## Exercise Matching Pipeline

Runs server-side in `upsertWorkoutLogs()` when converting block names to `exercise_id`. No LLM call required.

1. **Exact match** — lowercase `block.name` against lowercase `exercises.name`.
2. **Alias match** — check `block.name` against all entries in `exercises.aliases` (case-insensitive).
3. **Fuzzy match** — Postgres `similarity()` via pg_trgm extension. Threshold >= 0.6 against `name` and unnested `aliases`. Take highest score.
4. **Auto-create** — if no match above threshold, insert a new catalog entry with the LLM's name as-is, `auto_created = true`, inferred `category` (default `resistance`). Flagged for manual review/merge.

**Caching:** Exercise name -> ID mappings cached in-memory per request (same exercise name appears in multiple sessions). No persistent cache needed.

**Forward compatibility:** The workout-plan block schema gains an optional `exercise_id` slug field. When the LLM emits it, the matching pipeline is skipped entirely. This allows gradual migration — old plans use matching, new plans use direct IDs. The LLM system prompt is updated to emit a `exercise_slug` alongside the display name.

---

## Analytics RPCs (Postgres functions)

All functions take `p_user_id uuid` and `p_range_start date` / `p_range_end date` parameters. Called from the frontend via Supabase RPC.

### `get_progress_dashboard(p_user_id, p_range_start, p_range_end)`

Returns a single JSON object. Note: `sessions_scheduled` is derived from the `workout_plans.plan` JSONB (counting sessions in the active plan within the date range), not from `workout_logs`.

```json
{
  "sessions_completed": 24,
  "sessions_scheduled": 28,
  "adherence_pct": 87,
  "total_volume_kg": 142000,
  "volume_change_pct": 12,
  "total_cardio_seconds": 30240,
  "cardio_session_count": 14,
  "pr_count": 5
}
```

### `get_weekly_activity(p_user_id, p_range_start, p_range_end)`

Returns array of weekly buckets:

```json
[
  { "week_start": "2026-02-17", "resistance_volume_kg": 18200, "cardio_duration_seconds": 3600 },
  ...
]
```

### `get_muscle_volume(p_user_id, p_range_start, p_range_end)`

Joins `workout_logs` with `exercises.muscle_groups`, unnests, aggregates:

```json
[
  { "muscle_group": "quads", "volume_kg": 32000 },
  { "muscle_group": "chest", "volume_kg": 28000 },
  ...
]
```

### `get_recent_sessions(p_user_id, p_limit)`

Returns recent sessions with summary stats:

```json
[
  {
    "plan_id": "...", "session_id": "s_w4d1", "session_title": "Upper Push",
    "performed_at": "2026-04-09", "category": "resistance",
    "exercise_count": 5, "volume_kg": 12400, "status": "completed"
  },
  ...
]
```

### `get_top_exercises(p_user_id, p_range_start, p_range_end, p_limit)`

Returns most-logged exercises with key stats:

```json
[
  {
    "exercise_id": "...", "slug": "barbell_back_squat", "name": "Barbell Back Squat",
    "category": "resistance", "session_count": 12,
    "best_load_kg": 130, "best_e1rm_kg": 145,
    "total_duration_seconds": null
  },
  ...
]
```

### `get_exercise_history(p_user_id, p_exercise_id, p_limit)`

Per-exercise session history:

```json
[
  {
    "performed_at": "2026-04-07", "set_count": 4,
    "best_set": { "load_kg": 130, "reps": 5 },
    "volume_kg": 4800, "e1rm_kg": 145
  },
  ...
]
```

### `get_session_detail(p_user_id, p_plan_id, p_session_id)`

Full session with all sets:

```json
{
  "session_title": "Lower Strength", "performed_at": "2026-04-07",
  "plan_title": "Upper/Lower Hypertrophy", "week": 4, "day_of_week": "Tuesday",
  "exercises": [
    {
      "exercise_name": "Barbell Back Squat", "category": "resistance",
      "volume_kg": 4800,
      "sets": [
        { "set_number": 1, "reps": 6, "load_kg": 120, "rpe": 7 },
        ...
      ]
    },
    ...
  ]
}
```

### `get_personal_records(p_user_id, p_range_start, p_range_end)`

Returns PRs hit within the time range:

```json
[
  {
    "exercise_name": "Bench Press", "slug": "bench_press",
    "pr_type": "e1rm", "value": 102, "unit": "kg",
    "achieved_at": "2026-04-09"
  },
  {
    "exercise_name": "5K Run", "slug": "running_5k",
    "pr_type": "best_time", "value": 1392, "unit": "seconds",
    "achieved_at": "2026-04-06"
  },
  ...
]
```

**e1RM formula:** Epley — `load_kg * (1 + reps / 30)`. Computed per set, max per session stored. For cardio PRs: best time for fixed distances, longest distance, highest avg pace.

---

## UI Structure

### Page hierarchy

```
/app/progress/                                    — Dashboard (main)
/app/progress/exercise/:slug                      — Exercise detail + history
/app/progress/session/?plan=<planId>&s=<sessionId> — Session detail (resistance or cardio)
```

Session detail is keyed on `plan_id + session_id` (matching the existing session view URL pattern), not a standalone ID.

All pages are static HTML + JS loaded via esm.sh React (consistent with existing app pages). No build step.

### Dashboard (`/app/progress/`)

Top to bottom:

1. **Page header** — "Progress" title + subtitle
2. **Active plan strip** — shows current plan name + week, links to `/app/workout/`
3. **Time range pills** — 4W / 8W / 12W / All (default: 8W)
4. **Stat cards row** (4-col grid, 2-col on mobile):
   - Sessions (count + adherence %)
   - Volume (total kg, formatted as tonnes + % change vs prior period)
   - Cardio (total hours + session count)
   - PRs (count in gold)
5. **Two-column layout:**
   - Left: **Weekly Activity** — stacked bar chart (resistance blue, cardio green), SVG rendered
   - Right: **Muscle Volume** — horizontal bar chart ranked by volume
6. **Two-column layout:**
   - Left: **Recent Sessions** — last 4-5 sessions, type dot + name + status + meta. Click -> session detail. "View all" scrolls to a full chronological session list at the bottom of the dashboard (lazy-loaded, paginated).
   - Right: **Top Exercises** — most-logged exercises with type icon, session count, primary stat (weight/e1RM for resistance, duration/distance for cardio). Click -> exercise detail.
7. **PR banner** — gold-bordered card, trophy icon, recent PRs with exercise + value + date

### Exercise detail (`/app/progress/exercise/:slug`)

1. **Back link** -> dashboard
2. **Header** — type icon + exercise name + muscle groups + category
3. **Mini stat cards** — best e1RM (or best time for cardio), heaviest set (or longest distance), total volume (or total duration)
4. **Weight progression chart** — SVG line chart, e1RM over time, PR points marked in gold. For cardio: pace or time chart.
5. **Session history table** — date, sets, best set, volume, e1RM per session. Rows link to session detail.

### Session detail (`/app/progress/session/:id`)

**Resistance sessions:**
1. **Back link** -> dashboard
2. **Header** — type dot + session title + date + plan context (week/day)
3. **Mini stat cards** — exercises, volume, duration, PRs
4. **Exercise blocks** — each exercise as a card with set rows (set number, weight x reps, RPE)

**Cardio sessions:**
1. Same header pattern, green type dot
2. **Cardio stat grid** — duration, distance, avg HR, avg speed, max HR, calories (2x3 grid)

### Planner page integration (`/app/workout/`)

- **Stats strip** below the plan header: sessions completed / total, total volume, adherence %. Compact, single row.
- **"View full progress"** link navigating to `/app/progress/`
- Session rows show volume badge alongside existing "N blocks logged" indicator

### Visual design

Matches existing Emersus app styling:
- **Font:** Inter throughout (400-700 weights). No mixing with Space Grotesk outside of existing patterns.
- **Colors:** `--bg: #0c0e11`, `--ink: #f9f9fd`, `--primary: #6d9fff`, `--secondary: #9ffb00`, `--danger: #ff8f9d`, `--muted: #a7adb4`, `--gold: #FFD700`
- **Cards:** Glass morphism — `backdrop-filter: blur(28px)`, gradient background, `border: 1px solid var(--line)`, `border-radius: 24px`
- **Exercise type icons:** Custom inline SVGs (dumbbell for resistance, heart-pulse for cardio, body figure for bodyweight, trophy for PRs). No emojis.
- **Color coding:** Blue (`--primary`) for resistance, green (`--secondary`) for cardio, muted for bodyweight, gold for PRs
- **Charts:** Inline SVG, no charting library. Bar charts and line charts with computed coordinates.
- **Responsive:** 2-col grids collapse to 1-col below 680px. Max-width 900px on dashboard, 520px on drill-downs.

---

## Backfill

A one-time Node script (`scripts/backfill-workout-logs.js`):

1. Fetches all `workout_plans` with non-empty `completed_blocks` in any session.
2. For each logged block, runs the exercise matching pipeline against the catalog.
3. Inserts `workout_logs` rows.
4. Reports: exercises matched, auto-created, total rows inserted.

Run once after deploying the migration. Safe to re-run (upsert on composite key).

---

## Migration Plan

1. `supabase/20260411_exercises.sql` — create `exercises` table + seed data
2. `supabase/20260411_workout_logs.sql` — create `workout_logs` table + indexes + RLS
3. `supabase/20260411_progress_rpcs.sql` — create all analytics Postgres functions
4. Enable `pg_trgm` extension if not already active (for fuzzy matching)

All applied via `infra/apply-migrations.sh` against the Hetzner Postgres using `supabase_admin`.

---

## File Plan

| File | Action | Purpose |
|------|--------|---------|
| `supabase/20260411_exercises.sql` | New | Exercises catalog table + seed |
| `supabase/20260411_workout_logs.sql` | New | Workout logs table + indexes + RLS |
| `supabase/20260411_progress_rpcs.sql` | New | Analytics Postgres functions |
| `api/emersus/workout-logs.js` | New | `upsertWorkoutLogs()`, exercise matching pipeline |
| `api/emersus/workflow.js` | Edit | Call `upsertWorkoutLogs()` on session save; add optional `exercise_slug` to block schema |
| `app/workout/session/session.js` | Edit | Trigger `upsertWorkoutLogs()` on save |
| `app/progress/index.html` | New | Progress dashboard page |
| `app/progress/progress.js` | New | Dashboard React component |
| `app/progress/exercise/index.html` | New | Exercise detail page |
| `app/progress/exercise/exercise.js` | New | Exercise detail React component |
| `app/progress/session/index.html` | New | Session detail page |
| `app/progress/session/session-detail.js` | New | Session detail React component |
| `shared/progress-charts.js` | New | SVG chart rendering helpers |
| `shared/exercise-matching.js` | New | Name -> exercise_id matching logic (shared with backfill) |
| `app/workout/workout.js` | Edit | Add stats strip + "View full progress" link |
| `scripts/backfill-workout-logs.js` | New | One-time backfill script |
| `scripts/seed-exercises.js` | New | Exercise catalog seed data (or inline in migration) |
