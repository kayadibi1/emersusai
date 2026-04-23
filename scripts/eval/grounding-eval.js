// scripts/eval/grounding-eval.js
//
// 100-prompt eval comparing:
//   (A) bare gpt-5.4-mini — neutral fitness-coach system prompt, no retrieval, no citation requirement
//   (B) grounded Emersus — full retrieval, GROUNDING_ENFORCEMENT_ENABLED=true, inline [N] citations required
//
// Metrics per answer:
//   - citation_coverage (cited fact-sentences / all fact-sentences) — citation mode only
//   - grounding status (grounded | partial | ungrounded | no_claims)
//   - specific_number_claims (count of "N <unit>" hits)
//   - insufficient_evidence_signals (count of "retrieved evidence does not establish" / "inference" labels)
//   - unsupported_claim_count per LLM-as-judge (gpt-5.4 given sources + answer)
//
// Outputs JSON + MD to scripts/eval/results/.
//
// Usage:
//   GROUNDING_ENFORCEMENT_ENABLED=true node scripts/eval/grounding-eval.js --limit=100 --judge=on
//   GROUNDING_ENFORCEMENT_ENABLED=true node scripts/eval/grounding-eval.js --limit=10 --judge=off  (dry run)

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMessages } from "../../api/emersus/pipeline/prompt.js";
import { buildRequestBody } from "../../api/emersus/pipeline/synthesize.js";
import {
  formatEvidenceForModel,
  normalizeVectorEvidenceRow,
} from "../../api/emersus/pipeline/retrieve.js";
import { verifyAnswerGrounding } from "../../api/emersus/pipeline/grounding-verifier.js";
import { retrieveDatabaseEvidence } from "../../api/emersus/retrieveDatabaseEvidence.js";
import { dedupeEvidence, rankEvidence } from "../../api/emersus/rerank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "fixtures", "grounding-prompts.json");
const RESULTS_DIR = path.join(__dirname, "results");

const EMERSUS_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const BARE_MODEL = "gpt-5.4-mini";
const JUDGE_MODEL = process.env.GROUNDING_JUDGE_MODEL || "gpt-5.4";

const VECTOR_LIMIT = 6;
const MATCH_THRESHOLD = 0.4;
const MATCH_COUNT = 10;
const MAX_OUTPUT_TOKENS = 700;
const JUDGE_MAX_OUTPUT_TOKENS = 600;

const BARE_SYSTEM_PROMPT = [
  "You are a credentialed exercise physiologist and strength coach (PhD-level exercise physiology, CSCS-equivalent practical experience).",
  "Give specific, practical answers — real numbers (sets, reps, grams, mg, %1RM), no hype, no hedging filler.",
  "Lead with the answer. Be direct and concise. Do not use section headings.",
].join("\n");

// Per-claim fidelity grader: for each (claim, cited_sources) pair, ask if
// the cited sources specifically support that claim (vs. being a decorative
// marker whose content is only loosely related).
const FIDELITY_SYSTEM_PROMPT = [
  "You are a precise fact-checker evaluating whether each cited claim in an answer is directly supported by the specific sources it cites.",
  "",
  "You receive a list of (claim, cited_sources) pairs. For EACH pair, evaluate: do the cited sources directly and specifically support this exact claim? A decorative citation — where the source is topically related but does not actually establish the claim — is NOT support.",
  "",
  "Verdicts per pair:",
  "  'supported'    = at least one cited source directly establishes the claim",
  "  'weak'         = the cited source(s) are related to the topic but don't specifically establish the claim",
  "  'decoy'        = the cited source(s) discuss something materially different from the claim; citation is decorative",
  "  'contradicted' = the cited source(s) actually contradict the claim",
  "",
  "Output JSON only:",
  '  {"per_claim": [{"claim_index": N, "verdict": "supported|weak|decoy|contradicted", "reasoning": "<1 short sentence>"}, ...]}',
  "",
  "Do not include any prose outside the JSON object. Do not skip claims — emit exactly one row per input pair.",
].join("\n");

