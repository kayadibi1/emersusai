// scripts/eval/paired-stats.js
//
// Paired statistical comparison for bench-matrix results. Reads a matrix
// JSON output, computes per-stack aggregates with bootstrap 95% confidence
// intervals, and runs paired Wilcoxon signed-rank tests on every pair of
// stacks for both pmid-recall@10 and doi-recall@10.
//
// Wilcoxon signed-rank is the right test here:
//   * paired (same fixtures across stacks)
//   * non-parametric (recall is bounded [0,1], not normal)
//   * detects directional shift in median paired differences
//
// Bootstrap CIs (10K resamples) handle non-normal recall distributions
// without parametric assumptions.
//
// Usage:
//   node scripts/eval/paired-stats.js scripts/eval/results/matrix-X.json
//   node scripts/eval/paired-stats.js scripts/eval/results/matrix-X.json --metric=recall_at_10_doi
//   node scripts/eval/paired-stats.js scripts/eval/results/matrix-X.json --baseline=S0

import fs from "node:fs/promises";

function parseArgs(argv) {
  const args = { file: null, metric: "recall_at_10_doi", baseline: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, vRaw] = arg.replace(/^--/, "").split("=");
      args[k] = vRaw ?? true;
    } else {
      args.file = arg;
    }
  }
  if (!args.file) {
    console.error("Usage: node paired-stats.js <matrix.json> [--metric=recall_at_10_doi] [--baseline=S0]");
    process.exit(1);
  }
  return args;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function bootstrapCI(values, { iters = 10000, alpha = 0.05 } = {}) {
  if (values.length === 0) return { lo: 0, hi: 0, mean: 0 };
  const n = values.length;
  const means = new Float64Array(iters);
  for (let i = 0; i < iters; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) {
      s += values[Math.floor(Math.random() * n)];
    }
    means[i] = s / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const lo = sorted[Math.floor((alpha / 2) * iters)];
  const hi = sorted[Math.floor((1 - alpha / 2) * iters)];
  return { lo, hi, mean: mean(values) };
}

// Wilcoxon signed-rank test (two-sided) on paired differences.
// Returns approximate p-value via normal approximation (n >= 10 fixtures
// is more than adequate; we have 200).
function wilcoxonSignedRank(xs, ys) {
  if (xs.length !== ys.length) throw new Error("paired arrays must be same length");
  const n = xs.length;
  // Build (|diff|, sign) pairs, drop zero diffs (Wilcoxon convention)
  const items = [];
  for (let i = 0; i < n; i += 1) {
    const d = xs[i] - ys[i];
    if (d === 0) continue;
    items.push({ abs: Math.abs(d), sign: d > 0 ? 1 : -1 });
  }
  const N = items.length;
  if (N === 0) return { W: 0, z: 0, pTwoSided: 1, n_paired: 0 };

  // Rank by abs(diff), averaging tied ranks
  items.sort((a, b) => a.abs - b.abs);
  const ranks = new Float64Array(N);
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && items[j + 1].abs === items[i].abs) j += 1;
    const avgRank = (i + j + 2) / 2; // ranks are 1-based, so positions i..j map to ranks (i+1)..(j+1)
    for (let k = i; k <= j; k += 1) ranks[k] = avgRank;
    i = j + 1;
  }

  // W+ = sum of ranks where sign > 0
  let Wplus = 0;
  for (let k = 0; k < N; k += 1) {
    if (items[k].sign > 0) Wplus += ranks[k];
  }

  // Normal approximation
  const mu = (N * (N + 1)) / 4;
  const sigma2 = (N * (N + 1) * (2 * N + 1)) / 24;
  const sigma = Math.sqrt(sigma2);
  const z = sigma > 0 ? (Wplus - mu) / sigma : 0;
  const pTwoSided = 2 * (1 - normalCdf(Math.abs(z)));

  return { W: Wplus, z, pTwoSided, n_paired: N };
}

// Standard normal CDF via Abramowitz & Stegun approximation
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

