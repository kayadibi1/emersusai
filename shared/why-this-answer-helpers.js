// shared/why-this-answer-helpers.js
//
// Pure helpers used by the "Why this answer?" reveal in
// shared/react-chat-app.js. Extracted into their own module so they can
// be unit-tested without spinning up a React renderer.
//
// Loaded in the browser via `<script type="module">` from the chat HTML
// (alongside react-chat-app.js) and in node:test via relative import.

function normalizeForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns true when `excerpt` carries no information beyond `title`. Used
// to suppress redundant blockquotes that would just repeat the source
// title (these come from chunk_type='title' rows in evidence_chunks).
//
// Rules:
//   - identical (after normalization) → true
//   - excerpt starts with title and adds < 40 chars of trailing content → true
//   - otherwise → false
//
// 40-char threshold comes from the smallest meaningful trailing fragment
// we'd want to show — anything shorter is likely a year, journal, or
// citation suffix that adds no passage value.
export function isTitleEquivalentExcerpt(excerpt, title) {
  const e = normalizeForCompare(excerpt);
  const t = normalizeForCompare(title);
  if (!e || !t) return false;
  if (e === t) return true;
  if (e.startsWith(t)) {
    const trailing = e.slice(t.length).trim();
    if (trailing.length < 40) return true;
  }
  return false;
}
