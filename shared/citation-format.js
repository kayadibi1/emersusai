// shared/citation-format.js
//
// Isomorphic citation rendering helpers for multi-source ingestion.
//
// Used by:
//   - api/emersus/workflow.js (server, source_id labels + URLs in LLM output)
//   - shared/react-chat-app.js (client, React-rendered sources panel)
//   - chat/index.html (legacy client, static HTML sources panel)
//
// Why a shared module: the citation format for pubmed is different from
// every other source, and the logic must stay consistent across all
// three surfaces. Any mismatch between server-side rendering and
// client-side rendering causes visible jank to users.
//
// See docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md

// Real PubMed IDs are < 10^10. Synthetic pmids allocated for non-pubmed
// sources start at 10^10. Used as a paranoia fallback to avoid rendering
// a synthetic pmid as a "PMID N" label even if the source tag gets lost.
export const SYNTHETIC_PMID_FLOOR = 10000000000;

/**
 * Build a best-effort URL for a citation source.
 * Preference order:
 *   1. Explicit `source.url` (some adapters provide this directly)
 *   2. `https://pubmed.ncbi.nlm.nih.gov/<pmid>/` for real pubmed entries
 *   3. `https://doi.org/<doi>` for anything with a DOI
 *   4. null (caller should render without a link)
 *
 * @param {object} source
 * @returns {string|null}
 */
export function formatCitationUrl(source) {
  if (!source) return null;

  if (typeof source.url === "string" && source.url) {
    return source.url;
  }

  const pmid = source.pmid;
  const isPubmedSource = source.source === "pubmed";
  const isRealPmid = typeof pmid === "number" && pmid > 0 && pmid < SYNTHETIC_PMID_FLOOR;
  if (isPubmedSource && isRealPmid) {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  }

  if (source.doi) {
    return `https://doi.org/${source.doi}`;
  }

  return null;
}

/**
 * Build a human-readable citation identifier label.
 * Examples:
 *   - pubmed w/ real pmid:       "PMID 12345678"
 *   - openalex w/ DOI:           "openalex: 10.1186/s12970-021-00412-w"
 *   - biorxiv w/ no DOI:         "biorxiv: 2024.01.15.00042" (from external_id)
 *   - unknown source w/ neither: ""
 *
 * @param {object} source
 * @returns {string}
 */
export function formatCitationLabel(source) {
  if (!source) return "";

  const pmid = source.pmid;
  const isPubmedSource = source.source === "pubmed";
  const isRealPmid = typeof pmid === "number" && pmid > 0 && pmid < SYNTHETIC_PMID_FLOOR;
  if (isPubmedSource && isRealPmid) {
    return `PMID ${pmid}`;
  }

  const sourceLabel = source.source || "source";
  if (source.doi) {
    return `${sourceLabel}: ${source.doi}`;
  }
  if (source.external_id) {
    return `${sourceLabel}: ${source.external_id}`;
  }
  return "";
}
