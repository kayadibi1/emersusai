// scripts/eval/calibration/score-calibration.js
//
// Scores calibration results.
//   Pass A (extraction): F1 of extracted claims vs sidar_final_claims.
//   Pass B (classification): per-mode F1 + Cohen's kappa.
//
// Usage:
//   node scripts/eval/calibration/score-calibration.js --pass=A --in=scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json
//   node scripts/eval/calibration/score-calibration.js --pass=B --in=scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json

import "dotenv/config";
import fs from "node:fs";

import { extractAtomicClaims, classifyClaimModes } from "../../../api/emersus/pipeline/claim-modes.js";

function parseArgs(argv) {
  const args = { pass: null, in: null };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "pass") args.pass = v;
    else if (k === "in") args.in = v;
  }
  if (!args.pass || !args.in) throw new Error("--pass={A|B} --in=<path> required");
  return args;
}

function normalizeClaim(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function f1(precision, recall) {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function setMatch(predicted, gold) {
  // Best-effort overlap by normalized claim text. A predicted claim "matches"
  // a gold claim if their normalized forms share >= 0.5 token Jaccard.
  const pset = predicted.map((c) => new Set(normalizeClaim(c.claim_text).split(" ").filter(Boolean)));
  const gset = gold.map((c) => new Set(normalizeClaim(c.claim_text).split(" ").filter(Boolean)));
  const matchedGold = new Set();
  let tp = 0;
  const matches = [];
  for (let i = 0; i < pset.length; i += 1) {
    let bestJ = 0;
    let bestIdx = -1;
    for (let j = 0; j < gset.length; j += 1) {
      if (matchedGold.has(j)) continue;
      const a = pset[i];
      const b = gset[j];
      const inter = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size;
      const jacc = union ? inter / union : 0;
      if (jacc > bestJ) { bestJ = jacc; bestIdx = j; }
    }
    if (bestJ >= 0.5) {
      tp += 1;
      matchedGold.add(bestIdx);
      matches.push({ predicted: predicted[i].claim_text, gold: gold[bestIdx].claim_text, jaccard: bestJ });
    }
  }
  const fp = pset.length - tp;
  const fn = gset.length - tp;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision, recall, f1: f1(precision, recall), matches };
}

async function scorePassA(inPath) {
  const { prelabels } = JSON.parse(fs.readFileSync(inPath, "utf-8"));
  const totals = { tp: 0, fp: 0, fn: 0 };
  const perAnswer = [];
  console.log(`[Pass A] running production extractor on ${prelabels.length} answers...`);
  // Need the answers from the source eval JSON
  const sourceFile = "scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json";
  const evalData = JSON.parse(fs.readFileSync(sourceFile, "utf-8"));
  for (const row of prelabels) {
    if (!Array.isArray(row.sidar_final_claims)) {
      console.warn(`[Pass A] row ${row.index}: no sidar_final_claims — skipping`);
      continue;
    }
    const evalRow = evalData.results[row.index];
    if (!evalRow) {
      console.warn(`[Pass A] row ${row.index}: no eval row — skipping`);
      continue;
    }
    const answer = evalRow.emersus?.text || "";
    if (!answer) {
      console.warn(`[Pass A] row ${row.index}: no answer text — skipping`);
      continue;
    }
    process.stdout.write(`[${row.index}] `);
    const result = await extractAtomicClaims(answer);
    if (result.error) {
      console.log(`extractor error: ${result.error}`);
      continue;
    }
    const m = setMatch(result.claims, row.sidar_final_claims);
    totals.tp += m.tp; totals.fp += m.fp; totals.fn += m.fn;
    perAnswer.push({ index: row.index, ...m, predicted_count: result.claims.length, gold_count: row.sidar_final_claims.length });
    console.log(`tp=${m.tp} fp=${m.fp} fn=${m.fn} pred=${result.claims.length} gold=${row.sidar_final_claims.length}`);
  }
  const microP = totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : 0;
  const microR = totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : 0;
  const microF1 = f1(microP, microR);
  const gate = microF1 >= 0.85;
  console.log("\n=== PASS A RESULTS ===");
  console.log(`micro precision: ${microP.toFixed(3)}`);
  console.log(`micro recall:    ${microR.toFixed(3)}`);
  console.log(`micro F1:        ${microF1.toFixed(3)}`);
  console.log(`gate (>= 0.85):  ${gate ? "PASS" : "FAIL"}`);
  console.log(`totals: TP=${totals.tp} FP=${totals.fp} FN=${totals.fn}`);

  // Write detailed per-answer results
  const outPath = inPath.replace(/\.v1\.json$/, ".v1.scoring.json");
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), totals, micro_precision: microP, micro_recall: microR, micro_f1: microF1, gate, perAnswer }, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (!gate) process.exit(1);
}

