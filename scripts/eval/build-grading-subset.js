// scripts/eval/build-grading-subset.js
//
// Extracts a human-grading subset from an anchor-verifier-bench output JSON.
// Pulls every mode_3_fabrication and mode_4_contradicted claim (those are the
// scariest classes) plus a stratified random sample of mode_2_overgen, correct,
// and mode_1_misattribution for false-positive/precision measurement.
//
// Outputs:
//   - <basename>-grading.md   — human-readable, one item per section, with
//     LLM judge verdict + claim + cited sources inline so you can verify
//     without bouncing across files.
//   - <basename>-grading.csv  — id, mode, agree?, notes — fill in by hand.
//
// Usage:
//   node scripts/eval/build-grading-subset.js scripts/eval/results/anchor-bench-z2-live-200.json
//   node scripts/eval/build-grading-subset.js <input.json> --controls=10 --seed=42

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { file: null, controls: 10, seed: 42 };
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) { args.file = a; continue; }
    const [k, v] = a.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  if (args.controls) args.controls = Number(args.controls);
  if (args.seed) args.seed = Number(args.seed);
  if (!args.file) { console.error("Usage: build-grading-subset.js <bench.json> [--controls=10] [--seed=42]"); process.exit(1); }
  return args;
}

// Mulberry32 deterministic shuffle so the subset is reproducible.
function shuffle(arr, seed = 42) {
  let s = seed | 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function flattenClaims(verified) {
  const claims = [];
  for (const chat of verified.per_chat || []) {
    if (!chat.claims) continue;
    for (let i = 0; i < chat.claims.length; i += 1) {
      const c = chat.claims[i];
      if (!c.existing_mode) continue;
      claims.push({
        chat_question: chat.question,
        chat_sources: chat.sources || [],
        claim_idx: i,
        claim_text: c.claim_text,
        cited_ids: c.cited_ids || [],
        existing_mode: c.existing_mode,
        existing_qualifier_diff: c.existing_qualifier_diff,
      });
    }
  }
  return claims;
}

function formatSourceBlock(sources, citedIds) {
  if (!sources.length) return "_no sources retrieved_";
  return sources.map((s) => {
    const cited = citedIds.includes(s.index) ? " ◀ CITED" : "";
    const hdr = [s.publication_year, s.publication_type, s.journal].filter(Boolean).join(" · ");
    return [
      `**[${s.index}]${cited}** ${s.title || "(no title)"}`,
      hdr ? `_${hdr}_` : "",
      s.doi ? `DOI: \`${s.doi}\`` : null,
      "",
      `> ${(s.excerpt || "(no excerpt)").trim().split("\n").join(" ")}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function renderItemMd(item, idx) {
  const lines = [
    `## ${idx + 1}. [${item.existing_mode}] ${item.claim_text.slice(0, 90)}${item.claim_text.length > 90 ? "…" : ""}`,
    "",
    `**Grading id:** \`${item.id}\``,
    `**LLM judge verdict:** \`${item.existing_mode}\``,
    item.existing_qualifier_diff ? `**Qualifier diff:** ${JSON.stringify(item.existing_qualifier_diff)}` : null,
    "",
    `**Original chat question:** ${item.chat_question}`,
    "",
    `**Claim under audit:**`,
    "",
    `> ${item.claim_text}`,
    "",
    `**Cited source ids:** ${item.cited_ids.length ? item.cited_ids.join(", ") : "_(none — claim emitted without marker)_"}`,
    "",
    `**Retrieved sources:**`,
    "",
    formatSourceBlock(item.chat_sources, item.cited_ids),
    "",
    "**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous",
    "**Notes:**",
    "",
    "---",
    "",
  ].filter((l) => l !== null);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(await fs.readFile(args.file, "utf8"));
  const all = flattenClaims(data);
  console.log(`[grading] loaded ${all.length} claims from ${args.file}`);

  // Bucket by mode
  const buckets = {
    mode_3_fabrication: [],
    mode_4_contradicted: [],
    mode_1_misattribution: [],
    mode_2_overgen: [],
    correct: [],
  };
  for (const c of all) {
    if (buckets[c.existing_mode]) buckets[c.existing_mode].push(c);
  }

  // Selection: all mode_3 + all mode_4 + N random of each control class
  const selected = [];
  const N = args.controls;
  const sample = (arr, n, seed) => shuffle(arr, seed).slice(0, n);

  selected.push(...buckets.mode_3_fabrication.map((c) => ({ ...c, _bucket: "mode_3 (LLM-flagged fabrication — VERIFY THESE)" })));
  selected.push(...buckets.mode_4_contradicted.map((c) => ({ ...c, _bucket: "mode_4 (LLM-flagged contradicted — VERIFY THESE)" })));
  selected.push(...sample(buckets.mode_1_misattribution, Math.min(N, buckets.mode_1_misattribution.length), args.seed + 1).map((c) => ({ ...c, _bucket: "mode_1 control (LLM-flagged misattribution)" })));
  selected.push(...sample(buckets.mode_2_overgen, N, args.seed + 2).map((c) => ({ ...c, _bucket: "mode_2 control (LLM-flagged over-generalized)" })));
  selected.push(...sample(buckets.correct, N, args.seed + 3).map((c) => ({ ...c, _bucket: "correct control (LLM-flagged well-grounded)" })));

  // Stable id per item
  selected.forEach((it, i) => { it.id = `g${i + 1}`; });

  // Markdown
  const mdLines = [
    `# Grading subset — ${path.basename(args.file)}`,
    "",
    `Total claims in run: **${all.length}**`,
    "",
    "## Mode distribution (LLM-judged)",
    "",
    "| Mode | Count | In this grading subset |",
    "|---|---:|---:|",
    `| mode_3_fabrication | ${buckets.mode_3_fabrication.length} | ${selected.filter(s => s.existing_mode === "mode_3_fabrication").length} (all) |`,
    `| mode_4_contradicted | ${buckets.mode_4_contradicted.length} | ${selected.filter(s => s.existing_mode === "mode_4_contradicted").length} (all) |`,
    `| mode_1_misattribution | ${buckets.mode_1_misattribution.length} | ${selected.filter(s => s.existing_mode === "mode_1_misattribution").length} |`,
    `| mode_2_overgen | ${buckets.mode_2_overgen.length} | ${selected.filter(s => s.existing_mode === "mode_2_overgen").length} |`,
    `| correct | ${buckets.correct.length} | ${selected.filter(s => s.existing_mode === "correct").length} |`,
    "",
    "## How to grade each item",
    "",
    "For each claim below: read the cited source(s) and judge whether **the LLM's mode classification was correct**.",
    "",
    "- **mode_3 (fabrication)**: judge said NO retrieved source supports the claim. You agree if you also can't find support.",
    "- **mode_4 (contradicted)**: judge said a cited source CONTRADICTS the claim. You agree if you find direct contradiction.",
    "- **mode_2 (over-generalized)**: judge said cited source supports the gist but the claim drops qualifiers (population, dose, duration, study design). You agree if you spot the dropped qualifier.",
    "- **mode_1 (misattribution)**: judge said the cited source doesn't support but a different retrieved source does. You agree if a non-cited source has the support.",
    "- **correct**: judge said cited source fully supports with same scope. You agree if the source clearly states the claim.",
    "",
    "**Mark `[x]` next to one verdict** under each item. Add notes if it's ambiguous or you want to flag judge errors.",
    "",
    "---",
    "",
    ...selected.map((it, i) => {
      const sectionHdr = i === 0 || selected[i - 1]._bucket !== it._bucket
        ? `# ${it._bucket}\n\n`
        : "";
      return sectionHdr + renderItemMd(it, i);
    }),
  ];

  // CSV with one row per item
  const csvHeader = "id,mode,verdict,notes\n";
  const csvRows = selected.map((it) =>
    `${it.id},${it.existing_mode},,`
  ).join("\n");

  const inputDir = path.dirname(args.file);
  const baseName = path.basename(args.file, ".json");
  const mdPath = path.join(inputDir, `${baseName}-grading.md`);
  const csvPath = path.join(inputDir, `${baseName}-grading.csv`);
  await fs.writeFile(mdPath, mdLines.join("\n"));
  await fs.writeFile(csvPath, csvHeader + csvRows + "\n");

  console.log(`[grading] wrote ${selected.length} items for grading:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${csvPath}`);
  console.log(`\n  mode_3 (verify all):       ${buckets.mode_3_fabrication.length}`);
  console.log(`  mode_4 (verify all):       ${buckets.mode_4_contradicted.length}`);
  console.log(`  mode_1 controls:           ${selected.filter(s => s.existing_mode === "mode_1_misattribution").length}`);
  console.log(`  mode_2 controls (random):  ${selected.filter(s => s.existing_mode === "mode_2_overgen").length}`);
  console.log(`  correct controls (random): ${selected.filter(s => s.existing_mode === "correct").length}`);
}

main().catch((err) => { console.error("[grading] FATAL:", err); process.exit(1); });
