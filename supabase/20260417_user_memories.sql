-- supabase/20260417_user_memories.sql
-- Cross-thread memory table — Phase 0 of the memory subsystem.
-- See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §4.1.
--
-- One new table, four indexes (3 partial btree + 1 partial HNSW), three RLS
-- policies (no DELETE — hard delete goes through delete_all_my_memories()),
-- and an extension of guardrail_events.event_type check constraint to allow
-- the 'memory_bulk_delete' audit value used by the delete function.

begin;

create extension if not exists vector;

-- ── Extend guardrail_events.event_type check to accept 'memory_bulk_delete'
-- The existing check (from 20260405_guardrail_events.sql) lists four values.
-- We drop-and-recreate; idempotent if this migration is re-applied.
alter table public.guardrail_events
  drop constraint if exists guardrail_events_event_type_check;

alter table public.guardrail_events
  add constraint guardrail_events_event_type_check
  check (event_type in (
    'allowed_with_caution',
    'medical_boundary',
    'disallowed_unsafe',
    'prompt_injection_or_system_probe',
    'memory_bulk_delete'
  ));

-- ── Table
create table public.user_memories (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  category              text not null,
  tier                  char(1) not null,
  fact                  text not null,
  fact_embedding        vector(1536),
  fact_embedding_model  text not null default 'text-embedding-3-small',
  metadata              jsonb not null default '{}'::jsonb,

  source                text not null,
  source_thread_id      uuid,
  source_turn_ref       text,
  confidence            numeric(3,2),

  status                text not null default 'pending',
  expires_at            timestamptz,
  supersedes_id         uuid references public.user_memories(id),
  created_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  resolved_at           timestamptz,
  last_mentioned_at     timestamptz not null default now(),

  constraint user_memories_category_valid check (category in (
    'injury','allergy','medication','chronic_condition','pregnancy_status','biological_constraint',
    'goal','target_metric','dietary_protocol','schedule_pattern','coach_program',
    'personal_record','completed_event',
    'deload_window','illness_recovery','travel_constraint','sleep_deficit',
    'exercise_preference','supplement_stack','equipment_inventory',
    'custom'
  )),
  constraint user_memories_status_valid check (status in (
    'pending','confirmed','rejected','resolved','archived'
  )),
  constraint user_memories_tier_valid check (tier in ('A','B','C','D','E','X')),
  constraint user_memories_source_valid check (source in ('auto_extract','explicit','onboarding')),
  constraint user_memories_fact_length check (char_length(fact) between 1 and 500)
);

-- ── Indexes (all partial — only confirmed rows reach retrieval)
create index user_memories_user_cat_status_idx
  on public.user_memories (user_id, category, status)
  where status = 'confirmed';

create index user_memories_user_tier_status_idx
  on public.user_memories (user_id, tier, status)
  where status = 'confirmed';

create index user_memories_user_expires_idx
  on public.user_memories (user_id, expires_at)
  where status = 'confirmed';

create index user_memories_embedding_idx
  on public.user_memories using hnsw (fact_embedding vector_cosine_ops)
  where status = 'confirmed';

-- ── RLS (owner-only select/insert/update; no DELETE policy)
alter table public.user_memories enable row level security;

create policy user_memories_owner_select on public.user_memories
  for select using (user_id = auth.uid());

create policy user_memories_owner_insert on public.user_memories
  for insert with check (user_id = auth.uid());

create policy user_memories_owner_update on public.user_memories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Hard-delete-all via SECURITY DEFINER function.
-- Audits to guardrail_events BEFORE deleting. No table-level DELETE policy —
-- this function is the only path that can remove rows on behalf of a user.
create or replace function public.delete_all_my_memories()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.guardrail_events (
    event_type, user_id, response_mode, question_preview, reasons, metadata
  )
  values (
    'memory_bulk_delete',
    v_uid,
    'system',
    'delete_all_my_memories()',
    '[]'::jsonb,
    jsonb_build_object(
      'count', (select count(*) from public.user_memories where user_id = v_uid),
      'requested_at', now()
    )
  );

  delete from public.user_memories where user_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_all_my_memories() from public;
grant execute on function public.delete_all_my_memories() to authenticated;

commit;
