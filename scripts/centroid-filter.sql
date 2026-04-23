-- scripts/centroid-filter.sql
--
-- Soft-deletes openalex/openaire/core papers whose minimum chunk distance
-- to the fitness_v1 centroid exceeds 0.60. Per the 2026-04-22 brainstorm,
-- this drops ~169k off-topic papers (plant biology, business management,
-- composting, anthropology, nuclear engineering, etc.) that slipped past
-- topic / language / publisher / source-type filters.
--
-- Reversible: re-run with a different threshold by editing the WHERE
-- clause; or restore via UPDATE … SET is_deleted=false WHERE pmid IN (…)
-- using the saved drop list (centroid-drops-2026-04-22.csv).

WITH scored AS (
  SELECT ec.pmid,
         MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec
  JOIN research_articles ra ON ra.pmid = ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted = false
    AND ec.embedding IS NOT NULL
  GROUP BY ec.pmid
),
to_drop AS (
  SELECT pmid FROM scored WHERE min_dist > 0.60
)
UPDATE research_articles
SET is_deleted = true
WHERE pmid IN (SELECT pmid FROM to_drop);
