// scripts/eval/calibration/build-synthetic-mode3.js
//
// Generates 10 synthetic mode_3 candidates via retrieval-mismatch.
// For each (target, mismatch) pair, retrieves evidence using the MISMATCH
// query and generates an answer to the TARGET question with the misaligned
// retrieval set. The result should be mode_3 (model fabricates with citation
// to satisfy the grounding contract), but human verification is required.
//
// Usage:
//   node --env-file=.env scripts/eval/calibration/build-synthetic-mode3.js

import "dotenv/config";
import fs from "node:fs";

import { buildMessages } from "../../../api/emersus/pipeline/prompt.js";
import { buildRequestBody } from "../../../api/emersus/pipeline/synthesize.js";
import { formatEvidenceForModel, normalizeVectorEvidenceRow } from "../../../api/emersus/pipeline/retrieve.js";
import { retrieveDatabaseEvidence } from "../../../api/emersus/retrieveDatabaseEvidence.js";
import { dedupeEvidence, rankEvidence } from "../../../api/emersus/rerank.js";

const EMERSUS_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const OUT_PATH = "scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json";
const VECTOR_LIMIT = 6;
const MATCH_THRESHOLD = 0.4;
const MATCH_COUNT = 10;
const MAX_OUTPUT_TOKENS = 700;

const PAIRS = [
  { target: "What's the recommended creatine loading protocol?", mismatch: "stretching routines for hamstring flexibility" },
  { target: "What dose of beta-alanine is effective for sprint performance?", mismatch: "yoga breathing techniques" },
  { target: "Does caffeine improve maximal strength?", mismatch: "vitamin D and bone density in elderly women" },
  { target: "What's the optimal protein intake per kg for hypertrophy?", mismatch: "marathon pacing strategies" },
  { target: "How long does it take to see strength gains from creatine?", mismatch: "swimming stroke technique" },
  { target: "Does fasted cardio burn more fat?", mismatch: "shoulder mobility for overhead athletes" },
  { target: "What's the minimum effective dose of caffeine for endurance?", mismatch: "core stability exercises for back pain" },
  { target: "Does rest-pause training improve hypertrophy vs traditional sets?", mismatch: "ankle dorsiflexion screening" },
  { target: "How does HMB compare to leucine for muscle protein synthesis?", mismatch: "tennis elbow rehabilitation" },
  { target: "What's the effect of sleep deprivation on testosterone?", mismatch: "elliptical machine biomechanics" },
];

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

async function callOpenAI(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return extractOutputText(json);
}

async function main() {
  const candidates = [];
  for (let i = 0; i < PAIRS.length; i += 1) {
    const { target, mismatch } = PAIRS[i];
    process.stdout.write(`[${i + 1}/${PAIRS.length}] target="${target.slice(0, 50)}" mismatch="${mismatch.slice(0, 30)}" ... `);
    try {
      const rawRows = await retrieveDatabaseEvidence({
        prompt: mismatch,
        matchThreshold: MATCH_THRESHOLD,
        matchCount: MATCH_COUNT,
        includePreprints: true,
      });
      const ranked = rankEvidence(dedupeEvidence(rawRows.map(normalizeVectorEvidenceRow))).slice(0, VECTOR_LIMIT);
      if (!ranked.length) { console.log("no retrieval — skipping"); continue; }

      const evidenceContext = {
        available: true,
        usable: true,
        usePolicy: "retrieved_evidence_only",
        method: "vector",
        items: ranked,
        formatted: formatEvidenceForModel(ranked),
        error: null,
      };
      const messages = buildMessages({
        question: target,
        threadState: {},
        recentMessages: [],
        evidence: evidenceContext,
        workoutPlan: null,
        crossThreadMemory: null,
      });
      const requestBody = buildRequestBody({
        model: EMERSUS_MODEL,
        messages,
        kind: "synthesis",
      });
      // Strip prod-only fields and disable streaming so we can read output_text directly
      requestBody.stream = false;
      requestBody.max_output_tokens = MAX_OUTPUT_TOKENS;
      delete requestBody.prompt_cache_key;
      delete requestBody.prompt_cache_retention;
      delete requestBody.store;
      delete requestBody.metadata;

      const answer = await callOpenAI(requestBody);

      candidates.push({
        target_question: target,
        mismatch_query: mismatch,
        retrieved_sources: ranked,
        answer,
        manually_verified_mode_3: null,
      });
      console.log("ok (" + answer.length + " chars)");
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  fs.mkdirSync("scripts/eval/fixtures", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), model: EMERSUS_MODEL, candidates }, null, 2));
  console.log(`\n[synthetic-mode3] wrote ${OUT_PATH} (${candidates.length} candidates)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
