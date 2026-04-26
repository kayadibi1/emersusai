// scripts/grade-grounding-samples.js
//
// Grades ungraded rows in chat_grounding_samples using the same
// fidelity + paraphrase pipeline as scripts/eval/grounding-eval.js.
// Intended to run periodically (cron or manual). Idempotent: skips
// rows where graded_at IS NOT NULL.
//
// Usage:
//   node scripts/grade-grounding-samples.js --limit=50
//   node scripts/grade-grounding-samples.js --since=24h

import "dotenv/config";

import { supabaseAdmin } from "../api/lib/clients.js";
import { extractAtomicClaims, classifyClaimModes, EXTRACTION_PROMPT_VERSION, CLASSIFY_PROMPT_VERSION } from "../api/emersus/pipeline/claim-modes.js";

const JUDGE_MODEL = process.env.GROUNDING_JUDGE_MODEL || "gpt-5.4";
const EMBEDDING_MODEL = process.env.GROUNDING_EMBEDDING_MODEL || "text-embedding-3-small";
const PARAPHRASE_LOW_THRESHOLD = 0.35;

const STRICT_MARKER_RE = /\u{E200}cite\u{E202}src(\d{1,2})\u{E201}/gu;
const LEGACY_MARKER_RE = /\[(\d{1,2})\]/g;
const CLAIM_SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

const FIDELITY_SYSTEM_PROMPT = [
  "You are a precise fact-checker evaluating whether each cited claim in an answer is directly supported by the specific sources it cites.",
  "",
  "You receive a list of (claim, cited_sources) pairs. For EACH pair, evaluate: do the cited sources directly and specifically support this exact claim? A decorative citation — where the source is topically related but does not actually establish the claim — is NOT support.",
  "",
  "Verdicts per pair:",
  "  'supported'    = at least one cited source directly establishes the claim",
  "  'weak'         = the cited source(s) are related to the topic but don't specifically establish the claim",
  "  'decoy'        = the cited source(s) discuss something materially different; citation is decorative",
  "  'contradicted' = the cited source(s) actually contradict the claim",
  "",
  "Output JSON only: {\"per_claim\": [{\"claim_index\": N, \"verdict\": \"supported|weak|decoy|contradicted\", \"reasoning\": \"<1 short sentence>\"}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

function parseArgs(argv) {
  const args = { limit: 50, since: null };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "limit") args.limit = Number(v) || 50;
    else if (k === "since") args.since = v;
  }
  return args;
}

function sinceToIso(since) {
  if (!since) return null;
  const m = String(since).match(/^(\d+)([hd])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const ms = m[2] === "h" ? n * 3600_000 : n * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function extractCitedClaims(answer, sourceCount) {
  const sentences = String(answer || "")
    .replace(/\s+/g, " ")
    .split(CLAIM_SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const claims = [];
  sentences.forEach((sentence, idx) => {
    const ids = new Set();
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
      claims.push({ claim_index: idx, sentence, cited_source_ids: Array.from(ids).sort((a, b) => a - b) });
    }
  });
  return claims;
}

function formatSourcesForGrader(sources) {
  return sources.map((it, i) => {
    const header = [it.publication_year, it.publication_type, it.journal, it.title].filter(Boolean).join(" · ");
    return `[${i + 1}] ${header}\n    ${it.excerpt || "(no excerpt)"}`;
  }).join("\n\n");
}

async function callResponses({ model, input, maxOutputTokens }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input, max_output_tokens: maxOutputTokens }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return json?.output_text || (json?.output || []).flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text)).join("\n");
}

async function embedTexts(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`embeddings failed: ${JSON.stringify(json)}`);
  return json.data.map((d) => d.embedding);
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function gradeFidelity({ question, answer, sources }) {
  const cited = extractCitedClaims(answer, sources.length);
  if (!cited.length) return { per_claim: [], summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: 0 } };

  const pairsBlock = cited.map((c, i) => `[pair ${i}] claim: "${c.sentence}"\n    cited sources: ${c.cited_source_ids.map((n) => `src${n}`).join(", ")}`).join("\n\n");
  const userPrompt = `QUESTION:\n${question}\n\nRETRIEVED PASSAGES:\n${formatSourcesForGrader(sources)}\n\nCITED-CLAIM PAIRS TO GRADE:\n${pairsBlock}`;

  let raw;
  try {
    raw = await callResponses({
      model: JUDGE_MODEL,
      input: [{ role: "system", content: FIDELITY_SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      maxOutputTokens: 1200,
    });
  } catch (err) {
    return { per_claim: cited.map((c, i) => ({ claim_index: i, verdict: "unknown", reasoning: `error: ${err.message}` })), summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: cited.length }, error: err.message };
  }
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch (err) {
    return { per_claim: [], summary: { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: cited.length }, error: `parse: ${err.message}` };
  }
  const perClaim = (Array.isArray(parsed.per_claim) ? parsed.per_claim : []).map((row) => ({
    claim_index: Number(row.claim_index),
    sentence: cited[row.claim_index]?.sentence || null,
    cited_source_ids: cited[row.claim_index]?.cited_source_ids || [],
    verdict: String(row.verdict || "unknown"),
    reasoning: String(row.reasoning || ""),
  }));
  const summary = { supported: 0, weak: 0, decoy: 0, contradicted: 0, total: perClaim.length };
  for (const row of perClaim) { if (row.verdict in summary) summary[row.verdict] += 1; }
  return { per_claim: perClaim, summary };
}

