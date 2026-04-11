-- supabase/20260412_match_evidence_chunks_v2_perf_hotfix.sql
-- Hotfix applied in prod 2026-04-11 after phase 1 deploy.
--
-- The v2 function in 20260412_match_evidence_chunks_v2.sql used a
-- two-CTE structure with ROW_NUMBER() OVER (PARTITION BY doi) to
-- preference peer-reviewed rows when duplicate DOIs exist. This
-- triggered a query planner pathology: the same query body run
-- directly against the DB took 14-18ms, but executed through the
-- LANGUAGE sql STABLE function it took 30+ seconds and timed out
-- under the API's statement_timeout.
--
-- Root cause: the function's SET search_path clause forces a generic
-- plan; the two-CTE + window-function shape prevented some pgvector
-- HNSW index optimization that v1's single-CTE shape enjoyed. Direct
-- query was fast because the planner saw the full context at once.
--
-- Fix: restore v1's query shape (single CTE + direct JOIN + ORDER BY
-- + LIMIT). Drop the DOI dedup — it was purely defensive coverage for
-- future multi-source rows, and right now every row is source=pubmed
-- so duplicate DOIs are structurally impossible. We can re-introduce
-- the dedup as a post-query filter when multi-source ingestion lands
-- its first non-pubmed row. Tracked as a follow-up.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.match_evidence_chunks(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.70,
  match_count integer DEFAULT 8
)
RETURNS TABLE(
  id bigint,
  pmid bigint,
  chunk_type text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH candidates AS (
    SELECT
      ec.id,
      ec.pmid,
      ec.chunk_type,
      ec.content,
      1 - (ec.embedding <=> query_embedding) AS similarity,
      ec.embedding <=> query_embedding       AS distance
    FROM public.evidence_chunks ec
    WHERE ec.embedding IS NOT NULL
      AND (1 - (ec.embedding <=> query_embedding)) > match_threshold
    ORDER BY ec.embedding <=> query_embedding ASC
    LIMIT GREATEST(match_count * 3, 24)
  )
  SELECT
    c.id,
    c.pmid,
    c.chunk_type,
    c.content,
    c.similarity
  FROM candidates c
  JOIN public.research_articles ra ON ra.pmid = c.pmid
  WHERE ra.is_retracted = false
    AND ra.is_deleted   = false
  ORDER BY c.distance ASC
  LIMIT match_count;
$function$;