const JUDGE_SYSTEM_PROMPT = [
  "You are a careful fact-checker evaluating a fitness/nutrition coaching answer against a set of retrieved scientific passages.",
  "",
  "You receive:",
  "  1. A user question",
  "  2. The retrieved passages (with IDs 1..N) that were available to support an answer",
  "  3. A candidate answer",
  "",
  "Your task: list every factual claim in the answer that is NOT directly supported by the retrieved passages.",
  "A 'factual claim' is any empirical assertion about training, nutrition, supplementation, physiology, recovery, sleep, or cardiovascular/metabolic health. Specifically: claims about doses, effects, mechanisms, response sizes, timing, or comparative efficacy.",
  "",
  "Do NOT flag:",
  "  - Procedural/how-to instructions (e.g., 'keep your back flat')",
  "  - Conversational framing",
  "  - Clarifying questions",
  "  - Claims the answer itself explicitly labels as 'coaching inference' or 'the retrieved evidence does not establish X'",
  "",
  "Output JSON only, in this exact shape:",
  '  {"unsupported_claims": ["<verbatim claim 1>", "<verbatim claim 2>", ...], "supported_claim_count": N}',
  "",
  "If every factual claim is supported, return {\"unsupported_claims\": [], \"supported_claim_count\": N}.",
  "Do not include any prose outside the JSON object.",
].join("\n");

function parseArgs(argv) {
  const args = {
    limit: 100,
    judge: "on",
    fidelity: "off",
    paraphrase: "off",
    outDir: RESULTS_DIR,
    label: null,
    resume: null,
  };
  for (const raw of argv) {
    const [key, ...valueParts] = raw.split("=");
    const value = valueParts.join("=");
    if (key === "--limit") args.limit = Number(value) || 100;
    else if (key === "--judge") args.judge = value;
    else if (key === "--fidelity") args.fidelity = value;
    else if (key === "--paraphrase") args.paraphrase = value;
    else if (key === "--out-dir") args.outDir = path.resolve(process.cwd(), value);
    else if (key === "--label") args.label = value;
    else if (key === "--resume") args.resume = value || "auto";
  }
  return args;
}

