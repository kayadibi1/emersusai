// LLM-as-judge grader for the 100-prompt widget-v2 diagnostic.
//
// Reads a JSONL of harness rows → emits a CSV + a scored JSONL with five
// 0-3 rubrics plus a 1-sentence verdict per emission.
//
// Grading model: gpt-5.4 (not mini) — we need the judge to be more capable
// than the emitter. Structured output via Responses API text.format.
//
// Rubrics (0=worst / 3=best):
//   1. type_fit              — Is the chosen widget *type* the best fit for the user's intent?
//   2. data_groundedness     — Are payload numbers/citations grounded in retrieval or user-given values?
//   3. internal_consistency  — Do payload fields make sense together (totals, scales, dates)?
//   4. user_value            — Does the rendered widget answer the question the user asked?
//   5. visual_sufficiency    — Is there enough non-null data to produce a meaningful graphic?
//
// Usage:
//   node scripts/widget-diagnose/grade.mjs \
//     --in=scripts/widget-diagnose/runs/2026-04-24-n100.jsonl \
//     --out=scripts/widget-diagnose/grades/2026-04-24-scored.jsonl

import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";

const MODEL = "gpt-5.4"; // bigger than the emitter
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const SYSTEM = `You are grading widget emissions from an evidence-based fitness/nutrition chat.

The chat pipeline retrieves scientific sources, then the model either writes prose only or calls a structured widget tool (emit_<family>_widget) with a payload. Your job is to judge whether the widget — if one fired — makes sense given the user's prompt and the retrieved evidence.

You will rate FIVE dimensions 0–3:
  type_fit              — 0=wrong family · 1=right family wrong type · 2=right type but a sibling would be better · 3=best type for this intent
  data_groundedness     — 0=numbers/citations fabricated with no basis · 1=partially supported · 2=mostly grounded · 3=fully grounded in retrieval OR in user-supplied values
  internal_consistency  — 0=contradictions (totals don't add, scales wrong, dates out of order) · 1=minor issues · 2=mostly consistent · 3=fully consistent
  user_value            — 0=redirects or off-topic · 1=tangential · 2=mostly answers · 3=directly answers
  visual_sufficiency    — 0=not enough non-null data to render anything meaningful · 1=sparse · 2=adequate · 3=rich

Special cases:
 • If the user prompt clearly called for a widget but the model produced prose only, rate type_fit=0, visual_sufficiency=0, and judge user_value on the prose answer.
 • If the widget is clearly the right family but within-family type is a catch-all (e.g., study_matrix used when forest_plot or evidence_strength_card would be better), rate type_fit=1 or 2.
 • "Fabricated" means numbers not in the retrieved sources AND not supplied by the user. Plausible-sounding citations with null n/effect_size are ungrounded.
 • For calculator widgets, user-supplied parameters (kcal, protein_g, body weight) count as grounded even if the sources don't mention them.

Write a terse 1-sentence verdict describing the SINGLE most important quality issue (or "OK" if the emission is sound).`;

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type_fit:             { type: "integer", minimum: 0, maximum: 3 },
    data_groundedness:    { type: "integer", minimum: 0, maximum: 3 },
    internal_consistency: { type: "integer", minimum: 0, maximum: 3 },
    user_value:           { type: "integer", minimum: 0, maximum: 3 },
    visual_sufficiency:   { type: "integer", minimum: 0, maximum: 3 },
    verdict: { type: "string" },
    primary_failure: {
      type: "string",
      enum: ["none", "wrong_family", "wrong_type_in_family", "no_widget_when_needed", "null_padded_data", "fabricated_data", "inconsistent_data", "sparse_data", "off_topic", "validator_drop"],
    },
  },
  required: ["type_fit", "data_groundedness", "internal_consistency", "user_value", "visual_sufficiency", "verdict", "primary_failure"],
};

function summarizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "(no retrieved sources)";
  return sources.slice(0, 6).map((s, i) => {
    const cite = [s.title, s.journal, s.publication_year].filter(Boolean).join(" · ");
    const ex = (s.excerpt || "").slice(0, 240);
    return `  [${i + 1}] ${cite || "untitled"}${ex ? `\n      ${ex}` : ""}`;
  }).join("\n");
}

function formatPayload(p) {
  if (!p) return "(no widget fired)";
  const { type, summary, display_width, data, title, follow_up_chips } = p;
  const out = { type, title: title?.slice(0, 120) || null, summary: summary?.slice(0, 240) || null, display_width };
  if (data && typeof data === "object") {
    // Drop null fields to reduce noise in the prompt.
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)));
    out.data = filtered;
  }
  out.follow_up_chips = follow_up_chips || null;
  return JSON.stringify(out, null, 2).slice(0, 4000);
}

