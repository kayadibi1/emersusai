// scripts/eval/lib/query-expand.js
//
// Three query-transform strategies for the retrieval matrix eval:
//
//   multiQuery(q) — LLM generates 3-5 specific sub-queries from the broad
//     input. For "sugar and athletic performance" → ["carbohydrate mouth
//     rinse endurance performance", "glucose-fructose oxidation cycling",
//     "sucrose ergogenic effect RCT", ...]. Each sub-query retrieves
//     separately; caller merges pools with RRF.
//
//   hyde(q) — LLM generates a hypothetical domain answer (50-150 words).
//     Embed THAT instead of the original question. The hypothetical
//     naturally contains specific terminology that lands closer to
//     relevant chunks in vector space.
//
//   picos(q) — Population/Intervention/Comparison/Outcome decomposition.
//     For evidence-based fitness/nutrition queries; maps to PubMed's
//     canonical EBM structure. Returns 3 structured sub-queries: a
//     PICO-form, an intervention-heavy form, and an outcome-heavy form.
//
// All three return an array of query strings (including the original at
// index 0 for a safety net). Caller embeds each and runs the RPC per
// string. Keep the LLM on low temperature so the expansions are
// reproducible across bench runs.

import { openai } from "../../../api/lib/clients.js";

const MODEL = "gpt-4.1-mini";
const TEMPERATURE = 0.2;

const MULTI_QUERY_SYSTEM = `You are a retrieval query rewriter for a biomedical / exercise-science literature search system.

Given a user question, produce 4 additional specific search queries that would retrieve highly relevant primary research papers. Each sub-query must use SPECIFIC scientific terminology (drug/substrate names, physiological mechanism, population descriptor, outcome metric) — not paraphrases of the user's phrasing.

Good sub-query examples for "sugar and athletic performance":
- "carbohydrate mouth rinse endurance performance"
- "glucose-fructose co-ingestion exogenous oxidation rate cycling"
- "sucrose vs glucose ergogenic effect trained athletes"
- "exogenous carbohydrate intake rate endurance exercise"

Bad sub-query examples:
- "sugar athletic performance" (same as input)
- "effect of sugar on sports" (paraphrase, no specific vocab)
- "athletes and sugar intake" (no mechanism / intervention specificity)

Return STRICT JSON: {"queries": ["q1", "q2", "q3", "q4"]}. No prose, no markdown.`;

const HYDE_SYSTEM = `You are writing a hypothetical scientific answer that would appear in a biomedical / exercise-science literature review.

Given a user question, write a 60-120 word passage that reads like a sentence from a systematic review paragraph. Use specific substrate/drug names, mechanism terms, quantitative dosages, and population descriptors. Do NOT hedge. Do NOT answer the user — write as if citing existing research that grounds the answer.

Good example for "sugar and athletic performance":
"Carbohydrate ingestion during endurance exercise lasting longer than 60 minutes improves performance by approximately 2–3% via maintained blood glucose and increased exogenous carbohydrate oxidation. Multiple transportable carbohydrate formulations (e.g., glucose-fructose at a 2:1 ratio) raise oxidation rates to ~1.5 g/min versus ~1.0 g/min for glucose alone. Short-duration high-intensity efforts (<45 minutes) show ergogenic effects from carbohydrate mouth rinsing alone, attributed to central oral carbohydrate receptor activation rather than substrate provision."

Return only the passage. No JSON, no prefix, no markdown.`;

const PICOS_SYSTEM = `You are decomposing a user's biomedical / exercise-science query into Population / Intervention / Comparison / Outcome (PICO) components, then producing 3 structured search queries.

Given a user question, extract:
  P: target population (athletes? resistance-trained males? endurance cyclists? older adults?)
  I: intervention / exposure (substance, dose, timing, modality)
  C: comparison (placebo? alternative intervention? pre/post?)
  O: outcome metric (time-trial performance? 1RM? VO2max? muscle protein synthesis?)

Then produce three search queries:
  1. A PICO-concatenated form: "<P> <I> <C> <O>"
  2. An intervention-centric form emphasizing mechanism/substrate
  3. An outcome-centric form emphasizing the measurable endpoint

Return STRICT JSON: {"pico": {"P": "...", "I": "...", "C": "...", "O": "..."}, "queries": ["q1", "q2", "q3"]}. No prose, no markdown.`;

async function callLLM({ system, user }) {
  if (!openai) throw new Error("OPENAI_API_KEY missing — cannot run query expansion.");
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return response.choices[0]?.message?.content || "";
}

function parseJsonOrThrow(raw, label) {
  const trimmed = String(raw || "").trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`${label}: no JSON object in response: ${trimmed.slice(0, 200)}`);
  }
  const candidate = trimmed.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(candidate);
}

export async function multiQuery(question) {
  const raw = await callLLM({
    system: MULTI_QUERY_SYSTEM,
    user: question,
  });
  const parsed = parseJsonOrThrow(raw, "multiQuery");
  const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
  const cleaned = queries
    .map((q) => String(q || "").trim())
    .filter((q) => q.length > 0 && q.length < 200);
  // Original first, then expansions. Dedupe in case the LLM echoed the input.
  const seen = new Set();
  const out = [];
  for (const q of [question, ...cleaned]) {
    const k = q.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  }
  return out;
}

export async function hyde(question) {
  const passage = await callLLM({
    system: HYDE_SYSTEM,
    user: question,
  });
  const cleaned = String(passage || "").trim();
  if (!cleaned) return [question];
  // Both original and hypothetical — we embed both. Original gives the
  // baseline retrieval signal; hypothetical gives the vocabulary bridge.
  return [question, cleaned];
}

export async function picos(question) {
  const raw = await callLLM({
    system: PICOS_SYSTEM,
    user: question,
  });
  const parsed = parseJsonOrThrow(raw, "picos");
  const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
  const cleaned = queries
    .map((q) => String(q || "").trim())
    .filter((q) => q.length > 0 && q.length < 200);
  const seen = new Set();
  const out = [];
  for (const q of [question, ...cleaned]) {
    const k = q.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  }
  return { queries: out, pico: parsed.pico || null };
}

export async function multiQueryPlusPicos(question) {
  const [mq, pc] = await Promise.all([
    multiQuery(question),
    picos(question),
  ]);
  const seen = new Set();
  const out = [];
  for (const q of [...mq, ...pc.queries]) {
    const k = q.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  }
  return out;
}

// Null-object transform — used as the baseline in the matrix. Just echoes
// the input as a single-element array so the runner has a uniform shape.
export async function identity(question) {
  return [question];
}

export const STRATEGIES = {
  none: identity,
  "multi-query": multiQuery,
  hyde: async (q) => hyde(q),
  picos: async (q) => {
    const r = await picos(q);
    return r.queries;
  },
  "multi-query+picos": multiQueryPlusPicos,
};
