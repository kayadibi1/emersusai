# Share Cards + Outdoor Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add post-workout share cards (Canvas 2D → PNG → Web Share API) plus three new session views (outdoor cardio with GPS, pool swimming, climbing) that don't fit the resistance training model.

**Architecture:** Thin shared modules (`share-card.js`, `gps-tracker.js`, `mapbox.js`, `share-modal.js`, `climbing-grades.js`) drive three new React pages (`cardio`, `swim`, `climb`) mounted the same way as the existing session view. Data flows into the existing `workout_plans.plan` JSONB on save, then into `workout_logs` via an updated `upsert_workout_logs` RPC that handles new block categories. Mapbox Static API renders the route map on cardio share cards. Profile settings gain a sharing & tracking section.

**Tech Stack:** React 18.2.0 via esm.sh, Canvas 2D API, Web Share API, `navigator.geolocation.watchPosition`, Mapbox Static API (HTTP only, no map library), Screen Wake Lock API, Supabase Postgres RPCs, pg_trgm, Inter font via FontFace API.

**Spec:** `docs/superpowers/specs/2026-04-10-share-cards-outdoor-tracking-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `supabase/20260412_workout_logs_cardio_columns.sql` | Adds gps_path, activity_type, detail columns to workout_logs |
| `supabase/20260412_exercises_expanded_categories.sql` | Expands category CHECK, seeds swim + climb exercises |
| `supabase/20260412_profile_share_settings.sql` | Adds share/tracking profile columns |
| `supabase/20260412_upsert_workout_logs_v2.sql` | Replaces upsert_workout_logs RPC to handle new categories |
| `shared/unit-conversion.js` | (MODIFY existing) add distance unit helpers |
| `shared/climbing-grades.js` | Grade system definitions + ordering comparator |
| `shared/mapbox.js` | Polyline encoder + Mapbox Static URL builder + privacy crop |
| `shared/gps-tracker.js` | watchPosition wrapper, jitter filter, Haversine distance, pause |
| `shared/share-card.js` | Canvas 2D renderer with 6 variant branches + font loading |
| `shared/share-modal.js` | React component — share modal used by all session views |
| `app/workout/cardio/index.html` | Cardio session HTML shell |
| `app/workout/cardio/cardio.js` | Cardio React component |
| `app/workout/swim/index.html` | Swim session HTML shell |
| `app/workout/swim/swim.js` | Swim React component |
| `app/workout/climb/index.html` | Climb session HTML shell |
| `app/workout/climb/climb.js` | Climb React component |

### Modified files

| File | Change |
|------|--------|
| `shared/supabase.js` | `upsertWorkoutLogs` routes to RPC with new category branches |
| `app/workout/workout.js` | Route "Start session" to correct view by first block's exercise category |
| `app/workout/session/session.js` | Add "Finish & share" button alongside existing Finish |
| `app/profile/index.html` | New sharing & tracking settings panel |
| `shared/app-pages.js` | Wire handlers for new profile fields |
| `api/emersus/workflow.js` | System prompt updates, onboarding additions, profile-update whitelist |
| `api/config.js` | Expose MAPBOX_PUBLIC_TOKEN in client config |
| `.env.example` | Add MAPBOX_PUBLIC_TOKEN placeholder |

---

## Task 1: DB migration — workout_logs cardio columns

**Files:**
- Create: `supabase/20260412_workout_logs_cardio_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Adds cardio/swim/climb support to workout_logs.
-- gps_path: array of {lat, lng, t, alt?} tuples for outdoor cardio.
-- activity_type: canonical string like 'running', 'swimming_freestyle', 'bouldering'.
-- detail: flexible JSONB for category-specific fields (climbing routes, swim lap_splits).

ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS gps_path jsonb,
  ADD COLUMN IF NOT EXISTS activity_type text,
  ADD COLUMN IF NOT EXISTS detail jsonb;

CREATE INDEX IF NOT EXISTS workout_logs_user_activity_type_idx
  ON public.workout_logs (user_id, activity_type)
  WHERE activity_type IS NOT NULL;
```

- [ ] **Step 2: Apply to production**

Run: `scp supabase/20260412_workout_logs_cardio_columns.sql hetzner:~/app/supabase/tmp_m1.sql && ssh hetzner 'cat ~/app/supabase/tmp_m1.sql | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 && rm ~/app/supabase/tmp_m1.sql'`
Expected: `ALTER TABLE\nCREATE INDEX`

- [ ] **Step 3: Verify columns exist**

Run: `ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"\d public.workout_logs\" | grep -E 'gps_path|activity_type|detail'"`
Expected: Three rows listing the new columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260412_workout_logs_cardio_columns.sql
git commit -m "feat: add gps_path, activity_type, detail to workout_logs"
```

---

## Task 2: DB migration — expanded exercise categories

**Files:**
- Create: `supabase/20260412_exercises_expanded_categories.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Expand the exercises.category CHECK to include swimming, climbing, hybrid.
-- Seed a minimal set of swim + climb exercises.

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_category_check;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_category_check
  CHECK (category IN ('resistance', 'cardio', 'bodyweight', 'swimming', 'climbing', 'hybrid'));

INSERT INTO public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) VALUES
  ('swimming_freestyle',    'Freestyle Swim',    '{"Freestyle","Front Crawl","Free"}', '{}', 'pool',  'swimming', null),
  ('swimming_backstroke',   'Backstroke',        '{"Back"}',                           '{}', 'pool',  'swimming', null),
  ('swimming_breaststroke', 'Breaststroke',      '{"Breast"}',                         '{}', 'pool',  'swimming', null),
  ('swimming_butterfly',    'Butterfly',         '{"Fly","Butterfly Swim"}',           '{}', 'pool',  'swimming', null),
  ('swimming_im',           'Individual Medley', '{"IM","Medley"}',                    '{}', 'pool',  'swimming', null),
  ('swimming_open_water',   'Open Water Swim',   '{"OWS"}',                            '{}', 'open',  'swimming', null),
  ('bouldering',            'Bouldering',        '{"Boulder"}',                        '{}', 'wall',  'climbing', null),
  ('sport_climbing',        'Sport Climbing',    '{"Lead","Sport Climb"}',             '{}', 'wall',  'climbing', null),
  ('top_rope_climbing',     'Top-rope Climbing', '{"Top Rope","TR"}',                  '{}', 'wall',  'climbing', null),
  ('trad_climbing',         'Trad Climbing',     '{"Trad"}',                           '{}', 'wall',  'climbing', null)
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Apply to production**

Run: `scp supabase/20260412_exercises_expanded_categories.sql hetzner:~/app/supabase/tmp_m2.sql && ssh hetzner 'cat ~/app/supabase/tmp_m2.sql | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 && rm ~/app/supabase/tmp_m2.sql'`
Expected: `ALTER TABLE\nALTER TABLE\nINSERT 0 10` (or fewer on re-run due to ON CONFLICT)

- [ ] **Step 3: Verify seeds**

Run: `ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*), category from public.exercises where category in ('swimming', 'climbing') group by category\""`
Expected: `swimming | 6` and `climbing | 4`

- [ ] **Step 4: Commit**

```bash
git add supabase/20260412_exercises_expanded_categories.sql
git commit -m "feat: expand exercise categories to include swimming and climbing"
```

---

## Task 3: DB migration — profile share settings

**Files:**
- Create: `supabase/20260412_profile_share_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Profile fields for share card display and tracking preferences.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name_public     text,
  ADD COLUMN IF NOT EXISTS mapbox_privacy_radius_m integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS default_pool_length_m   smallint,
  ADD COLUMN IF NOT EXISTS default_grade_system    text,
  ADD COLUMN IF NOT EXISTS preferred_sports        text[],
  ADD COLUMN IF NOT EXISTS distance_unit           text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_default_grade_system_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_default_grade_system_check
  CHECK (default_grade_system IS NULL OR default_grade_system IN ('V', 'YDS', 'Font', 'French'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_distance_unit_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_distance_unit_check
  CHECK (distance_unit IS NULL OR distance_unit IN ('km', 'mi'));
```

- [ ] **Step 2: Apply**

Run: `scp supabase/20260412_profile_share_settings.sql hetzner:~/app/supabase/tmp_m3.sql && ssh hetzner 'cat ~/app/supabase/tmp_m3.sql | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 && rm ~/app/supabase/tmp_m3.sql'`
Expected: `ALTER TABLE` (several times)

- [ ] **Step 3: Verify**

Run: `ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"\d public.profiles\" | grep -E 'display_name_public|mapbox_privacy|default_pool|default_grade|preferred_sports|distance_unit'"`
Expected: Six rows listing the new columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260412_profile_share_settings.sql
git commit -m "feat: add sharing and tracking preferences to profiles"
```

---

## Task 4: DB migration — upsert_workout_logs v2

**Files:**
- Create: `supabase/20260412_upsert_workout_logs_v2.sql`

Replaces the existing RPC with a version that handles resistance, cardio, swimming, climbing, and hybrid blocks.

- [ ] **Step 1: Write the migration**

```sql
-- v2: branches by block category to handle cardio/swim/climb.
-- Resistance path unchanged. New branches:
--   cardio   → one row with gps_path, distance_meters, activity_type, duration_seconds
--   swimming → one row with distance=lap_count*pool_length, activity_type, detail{pool_length_m,lap_count,lap_splits}
--   climbing → one row per session block with activity_type=style, detail={routes:[...]}

CREATE OR REPLACE FUNCTION public.upsert_workout_logs(
  p_user_id      uuid,
  p_plan_id      uuid,
  p_session_id   text,
  p_performed_at date,
  p_blocks       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block     jsonb;
  v_set       jsonb;
  v_ex_id     uuid;
  v_ex_name   text;
  v_category  text;
  v_set_num   int;
  v_matched   int := 0;
  v_inserted  int := 0;
BEGIN
  -- Auth guard: caller can only upsert their own logs
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch';
  END IF;

  -- Delete existing logs for this session to handle re-saves cleanly
  DELETE FROM public.workout_logs
  WHERE user_id = p_user_id
    AND plan_id = p_plan_id
    AND session_id = p_session_id;

  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    v_ex_name := v_block ->> 'exercise_name';
    IF v_ex_name IS NULL OR v_ex_name = '' THEN
      CONTINUE;
    END IF;

    v_ex_id := resolve_exercise_id(v_ex_name);
    SELECT category INTO v_category FROM public.exercises WHERE id = v_ex_id;
    v_matched := v_matched + 1;

    -- CARDIO branch
    IF v_category = 'cardio' OR v_block ? 'gps_path' OR v_block ? 'total_distance_m' THEN
      INSERT INTO public.workout_logs (
        user_id, exercise_id, plan_id, session_id, performed_at,
        duration_seconds, distance_meters, activity_type, gps_path, notes
      ) VALUES (
        p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
        (v_block ->> 'duration_seconds')::int,
        (v_block ->> 'total_distance_m')::numeric,
        v_block ->> 'activity_type',
        v_block -> 'gps_path',
        v_block ->> 'session_notes'
      );
      v_inserted := v_inserted + 1;

    -- SWIMMING branch
    ELSIF v_category = 'swimming' THEN
      INSERT INTO public.workout_logs (
        user_id, exercise_id, plan_id, session_id, performed_at,
        duration_seconds, distance_meters, activity_type, detail, notes
      ) VALUES (
        p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
        (v_block ->> 'duration_seconds')::int,
        COALESCE(
          (v_block ->> 'total_distance_m')::numeric,
          (v_block ->> 'lap_count')::numeric * (v_block ->> 'pool_length_m')::numeric
        ),
        'swimming_' || COALESCE(v_block ->> 'stroke_type', 'freestyle'),
        jsonb_build_object(
          'pool_length_m', (v_block ->> 'pool_length_m')::int,
          'lap_count',     (v_block ->> 'lap_count')::int,
          'stroke_type',   v_block ->> 'stroke_type',
          'lap_splits',    COALESCE(v_block -> 'lap_splits', '[]'::jsonb)
        ),
        v_block ->> 'session_notes'
      );
      v_inserted := v_inserted + 1;

    -- CLIMBING branch
    ELSIF v_category = 'climbing' THEN
      INSERT INTO public.workout_logs (
        user_id, exercise_id, plan_id, session_id, performed_at,
        duration_seconds, activity_type, detail, notes
      ) VALUES (
        p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
        (v_block ->> 'duration_seconds')::int,
        COALESCE(v_block ->> 'style', 'bouldering'),
        jsonb_build_object(
          'style',  v_block ->> 'style',
          'routes', COALESCE(v_block -> 'routes', '[]'::jsonb)
        ),
        v_block ->> 'session_notes'
      );
      v_inserted := v_inserted + 1;

    -- RESISTANCE / BODYWEIGHT branch (existing behavior)
    ELSE
      v_set_num := 0;
      FOR v_set IN SELECT * FROM jsonb_array_elements(
        COALESCE(v_block -> 'actual_sets', '[]'::jsonb)
      )
      LOOP
        IF (v_set ->> 'done')::boolean IS NOT TRUE THEN
          CONTINUE;
        END IF;

        v_set_num := v_set_num + 1;

        INSERT INTO public.workout_logs (
          user_id, exercise_id, plan_id, session_id, performed_at,
          set_number, reps, load_kg, rpe, notes
        ) VALUES (
          p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
          v_set_num,
          NULLIF(TRIM(v_set ->> 'reps'), '')::smallint,
          NULLIF(TRIM(v_set ->> 'load'), '')::numeric,
          NULLIF(TRIM(v_set ->> 'rpe'), '')::numeric,
          NULLIF(TRIM(v_set ->> 'notes'), '')
        );
        v_inserted := v_inserted + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'exercises_matched', v_matched,
    'rows_inserted', v_inserted
  );
END;
$$;
```

- [ ] **Step 2: Apply**

Run: `scp supabase/20260412_upsert_workout_logs_v2.sql hetzner:~/app/supabase/tmp_m4.sql && ssh hetzner 'cat ~/app/supabase/tmp_m4.sql | docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 && rm ~/app/supabase/tmp_m4.sql'`
Expected: `CREATE FUNCTION`

- [ ] **Step 3: Smoke test the cardio branch**

Run:
```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres <<'SQL'
-- Can't actually call auth.uid()-protected function without a real user, so just verify signature exists
SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'upsert_workout_logs';
SQL"
```
Expected: `p_user_id uuid, p_plan_id uuid, p_session_id text, p_performed_at date, p_blocks jsonb`

- [ ] **Step 4: Commit**

```bash
git add supabase/20260412_upsert_workout_logs_v2.sql
git commit -m "feat: upsert_workout_logs v2 handles cardio, swimming, climbing branches"
```

---

## Task 5: Mapbox helper module

**Files:**
- Create: `shared/mapbox.js`

Pure JS utility: polyline encoder (Google polyline algorithm), Mapbox Static URL builder, privacy crop function, Haversine distance.

- [ ] **Step 1: Write the module**

```javascript
// Mapbox helpers — polyline encoding, static API URL, privacy crop.
// Pure functions, no side effects.

const EARTH_RADIUS_M = 6371000;

/**
 * Haversine distance between two lat/lng points in meters.
 */
export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_M * c;
}

/**
 * Google polyline encoding algorithm. Takes [{lat,lng},...] returns a string.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function encodePolyline(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  let lat = 0;
  let lng = 0;
  let out = "";

  for (const p of points) {
    const latE5 = Math.round(p.lat * 1e5);
    const lngE5 = Math.round(p.lng * 1e5);
    out += encodeSigned(latE5 - lat);
    out += encodeSigned(lngE5 - lng);
    lat = latE5;
    lng = lngE5;
  }
  return out;
}

function encodeSigned(num) {
  let sgn = num < 0 ? ~(num << 1) : num << 1;
  let out = "";
  while (sgn >= 0x20) {
    out += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  out += String.fromCharCode(sgn + 63);
  return out;
}

/**
 * Crop the start and end of a GPS path by `radiusM` meters (privacy).
 * Returns a new array. If fewer than 2 points remain, returns [].
 */
export function privacyCrop(path, radiusM = 100) {
  if (!Array.isArray(path) || path.length < 2) return [];
  if (!radiusM || radiusM <= 0) return path.slice();

  // Forward walk: drop points until cumulative distance > radiusM
  let startIdx = 0;
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    cum += haversineMeters(path[i - 1], path[i]);
    if (cum > radiusM) {
      startIdx = i;
      break;
    }
  }

  // Backward walk: drop points from the end
  let endIdx = path.length - 1;
  cum = 0;
  for (let i = path.length - 2; i >= 0; i--) {
    cum += haversineMeters(path[i + 1], path[i]);
    if (cum > radiusM) {
      endIdx = i;
      break;
    }
  }

  if (endIdx <= startIdx + 1) return [];
  return path.slice(startIdx, endIdx + 1);
}

/**
 * Build a Mapbox Static API URL for the given path.
 * Returns null if path is too short to render.
 */
export function mapboxStaticUrl(path, token, { width = 900, height = 500 } = {}) {
  if (!token || !Array.isArray(path) || path.length < 2) return null;
  const encoded = encodeURIComponent(encodePolyline(path));
  const pathSpec = `path-5+9ffb00-0.85(${encoded})`;
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pathSpec}/auto/${width}x${height}@2x?access_token=${token}`;
}

/**
 * Compute total distance of a path in meters.
 */
export function pathTotalMeters(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i]);
  }
  return total;
}
```

- [ ] **Step 2: Smoke-test in Node**

Run:
```bash
node -e "
import('./shared/mapbox.js').then(m => {
  const path = [
    {lat: 40.7128, lng: -74.006},
    {lat: 40.7130, lng: -74.005},
    {lat: 40.7135, lng: -74.004},
    {lat: 40.7140, lng: -74.003},
    {lat: 40.7145, lng: -74.002},
  ];
  console.log('Total m:', m.pathTotalMeters(path).toFixed(1));
  console.log('Encoded:', m.encodePolyline(path));
  console.log('Cropped (50m):', m.privacyCrop(path, 50).length);
  console.log('URL:', m.mapboxStaticUrl(path, 'TEST_TOKEN').slice(0, 80));
});
"
```
Expected: distance around 200m, encoded polyline string, cropped array with some points, URL string starting with `https://api.mapbox.com/styles/`.

