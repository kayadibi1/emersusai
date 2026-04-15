// shared/chat/widget-footers.js — helpers for the chat_v2 citation footer and
// meal-widget footer.
//
// Pure functions only. Rendering is done inside existing React components
// (SourcesRailCard + MealPlanCard / MealPlanWidget) so each widget type keeps
// its own layout; this module just returns the data.

import { SYNTHETIC_PMID_FLOOR } from "../citation-format.js";

function isRealPubmed(source) {
  if (!source) return false;
  const pmid = source.pmid;
  return (
    source.source === "pubmed" &&
    typeof pmid === "number" &&
    pmid > 0 &&
    pmid < SYNTHETIC_PMID_FLOOR
  );
}

export function citationLinks(source) {
  if (!source || typeof source !== "object") return [];
  const links = [];
  if (isRealPubmed(source)) {
    links.push({ label: "PUBMED", href: `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/` });
  }
  if (source.doi) {
    links.push({ label: "DOI", href: `https://doi.org/${source.doi}` });
  }
  return links;
}

function truncateForPrompt(value, max) {
  const str = String(value || "").replace(/\s+/g, " ").trim();
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1).trim()}…`;
}

/**
 * Build a composer-seed prompt for the "Ask follow-up" action on a citation.
 *   - With first author:  Tell me more about "<title>" by <author-surname>.
 *   - Journal fallback:   Tell me more about "<title>" (<journal>).
 *   - Bare:               Tell me more about "<title>".
 * Returns "" when no title is available.
 */
export function buildFollowUpPrompt(source) {
  if (!source || typeof source !== "object") return "";
  const titleRaw = String(source.title || "").trim();
  if (!titleRaw) return "";
  const title = truncateForPrompt(titleRaw, 200);
  const firstAuthor = Array.isArray(source.authors) && source.authors.length
    ? String(source.authors[0]).trim()
    : "";
  if (firstAuthor) {
    return `Tell me more about "${title}" by ${firstAuthor}.`;
  }
  if (source.journal) {
    return `Tell me more about "${title}" (${source.journal}).`;
  }
  return `Tell me more about "${title}".`;
}

export default { citationLinks, buildFollowUpPrompt };
