// scripts/eval/retrieval-eval.js
//
// Retrieval quality regression harness. Runs a fixture set of questions
// against an RPC ('v3' or 'v4'), computes metrics (recall@5, exclusion
// violations, title-only-match rate, mean similarity of top-3) and
// optionally writes a baseline snapshot under scripts/eval/baselines/.
//
// Usage:
//   node scripts/eval/retrieval-eval.js --rpc=v3 --label=v3-baseline-2026-04-22
//   node scripts/eval/retrieval-eval.js --rpc=v4 --label=v4-cutover-2026-04-23 --compare=v3-baseline-2026-04-22
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENAI_API_KEY from
// .env (via dotenv) locally or from process.env on Hetzner. Does not
// require the app server to be up. Matches the env-loading pattern used
// by other scripts in scripts/ (backfill-chunks.js, etc.).

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../../api/lib/clients.js";
import { embedText } from "../../api/emersus/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "fixtures", "retrieval.json");
const BASELINES_DIR = path.join(__dirname, "baselines");

function parseArgs(argv) {
  const args = { rpc: "v3", label: null, compare: null };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  return args;
}

async function runRpc(rpc, queryEmbedding) {
  if (!supabaseAdmin) {
    throw new Error("supabaseAdmin client not configured — check SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }
  const fnName = rpc === "v4" ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";
  const { data, error } = await supabaseAdmin.rpc(fnName, {
    query_embedding: queryEmbedding,
    match_threshold: 0.4,
    match_count: 10,
    p_include_preprints: true,
  });
  if (error) throw new Error(`${fnName} failed: ${error.message}`);
  return data || [];
}

function metricsFromResults(results, fixture) {
  const top5Pmids = new Set(results.slice(0, 5).map((r) => Number(r.pmid)));
  const mustInclude = (fixture.must_include_pmids || []).map(Number);
  const mustExclude = (fixture.must_exclude_pmids || []).map(Number);
  const recallHits = mustInclude.filter((p) => top5Pmids.has(p));
  const exclusionViolations = mustExclude.filter((p) => top5Pmids.has(p));
  const titleOnlyCount = results.filter((r) => r.is_title_only_match === true).length;
  // matched_title = title chunk hit at HNSW level (regardless of substitution).
  // For v3, matched_chunk_type is undefined so this counts chunk_type==='title'.
  // For v4, matched_chunk_type is set, so this counts what HNSW actually matched
  // (independent of post-substitution shown content).
  const matchedTitleCount = results.filter(
    (r) => (r.matched_chunk_type === "title") ||
           (r.matched_chunk_type === undefined && r.chunk_type === "title")
  ).length;
  // shown_as_title = the user-facing metric. For v3 == matched_title (no
  // substitution). For v4, this should be ~0 because passage substitution
  // swaps title content for abstract content. This is THE headline metric
  // for the title-as-passage rendering bug fix.
  const shownAsTitleCount = results.filter((r) => r.chunk_type === "title").length;
  const topSims = results.slice(0, 3).map((r) => Number(r.similarity || 0));
  const meanTop3Sim = topSims.length
    ? topSims.reduce((a, b) => a + b, 0) / topSims.length
    : 0;
  return {
    recall_hits: recallHits.length,
    recall_target: mustInclude.length,
    exclusion_violations: exclusionViolations.length,
    title_only_count: titleOnlyCount,
    matched_title_count: matchedTitleCount,
    shown_as_title_count: shownAsTitleCount,
    returned_count: results.length,
    mean_top3_similarity: Number(meanTop3Sim.toFixed(4)),
    top5_pmids: Array.from(top5Pmids),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtures = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const results = [];
  console.log(`# Running retrieval eval against ${args.rpc} on ${fixtures.length} fixtures\n`);
  for (const fx of fixtures) {
    const t0 = Date.now();
    let metrics;
    try {
      const emb = await embedText(fx.question);
      const rows = await runRpc(args.rpc, emb);
      metrics = metricsFromResults(rows, fx);
    } catch (err) {
      metrics = { error: err.message };
    }
    const dt = Date.now() - t0;
    results.push({ question: fx.question, latency_ms: dt, ...metrics });
    const recall =
      metrics.recall_target > 0 ? `${metrics.recall_hits}/${metrics.recall_target}` : "—";
    const tail = `recall=${recall} excl_viol=${metrics.exclusion_violations ?? "?"} shown_as_title=${metrics.shown_as_title_count ?? "?"} matched_title=${metrics.matched_title_count ?? "?"} title_only=${metrics.title_only_count ?? "?"} sim=${metrics.mean_top3_similarity ?? "?"} ${dt}ms`;
    console.log(`  ${fx.question.padEnd(55)} ${tail}`);
  }
  const agg = {
    rpc: args.rpc,
    fixtures: fixtures.length,
    total_recall_hits: results.reduce((a, r) => a + (r.recall_hits || 0), 0),
    total_recall_target: results.reduce((a, r) => a + (r.recall_target || 0), 0),
    total_exclusion_violations: results.reduce(
      (a, r) => a + (r.exclusion_violations || 0),
      0
    ),
    total_title_only: results.reduce((a, r) => a + (r.title_only_count || 0), 0),
    total_matched_title: results.reduce((a, r) => a + (r.matched_title_count || 0), 0),
    total_shown_as_title: results.reduce((a, r) => a + (r.shown_as_title_count || 0), 0),
    total_returned: results.reduce((a, r) => a + (r.returned_count || 0), 0),
    mean_latency_ms: Math.round(
      results.reduce((a, r) => a + r.latency_ms, 0) / results.length
    ),
    timestamp: new Date().toISOString(),
  };
  console.log(`\n# Aggregate: ${JSON.stringify(agg, null, 2)}`);
  if (args.label) {
    await fs.mkdir(BASELINES_DIR, { recursive: true });
    const out = path.join(BASELINES_DIR, `${args.label}.json`);
    await fs.writeFile(out, JSON.stringify({ agg, results }, null, 2));
    console.log(`\n# Wrote ${out}`);
  }
  if (args.compare) {
    const baselinePath = path.join(BASELINES_DIR, `${args.compare}.json`);
    try {
      const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
      const recallNow =
        agg.total_recall_target > 0
          ? agg.total_recall_hits / agg.total_recall_target
          : 0;
      const recallBase =
        baseline.agg.total_recall_target > 0
          ? baseline.agg.total_recall_hits / baseline.agg.total_recall_target
          : 0;
      const recallDelta = recallNow - recallBase;
      const shownPctBase = baseline.agg.total_returned
        ? (100 * baseline.agg.total_shown_as_title / baseline.agg.total_returned).toFixed(1)
        : "?";
      const shownPctNow = agg.total_returned
        ? (100 * agg.total_shown_as_title / agg.total_returned).toFixed(1)
        : "?";
      console.log(
        `\n# vs ${args.compare}: recall delta ${(recallDelta * 100).toFixed(1)}pp, shown_as_title ${baseline.agg.total_shown_as_title}/${baseline.agg.total_returned} (${shownPctBase}%) -> ${agg.total_shown_as_title}/${agg.total_returned} (${shownPctNow}%), matched_title ${baseline.agg.total_matched_title} -> ${agg.total_matched_title}`
      );
    } catch (err) {
      console.warn(`# Could not read baseline ${baselinePath}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
