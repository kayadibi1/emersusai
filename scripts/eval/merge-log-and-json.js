// Merge a bench-matrix log file (with truncated/incomplete output) with one
// or more matrix JSON outputs into a single bench-matrix-shaped JSON. Lets
// us run paired-stats.js across stacks that came from different runs.
//
// Usage:
//   node scripts/eval/merge-log-and-json.js \
//     --log=/tmp/rerank-shootout.log \
//     --json=scripts/eval/results/matrix-cohere-rerun.json \
//     --fixtures=scripts/eval/fixtures/retrieval-v2.json \
//     --out=scripts/eval/results/matrix-shootout-merged.json

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { log: null, json: [], fixtures: null, out: null };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "log") args.log = v;
    else if (k === "json") args.json.push(v);
    else if (k === "fixtures") args.fixtures = v;
    else if (k === "out") args.out = v;
  }
  return args;
}

// Parse log lines like:
//   "  [123/1600] question text                  pmid@10=100% doi@10=50% doi@100=80% mrr=1.00 1234ms $0.0004"
// returning { stack_id, fixture_question, recall_at_10, recall_at_10_doi, recall_at_100_doi, mrr_at_10, mrr_at_10_doi, latency_ms }.
function parseLog(text) {
  const lines = text.split("\n");
  const stackHeader = /^## Stack (\S+) — (.*)$/;
  const cellLine = /^\s*\[(\d+)\/\d+\]\s+(.+?)\s+pmid@10=(\d+)%\s+doi@10=(\d+)%\s+doi@100=(\d+)%\s+mrr=([\d.]+)\s+(\d+)ms\s+\$([\d.]+)$/;
  const errLine = /^\s*\[(\d+)\/\d+\]\s+(.+?)\s+ERR:\s+(.+)$/;
  const rows = [];
  let stackId = null;
  for (const ln of lines) {
    const sh = ln.match(stackHeader);
    if (sh) { stackId = sh[1]; continue; }
    if (!stackId) continue;
    const er = ln.match(errLine);
    if (er) {
      rows.push({
        stack_id: stackId,
        fixture_question: er[2].trim(),
        error: er[3],
      });
      continue;
    }
    const m = ln.match(cellLine);
    if (m) {
      const recall_at_10 = Number(m[3]) / 100;
      const recall_at_10_doi = Number(m[4]) / 100;
      const recall_at_100_doi = Number(m[5]) / 100;
      const mrr_at_10_doi = Number(m[6]);
      rows.push({
        stack_id: stackId,
        fixture_question: m[2].trim(),
        recall_at_10,
        recall_at_50: 0, // log doesn't have these mid-line; not needed for paired-stats default metric
        recall_at_100: recall_at_100_doi, // placeholder; paired-stats default is doi metric
        recall_at_10_doi,
        recall_at_50_doi: 0,
        recall_at_100_doi,
        mrr_at_10: 0,
        mrr_at_10_doi,
        latency_ms: Number(m[7]),
        cost_usd: Number(m[8]),
        hit_at_10: recall_at_10 > 0 ? 1 : 0,
        hit_at_50: 0,
        hit_at_100: recall_at_100_doi > 0 ? 1 : 0,
        exclusion_violations_at_10: 0,
        exclusion_violations_at_10_doi: 0,
      });
    }
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.log || !args.fixtures || !args.out) {
    console.error("Usage: --log=PATH --json=PATH [--json=PATH ...] --fixtures=PATH --out=PATH");
    process.exit(1);
  }
  const fixtures = JSON.parse(fs.readFileSync(args.fixtures, "utf8"));
  const fixtureLookup = new Map(fixtures.map((f) => [f.question, f]));

  // 1. Parse log
  const logRows = parseLog(fs.readFileSync(args.log, "utf8"));
  console.log(`Parsed log: ${logRows.length} rows (incl errors) from ${args.log}`);

  // 2. Read JSON matrices and gather stacks + rows (deduplicate by stack_id;
  //    later JSONs override earlier log/JSON entries for the same stack).
  let mergedStacks = new Map();
  let mergedRows = [];

  // Stacks in log come from `## Stack X — label` headers. We don't have the
  // full stack metadata in the log, so synthesize minimal stack records and
  // override with JSON's richer shape if we get it.
  const logStackIds = [...new Set(logRows.map((r) => r.stack_id))];
  for (const sid of logStackIds) {
    mergedStacks.set(sid, { id: sid, label: sid, source: "log" });
  }

  for (const jsonPath of args.json) {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    for (const s of data.stacks || []) {
      mergedStacks.set(s.id, { ...s, source: "json" });
    }
    // Overwrite any log rows for the stacks present in this JSON.
    const jsonStackIds = new Set((data.stacks || []).map((s) => s.id));
    mergedRows = mergedRows.filter((r) => !jsonStackIds.has(r.stack_id));
    for (const r of data.rows || []) {
      if (jsonStackIds.has(r.stack_id)) mergedRows.push(r);
    }
    console.log(`Merged JSON ${path.basename(jsonPath)}: stacks=[${[...jsonStackIds].join(",")}] rows=${data.rows?.length || 0}`);
  }

  // Rows from log for stacks not overridden by JSON
  const overriddenStackIds = new Set(mergedRows.map((r) => r.stack_id));
  for (const r of logRows) {
    if (overriddenStackIds.has(r.stack_id)) continue;
    mergedRows.push(r);
  }

  // Drop log-rows for stacks where the log run was incomplete (n < expected).
  // We expect 200 fixtures; warn if any stack has fewer.
  const byStack = {};
  for (const r of mergedRows) {
    if (r.error) continue;
    byStack[r.stack_id] = (byStack[r.stack_id] || 0) + 1;
  }
  for (const sid of Object.keys(byStack)) {
    if (byStack[sid] < 200) {
      console.warn(`  WARN stack ${sid}: only ${byStack[sid]}/200 fixtures (incomplete run)`);
    }
  }

  // Final out shape mirrors bench-matrix.js
  const out = {
    args: { merged: true, log: args.log, jsons: args.json, fixtures: args.fixtures },
    stacks: [...mergedStacks.values()].map((s) => ({ id: s.id, label: s.label, query_transform: s.query_transform || "?", index: s.index || "?", rerank: s.rerank || "?" })),
    fixtures,
    rows: mergedRows,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${args.out}`);
  console.log(`  stacks: ${out.stacks.length} | rows: ${out.rows.length} | fixtures: ${out.fixtures.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
