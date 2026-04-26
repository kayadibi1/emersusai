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

const JUDGE_SYSTEM_PROMPT = [
  "You verify whether a SOURCE text explicitly supports a specific ANCHOR phrase from a research claim.",
  "",
  'Return JSON only: {"passes": true|false, "matched_quote": "..." or null, "scope_used": "chunk"|"full_text"|"abstract"|null, "reasoning": "..."}.',
  "",
  "passes=true ONLY if the SOURCE explicitly states the anchor's content. Light paraphrase is OK; semantic equivalence with same numeric / population / duration is OK.",
  "passes=false if SOURCE does not state the anchor, or only states something more general / different scope / different numbers.",
  "",
  "If passes=true, set matched_quote to the verbatim phrase from the source that backs the anchor and scope_used to which section it came from.",
].join("\n");

/**
 * Production judge — gpt-5.4-mini single call. Used as the default fallback
 * when no judge is explicitly passed via opts.
 */
export async function runJudgeOpenAI({ anchor, scope, model = "gpt-5.4-mini" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const sourceSections = ["chunk", "full_text", "abstract"]
    .map((k) => (scope?.[k] ? `[${k}]\n${scope[k]}` : null))
    .filter(Boolean)
    .join("\n\n---\n\n");

  const user = [
    `ANCHOR phrase: ${anchor.text}`,
    `EXTRACTOR'S CLAIMED QUOTE: ${anchor.source_quote || "(none)"}`,
    "",
    "SOURCE (multiple scopes):",
    sourceSections || "(empty)",
    "",
    "Return JSON only.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      max_output_tokens: 300,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Judge ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  const text = json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");

  let parsed;
  try {
    const cleaned = String(text || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { passes: false, error: "judge_malformed_json", raw_response: text };
  }
  return {
    passes: parsed.passes === true,
    matched_quote: parsed.matched_quote || null,
    scope_used: parsed.scope_used || null,
    reasoning: parsed.reasoning || null,
    raw_response: text,
  };
}

__setDefaultJudge(runJudgeOpenAI);
