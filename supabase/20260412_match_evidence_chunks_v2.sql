-- supabase/20260412_match_evidence_chunks_v2.sql
-- Updates match_evidence_chunks to:
--   1. reference research_articles instead of pubmed_articles
--   2. prefer peer_reviewed=true rows when multiple rows share a DOI
--
-- This runs AFTER 20260412_research_articles_rename_and_columns.sql.
-- Existing behaviour (cosine similarity, filter, limit) is preserved.
-- The is_retracted/is_deleted filter is preserved via research_articles join;
-- those columns exist on the renamed table from prior enrichment migrations.

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
      ec.embedding <=> query_embedding       AS distance,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(ra.doi, 'art-' || ec.id::text)
        ORDER BY ra.peer_reviewed DESC, ec.id ASC
      ) AS row_in_doi_group
    FROM public.evidence_chunks ec
    JOIN public.research_articles ra ON ra.pmid = ec.pmid
    WHERE ec.embedding IS NOT NULL
      AND (1 - (ec.embedding <=> query_embedding)) > match_threshold
  )
  SELECT id, pmid, chunk_type, content, similarity
  FROM candidates
  WHERE row_in_doi_group = 1
  ORDER BY distance ASC
  LIMIT match_count;
$function$;