// ─── Per-stack aggregation + per-pair tests ──────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(await fs.readFile(args.file, "utf8"));
  const metric = args.metric;
  const rows = data.rows.filter((r) => !r.error);

  // Group by stack, ordered the way data.stacks is ordered
  const stackOrder = data.stacks.map((s) => s.id);
  const stackById = new Map(data.stacks.map((s) => [s.id, s]));
  const fixtureOrder = [...new Set(rows.map((r) => r.fixture_question))];

  const byStack = new Map();
  for (const sid of stackOrder) {
    byStack.set(sid, []);
  }
  for (const r of rows) {
    const arr = byStack.get(r.stack_id);
    if (!arr) continue;
    arr.push(r);
  }

  // Per-stack lookup: question → metric value (only for successful runs).
  // Missing values are NOT zero-filled — they're left absent so paired
  // comparisons can drop incomplete pairs (listwise deletion).
  const stackLookup = new Map();
  for (const sid of stackOrder) {
    const byFix = new Map();
    for (const r of byStack.get(sid)) {
      const v = r?.[metric];
      if (typeof v === "number" && Number.isFinite(v)) {
        byFix.set(r.fixture_question, v);
      }
    }
    stackLookup.set(sid, byFix);
  }

  // Per-stack vectors (successful runs only) for marginal means + CIs.
  const stackVectors = new Map();
  for (const sid of stackOrder) {
    const lookup = stackLookup.get(sid);
    stackVectors.set(sid, fixtureOrder.filter((q) => lookup.has(q)).map((q) => lookup.get(q)));
  }

  // Helper: paired vectors for stacks A and B, intersected on fixtures both ran.
  function pairedVectors(a, b) {
    const la = stackLookup.get(a);
    const lb = stackLookup.get(b);
    const xs = [];
    const ys = [];
    for (const q of fixtureOrder) {
      if (la.has(q) && lb.has(q)) {
        xs.push(la.get(q));
        ys.push(lb.get(q));
      }
    }
    return { xs, ys, n: xs.length };
  }

  // Per-stack aggregates with bootstrap CI
  console.log(`# Paired comparison for metric: ${metric}`);
  console.log(`# Source: ${args.file}`);
  console.log(`# Fixtures: ${fixtureOrder.length} | Stacks: ${stackOrder.length}\n`);

  console.log("## Per-stack mean ± 95% bootstrap CI");
  console.log("");
  console.log("| Stack | Label | n | Mean | 95% CI |");
  console.log("|---|---|---:|---:|---|");
  const aggregates = [];
  for (const sid of stackOrder) {
    const vec = stackVectors.get(sid);
    const ci = bootstrapCI(vec);
    aggregates.push({ sid, label: stackById.get(sid)?.label || sid, n: vec.length, mean: ci.mean, lo: ci.lo, hi: ci.hi });
    console.log(`| ${sid} | ${stackById.get(sid)?.label || sid} | ${vec.length} | ${(ci.mean * 100).toFixed(1)}% | [${(ci.lo * 100).toFixed(1)}%, ${(ci.hi * 100).toFixed(1)}%] |`);
  }
  aggregates.sort((a, b) => b.mean - a.mean);
  console.log("");
  console.log(`Top stack by ${metric}: **${aggregates[0].sid}** (${aggregates[0].label}) at ${(aggregates[0].mean * 100).toFixed(1)}%`);
  console.log("");

  // Pairwise Wilcoxon tests
  const baseline = args.baseline || stackOrder[0];
  const baseVec = stackVectors.get(baseline);
  if (!baseVec) {
    console.error(`Baseline stack ${baseline} not found.`);
    process.exit(1);
  }

  console.log(`## Paired Wilcoxon signed-rank vs baseline ${baseline}`);
  console.log("");
  console.log("Δ = (stack mean) − (baseline mean). p-values two-sided. Bonferroni-corrected α with k = #stacks-1.");
  console.log("");
  const otherStacks = stackOrder.filter((s) => s !== baseline);
  const k = otherStacks.length;
  const bonfAlpha = 0.05 / Math.max(k, 1);
  console.log(`Bonferroni α: ${bonfAlpha.toExponential(2)} (raw α = 0.05, k = ${k})\n`);
  console.log("| Stack | n_pairs | Δ vs baseline (paired mean) | W+ | z | p (two-sided) | sig @ Bonf | n_nonzero |");
  console.log("|---|---:|---:|---:|---:|---:|:--:|---:|");
  for (const sid of otherStacks) {
    const { xs, ys, n } = pairedVectors(sid, baseline);
    const test = wilcoxonSignedRank(xs, ys);
    const delta = mean(xs) - mean(ys);
    const sig = test.pTwoSided < bonfAlpha ? "✓" : " ";
    console.log(`| ${sid} | ${n} | ${(delta * 100 >= 0 ? "+" : "")}${(delta * 100).toFixed(1)}pp | ${test.W.toFixed(1)} | ${test.z.toFixed(2)} | ${test.pTwoSided.toExponential(2)} | ${sig} | ${test.n_paired} |`);
  }

  console.log("\n## Per-pair best-vs-rest matrix (Δ in pp; ✓ = sig at Bonf-corrected α)");
  console.log("");
  console.log(`| | ${stackOrder.join(" | ")} |`);
  console.log(`|---|${stackOrder.map(() => ":--:").join("|")}|`);
  for (const a of stackOrder) {
    const cells = [];
    for (const b of stackOrder) {
      if (a === b) { cells.push("—"); continue; }
      const { xs, ys } = pairedVectors(a, b);
      if (xs.length < 5) { cells.push("n<5"); continue; }
      const test = wilcoxonSignedRank(xs, ys);
      const delta = mean(xs) - mean(ys);
      const sig = test.pTwoSided < bonfAlpha ? "✓" : "";
      cells.push(`${(delta * 100 >= 0 ? "+" : "")}${(delta * 100).toFixed(1)}${sig}`);
    }
    console.log(`| ${a} | ${cells.join(" | ")} |`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
