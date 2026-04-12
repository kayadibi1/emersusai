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
    authors: item.author_label || "",
    year: item.publication_year || "",
    publication_type: item.publication_type || "",
    url: item.url || "",
    excerpt: item.excerpt || "",
    similarity: item.similarity || 0,
  }));
}
