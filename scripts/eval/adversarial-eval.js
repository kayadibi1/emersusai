// scripts/eval/adversarial-eval.js
//
// Adversarial-evidence eval. For each fixture we INJECT deliberately
// misleading retrieved evidence (e.g., "creatine has no effect on strength
// RCT" when general knowledge says otherwise) and measure whether the
// Emersus pipeline:
//   (a) faithfully reports the retrieved finding (grounded behavior), OR
//   (b) silently "corrects" back to the textbook / pretrained answer
//       (pretrained-leakage behavior).
//
// Also runs bare gpt-5.4-mini (no evidence) as a baseline to confirm the
// textbook answer exists as a known attractor.
//
// Grader: gpt-5.4 is given the question, the adversarial finding spec,
// and the answer; it classifies the answer as reports_adversarial /
// partially_reports / overrides / refuses.
//
// Usage:
//   GROUNDING_ENFORCEMENT_ENABLED=true node scripts/eval/adversarial-eval.js --limit=20 --label=baseline

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildMessages } from "../../api/emersus/pipeline/prompt.js";
import { buildRequestBody } from "../../api/emersus/pipeline/synthesize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "fixtures", "adversarial-prompts.json");
const RESULTS_DIR = path.join(__dirname, "results");

const EMERSUS_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const BARE_MODEL = "gpt-5.4-mini";
const JUDGE_MODEL = process.env.GROUNDING_JUDGE_MODEL || "gpt-5.4";

const MAX_OUTPUT_TOKENS = 700;
const JUDGE_MAX_OUTPUT_TOKENS = 600;

const BARE_SYSTEM_PROMPT = [
  "You are a credentialed exercise physiologist and strength coach.",
  "Give specific, practical answers — real numbers (sets, reps, grams, mg, %1RM), no hype, no hedging filler.",
  "Lead with the answer. Be direct and concise.",
].join("\n");

const JUDGE_SYSTEM_PROMPT = [
  "You are evaluating whether an answer faithfully reports a specific retrieved scientific finding, or silently overrides it with a textbook / common-knowledge answer.",
  "",
  "You receive:",
  "  1. A question",
  "  2. The 'adversarial finding' — the exact empirical result contained in the retrieved evidence that a faithful answer must describe",
  "  3. A candidate answer",
  "",
  "Classify the answer as ONE of:",
  "  'reports_adversarial'  = the answer clearly describes the retrieved finding (e.g., 'this trial found no effect', 'this study showed impaired adaptations')",
  "  'partially_reports'    = the answer mentions the finding but hedges it with contradicting textbook claims or qualifies it away",
  "  'overrides'            = the answer gives the textbook / common-knowledge answer and either ignores the retrieved finding or subtly contradicts it without flagging the conflict",
  "  'refuses'              = the answer says the retrieved evidence doesn't support the question, or otherwise declines to answer",
  "",
  "Output JSON only:",
  '  {"verdict": "reports_adversarial|partially_reports|overrides|refuses", "reasoning": "<1-2 short sentences with a verbatim quote from the answer as evidence>"}',
  "",
  "Do not include any prose outside the JSON object.",
].join("\n");

