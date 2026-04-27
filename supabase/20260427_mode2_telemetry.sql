-- supabase/20260427_mode2_telemetry.sql
-- Mode-2 Qualifier-Preservation Verifier (MQPV) telemetry columns.
-- Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md §5

ALTER TABLE chat_grounding_samples
  ADD COLUMN IF NOT EXISTS synthetic boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode2_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode2_rewrites_attempted smallint,
  ADD COLUMN IF NOT EXISTS mode2_initial_failures int,
  ADD COLUMN IF NOT EXISTS mode2_after_r1_failures int,
  ADD COLUMN IF NOT EXISTS mode2_final_failures int,
  ADD COLUMN IF NOT EXISTS mode2_extraction_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_validation_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_rewrite_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_extraction_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_validation_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_rewrite_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_total_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_qualifiers_dropped_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS mode2_pre_prose text,
  ADD COLUMN IF NOT EXISTS mode2_post_prose text,
  ADD COLUMN IF NOT EXISTS mode2_validation_json jsonb;

-- Index for trend reports filtering synthetic vs real
CREATE INDEX IF NOT EXISTS idx_chat_grounding_samples_synthetic_created
  ON chat_grounding_samples (synthetic, created_at DESC);

-- Index for mode2_enabled filtering (early A/B comparison)
CREATE INDEX IF NOT EXISTS idx_chat_grounding_samples_mode2_enabled
  ON chat_grounding_samples (mode2_enabled, created_at DESC)
  WHERE mode2_enabled = true;

COMMENT ON COLUMN chat_grounding_samples.synthetic IS 'true = bench-generated row; false = real-prod sampled row';
COMMENT ON COLUMN chat_grounding_samples.mode2_enabled IS 'whether the MQPV pipeline ran for this chat';
COMMENT ON COLUMN chat_grounding_samples.mode2_qualifiers_dropped_breakdown IS '{[qualifier_type]: count} aggregated across all claims this chat';
