// scripts/eval/smoke-hyde.js
//
// End-to-end smoke test for the CHAT_HYDE_ENABLED retrieval path. Runs the
// same prompt through retrieveDatabaseEvidence twice — HyDE off vs on —
// and prints the top-5 pmids + similarities side-by-side so we can
// eyeball whether the fused pool is visibly different (and plausibly
// better) from the single-query baseline.
//
// Usage:
//   node scripts/eval/smoke-hyde.js
//   node scripts/eval/smoke-hyde.js "custom query here"
//
// Does not deploy anything. Runs locally against prod Supabase (same as
// all other eval scripts). Cost per run: one extra gpt-4.1-mini call
// (~$0.0004) plus two embedding calls (~$0.00001).

import "dotenv/config";
import { retrieveDatabaseEvidence } from "../../api/emersus/retrieveDatabaseEvidence.js";

const DEFAULT_QUERIES = [
  "can physical activity help prevent bone loss in seniors?",
  "blood sugar control strategies for middle-aged women",
  "does sugar help endurance athletes",
  "is strength training overrated",
  "how much caffeine before strength training",
];

async function runOne(prompt, hydeEnabled) {
  const priorEnv = process.env.CHAT_HYDE_ENABLED;
  process.env.CHAT_HYDE_ENABLED = hydeEnabled ? "true" : "false";
  process.env.RETRIEVAL_USE_V4 = "true";
  const t0 = Date.now();
  const rows = await retrieveDatabaseEvidence({
    prompt,
    matchThreshold: 0.4,
    matchCount: 10,
    includePreprints: true,
  });
  const dt = Date.now() - t0;
  process.env.CHAT_HYDE_ENABLED = priorEnv ?? "";
  return { rows, dt };
}

async function main() {
  const customQuery = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  const queries = customQuery ? [customQuery] : DEFAULT_QUERIES;

  for (const prompt of queries) {
    console.log(`\n═══ ${prompt}`);
    let baseline, hyde;
    try {
      baseline = await runOne(prompt, false);
    } catch (err) {
      console.log(`  baseline FAILED: ${err.message}`);
      continue;
    }
    try {
      hyde = await runOne(prompt, true);
    } catch (err) {
      console.log(`  HyDE FAILED: ${err.message}`);
      continue;
    }

    console.log(`\n  Baseline (${baseline.dt}ms, ${baseline.rows.length} rows):`);
    for (const [i, row] of baseline.rows.slice(0, 5).entries()) {
      console.log(`    ${i + 1}. pmid=${String(row.pmid).padEnd(11)} sim=${Number(row.similarity || 0).toFixed(3)} "${String(row.title || "").slice(0, 90)}"`);
    }
    console.log(`\n  HyDE (${hyde.dt}ms, ${hyde.rows.length} rows):`);
    for (const [i, row] of hyde.rows.slice(0, 5).entries()) {
      console.log(`    ${i + 1}. pmid=${String(row.pmid).padEnd(11)} sim=${Number(row.similarity || 0).toFixed(3)} "${String(row.title || "").slice(0, 90)}"`);
    }

    // Overlap stats
    const baseSet = new Set(baseline.rows.slice(0, 10).map((r) => Number(r.pmid)));
    const hydeSet = new Set(hyde.rows.slice(0, 10).map((r) => Number(r.pmid)));
    const overlap = [...hydeSet].filter((p) => baseSet.has(p)).length;
    const newFromHyde = [...hydeSet].filter((p) => !baseSet.has(p)).length;
    console.log(`\n  Overlap top-10: ${overlap} shared, ${newFromHyde} new from HyDE, ${hyde.dt - baseline.dt}ms HyDE overhead`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
