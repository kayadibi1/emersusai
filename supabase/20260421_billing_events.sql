-- supabase/20260421_billing_events.sql
--
-- Append-only audit log for Polar billing events. The UNIQUE constraint
-- on external_id gives us webhook idempotency: re-delivered events (Polar
-- retries on any non-2xx response) become silent INSERT ON CONFLICT DO
-- NOTHING no-ops. The raw jsonb payload is kept for forensic replay.

CREATE TABLE IF NOT EXISTS public.billing_events (
  id           bigserial PRIMARY KEY,
  external_id  text      UNIQUE NOT NULL,   -- Polar event id
  user_id      uuid      REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type   text      NOT NULL,          -- e.g. subscription.active
  raw          jsonb     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_events_user_idx
  ON public.billing_events(user_id, created_at DESC);

-- RLS: writes only via the service role (the webhook handler).
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
