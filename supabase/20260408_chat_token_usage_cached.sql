-- Add cached_prompt_tokens to chat_token_usage_events.
--
-- OpenAI's Responses API automatically caches stable prompt prefixes ≥1024
-- tokens at $0.10/1M (75% off the $0.40/1M base rate for gpt-4.1-mini). The
-- Emersus system prompt is byte-identical across requests and ~3.2k tokens
-- long, so this caching should be firing on every request after warmup. Until
-- this column existed our token-cost dashboards undercounted the savings by
-- ~40% because the reduction landed on the OpenAI bill but not in our log.
--
-- Default 0 keeps historical rows valid; new writes populate it from
-- usage.input_tokens_details.cached_tokens.

alter table public.chat_token_usage_events
  add column if not exists cached_prompt_tokens integer not null default 0
    check (cached_prompt_tokens >= 0);

comment on column public.chat_token_usage_events.cached_prompt_tokens is
  'Subset of prompt_tokens served from OpenAI''s automatic prompt cache at $0.10/1M (gpt-4.1-mini). Sourced from usage.input_tokens_details.cached_tokens.';
