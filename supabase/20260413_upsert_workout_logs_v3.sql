-- v3: resistance branch no longer requires the "Done" button tap, and the
-- numeric casts for reps/load/rpe now extract a leading number via POSIX
-- regex so legacy rows whose reps were prefilled with the LLM-prescribed
-- text ("8-12", "20-40 sec", "AMRAP") don't abort the INSERT.
--
-- Background: v2 had two latent bugs in the resistance branch. Both only
-- surfaced when a user fixed one of them in the client:
--
--   1. `IF (v_set ->> 'done')::boolean IS NOT TRUE THEN CONTINUE;` silently
--      skipped every set where the user hadn't tapped the Done / ✓ button.
--      The Done tap is a UI concern (rest-timer + auto-advance), not a
--      semantic "this set counts" marker. Users who logged reps + load and
--      hit Finish & share without tapping Done on each row had ZERO rows
--      inserted into workout_logs — the Progress page silently showed
--      nothing for sessions where real data had been captured into
--      completed_blocks. The client-side fix in computeGymSummary
--      (app/workout/session/session.js) restored the share card totals,
--      but workout_logs stayed empty because this branch still filtered.
--
--   2. `NULLIF(TRIM(v_set ->> 'reps'), '')::smallint` threw on any non-
--      integer string. createEmptyActualSet used to prefill reps with
--      `String(prescribedBlock.reps)`, so rows commonly carried "8-12",
--      "10-12", or "20-40 sec" verbatim when users didn't overwrite the
--      prefill. Remove the Done filter from (1) without also handling
--      that and the RPC starts throwing for every legacy record.
--      createEmptyActualSet has been changed to leave reps empty and
--      show the prescription as a placeholder instead, but legacy
--      completed_blocks already contain the junk, so we defend against
--      it here.
--
-- Defense also applied to load and rpe in case a future client write
-- path drops a non-numeric string in. substring(... FROM '^[0-9]+...')
-- returns the leading numeric prefix or NULL; NULLIF flattens the
-- empty-string case to NULL so ::smallint / ::numeric never sees junk.

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
  v_reps      smallint;
  v_load      numeric;
  v_rpe       numeric;
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

    -- Trust the client's block_category if provided (authoritative),
    -- otherwise fall back to the exercise catalog's category.
    v_category := v_block ->> 'block_category';
    IF v_category IS NULL OR v_category = '' THEN
      SELECT category INTO v_category FROM public.exercises WHERE id = v_ex_id;
    END IF;
    v_matched := v_matched + 1;

    -- CARDIO branch
    IF v_category = 'cardio' THEN
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

    -- RESISTANCE / BODYWEIGHT branch
    ELSE
      v_set_num := 0;
      FOR v_set IN SELECT * FROM jsonb_array_elements(
        COALESCE(v_block -> 'actual_sets', '[]'::jsonb)
      )
      LOOP
        -- Extract leading integer from reps. Handles legacy prefill junk
        -- ("8-12", "20-40 sec") and blanks. NULL means "no rep count was
        -- provided" — we still record the row if load or rpe survived.
        v_reps := NULLIF(
          substring(TRIM(COALESCE(v_set ->> 'reps', '')) FROM '^[0-9]+'),
          ''
        )::smallint;

        v_load := NULLIF(
          substring(TRIM(COALESCE(v_set ->> 'load', '')) FROM '^[0-9]+\.?[0-9]*'),
          ''
        )::numeric;

        v_rpe := NULLIF(
          substring(TRIM(COALESCE(v_set ->> 'rpe', '')) FROM '^[0-9]+\.?[0-9]*'),
          ''
        )::numeric;

        -- Clamp RPE to the Borg 0-10 scale. Client-side clampRpeValue in
        -- session.js enforces this for new writes but legacy completed_blocks
        -- predating that commit can contain nonsense values (test sessions
        -- saw rpe="99"), and workout_logs.rpe is numeric(3,1) so anything
        -- above 99.9 would also abort the INSERT with an overflow error.
        IF v_rpe IS NOT NULL THEN
          v_rpe := LEAST(10, GREATEST(0, v_rpe));
        END IF;

        -- Skip sets with no quantitative data. A row with nothing but
        -- `done: true` or a notes string has nothing worth projecting
        -- into workout_logs and would waste an index entry.
        IF v_reps IS NULL AND v_load IS NULL THEN
          CONTINUE;
        END IF;

        v_set_num := v_set_num + 1;

        INSERT INTO public.workout_logs (
          user_id, exercise_id, plan_id, session_id, performed_at,
          set_number, reps, load_kg, rpe, notes
        ) VALUES (
          p_user_id, v_ex_id, p_plan_id, p_session_id, p_performed_at,
          v_set_num,
          v_reps,
          v_load,
          v_rpe,
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