// Locates the most recent snapshot for --resume. `resume` is either:
//   "auto"      — pick the newest grounding-eval-*.json file in outDir
//   "<label>"   — pick the newest grounding-eval-<label>-*.json
//   "<path>"    — explicit .json path
async function resolveResumeFile(resume, outDir, label) {
  if (!resume) return null;
  if (resume !== "auto" && resume.endsWith(".json")) {
    return path.isAbsolute(resume) ? resume : path.resolve(process.cwd(), resume);
  }
  const wantLabel = resume !== "auto" ? resume : (label || null);
  const files = await fs.readdir(outDir).catch(() => []);
  const matched = files.filter((f) =>
    f.startsWith("grounding-eval-") &&
    f.endsWith(".json") &&
    (!wantLabel || f.includes(`grounding-eval-${wantLabel}-`))
  );
  if (!matched.length) return null;
  // Newest by mtime — filenames include a timestamp but a sort by name is
  // not reliable across label/timestamp boundaries.
  const withStat = await Promise.all(matched.map(async (f) => {
    const p = path.join(outDir, f);
    const st = await fs.stat(p);
    return { p, mtime: st.mtimeMs };
  }));
  withStat.sort((a, b) => b.mtime - a.mtime);
  return withStat[0].p;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function stripProductionOnlyFields(body) {
  const stripped = { ...body };
  delete stripped.stream;
  delete stripped.tools;
  delete stripped.tool_choice;
  delete stripped.parallel_tool_calls;
  delete stripped.store;
  delete stripped.prompt_cache_key;
  delete stripped.prompt_cache_retention;
  return stripped;
}

function hasUsableEvidence(items) {
  return Array.isArray(items) && items.some((item) =>
    item?.is_title_only_match !== true &&
    typeof item?.excerpt === "string" &&
    item.excerpt.trim().length >= 120
  );
}

function makeEvidenceContext(items, error = null) {
  const usable = hasUsableEvidence(items);
  return {
    status: "completed",
    reason: error ? "retrieval_error" : null,
    available: items.length > 0,
    usable,
    usePolicy: items.length > 0
      ? (usable ? "retrieved_evidence_only" : "no_usable_evidence")
      : "no_usable_evidence",
    method: "vector",
    items,
    formatted: items.length ? formatEvidenceForModel(items) : "No database evidence retrieved.",
    error,
  };
}

async function retrieveEvidence(question) {
  const rawRows = await retrieveDatabaseEvidence({
    prompt: question,
    matchThreshold: MATCH_THRESHOLD,
    matchCount: MATCH_COUNT,
    includePreprints: true,
  });
  return rankEvidence(dedupeEvidence(rawRows.map(normalizeVectorEvidenceRow))).slice(0, VECTOR_LIMIT);
}

function extractOutputText(response) {
  if (response?.output_text) return response.output_text;
  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callResponses({ model, input, metadata, maxOutputTokens = MAX_OUTPUT_TOKENS }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const body = {
    model,
    input,
    max_output_tokens: maxOutputTokens,
    metadata,
  };
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI call failed (${response.status}): ${JSON.stringify(json)}`);
  }
  return {
    text: extractOutputText(json),
    usage: json?.usage || null,
    elapsed_ms: elapsedMs,
    response_id: json?.id || null,
  };
}

async function callBareGpt({ question, index }) {
  return callResponses({
    model: BARE_MODEL,
    input: [
      { role: "system", content: BARE_SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
    metadata: {
      eval_name: "grounding_eval",
      eval_variant: "bare_gpt",
      prompt_index: String(index),
    },
  });
}

async function callEmersus({ question, evidence, index }) {
  const evidenceContext = makeEvidenceContext(evidence);
  const messages = buildMessages({
    question,
    threadState: {},
    recentMessages: [],
    evidence: evidenceContext,
    workoutPlan: null,
    crossThreadMemory: null,
  });
  const requestBody = stripProductionOnlyFields(buildRequestBody({
    messages,
    tools: [],
    model: EMERSUS_MODEL,
    kind: "synthesis",
    metadata: {
      eval_name: "grounding_eval",
      eval_variant: "emersus_grounded",
      prompt_index: String(index),
    },
  }));
  requestBody.max_output_tokens = MAX_OUTPUT_TOKENS;

  const result = await callResponses({
    model: EMERSUS_MODEL,
    input: requestBody.input,
    metadata: requestBody.metadata,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  return { ...result, evidence_context: evidenceContext };
}

function formatEvidenceForJudge(items) {
  if (!items.length) return "No sources were retrieved for this question.";
  return items.map((it, i) => {
    const header = [it.publication_year, it.publication_type, it.journal, it.title]
      .filter(Boolean).join(" · ");
    const excerpt = it.excerpt || it.summary || "(no excerpt)";
    return `[${i + 1}] ${header}\n    ${excerpt}`;
  }).join("\n\n");
}

async function judge({ question, answer, evidence, index, variant }) {
  const evidenceText = formatEvidenceForJudge(evidence);
  const userPrompt = [
    `QUESTION:\n${question}`,
    "",
    `RETRIEVED PASSAGES:\n${evidenceText}`,
    "",
    `CANDIDATE ANSWER:\n${answer}`,
  ].join("\n");

  let raw;
  try {
    const result = await callResponses({
      model: JUDGE_MODEL,
      input: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      metadata: {
        eval_name: "grounding_eval",
        eval_variant: `judge_${variant}`,
        prompt_index: String(index),
      },
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    });
    raw = result.text;
  } catch (err) {
    return { unsupported_claims: [], supported_claim_count: 0, error: err.message, raw: null };
  }

  // Strip markdown code fences if the judge wrapped JSON in ```json ... ```
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      unsupported_claims: Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : [],
      supported_claim_count: Number(parsed.supported_claim_count || 0),
      error: null,
      raw,
    };
  } catch (err) {
    return { unsupported_claims: [], supported_claim_count: 0, error: `parse: ${err.message}`, raw };
  }
}

const SPECIFIC_NUMBER_RE = /\b\d+(?:\.\d+)?\s?(?:g|mg|kg|lb|lbs|%|min|minutes?|hours?|h|days?|weeks?|wks?|sets?|reps?|rpe|rm|kcal|calories?|bpm|ml|oz)\b/gi;
const INFERENCE_SIGNAL_RE =
  /\b(as a coaching inference|coaching inference|my inference|retrieved evidence does not establish|retrieved evidence doesn.?t establish|retrieved evidence does not (?:provide|support))\b/gi;

function countMatches(text, regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const matches = String(text || "").match(re);
  return matches ? matches.length : 0;
}

// ─── Per-claim extractor ─────────────────────────────────────────────────────
// Walks the answer sentence-by-sentence, pulls out citesrcN markers and
// returns [{ claim_index, sentence, cited_source_ids }] for every sentence
// that carries at least one marker. Legacy [N] markers are also accepted.
const CLAIM_SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
// U+E200 (CITATION_START) + literal "cite" + U+E202 (CITATION_DELIMITER)
// + literal "src" + digits + U+E201 (CITATION_STOP). OpenAI's recommended
// strict citation marker format. Written with explicit \u escapes to
// survive tools that strip invisible PUA characters from regex literals.
const STRICT_MARKER_RE = /\u{E200}cite\u{E202}src(\d{1,2})\u{E201}/gu;
const LEGACY_MARKER_RE = /\[(\d{1,2})\]/g;

function extractCitedClaims(answer, sourceCount) {
  const sentences = String(answer || "")
    .replace(/\s+/g, " ")
    .split(CLAIM_SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const claims = [];
  sentences.forEach((sentence, idx) => {
    const ids = new Set();
    // Clone the regexes (reset lastIndex) while preserving the `u` flag
    // that makes \u{E200}-style escapes parse as Unicode code points.
    const strictRe = new RegExp(STRICT_MARKER_RE.source, STRICT_MARKER_RE.flags);
    const legacyRe = new RegExp(LEGACY_MARKER_RE.source, LEGACY_MARKER_RE.flags);
    let m;
    while ((m = strictRe.exec(sentence)) !== null) {
      const n = Number(m[1]);
      if (n >= 1 && n <= sourceCount) ids.add(n);
    }
    while ((m = legacyRe.exec(sentence)) !== null) {
      const n = Number(m[1]);
      if (n >= 1 && n <= sourceCount) ids.add(n);
    }
    if (ids.size > 0) {
      claims.push({
        claim_index: idx,
        sentence,
        cited_source_ids: Array.from(ids).sort((a, b) => a - b),
      });
    }
  });
  return claims;
}

// ─── Per-claim fidelity grader ───────────────────────────────────────────────
async function fidelityGrade({ question, answer, evidence, index }) {
  const citedClaims = extractCitedClaims(answer, evidence.length);
  if (!citedClaims.length) {
    return { per_claim: [], summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: 0 }, error: null, raw: null };
  }

  const evidenceText = formatEvidenceForJudge(evidence);
  const pairsBlock = citedClaims.map((c, i) =>
    `[pair ${i}] claim: "${c.sentence}"\n    cited sources: ${c.cited_source_ids.map((n) => `src${n}`).join(", ")}`
  ).join("\n\n");

  const userPrompt = [
    `QUESTION:\n${question}`,
    "",
    `RETRIEVED PASSAGES:\n${evidenceText}`,
    "",
    `CITED-CLAIM PAIRS TO GRADE:\n${pairsBlock}`,
  ].join("\n");

  let raw;
  try {
    const result = await callResponses({
      model: JUDGE_MODEL,
      input: [
        { role: "system", content: FIDELITY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      metadata: {
        eval_name: "grounding_eval",
        eval_variant: "fidelity",
        prompt_index: String(index),
      },
      maxOutputTokens: 1200,
    });
    raw = result.text;
  } catch (err) {
    return {
      per_claim: citedClaims.map((c, i) => ({ claim_index: i, verdict: "unknown", reasoning: `grader error: ${err.message}` })),
      summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: citedClaims.length },
      error: err.message,
      raw: null,
    };
  }

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      per_claim: citedClaims.map((c, i) => ({ claim_index: i, verdict: "unknown", reasoning: "parse failure" })),
      summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: citedClaims.length },
      error: `parse: ${err.message}`,
      raw,
    };
  }

  const perClaim = (Array.isArray(parsed.per_claim) ? parsed.per_claim : []).map((row) => {
    const src = citedClaims[row.claim_index] || null;
    return {
      claim_index: Number(row.claim_index),
      sentence: src?.sentence || null,
      cited_source_ids: src?.cited_source_ids || [],
      verdict: String(row.verdict || "unknown"),
      reasoning: String(row.reasoning || ""),
    };
  });

  const summary = { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: perClaim.length };
  for (const row of perClaim) {
    if (row.verdict in summary) summary[row.verdict] += 1;
  }

  return { per_claim: perClaim, summary, error: null, raw };
}

// ─── Embeddings-based paraphrase detector ────────────────────────────────────
const EMBEDDING_MODEL = process.env.GROUNDING_EMBEDDING_MODEL || "text-embedding-3-small";
const PARAPHRASE_LOW_THRESHOLD = 0.35;

async function embedTexts(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");
  const body = { model: EMBEDDING_MODEL, input: texts };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`embeddings failed: ${JSON.stringify(json)}`);
  return json.data.map((r) => r.embedding);
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function paraphraseGrade({ answer, evidence }) {
  const citedClaims = extractCitedClaims(answer, evidence.length);
  if (!citedClaims.length) {
    return { per_claim: [], summary: { mean_sim: null, low_sim_count: 0, total: 0 }, error: null };
  }

  const sourceTexts = evidence.map((it) => {
    const body = [it.title, it.excerpt, it.summary, it.chunk_text].filter(Boolean).join(" ");
    return body.slice(0, 2000);
  });
  const claimTexts = citedClaims.map((c) => c.sentence);

  let claimEmbeds, sourceEmbeds;
  try {
    // Batch for efficiency. Note: 2 calls rather than interleaving so a
    // failure in one doesn't corrupt the other.
    [claimEmbeds, sourceEmbeds] = await Promise.all([
      embedTexts(claimTexts),
      embedTexts(sourceTexts),
    ]);
  } catch (err) {
    return { per_claim: [], summary: { mean_sim: null, low_sim_count: 0, total: 0 }, error: err.message };
  }

  const perClaim = citedClaims.map((c, i) => {
    const sims = c.cited_source_ids.map((n) => {
      const srcIdx = n - 1;
      if (srcIdx < 0 || srcIdx >= sourceEmbeds.length) return null;
      return { source_id: n, similarity: Number(cosineSim(claimEmbeds[i], sourceEmbeds[srcIdx]).toFixed(3)) };
    }).filter(Boolean);
    const best = sims.reduce((b, s) => (s.similarity > b ? s.similarity : b), 0);
    return {
      claim_index: c.claim_index,
      sentence: c.sentence,
      cited_source_ids: c.cited_source_ids,
      per_source_similarity: sims,
      best_similarity: Number(best.toFixed(3)),
      below_threshold: best < PARAPHRASE_LOW_THRESHOLD,
    };
  });

  const totals = perClaim.length;
  const meanSim = totals ? Number((perClaim.reduce((s, r) => s + r.best_similarity, 0) / totals).toFixed(3)) : null;
  const lowSim = perClaim.filter((r) => r.below_threshold).length;
  return {
    per_claim: perClaim,
    summary: { mean_sim: meanSim, low_sim_count: lowSim, total: totals, threshold: PARAPHRASE_LOW_THRESHOLD },
    error: null,
  };
}

function scoreAnswer({ answer, evidence, variant }) {
  const citation = verifyAnswerGrounding({
    answerText: answer,
    evidenceItems: evidence,
    mode: "citation",
  });
  const legacy = verifyAnswerGrounding({
    answerText: answer,
    evidenceItems: evidence,
    mode: "legacy",
  });
  return {
    variant,
    status: citation.status,
    factual_sentences: citation.factual_sentences,
    cited_sentences: citation.cited_sentences,
    cited_fraction: citation.cited_fraction,
    uncited_claim_count: citation.uncited_claims.length,
    invalid_marker_count: citation.invalid_markers.length,
    unique_markers: citation.unique_markers,
    legacy_checked_claims: legacy.checked_claims,
    legacy_unsupported_claims: legacy.unsupported_claims.length,
    specific_number_claims: countMatches(answer, SPECIFIC_NUMBER_RE),
    inference_labels: countMatches(answer, INFERENCE_SIGNAL_RE),
    answer_chars: String(answer || "").length,
  };
}

function buildSummary(results) {
  const total = results.length;
  const agg = (key, variant) => results.reduce((sum, r) => sum + (r.scores[variant][key] || 0), 0);
  const mean = (key, variant) => total ? (agg(key, variant) / total).toFixed(2) : "0.00";

  const withEvidence = results.filter((r) => r.evidence.length > 0).length;
  const usableEvidence = results.filter((r) => r.emersus.evidence_context?.usePolicy === "retrieved_evidence_only").length;

  const bareUnsupportedJudge = results.reduce((sum, r) => sum + (r.judge?.bare?.unsupported_claims?.length || 0), 0);
  const emersusUnsupportedJudge = results.reduce((sum, r) => sum + (r.judge?.emersus?.unsupported_claims?.length || 0), 0);
  const reductionPct = bareUnsupportedJudge > 0
    ? ((1 - emersusUnsupportedJudge / bareUnsupportedJudge) * 100).toFixed(1)
    : "n/a";

  return {
    total_prompts: total,
    prompts_with_evidence: withEvidence,
    prompts_with_usable_evidence: usableEvidence,
    bare: {
      mean_factual_sentences: mean("factual_sentences", "bare"),
      mean_specific_number_claims: mean("specific_number_claims", "bare"),
      mean_inference_labels: mean("inference_labels", "bare"),
      mean_legacy_unsupported: mean("legacy_unsupported_claims", "bare"),
    },
    emersus: {
      mean_factual_sentences: mean("factual_sentences", "emersus"),
      mean_cited_sentences: mean("cited_sentences", "emersus"),
      mean_cited_fraction: (results.reduce((s, r) => s + (r.scores.emersus.cited_fraction || 0), 0) / total).toFixed(3),
      status_grounded: results.filter((r) => r.scores.emersus.status === "grounded").length,
      status_partial: results.filter((r) => r.scores.emersus.status === "partial").length,
      status_ungrounded: results.filter((r) => r.scores.emersus.status === "ungrounded").length,
      status_no_claims: results.filter((r) => r.scores.emersus.status === "no_claims").length,
      mean_invalid_markers: mean("invalid_marker_count", "emersus"),
      mean_uncited_claims: mean("uncited_claim_count", "emersus"),
      mean_inference_labels: mean("inference_labels", "emersus"),
      mean_specific_number_claims: mean("specific_number_claims", "emersus"),
      mean_legacy_unsupported: mean("legacy_unsupported_claims", "emersus"),
    },
    judge: {
      bare_total_unsupported: bareUnsupportedJudge,
      emersus_total_unsupported: emersusUnsupportedJudge,
      reduction_pct: reductionPct,
      pass_40pct_gate: typeof reductionPct === "string" && reductionPct !== "n/a" && Number(reductionPct) >= 40,
    },
    fidelity: (() => {
      const rs = results.filter((r) => r.fidelity && r.fidelity.summary);
      if (!rs.length) return null;
      const agg = { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: 0 };
      for (const r of rs) {
        for (const k of Object.keys(agg)) agg[k] += Number(r.fidelity.summary[k] || 0);
      }
      const decoyPlusContra = agg.decoy + agg.contradicted;
      return {
        graded_prompts: rs.length,
        per_verdict: agg,
        decoy_plus_contradicted_rate: agg.total ? Number((decoyPlusContra / agg.total).toFixed(3)) : null,
        supported_rate: agg.total ? Number((agg.supported / agg.total).toFixed(3)) : null,
      };
    })(),
    paraphrase: (() => {
      const rs = results.filter((r) => r.paraphrase && r.paraphrase.summary && r.paraphrase.summary.total > 0);
      if (!rs.length) return null;
      const totals = rs.reduce((a, r) => a + r.paraphrase.summary.total, 0);
      const lows = rs.reduce((a, r) => a + r.paraphrase.summary.low_sim_count, 0);
      const sumMean = rs.reduce((a, r) => a + (r.paraphrase.summary.mean_sim || 0), 0);
      return {
        graded_prompts: rs.length,
        total_cited_claims: totals,
        low_similarity_count: lows,
        low_similarity_rate: totals ? Number((lows / totals).toFixed(3)) : null,
        mean_of_per_prompt_mean_sim: Number((sumMean / rs.length).toFixed(3)),
        threshold: PARAPHRASE_LOW_THRESHOLD,
      };
    })(),
  };
}

function buildMarkdown({ summary, results, generatedAt, model, label }) {
  const rows = results.map((r) => [
    r.index,
    r.category,
    r.question.replace(/\|/g, "\\|"),
    r.evidence.length,
    r.scores.emersus.status,
    r.scores.emersus.cited_fraction,
    r.scores.bare.specific_number_claims,
    r.scores.emersus.specific_number_claims,
    r.judge?.bare?.unsupported_claims?.length ?? "—",
    r.judge?.emersus?.unsupported_claims?.length ?? "—",
  ].join(" | ")).join("\n");

  const detail = results.map((r) => {
    const evidenceList = r.evidence.length
      ? r.evidence.map((it, i) => `${i + 1}. ${it.title || "Untitled"} (${it.publication_year || "n.d."}) ${it.url || ""}\n   ${it.excerpt || "_no excerpt_"}`).join("\n")
      : "_No retrieved evidence._";
    return [
      `\n## ${r.index}. [${r.category}] ${r.question}`,
      "",
      "### Bare gpt-5.4-mini",
      "",
      r.bare.text || "_No answer._",
      "",
      "### Emersus (grounded)",
      "",
      r.emersus.text || "_No answer._",
      "",
      "### Retrieved Evidence",
      "",
      evidenceList,
      "",
      "### Scores",
      "",
      `- Emersus status: \`${r.scores.emersus.status}\` (${r.scores.emersus.cited_sentences}/${r.scores.emersus.factual_sentences} fact-sentences cited)`,
      `- Emersus invalid markers: ${r.scores.emersus.invalid_marker_count}`,
      `- Bare numeric claims: ${r.scores.bare.specific_number_claims} · Emersus: ${r.scores.emersus.specific_number_claims}`,
      `- Judge unsupported claims — bare: ${r.judge?.bare?.unsupported_claims?.length ?? "—"} · Emersus: ${r.judge?.emersus?.unsupported_claims?.length ?? "—"}`,
      "",
    ].join("\n");
  }).join("\n");

  return [
    `# Grounding Eval — bare gpt-5.4-mini vs grounded Emersus`,
    "",
    `Generated: ${generatedAt}`,
    `Model: \`${model}\``,
    `Judge: \`${JUDGE_MODEL}\``,
    label ? `Label: ${label}` : null,
    `Prompts: ${results.length}`,
    "",
    "## Summary",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "## Per-prompt index",
    "",
    "index | category | question | evidence | emersus_status | cited_frac | bare_#s | emersus_#s | judge_bare | judge_emersus",
    "--- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---:",
    rows,
    "",
    detail,
  ].filter(Boolean).join("\n");
}

