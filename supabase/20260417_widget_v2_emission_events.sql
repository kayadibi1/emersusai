-- widget_v2_emission_events — per-emission telemetry for the widget-v2 rollout.
-- Referenced by docs/superpowers/specs/2026-04-17-widget-template-refactor-design.md §10.
-- Read-side aggregates added in Plan 8.

CREATE TABLE IF NOT EXISTS public.widget_v2_emission_events (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  thread_id       UUID,
  family          TEXT NOT NULL,
  type            TEXT NOT NULL,
  output_tokens   INTEGER,
  elapsed_ms      INTEGER,
  prose_end_to_widget_done_ms INTEGER,
  display_width   TEXT,
  validator_result TEXT NOT NULL,
  openai_response_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_widget_v2_events_created_at
  ON public.widget_v2_emission_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_v2_events_family_type
  ON public.widget_v2_emission_events (family, type, created_at DESC);

-- Allow service role to insert / select; no direct user access (rollups live in views).
ALTER TABLE public.widget_v2_emission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY widget_v2_events_service_all
  ON public.widget_v2_emission_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
