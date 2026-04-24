// scripts/eval/analyze-paired-diff.js
//
// Paired diff analysis across multiple matrix runs. Loads N matrix JSON
// outputs, joins on (stack_id, fixture_question), computes per-pair and
// aggregate deltas on recall@{6, 10, 100}, MRR, and latency. Designed
// to answer:
//
//   1. How much did Jina lift recall vs no-rerank baseline? (retrieval layer)
//   2. How much does rankEvidence (prod heuristic) preserve or erase
//      those gains? (what the LLM actually gets)
//   3. Which full stack (query-transform × rerank × prod-heuristic) is
//      Pareto-optimal for ship?
//
// Usage:
//   node scripts/eval/analyze-paired-diff.js \
//     --free=matrix-v2-free-matrix.json \
//     --jina=matrix-v2-jina-matrix.json \
//     --e2e=matrix-v2-jina-matrix-e2e.json \
//     --out=results/paired-diff-2026-04-24.md
//
// The --free, --jina, --e2e args are matrix JSON basenames under
// scripts/eval/results/. All three are optional; if any is missing the
// corresponding section is skipped gracefully.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");

function parseArgs(argv) {
  const args = { free: null, jina: null, e2e: null, out: null };
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "free") args.free = v;
    else if (k === "jina") args.jina = v;
    else if (k === "e2e") args.e2e = v;
    else if (k === "out") args.out = v;
  }
  return args;
}

