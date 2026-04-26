-- Per-claim grounding-mode classifications, keyed to chat_grounding_samples
-- Writer: Sid (2026-04-26)
-- Spec: docs/superpowers/specs/2026-04-26-grounding-mode-classification-design.md

create table if not exists public.chat_claim_modes (
  id                              bigserial primary key,
  sample_id                       bigint not null references public.chat_grounding_samples(id) on delete cascade,
  claim_text                      text not null,
  cited_source_ids                int[] not null default '{}',
  source_scores_json              jsonb not null default '[]'::jsonb,
  mode                            text,
  qualifier_diff_json             jsonb,
  alternate_supporting_sources    jsonb,
  judge_model                     text,
  judge_prompt_version            text,
  grading_status                  text not null default 'ok',
  created_at                      timestamptz not null default now(),

  constraint chat_claim_modes_mode_check check (
    mode is null or mode in (
      'correct',
      'mode_1_misattribution',
      'mode_2_overgen',
      'mode_3_fabrication',
      'mode_4_contradicted',
      'no_marker'
    )
  ),
  constraint chat_claim_modes_status_check check (
    grading_status in ('ok', 'judge_error', 'malformed_json', 'partial')
  )
);

create index if not exists chat_claim_modes_sample_idx
  on public.chat_claim_modes (sample_id);

create index if not exists chat_claim_modes_mode_created_idx
  on public.chat_claim_modes (mode, created_at desc)
  where grading_status = 'ok';

create index if not exists chat_claim_modes_version_idx
  on public.chat_claim_modes (judge_prompt_version, created_at desc);

-- Idempotency: skip claims already graded successfully under the same prompt version
create unique index if not exists chat_claim_modes_idem_idx
  on public.chat_claim_modes (sample_id, md5(claim_text), judge_prompt_version)
  where grading_status = 'ok';
