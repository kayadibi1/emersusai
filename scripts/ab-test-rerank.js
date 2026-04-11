// A/B quality comparison between the old and new evidence ranking
// formulas. Not a real A/B in production (no user routing, no metrics
// harvesting), just a side-by-side retrieval-quality check on a
// representative set of fitness/nutrition questions.
//
//   OLD: freshness 0.35 + quality 0.35 + similarity 0.30
//   NEW: freshness 0.30 + quality 0.30 + similarity 0.25 + impact 0.15
//
// For each query we:
//   1. retrieveDatabaseEvidence() to get the raw candidate pool
//   2. map to the rerank-input shape (same as workflow.js does)
//   3. rank the SAME candidate pool with both formulas
//   4. print top-5 from each, plus a PMID-keyed rank-delta summary
//
// Usage:
//   node scripts/ab-test-rerank.js                    # runs all default queries
//   node scripts/ab-test-rerank.js --queries="creatine,protein"  # subset
//   node scripts/ab-test-rerank.js --top-n=10

import "dotenv/config";
import { retrieveDatabaseEvidence } from "../api/emersus/retrieveDatabaseEvidence.js";
import {
  scoreEvidenceFreshness,
  scoreEvidenceQuality,
  scoreEvidenceImpact,
  rankEvidence,
} from "../api/emersus/rerank.js";

const DEFAULT_QUERIES = [
  "does creatine cause hair loss",
  "how much protein per day for muscle growth",
  "caffeine and endurance performance",
  "is intermittent fasting effective for fat loss",
  "omega-3 supplementation benefits for athletes",
  "does vitamin D improve athletic performance",
  "effect of sleep deprivation on muscle recovery",
  "should I take BCAAs during resistance training",
];

const DEFAULT_TOP_N = 5;
const MATCH_COUNT = 20; // fetch a wider candidate pool so reranking has room

function parseArgs(argv) {
  const args = {
    queries: DEFAULT_QUERIES,
    topN: DEFAULT_TOP_N,
  };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--queries" && value) {
      args.queries = value.split(",").map((q) => q.trim()).filter(Boolean);
    } else if (key === "--top-n" && value) {
      args.topN = Number(value) || DEFAULT_TOP_N;
    }
  }
  return args;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Match normalizeVectorEvidenceRow's output shape as closely as we
// need for ranking. Keeps the A/B comparison honest by using the same
// fields the production pipeline would.
function shapeCandidate(row) {
  const pubTypes = Array.isArray(row.publication_types)
    ? row.publication_types
    : [];
  return {
    pmid: row.pmid,
    title: row.title,
    similarity: clamp(Number(row.similarity || 0), 0, 1),
    published_at: row.publication_date || row.publication_year || "",
    evidence_level: pubTypes.join(", "),
    source_type: "pubmed_vector",
    rcr: row.rcr ?? null,
    citation_count: row.citation_count ?? null,
  };
}

// Duplicates the previous (pre-impact) ranking formula so the A/B
// can compare against the real historical behavior, not against a
// reconstruction that might have drifted.
function rankEvidenceOld(evidence) {
  return [...evidence]
    .map((item) => {
      const f = scoreEvidenceFreshness(item.published_at);
      const q = scoreEvidenceQuality(item.evidence_level, item.source_type);
      const s = clamp(item.similarity ?? 0, 0, 1);
      return {
        ...item,
        freshness_score: Number(f.toFixed(2)),
        quality_score: Number(q.toFixed(2)),
        ranking_score: Number((f * 0.35 + q * 0.35 + s * 0.3).toFixed(3)),
      };
    })
    .sort((a, b) => b.ranking_score - a.ranking_score);
}

function padRight(str, n) {
  const s = String(str);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function formatRow(rank, item) {
  const title = (item.title || "(untitled)").slice(0, 55);
  const rcr = item.rcr == null ? "  —  " : item.rcr.toFixed(2).padStart(5);
  const impact =
    item.impact_score != null ? item.impact_score.toFixed(2) : "    ";
  return `  ${String(rank).padStart(2)}. pmid=${padRight(String(item.pmid), 9)} sim=${(item.similarity || 0).toFixed(3)} fresh=${(item.freshness_score || 0).toFixed(2)} qual=${(item.quality_score || 0).toFixed(2)} impact=${impact} rcr=${rcr} score=${(item.ranking_score || 0).toFixed(3)} | ${title}`;
}

function computeRankDeltas(oldRanked, newRanked) {
  const oldRank = new Map(oldRanked.map((item, i) => [item.pmid, i + 1]));
  const newRank = new Map(newRanked.map((item, i) => [item.pmid, i + 1]));
  const deltas = [];
  for (const [pmid, oldPos] of oldRank.entries()) {
    const newPos = newRank.get(pmid);
    if (newPos == null) continue;
    deltas.push({ pmid, old: oldPos, new: newPos, delta: oldPos - newPos });
  }
  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

async function runOne(query, topN) {
  console.log(`\n${"=".repeat(90)}`);
  console.log(`Q: "${query}"`);
  console.log("=".repeat(90));

  const raw = await retrieveDatabaseEvidence({
    prompt: query,
    matchThreshold: 0.4,
    matchCount: MATCH_COUNT,
  });
  if (!raw.length) {
    console.log("(no candidates returned)");
    return;
  }
  const candidates = raw.map(shapeCandidate);

  const oldRanked = rankEvidenceOld(candidates);
  const newRanked = rankEvidence(candidates);

  console.log(`Fetched ${candidates.length} candidates.\n`);

  console.log("OLD (freshness 0.35 + quality 0.35 + similarity 0.30):");
  for (let i = 0; i < Math.min(topN, oldRanked.length); i++) {
    console.log(formatRow(i + 1, oldRanked[i]));
  }

  console.log("\nNEW (freshness 0.30 + quality 0.30 + similarity 0.25 + impact 0.15):");
  for (let i = 0; i < Math.min(topN, newRanked.length); i++) {
    console.log(formatRow(i + 1, newRanked[i]));
  }

  const deltas = computeRankDeltas(oldRanked, newRanked);
  const moved = deltas.filter((d) => d.delta !== 0);
  console.log(
    `\nRank changes: ${moved.length}/${deltas.length} PMIDs moved`
  );
  if (moved.length > 0) {
    console.log("  (positive delta = promoted, negative = demoted)");
    for (const d of moved.slice(0, 10)) {
      const arrow = d.delta > 0 ? "↑" : "↓";
      console.log(
        `  pmid=${padRight(String(d.pmid), 9)} ${d.old.toString().padStart(2)} → ${d.new.toString().padStart(2)}  ${arrow}${Math.abs(d.delta)}`
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ab-rerank] running ${args.queries.length} query/queries, top-${args.topN}`
  );
  for (const query of args.queries) {
    try {
      await runOne(query, args.topN);
    } catch (err) {
      console.error(`\n[ab-rerank] FAILED query "${query}":`, err.message);
    }
  }
  console.log("\n[ab-rerank] done.");
}

main().catch((err) => {
  console.error("[ab-rerank] FATAL:", err);
  process.exit(1);
});