- [ ] **Step 3: Commit**

```bash
git add shared/mapbox.js
git commit -m "feat: add mapbox helpers — polyline encode, privacy crop, static URL"
```

---

## Task 6: GPS tracker module

**Files:**
- Create: `shared/gps-tracker.js`

Encapsulates `navigator.geolocation.watchPosition`, jitter filter, throttling, pause, distance computation.

- [ ] **Step 1: Write the module**

```javascript
// GPS tracker — wraps watchPosition with jitter filter and pause support.
// Emits accepted points via onPoint callback.

import { haversineMeters } from "/shared/mapbox.js";

const MIN_POINT_DELTA_M = 3;       // ignore points closer than 3m
const MAX_REASONABLE_SPEED = 50;   // m/s — drop implausible jumps
const MIN_INTERVAL_MS = 3000;      // throttle to one accepted point per 3s

/**
 * Start watching position.
 * @param {Object} opts
 * @param {(point: {lat, lng, t, alt?}, acc?: number) => void} opts.onPoint
 * @param {(err: GeolocationPositionError) => void} opts.onError
 * @returns {GpsTrackerHandle}
 */
export function startGpsTracker({ onPoint, onError }) {
  let watchId = null;
  let paused = false;
  let lastAcceptedPoint = null;
  let lastAcceptedAt = 0;
  let totalDistanceM = 0;
  let pauseMarkerPending = false;

  function handlePosition(pos) {
    if (paused) {
      pauseMarkerPending = true;
      return;
    }

    const now = Date.now();
    const point = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      t: now,
    };
    if (pos.coords.altitude != null) {
      point.alt = pos.coords.altitude;
    }

    // Throttle
    if (now - lastAcceptedAt < MIN_INTERVAL_MS) return;

    if (lastAcceptedPoint) {
      const distM = haversineMeters(lastAcceptedPoint, point);
      const dtS = (now - lastAcceptedPoint.t) / 1000;

      // Jitter filter
      if (distM < MIN_POINT_DELTA_M) return;
      if (dtS > 0 && distM / dtS > MAX_REASONABLE_SPEED) return;

      // If we were paused and this is the first point after resume,
      // mark the point and DON'T add the jump distance
      if (pauseMarkerPending) {
        point.pause_resume = true;
        pauseMarkerPending = false;
      } else {
        totalDistanceM += distM;
      }
    }

    lastAcceptedPoint = point;
    lastAcceptedAt = now;
    onPoint(point, pos.coords.accuracy);
  }

  function handleError(err) {
    if (onError) onError(err);
  }

  function start() {
    if (!("geolocation" in navigator)) {
      handleError(new Error("Geolocation API unavailable"));
      return;
    }
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
  }

  function stop() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function pause() {
    paused = true;
  }

  function resume() {
    paused = false;
  }

  function getTotalDistanceM() {
    return totalDistanceM;
  }

  start();

  return {
    stop,
    pause,
    resume,
    getTotalDistanceM,
    isPaused: () => paused,
  };
}

/**
 * Compute a rolling pace (seconds per km) over the last N seconds of a path.
 * Returns null if insufficient data.
 */
export function rollingPaceSecPerKm(path, windowSeconds = 30) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const now = path[path.length - 1].t;
  const cutoff = now - windowSeconds * 1000;

  // Find window start
  let startIdx = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].t <= cutoff) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === path.length - 1) return null;

  let distM = 0;
  for (let i = startIdx + 1; i < path.length; i++) {
    if (path[i].pause_resume) continue;
    distM += haversineMeters(path[i - 1], path[i]);
  }
  const elapsedS = (path[path.length - 1].t - path[startIdx].t) / 1000;
  if (distM < 5) return null; // too little data to estimate
  const secPerKm = elapsedS / (distM / 1000);
  return Math.round(secPerKm);
}

/**
 * Format pace in seconds per km as "M:SS" string.
 */
export function formatPace(secPerKm) {
  if (secPerKm == null || !isFinite(secPerKm)) return "--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/gps-tracker.js
git commit -m "feat: add GPS tracker with jitter filter and rolling pace"
```

---

## Task 7: Climbing grades module

**Files:**
- Create: `shared/climbing-grades.js`

- [ ] **Step 1: Write the module**

```javascript
// Climbing grade definitions and ordering.
// Per-system grade arrays in ascending difficulty order.
// No cross-system conversion in v1.

export const GRADE_SYSTEMS = {
  V: {
    label: "V-scale (bouldering)",
    grades: ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17"],
  },
  YDS: {
    label: "YDS (sport)",
    grades: [
      "5.6", "5.7", "5.8", "5.9",
      "5.10a", "5.10b", "5.10c", "5.10d",
      "5.11a", "5.11b", "5.11c", "5.11d",
      "5.12a", "5.12b", "5.12c", "5.12d",
      "5.13a", "5.13b", "5.13c", "5.13d",
      "5.14a", "5.14b", "5.14c", "5.14d",
      "5.15a", "5.15b", "5.15c", "5.15d",
    ],
  },
  Font: {
    label: "Fontainebleau (bouldering)",
    grades: [
      "3", "4", "4+", "5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+",
      "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+", "8C", "8C+", "9A",
    ],
  },
  French: {
    label: "French (sport)",
    grades: [
      "5", "5+", "6a", "6a+", "6b", "6b+", "6c", "6c+",
      "7a", "7a+", "7b", "7b+", "7c", "7c+",
      "8a", "8a+", "8b", "8b+", "8c", "8c+", "9a", "9a+", "9b",
    ],
  },
};

/**
 * Return grade index (higher = harder). Returns -1 if unknown.
 */
export function gradeIndex(grade, system) {
  const def = GRADE_SYSTEMS[system];
  if (!def) return -1;
  return def.grades.indexOf(grade);
}

/**
 * Compare two grades in the same system. Positive if a is harder.
 */
export function compareGrades(a, b, system) {
  return gradeIndex(a, system) - gradeIndex(b, system);
}

/**
 * Find the hardest grade from an array of {grade, send_type, grade_system}.
 * Only considers sends and flashes (not projects).
 */
export function hardestSent(routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const sent = routes.filter(r => r.send_type === "flash" || r.send_type === "send");
  if (sent.length === 0) return null;

  let hardest = sent[0];
  for (const r of sent.slice(1)) {
    if (r.grade_system !== hardest.grade_system) continue;
    if (compareGrades(r.grade, hardest.grade, r.grade_system) > 0) {
      hardest = r;
    }
  }
  return hardest;
}

/**
 * Map session style → default grade system.
 */
export function defaultSystemForStyle(style) {
  switch (style) {
    case "bouldering":
      return "V";
    case "sport_climbing":
    case "top_rope_climbing":
    case "trad_climbing":
      return "YDS";
    default:
      return "V";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/climbing-grades.js
git commit -m "feat: add climbing grade systems and ordering helpers"
```

---

## Task 8: Extend unit-conversion.js for distance

**Files:**
- Modify: `shared/unit-conversion.js`

The existing module handles kg/lbs. Add km/mi helpers and a resolver.

- [ ] **Step 1: Read existing file**

Run: read `shared/unit-conversion.js` to verify its current exports.

- [ ] **Step 2: Append distance helpers**

Add to the end of `shared/unit-conversion.js`:

```javascript

// ── Distance conversion (km / mi) ───────────────────────────────────

const KM_TO_MI = 0.621371;
const MI_TO_KM = 1.609344;

const MI_LOCALES = new Set(["en-US", "en-GB", "my-MM", "en-LR"]);

export function detectDistanceUnitFromLocale() {
  if (typeof navigator === "undefined") return "km";
  const lang = navigator.language || "";
  if (MI_LOCALES.has(lang)) return "mi";
  if (lang.startsWith("en-US") || lang.startsWith("en-GB")) return "mi";
  return "km";
}

export function resolveDistanceUnit(profileUnit) {
  if (profileUnit === "km" || profileUnit === "mi") return profileUnit;
  return detectDistanceUnitFromLocale();
}

export function metersToDisplay(m, unit) {
  if (m == null || isNaN(m)) return null;
  if (unit === "mi") return (m / 1000) * KM_TO_MI;
  return m / 1000;
}

/**
 * Format meters as "X.XX km" or "X.XX mi"
 */
export function formatDistance(m, unit, { decimals = 2 } = {}) {
  if (m == null || isNaN(m)) return "--";
  const value = metersToDisplay(m, unit);
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * Format pace (seconds per km) in user's unit as "M:SS /km" or "M:SS /mi"
 */
export function formatPaceUnit(secPerKm, unit) {
  if (secPerKm == null || !isFinite(secPerKm)) return `-- /${unit}`;
  const secInUnit = unit === "mi" ? secPerKm * MI_TO_KM : secPerKm;
  const m = Math.floor(secInUnit / 60);
  const s = Math.round(secInUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${unit}`;
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/unit-conversion.js
git commit -m "feat: add distance unit (km/mi) helpers to unit-conversion"
```

---

## Task 9: Share card renderer

**Files:**
- Create: `shared/share-card.js`

The big one. Canvas 2D renderer with all 6 variants in one file. ~600 lines.

- [ ] **Step 1: Write the module**

```javascript
// Share card Canvas renderer — 6 variants (gym, cardio+map, cardio time-only, swim, climb, hybrid).
// Exports renderShareCard(data, opts) → Promise<Blob>.
//
// Data shape varies by variant; common fields:
//   title, date, user_name, watermark, variant
// Variant-specific fields documented inline.

