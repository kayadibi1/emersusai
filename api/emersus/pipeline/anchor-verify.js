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

let defaultJudge = null;
export function __setDefaultJudge(fn) {
  defaultJudge = fn;
}

const SCOPE_ORDER = ["chunk", "full_text", "abstract"];

/**
 * Verify a single anchor against a resolved source scope.
 *
 * @param {Object} anchor — { text, source_quote, attributed_source_id, kind_hint, ... }
 * @param {Object} scope — { chunk, full_text, abstract } from anchor-source-scope
 * @param {Object} [opts]
 * @param {Function|null} [opts.judge] — async ({anchor, scope}) => {passes, ...}; null disables judge fallback
 * @returns {Promise<{result: "PASS_VERBATIM"|"PASS_JUDGED"|"FAIL", scope_actually_matched: string|null, judge_response: object|null}>}
 */
export async function verifyAnchor(anchor, scope, opts = {}) {
  if (!anchor || anchor.source_quote == null || anchor.source_quote === "") {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  const needle = normalizeForSubstring(anchor.source_quote);
  if (!needle) {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  for (const scopeName of SCOPE_ORDER) {
    const text = scope?.[scopeName];
    if (!text) continue;
    if (normalizeForSubstring(text).includes(needle)) {
      return { result: "PASS_VERBATIM", scope_actually_matched: scopeName, judge_response: null };
    }
  }
  // Substring failed across all scopes — try judge fallback.
  const judge = opts.judge === undefined ? defaultJudge : opts.judge;
  if (!judge) {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  let judgeResult;
  try {
    judgeResult = await judge({ anchor, scope });
  } catch (err) {
    return {
      result: "FAIL",
      scope_actually_matched: null,
      judge_response: { passes: false, error: err.message || String(err) },
    };
  }
  if (judgeResult?.passes) {
    return {
      result: "PASS_JUDGED",
      scope_actually_matched: judgeResult.scope_used || null,
      judge_response: judgeResult,
    };
  }
  return { result: "FAIL", scope_actually_matched: null, judge_response: judgeResult };
}
