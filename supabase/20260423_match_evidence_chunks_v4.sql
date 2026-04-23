-- supabase/20260423_match_evidence_chunks_v4.sql
--
-- Source-centric evidence retrieval. Returns one row per source (deduped by
-- DOI / pmid) with passage substitution: when the chunk that matched the
-- query was a title chunk, the function looks up the best non-title chunk
-- for that pmid and returns that as the SHOWN content. When the source has
-- no non-title chunk indexed at all, is_title_only_match=true and the
-- caller renders an honest "title-only" fallback in the UI.
--
-- Why a parallel RPC instead of mutating v3:
--   v3 stays callable as the immediate rollback path during the eval-gated
--   cutover. After 1 week of v4 in production with no regressions, v3 is
--   dropped in a follow-up migration.
--
-- Performance:
--   Adds an indexed pmid lookup per candidate source (typically 8–10 calls
--   via LATERAL). evidence_chunks already has a btree index on pmid.
--   Estimated overhead: 5–15 ms per RPC call on top of v3's ~130 ms.
--
-- Spec: docs/superpowers/specs/2026-04-22-evidence-retrieval-source-centric-design.md

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.match_evidence_chunks_v4(
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
  similarity double precision,
  matched_chunk_type text,
  is_title_only_match boolean
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    -- Top-N nearest neighbors by HNSW. Wider net (5x) than v3's (3x) so
    -- the per-source dedupe + substitution downstream has options.
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
    LIMIT GREATEST(match_count * 5, 40)
  ),
  joined AS MATERIALIZED (
    SELECT
      c.id,
      c.pmid,
      c.chunk_type,
      c.content,
      c.similarity,
      c.distance,
      ra.doi,
      ra.peer_reviewed
    FROM candidates c
    JOIN public.research_articles ra ON ra.pmid = c.pmid
    WHERE ra.is_retracted = false
      AND ra.is_deleted   = false
      AND (p_include_preprints OR ra.peer_reviewed = true)
      AND (ra.language IS NULL OR ra.language IN ('eng', 'sco'))
  ),
  best_per_source AS MATERIALIZED (
    -- Per source (DOI when available, else pmid), keep the highest-similarity
    -- chunk that matched the query. DISTINCT ON drops other chunks for the
    -- same source from the candidate pool.
    SELECT DISTINCT ON (COALESCE(j.doi, 'art-' || j.pmid::text))
      j.id,
      j.pmid,
      j.chunk_type AS matched_chunk_type,
      j.content    AS matched_content,
      j.similarity,
      j.distance,
      j.doi
    FROM joined j
    ORDER BY
      COALESCE(j.doi, 'art-' || j.pmid::text),
      j.distance ASC
  ),
  passage_substituted AS MATERIALIZED (
    -- For each best-per-source row, look up the best non-title chunk for
    -- that pmid in evidence_chunks (NOT just the candidate pool). This
    -- substitutes the displayed content when the matching chunk was a
    -- title. Preference order: abstract > full_text > abstract_*.
    -- LATERAL keeps this to one indexed lookup per pmid.
    SELECT
      bps.id,
      bps.pmid,
      bps.matched_chunk_type,
      bps.matched_content,
      bps.similarity,
      sub.id          AS sub_id,
      sub.chunk_type  AS sub_chunk_type,
      sub.content     AS sub_content
    FROM best_per_source bps
    LEFT JOIN LATERAL (
      SELECT ec2.id, ec2.chunk_type, ec2.content
      FROM public.evidence_chunks ec2
      WHERE ec2.pmid = bps.pmid
        AND ec2.chunk_type <> 'title'
      ORDER BY
        CASE ec2.chunk_type
          WHEN 'abstract'             THEN 0
          WHEN 'full_text'            THEN 1
          WHEN 'abstract_conclusions' THEN 2
          WHEN 'abstract_results'     THEN 3
          WHEN 'abstract_methods'     THEN 4
          WHEN 'abstract_background'  THEN 5
          WHEN 'abstract_other'       THEN 6
          ELSE 7
        END
      LIMIT 1
    ) sub ON TRUE
  )
  SELECT
    -- When the matching chunk was a title AND we found a non-title sibling,
    -- return the sibling's id/chunk_type/content. Otherwise return the
    -- matching chunk as-is.
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_id IS NOT NULL
         THEN ps.sub_id
         ELSE ps.id
    END AS id,
    ps.pmid,
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_chunk_type IS NOT NULL
         THEN ps.sub_chunk_type
         ELSE ps.matched_chunk_type
    END AS chunk_type,
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_content IS NOT NULL
         THEN ps.sub_content
         ELSE ps.matched_content
    END AS content,
    ps.similarity,
    ps.matched_chunk_type,
    -- True only when matched chunk was title AND no non-title sibling exists.
    (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) AS is_title_only_match
  FROM passage_substituted ps
  ORDER BY
    -- Demote title-only matches to the tail.
    CASE WHEN (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) THEN 1 ELSE 0 END,
    ps.similarity DESC
  LIMIT match_count;
END;
$function$;

-- Grant execution to the same roles that can call v3.
GRANT EXECUTE ON FUNCTION public.match_evidence_chunks_v4(vector, double precision, integer, boolean)
  TO authenticated, anon, service_role;