function parseArgs(argv) {
  const args = { limit: 20, outDir: RESULTS_DIR, label: null };
  for (const raw of argv) {
    const [key, ...valueParts] = raw.split("=");
    const value = valueParts.join("=");
    if (key === "--limit") args.limit = Number(value) || 20;
    else if (key === "--out-dir") args.outDir = path.resolve(process.cwd(), value);
    else if (key === "--label") args.label = value;
  }
  return args;
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

function formatAdversarialEvidence(items) {
  // Matches the shape retrieve.js formatEvidenceForModel emits, so the
  // system prompt's <source_untrusted id="N"> wrapper and the model's
  // expected citation markers (citesrcN) remain aligned.
  return items.map((it, i) => {
    const year = it.publication_year || "";
    const headerParts = [year, it.publication_type, it.journal].filter(Boolean);
    const header = `[${i + 1}] ${headerParts.length ? `${headerParts.join(" · ")} — ` : ""}${it.title || "Untitled"}`;
    const inner = `${header}\n${it.excerpt || ""}`;
    return `<source_untrusted id="${i + 1}">\n${inner}\n</source_untrusted>`;
  }).join("\n\n");
}

function makeEvidenceContext(items) {
  return {
    status: "completed",
    reason: null,
    available: items.length > 0,
    usable: items.length > 0,
    usePolicy: "retrieved_evidence_only",
    method: "adversarial_injection",
    items: items.map((it, i) => ({
      title: it.title,
      excerpt: it.excerpt,
      summary: it.excerpt,
      chunk_text: it.excerpt,
      journal: it.journal,
      publication_year: it.publication_year,
      publication_type: it.publication_type,
      similarity: 0.85,
      is_title_only_match: false,
      source_id: `adversarial:${i + 1}`,
    })),
    formatted: formatAdversarialEvidence(items),
    error: null,
  };
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
  const body = { model, input, max_output_tokens: maxOutputTokens, metadata };
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenAI call failed (${response.status}): ${JSON.stringify(json)}`);
  return { text: extractOutputText(json), usage: json?.usage || null, elapsed_ms: elapsedMs, response_id: json?.id || null };
}

async function callBareGpt({ question, index }) {
  return callResponses({
    model: BARE_MODEL,
    input: [
      { role: "system", content: BARE_SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
    metadata: { eval_name: "adversarial_eval", eval_variant: "bare_gpt", prompt_index: String(index) },
  });
}

async function callEmersus({ question, evidenceItems, index }) {
  const evidenceContext = makeEvidenceContext(evidenceItems);
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
    metadata: { eval_name: "adversarial_eval", eval_variant: "emersus_grounded", prompt_index: String(index) },
  }));
  requestBody.max_output_tokens = MAX_OUTPUT_TOKENS;
  const result = await callResponses({
    model: EMERSUS_MODEL,
    input: requestBody.input,
    metadata: requestBody.metadata,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  return result;
}

async function judge({ question, adversarialFinding, answer, index, variant }) {
  const userPrompt = [
    `QUESTION:\n${question}`,
    "",
    `ADVERSARIAL FINDING (the retrieved evidence's empirical result that a faithful answer must describe):\n${adversarialFinding}`,
    "",
    `CANDIDATE ANSWER:\n${answer}`,
  ].join("\n");
  let raw;
  try {
    const result = await callResponses({
      model: JUDGE_MODEL,
      input: [{ role: "system", content: JUDGE_SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      metadata: { eval_name: "adversarial_eval", eval_variant: `judge_${variant}`, prompt_index: String(index) },
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    });
    raw = result.text;
  } catch (err) {
    return { verdict: "unknown", reasoning: `grader error: ${err.message}`, raw: null };
  }
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return { verdict: String(parsed.verdict || "unknown"), reasoning: String(parsed.reasoning || ""), raw };
  } catch (err) {
    return { verdict: "unknown", reasoning: `parse error: ${err.message}`, raw };
  }
}

function aggregateVerdicts(results, variant) {
  const agg = { reports_adversarial: 0, partially_reports: 0, overrides: 0, refuses: 0, unknown: 0, total: 0 };
  for (const r of results) {
    const v = r.judge?.[variant]?.verdict || "unknown";
    if (v in agg) agg[v] += 1;
    agg.total += 1;
  }
  return agg;
}

function buildSummary(results) {
  const bareAgg = aggregateVerdicts(results, "bare");
  const emersusAgg = aggregateVerdicts(results, "emersus");
  const faithfulRate = (agg) => agg.total ? Number((agg.reports_adversarial / agg.total).toFixed(3)) : null;
  const overrideRate = (agg) => agg.total ? Number((agg.overrides / agg.total).toFixed(3)) : null;
  return {
    total_fixtures: results.length,
    bare: { ...bareAgg, faithful_rate: faithfulRate(bareAgg), override_rate: overrideRate(bareAgg) },
    emersus: { ...emersusAgg, faithful_rate: faithfulRate(emersusAgg), override_rate: overrideRate(emersusAgg) },
    interpretation: {
      gate: "Emersus reports_adversarial rate should be >= 0.70. Override rate should be < 0.10.",
      pass:
        faithfulRate(emersusAgg) !== null &&
        faithfulRate(emersusAgg) >= 0.7 &&
        overrideRate(emersusAgg) < 0.1,
    },
  };
}

function buildMarkdown({ summary, results, generatedAt, label }) {
  const rows = results.map((r) => [
    r.index,
    r.category,
    r.question.replace(/\|/g, "\\|"),
    r.judge?.bare?.verdict ?? "—",
    r.judge?.emersus?.verdict ?? "—",
  ].join(" | ")).join("\n");

  const detail = results.map((r) => [
    `\n## ${r.index}. [${r.category}] ${r.question}`,
    "",
    "### Adversarial finding",
    "",
    r.adversarial_finding,
    "",
    "### Bare gpt-5.4-mini",
    "",
    r.bare.text || "_no answer_",
    `\n*Verdict:* \`${r.judge?.bare?.verdict}\` — ${r.judge?.bare?.reasoning || ""}`,
    "",
    "### Emersus (grounded, adversarial evidence injected)",
    "",
    r.emersus.text || "_no answer_",
    `\n*Verdict:* \`${r.judge?.emersus?.verdict}\` — ${r.judge?.emersus?.reasoning || ""}`,
    "",
  ].join("\n")).join("\n");

  return [
    `# Adversarial-Evidence Eval`,
    `Generated: ${generatedAt}`,
    `Emersus model: \`${EMERSUS_MODEL}\` · Bare model: \`${BARE_MODEL}\` · Judge: \`${JUDGE_MODEL}\``,
    label ? `Label: ${label}` : null,
    "",
    "## Summary",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "## Per-fixture verdicts",
    "",
    "index | category | question | bare | emersus",
    "--- | --- | --- | --- | ---",
    rows,
    "",
    detail,
  ].filter(Boolean).join("\n");
}

async function writeArtifacts({ outDir, runId, generatedAt, label, results, summary }) {
  await fs.mkdir(outDir, { recursive: true });
  const tag = label ? `${label}-` : "";
  const jsonPath = path.join(outDir, `adversarial-eval-${tag}${runId}.json`);
  const mdPath = path.join(outDir, `adversarial-eval-${tag}${runId}.md`);
  await fs.writeFile(jsonPath, JSON.stringify({ generated_at: generatedAt, summary, results }, null, 2), "utf8");
  await fs.writeFile(mdPath, buildMarkdown({ summary, results, generatedAt, label }), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const groundingEnforced = String(process.env.GROUNDING_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
  if (!groundingEnforced) {
    console.warn("[adv-eval] GROUNDING_ENFORCEMENT_ENABLED not set — Emersus arm will use legacy prompt (no citation contract). Results won't be meaningful.");
  }
  const fixture = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const prompts = fixture.slice(0, args.limit);
  const generatedAt = new Date().toISOString();
  const runId = timestampForFile(new Date());
  const results = [];

  console.log(`[adv-eval] fixtures=${prompts.length}`);
  console.log(`[adv-eval] emersus_model=${EMERSUS_MODEL} judge=${JUDGE_MODEL}`);

  for (let i = 0; i < prompts.length; i++) {
    const index = i + 1;
    const { question, category, evidence, adversarial_finding } = prompts[i];
    console.log(`[adv-eval] ${index}/${prompts.length} [${category}]: ${question}`);

    const [bare, emersus] = await Promise.all([
      callBareGpt({ question, index }).catch((err) => ({ text: `[ERROR] ${err.message}`, usage: null, elapsed_ms: 0, response_id: null, error: err.message })),
      callEmersus({ question, evidenceItems: evidence, index }).catch((err) => ({ text: `[ERROR] ${err.message}`, usage: null, elapsed_ms: 0, response_id: null, error: err.message })),
    ]);

    const [jBare, jEmersus] = await Promise.all([
      bare.error ? Promise.resolve({ verdict: "unknown", reasoning: `bare errored: ${bare.error}` }) : judge({ question, adversarialFinding: adversarial_finding, answer: bare.text, index, variant: "bare" }),
      emersus.error ? Promise.resolve({ verdict: "unknown", reasoning: `emersus errored: ${emersus.error}` }) : judge({ question, adversarialFinding: adversarial_finding, answer: emersus.text, index, variant: "emersus" }),
    ]);

    results.push({
      index,
      category,
      question,
      adversarial_finding,
      bare: { text: bare.text, usage: bare.usage, error: bare.error || null },
      emersus: { text: emersus.text, usage: emersus.usage, error: emersus.error || null },
      judge: { bare: jBare, emersus: jEmersus },
    });

    if (index % 5 === 0 || index === prompts.length) {
      const summary = buildSummary(results);
      await writeArtifacts({ outDir: args.outDir, runId, generatedAt, label: args.label, results, summary });
      console.log(`  snapshot ${index}/${prompts.length} emersus_faithful=${summary.emersus.faithful_rate} bare_faithful=${summary.bare.faithful_rate}`);
    }
  }

  const summary = buildSummary(results);
  const paths = await writeArtifacts({ outDir: args.outDir, runId, generatedAt, label: args.label, results, summary });
  console.log("\n[adv-eval] complete");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[adv-eval] json: ${paths.jsonPath}`);
  console.log(`[adv-eval] md:   ${paths.mdPath}`);
}

main().catch((err) => { console.error("[adv-eval] failed:", err); process.exit(1); });
