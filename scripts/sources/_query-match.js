// scripts/sources/_query-match.js
//
// Shared client-side query matcher for adapters whose upstream API
// doesn't support keyword search (biorxiv, medrxiv, sportrxiv). These
// adapters fetch recent/all papers and filter locally.
//
// The old implementation used OR matching ("at least one term from the
// flattened term list must appear in title or abstract"), which was far
// too loose: a creatine query of
//   (creatine OR "creatine monohydrate") AND ("resistance training" OR strength)
// flattened to [creatine, monohydrate, resistance, training, strength, ...]
// and any paper mentioning e.g. "drug resistance" passed.
//
// The new implementation parses the boolean structure of the query:
//   - Split on top-level `AND` (case-insensitive)
//   - Each AND-group contains one-or-more OR-alternatives
//   - A paper matches iff at least one term from EVERY AND-group appears
//     in the haystack (title + abstract)
//
// Terms are still length-filtered (>=4 chars) and stopword-filtered, so
// adjective-y noise like "this" or "with" doesn't dominate. Quoted
// phrases are treated as a single multi-word term and matched as a
// substring (so "resistance training" only matches if both words appear
// adjacent).

const STOPWORDS = new Set([
  "and", "or", "not", "with", "from", "this", "that",
  "the", "a", "an", "of", "in", "on", "to", "for",
  "is", "are", "was", "were",
]);

/**
 * Parse a PubMed-style boolean query into an array of AND-groups, each
 * group being an array of OR-alternatives. An OR-alternative is either
 * a single keyword or a multi-word phrase (if originally quoted).
 *
 * Returns an array of groups. An empty array means "no constraints"
 * (every paper matches), which happens when the query contains no
 * qualifying terms.
 *
 * @param {string} query
 * @returns {Array<Array<string>>} AND-groups, each a list of OR-alternatives
 */
export function parseQueryIntoGroups(query) {
  if (!query || typeof query !== "string") return [];

  // Preserve quoted phrases by replacing spaces inside quotes with U+0001
  // (a placeholder we'll reverse after splitting). This lets us split on
  // whitespace later without shattering "resistance training" into two
  // separate tokens.
  const QUOTED_SPACE_PLACEHOLDER = "\u0001";
  const withPreservedPhrases = query.replace(
    /"([^"]+)"/g,
    (_, inner) => inner.replace(/\s+/g, QUOTED_SPACE_PLACEHOLDER),
  );

  // Now split on " AND " (case-insensitive, whole word). Everything
  // else counts as OR-style alternatives within a group.
  const groups = withPreservedPhrases
    .split(/\s+AND\s+/i)
    .map((group) => {
      // Strip parens — boolean precedence doesn't matter for keyword
      // matching, and OpenAIRE-style nested parens are common.
      const cleaned = group.replace(/[()]/g, " ");
      // Split on " OR " and bare whitespace — both are OR-like since
      // adjacent bare keywords are implicit OR in PubMed's simple mode.
      const alternatives = cleaned
        .split(/\s+OR\s+|\s+/i)
        .map((term) => term.replace(new RegExp(QUOTED_SPACE_PLACEHOLDER, "g"), " "))
        .map((term) => term.toLowerCase().trim())
        .map((term) => term.replace(/[^\w\s]/g, ""))
        .filter((term) => term.length >= 4 && !STOPWORDS.has(term));
      return alternatives;
    })
    .filter((group) => group.length > 0);

  return groups;
}

/**
 * Check whether a title+abstract matches a query's AND-group structure.
 * Returns true iff at least one term from every AND-group appears in
 * the haystack. An empty groups array (no meaningful terms parsed)
 * returns true — there's nothing to match against.
 *
 * @param {Array<Array<string>>} groups — output of parseQueryIntoGroups
 * @param {string} title
 * @param {string} [abstract]
 * @returns {boolean}
 */
export function matchesQueryGroups(groups, title, abstract) {
  if (!groups || groups.length === 0) return true;
  const haystack = `${title || ""} ${abstract || ""}`.toLowerCase();
  return groups.every((alternatives) =>
    alternatives.some((term) => haystack.includes(term)),
  );
}
