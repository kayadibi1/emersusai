-- supabase/20260421_meal_plans_tier_aware.sql
--
-- Makes meal_plans tier-aware: Free keeps the current "1 active plan"
-- behavior (no regression); Pro can maintain multiple active plans
-- (cutting / maintenance / travel, etc.).
--
-- Two changes:
--   1. Drop the old unique partial index that enforced 1-active for
--      everyone regardless of tier.
--   2. Add a BEFORE INSERT trigger that checks profiles.tier. Free
--      users hitting the cap get SQLSTATE P0001 with a stable message;
--      Pro users bypass the check entirely.
--
-- The server-side save endpoint in api/emersus/meal-plans.js continues
-- to auto-archive the previous active plan for Free users so UX is
-- identical to today. For Pro, the endpoint skips the auto-archive so
-- saving an additional plan is additive, not replacing. The trigger is
-- defense in depth — if someone writes to meal_plans directly, the DB
-- still enforces the Free-tier cap.

DROP INDEX IF EXISTS public.meal_plans_one_active_per_user_uq;

CREATE OR REPLACE FUNCTION public.enforce_meal_plans_free_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tier text;
  v_active_count integer;
BEGIN
  -- Only evaluate on active inserts; archived rows don't count.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier
    FROM public.profiles
    WHERE id = NEW.user_id;

  IF v_tier IS NULL OR v_tier = 'free' THEN
    SELECT count(*) INTO v_active_count
      FROM public.meal_plans
      WHERE user_id = NEW.user_id
        AND archived_at IS NULL;

    IF v_active_count >= 1 THEN
      RAISE EXCEPTION
        'meal_plans_free_limit_exceeded: free tier allows 1 active meal plan'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meal_plans_free_limit_trg ON public.meal_plans;
CREATE TRIGGER meal_plans_free_limit_trg
  BEFORE INSERT ON public.meal_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_meal_plans_free_limit();
