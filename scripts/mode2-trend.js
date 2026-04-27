// scripts/mode2-trend.js
//
// Reads chat_grounding_samples (filterable to synthetic-only or real-only),
// aggregates, emits markdown report.
//
// Usage:
//   node scripts/mode2-trend.js                                    # last 7 days, all rows
//   node scripts/mode2-trend.js --synthetic-only                   # bench rows only
//   node scripts/mode2-trend.js --real-only                        # production rows only
//   node scripts/mode2-trend.js --since=2026-04-26                 # date filter
//   node scripts/mode2-trend.js --thread-id=mode2-bench-z2-live    # specific bench run

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../api/lib/clients.js";
import {
  aggregate,
  renderMarkdown,
  buildRecommendations,
} from "./lib/mode2-bench-metrics.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");

function parseArgs(argv) {
  const args = { syntheticOnly: false, realOnly: false, since: null, threadId: null };
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "synthetic-only") args.syntheticOnly = true;
    else if (k === "real-only") args.realOnly = true;
    else if (k === "since") args.since = v;
    else if (k === "thread-id") args.threadId = v;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let q = supabaseAdmin
    .from("chat_grounding_samples")
    .select("*")
    .eq("mode2_enabled", true);
  if (args.syntheticOnly) q = q.eq("synthetic", true);
  if (args.realOnly) q = q.eq("synthetic", false);
  if (args.threadId) q = q.eq("thread_id", args.threadId);
  if (args.since) q = q.gte("created_at", args.since);
  q = q.order("created_at", { ascending: false }).limit(10000);

  const { data, error } = await q;
  if (error) {
    console.error("[mode2-trend] supabase error:", error.message);
    process.exit(1);
  }
  console.log(`[mode2-trend] fetched ${data?.length || 0} rows`);

  const metrics = aggregate(data || []);
  const recommendations = buildRecommendations(metrics);
  const runId = args.threadId || (args.syntheticOnly ? "synthetic" : args.realOnly ? "real" : "all");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  const md = renderMarkdown(metrics, { runId: `${runId}-${ts}`, recommendations });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `mode2-trend-${runId}-${ts}.md`);
  await fs.writeFile(outPath, md);
  console.log(`[mode2-trend] wrote ${outPath}`);
  if (recommendations.length > 0) {
    console.log("\n[mode2-trend] recommendations:");
    recommendations.forEach((r) => console.log(`  - ${r}`));
  }
}

main().catch((err) => {
  console.error("[mode2-trend] FATAL:", err);
  process.exit(1);
});
