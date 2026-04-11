-- supabase/20260412_job_progress.sql
-- Log stream for pg-boss jobs. Written by handlers via ctx.progress(),
-- read by CLI wrapper polling and by the admin UI /admin/jobs page.
-- NOTE: the foreign key to pgboss.job is intentionally commented out
-- because pgboss creates its schema lazily on first boss.start() and
-- this migration runs before the worker has ever started. We enforce
-- the reference in application code instead.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_progress (
  job_id    uuid NOT NULL,
  seq       bigint GENERATED ALWAYS AS IDENTITY,
  level     text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message   text NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE INDEX IF NOT EXISTS job_progress_job_id_seq_idx
  ON public.job_progress(job_id, seq);

CREATE INDEX IF NOT EXISTS job_progress_ts_idx
  ON public.job_progress(ts);

COMMIT;
