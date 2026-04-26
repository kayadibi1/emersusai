#!/usr/bin/env node
// Watches in-flight Gemini batches across one or more manifests and, once enough
// have drained, auto-resumes the paced submitter. Tier 1 Flash-Lite caps at 10M
// enqueued tokens; each 5k-row batch ≈ 3M tokens, so ≤3 in-flight = headroom.
//
// Usage:
//   node scripts/contextualize-gemini-drain-watcher.js \
//     --manifests=path1.json,path2.json \
//     --max-in-flight=2 \
//     --poll-seconds=600 \
//     --resume-args="--budget-usd=88 --after-id=401484 --rows-per-job=5000 --pace-seconds=300 --min-pace-seconds=120 --max-pace-seconds=1800"

import "dotenv/config";
import fs from "node:fs";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const a = {
    manifests: [],
    maxInFlight: 2,
    pollSeconds: 600,
    resumeArgs: "",
    resumeLog: "gemini-paced-resumed.log",
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const k = eq >= 0 ? raw.slice(0, eq) : raw;
    const v = eq >= 0 ? raw.slice(eq + 1) : "";
    if (k === "--manifests") a.manifests = String(v).split(",").filter(Boolean);
    else if (k === "--max-in-flight") a.maxInFlight = Number(v);
    else if (k === "--poll-seconds") a.pollSeconds = Number(v);
    else if (k === "--resume-args") a.resumeArgs = String(v);
    else if (k === "--resume-log") a.resumeLog = String(v);
  }
  if (!a.manifests.length) throw new Error("--manifests required");
  if (!a.resumeArgs) throw new Error("--resume-args required");
  return a;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);

function suffixState(s) {
  const up = String(s || "").toUpperCase();
  for (const t of TERMINAL) if (up.endsWith(t)) return t;
  return null;
}

async function getBatch(name) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
  });
  if (!r.ok) return { state: "UNKNOWN", error: `http_${r.status}` };
  const j = await r.json();
  return { state: j.state || j.metadata?.state || "UNKNOWN", raw: j };
}

function loadJobs(manifests) {
  const jobs = [];
  for (const p of manifests) {
    if (!fs.existsSync(p)) { console.warn(`[drain] manifest missing: ${p}`); continue; }
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const j of (m.jobs || [])) {
      if (j.batch) jobs.push({ manifest: p, name: j.batch, index: j.index, rows: j.rows });
    }
  }
  return jobs;
}

function spawnResume(args) {
  const out = fs.openSync(args.resumeLog, "a");
  const err = fs.openSync(args.resumeLog, "a");
  const child = spawn(process.execPath, ["scripts/contextualize-gemini-paced.js", ...args.resumeArgs.split(/\s+/).filter(Boolean)], {
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  console.log(`[drain] spawned paced submitter pid=${child.pid} log=${args.resumeLog}`);
  return child.pid;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = loadJobs(args.manifests);
  console.log(`[drain] watching ${jobs.length} batches across ${args.manifests.length} manifests`);
  console.log(`[drain] resume when in-flight ≤ ${args.maxInFlight}; poll every ${args.pollSeconds}s`);

  while (true) {
    const states = {};
    let inFlight = 0;
    for (const job of jobs) {
      try {
        const { state } = await getBatch(job.name);
        const term = suffixState(state);
        states[term || state] = (states[term || state] || 0) + 1;
        if (!term) inFlight++;
      } catch (e) {
        states.ERROR = (states.ERROR || 0) + 1;
        inFlight++; // treat as in-flight to be safe
      }
    }
    const ts = new Date().toISOString();
    console.log(`[drain] ${ts} in-flight=${inFlight} states=${JSON.stringify(states)}`);

    if (inFlight <= args.maxInFlight && !args.continuous) {
      console.log(`[drain] threshold met (in-flight=${inFlight} ≤ ${args.maxInFlight}); resuming submitter`);
      spawnResume(args);
      console.log(`[drain] done; exiting watcher`);
      break;
    }

    await new Promise((r) => setTimeout(r, args.pollSeconds * 1000));
  }
}

main().catch((e) => { console.error("[drain] FAILED:", e); process.exit(1); });
