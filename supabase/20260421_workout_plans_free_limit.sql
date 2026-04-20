-- supabase/20260421_workout_plans_free_limit.sql
--
-- Enforces the 3-plan cap for Free-tier users as a BEFORE INSERT
-- trigger. Cap counts active (non-archived) plans only — archiving
-- frees a slot so users can iterate without deleting. Pro users are
-- unlimited (no clause runs for them).
--
-- We raise SQLSTATE P0001 with a stable message prefix so the client
-- can match it and render an Upgrade/Archive CTA instead of a generic
-- error.

CREATE OR REPLACE FUNCTION public.enforce_workout_plans_free_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tier text;
  v_active_count integer;
BEGIN
  SELECT tier INTO v_tier
    FROM public.profiles
    WHERE id = NEW.user_id;

  -- Missing profile row → treat as free (safest default).
  IF v_tier IS NULL OR v_tier = 'free' THEN
    SELECT count(*) INTO v_active_count
      FROM public.workout_plans
      WHERE user_id = NEW.user_id
        AND archived_at IS NULL;

    IF v_active_count >= 3 THEN
      RAISE EXCEPTION
        'workout_plans_free_limit_exceeded: free tier allows up to 3 active plans'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workout_plans_free_limit_trg ON public.workout_plans;
CREATE TRIGGER workout_plans_free_limit_trg
  BEFORE INSERT ON public.workout_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workout_plans_free_limit();
