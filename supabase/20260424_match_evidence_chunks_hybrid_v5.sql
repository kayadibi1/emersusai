-- supabase/20260424_match_evidence_chunks_hybrid_v5.sql
--
-- Hybrid dense + lexical retrieval via RRF fusion. Adds a BM25-style
-- lexical path on top of v4's HNSW dense retrieval to close the
-- vocabulary-gap failure mode diagnosed on 2026-04-23 (broad queries
-- like "sugar and athletic performance" miss specific-terminology
-- papers entirely — the relevant chunks are absent from the dense
-- top-50, not losing the rank race).
--
-- Approach:
--   * Expression index on to_tsvector('english', ec.content), GIN, built
--     CONCURRENTLY. No ALTER TABLE — no table rewrite, no write lock.
--     Index build runs ~hours on 3.34M rows; live traffic unaffected.
--   * New RPC match_evidence_chunks_hybrid_v5 runs dense + lexical in
--     parallel inside a single plpgsql function, merges by RRF (k=60),
--     preserves v4's source-dedupe + passage-substitution semantics,
--     returns the same row shape as v4 for drop-in A/B testing.
--   * Kept alongside v4; nothing removed. Feature-flag cutover in a
--     later migration once the matrix eval confirms the lift.
--
-- Apply order:
--   1. CREATE INDEX CONCURRENTLY — safe during live traffic.
--      Monitor: SELECT phase, blocks_done, blocks_total
--               FROM pg_stat_progress_create_index;
--   2. CREATE OR REPLACE FUNCTION — instant.
--   3. GRANT EXECUTE — instant.
--
-- Spec: docs/retrieval-research-2026-04-23.md §2 hybrid retrieval,
--       desktop doc retrieval_recall_solutions.md §2.

SET search_path = public, extensions;

-- ─── Lexical expression index ────────────────────────────────────────────────
-- NOTE: This is CREATE INDEX CONCURRENTLY and therefore CANNOT run inside a
-- transaction. Apply this statement by itself, e.g. via psql -c or as the
-- first statement when the surrounding migration runner disables implicit
-- transactions. On 3.34M rows of chunk content the build typically takes
-- 20-90 minutes and holds only a SHARE UPDATE EXCLUSIVE lock (no block on
-- reads or writes).

CREATE INDEX CONCURRENTLY IF NOT EXISTS evidence_chunks_content_tsv_gin_idx
  ON public.evidence_chunks
  USING GIN (to_tsvector('english', content));