function buildConfusionMatrix(rows, modes) {
  const cm = {};
  for (const m of modes) {
    cm[m] = {};
    for (const m2 of modes) cm[m][m2] = 0;
  }
  for (const r of rows) {
    if (cm[r.gold] && cm[r.gold][r.pred] !== undefined) cm[r.gold][r.pred] += 1;
  }
  return cm;
}

function perModeF1(cm, mode) {
  const tp = cm[mode][mode];
  let fp = 0;
  let fn = 0;
  for (const m of Object.keys(cm)) {
    if (m !== mode) fp += cm[m][mode];
    if (m !== mode) fn += cm[mode][m];
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { mode, n_gold: tp + fn, precision: p, recall: r, f1: f1(p, r) };
}

function cohenKappa(rows) {
  const labels = [...new Set(rows.flatMap((r) => [r.gold, r.pred]))];
  const n = rows.length;
  let agree = 0;
  const goldCount = {};
  const predCount = {};
  for (const r of rows) {
    if (r.gold === r.pred) agree += 1;
    goldCount[r.gold] = (goldCount[r.gold] || 0) + 1;
    predCount[r.pred] = (predCount[r.pred] || 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels) {
    pe += ((goldCount[l] || 0) / n) * ((predCount[l] || 0) / n);
  }
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

async function scorePassB(inPath) {
  const { tuples } = JSON.parse(fs.readFileSync(inPath, "utf-8"));
  console.log(`[Pass B] running production classifier on ${tuples.length} tuples...`);
  const rows = [];
  for (const t of tuples) {
    if (!t.sidar_final_mode) continue;
    const out = await classifyClaimModes([{ claim_text: t.claim_text, cited_ids: t.cited_ids }], t.retrieved_sources);
    const pred = out[0]?.mode;
    if (!pred) continue;
    rows.push({ gold: t.sidar_final_mode, pred, synthetic: !!t.synthetic });
    console.log(`  ${t.claim_text.slice(0, 60)} ... gold=${t.sidar_final_mode} pred=${pred} ${pred === t.sidar_final_mode ? "OK" : "MISS"}`);
  }
  const modes = ["correct", "mode_1_misattribution", "mode_2_overgen", "mode_3_fabrication", "mode_4_contradicted", "no_marker"];
  const cm = buildConfusionMatrix(rows, modes);
  const perMode = modes.map((m) => perModeF1(cm, m));
  const kappa = cohenKappa(rows);
  const synthMode3 = rows.filter((r) => r.synthetic && r.gold === "mode_3_fabrication");
  const natMode3 = rows.filter((r) => !r.synthetic && r.gold === "mode_3_fabrication");

  console.log("\n=== PASS B RESULTS ===");
  console.log("per-mode F1 (modes with N >= 5 are gated; others are advisory):");
  for (const r of perMode) {
    const flag = r.n_gold < 5 ? " [LOW-N]" : (r.f1 < 0.75 ? " [FAIL gate]" : " [PASS]");
    console.log(`  ${r.mode.padEnd(28)} N=${r.n_gold} P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} F1=${r.f1.toFixed(3)}${flag}`);
  }
  console.log(`\nCohen's kappa: ${kappa.toFixed(3)} ${kappa >= 0.6 ? "PASS" : "FAIL"} (gate >= 0.6)`);
  console.log(`mode_3 synthetic acc: ${synthMode3.length ? (synthMode3.filter((r) => r.pred === r.gold).length / synthMode3.length).toFixed(3) : "N/A"} (N=${synthMode3.length})`);
  console.log(`mode_3 natural acc:   ${natMode3.length ? (natMode3.filter((r) => r.pred === r.gold).length / natMode3.length).toFixed(3) : "N/A"} (N=${natMode3.length})`);

  console.log("\nconfusion matrix (rows=gold, cols=pred):");
  console.log("".padEnd(30) + modes.map((m) => m.slice(0, 8).padEnd(10)).join(""));
  for (const m of modes) {
    console.log(m.padEnd(30) + modes.map((m2) => String(cm[m][m2]).padEnd(10)).join(""));
  }

  const failingGated = perMode.filter((r) => r.n_gold >= 5 && r.f1 < 0.75);
  if (failingGated.length || kappa < 0.6) {
    console.log(`\nGATE: FAIL — failing modes: ${failingGated.map((r) => r.mode).join(", ") || "(kappa)"}`);
    process.exit(1);
  }
  console.log("\nGATE: PASS");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.pass === "A") await scorePassA(args.in);
  else if (args.pass === "B") await scorePassB(args.in);
  else throw new Error("--pass must be A or B");
}

main().catch((err) => { console.error(err); process.exit(1); });
