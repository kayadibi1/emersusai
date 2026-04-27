// scripts/fulltext-enrichment/filter-stage1-regex.js
//
// Stage 1 of the chunk-noise filter pipeline. Deterministic streaming pass
// over a chunks-*.jsonl file. Drops chunks that match high-precision noise
// patterns; passes everything else through.
//
// Drop categories (validated against a 100K-chunk sample of phase2h-pmc-s3
// — see conversation 2026-04-26):
//   A. Section title's LAST PATH SEGMENT matches a deny term
//      (acknowledg / author contributions / funding / conflict / ethics /
//       consent / data availability / trial registration / disclosur).
//      Critically, only the deepest heading is matched — "Materials and
//      methods / Statistical analysis" stays, "Materials and methods /
//      Funding" drops only the funding sub-chunks.
//   B. Content STARTS WITH a high-precision boilerplate prefix
//      (the authors declare / we thank / this work was supported / written
//       informed consent was / the data are available...).
//   C. Length sanity (already enforced by chunker but double-check).
//   D. Citation-density runaway: chunk where >60% of words are inside
//      parens or are et-al patterns (reference-list bleed-through).
//
// Usage:
//   node scripts/fulltext-enrichment/filter-stage1-regex.js \
//     --input=data/chunks-phase2h-pmc-s3.jsonl \
//     --kept=data/chunks-phase2h-pmc-s3.stage1-kept.jsonl \
//     --dropped=data/chunks-phase2h-pmc-s3.stage1-dropped.jsonl
//
// The dropped JSONL is auditable — each line has the original chunk plus a
// `__drop_reason` field for inspection.
//
// IMPORTANT: this is not a standalone filter. It's the cheap-precision pass
// that sets up Stage 2 (statistical classifier) + Stage 3 (LLM grader).
// Catches ~1-2% on its own; the bulk of noise reduction happens in Stage 3.

import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";

const SECTION_TITLE_DENY_LAST_SEG = new RegExp(
  // Anchored: last path segment must START with one of these terms.
  "^(?:" + [
    "acknowledg",                  // acknowledgments / acknowledgements
    "author[\\s_-]?contribut",     // author contributions
    "author[\\s_-]?information",
    "fund(ing|er)?\\b",            // funding / funder
    "financial[\\s_-]?support",
    "sponsor",
    "conflict[\\s_-]?of[\\s_-]?interest",
    "competing[\\s_-]?interest",
    "declaration[\\s_-]?of[\\s_-]?(competing|financial)",
    "disclosur",                   // disclosure / disclosures
    "ethic(s|al)?[\\s_-]?(approval|statement|consideration|committee)?\\s*$",
    "ethic(s|al)?[\\s_-]?approval",
    "ethic(s|al)?[\\s_-]?statement",
    "institutional[\\s_-]?review",
    "irb[\\s_-]?approval",
    "approval[\\s_-]?and[\\s_-]?consent",
    "patient[\\s_-]?consent",
    "informed[\\s_-]?consent",
    "consent[\\s_-]?to[\\s_-]?participate",
    "consent[\\s_-]?for[\\s_-]?publication",
    "data[\\s_-]?availab",         // data availability / data available
    "data[\\s_-]?sharing",
    "data[\\s_-]?access",
    "data[\\s_-]?statement",
    "trial[\\s_-]?regist",         // trial registration / registry
    "clinical[\\s_-]?trial[\\s_-]?regist",
    "registration",                // when last segment IS just "registration"
    "supplementary[\\s_-]?material",
    "supporting[\\s_-]?information",
    "abbreviations?\\b",
    "list[\\s_-]?of[\\s_-]?abbreviations?",
    "footnotes?\\b",
    "highlights?\\b",
    "key[\\s_-]?points?\\b",       // (some journals; risky — see calibration)
  ].join("|") + ")",
  "i"
);

const CONTENT_PREFIX_DENY = [
  // Conflict declarations
  /^(?:the )?authors?\s+(declare|have\s+no|report\s+no|state\s+(that\s+)?(?:they|we))/i,
  /^no\s+(potential\s+)?conflicts?\s+of\s+interest/i,
  /^the\s+corresponding\s+author\s+has\s+nothing/i,
  /^all\s+authors\s+have\s+(nothing|no)\s+to\s+disclose/i,
  /^none\s+declared\.?\s*$/i,

  // Funding statements
  /^this\s+(study|work|research|trial|project|article|investigation)\s+(was|is)\s+(supported|funded|sponsored|partially\s+supported)\s+(by|in\s+part)/i,
  /^funded\s+by\b/i,
  /^funding\s+(was\s+provided|came|for\s+this\s+study|sources?)/i,
  /^the\s+present\s+study\s+was\s+(supported|funded)/i,
  /^this\s+research\s+(received|did\s+not\s+receive)/i,

  // Acknowledgments
  /^we\s+(thank|wish\s+to\s+thank|gratefully\s+(acknowledge|thank)|are\s+grateful|would\s+like\s+to\s+thank)/i,
  /^the\s+authors?\s+(thank|wish\s+to\s+thank|gratefully|would\s+like\s+to\s+thank|are\s+grateful)/i,

  // Consent
  /^(written\s+)?informed\s+consent\s+(was\s+(obtained|provided|given)|to)/i,
  /^all\s+participants\s+provided\s+(written\s+)?informed\s+consent/i,
  /^written\s+consent\s+was\s+(obtained|provided)/i,

  // Ethics — when chunk explicitly opens with approval boilerplate
  /^this\s+(study|trial|protocol|research)\s+(was\s+)?(approved\s+by|conducted\s+in\s+accordance\s+with|registered)/i,
  /^the\s+(study|protocol|trial|research)\s+(was|received)\s+approv/i,
  /^approval\s+(was|for\s+the\s+study\s+was)\s+(obtained|granted)/i,
  /^ethical\s+(approval|clearance)\s+(was\s+)?(obtained|granted)/i,

  // Author contribution prose ("AB and CD designed...")
  /^[A-Z]{2,4}(?:\.|,)?(?:\s*(?:,|and|&)\s*[A-Z]{2,4}\.?){1,8}\s+(designed|conceived|drafted|wrote|performed|analyzed|analysed|contributed|interpreted|conducted|reviewed)\b/,

  // Data availability
  /^the\s+(raw\s+|full\s+|corresponding\s+|underlying\s+)?data(\s+that\s+support)?\s+(will\s+be|are|is|that\s+support)/i,
  /^all\s+(the\s+)?data\s+(used|generated|underlying|presented|analyzed)/i,
  /^data\s+(are|is)\s+available/i,
  /^the\s+datasets?\s+(presented|generated|used|analyzed|that\s+support)/i,
  /^requests\s+for\s+data/i,

  // Trial registration prose
  /^this\s+(trial|study)\s+(was|is)\s+(registered|prospectively\s+registered)/i,
  /^registered\s+(at|in|with)\s+(ClinicalTrials|the\s+(German|Chinese|Japanese|Australian|Iranian))/i,
  /^prospectively\s+registered\s+(at|in|with)/i,
];

