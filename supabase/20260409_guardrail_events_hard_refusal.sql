-- Loosens the guardrail_events.event_type CHECK constraint to accept the
-- new collapsed `hard_refusal` value while keeping every legacy value
-- valid for historical rows.
--
-- Context: workflow.js classifySafety was rewritten to emit a binary
-- {allowed, hard_refusal} state instead of the previous 5-state machine.
-- All hard_refusal rows now carry the specific sub-category in the
-- `reasons` JSONB column (one of: self_harm_or_ed_crisis,
-- ped_protocol_or_sourcing, medication_dosing_or_prescription,
-- prompt_injection_or_system_probe, off_topic_non_fitness).
--
-- This migration MUST be applied before deploying the new workflow.js,
-- otherwise every refusal-event insert silently fails the CHECK constraint
-- and we lose telemetry. The reverse order (code first, migration later)
-- is not safe.

alter table public.guardrail_events
  drop constraint if exists guardrail_events_event_type_check;

alter table public.guardrail_events
  add constraint guardrail_events_event_type_check
  check (
    event_type in (
      -- legacy values, kept so historical rows still validate
      'allowed_with_caution',
      'medical_boundary',
      'disallowed_unsafe',
      'prompt_injection_or_system_probe',
      'off_topic',
      -- post-overhaul value
      'hard_refusal'
    )
  );