import { privacyCrop, mapboxStaticUrl } from "/shared/mapbox.js";
import { formatDistance, formatPaceUnit, formatWeight } from "/shared/unit-conversion.js";
import { hardestSent } from "/shared/climbing-grades.js";

const CARD_W = 1080;
const CARD_H = 1350;
const PAD = 80;

// ── Font loading ────────────────────────────────────────────────────

const FONT_URL_BASE = "https://fonts.gstatic.com/s/inter/v13/";
const FONTS_TO_LOAD = [
  { weight: 400, name: "Inter" },
  { weight: 600, name: "Inter" },
  { weight: 700, name: "Inter" },
  { weight: 800, name: "Inter" },
  { weight: 900, name: "Inter" },
];

let fontLoadPromise = null;
async function ensureFontsLoaded() {
  if (fontLoadPromise) return fontLoadPromise;
  fontLoadPromise = (async () => {
    // Use the FontFace API to force-load Inter via Google Fonts CSS import
    // The @font-face declarations are already available from the pages that load Inter,
    // but we explicitly call document.fonts.load() to ensure they're rasterized.
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all([
      document.fonts.load("400 16px Inter"),
      document.fonts.load("600 16px Inter"),
      document.fonts.load("700 16px Inter"),
      document.fonts.load("800 16px Inter"),
      document.fonts.load("900 16px Inter"),
    ]);
  })();
  return fontLoadPromise;
}

// ── Color constants ─────────────────────────────────────────────────

const COLORS = {
  bg: "#0c0e11",
  bgDark: "#161922",
  ink: "#f9f9fd",
  muted: "#a7adb4",
  primary: "#6d9fff",
  secondary: "#9ffb00",
  gold: "#FFD700",
  line: "rgba(255, 255, 255, 0.08)",
  lineHeavy: "rgba(255, 255, 255, 0.18)",
};

// ── Main entry ──────────────────────────────────────────────────────

/**
 * Render a share card and return a PNG blob.
 * @param {Object} data - card data (see variants below)
 * @param {Object} opts - { mapboxToken, weightUnit, distanceUnit }
 * @returns {Promise<Blob>}
 */
export async function renderShareCard(data, opts = {}) {
  await ensureFontsLoaded().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, data.variant);
  drawHeader(ctx, data);

  switch (data.variant) {
    case "gym":
      await drawGymBody(ctx, data, opts);
      break;
    case "cardio_map":
      await drawCardioBody(ctx, data, opts);
      break;
    case "cardio_time":
      drawCardioTimeBody(ctx, data, opts);
      break;
    case "swim":
      drawSwimBody(ctx, data, opts);
      break;
    case "climb":
      drawClimbBody(ctx, data, opts);
      break;
    case "hybrid":
      drawHybridBody(ctx, data, opts);
      break;
    default:
      throw new Error(`Unknown variant: ${data.variant}`);
  }

  drawFooter(ctx, data);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      "image/png",
      0.95
    );
  });
}

// ── Shared sections ─────────────────────────────────────────────────

function drawBackground(ctx, variant) {
  // Base fill
  const base = ctx.createLinearGradient(0, 0, 0, CARD_H);
  base.addColorStop(0, COLORS.bg);
  base.addColorStop(1, COLORS.bgDark);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Radial glows (different tints per variant)
  const topGlow = ctx.createRadialGradient(CARD_W * 0.2, 0, 0, CARD_W * 0.2, 0, CARD_W);
  const bottomGlow = ctx.createRadialGradient(CARD_W * 0.8, CARD_H, 0, CARD_W * 0.8, CARD_H, CARD_W);

  if (variant === "climb") {
    topGlow.addColorStop(0, "rgba(255, 215, 0, 0.18)");
    bottomGlow.addColorStop(0, "rgba(159, 251, 0, 0.14)");
  } else if (variant === "swim") {
    topGlow.addColorStop(0, "rgba(109, 159, 255, 0.38)");
    bottomGlow.addColorStop(0, "rgba(100, 200, 255, 0.18)");
  } else {
    topGlow.addColorStop(0, "rgba(109, 159, 255, 0.35)");
    bottomGlow.addColorStop(0, "rgba(159, 251, 0, 0.22)");
  }
  topGlow.addColorStop(1, "rgba(0,0,0,0)");
  bottomGlow.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = bottomGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawHeader(ctx, data) {
  // Brand strip
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("EMERSUS · SESSION LOG", PAD, PAD);

  // Kicker
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.fillText("COMPLETED", PAD, PAD + 110);

  // Title
  ctx.fillStyle = COLORS.ink;
  ctx.font = "900 90px Inter, system-ui, sans-serif";
  ctx.fillText(data.title || "Session", PAD, PAD + 150);

  // Date
  ctx.fillStyle = COLORS.muted;
  ctx.font = "500 28px Inter, system-ui, sans-serif";
  ctx.fillText(data.date || "", PAD, PAD + 260);
}

function drawFooter(ctx, data) {
  const y = CARD_H - PAD - 40;
  ctx.textBaseline = "top";

  // User name (left)
  if (data.user_name) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 24px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(data.user_name, PAD, y);
  }

  // Watermark (right)
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("emersus.ai", CARD_W - PAD, y + 2);
  ctx.textAlign = "left";
}

function drawHero(ctx, value, label, color = COLORS.secondary) {
  const y = PAD + 330;
  ctx.fillStyle = color;
  ctx.font = "900 180px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(value, PAD, y);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.fillText(label, PAD, y + 190);
}

function drawMiniRow(ctx, tiles) {
  const y = PAD + 590;
  const colWidth = (CARD_W - PAD * 2) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = PAD + i * colWidth;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 52px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(tile.value, x, y);

    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.fillText(tile.label, x, y + 70);
  });
}

function drawDivider(ctx, y) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_W - PAD, y);
  ctx.stroke();
}

// ── Gym variant ─────────────────────────────────────────────────────
// data.variant = "gym"
// data.total_volume_display, data.set_count, data.exercise_count, data.duration_display
// data.top_exercises = [{name, best_set_display, is_pr}]

