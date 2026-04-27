// api/emersus/pipeline/mode2-qualifier-extract.js
//
// Per-source qualifier extractor for the Mode-2 Qualifier-Preservation
// Verifier. Reads (title, excerpt, abstract?, full_text?) of one cited
// source and asks gpt-5.4-mini to emit any qualifiers present in the
// source as an open-ended key-value dict. Caches per-source-id within
// a single chat (same source cited twice → one extraction).

import { mode2ExtractorModel } from "./mode2-flags.js";

export const QUALIFIER_EXTRACTION_PROMPT_VERSION = "qualifier-extract-v1";

const SYSTEM_PROMPT = [
  "You are a scientific abstract reader. Extract any QUALIFIERS the source's findings depend on.",
  "",
  "QUALIFIERS are conditions that limit or specify when/where the findings apply:",
  "  - population (trained men, elderly women, mice, etc.)",
  "  - intervention (creatine monohydrate, supervised exercise, etc.)",
  "  - comparator (vs placebo, vs control, vs another intervention)",
  "  - outcome (1RM bench press, hbA1c, time-to-exhaustion)",
  "  - dose (5g/day, 1000 mg, etc.)",
  "  - duration (8 weeks, 6 months, acute single bout)",
  "  - effect_size (+7%, p<0.05, hedges effect)",
  "  - study_design (RCT, meta-analysis, observational, animal model, mechanistic)",
  "  - sample_size (n=24, n=1120)",
  "  - other domain-specific qualifiers as relevant",
  "",
  "OUTPUT JSON only: {\"qualifiers\": {[key]: value}}. Use whatever keys best describe the source. Empty {} if no clear qualifiers.",
  "Use lowercase string values. If multiple values for one key, comma-separate (e.g. \"population\": \"trained men, untrained men\").",
  "",
  "Do NOT extract qualifiers that aren't actually in the source. Do NOT invent specifics.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 600 }) {
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
  if (!res.ok) throw new Error(`Extractor ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export function parseQualifierExtractionResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { qualifiers: {}, error: "malformed_json" };
  }
  if (!parsed || typeof parsed.qualifiers !== "object" || parsed.qualifiers === null) {
    return { qualifiers: {}, error: "malformed_json" };
  }
  const out = {};
  for (const [k, v] of Object.entries(parsed.qualifiers)) {
    if (v == null) continue;
    const sval = String(v).trim();
    if (!sval) continue;
    out[String(k).toLowerCase()] = sval;
  }
  return { qualifiers: out, error: null };
}

function buildUserPrompt({ title, excerpt, abstract, full_text }) {
  const parts = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (excerpt) parts.push(`EXCERPT/CHUNK:\n${excerpt}`);
  if (abstract && abstract !== excerpt) parts.push(`ABSTRACT:\n${abstract}`);
  if (full_text) parts.push(`FULL TEXT (first 8K chars):\n${String(full_text).slice(0, 8000)}`);
  parts.push("\nReturn JSON only.");
  return parts.join("\n\n");
}

// Rough cost estimate. Input: ~system 250 tok + user up to 8K chars (~2K tok).
// Output: up to 600 tokens. gpt-5.4-mini at ~$0.15/M input + $0.60/M output.
function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export function buildQualifierExtractor({
  callJudge = defaultCallJudge,
  model = mode2ExtractorModel(),
} = {}) {
  const cache = new Map();
  return {
    async extract(source) {
      const sid = source?.source_id ?? source?.id;
      if (sid != null && cache.has(sid)) {
        return { ...cache.get(sid), cached: true };
      }
      const t0 = Date.now();
      const userPrompt = buildUserPrompt(source);
      let raw, error = null, parsed = { qualifiers: {} };
      try {
        raw = await callJudge({
          system: SYSTEM_PROMPT,
          user: userPrompt,
          model,
        });
        parsed = parseQualifierExtractionResponse(raw);
        if (parsed.error) error = parsed.error;
      } catch (err) {
        error = err.message || String(err);
      }
      // Heuristic token estimate (we don't have usage from the API in our path).
      const approxInTok = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);
      const approxOutTok = Math.ceil((raw || "").length / 4);
      const result = {
        qualifiers: parsed.qualifiers || {},
        error,
        cost_usd: estimateCostUsd({ inputTokens: approxInTok, outputTokens: approxOutTok }),
        latency_ms: Date.now() - t0,
        prompt_version: QUALIFIER_EXTRACTION_PROMPT_VERSION,
      };
      if (sid != null) cache.set(sid, result);
      return result;
    },
    _cacheSize() { return cache.size; },
  };
}
