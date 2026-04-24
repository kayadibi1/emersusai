// api/emersus/pipeline/hyde.js
//
// HyDE (Hypothetical Document Embeddings) query-expansion for the chat
// retrieval path. Generates a short hypothetical biomedical answer to the
// user's question, which gets embedded alongside the original question;
// both candidate pools are RRF-fused downstream in retrieveDatabaseEvidence.
//
// Rationale: the query embedding is short and lives in a vector
// neighborhood of broadly-phrased chunks. The hypothetical passage
// naturally contains specific substrate/drug/mechanism terminology that
// lands closer to the target chunks in vector space — bridging the
// vocabulary gap between lay questions and technical papers.
//
// Measured impact (matrix 2026-04-24, 200 scope-filtered fixtures):
//   * baseline dense:        recall@10 30.0%, recall@100 36.0%
//   * HyDE + dense (RRF):    recall@10 35.5%, recall@100 50.0%
//   * +5.5pp recall@10, +14pp recall@100, +$0.0004/query, +2.2s latency
//   * Strongest gains on easy/skeptical tiers; modest on hard (vocab gap
//     still needs hybrid lexical + index-time fixes for full rescue).
//
// Feature flag: CHAT_HYDE_ENABLED=true. Default off. Callers in
// retrieveDatabaseEvidence gracefully fall back to single-query retrieval
// on any HyDE failure (LLM error, empty output, degenerate passage).
//
// Cost at 100K queries/month: one gpt-4.1-mini call @ ~300 tok in + ~120
// tok out = ~$40/month.

import { openai } from "../../lib/clients.js";

const MODEL = "gpt-4.1-mini";
const TEMPERATURE = 0.2;
const MAX_TOKENS_OUT = 240;
const MIN_PASSAGE_CHARS = 40;
const MAX_PASSAGE_CHARS = 2000;

const HYDE_SYSTEM = `You are writing a hypothetical scientific answer that would appear in a biomedical / exercise-science literature review.

Given a user question, write a 60-120 word passage that reads like a sentence from a systematic review paragraph. Use specific substrate/drug names, mechanism terms, quantitative dosages, and population descriptors. Do NOT hedge. Do NOT answer the user — write as if citing existing research that grounds the answer.

Good example for "sugar and athletic performance":
"Carbohydrate ingestion during endurance exercise lasting longer than 60 minutes improves performance by approximately 2-3% via maintained blood glucose and increased exogenous carbohydrate oxidation. Multiple transportable carbohydrate formulations (e.g., glucose-fructose at a 2:1 ratio) raise oxidation rates to ~1.5 g/min versus ~1.0 g/min for glucose alone. Short-duration high-intensity efforts (<45 minutes) show ergogenic effects from carbohydrate mouth rinsing alone, attributed to central oral carbohydrate receptor activation rather than substrate provision."

Return only the passage. No JSON, no prefix, no markdown.`;

export async function generateHydePassage(question) {
  if (!openai) return null;
  const input = String(question || "").trim();
  if (input.length < 4 || input.length > 2000) return null;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS_OUT,
      messages: [
        { role: "system", content: HYDE_SYSTEM },
        { role: "user", content: input },
      ],
    });
    const passage = String(response.choices[0]?.message?.content || "").trim();
    if (passage.length < MIN_PASSAGE_CHARS || passage.length > MAX_PASSAGE_CHARS) {
      return null;
    }
    return passage;
  } catch (err) {
    console.warn(`HyDE generation failed: ${err.message}`);
    return null;
  }
}
