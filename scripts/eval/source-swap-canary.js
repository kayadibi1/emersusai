// scripts/eval/source-swap-canary.js
//
// Source-swap canary. For each prompt:
//   (a) retrieve evidence normally → ordered list [S1, S2, ..., Sn]
//   (b) run Emersus, capture the cited marker IDs (the "original profile")
//   (c) permute the source ORDER so IDs point to different content
//       (rotate-by-N). IDs 1..n are preserved; the CONTENT at each ID is shuffled
//   (d) run Emersus again, capture cited marker IDs (the "swapped profile")
//
// Interpretation: a grounded model's marker profile should FOLLOW the content.
// If source S-creatine was at position 1 originally and position 3 after
// swap, the grounded model should cite [3] after swap. A pretrained-leaky
// model cites [1] again because the content feels "first-studyish" or
// because position bias dominates.
//
// Metric: for each prompt we compute the "citation follow rate" — the
// fraction of citation IDs in the swapped run that correspond to the
// SAME content the original run cited (just at the new ID). High follow
// rate = grounded. Low follow rate = position-driven or pretrained-
// leaky.
//
// Usage:
//   GROUNDING_ENFORCEMENT_ENABLED=true node scripts/eval/source-swap-canary.js --limit=15 --label=baseline

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
import { retrieveDatabaseEvidence } from "../../api/emersus/retrieveDatabaseEvidence.js";
import { dedupeEvidence, rankEvidence } from "../../api/emersus/rerank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "fixtures", "grounding-prompts.json");
const RESULTS_DIR = path.join(__dirname, "results");

const EMERSUS_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const VECTOR_LIMIT = 6;
const MATCH_THRESHOLD = 0.4;
const MATCH_COUNT = 10;
const MAX_OUTPUT_TOKENS = 700;

// Regex for citation marker extraction. Uses the strict Unicode PUA
// format emitted by the grounded prompt, plus the legacy [N] fallback.
const STRICT_MARKER_RE = /\u{E200}cite\u{E202}src(\d{1,2})\u{E201}/gu;
const LEGACY_MARKER_RE = /\[(\d{1,2})\]/g;

function parseArgs(argv) {
  const args = { limit: 15, outDir: RESULTS_DIR, label: null, shiftBy: 3 };
  for (const raw of argv) {
    const [key, ...valueParts] = raw.split("=");
    const value = valueParts.join("=");
    if (key === "--limit") args.limit = Number(value) || 15;
    else if (key === "--shift-by") args.shiftBy = Number(value) || 3;
    else if (key === "--out-dir") args.outDir = path.resolve(process.cwd(), value);
    else if (key === "--label") args.label = value;
  }
  return args;
}

function timestampForFile(date = new Date()) { return date.toISOString().replace(/[:.]/g, "-"); }

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

function makeEvidenceContext(items) {
  return {
    status: "completed",
    reason: null,
    available: items.length > 0,
    usable: items.length > 0,
    usePolicy: "retrieved_evidence_only",
    method: "vector",
    items,
    formatted: items.length ? formatEvidenceForModel(items) : "No database evidence retrieved.",
    error: null,
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

async function callEmersus({ question, evidence, index, run }) {
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
    metadata: { eval_name: "source_swap", eval_variant: run, prompt_index: String(index) },
  }));
  requestBody.max_output_tokens = MAX_OUTPUT_TOKENS;
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMERSUS_MODEL, input: requestBody.input, max_output_tokens: MAX_OUTPUT_TOKENS, metadata: requestBody.metadata }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return { text: extractOutputText(json), usage: json?.usage, response_id: json?.id };
}

