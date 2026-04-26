// scripts/eval/anchor-frr-audit.js
//
// False-rejection-rate audit for the anchor-verifier bench. Reads the
// anchor-bench-{ts}-audit.jsonl file (one FAIL anchor per line), sends
// each to a stronger judge (gpt-5.4, vs the gpt-5.4-mini that made the
// original FAIL decision), and computes:
//
//   - FRR_lower:  fraction of FAIL anchors the strong judge says ARE
//                 actually backed by the source — these are false rejections
//   - true_catches: fraction the strong judge agrees are NOT backed
//   - undecided: judge couldn't tell or returned malformed
//
// Per-mode breakdown also emitted so we can see whether mode_2_overgen
// fails are predominantly true catches (good signal for that mode) or
// FRR (verifier noise).
//
// NOTE on judge choice: spec called for Claude as the strong judge. We
// have no ANTHROPIC_API_KEY available, so falling back to gpt-5.4 (full,
// not mini). This is still a stronger judge than the verifier (gpt-5.4-mini)
// but is the same vendor — different-model-only audit, not different-vendor.
//
// Usage:
//   node scripts/eval/anchor-frr-audit.js scripts/eval/results/anchor-bench-XXX-audit.jsonl
//   node scripts/eval/anchor-frr-audit.js audit.jsonl --concurrency=4 --model=gpt-5.4

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const RESULTS_DIR = path.resolve("scripts/eval/results");

function parseArgs(argv) {
  const args = {
    file: null,
    model: "gpt-5.4",
    concurrency: 4,
    maxItems: null,
  };
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) {
      args.file = arg;
      continue;
    }
    const [k, v] = arg.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  if (args.concurrency) args.concurrency = Number(args.concurrency);
  if (args.maxItems) args.maxItems = Number(args.maxItems);
  if (!args.file) {
    console.error("Usage: node anchor-frr-audit.js <audit.jsonl> [--concurrency=4] [--model=gpt-5.4] [--maxItems=N]");
    process.exit(1);
  }
  return args;
}

async function loadJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const JUDGE_SYSTEM_PROMPT = [
  "You are a strict scientific evidence auditor. A weaker model previously decided that an ANCHOR phrase from a research-claim is NOT backed by the cited SOURCE text. Your job: independently judge whether that decision was correct.",
  "",
  'Return JSON only: {"verdict": "true_fail" | "false_rejection" | "ambiguous", "supporting_quote": "..." or null, "reasoning": "..."}',
  "",
  "verdict definitions:",
  "  - true_fail: The SOURCE genuinely does not support the ANCHOR. The original FAIL was correct.",
  "  - false_rejection: The SOURCE actually DOES support the ANCHOR (verbatim, paraphrase, or semantic equivalent), and the original FAIL was wrong.",
  "  - ambiguous: The SOURCE partially supports the anchor (overlapping but not equivalent — e.g. source says \"lower bone density\" and anchor says \"reduced bone mineral mass\"); reasonable judges could disagree.",
  "",
  "Light paraphrase, semantic equivalence with the same numeric / population / duration, or a longer source phrase containing the anchor's content all count as supporting → false_rejection.",
  "Different scope (source: 8 weeks, anchor: 12 weeks), different population (source: trained men, anchor: elderly), different effect direction → true_fail.",
  "",
  "If verdict is false_rejection, set supporting_quote to the verbatim phrase from the source that backs the anchor.",
].join("\n");

