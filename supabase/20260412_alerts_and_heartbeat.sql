-- supabase/20260412_alerts_and_heartbeat.sql
-- Worker heartbeats (for the watchdog alert) + alert_log audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id                   text PRIMARY KEY,
  last_beat_at                timestamptz NOT NULL,
  jobs_processed_since_start  bigint NOT NULL DEFAULT 0,
  started_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type  text NOT NULL,
  payload     jsonb,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_log_type_sent_idx
  ON public.alert_log(alert_type, sent_at DESC);

COMMIT;