function extractMarkerIds(text, sourceCount) {
  const out = new Set();
  const strict = new RegExp(STRICT_MARKER_RE.source, STRICT_MARKER_RE.flags);
  const legacy = new RegExp(LEGACY_MARKER_RE.source, LEGACY_MARKER_RE.flags);
  let m;
  while ((m = strict.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sourceCount) out.add(n);
  }
  while ((m = legacy.exec(text)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sourceCount) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function permute(arr, shiftBy) {
  const n = arr.length;
  if (n === 0) return [];
  const k = ((shiftBy % n) + n) % n;
  return arr.slice(k).concat(arr.slice(0, k));
}

function buildSwapMap(originalLen, shiftBy) {
  // After rotating evidence LEFT by shiftBy, content that WAS at ID i is now at ID ((i - shiftBy - 1 + n) % n) + 1.
  // Equivalently: the content now at ID j was ORIGINALLY at ID ((j - 1 + shiftBy) % n) + 1.
  const n = originalLen;
  const k = ((shiftBy % n) + n) % n;
  const newToOriginal = {};
  for (let j = 1; j <= n; j++) {
    const origIndex = ((j - 1 + k) % n) + 1;
    newToOriginal[j] = origIndex;
  }
  return { newToOriginal };
}

function buildSummary(results) {
  const n = results.length;
  const followRates = results.map((r) => r.follow_rate).filter((v) => typeof v === "number");
  const meanFollow = followRates.length ? Number((followRates.reduce((s, v) => s + v, 0) / followRates.length).toFixed(3)) : null;
  const withMarkers = results.filter((r) => r.original_cited_ids.length > 0 && r.swapped_cited_ids.length > 0).length;
  const zeroFollow = results.filter((r) => r.follow_rate === 0 && r.original_cited_ids.length > 0).length;
  return {
    total_prompts: n,
    prompts_with_markers_both_runs: withMarkers,
    mean_follow_rate: meanFollow,
    zero_follow_count: zeroFollow,
    interpretation: {
      follow_rate_explanation: "Fraction of swapped-run citation IDs that point to content originally cited (i.e., the model's citations moved WITH the content when sources were re-ordered). Higher = grounded. Near zero = position-driven.",
      gate: "mean_follow_rate should be >= 0.50 for grounded behavior.",
      pass: meanFollow !== null && meanFollow >= 0.5,
    },
  };
}

function buildMarkdown({ summary, results, generatedAt, label }) {
  const rows = results.map((r) => [
    r.index,
    r.question.replace(/\|/g, "\\|"),
    `[${r.original_cited_ids.join(",")}]`,
    `[${r.swapped_cited_ids.join(",")}]`,
    `[${r.swapped_ids_mapped_back.join(",")}]`,
    r.follow_rate ?? "—",
  ].join(" | ")).join("\n");

  const detail = results.map((r) => [
    `\n## ${r.index}. ${r.question}`,
    "",
    `**Original cited IDs:** \`[${r.original_cited_ids.join(",")}]\``,
    `**Swapped cited IDs:** \`[${r.swapped_cited_ids.join(",")}]\``,
    `**Swapped-IDs → original content IDs:** \`[${r.swapped_ids_mapped_back.join(",")}]\``,
    `**Follow rate:** ${r.follow_rate ?? "—"} (fraction of swapped citations that target content the original run also cited)`,
    "",
    "### Original answer",
    "",
    r.original_answer.slice(0, 900),
    "",
    "### Swapped-source answer",
    "",
    r.swapped_answer.slice(0, 900),
    "",
  ].join("\n")).join("\n");

  return [
    `# Source-Swap Canary`,
    `Generated: ${generatedAt}`,
    `Emersus model: \`${EMERSUS_MODEL}\``,
    label ? `Label: ${label}` : null,
    "",
    "## Summary",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "## Per-prompt",
    "",
    "index | question | orig_cited | swap_cited | swap→orig | follow_rate",
    "--- | --- | --- | --- | --- | ---",
    rows,
    "",
    detail,
  ].filter(Boolean).join("\n");
}

async function writeArtifacts({ outDir, runId, generatedAt, label, results, summary }) {
  await fs.mkdir(outDir, { recursive: true });
  const tag = label ? `${label}-` : "";
  const jsonPath = path.join(outDir, `source-swap-${tag}${runId}.json`);
  const mdPath = path.join(outDir, `source-swap-${tag}${runId}.md`);
  await fs.writeFile(jsonPath, JSON.stringify({ generated_at: generatedAt, summary, results }, null, 2), "utf8");
  await fs.writeFile(mdPath, buildMarkdown({ summary, results, generatedAt, label }), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const groundingEnforced = String(process.env.GROUNDING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
  if (!groundingEnforced) {
    console.warn("[swap] GROUNDING_ENFORCEMENT_ENABLED not set — Emersus arm will use the LEGACY prompt.");
  }
  const fixture = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const prompts = fixture.slice(0, args.limit);
  const generatedAt = new Date().toISOString();
  const runId = timestampForFile(new Date());
  const results = [];

  console.log(`[swap] prompts=${prompts.length} shift_by=${args.shiftBy}`);

  for (let i = 0; i < prompts.length; i++) {
    const index = i + 1;
    const { question } = prompts[i];
    console.log(`[swap] ${index}/${prompts.length}: ${question}`);

    let evidence = [];
    try {
      evidence = await retrieveEvidence(question);
    } catch (err) {
      console.warn(`  retrieval error: ${err.message}`);
      continue;
    }
    if (!evidence.length) {
      console.warn(`  skipping — no evidence`);
      continue;
    }

    // ── Run 1: original order ────────────────────────────────────────
    const origResult = await callEmersus({ question, evidence, index, run: "original" });
    const origCited = extractMarkerIds(origResult.text, evidence.length);

    // ── Run 2: swapped order (rotate left by shiftBy) ────────────────
    const swappedEvidence = permute(evidence, args.shiftBy);
    const { newToOriginal } = buildSwapMap(evidence.length, args.shiftBy);
    const swapResult = await callEmersus({ question, evidence: swappedEvidence, index, run: "swapped" });
    const swapCited = extractMarkerIds(swapResult.text, swappedEvidence.length);

    // ── Compute follow rate ──────────────────────────────────────────
    const swapCitedMappedToOriginalContentId = swapCited.map((j) => newToOriginal[j]);
    const origSet = new Set(origCited);
    const followHits = swapCitedMappedToOriginalContentId.filter((origId) => origSet.has(origId)).length;
    const followRate = swapCited.length > 0
      ? Number((followHits / swapCited.length).toFixed(3))
      : null;

    results.push({
      index,
      question,
      shift_by: args.shiftBy,
      original_cited_ids: origCited,
      swapped_cited_ids: swapCited,
      swapped_ids_mapped_back: swapCitedMappedToOriginalContentId,
      follow_rate: followRate,
      original_answer: origResult.text,
      swapped_answer: swapResult.text,
      evidence_titles: evidence.map((e) => e.title),
    });

    if (index % 5 === 0 || index === prompts.length) {
      const summary = buildSummary(results);
      await writeArtifacts({ outDir: args.outDir, runId, generatedAt, label: args.label, results, summary });
      console.log(`  snapshot ${index}/${prompts.length} mean_follow_rate=${summary.mean_follow_rate}`);
    }
  }

  const summary = buildSummary(results);
  const paths = await writeArtifacts({ outDir: args.outDir, runId, generatedAt, label: args.label, results, summary });
  console.log("\n[swap] complete");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[swap] json: ${paths.jsonPath}`);
  console.log(`[swap] md:   ${paths.mdPath}`);
}

main().catch((err) => { console.error("[swap] failed:", err); process.exit(1); });
