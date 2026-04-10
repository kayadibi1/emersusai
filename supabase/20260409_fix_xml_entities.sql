-- Decode broken XML entities (&#x3b2; → β, &#8804; → ≤, etc.) in existing data.
-- One-time cleanup for articles imported before the decodeXmlEntities fix in
-- fill-pmc-corpus.js. Safe to re-run (idempotent — already-decoded text has no
-- &#... patterns to match).

-- 1. Reusable entity decoder function
CREATE OR REPLACE FUNCTION public.decode_xml_entities(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result text := input;
  m text[];
  codepoint int;
BEGIN
  -- Hex entities: &#xHHH;
  LOOP
    m := regexp_match(result, '&#x([0-9a-fA-F]+);');
    EXIT WHEN m IS NULL;
    codepoint := ('x' || lpad(m[1], 8, '0'))::bit(32)::int;
    result := replace(result, '&#x' || m[1] || ';', chr(codepoint));
  END LOOP;
  -- Decimal entities: &#NNN;
  LOOP
    m := regexp_match(result, '&#(\d+);');
    EXIT WHEN m IS NULL;
    codepoint := m[1]::int;
    result := replace(result, '&#' || m[1] || ';', chr(codepoint));
  END LOOP;
  -- Named entities (amp last to avoid double-decode)
  result := replace(result, '&lt;', '<');
  result := replace(result, '&gt;', '>');
  result := replace(result, '&quot;', '"');
  result := replace(result, '&apos;', '''');
  result := replace(result, '&amp;', '&');
  RETURN result;
END;
$$;

-- 2. Fix article titles + abstracts
UPDATE pubmed_articles SET
  title = decode_xml_entities(title),
  abstract = decode_xml_entities(abstract)
WHERE title ~ '&#' OR abstract ~ '&#';

-- 3. Fix evidence chunk content
UPDATE evidence_chunks SET
  content = decode_xml_entities(content)
WHERE content ~ '&#';