async function loadMatrix(basename) {
  if (!basename) return null;
  const filePath = path.isAbsolute(basename)
    ? basename
    : path.join(RESULTS_DIR, basename);
  try {
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch (err) {
    console.warn(`# Could not load ${filePath}: ${err.message}`);
    return null;
  }
}

function indexRowsByStackAndFixture(matrix) {
  if (!matrix?.rows) return new Map();
  const idx = new Map();
  for (const row of matrix.rows) {
    if (row.error) continue;
    const key = `${row.stack_id}|${row.fixture_question}`;
    idx.set(key, row);
  }
  return idx;
}

function meanOver(rows, field) {
  const vals = rows.map((r) => Number(r[field] || 0)).filter(Number.isFinite);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function aggStack(rows) {
  const rec6 = meanOver(rows, "recall_at_6");
  const rec10 = meanOver(rows, "recall_at_10");
  const rec100 = meanOver(rows, "recall_at_100");
  const mrr = meanOver(rows, "mrr_at_10");
  const latency = meanOver(rows, "latency_ms");
  const cost = meanOver(rows, "cost_usd");
  return {
    fixtures: rows.length,
    recall_at_6: rec6,
    recall_at_10: rec10,
    recall_at_100: rec100,
    mrr_at_10: mrr,
    latency_ms: latency,
    cost_usd: cost,
  };
}

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}
function fmtPp(delta) {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)}pp`;
}

async function main() {
  const args = parseArgs(process.argv);
  const [free, jina, e2e] = await Promise.all([
    loadMatrix(args.free),
    loadMatrix(args.jina),
    loadMatrix(args.e2e),
  ]);

  const lines = [];
  lines.push(`# Paired Diff Analysis — 2026-04-24`);
  lines.push("");
  lines.push(`Sources:`);
  lines.push(`- Free matrix (no rerank, no prod-heuristic): ${args.free || "—"}`);
  lines.push(`- Jina matrix (Jina rerank, no prod-heuristic): ${args.jina || "—"}`);
  lines.push(`- E2E matrix (Jina + prod rankEvidence slice-to-6): ${args.e2e || "—"}`);
  lines.push("");

  // ─── Jina lift over no-rerank baselines ────────────────────────────────────
  if (free && jina) {
    lines.push("## Jina rerank lift (retrieval layer, recall@10 pre-heuristic)");
    lines.push("");
    lines.push("| Pair | Baseline | + Jina | Δrecall@10 | ΔMRR@10 | Latency |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    const pairs = [
      { baseline: "S0", jina: "S13", label: "Dense only → Dense + Jina" },
      { baseline: "S3", jina: "S14", label: "HyDE → HyDE + Jina" },
      { baseline: "S2", jina: "S15", label: "Multi-query → MQ + Jina" },
      { baseline: "S4", jina: "S16", label: "PICOs → PICOs + Jina" },
    ];
    const freeAgg = indexAgg(free);
    const jinaAgg = indexAgg(jina);
    for (const p of pairs) {
      const b = freeAgg.get(p.baseline);
      const j = jinaAgg.get(p.jina);
      if (!b || !j) {
        lines.push(`| ${p.label} | missing | missing | — | — | — |`);
        continue;
      }
      const d10 = j.recall_at_10 - b.recall_at_10;
      const dMrr = j.mrr_at_10 - b.mrr_at_10;
      lines.push(
        `| ${p.label} | ${fmtPct(b.recall_at_10)} | ${fmtPct(j.recall_at_10)} | **${fmtPp(d10)}** | ${dMrr > 0 ? "+" : ""}${dMrr.toFixed(3)} | ${Math.round(j.latency_ms)}ms |`
      );
    }
    lines.push("");
  }

  // ─── Heuristic preservation/erasure ────────────────────────────────────────
  if (jina && e2e) {
    lines.push("## Prod heuristic (rankEvidence) effect — does it preserve or erase Jina gains?");
    lines.push("");
    lines.push(`The retrieval-layer matrix measures recall@10 on raw retrieval+rerank output. The e2e matrix measures recall@6 on the SAME stacks AFTER rankEvidence's weighted blend (freshness 0.30 + quality 0.30 + similarity 0.25 + RCR 0.15) filters to 6.`);
    lines.push("");
    lines.push("| Stack | Retrieval recall@10 | Post-heuristic recall@6 | Δ (heuristic effect) | MRR@10 retrieval | MRR@10 post-heuristic |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    const jinaAgg = indexAgg(jina);
    const e2eAgg = indexAgg(e2e);
    const stacksOfInterest = ["S0", "S3", "S13", "S14", "S15", "S16"];
    for (const s of stacksOfInterest) {
      const r = jinaAgg.get(s);
      const p = e2eAgg.get(s);
      if (!r && !p) continue;
      const rRow = r ? fmtPct(r.recall_at_10) : "—";
      const pRow = p ? fmtPct(p.recall_at_6) : "—";
      const delta = r && p ? p.recall_at_6 - r.recall_at_10 : null;
      const deltaFmt = delta == null ? "—" : fmtPp(delta);
      const rMrr = r ? r.mrr_at_10.toFixed(3) : "—";
      const pMrr = p ? p.mrr_at_10.toFixed(3) : "—";
      lines.push(`| ${s} | ${rRow} | ${pRow} | ${deltaFmt} | ${rMrr} | ${pMrr} |`);
    }
    lines.push("");
    lines.push("_Negative Δ means heuristic demoted relevant papers. Positive Δ means heuristic promoted them — unlikely, but possible if freshness/RCR align with relevance._");
    lines.push("");
  }

  // ─── Final Pareto ranking ──────────────────────────────────────────────────
  const finalAgg = indexAgg(e2e || jina);
  if (finalAgg.size > 0) {
    lines.push("## Pareto frontier — ship candidates (ranked by " + (e2e ? "post-heuristic recall@6" : "retrieval recall@10") + ")");
    lines.push("");
    const allStacks = Array.from(finalAgg.entries())
      .map(([id, a]) => ({ id, ...a }))
      .sort((a, b) => (b.recall_at_6 || b.recall_at_10) - (a.recall_at_6 || a.recall_at_10));
    lines.push("| Rank | Stack | Recall@6 | Recall@10 | Recall@100 | MRR | Latency | Cost/q |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const [i, a] of allStacks.entries()) {
      lines.push(`| ${i + 1} | ${a.id} | ${fmtPct(a.recall_at_6)} | ${fmtPct(a.recall_at_10)} | ${fmtPct(a.recall_at_100)} | ${a.mrr_at_10.toFixed(3)} | ${Math.round(a.latency_ms)}ms | $${a.cost_usd.toFixed(4)} |`);
    }
    lines.push("");
  }

  // ─── Ship recommendation ──────────────────────────────────────────────────
  lines.push("## Integration recommendation");
  lines.push("");
  if (free && jina && e2e) {
    const freeAgg = indexAgg(free);
    const jinaAgg = indexAgg(jina);
    const e2eAgg = indexAgg(e2e);
    const s3Free = freeAgg.get("S3");
    const s14Jina = jinaAgg.get("S14");
    const s14E2E = e2eAgg.get("S14");
    const hydeJinaLift = s14Jina && s3Free ? s14Jina.recall_at_10 - s3Free.recall_at_10 : 0;
    const heuristicCost = s14Jina && s14E2E ? s14E2E.recall_at_6 - s14Jina.recall_at_10 : 0;
    lines.push(`- **HyDE + Jina rerank retrieval lift vs baseline**: ${fmtPp(hydeJinaLift)} recall@10`);
    lines.push(`- **Heuristic preserves vs erases**: ${fmtPp(heuristicCost)} recall@6 delta from retrieval-layer recall@10`);
    if (heuristicCost > -0.03) {
      lines.push(`- **Verdict: ship Option A** — run Jina after heuristic (rankEvidence → Jina top-6). Heuristic not erasing gains; preserves freshness/RCR signals with minimal cost.`);
    } else if (heuristicCost < -0.07) {
      lines.push(`- **Verdict: ship Option E** — replace heuristic's 25% similarity weight with Jina score. Heuristic is demoting Jina's best picks; need to keep cross-encoder relevance in the final ranking.`);
    } else {
      lines.push(`- **Verdict: ship Option C** — Jina BEFORE heuristic, then rankEvidence on the Jina-ordered pool. Preserves freshness boost while letting Jina do the initial relevance sort.`);
    }
  }
  lines.push("");

  const outPath = args.out
    ? (path.isAbsolute(args.out) ? args.out : path.join(RESULTS_DIR, args.out))
    : path.join(RESULTS_DIR, `paired-diff-${new Date().toISOString().slice(0, 10)}.md`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join("\n"));
  console.log(`# Wrote ${outPath}`);
  console.log("");
  console.log(lines.join("\n"));
}

function indexAgg(matrix) {
  const result = new Map();
  if (!matrix?.rows) return result;
  const byStack = new Map();
  for (const r of matrix.rows) {
    if (r.error) continue;
    if (!byStack.has(r.stack_id)) byStack.set(r.stack_id, []);
    byStack.get(r.stack_id).push(r);
  }
  for (const [stackId, rows] of byStack.entries()) {
    result.set(stackId, aggStack(rows));
  }
  return result;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
