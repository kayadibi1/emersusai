// scripts/eval/anchor-verifier-bench.js
//
// Anchor-Verified Citations (AVC) v1 bench harness. Three phases:
//
//   gen     — Run the prod chat workflow against N fixtures, capture
//             {question, sources, answer_text, grounding}.
//   verify  — For each captured chat, extract atomic claims, then
//             extract per-claim anchors against cited sources, then
//             verify each anchor (substring → judge fallback).
//   report  — Aggregate metrics, write markdown summary + audit JSONL
//             of FAIL anchors for downstream Claude FRR review.
//
// All three phases write to scripts/eval/results/. No DB writes, no UI.
//
// Usage:
//   node scripts/eval/anchor-verifier-bench.js --mode=all --samples=10
//   node scripts/eval/anchor-verifier-bench.js --mode=gen --samples=1000 --concurrency=6
//   node scripts/eval/anchor-verifier-bench.js --mode=verify --sourceFile=results/anchor-bench-source-XXX.json
//   node scripts/eval/anchor-verifier-bench.js --mode=report --verifiedFile=results/anchor-bench-XXX.json

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  generateRecommendationJSON,
} from "../../api/emersus/workflow.js";
import {
  extractAtomicClaims,
  classifyClaimModes,
  extractAnchorsForClaim,
} from "../../api/emersus/pipeline/claim-modes.js";
import { verifyAnchor } from "../../api/emersus/pipeline/anchor-verify.js";
import { buildSourceScopeResolver } from "../../api/emersus/pipeline/anchor-source-scope.js";
import {
  aggregateMetrics,
  renderMarkdown,
  selectAuditSubset,
} from "./lib/anchor-bench-metrics.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");
const FIXTURES_DEFAULT = "scripts/eval/fixtures/retrieval-v2.json";

function parseArgs(argv) {
  const args = {
    mode: "all",
    samples: 1000,
    fixtures: FIXTURES_DEFAULT,
    concurrency: 6,
    sourceFile: null,
    verifiedFile: null,
    runId: null,
  };
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [k, v] = arg.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  if (args.samples) args.samples = Number(args.samples);
  if (args.concurrency) args.concurrency = Number(args.concurrency);
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
  console.log(`[anchor-bench/gen] loaded ${fixturesArr.length} fixtures from ${fixtures}`);

  const out = [];
  const startedAt = Date.now();
  let cursor = 0;
  let inFlight = 0;
  let done = 0;
  const total = fixturesArr.length;

  await new Promise((resolve) => {
    function pump() {
      if (cursor >= total && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < total) {
        const fixture = fixturesArr[cursor++];
        inFlight += 1;
        runOne(fixture)
          .then((rec) => out.push(rec))
          .catch((err) => {
            console.warn(`[anchor-bench/gen] fixture failed: ${err.message}`);
            out.push({ question: fixture.question, error: err.message });
          })
          .finally(() => {
            inFlight -= 1;
            done += 1;
            if (done % 25 === 0 || done === total) {
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
              console.log(`[anchor-bench/gen] ${done}/${total} (${elapsed}s elapsed)`);
            }
            pump();
          });
      }
    }
    pump();
  });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const sourcePath = path.join(RESULTS_DIR, `anchor-bench-source-${runId}.json`);
  await fs.writeFile(
    sourcePath,
    JSON.stringify({
      run_id: runId,
      generated_at: new Date().toISOString(),
      n_chats: out.length,
      n_errors: out.filter((s) => s.error).length,
      samples: out,
    }, null, 2),
  );
  console.log(`[anchor-bench/gen] wrote ${out.length} samples to ${sourcePath}`);
  return sourcePath;
}

async function runOne(fixture) {
  const question = fixture.question || fixture.prompt;
  if (!question) throw new Error("fixture missing 'question'");
  const t = Date.now();
  const result = await generateRecommendationJSON({
    question,
    threadId: `anchor-bench-${Math.random().toString(36).slice(2, 10)}`,
  });
  return {
    fixture_id: fixture.id || fixture.metadata?.target_pmid || null,
    question,
    answer_text: result.answer_text || result.summary || "",
    sources: (result.sources || []).map((s) => ({
      index: s.index,
      pmid: s.pmid,
      doi: s.doi,
      title: s.title,
      excerpt: s.excerpt,
      similarity: s.similarity,
      publication_year: s.year || s.publication_year,
      publication_type: s.publication_type,
      journal: s.journal,
    })),
    grounding: result.grounding || null,
    latency_ms: Date.now() - t,
  };
}

// ─── Phase: verification ─────────────────────────────────────────────────────

