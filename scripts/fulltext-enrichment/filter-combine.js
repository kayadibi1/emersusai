// scripts/fulltext-enrichment/filter-combine.js
//
// Final stage of the chunk-noise filter pipeline. Takes the LLM-graded
// JSONL (from filter-llm-grader-batch.js) and produces the clean output
// that fulltext-chunk-submit.js will eventually consume:
//
//   - keep chunks where __decision == "EVIDENCE"
//   - drop chunks where __decision == "NOISE"
//   - keep UNKNOWN chunks (we'd rather embed a borderline chunk than
//     drop on a model failure — UNKNOWN means parse error or LLM refused)
//   - strip the __decision field so the schema stays compatible with
//     existing chunk consumers
//
// Also writes a report JSON with per-stage counts + cost estimate.
//
// Usage:
//   node scripts/fulltext-enrichment/filter-combine.js \
//     --input=PATH               (graded JSONL with __decision per chunk) \
//     --output=PATH              (final filtered JSONL — clean schema) \
//     --report=PATH              (per-stage stats + summary)
//
// Optional inputs for richer reporting (totals match the original phase2h):
//   --stage1-kept=PATH    (line count only)
//   --stage1-dropped=PATH (line count only)

import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";

function parseArgs(argv) {
  const a = { input: null, output: null, report: null, stage1Kept: null, stage1Dropped: null };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--input") a.input = v;
    else if (k === "--output") a.output = v;
    else if (k === "--report") a.report = v;
    else if (k === "--stage1-kept") a.stage1Kept = v;
    else if (k === "--stage1-dropped") a.stage1Dropped = v;
  }
  if (!a.input || !a.output || !a.report) {
    console.error("usage: --input=PATH --output=PATH --report=PATH [--stage1-kept=PATH] [--stage1-dropped=PATH]");
    process.exit(2);
  }
  return a;
}

async function lineCount(file) {
  if (!file || !fs.existsSync(file)) return null;
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) n++;
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[combine] starting", args);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const out = fs.createWriteStream(args.output);

  let total = 0, kept = 0, droppedNoise = 0, droppedUnknown = 0;
  let keptByDecision = { EVIDENCE: 0, NOISE: 0, UNKNOWN: 0 };

  const rl = readline.createInterface({
    input: fs.createReadStream(args.input),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    let chunk;
    try { chunk = JSON.parse(line); } catch { continue; }
    const decision = chunk.__decision || "UNKNOWN";
    keptByDecision[decision] = (keptByDecision[decision] || 0) + 1;

    if (decision === "EVIDENCE" || decision === "UNKNOWN") {
      // Strip __decision from the persisted record so the schema stays
      // compatible with whatever fulltext-chunk-submit.js expects.
      const { __decision, ...rest } = chunk;
      out.write(JSON.stringify(rest) + "\n");
      kept++;
      if (decision === "UNKNOWN") droppedUnknown++; // tracked separately for the report
    } else {
      droppedNoise++;
    }
  }

  await new Promise((r) => out.end(r));

  const stage1Kept = await lineCount(args.stage1Kept);
  const stage1Dropped = await lineCount(args.stage1Dropped);

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    inputs: {
      graded_jsonl: args.input,
      stage1_kept_jsonl: args.stage1Kept || null,
      stage1_dropped_jsonl: args.stage1Dropped || null,
    },
    output_jsonl: args.output,
    counts: {
      stage1_total: stage1Kept != null && stage1Dropped != null ? stage1Kept + stage1Dropped : null,
      stage1_kept: stage1Kept,
      stage1_dropped: stage1Dropped,
      stage3_graded_total: total,
      stage3_evidence: keptByDecision.EVIDENCE || 0,
      stage3_noise: keptByDecision.NOISE || 0,
      stage3_unknown: keptByDecision.UNKNOWN || 0,
      final_kept: kept,
      final_dropped_via_stage1: stage1Dropped,
      final_dropped_via_stage3_noise: droppedNoise,
      final_dropped_unknown: droppedUnknown,
    },
    drop_rate_overall: stage1Kept != null && stage1Dropped != null
      ? Number(((stage1Dropped + droppedNoise) / (stage1Kept + stage1Dropped)).toFixed(4))
      : null,
    drop_rate_stage3_only: total ? Number((droppedNoise / total).toFixed(4)) : null,
    next_step: "edit scripts/fulltext-enrichment/fulltext-chunk-submit.js JSONL_INPUTS to include this output, then run the embedding submit",
  };

  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2));

  console.log(`[combine] DONE`);
  console.log(`  graded_total      = ${total}`);
  console.log(`  evidence (kept)   = ${keptByDecision.EVIDENCE || 0}`);
  console.log(`  noise (dropped)   = ${droppedNoise}`);
  console.log(`  unknown (kept)    = ${droppedUnknown}`);
  console.log(`  final_kept        = ${kept}`);
  if (report.counts.stage1_total != null) {
    console.log(`  --- with Stage 1 context ---`);
    console.log(`  stage1_total      = ${report.counts.stage1_total}`);
    console.log(`  stage1_kept       = ${stage1Kept}`);
    console.log(`  stage1_dropped    = ${stage1Dropped}`);
    console.log(`  drop_rate_overall = ${(report.drop_rate_overall * 100).toFixed(2)}%`);
  }
  console.log(`[combine] report → ${args.report}`);
  console.log(`[combine] filtered jsonl → ${args.output}`);
}

main().catch((err) => { console.error("[combine] FAILED:", err); process.exit(1); });
