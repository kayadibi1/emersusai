-- Fix pgvector operator resolution for match_evidence_chunks.
--
-- On the self-hosted Supabase (Hetzner), pgvector is installed in the
-- `extensions` schema, but this function had no explicit search_path.
-- Supabase REST/RPC calls use search_path = public by default, so the
-- <=> (cosine distance) operator was invisible at runtime:
--
--   operator does not exist: extensions.vector <=> extensions.vector
--
-- The only change is adding SET search_path = public, extensions.
-- Function body, signature, and defaults are identical to the original
-- from the cloud_dump.sql import.

CREATE OR REPLACE FUNCTION public.match_evidence_chunks(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.70,
  match_count integer DEFAULT 8
)
RETURNS TABLE(id bigint, pmid bigint, chunk_type text, content text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  select
    ec.id,
    ec.pmid,
    ec.chunk_type,
    ec.content,
    1 - (ec.embedding <=> query_embedding) as similarity
  from public.evidence_chunks ec
  where ec.embedding is not null
    and 1 - (ec.embedding <=> query_embedding) > match_threshold
  order by ec.embedding <=> query_embedding asc
  limit match_count;
$function$;
