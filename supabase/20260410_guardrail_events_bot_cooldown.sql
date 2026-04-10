-- Expands guardrail_events.event_type CHECK constraint to accept two new
-- values: 'guardrail_cooldown' (escalating cooldown auto-refusal) and
-- 'suspected_bot' (bot-detection flag).
--
-- Also adds an index on (stable_user_id, created_at DESC) for abuse-review
-- queries that filter by user and sort by time.
--
-- This migration MUST be applied before deploying the updated workflow.js
-- and rate-limit.js, otherwise new event inserts will fail the CHECK
-- constraint.

ALTER TABLE public.guardrail_events
  DROP CONSTRAINT IF EXISTS guardrail_events_event_type_check;

ALTER TABLE public.guardrail_events
  ADD CONSTRAINT guardrail_events_event_type_check
  CHECK (
    event_type IN (
      -- legacy values
      'allowed_with_caution',
      'medical_boundary',
      'disallowed_unsafe',
      'prompt_injection_or_system_probe',
      'off_topic',
      -- post-overhaul value
      'hard_refusal',
      -- new values
      'guardrail_cooldown',
      'suspected_bot'
    )
  );

CREATE INDEX IF NOT EXISTS guardrail_events_stable_user_id_created_at_idx
  ON public.guardrail_events (stable_user_id, created_at DESC);
