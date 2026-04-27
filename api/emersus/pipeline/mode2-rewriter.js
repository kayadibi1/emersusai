// api/emersus/pipeline/mode2-rewriter.js
//
// Whole-response rewriter for MQPV. Two modes:
//   - "preserve": rewrite preserving all flagged-missing qualifiers
//   - "preserve_or_hedge": preserve OR explicitly hedge that qualifier
//     limits generalization
//
// Length-ratio fallback: if the rewrite is wildly shorter (<60%) or longer
// (>150%) than the original, treat as suspicious and return original prose.

import {
  mode2RewriterModel,
  mode2LengthRatioFloor,
  mode2LengthRatioCeiling,
} from "./mode2-flags.js";

export const REWRITE_PROMPT_VERSION = "qualifier-rewrite-v1";

const SYSTEM_PROMPT_PRESERVE = [
  "You are an editor. Rewrite the chat response below to preserve qualifiers from cited sources that are currently dropped.",
  "",
  "RULES:",
  "  1. For each flagged claim, ensure the listed missing qualifier values appear (or have clear semantic equivalents) in the claim text.",
  "  2. Maintain natural prose flow. Keep the original message structure, tone, and ordering.",
  "  3. Do not invent qualifiers not in the source. Only add what was flagged missing.",
  "  4. Preserve all citation markers (citesrc1, citesrc2, etc.) exactly as they appear.",
  "  5. Do not add new claims that weren't in the original. Only correct qualifier preservation on existing claims.",
  "",
  "Return ONLY the rewritten response prose. No JSON wrapper, no commentary, no preamble.",
].join("\n");

const SYSTEM_PROMPT_PRESERVE_OR_HEDGE = [
  "You are an editor. Rewrite the chat response below to either preserve qualifiers from cited sources OR explicitly hedge that the qualifier limits generalization.",
  "",
  "RULES:",
  "  1. For each flagged claim, EITHER:",
  "      (a) include the missing qualifier value in the claim text (e.g. 'in trained men over 8 weeks'),",
  "      OR",
  "      (b) add an explicit hedge: 'the cited source is in {qualifier_value}, generalization beyond is uncertain'.",
  "  2. Choose whichever reads more naturally. Prefer preservation; hedge only when preservation would break voice.",
  "  3. Maintain natural prose flow. Keep the original message structure, tone, and ordering.",
  "  4. Preserve all citation markers (citesrc1, citesrc2, etc.) exactly as they appear.",
  "  5. Do not invent qualifiers not in the source.",
  "",
  "Return ONLY the rewritten response prose. No JSON wrapper, no commentary, no preamble.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 2500 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Rewriter ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

// Below this absolute character count, the original prose is too short for
// the ratio test to be meaningful (a single added qualifier phrase can
// double the length). Treat short originals as always-acceptable so the
// rewrite is allowed through; the validator catches any qualifier issues.
const SHORT_ORIGINAL_BYPASS = 50;

export function isLengthRatioAcceptable(originalLength, newLength) {
  if (originalLength <= 0) return false;
  if (originalLength < SHORT_ORIGINAL_BYPASS) return true;
  const ratio = newLength / originalLength;
  return ratio >= mode2LengthRatioFloor() && ratio <= mode2LengthRatioCeiling();
}

function buildUserPrompt({ originalProse, validationResult, citedSources }) {
  const sourcesBlock = citedSources
    .map((s) => `[${s.id}] qualifiers: ${JSON.stringify(s.qualifiers || {})}`)
    .join("\n");
  const flaggedBlock = (validationResult.per_claim_missing || [])
    .map((c) => `- claim: "${c.claim_text}" (citesrc${c.source_idx}); missing: ${c.missing.join(", ")}`)
    .join("\n") || "(none flagged — preserve qualifiers as a precaution)";
  return [
    "ORIGINAL RESPONSE:",
    originalProse,
    "",
    "CITED SOURCE QUALIFIERS:",
    sourcesBlock,
    "",
    "FLAGGED CLAIMS WITH MISSING QUALIFIERS:",
    flaggedBlock,
    "",
    "Rewrite the response per the rules above. Return only the prose.",
  ].join("\n");
}

function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export async function rewriteForQualifierPreservation({
  originalProse,
  validationResult,
  citedSources,
  mode = "preserve",
  callJudge = defaultCallJudge,
  model = mode2RewriterModel(),
}) {
  const t0 = Date.now();
  if (!originalProse) {
    return {
      prose: originalProse,
      length_ratio_acceptable: true,
      cost_usd: 0,
      latency_ms: 0,
      error: null,
      mode,
    };
  }

  const system = mode === "preserve_or_hedge"
    ? SYSTEM_PROMPT_PRESERVE_OR_HEDGE
    : SYSTEM_PROMPT_PRESERVE;
  const user = buildUserPrompt({ originalProse, validationResult, citedSources });

  let rewritten = null;
  let error = null;
  try {
    rewritten = await callJudge({ system, user, model });
    rewritten = String(rewritten || "").trim();
  } catch (err) {
    error = err.message || String(err);
    return {
      prose: originalProse,
      length_ratio_acceptable: false,
      cost_usd: 0,
      latency_ms: Date.now() - t0,
      error,
      mode,
      prompt_version: REWRITE_PROMPT_VERSION,
    };
  }

  const ratioOk = isLengthRatioAcceptable(originalProse.length, rewritten.length);
  if (!ratioOk) {
    return {
      prose: originalProse,
      length_ratio_acceptable: false,
      cost_usd: estimateCostUsd({
        inputTokens: Math.ceil((system.length + user.length) / 4),
        outputTokens: Math.ceil((rewritten || "").length / 4),
      }),
      latency_ms: Date.now() - t0,
      error: "length_ratio_out_of_bounds",
      mode,
      prompt_version: REWRITE_PROMPT_VERSION,
    };
  }

  return {
    prose: rewritten,
    length_ratio_acceptable: true,
    cost_usd: estimateCostUsd({
      inputTokens: Math.ceil((system.length + user.length) / 4),
      outputTokens: Math.ceil(rewritten.length / 4),
    }),
    latency_ms: Date.now() - t0,
    error: null,
    mode,
    prompt_version: REWRITE_PROMPT_VERSION,
  };
}
