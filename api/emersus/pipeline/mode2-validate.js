// api/emersus/pipeline/mode2-validate.js
//
// Whole-response qualifier-preservation judge for MQPV. Takes the
// streamed prose plus per-source qualifier dicts and returns the set
// of (claim, source_idx, missing_qualifiers) deltas. One LLM call per
// chat regardless of claim count.

import { mode2ValidatorModel, mode2DisabledQualifiers } from "./mode2-flags.js";

export const VALIDATION_PROMPT_VERSION = "qualifier-validate-v1";

const SYSTEM_PROMPT = [
  "You audit whether a chat response preserves the qualifiers from cited sources.",
  "",
  "Each cited source has a qualifier dict (e.g. {population: 'trained men', dose: '5g/day'}).",
  "For each empirical claim in the response that carries a citation, decide whether the source's qualifiers are preserved in the claim text.",
  "",
  "PRESERVED means EITHER:",
  "  (a) the qualifier value (or a clear semantic equivalent / paraphrase) appears in the claim text — e.g. claim says 'in trained men' and source qualifier says population: 'resistance-trained males', that's preserved.",
  "  (b) the claim explicitly hedges that the qualifier limits generalization — e.g. claim says 'in this trained-men population, generalization beyond is uncertain'.",
  "",
  "DROPPED means: the qualifier is in the source but the claim states the finding without the qualifier or hedge.",
  "  Example: source qualifier population='trained men' + dose='5g/day' for 8 weeks; claim says 'creatine improves strength' → BOTH population and dose dropped.",
  "",
  "Skip claims that don't carry a citation marker. Skip meta-statements about the evidence itself.",
  "",
  "Output JSON only: {\"per_claim\": [{\"claim_text\": \"...\", \"source_idx\": N, \"missing\": [\"population\", \"dose\", ...]}, ...]}",
  "If no claims have missing qualifiers, return {\"per_claim\": []}.",
  "Do not include any prose outside the JSON.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 1500 }) {
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
  if (!res.ok) throw new Error(`Validator ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export function parseValidationResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { per_claim: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.per_claim)) {
    return { per_claim: [], error: "malformed_json" };
  }
  const out = parsed.per_claim
    .map((c) => ({
      claim_text: String(c?.claim_text || "").trim(),
      source_idx: Number.isInteger(c?.source_idx) ? c.source_idx : null,
      missing: Array.isArray(c?.missing) ? c.missing.map(String).filter(Boolean) : [],
    }))
    .filter((c) => c.claim_text);
  return { per_claim: out, error: null };
}

export function computeQualifiersDroppedBreakdown(perClaim) {
  const out = {};
  for (const c of perClaim || []) {
    for (const q of c.missing || []) {
      out[q] = (out[q] || 0) + 1;
    }
  }
  return out;
}

function buildSourcesBlock(citedSources) {
  return citedSources
    .map((s) => `[${s.id}] qualifiers: ${JSON.stringify(s.qualifiers || {})}`)
    .join("\n");
}

function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export async function validateQualifierPreservation({
  prose,
  citedSources,
  callJudge = defaultCallJudge,
  model = mode2ValidatorModel(),
  disabledQualifiers = mode2DisabledQualifiers(),
} = {}) {
  const t0 = Date.now();
  if (!prose || !citedSources || citedSources.length === 0) {
    return {
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0,
      latency_ms: 0,
      raw_response: null,
      error: null,
    };
  }
  const userPrompt = [
    "RESPONSE PROSE:",
    prose,
    "",
    "CITED SOURCE QUALIFIERS:",
    buildSourcesBlock(citedSources),
    "",
    "Return JSON only.",
  ].join("\n");

  let raw = null;
  let error = null;
  let parsed = { per_claim: [] };
  try {
    raw = await callJudge({ system: SYSTEM_PROMPT, user: userPrompt, model });
    parsed = parseValidationResponse(raw);
    if (parsed.error) error = parsed.error;
  } catch (err) {
    error = err.message || String(err);
  }

  // Filter out disabled qualifier types
  const disabledSet = new Set(disabledQualifiers);
  const filtered = parsed.per_claim.map((c) => ({
    ...c,
    missing: c.missing.filter((q) => !disabledSet.has(q)),
  }));
  const claimsWithMissing = filtered.filter((c) => c.missing.length > 0);

  const breakdown = computeQualifiersDroppedBreakdown(claimsWithMissing);
  const totalMissing = claimsWithMissing.reduce((s, c) => s + c.missing.length, 0);

  const approxInTok = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);
  const approxOutTok = Math.ceil((raw || "").length / 4);

  return {
    per_claim_missing: claimsWithMissing,
    total_missing: totalMissing,
    qualifiers_dropped_breakdown: breakdown,
    cost_usd: estimateCostUsd({ inputTokens: approxInTok, outputTokens: approxOutTok }),
    latency_ms: Date.now() - t0,
    raw_response: raw,
    prompt_version: VALIDATION_PROMPT_VERSION,
    error,
  };
}
