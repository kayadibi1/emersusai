-- supabase/20260412_match_evidence_chunks_v2.sql
-- Updates match_evidence_chunks to:
--   1. reference research_articles instead of pubmed_articles
--   2. prefer peer_reviewed=true rows when multiple rows share a DOI
--   3. preserve the retracted/deleted filter from the v1 function
--      (20260410_match_evidence_chunks_retraction_filter.sql)
--
-- This runs AFTER 20260412_research_articles_rename_and_columns.sql.
-- The is_retracted/is_deleted columns were added to pubmed_articles by
-- 20260410_pubmed_articles_enrichment.sql and survive the table rename.
--
-- Access pattern: same as v1 — pgvector's index-ordered scan is the fast
-- part, so we LIMIT the CTE to 3x match_count (min 24) to bound the
-- scan, then apply the post-scan filters (retraction, deletion, DOI dedup).
-- 3x headroom covers the combined attrition from retraction (~0.09%) and
-- DOI dedup (near 0% initially, may grow as multi-source ingestion lands).

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
  ),
  filtered AS (
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
  )
  SELECT id, pmid, chunk_type, content, similarity
  FROM filtered
  WHERE row_in_doi_group = 1
  ORDER BY distance ASC
  LIMIT match_count;
$function$;
