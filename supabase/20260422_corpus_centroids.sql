-- supabase/20260422_corpus_centroids.sql
--
-- Holds named centroid vectors used as quality/relevance signals against
-- evidence_chunks.embedding. v1 use case: detect off-topic openalex /
-- openaire / core content via cosine distance to the average of ~146k
-- gold-standard fitness/nutrition chunks (MSSE, JSCR, Sports Medicine,
-- BJSM, AJCN, Nutrients, etc.).
--
-- Schema is forward-compatible — multiple centroid IDs (fitness_v1,
-- fitness_v2, …) can coexist. Build script keys on `id` and uses
-- ON CONFLICT to make re-runs idempotent.

CREATE TABLE IF NOT EXISTS public.corpus_centroids (
  id              text PRIMARY KEY,
  centroid        vector(1536) NOT NULL,
  built_from_n    int NOT NULL,
  built_from_jrnl text[] NOT NULL,
  built_at        timestamptz NOT NULL DEFAULT now(),
  notes           text
);

COMMENT ON TABLE public.corpus_centroids IS
  'Named pgvector centroids for quality/relevance scoring. See
   docs/superpowers/specs/2026-04-22-corpus-centroid-filter-design.md.';
