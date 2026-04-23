-- scripts/build-fitness-centroid.sql
--
-- Computes the 'fitness_v1' centroid as the average embedding of all
-- chunks from 21 gold-standard fitness/nutrition journals
-- (~146k chunks). Idempotent — ON CONFLICT replaces.
--
-- Both PubMed and OpenAlex casing variants of each journal are listed
-- because the same journal appears under both forms across our sources.

WITH gold_journals AS (
  SELECT unnest(ARRAY[
    'Medicine and science in sports and exercise',
    'Medicine & Science in Sports & Exercise',
    'Journal of strength and conditioning research',
    'The Journal of Strength and Conditioning Research',
    'Sports medicine',
    'Sports Medicine',
    'British journal of sports medicine',
    'British Journal of Sports Medicine',
    'European journal of applied physiology',
    'European Journal of Applied Physiology',
    'Journal of sports sciences',
    'International journal of sports physiology and performance',
    'Scandinavian journal of medicine & science in sports',
    'Journal of the International Society of Sports Nutrition',
    'The American journal of clinical nutrition',
    'American Journal of Clinical Nutrition',
    'The Journal of nutrition',
    'Journal of Nutrition',
    'Nutrients',
    'Clinical nutrition',
    'Clinical Nutrition'
  ]) AS j
)
INSERT INTO public.corpus_centroids (id, centroid, built_from_n, built_from_jrnl, notes)
SELECT
  'fitness_v1',
  avg(ec.embedding),
  count(*),
  (SELECT array_agg(j) FROM gold_journals),
  '146k chunks from 21 gold-standard fitness/nutrition journals'
FROM evidence_chunks ec
JOIN research_articles ra ON ra.pmid = ec.pmid
WHERE ra.journal IN (SELECT j FROM gold_journals)
  AND ec.embedding IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  centroid        = EXCLUDED.centroid,
  built_from_n    = EXCLUDED.built_from_n,
  built_from_jrnl = EXCLUDED.built_from_jrnl,
  built_at        = now(),
  notes           = EXCLUDED.notes;
