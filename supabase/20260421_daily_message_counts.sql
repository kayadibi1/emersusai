-- supabase/20260421_daily_message_counts.sql
--
-- Per-user, per-UTC-day message counter. Powers the rate-limit middleware
-- on /api/emersus/recommendation. One row per (user_id, day) — rows stay
-- around for analytics; a cleanup job is a follow-up.
--
-- The RPC is atomic: the INSERT...ON CONFLICT...RETURNING delivers the
-- post-increment count in one SQL statement, and if we overshot the cap
-- we immediately decrement. No read-then-write race window — two parallel
-- chat sends at count=N-1 can't both slip past.

CREATE TABLE IF NOT EXISTS public.daily_message_counts (
  user_id  uuid      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day      date      NOT NULL,
  count    integer   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- RLS: no client access. All reads/writes go through the service role.
ALTER TABLE public.daily_message_counts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_and_increment_message_count(
  p_user_id uuid,
  p_limit   integer
)
RETURNS TABLE(allowed boolean, new_count integer, day_limit integer, reset_at timestamptz)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  INSERT INTO public.daily_message_counts AS d (user_id, day, count)
    VALUES (p_user_id, v_today, 1)
    ON CONFLICT (user_id, day)
    DO UPDATE SET count = d.count + 1
    RETURNING d.count INTO v_count;

  IF v_count > p_limit THEN
    UPDATE public.daily_message_counts
       SET count = count - 1
     WHERE user_id = p_user_id AND day = v_today;
    RETURN QUERY SELECT false, v_count - 1, p_limit,
                        (v_today + interval '1 day')::timestamptz;
  ELSE
    RETURN QUERY SELECT true, v_count, p_limit,
                        (v_today + interval '1 day')::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_message_count(uuid, integer)
  TO service_role;
