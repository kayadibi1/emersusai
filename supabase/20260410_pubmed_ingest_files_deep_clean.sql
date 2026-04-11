-- Deep-clean pubmed_ingest_files.
--
-- The table accumulated overlapping columns across several sessions
-- (file_name + filename, success + status, processed_at + completed_at +
-- created_at + updated_at) and a check constraint on file_kind that
-- rejected every default-and-code-path write. As a result, the table
-- has been empty since it was created — scripts/import-pubmed.js catches
-- the insert error and emits a warning ("ingest log skipped"), so the
-- breakage went unnoticed.
--
-- This migration drops the dead weight and leaves exactly the columns
-- that scripts/import-pubmed.js actually populates. Because the table
-- is empty, dropping columns is safe; an abort guard below refuses to
-- run if any row exists, so this stays idempotent if run in a future
-- environment where the table has been repopulated.

DO $$
DECLARE
  row_count bigint;
BEGIN
  SELECT count(*) INTO row_count FROM public.pubmed_ingest_files;
  IF row_count > 0 THEN
    RAISE EXCEPTION
      'pubmed_ingest_files has % row(s); this migration assumes the table is empty. Review row contents before dropping columns.',
      row_count;
  END IF;
END $$;

ALTER TABLE public.pubmed_ingest_files
  DROP CONSTRAINT IF EXISTS pubmed_ingest_files_file_kind_check;

ALTER TABLE public.pubmed_ingest_files
  DROP COLUMN IF EXISTS file_kind,
  DROP COLUMN IF EXISTS filename,
  DROP COLUMN IF EXISTS success,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS completed_at;
