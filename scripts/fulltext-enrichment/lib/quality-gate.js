// Quality filters for extracted full text. PDF parsing fails constantly;
// reject garbage here rather than polluting evidence_chunks with OCR
// noise or misparsed headers.
//
// Spec: docs/superpowers/specs/2026-04-23-full-text-retrieval-design.md §6.5
//
// Return { ok: boolean, reason?: string }.
//
// Reject rules (from spec):
//   - length < 1000            -> 'too_short' (likely scanned PDF Grobid couldn't parse)
//   - length > 500000          -> 'too_long'  (book or misparse)
//   - non-ASCII ratio > 40%    -> 'ocr_garbage'
//   - repeated-line ratio > 30% -> 'headers_footers_leaked'
//   - 0 sections detected      -> 'no_structure'  (probably failed parse)
//
// Persist the reject reason in research_articles.fulltext_reject_reason so
// operators can sample per-reason and tune.

export function checkQuality({ text, sections }) {
  if (text.length < 1000) return { ok: false, reason: "too_short" };
  if (text.length > 500000) return { ok: false, reason: "too_long" };

  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAscii / text.length > 0.40) return { ok: false, reason: "ocr_garbage" };

  const lines = text.split("\n").filter((l) => l.trim().length > 20);
  const unique = new Set(lines);
  if (lines.length && (lines.length - unique.size) / lines.length > 0.30) {
    return { ok: false, reason: "headers_footers_leaked" };
  }

  if (!sections || sections.length === 0) {
    return { ok: false, reason: "no_structure" };
  }

  return { ok: true };
}
