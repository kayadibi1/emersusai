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