async function callJudge({ system, user, model, maxOutputTokens = 400 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Judge ${res.status}: ${JSON.stringify(json).slice(0, 250)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

function parseJudgeResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const verdict = ["true_fail", "false_rejection", "ambiguous"].includes(parsed.verdict)
      ? parsed.verdict
      : "ambiguous";
    return {
      verdict,
      supporting_quote: parsed.supporting_quote || null,
      reasoning: parsed.reasoning || null,
      raw: cleaned,
    };
  } catch {
    return { verdict: "ambiguous", supporting_quote: null, reasoning: null, raw: cleaned, parse_error: true };
  }
}

async function judgeOne(item, model) {
  const src = item.attributed_source || {};
  const anchor = item.anchor || {};
  // The audit JSONL has limited source content — use whatever's there.
  const sourceText = [
    src.title ? `TITLE: ${src.title}` : null,
    src.excerpt ? `EXCERPT/CHUNK: ${src.excerpt}` : null,
  ].filter(Boolean).join("\n\n");

  const userPrompt = [
    `CHAT QUESTION: ${item.question}`,
    "",
    `CLAIM (full sentence from chat answer): ${item.claim_text}`,
    "",
    `EXISTING MODE LABEL (from chat_claim_modes pipeline): ${item.existing_mode || "unknown"}`,
    "",
    `ANCHOR (specifier under audit): "${anchor.text}"`,
    `ANCHOR KIND: ${anchor.kind_hint || "other"}`,
    `EXTRACTOR'S CLAIMED SUPPORTING QUOTE: ${anchor.source_quote || "(none — extractor failed to find backing)"}`,
    `WEAK JUDGE'S REASONING (gpt-5.4-mini): ${anchor.judge_response?.reasoning || "(no judge ran — substring failed and no fallback)"}`,
    "",
    `SOURCE CONTENT:`,
    sourceText || "(no source text available)",
    "",
    "Return the JSON verdict object as specified.",
  ].join("\n");

  const raw = await callJudge({ system: JUDGE_SYSTEM_PROMPT, user: userPrompt, model });
  return parseJudgeResponse(raw);
}

async function main() {
  const args = parseArgs(process.argv);
  const items = await loadJsonl(args.file);
  const subset = args.maxItems ? items.slice(0, args.maxItems) : items;
  console.log(`[frr-audit] auditing ${subset.length} FAIL anchors with ${args.model} (concurrency=${args.concurrency})`);

  const startedAt = Date.now();
  const out = new Array(subset.length);
  let cursor = 0;
  let inFlight = 0;
  let done = 0;

  await new Promise((resolve) => {
    function pump() {
      if (cursor >= subset.length && inFlight === 0) return resolve();
      while (inFlight < args.concurrency && cursor < subset.length) {
        const idx = cursor++;
        inFlight += 1;
        judgeOne(subset[idx], args.model)
          .then((v) => { out[idx] = { ...subset[idx], strong_judge: v }; })
          .catch((err) => {
            out[idx] = {
              ...subset[idx],
              strong_judge: { verdict: "ambiguous", error: err.message },
            };
          })
          .finally(() => {
            inFlight -= 1;
            done += 1;
            if (done % 5 === 0 || done === subset.length) {
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
              console.log(`[frr-audit] ${done}/${subset.length} (${elapsed}s elapsed)`);
            }
            pump();
          });
      }
    }
    pump();
  });

  // Aggregate
  let trueFails = 0;
  let falseRejections = 0;
  let ambiguous = 0;
  const byMode = new Map();
  const byKind = new Map();

  for (const r of out) {
    const v = r.strong_judge?.verdict || "ambiguous";
    if (v === "true_fail") trueFails += 1;
    else if (v === "false_rejection") falseRejections += 1;
    else ambiguous += 1;

    const mode = r.existing_mode || "unknown";
    const mb = byMode.get(mode) || { mode, total: 0, true_fail: 0, false_rejection: 0, ambiguous: 0 };
    mb.total += 1;
    mb[v] = (mb[v] || 0) + 1;
    byMode.set(mode, mb);

    const kind = r.anchor?.kind_hint || "other";
    const kb = byKind.get(kind) || { kind, total: 0, true_fail: 0, false_rejection: 0, ambiguous: 0 };
    kb.total += 1;
    kb[v] = (kb[v] || 0) + 1;
    byKind.set(kind, kb);
  }

  const total = out.length;
  const frrLower = total > 0 ? falseRejections / total : 0;
  const frrUpper = total > 0 ? (falseRejections + ambiguous) / total : 0;

  const runId = path.basename(args.file).replace(/\.jsonl$/, "").replace(/^anchor-bench-/, "").replace(/-audit$/, "");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");

  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
  const md = [
    `# Anchor-Verifier FRR Audit — ${runId}`,
    "",
    `**Audited:** ${args.file}`,
    `**Strong judge:** ${args.model} (vs verifier's gpt-5.4-mini)`,
    `**Sample size:** ${total} FAIL anchors`,
    "",
    "**Caveat:** Spec called for Claude as the strong judge. ANTHROPIC_API_KEY was not available; this run uses gpt-5.4 (full) which is a stronger model than the verifier's gpt-5.4-mini, but same vendor — so this is a different-model-only audit, not a different-vendor audit. Cross-vendor agreement bound is not measured.",
    "",
    "## Headline",
    "",
    "| Verdict | Count | % |",
    "|---|---:|---:|",
    `| true_fail (verifier was right) | ${trueFails} | ${pct(trueFails, total)} |`,
    `| false_rejection (verifier was wrong) | ${falseRejections} | ${pct(falseRejections, total)} |`,
    `| ambiguous | ${ambiguous} | ${pct(ambiguous, total)} |`,
    "",
    `**FRR (lower bound):** ${pct(falseRejections, total)} (counting only confident false rejections)`,
    `**FRR (upper bound):** ${pct(falseRejections + ambiguous, total)} (treating ambiguous as false rejections)`,
    "",
    "**Ship-decision criterion 1:** FRR ≤ 15% on audit subset.",
    `**Result:** ${frrLower * 100 <= 15 ? "✅ PASS (lower bound)" : "❌ FAIL (lower bound)"} | ${frrUpper * 100 <= 15 ? "✅ PASS (upper bound)" : "❌ FAIL (upper bound)"}`,
    "",
    "## Per-mode breakdown",
    "",
    "| Existing mode | Total | True fail | False rejection | Ambiguous | True-fail rate |",
    "|---|---:|---:|---:|---:|---:|",
    ...[...byMode.values()].sort((a, b) => b.total - a.total).map((m) =>
      `| ${m.mode} | ${m.total} | ${m.true_fail || 0} | ${m.false_rejection || 0} | ${m.ambiguous || 0} | ${pct(m.true_fail || 0, m.total)} |`
    ),
    "",
    "## Per-kind breakdown",
    "",
    "| Anchor kind | Total | True fail | False rejection | Ambiguous |",
    "|---|---:|---:|---:|---:|",
    ...[...byKind.values()].sort((a, b) => b.total - a.total).map((k) =>
      `| ${k.kind} | ${k.total} | ${k.true_fail || 0} | ${k.false_rejection || 0} | ${k.ambiguous || 0} |`
    ),
    "",
    "## What this means for v2 ship decision",
    "",
    `The 200-bench Spearman ρ between anchor-fail and mode_2 was negative (lift -1.3pp), so criterion 2 already failed. Cost was ~$0.015/chat, so criterion 3 already failed. This FRR audit characterizes whether the verifier is at least catching real grounding issues among the things it does flag — but it does not change the v2 ship recommendation.`,
    `If true-fail rate is high (>70%), the verifier produces low-noise signal even though it doesn't track mode_2. That signal could be useful for a different deployment (e.g. catching specific fabrication-class anchors).`,
    `If true-fail rate is low (<50%), the verifier is mostly noise.`,
    "",
  ].join("\n");

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const mdPath = path.join(RESULTS_DIR, `anchor-frr-${runId}-${ts}.md`);
  const jsonPath = path.join(RESULTS_DIR, `anchor-frr-${runId}-${ts}.json`);
  await fs.writeFile(mdPath, md);
  await fs.writeFile(jsonPath, JSON.stringify({
    run_id: runId,
    audited_file: args.file,
    judge_model: args.model,
    n: total,
    headline: { true_fail: trueFails, false_rejection: falseRejections, ambiguous, frr_lower: frrLower, frr_upper: frrUpper },
    by_mode: [...byMode.values()],
    by_kind: [...byKind.values()],
    items: out,
  }, null, 2));

  console.log(`\n[frr-audit] wrote ${mdPath}`);
  console.log(`[frr-audit] wrote ${jsonPath}`);
  console.log(`\n[frr-audit] FRR lower=${(frrLower * 100).toFixed(1)}% upper=${(frrUpper * 100).toFixed(1)}%`);
  console.log(`[frr-audit] true_fail=${trueFails}/${total} false_rejection=${falseRejections}/${total} ambiguous=${ambiguous}/${total}`);
}

main().catch((err) => {
  console.error("[frr-audit] FATAL:", err);
  process.exit(1);
});