async function gradeParaphrase({ answer, sources }) {
  const cited = extractCitedClaims(answer, sources.length);
  if (!cited.length) return { per_claim: [], summary: { mean_sim: null, low_sim_count: 0, total: 0 } };

  const sourceTexts = sources.map((it) => [it.title, it.excerpt].filter(Boolean).join(" ").slice(0, 2000));
  const claimTexts = cited.map((c) => c.sentence);
  let claimE, sourceE;
  try {
    [claimE, sourceE] = await Promise.all([embedTexts(claimTexts), embedTexts(sourceTexts)]);
  } catch (err) {
    return { per_claim: [], summary: { mean_sim: null, low_sim_count: 0, total: 0 }, error: err.message };
  }
  const perClaim = cited.map((c, i) => {
    const sims = c.cited_source_ids.map((n) => ({ source_id: n, similarity: Number(cosineSim(claimE[i], sourceE[n - 1]).toFixed(3)) }));
    const best = sims.reduce((b, s) => (s.similarity > b ? s.similarity : b), 0);
    return { claim_index: c.claim_index, sentence: c.sentence, cited_source_ids: c.cited_source_ids, per_source_similarity: sims, best_similarity: Number(best.toFixed(3)), below_threshold: best < PARAPHRASE_LOW_THRESHOLD };
  });
  const totals = perClaim.length;
  const meanSim = totals ? Number((perClaim.reduce((s, r) => s + r.best_similarity, 0) / totals).toFixed(3)) : null;
  const low = perClaim.filter((r) => r.below_threshold).length;
  return { per_claim: perClaim, summary: { mean_sim: meanSim, low_sim_count: low, total: totals, threshold: PARAPHRASE_LOW_THRESHOLD } };
}

async function main() {
  if (!supabaseAdmin) { console.error("missing supabaseAdmin client"); process.exit(1); }
  const args = parseArgs(process.argv.slice(2));
  const sinceIso = sinceToIso(args.since);
  console.log(`[grade] judge=${JUDGE_MODEL} embed=${EMBEDDING_MODEL} limit=${args.limit} since=${sinceIso || "—"}`);

  let query = supabaseAdmin.from("chat_grounding_samples").select("id, question, sources_json, answer").is("graded_at", null).order("created_at", { ascending: true }).limit(args.limit);
  if (sinceIso) query = query.gte("created_at", sinceIso);
  const { data: rows, error } = await query;
  if (error) { console.error("query error:", error.message); process.exit(1); }
  if (!rows?.length) { console.log("[grade] no ungraded rows."); return; }

  console.log(`[grade] grading ${rows.length} rows...`);
  for (const row of rows) {
    const sources = Array.isArray(row.sources_json) ? row.sources_json : [];
    const [fidelity, paraphrase] = await Promise.all([
      gradeFidelity({ question: row.question, answer: row.answer, sources }),
      gradeParaphrase({ answer: row.answer, sources }),
    ]);
    const grader_result = { fidelity, paraphrase, graded_by: { judge_model: JUDGE_MODEL, embedding_model: EMBEDDING_MODEL }, graded_at: new Date().toISOString() };
    const { error: updateErr } = await supabaseAdmin.from("chat_grounding_samples").update({ graded_at: new Date().toISOString(), grader_result }).eq("id", row.id);
    if (updateErr) console.error(`row ${row.id} update failed:`, updateErr.message);

    // Per-claim mode classification → chat_claim_modes
    let claimModeRows = [];
    let modeCountSummary = "skipped (no sources)";
    try {
      if (sources.length > 0) {
        const extracted = await extractAtomicClaims(row.answer);
        if (extracted.error) {
          claimModeRows = [{
            sample_id: row.id,
            claim_text: "(extraction failed)",
            cited_source_ids: [],
            source_scores_json: [],
            mode: null,
            qualifier_diff_json: null,
            alternate_supporting_sources: null,
            judge_model: JUDGE_MODEL,
            judge_prompt_version: `${EXTRACTION_PROMPT_VERSION},${CLASSIFY_PROMPT_VERSION}`,
            grading_status: extracted.error,
          }];
          modeCountSummary = `extract_error=${extracted.error}`;
        } else {
          const classified = await classifyClaimModes(extracted.claims, sources);
          claimModeRows = classified.map((cm) => ({
            sample_id: row.id,
            claim_text: cm.claim_text,
            cited_source_ids: cm.cited_source_ids,
            source_scores_json: cm.source_scores,
            mode: cm.mode,
            qualifier_diff_json: cm.qualifier_diff,
            alternate_supporting_sources: cm.alternate_supporting_sources,
            judge_model: JUDGE_MODEL,
            judge_prompt_version: `${EXTRACTION_PROMPT_VERSION},${CLASSIFY_PROMPT_VERSION}`,
            grading_status: cm.grading_status,
          }));
          const counts = {};
          for (const cm of classified) counts[cm.mode || cm.grading_status] = (counts[cm.mode || cm.grading_status] || 0) + 1;
          modeCountSummary = JSON.stringify(counts);
        }

        if (claimModeRows.length) {
          const { error: insertErr } = await supabaseAdmin.from("chat_claim_modes").insert(claimModeRows);
          if (insertErr && !String(insertErr.message || "").includes("duplicate key")) {
            console.warn(`  row ${row.id}: chat_claim_modes insert error: ${insertErr.message}`);
          }
        }
      }
    } catch (err) {
      console.warn(`  row ${row.id}: claim-modes pipeline error: ${err.message}`);
    }

    console.log(`  row ${row.id}: fidelity=${JSON.stringify(fidelity.summary)} paraphrase.mean=${paraphrase.summary.mean_sim} modes=${modeCountSummary}`);
  }
  console.log("[grade] complete.");
}

main().catch((err) => { console.error("[grade] failed:", err); process.exit(1); });