async function gradeOne(row) {
  const userMsg = `USER PROMPT:
${row.prompt}

EXPECTED family: ${row.family_expected}
EXPECTED type  : ${row.type_target}

FIRED family   : ${row.family_fired || "(none — widget did not fire)"}
FIRED type     : ${row.type_fired || "(none)"}

RETRIEVED SOURCES (top 6):
${summarizeSources(row.sources)}

ASSISTANT PROSE:
${(row.answer_text || "").slice(0, 1400)}

WIDGET PAYLOAD (nulls stripped):
${formatPayload(row.payload)}

Grade this emission on all five rubrics and pick the most important failure mode.`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "widget_grade",
          schema: GRADE_SCHEMA,
          strict: true,
        },
      },
      reasoning: { effort: "low" },
      max_output_tokens: 400,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${body?.error?.message || ""}` };
  }
  // Responses API: structured output lands under output[*].content[*].text (json string)
  // Find the first json text chunk.
  const out = body.output || [];
  let jsonText = null;
  for (const item of out) {
    const contents = item?.content || [];
    for (const c of contents) {
      if (c.type === "output_text" && c.text) { jsonText = c.text; break; }
    }
    if (jsonText) break;
  }
  if (!jsonText) return { error: "no_output" };
  try {
    return { grade: JSON.parse(jsonText) };
  } catch (e) {
    return { error: "parse: " + e.message, raw: jsonText.slice(0, 200) };
  }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=").map((x) => x.replace(/^--/, ""))));
  const inPath = args.in || "scripts/widget-diagnose/runs/2026-04-24-n100.jsonl";
  const outPath = args.out || "scripts/widget-diagnose/grades/2026-04-24-scored.jsonl";
  const csvPath = outPath.replace(/\.jsonl$/, ".csv");
  const concurrency = Number(args.concurrency || 6);

  const raw = await fs.readFile(inPath, "utf8");
  const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`Grading ${rows.length} emissions via ${MODEL} (concurrency=${concurrency}) …`);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const fh = await fs.open(outPath, "w");
  const t0 = Date.now();
  let done = 0;
  const queue = rows.slice();
  const inflight = new Set();
  const scored = new Array(rows.length);

  async function kick() {
    while (queue.length && inflight.size < concurrency) {
      const r = queue.shift();
      const idx = rows.indexOf(r);
      const task = (async () => {
        const g = await gradeOne(r);
        scored[idx] = { ...r, ...g };
        await fh.write(JSON.stringify(scored[idx]) + "\n");
        done += 1;
        if (g.grade) {
          const { type_fit, data_groundedness, internal_consistency, user_value, visual_sufficiency, primary_failure } = g.grade;
          const total = type_fit + data_groundedness + internal_consistency + user_value + visual_sufficiency;
          console.log(
            `  ${String(done).padStart(3)}/${rows.length}  #${String(r.id).padStart(3)}  [${type_fit}${data_groundedness}${internal_consistency}${user_value}${visual_sufficiency}]=${String(total).padStart(2)}  ${String(primary_failure).padEnd(24)}  ${(g.grade.verdict || "").slice(0, 80)}`
          );
        } else {
          console.log(`  ${String(done).padStart(3)}/${rows.length}  #${String(r.id).padStart(3)}  ERROR: ${g.error}`);
        }
      })();
      inflight.add(task);
      task.finally(() => inflight.delete(task));
    }
  }

  await kick();
  while (inflight.size > 0) { await Promise.race(inflight); await kick(); }
  await fh.close();

  // Write CSV (flat schema for spreadsheet-able review).
  const header = [
    "id","family_expected","type_target","family_fired","type_fired","tool_fired",
    "type_fit","data_groundedness","internal_consistency","user_value","visual_sufficiency",
    "total","primary_failure","verdict","prompt","elapsed_ms","confidence","grounding_status",
  ];
  const csv = [header.join(",")];
  for (const s of scored) {
    const g = s.grade || {};
    const total = g.type_fit != null ? g.type_fit + g.data_groundedness + g.internal_consistency + g.user_value + g.visual_sufficiency : "";
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
    csv.push([
      s.id, s.family_expected, s.type_target, s.family_fired || "", s.type_fired || "", s.tool_fired || "",
      g.type_fit ?? "", g.data_groundedness ?? "", g.internal_consistency ?? "", g.user_value ?? "", g.visual_sufficiency ?? "",
      total, g.primary_failure || "", q(g.verdict || ""), q(s.prompt), s.elapsed_ms, s.confidence || "",
      s.grounding?.status || "",
    ].join(","));
  }
  await fs.writeFile(csvPath, csv.join("\n"));

  // Summary
  const failCounts = {};
  let totals = [];
  for (const s of scored) {
    if (s.grade) {
      totals.push(s.grade.type_fit + s.grade.data_groundedness + s.grade.internal_consistency + s.grade.user_value + s.grade.visual_sufficiency);
      failCounts[s.grade.primary_failure] = (failCounts[s.grade.primary_failure] || 0) + 1;
    }
  }
  totals.sort((a,b)=>a-b);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone. ${done}/${rows.length} in ${wall}s → ${outPath}\n`);
  console.log("Primary-failure breakdown:");
  for (const [k, v] of Object.entries(failCounts).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${k.padEnd(25)} ${v}`);
  }
  const median = totals[Math.floor(totals.length / 2)] || 0;
  const p25 = totals[Math.floor(totals.length * 0.25)] || 0;
  const p75 = totals[Math.floor(totals.length * 0.75)] || 0;
  console.log(`\nTotal score distribution (out of 15): p25=${p25} median=${median} p75=${p75}`);
  console.log(`CSV: ${csvPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
