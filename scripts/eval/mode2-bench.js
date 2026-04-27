// scripts/eval/mode2-bench.js
//
// Bench harness for the Mode-2 Qualifier-Preservation Verifier.
// Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md §4.8
//
// Three phases:
//   gen      — run prod chat workflow against fixtures, capture
//              {question, sources, original_prose} per chat
//   mqpv     — read captured chats, run MQPV pipeline, write per-chat
//              telemetry to chat_grounding_samples with synthetic=true
//   ablation — re-run mqpv with --skipQualifier=X or --skipRewrite2

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { generateRecommendationJSON } from "../../api/emersus/workflow.js";
import { runMode2Pipeline } from "../../api/emersus/pipeline/mode2-pipeline.js";
import { supabaseAdmin } from "../../api/lib/clients.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");
const FIXTURES_DEFAULT = "scripts/eval/fixtures/retrieval-v2.json";

function parseArgs(argv) {
  const args = {
    mode: "all",
    samples: 200,
    fixtures: FIXTURES_DEFAULT,
    concurrency: 4,
    sourceFile: null,
    runId: null,
    skipQualifier: null,
    skipRewrite2: false,
  };
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  if (args.samples) args.samples = Number(args.samples);
  if (args.concurrency) args.concurrency = Number(args.concurrency);
  if (args.skipRewrite2 === "true" || args.skipRewrite2 === true) args.skipRewrite2 = true;
  else args.skipRewrite2 = false;
  return args;
}

async function loadFixtures(filePath, n) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const all = Array.isArray(raw) ? raw : raw.fixtures || [];
  return all.slice(0, n);
}

// ─── Phase: sample generation ────────────────────────────────────────────────

async function generatePhase({ samples, fixtures, concurrency, runId }) {
  const fixturesArr = await loadFixtures(fixtures, samples);
  console.log(`[mode2-bench/gen] loaded ${fixturesArr.length} fixtures`);
  const out = [];
  const startedAt = Date.now();
  let cursor = 0, inFlight = 0, done = 0;

  await new Promise((resolve) => {
    function pump() {
      if (cursor >= fixturesArr.length && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < fixturesArr.length) {
        const fixture = fixturesArr[cursor++];
        inFlight += 1;
        runOneChat(fixture)
          .then((rec) => out.push(rec))
          .catch((err) => {
            console.warn(`[gen] fixture failed: ${err.message}`);
            out.push({ question: fixture.question, error: err.message });
          })
          .finally(() => {
            inFlight -= 1;
            done += 1;
            if (done % 25 === 0 || done === fixturesArr.length) {
              console.log(`[mode2-bench/gen] ${done}/${fixturesArr.length} (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`);
            }
            pump();
          });
      }
    }
    pump();
  });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const sourcePath = path.join(RESULTS_DIR, `mode2-bench-source-${runId}.json`);
  await fs.writeFile(sourcePath, JSON.stringify({
    run_id: runId,
    generated_at: new Date().toISOString(),
    n_chats: out.length,
    samples: out,
  }, null, 2));
  console.log(`[mode2-bench/gen] wrote ${sourcePath}`);
  return sourcePath;
}

async function runOneChat(fixture) {
  const question = fixture.question || fixture.prompt;
  if (!question) throw new Error("fixture missing question");
  const t = Date.now();
  // Note: MQPV must be DISABLED during gen so we capture the original prose,
  // not the rewritten prose. The mqpv phase re-runs MQPV on captured chats.
  const wasEnabled = process.env.MODE2_VERIFIER_ENABLED;
  process.env.MODE2_VERIFIER_ENABLED = "false";
  try {
    const result = await generateRecommendationJSON({
      question,
      threadId: `mode2-bench-${Math.random().toString(36).slice(2, 10)}`,
    });
    return {
      fixture_id: fixture.id || fixture.metadata?.target_pmid || null,
      question,
      original_prose: result.answer_text || result.summary || "",
      sources: (result.sources || []).map((s) => ({
        index: s.index,
        pmid: s.pmid,
        doi: s.doi,
        title: s.title,
        excerpt: s.excerpt,
        publication_year: s.year || s.publication_year,
        publication_type: s.publication_type,
        journal: s.journal,
      })),
      grounding: result.grounding || null,
      latency_ms: Date.now() - t,
    };
  } finally {
    if (wasEnabled !== undefined) process.env.MODE2_VERIFIER_ENABLED = wasEnabled;
    else delete process.env.MODE2_VERIFIER_ENABLED;
  }
}