async function drawGymBody(ctx, data, opts) {
  drawHero(ctx, data.total_volume_display || "0", "TOTAL VOLUME");
  drawMiniRow(ctx, [
    { value: String(data.set_count || 0), label: "SETS" },
    { value: String(data.exercise_count || 0), label: "EXERCISES" },
    { value: data.duration_display || "--", label: "DURATION" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Top exercises
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("TOP LIFTS", PAD, dividerY + 30);

  const exercises = (data.top_exercises || []).slice(0, 3);
  exercises.forEach((ex, i) => {
    const y = dividerY + 80 + i * 60;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "500 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ex.name || "", PAD, y);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    const valText = ex.best_set_display || "";
    ctx.fillText(valText, CARD_W - PAD, y);

    if (ex.is_pr) {
      ctx.fillStyle = COLORS.gold;
      ctx.font = "700 20px Inter, system-ui, sans-serif";
      const prX = CARD_W - PAD - ctx.measureText(valText).width - 20;
      ctx.fillText("PR", prX, y + 8);
    }

    ctx.textAlign = "left";
  });
}

// ── Cardio with map variant ─────────────────────────────────────────
// data.variant = "cardio_map"
// data.distance_display, data.duration_display, data.pace_display, data.activity_type
// data.gps_path (cropped)

async function drawCardioBody(ctx, data, opts) {
  drawHero(ctx, data.distance_display || "--", "DISTANCE");
  drawMiniRow(ctx, [
    { value: data.duration_display || "--", label: "TIME" },
    { value: data.pace_display || "--", label: "PACE" },
    { value: data.activity_label || "Cardio", label: "ACTIVITY" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Map section header
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("ROUTE", PAD, dividerY + 30);

  // Fetch and draw map
  const mapX = PAD;
  const mapY = dividerY + 80;
  const mapW = CARD_W - PAD * 2;
  const mapH = 280;

  const url = mapboxStaticUrl(data.gps_path || [], opts.mapboxToken, {
    width: 900,
    height: 500,
  });

  if (url) {
    try {
      const img = await fetchImage(url);
      ctx.save();
      roundRectPath(ctx, mapX, mapY, mapW, mapH, 20);
      ctx.clip();
      ctx.drawImage(img, mapX, mapY, mapW, mapH);
      ctx.restore();
    } catch (err) {
      // Fallback: draw a placeholder
      drawMapPlaceholder(ctx, mapX, mapY, mapW, mapH);
    }
  } else {
    drawMapPlaceholder(ctx, mapX, mapY, mapW, mapH);
  }
}

function drawMapPlaceholder(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRectPath(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 24px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Route map unavailable", x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

// ── Cardio time-only variant ───────────────────────────────────────
// data.variant = "cardio_time"
// data.duration_display, data.activity_label

function drawCardioTimeBody(ctx, data, opts) {
  drawHero(ctx, data.duration_display || "--", "DURATION");
  drawMiniRow(ctx, [
    { value: data.distance_display || "--", label: "DISTANCE" },
    { value: data.pace_display || "--", label: "PACE" },
    { value: data.activity_label || "Cardio", label: "ACTIVITY" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Large activity label centered
  ctx.fillStyle = COLORS.ink;
  ctx.font = "800 80px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(data.activity_label || "Cardio", CARD_W / 2, dividerY + 180);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

// ── Swim variant ────────────────────────────────────────────────────
// data.variant = "swim"
// data.distance_display, data.duration_display, data.pace_per_100m_display
// data.lap_count, data.pool_length_m, data.lap_splits, data.stroke_label

function drawSwimBody(ctx, data, opts) {
  drawHero(ctx, data.distance_display || "--", "DISTANCE");
  drawMiniRow(ctx, [
    { value: data.duration_display || "--", label: "TIME" },
    { value: data.pace_per_100m_display || "--", label: "/100m" },
    { value: `${data.lap_count || 0}`, label: `LAPS (${data.pool_length_m || "?"}m)` },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Lap splits bar chart
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("LAP SPLITS", PAD, dividerY + 30);

  const splits = data.lap_splits || [];
  if (splits.length > 0) {
    const chartX = PAD;
    const chartY = dividerY + 90;
    const chartW = CARD_W - PAD * 2;
    const chartH = 220;
    const maxSplit = Math.max(...splits);
    const minSplit = Math.min(...splits);
    const barW = Math.max(8, (chartW - 4 * (splits.length - 1)) / splits.length);

    splits.forEach((split, i) => {
      const barH = Math.max(6, ((split - minSplit * 0.6) / (maxSplit - minSplit * 0.6 + 0.01)) * chartH);
      const bx = chartX + i * (barW + 4);
      const by = chartY + chartH - barH;
      ctx.fillStyle = split === minSplit ? COLORS.gold : "rgba(109, 159, 255, 0.55)";
      ctx.fillRect(bx, by, barW, barH);
    });
  } else {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 24px Inter, system-ui, sans-serif";
    ctx.fillText("No lap splits recorded", PAD, dividerY + 150);
  }
}

// ── Climb variant ──────────────────────────────────────────────────
// data.variant = "climb"
// data.hardest_grade, data.total_routes, data.flash_count, data.style_label
// data.top_routes = [{grade, name?, send_type}]

function drawClimbBody(ctx, data, opts) {
  drawHero(ctx, data.hardest_grade || "--", "HARDEST SENT", COLORS.gold);
  drawMiniRow(ctx, [
    { value: String(data.total_routes || 0), label: "ROUTES" },
    { value: String(data.flash_count || 0), label: "FLASHES" },
    { value: data.style_label || "Climb", label: "STYLE" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Top sends list
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("TOP SENDS", PAD, dividerY + 30);

  const routes = (data.top_routes || []).slice(0, 3);
  routes.forEach((route, i) => {
    const y = dividerY + 80 + i * 60;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 40px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    const label = route.name ? `${route.grade} · ${route.name}` : route.grade;
    ctx.fillText(label, PAD, y);

    // Send type badge on right
    const badgeText = (route.send_type || "").toUpperCase();
    if (badgeText) {
      ctx.fillStyle =
        route.send_type === "flash"
          ? COLORS.secondary
          : route.send_type === "send"
          ? COLORS.primary
          : COLORS.muted;
      ctx.font = "800 20px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(badgeText, CARD_W - PAD, y + 10);
    }
    ctx.textAlign = "left";
  });
}

// ── Hybrid variant ─────────────────────────────────────────────────
// data.variant = "hybrid"
// data.total_volume_display, data.duration_display
// data.top_exercises = [{name, best_set_display}]

function drawHybridBody(ctx, data, opts) {
  // Two stacked heroes
  const y1 = PAD + 330;
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "900 130px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(data.duration_display || "--", PAD, y1);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText("DURATION", PAD, y1 + 140);

  const y2 = y1 + 200;
  ctx.fillStyle = COLORS.primary;
  ctx.font = "900 110px Inter, system-ui, sans-serif";
  ctx.fillText(data.total_volume_display || "--", PAD, y2);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText("TOTAL VOLUME", PAD, y2 + 120);

  const dividerY = PAD + 800;
  drawDivider(ctx, dividerY);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText("HIGHLIGHTS", PAD, dividerY + 30);

  const exercises = (data.top_exercises || []).slice(0, 3);
  exercises.forEach((ex, i) => {
    const y = dividerY + 80 + i * 54;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "500 30px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ex.name || "", PAD, y);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 30px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(ex.best_set_display || "", CARD_W - PAD, y);
    ctx.textAlign = "left";
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Image load failed"));
    img.src = url;
  });
}

// ── Data shaping helpers (used by session views) ──────────────────

/**
 * Build cardio card data from a session's completed_blocks.
 */
export function buildCardioCardData(session, completedBlock, profile, opts) {
  const distanceUnit = profile?.distance_unit || "km";
  const mapboxToken = opts?.mapboxToken;
  const privacyRadius = profile?.mapbox_privacy_radius_m ?? 100;

  const croppedPath = privacyCrop(completedBlock.gps_path || [], privacyRadius);
  const hasMap = mapboxToken && croppedPath.length >= 2;

  return {
    variant: hasMap ? "cardio_map" : "cardio_time",
    title: session.title || "Cardio",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    gps_path: croppedPath,
    distance_display: formatDistance(completedBlock.total_distance_m, distanceUnit, { decimals: 2 }),
    duration_display: formatDurationMMSS(completedBlock.duration_seconds),
    pace_display: completedBlock.avg_pace_sec_per_km
      ? formatPaceUnit(completedBlock.avg_pace_sec_per_km, distanceUnit)
      : "--",
    activity_label: labelForActivity(completedBlock.activity_type),
  };
}

export function buildSwimCardData(session, completedBlock, profile) {
  return {
    variant: "swim",
    title: session.title || "Swim",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    distance_display: `${completedBlock.total_distance_m || 0}m`,
    duration_display: formatDurationMMSS(completedBlock.duration_seconds),
    pace_per_100m_display: formatPace100m(completedBlock.duration_seconds, completedBlock.total_distance_m),
    lap_count: completedBlock.lap_count || 0,
    pool_length_m: completedBlock.pool_length_m || 25,
    lap_splits: completedBlock.lap_splits || [],
    stroke_label: labelForStroke(completedBlock.stroke_type),
  };
}

export function buildClimbCardData(session, completedBlock, profile) {
  const routes = completedBlock.routes || [];
  const sent = routes.filter(r => r.send_type === "flash" || r.send_type === "send");
  const hardest = hardestSent(routes);
  const flashes = routes.filter(r => r.send_type === "flash").length;

  const topRoutes = [...sent].sort((a, b) => {
    // Sort by grade index desc within same system
    if (a.grade_system !== b.grade_system) return 0;
    return b.grade.localeCompare(a.grade);
  }).slice(0, 3);

  return {
    variant: "climb",
    title: session.title || "Climb",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    hardest_grade: hardest?.grade || "--",
    total_routes: routes.length,
    flash_count: flashes,
    style_label: labelForClimbStyle(completedBlock.style),
    top_routes: topRoutes,
  };
}

export function buildGymCardData(session, profile, summary) {
  const weightUnit = profile?.weight_unit || "kg";
  return {
    variant: "gym",
    title: session.title || "Workout",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    total_volume_display: formatWeight(summary.totalVolumeKg, weightUnit, { decimals: 0 })
      .replace("kg", "kg")
      .replace("lbs", "lbs"),
    set_count: summary.setCount,
    exercise_count: summary.exerciseCount,
    duration_display: formatDurationMMSS(summary.durationSeconds),
    top_exercises: summary.topExercises,
  };
}

// ── Label helpers ───────────────────────────────────────────────────

function labelForActivity(type) {
  if (!type) return "Cardio";
  const map = {
    running: "Run",
    cycling: "Bike",
    walking: "Walk",
    hiking: "Hike",
  };
  return map[type] || "Cardio";
}

function labelForStroke(stroke) {
  if (!stroke) return "Swim";
  return stroke.charAt(0).toUpperCase() + stroke.slice(1);
}

function labelForClimbStyle(style) {
  if (!style) return "Climb";
  const map = {
    bouldering: "Boulder",
    sport_climbing: "Sport",
    top_rope_climbing: "Top-rope",
    trad_climbing: "Trad",
  };
  return map[style] || "Climb";
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function formatDurationMMSS(seconds) {
  if (!seconds || seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace100m(seconds, meters) {
  if (!seconds || !meters || meters < 100) return "--";
  const secPer100 = (seconds * 100) / meters;
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/share-card.js
git commit -m "feat: add Canvas 2D share card renderer with 6 variants"
```

---

## Task 10: Share modal component

**Files:**
- Create: `shared/share-modal.js`

React component used by all session views.

- [ ] **Step 1: Write the module**

```javascript
// Share modal — reusable React component for all session views.
// Renders a card preview, then Web Share API / Download / Copy / Close.

import React, { useEffect, useState } from "https://esm.sh/react@18.2.0";
import { renderShareCard } from "/shared/share-card.js";

const h = React.createElement;

/**
 * Props:
 *   cardData    — variant-specific data object for renderShareCard
 *   cardOpts    — { mapboxToken, weightUnit, distanceUnit }
 *   onClose     — function to call on dismiss
 */
export function ShareModal({ cardData, cardOpts, onClose }) {
  const [state, setState] = useState("rendering"); // rendering | ready | sharing | shared | error
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const resultBlob = await renderShareCard(cardData, cardOpts);
        if (cancelled) return;
        const url = URL.createObjectURL(resultBlob);
        setBlob(resultBlob);
        setPreviewUrl(url);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[share-modal] render failed:", err);
        setError(err.message || String(err));
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const filename = `${(cardData.title || "emersus").replace(/[^\w-]/g, "_")}.png`;

  async function doShare() {
    if (!blob) return;
    try {
      setState("sharing");
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: cardData.title,
          text: `${cardData.title}. Logged on emersus.ai`,
        });
        setState("shared");
        setTimeout(onClose, 1500);
      } else {
        doDownload();
        setState("ready");
      }
    } catch (err) {
      // User cancelled or share failed — return to ready
      setState("ready");
    }
  }

  function doDownload() {
    if (!blob || !previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function doCopy() {
    if (!blob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        // Flash a quick inline confirmation
        const btn = document.querySelector("[data-share-copy]");
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => { btn.textContent = orig; }, 1200);
        }
      }
    } catch (_err) {
      // Silent — some browsers block programmatic clipboard image writes
    }
  }

  const canShareFiles =
    typeof navigator !== "undefined" &&
    navigator.canShare &&
    navigator.canShare({ files: [new File([""], "test.png", { type: "image/png" })] });

  return h(
    "div",
    { className: "share-modal-backdrop", onClick: onClose },
    h(
      "div",
      { className: "share-modal", onClick: (e) => e.stopPropagation() },
      h("div", { className: "share-modal-title" },
        state === "rendering" ? "Generating card..." :
        state === "error" ? "Could not generate card" :
        state === "shared" ? "Shared!" : "Session saved. Share?"
      ),

      state === "rendering" &&
        h("div", { className: "share-modal-spinner" }, "…"),

      state === "error" &&
        h("div", { className: "share-modal-error" }, error || "Unknown error"),

      (state === "ready" || state === "sharing") && previewUrl &&
        h("img", { className: "share-modal-preview", src: previewUrl, alt: "Share card preview" }),

      (state === "ready") && h(
        "div",
        { className: "share-modal-buttons" },
        canShareFiles && h("button", { className: "share-btn-primary", onClick: doShare }, "Share"),
        h("button", { className: "share-btn-secondary", onClick: doDownload }, "Download"),
        h("button", {
          className: "share-btn-secondary",
          "data-share-copy": "",
          onClick: doCopy,
        }, "Copy to clipboard"),
        h("button", { className: "share-btn-tertiary", onClick: onClose }, "Close"),
      ),

      state === "error" && h(
        "div",
        { className: "share-modal-buttons" },
        h("button", { className: "share-btn-tertiary", onClick: onClose }, "Close"),
      ),
    )
  );
}

// CSS for the modal — callers should include this or equivalent
export const SHARE_MODAL_CSS = `
.share-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.share-modal {
  background: #0c0e11;
  border-radius: 20px;
  padding: 20px;
  max-width: 360px;
  width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  border: 1px solid rgba(255,255,255,0.08);
}
.share-modal-title {
  font-size: 0.95rem;
  font-weight: 700;
  text-align: center;
  color: #f9f9fd;
  margin-bottom: 14px;
}
.share-modal-spinner {
  text-align: center;
  padding: 40px 0;
  color: #a7adb4;
  font-size: 1.4rem;
}
.share-modal-error {
  color: #ff8f9d;
  text-align: center;
  padding: 20px 0;
  font-size: 0.85rem;
}
.share-modal-preview {
  width: 100%;
  border-radius: 12px;
  display: block;
  margin-bottom: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.share-modal-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share-btn-primary {
  background: linear-gradient(90deg, #85adff, #9ffb00);
  color: #0c0e11;
  font-weight: 800;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 14px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
}
.share-btn-secondary {
  background: rgba(255,255,255,0.04);
  color: #f9f9fd;
  font-weight: 700;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
}
.share-btn-tertiary {
  background: transparent;
  color: #a7adb4;
  font-size: 0.72rem;
  padding: 8px;
  border: none;
  cursor: pointer;
}
`;
```

- [ ] **Step 2: Commit**

```bash
git add shared/share-modal.js
git commit -m "feat: add reusable share modal component with Web Share API integration"
```

---

## Task 11: Cardio session view — HTML shell

**Files:**
- Create: `app/workout/cardio/index.html`

- [ ] **Step 1: Write the shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="robots" content="noindex">
  <title>Cardio Session | Emersus AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared/site.css">
  <style>
    body { background: var(--bg); color: var(--ink); font-family: Inter, system-ui, sans-serif; }
    .cardio-wrap { max-width: 480px; margin: 0 auto; padding: 24px 18px 140px; min-height: 100vh; display: flex; flex-direction: column; }
    .cardio-topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; font-size: 0.78rem; color: var(--muted); }
    .cardio-topbar a { color: var(--primary); text-decoration: none; }
    .title-field { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; }
    .title-field .label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); }
    .title-field input { background: transparent; border: none; color: var(--ink); font-size: 1.08rem; font-weight: 700; width: 100%; padding: 4px 0 0; outline: none; letter-spacing: -0.01em; }
    .chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .chip { padding: 8px 14px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; border: 1px solid var(--line); background: rgba(255,255,255,0.03); color: var(--muted); cursor: pointer; }
    .chip.active { background: rgba(159,251,0,0.14); border-color: rgba(159,251,0,0.38); color: var(--secondary); }
    .prescribed { background: rgba(109,159,255,0.07); border: 1px solid rgba(109,159,255,0.18); border-radius: 14px; padding: 12px 14px; margin-bottom: 18px; }
    .prescribed .label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--primary-dim); }
    .prescribed .target { font-size: 0.92rem; font-weight: 600; margin-top: 4px; color: var(--ink); }
    .big-btn { background: linear-gradient(90deg, #85adff, #9ffb00); color: #0c0e11; font-weight: 800; font-size: 0.84rem; text-transform: uppercase; letter-spacing: 0.15em; padding: 18px; border-radius: 999px; border: none; margin-top: auto; cursor: pointer; width: 100%; }
    .secondary-btn { background: rgba(255,255,255,0.04); color: var(--ink); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 999px; border: 1px solid var(--line); cursor: pointer; flex: 1; }
    .danger-btn { background: rgba(255,143,157,0.1); color: var(--danger); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 999px; border: 1px solid rgba(255,143,157,0.3); cursor: pointer; flex: 1; }
    .live-timer { font-size: 4.2rem; font-weight: 900; letter-spacing: -0.05em; text-align: center; margin: 18px 0 4px; font-variant-numeric: tabular-nums; }
    .live-timer-label { text-align: center; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 24px; }
    .live-stat-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 24px; }
    .live-stat { background: rgba(255,255,255,0.03); border: 1px solid var(--line); border-radius: 14px; padding: 14px 10px; text-align: center; }
    .live-stat-val { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--ink); }
    .live-stat-label { font-size: 0.56rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-top: 2px; }
    .live-btn-row { margin-top: auto; display: flex; gap: 10px; }
    .gps-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.64rem; color: var(--secondary); padding: 4px 10px; background: rgba(159,251,0,0.14); border-radius: 999px; }
    .gps-pill.warn { color: #ffbf54; background: rgba(255,191,84,0.1); }
    .gps-pill.error { color: var(--danger); background: rgba(255,143,157,0.1); }
    .gps-dot { width: 7px; height: 7px; background: currentColor; border-radius: 50%; }
    .banner { background: rgba(255,143,157,0.08); border: 1px solid rgba(255,143,157,0.22); color: var(--danger); padding: 10px 12px; border-radius: 10px; font-size: 0.78rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="cardio-wrap" id="cardio-root"></div>
  <script type="module" src="/app/workout/cardio/cardio.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add app/workout/cardio/index.html
git commit -m "feat: add cardio session HTML shell"
```

---

## Task 12: Cardio session view — React component

**Files:**
- Create: `app/workout/cardio/cardio.js`

- [ ] **Step 1: Write the component**

```javascript
import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getPublicConfig,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { startGpsTracker, rollingPaceSecPerKm, formatPace } from "/shared/gps-tracker.js";
import { formatDistance, formatPaceUnit, resolveDistanceUnit } from "/shared/unit-conversion.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildCardioCardData } from "/shared/share-card.js";

const h = React.createElement;

// Inject share modal CSS once
if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

// ── Utilities ─────────────────────────────────────────────────────

function readQuery() {
  const p = new URLSearchParams(window.location.search);
  return { planId: p.get("plan") || "", sessionId: p.get("session") || "" };
}

function formatTimer(seconds) {
  if (seconds == null) seconds = 0;
  const h2 = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h2 > 0) return `${h2}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ACTIVITY_CHIPS = [
  { id: "running", label: "Running" },
  { id: "cycling", label: "Cycling" },
  { id: "walking", label: "Walking" },
  { id: "hiking", label: "Hiking" },
];

// ── Pre-start screen ──────────────────────────────────────────────

function PreStart({ session, activityType, setActivityType, titleValue, setTitleValue, onStart }) {
  const prescribed =
    session?.blocks?.[0]?.load ||
    session?.blocks?.[0]?.notes ||
    `${session?.duration_minutes || "?"} min`;

  return h(
    React.Fragment,
    null,
    h("div", { className: "cardio-topbar" },
      h("a", { href: "/app/workout/" }, "← Back"),
      h("span", null, "")
    ),
    h("div", { className: "title-field" },
      h("div", { className: "label" }, "SESSION"),
      h("input", {
        type: "text",
        value: titleValue,
        onChange: (e) => setTitleValue(e.target.value),
        placeholder: "Session title",
      })
    ),
    h("div", { className: "chip-row" },
      ACTIVITY_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${activityType === c.id ? " active" : ""}`,
          onClick: () => setActivityType(c.id),
        }, c.label)
      )
    ),
    h("div", { className: "prescribed" },
      h("div", { className: "label" }, "PRESCRIBED"),
      h("div", { className: "target" }, prescribed)
    ),
    h("button", { className: "big-btn", onClick: onStart }, "Start")
  );
}

// ── Live screen ───────────────────────────────────────────────────

function LiveScreen({
  elapsedS, pathLength, totalDistanceM, currentPaceSec, avgPaceSec,
  distanceUnit, gpsState, paused, onPause, onResume, onFinish, gpsDenied,
}) {
  const gpsClass =
    gpsState === "locked" ? "" :
    gpsState === "warn" ? "warn" :
    gpsState === "error" ? "error" : "warn";

  const gpsLabel =
    gpsDenied ? "GPS unavailable" :
    gpsState === "locked" ? `GPS locked · ${pathLength} pts` :
    gpsState === "warn" ? "GPS weak" :
    "GPS searching...";

  return h(
    React.Fragment,
    null,
    h("div", { className: "cardio-topbar" },
      h("span", null, paused ? h("span", { style: { color: "var(--danger)" } }, "Paused") : ""),
      h("span", { className: `gps-pill ${gpsClass}` },
        h("span", { className: "gps-dot" }),
        gpsLabel
      )
    ),
    gpsDenied &&
      h("div", { className: "banner" }, "GPS permission denied — tracking time only. Switch to the planner to retry with GPS."),
    h("div", { className: "live-timer", style: paused ? { color: "var(--muted)" } : null },
      formatTimer(elapsedS)
    ),
    h("div", { className: "live-timer-label" }, paused ? "Paused" : "Duration"),
    h("div", { className: "live-stat-row" },
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          gpsDenied || totalDistanceM === 0 ? "--" : formatDistance(totalDistanceM, distanceUnit, { decimals: 2 })
        ),
        h("div", { className: "live-stat-label" }, distanceUnit)
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          paused || gpsDenied ? "--" : formatPace(currentPaceSec)
        ),
        h("div", { className: "live-stat-label" }, `/${distanceUnit}`)
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          gpsDenied ? "--" : formatPace(avgPaceSec)
        ),
        h("div", { className: "live-stat-label" }, "Avg")
      )
    ),
    h("div", { className: "live-btn-row" },
      paused
        ? h("button", { className: "big-btn", style: { margin: 0 }, onClick: onResume }, "Resume")
        : h("button", { className: "secondary-btn", onClick: onPause }, "Pause"),
      h("button", { className: "danger-btn", onClick: onFinish }, paused ? "Finish & share" : "Finish")
    )
  );
}

// ── Main component ────────────────────────────────────────────────

function CardioSessionView({ session: authSession, planRow, sessionIndex, profile, config }) {
  const planRef = useRef(planRow);
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart"); // prestart | live | finishing
  const [titleValue, setTitleValue] = useState(targetSession.title || "Cardio");
  const [activityType, setActivityType] = useState(
    targetSession.blocks?.[0]?.activity_type || "running"
  );

  // Live state
  const [startedAt, setStartedAt] = useState(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [pauseStart, setPauseStart] = useState(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [gpsPath, setGpsPath] = useState([]);
  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(null);
  const [gpsState, setGpsState] = useState("searching");
  const [gpsDenied, setGpsDenied] = useState(false);
  const [paused, setPaused] = useState(false);

  const trackerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Share modal state
  const [shareCardData, setShareCardData] = useState(null);
  const [shareCardOpts, setShareCardOpts] = useState(null);

  const distanceUnit = useMemo(
    () => resolveDistanceUnit(profile?.distance_unit),
    [profile]
  );

  // Timer tick
  useEffect(() => {
    if (phase !== "live" || paused || !startedAt) return;
    const id = setInterval(() => {
      const now = Date.now();
      const total = (now - startedAt - pausedSeconds * 1000) / 1000;
      setElapsedS(Math.max(0, total));

      // Rolling pace
      const rp = rollingPaceSecPerKm(gpsPath, 30);
      setCurrentPaceSec(rp);
    }, 1000);
    return () => clearInterval(id);
  }, [phase, paused, startedAt, pausedSeconds, gpsPath]);

  // Avg pace
  const avgPaceSec = useMemo(() => {
    if (!totalDistanceM || totalDistanceM < 5 || !elapsedS) return null;
    return Math.round(elapsedS / (totalDistanceM / 1000));
  }, [totalDistanceM, elapsedS]);

  // Crash-recovery persistence
  useEffect(() => {
    if (phase !== "live") return;
    const key = `cardio_session:${planRow.id}:${targetSession.id}`;
    const t = setInterval(() => {
      localStorage.setItem(key, JSON.stringify({
        startedAt, pausedSeconds, gpsPath, totalDistanceM, activityType, titleValue,
      }));
    }, 10000);
    return () => clearInterval(t);
  }, [phase, startedAt, pausedSeconds, gpsPath, totalDistanceM, activityType, titleValue]);

  const startTracking = useCallback(async () => {
    // Request wake lock
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch (_e) {}
    }

    // Start GPS tracker
    trackerRef.current = startGpsTracker({
      onPoint: (point) => {
        setGpsPath((p) => [...p, point]);
        setGpsState("locked");
        setTotalDistanceM(trackerRef.current?.getTotalDistanceM() || 0);
      },
      onError: (err) => {
        if (err?.code === 1) {
          setGpsDenied(true);
          setGpsState("error");
        } else {
          setGpsState("warn");
        }
      },
    });

    setStartedAt(Date.now());
    setPhase("live");
  }, []);

  const onPause = useCallback(() => {
    setPaused(true);
    setPauseStart(Date.now());
    trackerRef.current?.pause();
  }, []);

  const onResume = useCallback(() => {
    if (pauseStart) {
      setPausedSeconds((p) => p + Math.round((Date.now() - pauseStart) / 1000));
    }
    setPauseStart(null);
    setPaused(false);
    trackerRef.current?.resume();
  }, [pauseStart]);

  const onFinish = useCallback(async () => {
    trackerRef.current?.stop();
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch (_e) {}
      wakeLockRef.current = null;
    }

    const durationSec = Math.round(
      (Date.now() - startedAt - pausedSeconds * 1000) / 1000
    );

    // Build completed block
    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      activity_type: activityType,
      gps_path: gpsPath,
      total_distance_m: Math.round(totalDistanceM * 100) / 100,
      duration_seconds: durationSec,
      paused_seconds: pausedSeconds,
      avg_pace_sec_per_km: totalDistanceM > 5 ? Math.round(durationSec / (totalDistanceM / 1000)) : null,
      logged_at: new Date().toISOString(),
      session_notes: "",
    };

    // Update plan
    const nextPlan = {
      ...plan,
      sessions: plan.sessions.map((s, idx) => {
        if (idx !== sessionIndex) return s;
        return {
          ...s,
          title: titleValue,
          completion_status: "completed",
          completed_blocks: [completedBlock],
        };
      }),
    };

    await applyManualWorkoutPlanEdit(authSession.user.id, planRow.id, nextPlan);
    upsertWorkoutLogs(authSession.user.id, planRow.id, nextPlan, targetSession.id).catch((e) =>
      console.error("[cardio] log sync", e)
    );

    // Clear localStorage crash recovery
    localStorage.removeItem(`cardio_session:${planRow.id}:${targetSession.id}`);

    // Build share card data
    const cardData = buildCardioCardData(
      { title: titleValue },
      completedBlock,
      profile,
      { mapboxToken: config?.mapboxPublicToken }
    );
    setShareCardData(cardData);
    setShareCardOpts({ mapboxToken: config?.mapboxPublicToken });
  }, [
    startedAt, pausedSeconds, gpsPath, totalDistanceM, activityType, titleValue,
    plan, sessionIndex, firstBlockId, planRow.id, targetSession.id, authSession.user.id, profile, config,
  ]);

  const onShareClose = useCallback(() => {
    window.location.href = "/app/workout/";
  }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(PreStart, {
      session: targetSession,
      activityType,
      setActivityType,
      titleValue,
      setTitleValue,
      onStart: startTracking,
    }),
    phase === "live" && h(LiveScreen, {
      elapsedS,
      pathLength: gpsPath.length,
      totalDistanceM,
      currentPaceSec,
      avgPaceSec,
      distanceUnit,
      gpsState,
      paused,
      gpsDenied,
      onPause,
      onResume,
      onFinish,
    }),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: shareCardOpts,
      onClose: onShareClose,
    })
  );
}

// ── Boot ──────────────────────────────────────────────────────────

async function boot() {
  const rootEl = document.getElementById("cardio-root");
  if (!rootEl) return;

  const { planId, sessionId } = readQuery();
  if (!planId || !sessionId) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Missing plan/session. <a href="/app/workout/">Back</a></div>';
    return;
  }

  const session = await requireAuth();
  if (!session) return;

  const planRow = await getWorkoutPlan(planId);
  if (!planRow) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Plan not found.</div>';
    return;
  }
  if (planRow.user_id !== session.user.id) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Not your plan.</div>';
    return;
  }

  const sessionIndex = (planRow.plan.sessions || []).findIndex((s) => s && s.id === sessionId);
  if (sessionIndex < 0) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Session not found in plan.</div>';
    return;
  }

  const profile = await getProfile(session.user.id);
  let config = null;
  try {
    config = await getPublicConfig();
  } catch (_e) {}

  const root = createRoot(rootEl);
  root.render(h(CardioSessionView, { session, planRow, sessionIndex, profile, config }));
}

boot().catch((err) => {
  console.error("[cardio] boot failed:", err);
  const el = document.getElementById("cardio-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed to load session.</div>';
});
```

- [ ] **Step 2: Verify Supabase helper `getPublicConfig` is exported**

Run: grep `shared/supabase.js` for `getPublicConfig`. If not present, add:

```javascript
export async function getPublicConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("config fetch failed");
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add app/workout/cardio/index.html app/workout/cardio/cardio.js shared/supabase.js
git commit -m "feat: cardio session view — pre-start, live tracking, finish & share"
```

---

## Task 13: Swim session view

**Files:**
- Create: `app/workout/swim/index.html`
- Create: `app/workout/swim/swim.js`

- [ ] **Step 1: Write the HTML shell**

Create `app/workout/swim/index.html` — identical to the cardio shell but:
- Title: `Swim Session | Emersus AI`
- Root id: `swim-root`
- Script: `/app/workout/swim/swim.js`
- Add CSS (same base + swim-specific):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="robots" content="noindex">
  <title>Swim Session | Emersus AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared/site.css">
  <style>
    body { background: var(--bg); color: var(--ink); font-family: Inter, system-ui, sans-serif; }
    .swim-wrap { max-width: 480px; margin: 0 auto; padding: 24px 18px 140px; min-height: 100vh; display: flex; flex-direction: column; }
    .swim-topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; font-size: 0.78rem; color: var(--muted); }
    .swim-topbar a { color: var(--primary); text-decoration: none; }
    .title-field { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; }
    .title-field .label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); }
    .title-field input { background: transparent; border: none; color: var(--ink); font-size: 1.08rem; font-weight: 700; width: 100%; padding: 4px 0 0; outline: none; }
    .chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .chip { padding: 8px 14px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; border: 1px solid var(--line); background: rgba(255,255,255,0.03); color: var(--muted); cursor: pointer; }
    .chip.active { background: rgba(159,251,0,0.14); border-color: rgba(159,251,0,0.38); color: var(--secondary); }
    .prescribed { background: rgba(109,159,255,0.07); border: 1px solid rgba(109,159,255,0.18); border-radius: 14px; padding: 12px 14px; margin-bottom: 18px; }
    .prescribed .label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--primary-dim); }
    .prescribed .target { font-size: 0.92rem; font-weight: 600; margin-top: 4px; color: var(--ink); }
    .big-btn { background: linear-gradient(90deg, #85adff, #9ffb00); color: #0c0e11; font-weight: 800; font-size: 0.84rem; text-transform: uppercase; letter-spacing: 0.15em; padding: 18px; border-radius: 999px; border: none; margin-top: auto; cursor: pointer; width: 100%; }
    .secondary-btn { background: rgba(255,255,255,0.04); color: var(--ink); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 999px; border: 1px solid var(--line); cursor: pointer; flex: 1; }
    .danger-btn { background: rgba(255,143,157,0.1); color: var(--danger); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 999px; border: 1px solid rgba(255,143,157,0.3); cursor: pointer; flex: 1; }
    .lap-big { text-align: center; font-size: 5rem; font-weight: 900; color: var(--secondary); letter-spacing: -0.05em; line-height: 1; margin: 14px 0 4px; font-variant-numeric: tabular-nums; }
    .lap-label { text-align: center; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
    .lap-tap-btn { background: linear-gradient(135deg, rgba(109,159,255,0.3), rgba(159,251,0,0.2)); border: 2px solid rgba(159,251,0,0.4); border-radius: 22px; padding: 34px; color: var(--ink); font-size: 1.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; margin: 14px 0; cursor: pointer; }
    .lap-undo { text-align: center; font-size: 0.76rem; color: var(--primary); margin-top: 6px; background: none; border: none; cursor: pointer; }
    .stat-row-swim { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: auto; }
    .live-stat { background: rgba(255,255,255,0.03); border: 1px solid var(--line); border-radius: 14px; padding: 12px 8px; text-align: center; }
    .live-stat-val { font-size: 1.1rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--ink); }
    .live-stat-label { font-size: 0.56rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-top: 2px; }
    .swim-btn-row { margin-top: 14px; display: flex; gap: 10px; }
    .swim-topbar-live { font-size: 0.74rem; color: var(--muted); display: flex; justify-content: space-between; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="swim-wrap" id="swim-root"></div>
  <script type="module" src="/app/workout/swim/swim.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the React component**

Create `app/workout/swim/swim.js`:

```javascript
import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildSwimCardData } from "/shared/share-card.js";

const h = React.createElement;

if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

function readQuery() {
  const p = new URLSearchParams(window.location.search);
  return { planId: p.get("plan") || "", sessionId: p.get("session") || "" };
}

function formatTimer(seconds) {
  if (!seconds) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STROKE_CHIPS = [
  { id: "freestyle", label: "Freestyle" },
  { id: "backstroke", label: "Back" },
  { id: "breaststroke", label: "Breast" },
  { id: "butterfly", label: "Fly" },
  { id: "im", label: "IM" },
];

const POOL_CHIPS = [
  { id: 25, label: "25m" },
  { id: 50, label: "50m" },
  { id: 22.86, label: "25yd" },
  { id: 30.48, label: "33⅓yd" },
];

// ── Pre-start ─────────────────────────────────────────────────────

function PreStart({ titleValue, setTitleValue, stroke, setStroke, poolLen, setPoolLen, prescribed, onStart }) {
  return h(
    React.Fragment,
    null,
    h("div", { className: "swim-topbar" },
      h("a", { href: "/app/workout/" }, "← Back"),
      h("span", null, "")
    ),
    h("div", { className: "title-field" },
      h("div", { className: "label" }, "SESSION"),
      h("input", {
        type: "text",
        value: titleValue,
        onChange: (e) => setTitleValue(e.target.value),
      })
    ),
    h("div", { className: "chip-row" },
      STROKE_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${stroke === c.id ? " active" : ""}`,
          onClick: () => setStroke(c.id),
        }, c.label)
      )
    ),
    h("div", { className: "chip-row" },
      POOL_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${poolLen === c.id ? " active" : ""}`,
          onClick: () => setPoolLen(c.id),
        }, c.label)
      )
    ),
    prescribed && h("div", { className: "prescribed" },
      h("div", { className: "label" }, "TARGET"),
      h("div", { className: "target" }, prescribed)
    ),
    h("button", { className: "big-btn", onClick: onStart }, "Start")
  );
}

// ── Live ──────────────────────────────────────────────────────────

function LiveScreen({
  elapsedS, lapCount, poolLen, stroke, splits, paused,
  onTapLap, onUndoLap, onPause, onResume, onFinish,
}) {
  const lastLap = splits.length > 0 ? splits[splits.length - 1] : null;
  const fastestLap = splits.length > 0 ? Math.min(...splits) : null;
  const totalDistance = Math.round(lapCount * poolLen);
  const paceSec100m = totalDistance > 0 ? Math.round((elapsedS * 100) / totalDistance) : null;

  return h(
    React.Fragment,
    null,
    h("div", { className: "swim-topbar-live" },
      h("span", null, formatTimer(elapsedS), " elapsed"),
      h("span", null, `${poolLen}m pool · ${stroke}`)
    ),
    h("div", { className: "lap-big" }, lapCount),
    h("div", { className: "lap-label" }, `LAPS · ${totalDistance}m`),
    h("button", { className: "lap-tap-btn", onClick: onTapLap, disabled: paused }, "TAP FOR LAP"),
    lapCount > 0 && h("button", { className: "lap-undo", onClick: onUndoLap }, "Undo last lap"),
    h("div", { className: "stat-row-swim" },
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, paceSec100m ? formatTimer(paceSec100m) : "--"),
        h("div", { className: "live-stat-label" }, "/100m")
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, lastLap ? `${lastLap}s` : "--"),
        h("div", { className: "live-stat-label" }, "Last lap")
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, fastestLap ? `${fastestLap}s` : "--"),
        h("div", { className: "live-stat-label" }, "Fastest")
      )
    ),
    h("div", { className: "swim-btn-row" },
      paused
        ? h("button", { className: "big-btn", style: { margin: 0 }, onClick: onResume }, "Resume")
        : h("button", { className: "secondary-btn", onClick: onPause }, "Pause"),
      h("button", { className: "danger-btn", onClick: onFinish }, "Finish & share")
    )
  );
}

// ── Main component ────────────────────────────────────────────────

const LAP_CAP = 500;

function SwimSessionView({ session: authSession, planRow, sessionIndex, profile }) {
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart");
  const [titleValue, setTitleValue] = useState(targetSession.title || "Swim");
  const [stroke, setStroke] = useState("freestyle");
  const [poolLen, setPoolLen] = useState(profile?.default_pool_length_m || 25);

  const [startedAt, setStartedAt] = useState(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [pauseStart, setPauseStart] = useState(null);
  const [paused, setPaused] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);

  const [lapCount, setLapCount] = useState(0);
  const [lapTimestamps, setLapTimestamps] = useState([]); // ms timestamps of each tap

  const [shareCardData, setShareCardData] = useState(null);

  // Timer
  useEffect(() => {
    if (phase !== "live" || paused || !startedAt) return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsedS(Math.max(0, (now - startedAt - pausedSeconds * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, paused, startedAt, pausedSeconds]);

  // Lap splits derived from timestamps
  const splits = useMemo(() => {
    if (lapTimestamps.length === 0) return [];
    const out = [];
    let prev = startedAt;
    for (const t of lapTimestamps) {
      out.push(Math.round((t - prev) / 1000));
      prev = t;
    }
    return out;
  }, [lapTimestamps, startedAt]);

  const startTracking = useCallback(() => {
    setStartedAt(Date.now());
    setPhase("live");
  }, []);

  const onTapLap = useCallback(() => {
    if (lapCount >= LAP_CAP) return;
    setLapCount((c) => c + 1);
    setLapTimestamps((arr) => [...arr, Date.now()]);
  }, [lapCount]);

  const onUndoLap = useCallback(() => {
    if (lapCount === 0) return;
    setLapCount((c) => c - 1);
    setLapTimestamps((arr) => arr.slice(0, -1));
  }, [lapCount]);

  const onPause = useCallback(() => { setPaused(true); setPauseStart(Date.now()); }, []);
  const onResume = useCallback(() => {
    if (pauseStart) setPausedSeconds((p) => p + Math.round((Date.now() - pauseStart) / 1000));
    setPauseStart(null);
    setPaused(false);
  }, [pauseStart]);

  const onFinish = useCallback(async () => {
    const durationSec = Math.round((Date.now() - startedAt - pausedSeconds * 1000) / 1000);
    const totalDistance = Math.round(lapCount * poolLen);

    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      pool_length_m: poolLen,
      stroke_type: stroke,
      lap_count: lapCount,
      lap_splits: splits,
      total_distance_m: totalDistance,
      duration_seconds: durationSec,
      logged_at: new Date().toISOString(),
      session_notes: "",
    };

    const nextPlan = {
      ...plan,
      sessions: plan.sessions.map((s, idx) => {
        if (idx !== sessionIndex) return s;
        return { ...s, title: titleValue, completion_status: "completed", completed_blocks: [completedBlock] };
      }),
    };

    await applyManualWorkoutPlanEdit(authSession.user.id, planRow.id, nextPlan);
    upsertWorkoutLogs(authSession.user.id, planRow.id, nextPlan, targetSession.id).catch((e) =>
      console.error("[swim] log sync", e)
    );

    const cardData = buildSwimCardData({ title: titleValue }, completedBlock, profile);
    setShareCardData(cardData);
  }, [
    startedAt, pausedSeconds, lapCount, poolLen, stroke, splits, firstBlockId,
    plan, sessionIndex, titleValue, planRow.id, targetSession.id, authSession.user.id, profile,
  ]);

  const onShareClose = useCallback(() => { window.location.href = "/app/workout/"; }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(PreStart, {
      titleValue, setTitleValue, stroke, setStroke, poolLen, setPoolLen,
      prescribed: targetSession.blocks?.[0]?.load || targetSession.blocks?.[0]?.notes || null,
      onStart: startTracking,
    }),
    phase === "live" && h(LiveScreen, {
      elapsedS, lapCount, poolLen, stroke, splits, paused,
      onTapLap, onUndoLap, onPause, onResume, onFinish,
    }),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: {},
      onClose: onShareClose,
    })
  );
}

async function boot() {
  const rootEl = document.getElementById("swim-root");
  if (!rootEl) return;
  const { planId, sessionId } = readQuery();
  if (!planId || !sessionId) { rootEl.innerHTML = '<div style="padding:20px">Missing plan/session.</div>'; return; }
  const session = await requireAuth();
  if (!session) return;
  const planRow = await getWorkoutPlan(planId);
  if (!planRow || planRow.user_id !== session.user.id) { rootEl.innerHTML = '<div style="padding:20px">Not found.</div>'; return; }
  const sessionIndex = (planRow.plan.sessions || []).findIndex((s) => s && s.id === sessionId);
  if (sessionIndex < 0) { rootEl.innerHTML = '<div style="padding:20px">Session not in plan.</div>'; return; }
  const profile = await getProfile(session.user.id);
  const root = createRoot(rootEl);
  root.render(h(SwimSessionView, { session, planRow, sessionIndex, profile }));
}

boot().catch((err) => {
  console.error("[swim] boot failed:", err);
  const el = document.getElementById("swim-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed.</div>';
});
```

- [ ] **Step 3: Commit**

```bash
git add app/workout/swim/
git commit -m "feat: swim session view with lap counter and finish & share"
```

---

## Task 14: Climb session view

**Files:**
- Create: `app/workout/climb/index.html`
- Create: `app/workout/climb/climb.js`

- [ ] **Step 1: Write the HTML shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="robots" content="noindex">
  <title>Climb Session | Emersus AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared/site.css">
  <style>
    body { background: var(--bg); color: var(--ink); font-family: Inter, system-ui, sans-serif; }
    .climb-wrap { max-width: 480px; margin: 0 auto; padding: 24px 18px 140px; min-height: 100vh; display: flex; flex-direction: column; }
    .climb-topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; font-size: 0.78rem; color: var(--muted); }
    .climb-topbar a { color: var(--primary); text-decoration: none; }
    .title-field { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; }
    .title-field .label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); }
    .title-field input { background: transparent; border: none; color: var(--ink); font-size: 1.08rem; font-weight: 700; width: 100%; padding: 4px 0 0; outline: none; }
    .chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .chip { padding: 8px 14px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; border: 1px solid var(--line); background: rgba(255,255,255,0.03); color: var(--muted); cursor: pointer; }
    .chip.active { background: rgba(159,251,0,0.14); border-color: rgba(159,251,0,0.38); color: var(--secondary); }
    .big-btn { background: linear-gradient(90deg, #85adff, #9ffb00); color: #0c0e11; font-weight: 800; font-size: 0.84rem; text-transform: uppercase; letter-spacing: 0.15em; padding: 18px; border-radius: 999px; border: none; margin-top: auto; cursor: pointer; width: 100%; }
    .climb-add-btn { background: linear-gradient(90deg, #85adff, #9ffb00); color: #0c0e11; font-weight: 800; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 14px; border: none; width: 100%; margin-bottom: 14px; cursor: pointer; }
    .danger-btn { background: rgba(255,143,157,0.1); color: var(--danger); font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px; border-radius: 999px; border: 1px solid rgba(255,143,157,0.3); cursor: pointer; width: 100%; margin-top: 10px; }
    .route-list { flex: 1; overflow-y: auto; }
    .route-item { background: rgba(255,255,255,0.035); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
    .route-grade { font-size: 1.02rem; font-weight: 800; color: var(--ink); letter-spacing: -0.01em; }
    .route-name { font-size: 0.74rem; color: var(--muted); margin-top: 2px; }
    .send-badge { font-size: 0.58rem; font-weight: 800; letter-spacing: 0.1em; padding: 4px 9px; border-radius: 999px; }
    .send-badge.flash { background: rgba(159,251,0,0.14); color: var(--secondary); }
    .send-badge.send { background: rgba(109,159,255,0.15); color: var(--primary-dim); }
    .send-badge.project { background: rgba(255,143,157,0.12); color: var(--danger); }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); z-index: 500; display: flex; align-items: flex-end; padding: 16px; }
    .modal-sheet { background: #161922; border-radius: 20px; padding: 22px 20px; width: 100%; max-width: 480px; margin: 0 auto; }
    .modal-title { font-size: 1rem; font-weight: 700; margin-bottom: 14px; }
    .modal-sub { font-size: 0.6rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
    .grade-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px; }
    .grade-cell { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 10px; padding: 10px 0; text-align: center; font-size: 0.78rem; font-weight: 700; cursor: pointer; color: var(--ink); }
    .grade-cell.selected { background: rgba(159,251,0,0.14); border-color: var(--secondary); color: var(--secondary); }
    .counter-row { display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; }
    .counter-controls { display: flex; align-items: center; gap: 12px; }
    .counter-btn { width: 30px; height: 30px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid var(--line); color: var(--ink); font-weight: 800; font-size: 1rem; cursor: pointer; }
    .toggle-row { display: flex; gap: 8px; margin-bottom: 14px; }
    .toggle-cell { flex: 1; padding: 11px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,0.04); text-align: center; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer; color: var(--muted); }
    .toggle-cell.selected.flash { background: rgba(159,251,0,0.14); border-color: var(--secondary); color: var(--secondary); }
    .toggle-cell.selected.send { background: rgba(109,159,255,0.15); border-color: var(--primary); color: var(--primary); }
    .toggle-cell.selected.project { background: rgba(255,143,157,0.12); border-color: var(--danger); color: var(--danger); }
    .name-input { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; color: var(--ink); width: 100%; font-size: 0.84rem; margin-bottom: 14px; outline: none; }
  </style>
</head>
<body>
  <div class="climb-wrap" id="climb-root"></div>
  <script type="module" src="/app/workout/climb/climb.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the React component**

```javascript
import React, { useCallback, useEffect, useMemo, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { GRADE_SYSTEMS, defaultSystemForStyle } from "/shared/climbing-grades.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildClimbCardData } from "/shared/share-card.js";

const h = React.createElement;

if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

function readQuery() {
  const p = new URLSearchParams(window.location.search);
  return { planId: p.get("plan") || "", sessionId: p.get("session") || "" };
}

const STYLE_CHIPS = [
  { id: "bouldering", label: "Bouldering" },
  { id: "sport_climbing", label: "Sport" },
  { id: "top_rope_climbing", label: "Top-rope" },
  { id: "trad_climbing", label: "Trad" },
];

// ── Add route modal ───────────────────────────────────────────────

function AddRouteModal({ initial, gradeSystem, onSave, onCancel }) {
  const [grade, setGrade] = useState(initial?.grade || null);
  const [attempts, setAttempts] = useState(initial?.attempts || 1);
  const [sendType, setSendType] = useState(initial?.send_type || "flash");
  const [routeName, setRouteName] = useState(initial?.name || "");

  const grades = GRADE_SYSTEMS[gradeSystem]?.grades || [];

  const chooseSendType = (type) => {
    setSendType(type);
    if (type === "flash" && attempts !== 1) setAttempts(1);
  };

  const canSave = !!grade;

  return h(
    "div",
    { className: "modal-backdrop", onClick: onCancel },
    h(
      "div",
      { className: "modal-sheet", onClick: (e) => e.stopPropagation() },
      h("div", { className: "modal-title" }, initial ? "Edit route" : "Add route"),
      h("div", { className: "modal-sub" }, `Grade (${gradeSystem})`),
      h("div", { className: "grade-grid" },
        grades.slice(0, 18).map((g) =>
          h("button", {
            key: g,
            className: `grade-cell${grade === g ? " selected" : ""}`,
            onClick: () => setGrade(g),
          }, g)
        )
      ),
      h("div", { className: "counter-row" },
        h("span", null, "Attempts"),
        h("div", { className: "counter-controls" },
          h("button", { className: "counter-btn", onClick: () => setAttempts((a) => Math.max(1, a - 1)) }, "−"),
          h("span", { style: { fontSize: "1.05rem", fontWeight: 800, minWidth: 24, textAlign: "center" } }, attempts),
          h("button", { className: "counter-btn", onClick: () => setAttempts((a) => a + 1) }, "+"),
        )
      ),
      h("div", { className: "toggle-row" },
        h("button", {
          className: `toggle-cell flash${sendType === "flash" ? " selected" : ""}`,
          onClick: () => chooseSendType("flash"),
        }, "Flash"),
        h("button", {
          className: `toggle-cell send${sendType === "send" ? " selected" : ""}`,
          onClick: () => chooseSendType("send"),
        }, "Send"),
        h("button", {
          className: `toggle-cell project${sendType === "project" ? " selected" : ""}`,
          onClick: () => chooseSendType("project"),
        }, "Project"),
      ),
      h("input", {
        type: "text",
        className: "name-input",
        placeholder: "Route name (optional)",
        value: routeName,
        onChange: (e) => setRouteName(e.target.value),
      }),
      h("button", {
        className: "big-btn",
        style: { marginTop: 0, opacity: canSave ? 1 : 0.4, padding: 14 },
        disabled: !canSave,
        onClick: () => onSave({
          grade,
          grade_system: gradeSystem,
          attempts,
          send_type: sendType,
          name: routeName.trim() || null,
        }),
      }, "Log route"),
      h("button", {
        style: { background: "none", border: "none", color: "var(--muted)", marginTop: 8, width: "100%", padding: 6, cursor: "pointer" },
        onClick: onCancel,
      }, "Cancel"),
    )
  );
}

// ── Main component ────────────────────────────────────────────────

function ClimbSessionView({ session: authSession, planRow, sessionIndex, profile }) {
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart");
  const [titleValue, setTitleValue] = useState(targetSession.title || "Climb Session");
  const [style, setStyle] = useState("bouldering");
  const [gradeSystem, setGradeSystem] = useState(() =>
    profile?.default_grade_system || defaultSystemForStyle("bouldering")
  );

  const [startedAt, setStartedAt] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);

  const [shareCardData, setShareCardData] = useState(null);

  const changeStyle = (s) => {
    setStyle(s);
    if (!profile?.default_grade_system) {
      setGradeSystem(defaultSystemForStyle(s));
    }
  };

  const startSession = () => {
    setStartedAt(Date.now());
    setPhase("live");
  };

  const addRoute = (route) => {
    if (editingIdx != null) {
      setRoutes((rs) => rs.map((r, i) => (i === editingIdx ? route : r)));
    } else {
      setRoutes((rs) => [route, ...rs]);
    }
    setModalOpen(false);
    setEditingIdx(null);
  };

  const editRoute = (idx) => {
    setEditingIdx(idx);
    setModalOpen(true);
  };

  const onFinish = useCallback(async () => {
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      style,
      routes,
      duration_seconds: durationSec,
      logged_at: new Date().toISOString(),
      session_notes: "",
    };
    const nextPlan = {
      ...plan,
      sessions: plan.sessions.map((s, idx) => {
        if (idx !== sessionIndex) return s;
        return { ...s, title: titleValue, completion_status: "completed", completed_blocks: [completedBlock] };
      }),
    };
    await applyManualWorkoutPlanEdit(authSession.user.id, planRow.id, nextPlan);
    upsertWorkoutLogs(authSession.user.id, planRow.id, nextPlan, targetSession.id).catch((e) =>
      console.error("[climb] log sync", e)
    );
    const cardData = buildClimbCardData({ title: titleValue }, completedBlock, profile);
    setShareCardData(cardData);
  }, [
    startedAt, firstBlockId, style, routes, plan, sessionIndex, titleValue,
    planRow.id, targetSession.id, authSession.user.id, profile,
  ]);

  const onShareClose = useCallback(() => { window.location.href = "/app/workout/"; }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(
      React.Fragment,
      null,
      h("div", { className: "climb-topbar" },
        h("a", { href: "/app/workout/" }, "← Back"),
      ),
      h("div", { className: "title-field" },
        h("div", { className: "label" }, "SESSION"),
        h("input", {
          type: "text",
          value: titleValue,
          onChange: (e) => setTitleValue(e.target.value),
        })
      ),
      h("div", { className: "chip-row" },
        STYLE_CHIPS.map((c) =>
          h("button", {
            key: c.id,
            className: `chip${style === c.id ? " active" : ""}`,
            onClick: () => changeStyle(c.id),
          }, c.label)
        )
      ),
      h("button", { className: "big-btn", onClick: startSession }, "Start")
    ),
    phase === "live" && h(
      React.Fragment,
      null,
      h("div", { className: "climb-topbar" },
        h("a", { href: "/app/workout/" }, "← Back"),
        h("span", null, startedAt ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "")
      ),
      h("div", { className: "title-field" },
        h("div", { className: "label" }, "SESSION"),
        h("div", { style: { fontSize: "1.02rem", fontWeight: 700, marginTop: 2 } }, titleValue)
      ),
      h("button", { className: "climb-add-btn", onClick: () => setModalOpen(true) }, "+ Add route"),
      h("div", { className: "route-list" },
        routes.map((r, idx) =>
          h("div", {
            key: idx,
            className: "route-item",
            onClick: () => editRoute(idx),
          },
            h("div", null,
              h("div", { className: "route-grade" }, r.grade),
              r.name && h("div", { className: "route-name" }, r.name),
            ),
            h("span", { className: `send-badge ${r.send_type}` },
              r.send_type === "send" && r.attempts > 1 ? `SEND · ${r.attempts} tries` : r.send_type.toUpperCase()
            )
          )
        )
      ),
      h("button", { className: "danger-btn", onClick: onFinish, disabled: routes.length === 0 },
        "Finish & share"
      ),
      modalOpen && h(AddRouteModal, {
        initial: editingIdx != null ? routes[editingIdx] : null,
        gradeSystem,
        onSave: addRoute,
        onCancel: () => { setModalOpen(false); setEditingIdx(null); },
      })
    ),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: {},
      onClose: onShareClose,
    })
  );
}

async function boot() {
  const rootEl = document.getElementById("climb-root");
  if (!rootEl) return;
  const { planId, sessionId } = readQuery();
  if (!planId || !sessionId) { rootEl.innerHTML = '<div style="padding:20px">Missing plan/session.</div>'; return; }
  const session = await requireAuth();
  if (!session) return;
  const planRow = await getWorkoutPlan(planId);
  if (!planRow || planRow.user_id !== session.user.id) { rootEl.innerHTML = '<div style="padding:20px">Not found.</div>'; return; }
  const sessionIndex = (planRow.plan.sessions || []).findIndex((s) => s && s.id === sessionId);
  if (sessionIndex < 0) { rootEl.innerHTML = '<div style="padding:20px">Session not in plan.</div>'; return; }
  const profile = await getProfile(session.user.id);
  const root = createRoot(rootEl);
  root.render(h(ClimbSessionView, { session, planRow, sessionIndex, profile }));
}

boot().catch((err) => {
  console.error("[climb] boot failed:", err);
  const el = document.getElementById("climb-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed.</div>';
});
```

- [ ] **Step 3: Commit**

```bash
git add app/workout/climb/
git commit -m "feat: climb session view with route logging modal and grade picker"
```

---

## Task 15: Planner routing

**Files:**
- Modify: `app/workout/workout.js`

Route "Start session" to the correct view based on the first block's exercise category.

- [ ] **Step 1: Read existing routing code**

Run: grep `workout.js` for the place where the session link is built (look for `session/?plan=` or similar).

- [ ] **Step 2: Add a helper and replace the hardcoded URL**

Find the code that generates the session link (something like):
```javascript
const sessionHref = `/app/workout/session/?plan=${plan.id}&session=${session.id}`;
```

Replace with a helper call. Add this helper near the top of `workout.js` after imports:

```javascript
// Map session category → session view URL
function sessionViewUrl(plan, session) {
  const firstBlock = session.blocks?.[0];
  const category =
    session.category ||
    firstBlock?.category ||
    inferCategoryFromName(firstBlock?.name || "") ||
    "resistance";

  const params = `?plan=${encodeURIComponent(plan.id)}&session=${encodeURIComponent(session.id)}`;

  switch (category) {
    case "cardio":   return `/app/workout/cardio/${params}`;
    case "swimming": return `/app/workout/swim/${params}`;
    case "climbing": return `/app/workout/climb/${params}`;
    default:         return `/app/workout/session/${params}`;
  }
}

function inferCategoryFromName(name) {
  const n = (name || "").toLowerCase();
  if (!n) return null;
  if (/run|jog|cycl|bike|walk|hike|elliptic|row|stair|treadmill/.test(n)) return "cardio";
  if (/swim|freestyle|backstroke|breaststroke|butterfly|medley/.test(n)) return "swimming";
  if (/climb|boulder|sport.+route|trad|top.?rope/.test(n)) return "climbing";
  return null;
}
```

Replace the hardcoded session href with `sessionViewUrl(plan, session)` everywhere in the file.

- [ ] **Step 3: Commit**

```bash
git add app/workout/workout.js
git commit -m "feat: planner routes to correct session view by category"
```

---

## Task 16: Resistance session view — add Finish & Share

**Files:**
- Modify: `app/workout/session/session.js`

Add a second "Finish & share" button next to the existing "Finish session" button that opens the share modal with the gym card variant.

- [ ] **Step 1: Add imports**

At the top of `session.js`, add:

```javascript
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildGymCardData } from "/shared/share-card.js";
```

And inject CSS:

```javascript
if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}
```

- [ ] **Step 2: Add share state and handler inside SessionView**

Add inside the component (near other useState calls):

```javascript
const [shareCardData, setShareCardData] = useState(null);
```

Modify the `finishSession` function to support a `share` flag:

```javascript
async function finishSession({ share = false } = {}) {
  if (pendingPlanRef.current) flushSave();
  const nextSessions = plan.sessions.map((s, idx) => {
    if (idx !== targetSessionIndex) return s;
    return { ...s, completion_status: "completed" };
  });
  const nextPlan = { ...plan, sessions: nextSessions };
  pendingPlanRef.current = nextPlan;
  await flushSave();

  if (share) {
    // Compute summary stats for the gym card
    const savedSession = nextPlan.sessions[targetSessionIndex];
    const summary = computeGymSummary(savedSession);
    const profile = profileRef.current || {};
    const cardData = buildGymCardData(
      { title: savedSession.title },
      profile,
      summary
    );
    setShareCardData(cardData);
    return;
  }

  setToast({ message: "Session logged. Nice work.", tone: "success" });
  setTimeout(() => { window.location.href = `/app/workout/`; }, 900);
}
```

- [ ] **Step 3: Add `computeGymSummary` helper**

Add outside the component, near other module-level helpers:

```javascript
function computeGymSummary(session) {
  const completed = session.completed_blocks || [];
  let totalVolumeKg = 0;
  let setCount = 0;
  const exerciseMap = new Map();

  for (const cb of completed) {
    const block = (session.blocks || []).find((b) => b.id === cb.block_id);
    if (!block) continue;
    const name = block.name || "Exercise";
    let best = { loadKg: 0, reps: 0 };
    for (const set of cb.actual_sets || []) {
      if (!set.done) continue;
      const reps = parseInt(set.reps, 10);
      const load = parseFloat(set.load);
      if (!isNaN(reps) && !isNaN(load)) {
        totalVolumeKg += reps * load;
        setCount += 1;
        if (load > best.loadKg) best = { loadKg: load, reps };
      } else if (!isNaN(reps)) {
        setCount += 1;
      }
    }
    exerciseMap.set(name, best);
  }

  const topExercises = [...exerciseMap.entries()]
    .sort((a, b) => (b[1].loadKg || 0) - (a[1].loadKg || 0))
    .slice(0, 3)
    .map(([name, best]) => ({
      name,
      best_set_display: best.loadKg ? `${best.loadKg}kg × ${best.reps}` : `${best.reps} reps`,
      is_pr: false, // PR detection requires historical lookup; left false for v1
    }));

  return {
    totalVolumeKg,
    setCount,
    exerciseCount: exerciseMap.size,
    durationSeconds: 0, // not tracked for resistance
    topExercises,
  };
}
```

- [ ] **Step 4: Fetch profile and store in ref**

In `boot()`, before rendering, fetch the profile:

```javascript
import { getProfile } from "/shared/supabase.js"; // already imported? verify
// ...
const profile = await getProfile(session.user.id);
root.render(h(SessionView, { session, planRow, sessionId, profile }));
```

In the `SessionView` function signature:

```javascript
function SessionView({ session: authSession, planRow, sessionId, profile, weightUnit }) {
```

And add a ref for access inside callbacks:
```javascript
const profileRef = useRef(profile);
```

- [ ] **Step 5: Render the button and modal**

Find the existing "Finish session" button JSX and add a sibling button:

```javascript
h("button", {
  type: "button",
  className: "finish-btn",
  onClick: () => finishSession({ share: false }),
}, "Finish session"),
h("button", {
  type: "button",
  className: "finish-share-btn",
  onClick: () => finishSession({ share: true }),
}, "Finish & share"),
```

And at the end of the JSX tree, render the modal conditionally:

```javascript
shareCardData && h(ShareModal, {
  cardData: shareCardData,
  cardOpts: {},
  onClose: () => { window.location.href = "/app/workout/"; },
}),
```

Add basic CSS to the session HTML for `.finish-share-btn`:

```css
.finish-share-btn {
  background: linear-gradient(90deg, #85adff, #9ffb00);
  color: #0c0e11;
  font-weight: 800;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 14px;
  border-radius: 999px;
  border: none;
  margin-top: 8px;
  cursor: pointer;
  width: 100%;
}
```

- [ ] **Step 6: Commit**

```bash
git add app/workout/session/session.js app/workout/session/index.html
git commit -m "feat: add Finish & share button to resistance session view"
```

---

## Task 17: Client config exposes Mapbox token

**Files:**
- Modify: `api/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Read existing api/config.js**

Run: read `api/config.js` and note the shape of the response JSON.

- [ ] **Step 2: Add Mapbox token to response**

In `api/config.js`, add:
```javascript
mapboxPublicToken: process.env.MAPBOX_PUBLIC_TOKEN || null,
```
to the returned object alongside `supabaseUrl` and `supabaseAnonKey`.

- [ ] **Step 3: Add placeholder to .env.example**

Append to `.env.example`:
```
# Mapbox public token (URL-restricted to emersus.ai/*) used for share card route maps
MAPBOX_PUBLIC_TOKEN=pk.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 4: Commit**

```bash
git add api/config.js .env.example
git commit -m "feat: expose MAPBOX_PUBLIC_TOKEN in client config"
```

---

## Task 18: Profile page — sharing & tracking settings

**Files:**
- Modify: `app/profile/index.html`
- Modify: `shared/app-pages.js`

- [ ] **Step 1: Add the settings section to the HTML form**

Find the existing `.form-grid` in `app/profile/index.html` and add this block before the `.button-row`:

```html
<div class="sharing-section" style="margin-top:24px; padding-top:20px; border-top:1px solid var(--line);">
  <h3 style="font-size:0.78rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">Sharing & Tracking</h3>

  <label class="field">
    <span class="field-label">Display name on share cards</span>
    <input type="text" name="display_name_public" placeholder="(leave blank for anonymous)">
  </label>

  <label class="field">
    <span class="field-label">Path privacy radius</span>
    <select name="mapbox_privacy_radius_m">
      <option value="0">Show full path</option>
      <option value="50">50 m</option>
      <option value="100" selected>100 m (recommended)</option>
      <option value="200">200 m</option>
      <option value="500">500 m</option>
    </select>
  </label>

  <label class="field">
    <span class="field-label">Default pool length</span>
    <select name="default_pool_length_m">
      <option value="">—</option>
      <option value="25">25 m</option>
      <option value="50">50 m</option>
      <option value="22.86">25 yd</option>
      <option value="30.48">33⅓ yd</option>
    </select>
  </label>

  <label class="field">
    <span class="field-label">Default grade system</span>
    <select name="default_grade_system">
      <option value="">—</option>
      <option value="V">V-scale (bouldering)</option>
      <option value="YDS">YDS (sport)</option>
      <option value="Font">Fontainebleau</option>
      <option value="French">French</option>
    </select>
  </label>

  <label class="field">
    <span class="field-label">Distance unit</span>
    <select name="distance_unit">
      <option value="km">Kilometers (km)</option>
      <option value="mi">Miles (mi)</option>
    </select>
  </label>
</div>
```

- [ ] **Step 2: Wire the inputs in `shared/app-pages.js`**

Find the `bindProfileForm` function. After the existing `weightSelect` binding block, add:

```javascript
// Sharing & tracking settings — editable selects that save on change
const sharingFields = [
  "display_name_public",
  "mapbox_privacy_radius_m",
  "default_pool_length_m",
  "default_grade_system",
  "distance_unit",
];

for (const fieldName of sharingFields) {
  const el = form.elements.namedItem(fieldName);
  if (!el) continue;

  // Initialize from profile
  if (profile && profile[fieldName] != null) {
    el.value = String(profile[fieldName]);
  } else if (fieldName === "distance_unit") {
    // Locale fallback for distance_unit
    const { resolveDistanceUnit } = await import("/shared/unit-conversion.js");
    el.value = resolveDistanceUnit(null);
  }

  el.addEventListener("change", async () => {
    const raw = el.value;
    const statusEl = document.querySelector("[data-profile-status]");
    let value = raw;

    // Cast numbers
    if (fieldName === "mapbox_privacy_radius_m" || fieldName === "default_pool_length_m") {
      value = raw === "" ? null : Number(raw);
    }
    // Empty string → null for optional text fields
    if (raw === "" && fieldName === "display_name_public") value = null;
    if (raw === "" && fieldName === "default_grade_system") value = null;
    if (raw === "" && fieldName === "default_pool_length_m") value = null;

    try {
      await upsertProfile(session.user.id, { [fieldName]: value });
      setStatus(statusEl, "success", "Saved.");
    } catch (err) {
      setStatus(statusEl, "error", `Could not save: ${err.message || err}`);
    }
  });
}
```

Also ensure the function is declared `async` if it wasn't (it already is).

- [ ] **Step 3: Commit**

```bash
git add app/profile/index.html shared/app-pages.js
git commit -m "feat: add sharing & tracking settings section to profile page"
```

---

## Task 19: LLM workflow — cardio/swim/climb plan generation

**Files:**
- Modify: `api/emersus/workflow.js`

- [ ] **Step 1: Update profile SELECT**

Find the `fetchSupabaseProfile` query and add the new fields:

```javascript
`${supabaseUrl}/rest/v1/profiles?select=goal,experience_level,dietary_preferences,injuries_limitations,full_name,email,onboarding_completed,primary_use_case,equipment_access,available_days_per_week,available_minutes_per_session,sleep_stress_context,weight_unit,distance_unit,preferred_sports,default_pool_length_m,default_grade_system&id=eq.${encodeURIComponent(supabaseUserId)}&limit=1`
```

- [ ] **Step 2: Update `mergeProfile`**

In `mergeProfile`, add new fields to the returned object:

```javascript
distance_unit: sanitizeProfileField(profile?.distance_unit || storedProfile?.distance_unit, 8),
preferred_sports: profile?.preferred_sports || storedProfile?.preferred_sports || null,
default_pool_length_m: profile?.default_pool_length_m ?? storedProfile?.default_pool_length_m ?? null,
default_grade_system: sanitizeProfileField(profile?.default_grade_system || storedProfile?.default_grade_system, 10),
```

- [ ] **Step 3: Update WORKOUT-PLAN FENCES section of the system prompt**

In the existing system prompt string array (around line 247 where block schemas are defined), add per-category schemas. Find the line describing `blocks`:

```
- \`blocks\` is an array of exercises. ...
```

After it, add:

```
- Each block may carry a \`category\` field indicating type. Values: \`resistance\` (default, use existing shape), \`cardio\`, \`swimming\`, \`climbing\`, \`bodyweight\`.
- When \`category: "cardio"\`, the block shape is: \`{name, category: "cardio", activity_type, duration_target_minutes?, distance_target_km?, pace_target?, rpe?, notes?}\`. Use activity_type from the whitelist: running, cycling, walking, hiking, yoga, boxing, other.
- When \`category: "swimming"\`, the block shape is: \`{name, category: "swimming", stroke_type, distance_target_m?, pool_length_m?, notes?}\`. Stroke: freestyle, backstroke, breaststroke, butterfly, im.
- When \`category: "climbing"\`, the block shape is: \`{name, category: "climbing", style, target_grades?, notes?}\`. Style: bouldering, sport_climbing, top_rope_climbing, trad_climbing.
- Sessions for non-resistance training should set session-level \`category\` to match the block type (e.g. \`"category": "cardio"\`).
- When emitting raw weight numbers (e.g. "60kg" or "135 lbs"), always match \`user_profile.weight_unit\`. Never mix units within a plan.
- When emitting distances, use \`user_profile.distance_unit\` (km by default, mi if specified). Swimming distances always use meters.
- For climbing plans, use \`user_profile.default_grade_system\` when targeting specific grades.
```

- [ ] **Step 4: Update onboarding prompt**

In `ONBOARDING_SYSTEM_PROMPT`, modify step 3 to ask about sports:

Find:
```
"3. Ask about equipment access, how many days per week they can train, any dietary preferences or restrictions, and whether they prefer kilograms or pounds for tracking weights (kg/lbs).",
```

Replace with:
```
"3. Ask about equipment access, how many days per week they can train, any dietary preferences or restrictions, whether they prefer kilograms or pounds (kg/lbs), and what kind of training they do — pick any that apply: weights, running, cycling, swimming, climbing, mixed. If they mention swimming, ask pool length (25m/50m/25yd). If they mention climbing, ask grade system (V-scale or YDS).",
```

And add to the valid fields list in the PROFILE-UPDATE FENCES section:

```
"- distance_unit (string): 'km' or 'mi'",
"- preferred_sports (array of strings): any of weights, running, cycling, swimming, climbing, mixed",
"- default_pool_length_m (number): 25, 50, 22.86, 30.48",
"- default_grade_system (string): 'V', 'YDS', 'Font', or 'French'",
```

- [ ] **Step 5: Update `validColumns` whitelist**

In `upsertOnboardingProfile`, extend the Set:

```javascript
const validColumns = new Set([
  "goal", "experience_level", "dietary_preferences", "injuries_limitations",
  "equipment_access", "available_days_per_week", "available_minutes_per_session",
  "sleep_stress_context", "primary_use_case", "weight_unit", "distance_unit",
  "preferred_sports", "default_pool_length_m", "default_grade_system",
  "onboarding_completed",
]);
```

- [ ] **Step 6: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat: LLM workflow supports cardio/swim/climb plans and expanded onboarding"
```

---

## Task 20: End-to-end verification

- [ ] **Step 1: Set Mapbox token on production**

Manually add `MAPBOX_PUBLIC_TOKEN=pk.xxx` to `~/app/.env.local` on Hetzner (user must obtain and paste the token). Do NOT commit the actual token.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
ssh hetzner 'cd ~/app && git pull && pkill -f "node /home/emersus/app/server.js"; sleep 1; nohup node server.js > /tmp/emersus.log 2>&1 &'
```

Expected: Server restarts, `curl https://emersus.ai/api/health` returns `{"status":"ok"}`.

- [ ] **Step 3: Verify all pages load**

```bash
for p in '/app/workout/cardio/' '/app/workout/swim/' '/app/workout/climb/' '/app/profile/'; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://emersus.ai$p")
  echo "$p → $code"
done
```

Expected: All 200.

- [ ] **Step 4: Verify migration RPCs**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'upsert_workout_logs'\""
```

Expected: signature matches `p_user_id uuid, p_plan_id uuid, p_session_id text, p_performed_at date, p_blocks jsonb`.

- [ ] **Step 5: Verify expanded exercise catalog**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*) from public.exercises where category in ('swimming','climbing')\""
```

Expected: `10` (6 swim + 4 climb).

- [ ] **Step 6: Verify profile columns**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"\d public.profiles\" | grep -E 'display_name_public|mapbox_privacy|default_pool|default_grade|preferred_sports|distance_unit'"
```

Expected: Six rows listing the new columns.
