// Widget-v2 diagnostic harness — runs 100 prompts through the full chat
// pipeline (sanitize → safety → retrieval → synthesize → stream) and
// captures prompt + retrieval + widget payload + prose + grounding per run.
//
// Writes one JSONL row per prompt to scripts/widget-diagnose/runs/<date>.jsonl.
//
// Usage:
//   node scripts/widget-diagnose/run-harness.mjs --limit=5     # smoke
//   node scripts/widget-diagnose/run-harness.mjs               # full 100
//   node scripts/widget-diagnose/run-harness.mjs --ids=1,2,3   # specific rows
//
// Concurrency is fixed at 4 in-flight prompts to stay inside OpenAI tpm limits.

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRecommendationJSON } from "../../api/emersus/workflow.js";
import { PROMPTS } from "./prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "runs");

function parseArgs() {
  const args = { limit: null, ids: null, concurrency: 4, out: null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--limit=")) args.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith("--ids=")) args.ids = a.slice(6).split(",").map((s) => parseInt(s, 10));
    else if (a.startsWith("--concurrency=")) args.concurrency = parseInt(a.slice(14), 10);
    else if (a.startsWith("--out=")) args.out = a.slice(6);
  }
  return args;
}

function dateStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function pickPrompts(args) {
  let list = PROMPTS;
  if (args.ids) list = list.filter((p) => args.ids.includes(p.id));
  if (args.limit) list = list.slice(0, args.limit);
  return list;
}

// Pull the 6 widget-v2 family names out of toolResults (ignoring other tools).
const WIDGET_TOOL_RE = /^emit_(pharma|training|nutrition|evidence|progress|calculator)_widget$/;

function extractWidget(toolResults) {
  for (const [name, payload] of Object.entries(toolResults || {})) {
    const m = WIDGET_TOOL_RE.exec(name);
    if (m) {
      return { tool: name, family: m[1], payload };
    }
  }
  // Legacy emit_widget fallback
  if (toolResults?.emit_widget) {
    return { tool: "emit_widget", family: "legacy", payload: toolResults.emit_widget };
  }
  return null;
}

function abbreviateSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 10).map((s) => ({
    title: s.title || null,
    journal: s.journal || null,
    publication_year: s.publication_year || null,
    excerpt: typeof s.excerpt === "string" ? s.excerpt.slice(0, 600) : null,
    pmid: s.pmid || null,
    doi: s.doi || null,
    is_title_only_match: s.is_title_only_match === true,
  }));
}

async function runOne(prompt) {
  const startedAt = Date.now();
  const threadId = randomUUID();
  const rawInput = {
    question: prompt.prompt,
    userId: `diagnose-${dateStamp()}`,
    tier: "pro",
    threadId,
    threadState: {},
    recentMessages: [],
    requestMeta: { source: "widget-diagnose-harness" },
    profile: {},
    featureFlags: {},
  };
  try {
    const out = await generateRecommendationJSON(rawInput);
    const widget = extractWidget(out.tool_results);
    return {
      id: prompt.id,
      family_expected: prompt.family,
      type_target: prompt.target,
      prompt: prompt.prompt,
      elapsed_ms: Date.now() - startedAt,
      // Emission
      tool_fired: widget?.tool || null,
      family_fired: widget?.family || null,
      type_fired: widget?.payload?.type || null,
      payload: widget?.payload || null,
      // Context to grade against
      answer_text: out.answer_text || null,
      sources: abbreviateSources(out.sources),
      confidence: out.confidence?.level || null,
      grounding: out.grounding || null,
      token_usage: out.token_usage || null,
      // Short-circuit and refusals come through as "guardrail.status"
      guardrail_status: out?.guardrail?.status || null,
      response_mode: out?.guardrail?.response_mode || null,
      error: null,
    };
  } catch (err) {
    return {
      id: prompt.id,
      family_expected: prompt.family,
      type_target: prompt.target,
      prompt: prompt.prompt,
      elapsed_ms: Date.now() - startedAt,
      error: err?.message || String(err),
    };
  }
}

async function runAll(prompts, concurrency, outPath) {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const fh = await fs.open(outPath, "w");
  const t0 = Date.now();
  let done = 0;
  const total = prompts.length;

  // Simple bounded-concurrency pump
  const queue = prompts.slice();
  const inflight = new Set();

  async function kick() {
    while (queue.length && inflight.size < concurrency) {
      const p = queue.shift();
      const task = (async () => {
        const r = await runOne(p);
        await fh.write(JSON.stringify(r) + "\n");
        done += 1;
        const markEmit = r.tool_fired ? (r.tool_fired.startsWith("emit_") ? "✔" : "·") : "∅";
        const familyMark = r.family_fired === r.family_expected ? "→" : "×";
        const typeMark = r.type_fired === r.type_target ? "=" : "?";
        console.log(
          `  ${String(done).padStart(3)}/${total}  ${markEmit} ${familyMark}${typeMark}  ` +
            `${String(r.family_expected).padEnd(11)} → ${String(r.family_fired || "prose").padEnd(11)}  ` +
            `${String(r.type_target).padEnd(30)} → ${String(r.type_fired || "-").padEnd(30)}  ` +
            `${(r.elapsed_ms / 1000).toFixed(1)}s  #${r.id}`
        );
      })();
      inflight.add(task);
      task.finally(() => inflight.delete(task));
    }
  }

  await kick();
  while (inflight.size > 0) {
    await Promise.race(inflight);
    await kick();
  }

  await fh.close();
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone. ${done}/${total} in ${wall}s → ${outPath}`);
}

async function main() {
  const args = parseArgs();
  const prompts = pickPrompts(args);
  if (prompts.length === 0) {
    console.error("No prompts matched filters."); process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY — source .env first.");
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — retrieval will fail.");
    process.exit(1);
  }

  const outPath = args.out || path.join(RUNS_DIR, `${dateStamp()}-n${prompts.length}.jsonl`);
  console.log(
    `Running ${prompts.length} prompts through real chat pipeline ` +
      `(concurrency=${args.concurrency}, model=${process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini"}).\n` +
      `Output → ${outPath}\n`
  );
  await runAll(prompts, args.concurrency, outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
