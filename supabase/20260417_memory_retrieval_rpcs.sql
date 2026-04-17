-- supabase/20260417_memory_retrieval_rpcs.sql
-- Phase 2 cross-thread memory retrieval RPCs.
-- See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §6
-- and docs/superpowers/plans/2026-04-16-cross-thread-memory-phase-2.md.
--
-- Three SECURITY INVOKER functions. When called by the service-role fetch
-- path, RLS is bypassed but scoping is enforced by explicit p_user_id.
-- When called by an authenticated client JWT, RLS adds per-user isolation
-- on top. Callable from both worlds.

begin;

-- ── 1. Always-inject: Tier A + active Tier D ──────────────────────────
create or replace function public.retrieve_memory_always_inject(
  p_user_id uuid
)
returns table (
  id                uuid,
  category          text,
  tier              char(1),
  fact              text,
  metadata          jsonb,
  confirmed_at      timestamptz,
  expires_at        timestamptz
)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select id, category, tier, fact, metadata, confirmed_at, expires_at
  from public.user_memories
  where user_id = p_user_id
    and status = 'confirmed'
    and (
      tier = 'A'
      or (tier = 'D' and (expires_at is null or expires_at > now()))
    )
  order by confirmed_at asc
  limit 25;
$$;

-- ── 2. RAG kNN over Tier B/C/E/X confirmed rows ───────────────────────
-- Returns top-K ranked by cosine similarity. Caller applies the min-similarity
-- threshold client-side (different thresholds per retrieval channel per §6.8).
create or replace function public.retrieve_memory_rag(
  p_user_id   uuid,
  p_embedding vector(1536),
  p_limit     int default 6
)
returns table (
  id                uuid,
  category          text,
  tier              char(1),
  fact              text,
  metadata          jsonb,
  last_mentioned_at timestamptz,
  similarity        real
)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select
    id,
    category,
    tier,
    fact,
    metadata,
    last_mentioned_at,
    (1 - (fact_embedding <=> p_embedding))::real as similarity
  from public.user_memories
  where user_id = p_user_id
    and status = 'confirmed'
    and tier in ('B', 'C', 'E', 'X')
    and fact_embedding is not null
    and (expires_at is null or expires_at > now())
  order by fact_embedding <=> p_embedding
  limit coalesce(p_limit, 6);
$$;

-- ── 3. Refresh-on-mention ─────────────────────────────────────────────
-- Fire-and-forget from retrieveMemory. Bumps last_mentioned_at and extends
-- expires_at per tier TTL. Tier A + C (indefinite) untouched.
create or replace function public.refresh_memory_mentions(
  p_user_id     uuid,
  p_memory_ids  uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_memory_ids is null or array_length(p_memory_ids, 1) is null then
    return 0;
  end if;

  update public.user_memories
  set
    last_mentioned_at = now(),
    expires_at = case
      when tier = 'B' then now() + interval '120 days'
      when tier = 'D' then now() + interval '21 days'
      when tier = 'E' then now() + interval '180 days'
      else expires_at
    end
  where id = any(p_memory_ids)
    and user_id = p_user_id
    and status = 'confirmed';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.retrieve_memory_always_inject(uuid)        to authenticated, service_role;
grant execute on function public.retrieve_memory_rag(uuid, vector, int)     to authenticated, service_role;
grant execute on function public.refresh_memory_mentions(uuid, uuid[])      to authenticated, service_role;

commit;