// ─── Phase: MQPV processing ──────────────────────────────────────────────────

async function mqpvPhase({ sourceFile, runId, concurrency, skipQualifier, skipRewrite2 }) {
  const sourceData = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const samples = sourceData.samples || [];
  console.log(`[mode2-bench/mqpv] processing ${samples.length} captured chats`);

  // Apply ablation flags to env for this run
  if (skipQualifier) process.env.MODE2_DISABLED_QUALIFIERS = skipQualifier;
  if (skipRewrite2) process.env.MODE2_REWRITE_2_ENABLED = "false";

  const startedAt = Date.now();
  let processed = 0;
  for (const sample of samples) {
    if (sample.error || !sample.original_prose) {
      processed += 1;
      continue;
    }
    try {
      // Build a synthetic ctx for the orchestrator
      const ctx = {
        prose: sample.original_prose,
        evidence: {
          items: (sample.sources || []).map((s, i) => ({
            ...s,
            source_id: i + 1,
            id: i + 1,
          })),
        },
      };
      const mqpv = await runMode2Pipeline(ctx);
      const t = mqpv.telemetry;

      // Write to chat_grounding_samples with synthetic=true
      await supabaseAdmin.from("chat_grounding_samples").insert({
        user_id: null,
        thread_id: `mode2-bench-${runId}`,
        message_id: null,
        question: String(sample.question || "").slice(0, 4000),
        sources_json: sample.sources || [],
        answer: String(mqpv.rewritten_prose || sample.original_prose).slice(0, 16000),
        grounding_json: sample.grounding || null,
        model: "bench-synthetic",
        synthetic: true,
        mode2_enabled: true,
        mode2_rewrites_attempted: t.rewrites_attempted,
        mode2_initial_failures: t.initial_failures,
        mode2_after_r1_failures: t.after_r1_failures,
        mode2_final_failures: t.final_failures,
        mode2_extraction_cost_usd: t.extraction_cost_usd,
        mode2_validation_cost_usd: t.validation_cost_usd,
        mode2_rewrite_cost_usd: t.rewrite_cost_usd,
        mode2_extraction_latency_ms: t.extraction_latency_ms,
        mode2_validation_latency_ms: t.validation_latency_ms,
        mode2_rewrite_latency_ms: t.rewrite_latency_ms,
        mode2_total_latency_ms: t.total_latency_ms,
        mode2_qualifiers_dropped_breakdown: t.qualifiers_dropped_breakdown || null,
        mode2_pre_prose:
          mqpv.rewritten_prose && sample.original_prose !== mqpv.rewritten_prose
            ? String(sample.original_prose).slice(0, 16000)
            : null,
        mode2_post_prose: String(mqpv.rewritten_prose || sample.original_prose).slice(0, 16000),
        mode2_validation_json: t.validation_json || null,
      });
    } catch (err) {
      console.warn(`[mqpv] chat error: ${err.message}`);
    }
    processed += 1;
    if (processed % 10 === 0 || processed === samples.length) {
      console.log(`[mode2-bench/mqpv] ${processed}/${samples.length} (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`);
    }
  }
  console.log(`[mode2-bench/mqpv] done; rows in chat_grounding_samples with thread_id=mode2-bench-${runId}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const runId = args.runId || new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");

  if (args.mode === "gen" || args.mode === "all") {
    args.sourceFile = await generatePhase({
      samples: args.samples,
      fixtures: args.fixtures,
      concurrency: args.concurrency,
      runId,
    });
  }
  if (args.mode === "mqpv" || args.mode === "all") {
    if (!args.sourceFile) throw new Error("--sourceFile required for --mode=mqpv");
    await mqpvPhase({
      sourceFile: args.sourceFile,
      runId,
      concurrency: args.concurrency,
      skipQualifier: args.skipQualifier,
      skipRewrite2: args.skipRewrite2,
    });
  }
  console.log(`[mode2-bench] done. runId=${runId}`);
}

main().catch((err) => {
  console.error("[mode2-bench] FATAL:", err);
  process.exit(1);
});
