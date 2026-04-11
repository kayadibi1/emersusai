-- supabase/20260412_research_articles_synthetic_pmid_sequence.sql
--
-- Synthetic PMID allocator for non-pubmed ingestion sources.
-- Lets us keep research_articles.pmid as bigint NOT NULL PRIMARY KEY
-- while still ingesting papers from europepmc, biorxiv, openalex, etc.
-- Starts at 10^10 to leave 60+ years of collision-free headroom before
-- brushing real PubMed IDs (currently ~42M, growing ~1M/year).
--
-- See docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md

CREATE SEQUENCE IF NOT EXISTS public.research_articles_synthetic_pmid_seq
  START WITH 10000000000
  INCREMENT BY 1
  NO CYCLE;

GRANT USAGE, SELECT ON SEQUENCE public.research_articles_synthetic_pmid_seq
  TO supabase_admin, postgres, authenticated, service_role;

COMMENT ON SEQUENCE public.research_articles_synthetic_pmid_seq IS
  'Synthetic pmid allocator for non-pubmed sources. See docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md';
