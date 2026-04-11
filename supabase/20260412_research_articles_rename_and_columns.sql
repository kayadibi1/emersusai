-- supabase/20260412_research_articles_rename_and_columns.sql
-- Renames pubmed_articles -> research_articles and adds multi-source columns.
-- Must run BEFORE 20260412_match_evidence_chunks_v2.sql (which references the new name).

BEGIN;

ALTER TABLE public.pubmed_articles RENAME TO research_articles;

-- Rename the pmid index to match the new table name for clarity
ALTER INDEX IF EXISTS pubmed_articles_pmid_idx RENAME TO research_articles_pmid_idx;

ALTER TABLE public.research_articles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pubmed'
    CHECK (source IN ('pubmed', 'europepmc', 'biorxiv', 'medrxiv', 'sportrxiv', 'crossref', 'doaj')),
  ADD COLUMN IF NOT EXISTS peer_reviewed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb;

-- Backfill external_id for existing pubmed rows
UPDATE public.research_articles
   SET external_id = pmid::text
 WHERE source = 'pubmed' AND external_id IS NULL;

-- Enforce uniqueness per source
CREATE UNIQUE INDEX IF NOT EXISTS research_articles_source_external_id_uniq
  ON public.research_articles(source, external_id);

-- DOI index for cross-source dedup lookups
CREATE INDEX IF NOT EXISTS research_articles_doi_idx
  ON public.research_articles(doi)
  WHERE doi IS NOT NULL;

COMMIT;
