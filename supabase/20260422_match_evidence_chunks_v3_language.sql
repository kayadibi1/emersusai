-- supabase/20260422_match_evidence_chunks_v3_language.sql
--
-- Adds an English-only filter to match_evidence_chunks_v3. Now that
-- research_articles.language is backfilled (franc-detected ISO 639-3),
-- the retrieval RPC excludes any non-English row from being cited as
-- evidence. The corpus still HOLDS those rows (some might be useful
-- for non-English audiences in the future) but they don't surface in
-- chat for our English-speaking users.
--
-- Why `('eng','sco')` instead of `'eng'`:
--   franc occasionally tags terse English titles as 'sco' (Scots), a
--   close-cousin language. Treating both as English avoids false-
--   negatives on legitimate short English titles.
--
-- Why `OR ra.language IS NULL`:
--   PubMed/EuropePMC/eLife/preprint sources are English-only by curation
--   and were not part of the franc backfill (they have language=NULL).
--   We treat NULL as "trusted English" for those sources. The aggregator
--   sources (openalex/openaire/core) all have language tagged after the
--   2026-04-22 backfill, so a NULL there means "not yet tagged" — also
--   safe to include during the rollout window.
--
-- Same signature, same return shape. Adds 2 WHERE clauses on indexed
-- columns (research_articles.language has a partial idx). Per-query
-- cost increase: nanoseconds.

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
      AND (ra.language IS NULL OR ra.language IN ('eng', 'sco'))
  )
  SELECT f.id, f.pmid, f.chunk_type, f.content, f.similarity
  FROM filtered f
  WHERE f.row_in_doi_group = 1
  ORDER BY f.distance ASC
  LIMIT match_count;
END;
$function$;
