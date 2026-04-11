// Pure helpers for turning a structured abstract's labeled sections
// (from pubmed_articles.abstract_sections jsonb) into evidence_chunks
// rows, one per section (or more if a section exceeds the chunk-length
// budget).
//
// Used by scripts/chunk-structured-abstracts.js. Kept free of any
// supabase/dotenv imports so it can be unit-tested in plain node.

// Map PubMed's section labels to the canonical chunk_type values we
// want to store. PubMed authors use enormous variety here ("AIM",
// "OBJECTIVE", "PURPOSE"; "METHOD" vs "METHODS" vs "STUDY DESIGN";
// "RESULTS" vs "FINDINGS"); we normalize to four broad buckets so
// retrieval can filter/boost by section type without having to care
// about wording differences.
const LABEL_MAP = new Map([
  // background / motivation
  ["BACKGROUND", "abstract_background"],
  ["INTRODUCTION", "abstract_background"],
  ["CONTEXT", "abstract_background"],
  ["PURPOSE", "abstract_background"],
  ["AIM", "abstract_background"],
  ["AIMS", "abstract_background"],
  ["OBJECTIVE", "abstract_background"],
  ["OBJECTIVES", "abstract_background"],
  ["RATIONALE", "abstract_background"],

  // methods
  ["METHOD", "abstract_methods"],
  ["METHODS", "abstract_methods"],
  ["METHODOLOGY", "abstract_methods"],
  ["MATERIALS AND METHODS", "abstract_methods"],
  ["MATERIAL AND METHODS", "abstract_methods"],
  ["PATIENTS AND METHODS", "abstract_methods"],
  ["DESIGN", "abstract_methods"],
  ["STUDY DESIGN", "abstract_methods"],
  ["SETTING", "abstract_methods"],
  ["PARTICIPANTS", "abstract_methods"],

  // results / findings
  ["RESULTS", "abstract_results"],
  ["RESULT", "abstract_results"],
  ["FINDINGS", "abstract_results"],
  ["OUTCOMES", "abstract_results"],
  ["PRIMARY OUTCOMES", "abstract_results"],
  ["MAIN RESULTS", "abstract_results"],
  ["MAIN FINDINGS", "abstract_results"],
  ["MAIN OUTCOME MEASURES", "abstract_results"],

  // conclusions / interpretation
  ["CONCLUSION", "abstract_conclusions"],
  ["CONCLUSIONS", "abstract_conclusions"],
  ["DISCUSSION", "abstract_conclusions"],
  ["INTERPRETATION", "abstract_conclusions"],
  ["IMPLICATIONS", "abstract_conclusions"],
  ["TAKE-HOME MESSAGE", "abstract_conclusions"],
]);

export function normalizeSectionLabel(rawLabel) {
  if (typeof rawLabel !== "string") return "abstract_other";
  const key = rawLabel.trim().toUpperCase();
  if (!key) return "abstract_other";
  return LABEL_MAP.get(key) || "abstract_other";
}

function splitLongText(text, maxLength) {
  if (typeof text !== "string") return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLength) return [cleaned];

  // Sentence-first split, greedily packing into chunks up to maxLength.
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [cleaned.slice(0, maxLength)];

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    // A single sentence longer than the budget: hard-cut it into
    // maxLength slices so we don't silently drop the tail.
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxLength) {
        chunks.push(sentence.slice(i, i + maxLength));
      }
      continue;
    }
    if (!current) {
      current = sentence;
      continue;
    }
    const candidate = `${current} ${sentence}`;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Convert a structured abstract object into an array of evidence_chunks
 * rows. Preserves the input object's key order so (rare) duplicate
 * normalizations (e.g. AIM + PURPOSE both → abstract_background)
 * appear in the order the paper listed them.
 *
 * Returns [] for non-object or empty input. Empty / whitespace-only
 * section values are silently dropped — we don't want empty content
 * chunks cluttering the index.
 */
export function sectionsToChunks(sections, maxChunkLength) {
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    return [];
  }
  const budget = Math.max(200, Number(maxChunkLength) || 1200);
  const out = [];
  for (const [rawLabel, rawText] of Object.entries(sections)) {
    const chunkType = normalizeSectionLabel(rawLabel);
    const pieces = splitLongText(
      typeof rawText === "string" ? rawText : "",
      budget
    );
    for (const piece of pieces) {
      out.push({ chunk_type: chunkType, content: piece });
    }
  }
  return out;
}
