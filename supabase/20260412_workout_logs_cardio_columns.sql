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
