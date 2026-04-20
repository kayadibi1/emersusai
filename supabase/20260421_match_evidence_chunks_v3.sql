-- supabase/20260421_match_evidence_chunks_v3.sql
--
-- Adds `match_evidence_chunks_v3` with an optional `p_include_preprints`
-- parameter. When false, the RPC filters evidence to peer-reviewed
-- sources only — the Free-tier experience. Pro users keep the full
-- pool (peer-reviewed + preprints).
--
-- Same body as v2 (20260412_match_evidence_chunks_v2.sql) with one
-- extra WHERE clause. v2 stays around so old clients don't break; the
-- pipeline switches to v3 in the same deploy.

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
      AND (p_include_preprints OR ra.peer_reviewed = true)
  )
  SELECT id, pmid, chunk_type, content, similarity
  FROM filtered
  WHERE row_in_doi_group = 1
  ORDER BY distance ASC
  LIMIT match_count;
$function$;
