-- supabase/20260422_research_articles_language.sql
--
-- Adds a `language` column to research_articles (ISO 639-3 code) so the
-- retrieval RPC can filter to English-only evidence. OpenAlex (+ OpenAIRE,
-- CORE) ingest broad scholarly aggregator content including grey
-- literature in dozens of languages — Indonesian sports-pedagogy theses,
-- Russian Лесгафт university notes, Turkish parenting tips, Spanish dorada
-- fish fatty-acid analyses, etc. They're indistinguishable from junk in
-- a chat context for English-speaking users.
--
-- Backfill is done by a one-shot Node script using the `franc` library
-- against (title || ' ' || abstract) — pure local CPU, no API calls. New
-- ingests capture work.language at the adapter layer.
--
-- The retrieval RPC v3 is updated separately to filter language='eng'
-- (or language IS NULL during the backfill window).

ALTER TABLE public.research_articles
  ADD COLUMN IF NOT EXISTS language text;

-- Partial index — most queries will look up "is this row English?", and
-- only ~1.3M of the 1.8M rows need language tagging (PubMed/EuropePMC are
-- already English-only by curation).
CREATE INDEX IF NOT EXISTS research_articles_language_idx
  ON public.research_articles (language)
  WHERE language IS NOT NULL;

COMMENT ON COLUMN public.research_articles.language IS
  'ISO 639-3 language code (eng, spa, ind, rus, tur, …). NULL for legacy rows
   not yet backfilled and for sources that are already English-only by
   curation (pubmed, europepmc, eLife, sportrxiv).';
