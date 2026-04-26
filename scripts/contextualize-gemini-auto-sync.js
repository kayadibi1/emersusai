#!/usr/bin/env node
// Polls all paced manifests in scripts/eval/contextualization-trial/gemini-batch/
// every N minutes and applies any newly-SUCCEEDED batches via --mode=sync.
// Runs forever; safe to nohup.
//
// Usage:
//   node scripts/contextualize-gemini-auto-sync.js --interval-minutes=30

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const STATE_DIR = path.join(process.cwd(), "scripts", "eval", "contextualization-trial", "gemini-batch");

function parseArgs(argv) {
  const a = { intervalMinutes: 30, manifestGlob: "manifest-*-paced.json" };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const k = eq >= 0 ? raw.slice(0, eq) : raw;
    const v = eq >= 0 ? raw.slice(eq + 1) : "";
    if (k === "--interval-minutes") a.intervalMinutes = Number(v);
    else if (k === "--manifest-glob") a.manifestGlob = v;
  }
  return a;
}

function listManifests() {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs.readdirSync(STATE_DIR)
    .filter((f) => f.startsWith("manifest-") && f.endsWith("-paced.json"))
    .map((f) => path.join(STATE_DIR, f));
}

function hasOutstandingJobs(manifestPath) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!m.jobs || m.jobs.length === 0) return false;
    // Job is done when row was applied or hit terminal failure. We approximate:
    // sync writes `applied_at` per job. If any job lacks that AND has batch_name, it's outstanding.
    return m.jobs.some((j) => j.batch_name && !j.applied_at && !j.failed_at);
  } catch {
    return false;
  }
}

function runSync(manifestPath) {
  return new Promise((resolve) => {
    const ts = new Date().toISOString();
    console.log(`[auto-sync] ${ts} sync ${path.basename(manifestPath)}`);
    const child = spawn(process.execPath, [
      "scripts/contextualize-evidence-gemini-batch.js",
      "--mode=sync",
      `--manifest=${manifestPath}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      const summary = out.split("\n").filter((l) => l.includes("applied_rows=") || l.includes("[batch] FAILED")).slice(-2).join(" | ");
      console.log(`[auto-sync] ${path.basename(manifestPath)} exit=${code} ${summary || "(no summary)"}`);
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[auto-sync] starting; interval=${args.intervalMinutes}m state_dir=${STATE_DIR}`);
  while (true) {
    const manifests = listManifests();
    const outstanding = manifests.filter(hasOutstandingJobs);
    console.log(`[auto-sync] ${new Date().toISOString()} found ${manifests.length} manifests, ${outstanding.length} with outstanding jobs`);
    for (const m of outstanding) await runSync(m);
    console.log(`[auto-sync] sleep ${args.intervalMinutes}m`);
    await new Promise((r) => setTimeout(r, args.intervalMinutes * 60 * 1000));
  }
}

main().catch((e) => { console.error("[auto-sync] FAILED:", e); process.exit(1); });
