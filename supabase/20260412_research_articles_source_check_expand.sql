-- supabase/20260412_research_articles_source_check_expand.sql
--
-- Expand the research_articles.source CHECK allow-list to include the
-- new multi-source adapters (openalex, semantic-scholar, epistemonikos,
-- openaire, core). The original constraint only allowed the initial
-- seven sources (pubmed, europepmc, biorxiv, medrxiv, sportrxiv,
-- crossref, doaj), which blocks the Task 8/17 rollout of multi-source
-- ingestion.
--
-- See docs/superpowers/plans/2026-04-11-multi-source-enablement-plan.md

ALTER TABLE public.research_articles
  DROP CONSTRAINT IF EXISTS research_articles_source_check;

ALTER TABLE public.research_articles
  ADD CONSTRAINT research_articles_source_check
  CHECK (source = ANY (ARRAY[
    'pubmed',
    'europepmc',
    'biorxiv',
    'medrxiv',
    'sportrxiv',
    'crossref',
    'doaj',
    'openalex',
    'semantic-scholar',
    'epistemonikos',
    'openaire',
    'core'
  ]::text[]));
