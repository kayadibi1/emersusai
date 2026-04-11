-- Enrich pubmed_articles with credibility and impact signals.
--
-- Safety fields (Tier 1):
--   is_retracted, retraction_notes — block retracted papers from being
--     surfaced by retrieval. Parsed from PubMed XML
--     <CommentsCorrectionsList RefType="RetractionIn"> elements on ingest.
--   abstract_sections              — structured BACKGROUND/METHODS/RESULTS/
--     CONCLUSIONS keyed jsonb object, parsed from PubMed
--     <AbstractText Label="..."> elements. Lets chunking prioritize the
--     sections that contain findings (RESULTS, CONCLUSIONS) over the ones
--     that only set up the study (BACKGROUND, METHODS).
--   rcr                            — NIH iCite Relative Citation Ratio,
--     field-normalized impact metric (1.0 = average for field, 2.0 = twice
--     as cited as peers). Populated by scripts/backfill-icite-rcr.js via
--     the free iCite API.
--
-- Citation metrics:
--   citation_count                 — raw cite count from Semantic Scholar.
--   influential_citation_count     — Semantic Scholar's algorithmic
--     subset of "influential" citations (not all cites are equal).
--   Both populated by scripts/backfill-semantic-scholar.js.
--
-- Geographic metadata:
--   publication_country            — from PubMed <MedlineJournalInfo><Country>.
--     Useful for noting geographic concentration of evidence and for
--     filtering in edge cases.

ALTER TABLE public.pubmed_articles
  ADD COLUMN IF NOT EXISTS is_retracted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retraction_notes text,
  ADD COLUMN IF NOT EXISTS abstract_sections jsonb,
  ADD COLUMN IF NOT EXISTS rcr numeric,
  ADD COLUMN IF NOT EXISTS citation_count integer,
  ADD COLUMN IF NOT EXISTS influential_citation_count integer,
  ADD COLUMN IF NOT EXISTS publication_country text;

-- Partial index so retrieval can cheaply filter out retracted papers
-- (only retracted rows end up in the index).
CREATE INDEX IF NOT EXISTS pubmed_articles_is_retracted_idx
  ON public.pubmed_articles (is_retracted)
  WHERE is_retracted = true;

-- Partial index for RCR-based ranking (NULLs excluded — they're the vast
-- majority during backfill and don't need to be in the index).
CREATE INDEX IF NOT EXISTS pubmed_articles_rcr_idx
  ON public.pubmed_articles (rcr DESC NULLS LAST)
  WHERE rcr IS NOT NULL;
