-- supabase/20260421_match_evidence_chunks_v3_materialized.sql
--
-- Hotfix for citation drop-out: Postgres 15 was inlining the `candidates`
-- CTE in match_evidence_chunks_v3, so instead of fetching the 30 nearest
-- neighbours via the HNSW index and THEN joining research_articles, the
-- planner hash-joined the full 2.7M-row evidence_chunks to the 1.2M-row
-- research_articles table, sorted on disk (~650 MB spill), and applied
-- the LIMIT last. Every realistic question took >10 s and hit PostgREST's
-- 15 s statement timeout → retrieveDatabaseEvidence threw, retrieve()
-- returned empty evidence, sources panel came up blank.
--
-- Two fixes combined:
--   1. AS MATERIALIZED on both CTEs — forces HNSW-first + tiny window agg.
--   2. LANGUAGE plpgsql instead of sql — a LANGUAGE sql function is
--      inline-able by the planner, which can unwind the CTE boundaries
--      and re-plan the whole thing (losing the MATERIALIZED hint).
--      plpgsql is an opaque function barrier that preserves the plan
--      we wrote.
--
-- Same signature, same return shape. Verified locally: ~130 ms for a
-- real embedding (was 84 s+ before the fix).

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.match_evidence_chunks_v3(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.70,
  match_count integer DEFAULT 8,
  p_include_preprints boolean DEFAULT true
)
RETURNS TABLE(
  id bigint,
  pmid bigint,
  chunk_type text,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
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
  ),
  filtered AS MATERIALIZED (
    SELECT
      c.id,
      c.pmid,
      c.chunk_type,
      c.content,
      c.similarity,
      c.distance,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(ra.doi, 'art-' || c.id::text)
        ORDER BY ra.peer_reviewed DESC, c.id ASC
      ) AS row_in_doi_group
    FROM candidates c
    JOIN public.research_articles ra ON ra.pmid = c.pmid
    WHERE ra.is_retracted = false
      AND ra.is_deleted   = false
      AND (p_include_preprints OR ra.peer_reviewed = true)
  )
  SELECT f.id, f.pmid, f.chunk_type, f.content, f.similarity
  FROM filtered f
  WHERE f.row_in_doi_group = 1
  ORDER BY f.distance ASC
  LIMIT match_count;
END;
$function$;
