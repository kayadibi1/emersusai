// Pure helpers that extract enrichment fields from PubMed efetch XML.
// Zero external dependencies so they're unit-testable in plain node
// without touching the DB or the Supabase client.
//
// The rest of the codebase uses regex-based extraction for PubMed XML
// (see scripts/fill-pmc-corpus.js) — we follow the same style here
// rather than introducing a new XML parser dependency for four fields.
// The patterns deliberately use non-greedy matching and tolerate
// attributes on the container elements.

/**
 * Decode a small set of XML entities back to plain text. PubMed's
 * abstracts routinely contain &lt; &gt; &amp; in numeric-symbol
 * contexts (e.g. "p&lt;0.01"), and we want the stored abstract to
 * look like normal text.
 */
function decodeEntities(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(text) {
  if (typeof text !== "string") return "";
  return text.replace(/<[^>]+>/g, "");
}

function cleanInner(text) {
  return decodeEntities(stripTags(String(text))).replace(/\s+/g, " ").trim();
}

/**
 * Was this article retracted?
 *
 * A retracted paper carries a <CommentsCorrectionsList> that contains
 * at least one <CommentsCorrections RefType="RetractionIn"> child,
 * which points forward to the retraction notice article. We intentionally
 * do NOT flag articles whose only CommentsCorrections is a "RetractionOf"
 * — those are the retraction notices themselves, not retracted papers.
 *
 * Returns { isRetracted: boolean, retractionNotes: string | null }.
 * retractionNotes is the human-readable RefSource from the first
 * RetractionIn element if present.
 */
export function parseRetractionStatus(xml) {
  const empty = { isRetracted: false, retractionNotes: null };
  if (typeof xml !== "string" || xml.length === 0) return empty;

  // Find the RetractionIn CommentsCorrections block (attributes can be in
  // any order; RefType may be single- or double-quoted).
  const retractionInMatch = xml.match(
    /<CommentsCorrections\b[^>]*\bRefType\s*=\s*["']RetractionIn["'][^>]*>([\s\S]*?)<\/CommentsCorrections>/i
  );
  if (!retractionInMatch) return empty;

  // Pull the <RefSource> text inside that block for the notes field.
  const refSourceMatch = retractionInMatch[1].match(
    /<RefSource\b[^>]*>([\s\S]*?)<\/RefSource>/i
  );
  const notes = refSourceMatch ? cleanInner(refSourceMatch[1]) : null;

  return { isRetracted: true, retractionNotes: notes || null };
}

/**
 * Extract a structured abstract keyed by section label.
 *
 * Looks for <AbstractText Label="..."> elements and returns an object
 * like { BACKGROUND: "...", METHODS: "...", RESULTS: "...", CONCLUSIONS: "..." }.
 * Labels are uppercased and trimmed for consistency.
 *
 * Returns null if the abstract has no labeled sections (caller should
 * fall back to the plain abstract string).
 */
export function parseStructuredAbstract(xml) {
  if (typeof xml !== "string" || xml.length === 0) return null;

  const sections = {};
  const re =
    /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const labelMatch = attrs.match(/\bLabel\s*=\s*["']([^"']+)["']/i);
    if (!labelMatch) continue;
    const label = labelMatch[1].trim().toUpperCase();
    if (!label) continue;
    const cleaned = cleanInner(body);
    if (!cleaned) continue;
    // If the same label repeats (rare but legal), concatenate with a space.
    sections[label] = sections[label]
      ? `${sections[label]} ${cleaned}`
      : cleaned;
  }

  return Object.keys(sections).length > 0 ? sections : null;
}

/**
 * Extract the publication country from <MedlineJournalInfo><Country>.
 * Returns a trimmed string, or null if not present.
 */
export function parsePublicationCountry(xml) {
  if (typeof xml !== "string" || xml.length === 0) return null;
  const match = xml.match(
    /<MedlineJournalInfo\b[^>]*>[\s\S]*?<Country\b[^>]*>([\s\S]*?)<\/Country>[\s\S]*?<\/MedlineJournalInfo>/i
  );
  if (!match) return null;
  const value = cleanInner(match[1]);
  return value || null;
}

/**
 * Parse a PMC (JATS) abstract into a section-keyed object, using the
 * same uppercase-label shape as parseStructuredAbstract so downstream
 * chunkers/normalizers don't have to know which format the article
 * came from.
 *
 * PMC abstracts look like:
 *   <abstract>
 *     <sec>
 *       <title>Background</title>
 *       <p>...</p><p>...</p>
 *     </sec>
 *     <sec><title>Methods</title><p>...</p></sec>
 *     ...
 *   </abstract>
 *
 * Returns null if no <abstract> element is present, or if the abstract
 * has no <sec> children (unstructured — caller uses the plain abstract
 * string). Sections without a <title> are dropped rather than being
 * captured under an empty key, because PMC sometimes uses untitled
 * outer <sec> wrappers around intro paragraphs.
 */
export function parsePmcStructuredAbstract(xml) {
  if (typeof xml !== "string" || xml.length === 0) return null;

  // Find the first <abstract> block. PMC articles can have multiple
  // <abstract> elements (translated language variants); we take the
  // first, which is the primary language.
  const abstractMatch = xml.match(/<abstract\b[^>]*>([\s\S]*?)<\/abstract>/i);
  if (!abstractMatch) return null;
  const abstractInner = abstractMatch[1];

  const sections = {};
  const secRe = /<sec\b[^>]*>([\s\S]*?)<\/sec>/gi;
  let secMatch;
  while ((secMatch = secRe.exec(abstractInner)) !== null) {
    const secInner = secMatch[1];
    const titleMatch = secInner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue; // Skip untitled sections
    const label = cleanInner(titleMatch[1]).toUpperCase();
    if (!label) continue;

    // Concatenate all <p> children's text content.
    const paragraphs = [];
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch;
    while ((pMatch = pRe.exec(secInner)) !== null) {
      const cleaned = cleanInner(pMatch[1]);
      if (cleaned) paragraphs.push(cleaned);
    }
    if (paragraphs.length === 0) continue;

    const body = paragraphs.join(" ");
    sections[label] = sections[label]
      ? `${sections[label]} ${body}`
      : body;
  }

  return Object.keys(sections).length > 0 ? sections : null;
}

/**
 * Split a multi-article efetch response into an array of individual
 * <PubmedArticle>...</PubmedArticle> XML strings. Returns [] if none
 * are present.
 */
export function splitPubmedArticles(xml) {
  if (typeof xml !== "string" || xml.length === 0) return [];
  const matches = xml.match(
    /<PubmedArticle\b[^>]*>[\s\S]*?<\/PubmedArticle>/g
  );
  return matches || [];
}

/**
 * Extract the PMID from a single PubmedArticle XML block. Returns a
 * number (not a string) so it matches the bigint column type, or
 * null if no PMID is present.
 *
 * PubMed XML has multiple <PMID> elements (one inside MedlineCitation,
 * and additional ones inside CommentsCorrections or DeleteCitation).
 * The MedlineCitation PMID is always the first one in the document
 * order, so we take the first match.
 */
export function extractPmid(xml) {
  if (typeof xml !== "string" || xml.length === 0) return null;
  const match = xml.match(/<PMID\b[^>]*>(\d+)<\/PMID>/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract author-supplied keywords from <KeywordList><Keyword> elements.
 * Returns an array of lowercased, trimmed, deduplicated strings.
 * Returns [] if no KeywordList is present.
 */
export function parseAuthorKeywords(xml) {
  if (typeof xml !== "string" || xml.length === 0) return [];
  const listMatches = xml.match(
    /<KeywordList\b[^>]*>([\s\S]*?)<\/KeywordList>/gi
  );
  if (!listMatches) return [];

  const seen = new Set();
  const out = [];
  for (const list of listMatches) {
    const inner = list.replace(/<KeywordList\b[^>]*>|<\/KeywordList>/gi, "");
    const kwRe = /<Keyword\b[^>]*>([\s\S]*?)<\/Keyword>/gi;
    let m;
    while ((m = kwRe.exec(inner)) !== null) {
      const value = cleanInner(m[1]).toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}
