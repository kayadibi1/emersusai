-- scripts/openalex-bulk/seo-probe.sql
-- Probes remaining kept OpenAlex/OpenAIRE/CORE rows for SEO/marketing
-- patterns. Only looks at type=article (the legitimate-seeming ones
-- that could harbor English-titled SEO content).

SELECT COUNT(*) AS suspect_patterns FROM research_articles
WHERE source IN ('openalex','openaire','core') AND is_deleted=false
  AND language IN ('eng','sco')
  AND source_metadata->>'type' = 'article'
  AND (
    title ~ '[A-Za-z][A-Za-z0-9 ]+ \| [A-Za-z]'
    OR title ~* '(review|guide|buy|best|top|ultimate)\M.{0,30}\M(20[2-9][0-9])\M'
    OR title ~* '^(top|best) [0-9]+[ \-]'
    OR title ~* '^[0-9]+ (ways|reasons|tips|foods|supplements|exercises)'
    OR title ~* '(natural|powerful|proven|clinically proven).{0,40}(muscle|fat|testosterone|growth|performance)'
    OR title ~* '(lose weight|burn fat|build muscle).{0,20}(fast|quickly|in [0-9])'
  );

-- And show a sample
SELECT pmid, COALESCE(journal, '(no journal)') AS j, left(title, 90) AS title
FROM research_articles
WHERE source IN ('openalex','openaire','core') AND is_deleted=false
  AND language IN ('eng','sco')
  AND source_metadata->>'type' = 'article'
  AND (
    title ~ '[A-Za-z][A-Za-z0-9 ]+ \| [A-Za-z]'
    OR title ~* '(review|guide|buy|best|top|ultimate)\M.{0,30}\M(20[2-9][0-9])\M'
    OR title ~* '^(top|best) [0-9]+[ \-]'
    OR title ~* '^[0-9]+ (ways|reasons|tips|foods|supplements|exercises)'
    OR title ~* '(natural|powerful|proven|clinically proven).{0,40}(muscle|fat|testosterone|growth|performance)'
    OR title ~* '(lose weight|burn fat|build muscle).{0,20}(fast|quickly|in [0-9])'
  )
ORDER BY random() LIMIT 25;