-- ─── Hybrid RPC ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.match_evidence_chunks_hybrid_v5(
  query_embedding vector,
  query_text      text,
  match_threshold double precision DEFAULT 0.0,
  match_count     integer DEFAULT 10,
  p_include_preprints boolean DEFAULT true,
  p_rrf_k         integer DEFAULT 60,
  p_candidate_multiplier integer DEFAULT 10
)
RETURNS TABLE(
  id bigint,
  pmid bigint,
  chunk_type text,
  content text,
  similarity double precision,
  bm25_score double precision,
  rrf_score double precision,
  matched_chunk_type text,
  is_title_only_match boolean
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  wide_net integer := GREATEST(match_count * p_candidate_multiplier, 50);
BEGIN
  RETURN QUERY
  WITH dense_candidates AS MATERIALIZED (
    -- HNSW top-N by cosine similarity. Wider net than v4 (10x vs 5x) so the
    -- RRF fusion has both signals working over the same source pool before
    -- dedupe.
    SELECT
      ec.id,
      ec.pmid,
      ec.chunk_type,
      ec.content,
      1 - (ec.embedding <=> query_embedding) AS similarity,
      ec.embedding <=> query_embedding       AS distance,
      ROW_NUMBER() OVER (ORDER BY ec.embedding <=> query_embedding ASC) AS dense_rank
    FROM public.evidence_chunks ec
    WHERE ec.embedding IS NOT NULL
      AND (1 - (ec.embedding <=> query_embedding)) > match_threshold
    ORDER BY ec.embedding <=> query_embedding ASC
    LIMIT wide_net
  ),
  lexical_candidates AS MATERIALIZED (
    -- BM25-style ts_rank_cd over the GIN expression index. plainto_tsquery
    -- handles multi-word queries safely (no parse errors on stop words or
    -- punctuation). Empty query_text yields an empty set.
    SELECT
      ec.id,
      ec.pmid,
      ec.chunk_type,
      ec.content,
      ts_rank_cd(
        to_tsvector('english', ec.content),
        plainto_tsquery('english', query_text),
        32
      ) AS bm25_score,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('english', ec.content),
          plainto_tsquery('english', query_text),
          32
        ) DESC
      ) AS lexical_rank
    FROM public.evidence_chunks ec
    WHERE ec.content IS NOT NULL
      AND length(ec.content) > 0
      AND query_text IS NOT NULL
      AND length(trim(query_text)) > 0
      AND to_tsvector('english', ec.content)
          @@ plainto_tsquery('english', query_text)
    ORDER BY bm25_score DESC
    LIMIT wide_net
  ),
  -- RRF fusion: score(d) = Σ 1/(k + rank_i). Runs over the UNION of both
  -- candidate pools so a doc present in only one list still gets its
  -- contribution from that list alone. k=60 per Cormack et al. SIGIR 2009.
  fused AS MATERIALIZED (
    SELECT
      COALESCE(d.id, l.id)         AS id,
      COALESCE(d.pmid, l.pmid)     AS pmid,
      COALESCE(d.chunk_type, l.chunk_type) AS chunk_type,
      COALESCE(d.content, l.content)       AS content,
      COALESCE(d.similarity, 0.0)  AS similarity,
      COALESCE(l.bm25_score, 0.0)  AS bm25_score,
      (CASE WHEN d.id IS NOT NULL THEN 1.0 / (p_rrf_k + d.dense_rank)   ELSE 0.0 END) +
      (CASE WHEN l.id IS NOT NULL THEN 1.0 / (p_rrf_k + l.lexical_rank) ELSE 0.0 END)
        AS rrf_score,
      COALESCE(d.distance, 1.0)    AS distance
    FROM dense_candidates d
    FULL OUTER JOIN lexical_candidates l ON d.id = l.id
  ),
  joined AS MATERIALIZED (
    -- Apply v4's article-level filters: retraction, deletion, language,
    -- preprint policy. Preserves the grounding guarantees of v4 exactly.
    SELECT
      f.id,
      f.pmid,
      f.chunk_type,
      f.content,
      f.similarity,
      f.bm25_score,
      f.rrf_score,
      f.distance,
      ra.doi,
      ra.peer_reviewed
    FROM fused f
    JOIN public.research_articles ra ON ra.pmid = f.pmid
    WHERE ra.is_retracted = false
      AND ra.is_deleted   = false
      AND (p_include_preprints OR ra.peer_reviewed = true)
      AND (ra.language IS NULL OR ra.language IN ('eng', 'sco'))
  ),
  best_per_source AS MATERIALIZED (
    -- Source-centric dedup by DOI (fallback to pmid) — matches v4 exactly.
    -- Rank by rrf_score so the best-fused chunk per source wins.
    SELECT DISTINCT ON (COALESCE(j.doi, 'art-' || j.pmid::text))
      j.id,
      j.pmid,
      j.chunk_type AS matched_chunk_type,
      j.content    AS matched_content,
      j.similarity,
      j.bm25_score,
      j.rrf_score,
      j.distance,
      j.doi
    FROM joined j
    ORDER BY
      COALESCE(j.doi, 'art-' || j.pmid::text),
      j.rrf_score DESC,
      j.distance ASC
  ),
  passage_substituted AS MATERIALIZED (
    -- v4's passage-substitution: when the matched chunk was a title, look
    -- up the best non-title chunk for that pmid and return its content as
    -- the SHOWN content. Same LATERAL lookup as v4.
    SELECT
      bps.id,
      bps.pmid,
      bps.matched_chunk_type,
      bps.matched_content,
      bps.similarity,
      bps.bm25_score,
      bps.rrf_score,
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
    ps.bm25_score,
    ps.rrf_score,
    ps.matched_chunk_type,
    (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) AS is_title_only_match
  FROM passage_substituted ps
  ORDER BY
    CASE WHEN (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) THEN 1 ELSE 0 END,
    ps.rrf_score DESC
  LIMIT match_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_evidence_chunks_hybrid_v5(
  vector, text, double precision, integer, boolean, integer, integer
) TO authenticated, anon, service_role;
