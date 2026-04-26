// api/emersus/pipeline/anchor-verify.js
//
// Pure verifier functions for the Anchor-Verified Citations subsystem.
// Verifies that a specifier "anchor" extracted from a research claim is
// actually backed by content from the cited source. Two-tier check:
//   1. Substring match across {chunk, full_text, abstract} with light
//      normalization — case, whitespace, dose/duration unit forms.
//   2. LLM judge fallback (gpt-5.4-mini) when no substring match. The
//      judge call is dependency-injected so unit tests run pure.
//
// Returns one of: PASS_VERBATIM, PASS_JUDGED, FAIL.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

const NUMBER_WORDS_RE = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`,
  "gi",
);

export function normalizeForSubstring(text) {
  if (text == null) return "";
  let s = String(text).toLowerCase();
  s = s.replace(NUMBER_WORDS_RE, (m) => String(NUMBER_WORDS[m.toLowerCase()]));
  // Dose units
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams|gm)\b/g, "$1g");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:mg|milligram|milligrams)\b/g, "$1mg");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:kg|kilogram|kilograms)\b/g, "$1kg");
  // Time units
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:wks?|weeks?)\b/g, "$1wk");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:d|days?)\b/g, "$1d");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:mos?|months?)\b/g, "$1mo");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:y|yrs?|years?)\b/g, "$1y");
  // Whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
