-- supabase/20260417_recall_memory_rpc.sql
-- Phase 3 cross-thread memory recall RPC.
-- See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §5.3
-- and docs/superpowers/plans/2026-04-17-cross-thread-memory-phase-3.md.
--
-- Broader than retrieve_memory_rag (Phase 2):
--   - Searches ALL tiers (A-E + X), not just B/C/E/X
--   - Includes status in ('confirmed', 'resolved', 'archived') so
--     "remember when I had that shoulder thing?" surfaces history
--   - Accepts null embedding → category-only filter, recency-ordered
--
-- SECURITY INVOKER + search_path includes 'extensions' for pgvector <=>
-- (same fix as 20260417_memory_retrieval_rpcs.sql).

begin;

create or replace function public.recall_memory(
  p_user_id     uuid,
  p_embedding   vector(1536) default null,
  p_categories  text[]       default null,
  p_limit       int          default 6
)
returns table (
  id                uuid,
  category          text,
  tier              char(1),
  fact              text,
  metadata          jsonb,
  status            text,
  created_at        timestamptz,
  last_mentioned_at timestamptz,
  resolved_at       timestamptz,
  similarity        real
)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select
    m.id,
    m.category,
    m.tier,
    m.fact,
    m.metadata,
    m.status,
    m.created_at,
    m.last_mentioned_at,
    m.resolved_at,
    case
      when p_embedding is not null and m.fact_embedding is not null
        then (1 - (m.fact_embedding <=> p_embedding))::real
      else null
    end as similarity
  from public.user_memories m
  where m.user_id = p_user_id
    and m.status in ('confirmed', 'resolved', 'archived')
    and (
      p_categories is null
      or array_length(p_categories, 1) is null
      or m.category = any(p_categories)
    )
  order by
    -- When embedding present AND row has one: rank by semantic closeness.
    -- Rows without embedding (or when no embedding passed) sort NULLS last
    -- and then fall back to recency.
    case
      when p_embedding is not null and m.fact_embedding is not null
        then m.fact_embedding <=> p_embedding
    end asc nulls last,
    m.last_mentioned_at desc
  limit coalesce(p_limit, 6);
$$;

grant execute on function public.recall_memory(uuid, vector, text[], int) to authenticated, service_role;

commit;
