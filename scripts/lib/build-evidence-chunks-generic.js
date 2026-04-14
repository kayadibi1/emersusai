// scripts/lib/build-evidence-chunks-generic.js
// Pure helper: turns a research_articles row (source-agnostic) into
// evidence_chunks rows suitable for INSERT. Emits only when the abstract
// is usable — matches the "skip abstract-less rows entirely" decision.

export const MIN_ABSTRACT_CHARS = 50;
export const MAX_ABSTRACT_CHUNK_CHARS = 2400;
export const MAX_ABSTRACT_CHUNKS = 12;

function normalize(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoChunks(text, maxChars, maxChunks) {
  if (text.length <= maxChars) return [text];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [text.slice(0, maxChars)];

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + 1 + sentence.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      if (chunks.length >= maxChunks) {
        current = "";
        break;
      }
      current = sentence;
    }
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

/**
 * @param {object} row research_articles row subset
 * @param {number} row.pmid
 * @param {string|null} row.title
 * @param {string|null} row.abstract
 * @param {string} row.source
 * @param {string|null} row.external_id
 * @param {string|null} row.doi
 * @returns {Array<{pmid: number, chunk_type: string, content: string, metadata: object}>}
 */
export function buildGenericChunks(row) {
  const abstract = normalize(row.abstract);
  if (abstract.length < MIN_ABSTRACT_CHARS) return [];

  const title = normalize(row.title);
  const metadata = {
    source: row.source,
    external_id: row.external_id ?? null,
    doi: row.doi ?? null,
  };
  const chunks = [];

  if (title) {
    chunks.push({
      pmid: row.pmid,
      chunk_type: "title",
      content: title,
      metadata,
    });
  }

  const abstractPieces = splitIntoChunks(
    abstract,
    MAX_ABSTRACT_CHUNK_CHARS,
    MAX_ABSTRACT_CHUNKS
  );
  for (const piece of abstractPieces) {
    chunks.push({
      pmid: row.pmid,
      chunk_type: "abstract",
      content: piece,
      metadata,
    });
  }

  return chunks;
}