const MIN_CONTENT_CHARS = 100;
const MAX_CITATION_DENSITY = 0.6;  // >60% of words in parens or et-al = drop

function citationDensity(text) {
  // Heuristic: ratio of (paren-enclosed substrings + "et al." occurrences)
  // total chars vs total chars. Cheap & approximate.
  const total = text.length;
  if (!total) return 0;
  let parenChars = 0;
  for (const m of text.matchAll(/\(([^()]*)\)/g)) parenChars += m[0].length;
  const etAlMatches = (text.match(/\bet\s+al\.?/gi) || []).length;
  const etAlChars = etAlMatches * 8;
  return (parenChars + etAlChars) / total;
}

function lastSegment(sectionTitle) {
  if (!sectionTitle) return "";
  const parts = String(sectionTitle).split(/\s*\/\s*/);
  return parts[parts.length - 1].trim();
}

function dropReason(chunk) {
  const content = (chunk.content || "").trim();
  const sectionTitle = chunk.metadata?.section_title || "";
  const lastSeg = lastSegment(sectionTitle);

  if (content.length < MIN_CONTENT_CHARS) return "too_short";
  if (SECTION_TITLE_DENY_LAST_SEG.test(lastSeg)) return `section:${lastSeg.slice(0, 40)}`;
  for (const re of CONTENT_PREFIX_DENY) {
    if (re.test(content)) return "content_prefix";
  }
  if (citationDensity(content) > MAX_CITATION_DENSITY) return "high_citation_density";
  return null;
}

function parseArgs(argv) {
  const a = { input: null, kept: null, dropped: null };
  for (const raw of argv) {
    const [k, v] = raw.split("=");
    if (k === "--input") a.input = v;
    else if (k === "--kept") a.kept = v;
    else if (k === "--dropped") a.dropped = v;
  }
  if (!a.input || !a.kept || !a.dropped) {
    console.error("usage: --input=PATH --kept=PATH --dropped=PATH");
    process.exit(2);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[stage1] starting", args);

  fs.mkdirSync(path.dirname(args.kept), { recursive: true });
  fs.mkdirSync(path.dirname(args.dropped), { recursive: true });
  const keptOut = fs.createWriteStream(args.kept);
  const droppedOut = fs.createWriteStream(args.dropped);

  let total = 0, kept = 0, dropped = 0;
  const reasonCounts = new Map();

  const rl = readline.createInterface({
    input: fs.createReadStream(args.input),
    crlfDelay: Infinity,
  });

  const startedAt = Date.now();
  let lastLog = startedAt;

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    let chunk;
    try {
      chunk = JSON.parse(line);
    } catch {
      // Malformed line — count as drop with reason
      reasonCounts.set("parse_error", (reasonCounts.get("parse_error") || 0) + 1);
      dropped++;
      continue;
    }
    const reason = dropReason(chunk);
    if (reason) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      // De-bucket section: variants for cleaner reporting
      const bucket = reason.startsWith("section:") ? "section_title" : reason;
      reasonCounts.set(bucket, (reasonCounts.get(bucket) || 0) + 1);
      droppedOut.write(JSON.stringify({ ...chunk, __drop_reason: reason }) + "\n");
      dropped++;
    } else {
      keptOut.write(line + "\n");
      kept++;
    }
    const now = Date.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      const elapsed = Math.round((now - startedAt) / 1000);
      const rate = total / Math.max(elapsed, 1);
      console.log(
        `[stage1] progress total=${total} kept=${kept} dropped=${dropped} ` +
        `(${(100 * dropped / total).toFixed(2)}%) rate=${rate.toFixed(0)}/s elapsed=${elapsed}s`
      );
    }
  }

  await new Promise((r) => keptOut.end(r));
  await new Promise((r) => droppedOut.end(r));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[stage1] DONE total=${total} kept=${kept} dropped=${dropped} (${(100 * dropped / total).toFixed(2)}%) elapsed=${elapsed}s`);
  console.log("[stage1] drop reasons:");
  const sorted = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    console.log(`  ${reason.padEnd(40)} ${String(count).padStart(8)}  (${(100 * count / total).toFixed(2)}%)`);
  }
}

main().catch((err) => { console.error("[stage1] FAILED:", err); process.exit(1); });
