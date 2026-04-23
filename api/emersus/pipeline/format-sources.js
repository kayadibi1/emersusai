import { formatCitationUrl, formatCitationLabel } from "../../../shared/citation-format.js";

export function formatSources(evidenceItems) {
  if (!Array.isArray(evidenceItems)) return [];
  return evidenceItems.slice(0, 6).map((item, index) => ({
    index: index + 1,
    source_id: item.source_id || null,
    source: item.source || "pubmed",
    pmid: item.pmid || null,
    doi: item.doi || null,
    title: item.title || "Untitled",
    journal: item.journal || "",
    // authors is the raw array — shared/chat/message-actions.js formatAuthorList,
    // shared/chat/share-modal.js formatAuthors, and widget-footers.js all
    // Array.isArray-gate this field and fall back to "Unknown author" if it
    // isn't an array. Prior code sent item.author_label (pre-formatted string),
    // which broke the Cite / Copy-citations action on every chat message.
    authors: Array.isArray(item.authors) ? item.authors : [],
    author_label: item.author_label || "",
    year: item.publication_year || "",
    publication_type: item.publication_type || "",
    url: item.url || "",
    excerpt: item.excerpt || "",
    matched_chunk_type: item.matched_chunk_type || null,
    is_title_only_match: item.is_title_only_match === true,
    similarity: item.similarity || 0,
  }));
}