async function writeArtifacts({ outDir, runId, model, generatedAt, label, results, summary }) {
  await fs.mkdir(outDir, { recursive: true });
  const tag = label ? `${label}-` : "";
  const jsonPath = path.join(outDir, `grounding-eval-${tag}${runId}.json`);
  const mdPath = path.join(outDir, `grounding-eval-${tag}${runId}.md`);
  await fs.writeFile(jsonPath, JSON.stringify({ generated_at: generatedAt, model, label, summary, results }, null, 2), "utf8");
  await fs.writeFile(mdPath, buildMarkdown({ summary, results, generatedAt, model, label }), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const groundingEnforced = String(process.env.GROUNDING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
  if (!groundingEnforced) {
    console.warn("[eval] GROUNDING_ENFORCEMENT_ENABLED is not set to 'true' — the Emersus arm will use the LEGACY prompt.");
    console.warn("[eval] For a meaningful grounded eval, re-run with: GROUNDING_ENFORCEMENT_ENABLED=true node scripts/eval/grounding-eval.js ...");
  }

  const fixture = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const prompts = fixture.slice(0, args.limit);

  // Resume support: if --resume is passed, try to continue from the
  // newest matching snapshot in outDir. We reuse the prior run's
  // generatedAt + runId so follow-up snapshots append to the SAME
  // files (so the resumed run produces one continuous artifact).
  let generatedAt = new Date().toISOString();
  let runId = timestampForFile(new Date());
  let results = [];
  let skipIndices = new Set();
  const resumeFile = await resolveResumeFile(args.resume, args.outDir, args.label);
  if (resumeFile) {
    try {
      const prior = JSON.parse(await fs.readFile(resumeFile, "utf8"));
      if (Array.isArray(prior.results)) {
        results = prior.results;
        skipIndices = new Set(results.map((r) => r.index));
        if (prior.generated_at) generatedAt = prior.generated_at;
        // Recover runId from the snapshot filename so writeArtifacts
        // overwrites the same file.
        const m = path.basename(resumeFile).match(/grounding-eval-.*?(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)\.json$/);
        if (m) runId = m[1];
        console.log(`[eval] resuming from ${resumeFile} (${results.length} prompts already done)`);
      }
    } catch (err) {
      console.warn(`[eval] resume file ${resumeFile} unreadable: ${err.message} — starting fresh`);
    }
  }

  console.log(`[eval] emersus_model=${EMERSUS_MODEL}`);
  console.log(`[eval] bare_model=${BARE_MODEL}`);
  console.log(`[eval] judge=${args.judge === "on" ? JUDGE_MODEL : "disabled"}`);
  console.log(`[eval] fidelity=${args.fidelity === "on" ? JUDGE_MODEL : "disabled"}`);
  console.log(`[eval] paraphrase=${args.paraphrase === "on" ? EMBEDDING_MODEL : "disabled"}`);
  console.log(`[eval] prompts=${prompts.length} (of ${fixture.length} available)`);
  console.log(`[eval] grounding_enforcement=${groundingEnforced}`);
  console.log(`[eval] out=${args.outDir}`);

  for (let i = 0; i < prompts.length; i++) {
    const index = i + 1;
    if (skipIndices.has(index)) continue;
    const { question, category } = prompts[i];
    const started = Date.now();
    console.log(`[eval] ${index}/${prompts.length} [${category}]: ${question}`);

    let evidence = [];
    let retrievalError = null;
    try {
      evidence = await retrieveEvidence(question);
    } catch (err) {
      retrievalError = err?.message || String(err);
      console.warn(`  retrieval error: ${retrievalError}`);
    }

    const [bare, emersus] = await Promise.all([
      callBareGpt({ question, index }).catch((err) => ({ text: `[ERROR] ${err.message}`, usage: null, elapsed_ms: 0, response_id: null, error: err.message })),
      callEmersus({ question, evidence, index }).catch((err) => ({ text: `[ERROR] ${err.message}`, usage: null, elapsed_ms: 0, response_id: null, error: err.message, evidence_context: makeEvidenceContext(evidence) })),
    ]);

    const scores = {
      bare: scoreAnswer({ answer: bare.text, evidence, variant: "bare" }),
      emersus: scoreAnswer({ answer: emersus.text, evidence, variant: "emersus" }),
    };

    // All four grader calls run in parallel — they're independent reads
    // of (bare, emersus, evidence). Cuts per-prompt wall-clock roughly
    // in half vs. awaiting each in sequence.
    const graderTasks = {
      judge: args.judge === "on" && !bare.error && !emersus.error
        ? Promise.all([
            judge({ question, answer: bare.text, evidence, index, variant: "bare" }),
            judge({ question, answer: emersus.text, evidence, index, variant: "emersus" }),
          ]).then(([jBare, jEmersus]) => ({ bare: jBare, emersus: jEmersus }))
        : Promise.resolve(null),
      fidelity: args.fidelity === "on" && !emersus.error && evidence.length > 0
        ? fidelityGrade({ question, answer: emersus.text, evidence, index })
        : Promise.resolve(null),
      paraphrase: args.paraphrase === "on" && !emersus.error && evidence.length > 0
        ? paraphraseGrade({ answer: emersus.text, evidence })
        : Promise.resolve(null),
    };
    const [judgeResults, fidelityResult, paraphraseResult] = await Promise.all([
      graderTasks.judge,
      graderTasks.fidelity,
      graderTasks.paraphrase,
    ]);

    results.push({
      index,
      category,
      question,
      elapsed_ms: Date.now() - started,
      retrieval_error: retrievalError,
      evidence: evidence.map((it) => ({
        title: it.title,
        journal: it.journal,
        publication_year: it.publication_year,
        publication_type: it.publication_type,
        url: it.url,
        similarity: it.similarity,
        is_title_only_match: it.is_title_only_match === true,
        excerpt: it.excerpt,
      })),
      bare: {
        text: bare.text,
        usage: bare.usage,
        elapsed_ms: bare.elapsed_ms,
        response_id: bare.response_id,
        error: bare.error || null,
      },
      emersus: {
        text: emersus.text,
        usage: emersus.usage,
        elapsed_ms: emersus.elapsed_ms,
        response_id: emersus.response_id,
        error: emersus.error || null,
        evidence_context: emersus.evidence_context
          ? { available: emersus.evidence_context.available, usable: emersus.evidence_context.usable, usePolicy: emersus.evidence_context.usePolicy }
          : null,
      },
      scores,
      judge: judgeResults,
      fidelity: fidelityResult,
      paraphrase: paraphraseResult,
    });

    // Incremental snapshot so a crash doesn't lose progress. After
    // resume, `results` may contain prior entries interleaved with new
    // ones; sort by index before persisting so the snapshot stays in
    // natural order.
    if (index % 10 === 0 || index === prompts.length) {
      results.sort((a, b) => a.index - b.index);
      const summary = buildSummary(results);
      await writeArtifacts({
        outDir: args.outDir,
        runId,
        model: EMERSUS_MODEL,
        generatedAt,
        label: args.label,
        results,
        summary,
      });
      console.log(`  snapshot ${index}/${prompts.length} — bare_unsup=${summary.judge?.bare_total_unsupported ?? "?"} em_unsup=${summary.judge?.emersus_total_unsupported ?? "?"} reduction=${summary.judge?.reduction_pct ?? "?"}%`);
    }
  }

  const summary = buildSummary(results);
  const paths = await writeArtifacts({
    outDir: args.outDir,
    runId,
    model: EMERSUS_MODEL,
    generatedAt,
    label: args.label,
    results,
    summary,
  });

  console.log("\n[eval] complete");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n[eval] json: ${paths.jsonPath}`);
  console.log(`[eval] md:   ${paths.mdPath}`);
}

main().catch((err) => {
  console.error("[eval] failed:");
  console.error(err);
  process.exit(1);
});
