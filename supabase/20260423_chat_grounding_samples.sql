-- chat_grounding_samples: periodic prod samples of (question, sources,
-- answer, grounding) so we can detect drift in citation quality without
-- re-running the full 100-prompt eval. Written by workflow.js at a rate
-- controlled by env var GROUNDING_SAMPLE_RATE (0.0 .. 1.0, default 0).
-- Graded asynchronously by scripts/grade-grounding-samples.js which
-- populates grader_result + graded_at.

CREATE TABLE IF NOT EXISTS public.chat_grounding_samples (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  thread_id       text,
  message_id      text,
  question        text NOT NULL,
  sources_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer          text NOT NULL,
  grounding_json  jsonb,
  model           text,
  graded_at       timestamptz,
  grader_result   jsonb
);

CREATE INDEX IF NOT EXISTS chat_grounding_samples_created_at_idx
  ON public.chat_grounding_samples (created_at DESC);

CREATE INDEX IF NOT EXISTS chat_grounding_samples_ungraded_idx
  ON public.chat_grounding_samples (created_at)
  WHERE graded_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_grounding_samples_user_id_idx
  ON public.chat_grounding_samples (user_id)
  WHERE user_id IS NOT NULL;

-- No RLS policies — this table is service-role-only. Never reached from
-- the browser. Regular users' RLS cannot read or write this table.
ALTER TABLE public.chat_grounding_samples ENABLE ROW LEVEL SECURITY;
