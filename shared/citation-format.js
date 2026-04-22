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

// ─── Bibliography formatters ──────────────────────────────────────────────
// Each returns a ready-to-copy string for a single source.

function authorsPretty(source) {
  const arr = Array.isArray(source?.authors) ? source.authors : [];
  if (!arr.length) return "Unknown author";
  const fmt = (a) => {
    if (!a) return "";
    if (typeof a === "string") return a.trim();
    if (a.last && a.first) return `${a.last}, ${String(a.first).charAt(0)}.`;
    return String(a.name || a.last || "").trim();
  };
  const names = arr.map(fmt).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length <= 6) return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
  return names.slice(0, 6).join(", ") + ", et al.";
}

function yearOf(source) {
  const y = source?.year || source?.publication_year;
  if (typeof y === "number") return String(y);
  if (typeof y === "string") return y.slice(0, 4);
  const at = source?.published_at;
  return typeof at === "string" ? at.slice(0, 4) : "n.d.";
}

export function formatPlain(source) {
  if (!source) return "";
  const parts = [];
  if (source.title) parts.push(source.title);
  const year = yearOf(source);
  if (year && year !== "n.d.") parts.push(`(${year})`);
  if (source.journal) parts.push(source.journal);
  if (source.doi) parts.push(`doi:${source.doi}`);
  if (source.pmid) parts.push(`PMID:${source.pmid}`);
  return parts.join(" · ");
}

export function formatAPA(source) {
  if (!source) return "";
  const authors = authorsPretty(source);
  const year = yearOf(source);
  const title = source.title || "Untitled";
  const journal = source.journal ? `. ${source.journal}` : "";
  const doi = source.doi ? `. https://doi.org/${source.doi}` : "";
  return `${authors} (${year}). ${title}${journal}${doi}`;
}

export function formatBibTeX(source) {
  if (!source) return "";
  const key = source.pmid
    ? `pmid${source.pmid}`
    : source.doi
      ? String(source.doi).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)
      : `src_${Date.now()}`;
  const lines = [`@article{${key},`];
  if (source.title) lines.push(`  title   = {${source.title}},`);
  const authors = Array.isArray(source.authors) ? source.authors : [];
  if (authors.length) {
    const fmt = (a) => typeof a === "string" ? a : (a?.name || [a?.last, a?.first].filter(Boolean).join(", "));
    lines.push(`  author  = {${authors.map(fmt).filter(Boolean).join(" and ")}},`);
  }
  const y = yearOf(source);
  if (y && y !== "n.d.") lines.push(`  year    = {${y}},`);
  if (source.journal) lines.push(`  journal = {${source.journal}},`);
  if (source.doi)     lines.push(`  doi     = {${source.doi}},`);
  if (source.pmid)    lines.push(`  note    = {PMID: ${source.pmid}},`);
  lines.push("}");
  return lines.join("\n");
}

export const CITATION_FORMATS = [
  { id: "plain",   label: "Plain",   format: formatPlain },
  { id: "apa",     label: "APA",     format: formatAPA },
  { id: "bibtex",  label: "BibTeX",  format: formatBibTeX },
];