async function verifyOneChat(sample, resolver) {
  if (sample.error || !sample.answer_text) {
    return { ...sample, claims: [], verify_skipped: "no_answer" };
  }
  try {
    const ext = await extractAtomicClaims(sample.answer_text);
    const claims = ext.claims || [];
    const sourcesForChat = sample.sources || [];

    // Resolve scope per cited source (cached within the resolver per-pmid).
    const scopeBySourceId = new Map();
    await Promise.all(sourcesForChat.map(async (s) => {
      if (!s.pmid) return;
      const scope = await resolver.resolve({
        pmid: s.pmid,
        fallbackChunk: s.excerpt || "",
      });
      scopeBySourceId.set(s.index, scope);
    }));

    // Per-claim work (anchor extraction + classification) runs in parallel
    // PER CHAT — claims are independent. Anchors within a claim are verified
    // in parallel too (each is a fast substring check; only judge fallback
    // costs an LLM call).
    const [claimRecords, modeRecords] = await Promise.all([
      Promise.all(claims.map(async (claim) => {
        const sourcesWithScope = sourcesForChat
          .filter((s) => (claim.cited_ids || []).includes(s.index))
          .map((s) => ({
            id: s.index,
            chunk: scopeBySourceId.get(s.index)?.chunk || s.excerpt,
            abstract: scopeBySourceId.get(s.index)?.abstract,
            full_text: scopeBySourceId.get(s.index)?.full_text,
          }));
        if (sourcesWithScope.length === 0) {
          return {
            claim_text: claim.claim_text,
            cited_ids: claim.cited_ids,
            anchors: [],
            anchor_extraction_error: "no_cited_sources",
          };
        }
        const anchorExt = await extractAnchorsForClaim(claim, sourcesWithScope);
        const anchorRecords = await Promise.all((anchorExt.anchors || []).map(async (anchor) => {
          const scope = scopeBySourceId.get(anchor.attributed_source_id) || {
            chunk: "",
            full_text: null,
            abstract: null,
          };
          const v = await verifyAnchor(anchor, scope);
          return { ...anchor, ...v };
        }));
        return {
          claim_text: claim.claim_text,
          cited_ids: claim.cited_ids,
          anchors: anchorRecords,
          anchor_extraction_error: anchorExt.error || null,
        };
      })),
      classifyClaimModes(
        claims,
        sourcesForChat.map((s) => ({
          title: s.title,
          excerpt: s.excerpt,
          publication_year: s.publication_year,
          publication_type: s.publication_type,
          journal: s.journal,
          is_title_only_match: false,
        })),
      ),
    ]);

    const modeByText = new Map(modeRecords.map((m) => [m.claim_text, m]));
    for (const cr of claimRecords) {
      const mr = modeByText.get(cr.claim_text);
      cr.existing_mode = mr?.mode || null;
      cr.existing_qualifier_diff = mr?.qualifier_diff || null;
    }
    return { ...sample, claims: claimRecords };
  } catch (err) {
    console.warn(`[anchor-bench/verify] chat error: ${err.message}`);
    return { ...sample, claims: [], verify_error: err.message };
  }
}

async function verifyPhase({ sourceFile, runId, concurrency = 4 }) {
  const sourceData = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const samples = sourceData.samples || [];
  console.log(`[anchor-bench/verify] verifying ${samples.length} chats from ${sourceFile} (concurrency=${concurrency})`);

  const resolver = buildSourceScopeResolver();
  const verified = new Array(samples.length);
  const startedAt = Date.now();
  let cursor = 0;
  let inFlight = 0;
  let done = 0;

  await new Promise((resolve) => {
    function pump() {
      if (cursor >= samples.length && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < samples.length) {
        const idx = cursor++;
        inFlight += 1;
        verifyOneChat(samples[idx], resolver)
          .then((rec) => { verified[idx] = rec; })
          .catch((err) => { verified[idx] = { ...samples[idx], claims: [], verify_error: err.message }; })
          .finally(() => {
            inFlight -= 1;
            done += 1;
            if (done % 10 === 0 || done === samples.length) {
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
              console.log(`[anchor-bench/verify] ${done}/${samples.length} (${elapsed}s elapsed)`);
            }
            pump();
          });
      }
    }
    pump();
  });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const verifiedPath = path.join(RESULTS_DIR, `anchor-bench-${runId}.json`);
  await fs.writeFile(
    verifiedPath,
    JSON.stringify({
      run_id: runId,
      verified_at: new Date().toISOString(),
      n_chats: verified.length,
      per_chat: verified,
    }, null, 2),
  );
  console.log(`[anchor-bench/verify] wrote ${verified.length} verified chats to ${verifiedPath}`);
  return verifiedPath;
}

// ─── Phase: report ───────────────────────────────────────────────────────────

async function reportPhase({ verifiedFile, runId }) {
  const verified = JSON.parse(await fs.readFile(verifiedFile, "utf8"));
  const metrics = aggregateMetrics(verified);
  const md = renderMarkdown(metrics, { runId });
  const mdPath = path.join(RESULTS_DIR, `anchor-bench-${runId}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`[anchor-bench/report] wrote ${mdPath}`);

  const audit = selectAuditSubset(verified, { n: 50 });
  const auditPath = path.join(RESULTS_DIR, `anchor-bench-${runId}-audit.jsonl`);
  await fs.writeFile(auditPath, audit.map((a) => JSON.stringify(a)).join("\n"));
  console.log(`[anchor-bench/report] wrote ${audit.length} audit anchors to ${auditPath}`);

  return { mdPath, auditPath };
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
  if (args.mode === "verify" || args.mode === "all") {
    if (!args.sourceFile) throw new Error("--sourceFile required for --mode=verify");
    args.verifiedFile = await verifyPhase({
      sourceFile: args.sourceFile,
      runId,
      concurrency: args.concurrency,
    });
  }
  if (args.mode === "report" || args.mode === "all") {
    if (!args.verifiedFile) throw new Error("--verifiedFile required for --mode=report");
    await reportPhase({ verifiedFile: args.verifiedFile, runId });
  }

  console.log(`[anchor-bench] done. runId=${runId}`);
}

main().catch((err) => {
  console.error("[anchor-bench] FATAL:", err);
  process.exit(1);
});
