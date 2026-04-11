-- Add a retraction + soft-delete filter to match_evidence_chunks so
-- retrieval never surfaces a retracted or deleted paper.
--
-- Previous version:
--   SELECT from evidence_chunks, filter by cosine sim, ORDER BY
--   distance LIMIT match_count. No awareness of is_retracted.
--
-- New version uses a CTE to fetch 3x the requested count as pgvector
-- candidates, then JOINs pubmed_articles to filter. This keeps the
-- pgvector index as the primary access path (its index-ordered scan
-- is the fast part) and applies a cheap filter post-scan. 3x headroom
-- is overkill for the current retraction rate (~0.09%) but insures
-- against future growth and leaves room for additional filters later
-- without another round-trip.
--
-- ORDER BY distance ASC is preserved end-to-end so the top-K returned
-- are exactly the closest non-retracted non-deleted matches.

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
  JOIN public.pubmed_articles pa ON pa.pmid = c.pmid
  WHERE pa.is_retracted = false
    AND pa.is_deleted   = false
  ORDER BY c.distance ASC
  LIMIT match_count;
$function$;
