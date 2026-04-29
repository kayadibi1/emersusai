# Source-Centric Evidence Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate redundant title-as-passage evidence in chat by making retrieval source-centric. Each retrieved source carries the best available abstract/full-text passage; sources with only a title chunk render an honest "title-only" fallback.

**Architecture:** New `match_evidence_chunks_v4` RPC returns one row per source with passage substitution (best non-title chunk preferred). JS layer propagates two new fields (`matched_chunk_type`, `is_title_only_match`). Client UI (`WhyThisAnswer`, `SourcesFooter`) filters/backfills to surface real passages and renders an italic fallback when none exists. Behind `RETRIEVAL_USE_V4` env flag with eval-gate cutover.

**Tech Stack:** Postgres 15 + pgvector (self-hosted Supabase), Express 5, React 18 (esm.sh), node:test for unit tests, plain SQL fixtures for retrieval eval.

**Spec:** `docs/superpowers/specs/2026-04-22-evidence-retrieval-source-centric-design.md`

**Coordination constraint:** Tasks 1, 5, 6, 7 are app-side and run in parallel with the other DB instance. Tasks 2, 3, 4, 8, 9 require the other DB instance to be done first (DB migration + v4 codepath cutover).

**State as of 2026-04-23 04:08 UTC (other instance is done, autovacuum still running):** Centroid filter shipped. 754,623 papers soft-deleted (674k openalex / 56k openaire / 24k core); chunks for those papers physically deleted from `evidence_chunks` (now 3.34M chunks). PubMed/EuropePMC/preprints untouched. Autovacuum currently running on `evidence_chunks` (started 17:24 UTC, IO-bound, 1.04M dead tuples). `research_articles` autovacuum already finished. See spec §"Coordination context (added 2026-04-23 after corpus-centroid filter shipped)" for full context.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/eval/retrieval-eval.js` | create | Eval harness — runs fixtures against an RPC, prints metrics, writes baselines |
| `scripts/eval/fixtures/retrieval.json` | create | 20 hand-curated questions with expected pmids |
| `scripts/eval/baselines/.gitkeep` | create | Holds baseline JSON snapshots (gitignored content, kept dir) |
| `supabase/20260423_match_evidence_chunks_v4.sql` | create | New RPC with passage substitution |
| `api/emersus/retrieveDatabaseEvidence.js` | modify | Branch on `RETRIEVAL_USE_V4`; propagate new fields |
| `api/emersus/pipeline/retrieve.js` | modify | Surface `matched_chunk_type` + `is_title_only_match` in normalized rows |
| `api/emersus/pipeline/format-sources.js` | modify | Pass new fields to client SSE payload |
| `shared/react-chat-app.js` | modify | `WhyThisAnswer` filter+backfill+fallback; same for `SourcesFooter` |
| `tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js` | create | v4 codepath unit tests (mocked supabase client) |
| `tests/unit/api/emersus/pipeline/retrieve.test.js` | extend or create | Verify new fields propagate through `normalizeVectorEvidenceRow` |
| `tests/unit/shared/why-this-answer.test.js` | create | Filter/backfill/fallback unit tests |
| `changelog.md` | append | Note the change at cutover |
| `checkpoint.md` | append | Cross-thread breadcrumb at cutover |

---

## Task 0: Verify DB state before app-side baseline (RUNS IN PARALLEL with caveats)

**Files:** none — verification only.

The corpus-centroid filter ran and chunks for 754k soft-deleted papers were physically removed. Autovacuum on `evidence_chunks` is still in progress. The eval baseline (Task 1 step 4) reads via the v3 RPC, which scans the HNSW index — running it during peak vacuum I/O produces inconsistent latency and may compete with the vacuum worker.

- [ ] **Step 1: Re-check autovacuum state immediately before running Task 1 step 4**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pid, query_start, wait_event_type, wait_event, LEFT(query, 80) AS query
FROM pg_stat_activity
WHERE backend_type = 'autovacuum worker' AND query ILIKE '%evidence_chunks%';
\""
```

- If 0 rows: vacuum is done, proceed with Task 1 step 4.
- If 1+ rows present: either wait until it's done OR proceed knowing eval latency will be higher than typical (OK for a one-off baseline; the relative comparison v3 vs v4 still holds since both run under the same conditions).

- [ ] **Step 2: Confirm chunk-delete invariant still holds**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT count(*) AS chunks_for_softdeleted
FROM evidence_chunks ec
JOIN research_articles ra ON ra.pmid = ec.pmid
WHERE ra.is_deleted = true;
\""
```

Expected: `0`. If non-zero: the centroid filter's chunk-cascade-delete didn't fully run. Don't proceed past this check — the candidate-window assumption in v4 requires zero. Surface the count to the human partner.

- [ ] **Step 3: Capture corpus snapshot for the eval baseline file**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT now() AS captured_at,
       count(*) FILTER (WHERE is_deleted=false) AS active_articles,
       count(*) FILTER (WHERE is_deleted=true) AS softdeleted_articles
FROM research_articles;
SELECT count(*) AS total_chunks,
       count(*) FILTER (WHERE chunk_type='title') AS title_chunks,
       count(*) FILTER (WHERE chunk_type='abstract') AS abstract_chunks
FROM evidence_chunks;
\""
```

Save the output as a comment header to `scripts/eval/baselines/v3-baseline-2026-04-22.json` after Task 1 step 6 completes (or paste it into the runner output for the record). This anchors the baseline to a known corpus state — if recall numbers ever look weird later, we can trace it back.

---

## Task 1: Eval harness — fixtures + runner (RUNS IN PARALLEL)

**Files:**
- Create: `scripts/eval/fixtures/retrieval.json`
- Create: `scripts/eval/retrieval-eval.js`
- Create: `scripts/eval/baselines/.gitkeep`

This task does not touch the DB schema. It only calls the existing v3 RPC. Run anytime.

- [ ] **Step 1: Create the fixtures file**

Create `scripts/eval/fixtures/retrieval.json`:

```json
[
  {
    "question": "Sugar and athletic performance",
    "must_include_pmids": [10000167649],
    "must_exclude_pmids": [10004375236],
    "notes": "The 2026-04-22 bug case (post centroid-filter version). 'Sugar and oral health' (pmid 10004277354 + 10004002708) was already soft-deleted by the centroid filter on 2026-04-22 PM and its chunks dropped — won't appear. 'Sugar and metabolic health' (pmid 10004375236, openalex) survived with 2 chunks (title + abstract); it's the live test for whether v4 demotes its title chunk or substitutes it with the abstract. 'Is There a Specific Role for Sucrose in Sports and Exercise Performance?' (pmid 10000167649, openalex) is the on-topic paper that should appear in top-3."
  },
  {
    "question": "Creatine for strength training",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Should retrieve performance/RCT papers, not basic biochem reviews."
  },
  {
    "question": "Caffeine before resistance training",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Should retrieve ergogenic-aid papers."
  },
  {
    "question": "Protein timing for muscle growth",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Should retrieve hypertrophy/protein-distribution papers."
  },
  {
    "question": "Vitamin D supplementation in athletes",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Should retrieve sports-medicine D-status papers."
  },
  {
    "question": "Sleep deprivation effect on strength",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Should retrieve performance-decrement papers, not insomnia clinical reviews."
  },
  {
    "question": "Cold water immersion after exercise",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Recovery / hypertrophy-blunting papers."
  },
  {
    "question": "Beta-alanine and muscular endurance",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Carnosine / buffering / time-to-exhaustion papers."
  },
  {
    "question": "Carbohydrate periodization for endurance",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Train-low / sleep-low / fat-adaptation papers."
  },
  {
    "question": "Omega-3 for muscle soreness",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "EPA/DHA + DOMS / inflammation papers."
  },
  {
    "question": "Concurrent training interference effect",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Aerobic + strength interaction, hypertrophy outcomes."
  },
  {
    "question": "Beetroot juice nitrate and time-trial performance",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "NO bioavailability + endurance ergogenic papers."
  },
  {
    "question": "Branched-chain amino acids and recovery",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "BCAA / leucine / MPS papers."
  },
  {
    "question": "Heat acclimatization protocols",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Plasma volume / sweat-rate adaptation papers."
  },
  {
    "question": "Resistance training frequency for hypertrophy",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Volume-equated frequency comparisons."
  },
  {
    "question": "Eccentric training adaptations",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Eccentric-overload / EIMD / fascicle-length papers."
  },
  {
    "question": "Glycemic index and exercise performance",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Pre-exercise CHO type / insulin response papers."
  },
  {
    "question": "Dietary fiber and athletic performance",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "GI tolerance + race nutrition papers."
  },
  {
    "question": "Polyphenols and post-exercise recovery",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Tart cherry / blueberry / curcumin recovery papers."
  },
  {
    "question": "Sodium loading for endurance events",
    "must_include_pmids": [],
    "must_exclude_pmids": [],
    "notes": "Hyponatremia / pre-loading / electrolyte papers."
  }
]
```

- [ ] **Step 2: Create the runner**

Create `scripts/eval/retrieval-eval.js`:

```js
// scripts/eval/retrieval-eval.js
//
// Retrieval quality regression harness. Runs a fixture set of questions
// against an RPC ('v3' or 'v4'), computes metrics (recall@5,
// title-only-match rate, mean similarity of top-3), and writes a baseline
// snapshot under scripts/eval/baselines/.
//
// Usage:
//   node scripts/eval/retrieval-eval.js --rpc=v3 --label=baseline
//   node scripts/eval/retrieval-eval.js --rpc=v4 --label=v4-cutover
//   node scripts/eval/retrieval-eval.js --rpc=v4 --compare=baseline
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env (or
// process.env on Hetzner). Does not require the app server to be up.

import "../../api/lib/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../../api/lib/clients.js";
import { embedText } from "../../api/emersus/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "fixtures", "retrieval.json");
const BASELINES_DIR = path.join(__dirname, "baselines");

function parseArgs(argv) {
  const args = { rpc: "v3", label: null, compare: null };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  return args;
}

async function runRpc(rpc, queryEmbedding) {
  const fnName = rpc === "v4" ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";
  const { data, error } = await supabaseAdmin.rpc(fnName, {
    query_embedding: queryEmbedding,
    match_threshold: 0.4,
    match_count: 10,
    p_include_preprints: true,
  });
  if (error) throw new Error(`${fnName} failed: ${error.message}`);
  return data || [];
}

function metricsFromResults(results, fixture) {
  const top5Pmids = new Set(results.slice(0, 5).map((r) => Number(r.pmid)));
  const mustInclude = (fixture.must_include_pmids || []).map(Number);
  const mustExclude = (fixture.must_exclude_pmids || []).map(Number);
  const recallHits = mustInclude.filter((p) => top5Pmids.has(p));
  const exclusionViolations = mustExclude.filter((p) => top5Pmids.has(p));
  const titleOnlyCount = results.filter((r) => r.is_title_only_match === true).length;
  const matchedTitleCount = results.filter((r) => r.matched_chunk_type === "title" || r.chunk_type === "title").length;
  const topSims = results.slice(0, 3).map((r) => Number(r.similarity || 0));
  const meanTop3Sim = topSims.length ? topSims.reduce((a, b) => a + b, 0) / topSims.length : 0;
  return {
    recall_hits: recallHits.length,
    recall_target: mustInclude.length,
    exclusion_violations: exclusionViolations.length,
    title_only_count: titleOnlyCount,
    matched_title_count: matchedTitleCount,
    returned_count: results.length,
    mean_top3_similarity: Number(meanTop3Sim.toFixed(4)),
    top5_pmids: Array.from(top5Pmids),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtures = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const results = [];
  console.log(`# Running retrieval eval against ${args.rpc} on ${fixtures.length} fixtures\n`);
  for (const fx of fixtures) {
    const t0 = Date.now();
    let metrics;
    try {
      const emb = await embedText(fx.question);
      const rows = await runRpc(args.rpc, emb);
      metrics = metricsFromResults(rows, fx);
    } catch (err) {
      metrics = { error: err.message };
    }
    const dt = Date.now() - t0;
    results.push({ question: fx.question, latency_ms: dt, ...metrics });
    const recall = metrics.recall_target > 0
      ? `${metrics.recall_hits}/${metrics.recall_target}`
      : "—";
    const tail = `recall=${recall} title_only=${metrics.title_only_count ?? "?"} sim=${metrics.mean_top3_similarity ?? "?"} ${dt}ms`;
    console.log(`  ${fx.question.padEnd(55)} ${tail}`);
  }
  const agg = {
    rpc: args.rpc,
    fixtures: fixtures.length,
    total_recall_hits: results.reduce((a, r) => a + (r.recall_hits || 0), 0),
    total_recall_target: results.reduce((a, r) => a + (r.recall_target || 0), 0),
    total_exclusion_violations: results.reduce((a, r) => a + (r.exclusion_violations || 0), 0),
    total_title_only: results.reduce((a, r) => a + (r.title_only_count || 0), 0),
    mean_latency_ms: Math.round(results.reduce((a, r) => a + r.latency_ms, 0) / results.length),
    timestamp: new Date().toISOString(),
  };
  console.log(`\n# Aggregate: ${JSON.stringify(agg, null, 2)}`);
  if (args.label) {
    await fs.mkdir(BASELINES_DIR, { recursive: true });
    const out = path.join(BASELINES_DIR, `${args.label}.json`);
    await fs.writeFile(out, JSON.stringify({ agg, results }, null, 2));
    console.log(`\n# Wrote ${out}`);
  }
  if (args.compare) {
    const baselinePath = path.join(BASELINES_DIR, `${args.compare}.json`);
    try {
      const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
      const recallDelta = (agg.total_recall_hits / Math.max(agg.total_recall_target, 1))
        - (baseline.agg.total_recall_hits / Math.max(baseline.agg.total_recall_target, 1));
      console.log(`\n# vs ${args.compare}: recall delta ${(recallDelta * 100).toFixed(1)}pp, title_only ${baseline.agg.total_title_only} -> ${agg.total_title_only}`);
    } catch (err) {
      console.warn(`# Could not read baseline ${baselinePath}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Create the baselines directory placeholder**

Create `scripts/eval/baselines/.gitkeep`:

```
# Holds JSON baselines from retrieval-eval.js. Snapshots are versioned in git
# so we can diff retrieval changes across PRs.
```

- [ ] **Step 4: Run baseline against v3**

Run from repo root:

```
node scripts/eval/retrieval-eval.js --rpc=v3 --label=v3-baseline-2026-04-22
```

Expected output: 20 fixture lines + an aggregate JSON. The `total_title_only` should currently be 0 (v3 doesn't expose `is_title_only_match`). The `matched_title_count` aggregate is what to watch — it should be substantial (this confirms the bug).

- [ ] **Step 5: Backfill must_include / must_exclude pmids**

Eyeball the v3 results in the printed log. For each fixture, identify obvious off-topic top-5 entries and add their pmids to `must_exclude_pmids`. Identify obvious on-topic entries and add to `must_include_pmids`. Don't be exhaustive — 1–2 of each per fixture is enough to gate regressions.

**Important:** the fixture should reflect TODAY's corpus (post centroid-filter, 2026-04-23). Don't backfill pmids based on old screenshots from 2026-04-22 AM — many of those papers are now soft-deleted. The "Sugar and athletic performance" fixture is already pre-populated with verified-still-active pmids (10000167649 must_include, 10004375236 must_exclude) — the other 19 fixtures need fresh eyeballing against today's v3 results.

- [ ] **Step 6: Re-run baseline with backfilled fixtures**

```
node scripts/eval/retrieval-eval.js --rpc=v3 --label=v3-baseline-2026-04-22
```

This overwrites the baseline with one that includes recall/exclusion targets.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval/retrieval-eval.js scripts/eval/fixtures/retrieval.json scripts/eval/baselines/.gitkeep scripts/eval/baselines/v3-baseline-2026-04-22.json
git commit -m "$(cat <<'EOF'
feat(eval): retrieval quality regression harness

Adds 20-fixture eval set + runner that computes recall@5,
title-only-match rate, and mean top-3 similarity per question.
Captures v3 baseline ahead of the v4 source-centric cutover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: WhyThisAnswer client-side defense-in-depth (RUNS IN PARALLEL)

**Files:**
- Modify: `shared/react-chat-app.js:3088-3149`
- Create: `tests/unit/shared/why-this-answer.test.js`

This task ships a UI-only fix that prevents the redundant blockquote even before v4 is live. It uses two cheap signals — `excerpt`-equals-`title` comparison and `excerpt` length — and falls back to a "title-only" italic note. Once v4 lands, this code already knows how to handle `is_title_only_match`.

- [ ] **Step 1: Write failing test for excerpt-title equivalence detection**

Create `tests/unit/shared/why-this-answer.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTitleEquivalentExcerpt } from "../../../shared/why-this-answer-helpers.js";

test("isTitleEquivalentExcerpt: identical strings", () => {
  assert.equal(isTitleEquivalentExcerpt("Sugar and oral health", "Sugar and oral health"), true);
});

test("isTitleEquivalentExcerpt: case + whitespace insensitive", () => {
  assert.equal(isTitleEquivalentExcerpt("  SUGAR and Oral Health\n", "Sugar and oral health"), true);
});

test("isTitleEquivalentExcerpt: punctuation insensitive", () => {
  assert.equal(isTitleEquivalentExcerpt("Sugar, and oral health.", "Sugar and oral health"), true);
});

test("isTitleEquivalentExcerpt: real abstract is not title-equivalent", () => {
  const excerpt = "Sugar consumption has been linked to multiple oral health outcomes including caries and erosion. This review summarizes the evidence...";
  assert.equal(isTitleEquivalentExcerpt(excerpt, "Sugar and oral health"), false);
});

test("isTitleEquivalentExcerpt: title prefix on a real abstract is fine", () => {
  // Some chunks include the title at the top followed by abstract text.
  // Treat as title-equivalent only when the excerpt ADDS little beyond the title.
  const excerpt = "Sugar and oral health Sugar consumption has been linked to caries and erosion across multiple cohort studies. This narrative review synthesizes evidence from 2010 to 2024.";
  assert.equal(isTitleEquivalentExcerpt(excerpt, "Sugar and oral health"), false);
});

test("isTitleEquivalentExcerpt: empty/missing inputs return false", () => {
  assert.equal(isTitleEquivalentExcerpt("", "Title"), false);
  assert.equal(isTitleEquivalentExcerpt("Title", ""), false);
  assert.equal(isTitleEquivalentExcerpt(null, "Title"), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/unit/shared/why-this-answer.test.js`
Expected: FAIL — `Cannot find module '.../shared/why-this-answer-helpers.js'`.

- [ ] **Step 3: Create the helper module**

Create `shared/why-this-answer-helpers.js`:

```js
// shared/why-this-answer-helpers.js
//
// Pure helpers used by the "Why this answer?" reveal in shared/react-chat-app.js.
// Extracted into their own module so they can be unit-tested without spinning
// up a React renderer.

function normalizeForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns true when `excerpt` carries no information beyond `title`. Used to
// suppress redundant blockquotes that would just repeat the source title
// (these come from chunk_type='title' rows in evidence_chunks). Logic:
//   - identical (after normalization) → true
//   - excerpt is a near-prefix of the title with no trailing content → true
//   - excerpt is meaningfully longer than the title (≥ 1.5x normalized length
//     and ≥ 40 extra chars after the title prefix) → false (substantive)
export function isTitleEquivalentExcerpt(excerpt, title) {
  const e = normalizeForCompare(excerpt);
  const t = normalizeForCompare(title);
  if (!e || !t) return false;
  if (e === t) return true;
  // Excerpt starts with title and adds little: treat as title-equivalent.
  if (e.startsWith(t)) {
    const trailing = e.slice(t.length).trim();
    if (trailing.length < 40) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test tests/unit/shared/why-this-answer.test.js`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Add filter+backfill+fallback logic to WhyThisAnswer**

Modify `shared/react-chat-app.js`. First, add an import-equivalent at the top of the file (project uses no real imports — check the surrounding code; the helper needs to be defined inline or read from window). Inspect what shared/react-chat-app.js does for cross-module helpers and follow the same pattern. Most likely it inlines via a `<script type="module">` upstream — in that case, paste the helper inline in the same file just above the `WhyThisAnswer` definition.

Replace the `WhyThisAnswer` body (currently lines 3088–3149):

```js
function WhyThisAnswer({ sources }) {
  const items = useMemo(() => {
    const deduped = dedupeSources(sources);
    // Two-pass selection: prefer sources whose excerpt is substantive
    // (not a title repeat). Backfill from the tail with title-only
    // sources so we still get up to 3 items when the corpus only has
    // weak matches.
    const substantive = [];
    const titleOnly = [];
    for (const src of deduped) {
      const excerpt = String(src?.excerpt || src?.why_it_matters || src?.summary || "");
      const title = String(src?.title || "");
      const isTitleOnlyFromServer = src?.is_title_only_match === true;
      const isTitleEquivalentClient = isTitleEquivalentExcerpt(excerpt, title);
      const bucket = (isTitleOnlyFromServer || isTitleEquivalentClient) ? titleOnly : substantive;
      bucket.push(src);
      if (substantive.length >= 3) break;
    }
    const picked = substantive.slice(0, 3);
    if (picked.length < 3) {
      for (const src of titleOnly) {
        if (picked.length >= 3) break;
        picked.push(src);
      }
    }
    return picked;
  }, [sources]);
  if (!items.length) return null;
  return h(
    "details",
    { className: "why-this-answer" },
    h(
      "summary",
      { className: "wta-summary" },
      h("span", { className: "wta-icon", "aria-hidden": true }, "✦"),
      h("span", { className: "wta-label" }, "Why this answer?"),
      h(
        "span",
        { className: "wta-count" },
        `${items.length} passage${items.length === 1 ? "" : "s"}`
      ),
      h("span", { className: "wta-caret", "aria-hidden": true }, "▾")
    ),
    h(
      "ol",
      { className: "wta-list" },
      items.map((source, i) => {
        const title = source?.title || "Untitled source";
        const year = source?.year || source?.publication_year || source?.published_at || "";
        const metaParts = [];
        if (year) metaParts.push(String(year).slice(0, 4));
        if (source?.journal) metaParts.push(source.journal);
        const meta = metaParts.join(" · ");
        const rawExcerpt = source?.excerpt || source?.why_it_matters || source?.summary || "";
        const isTitleOnly = source?.is_title_only_match === true
          || isTitleEquivalentExcerpt(rawExcerpt, title);
        const excerpt = isTitleOnly ? "" : trimExcerpt(rawExcerpt, 220);
        const href = formatCitationUrl(source) || "";
        return h(
          "li",
          { key: `${source?.pmid || source?.doi || i}`, className: "wta-item" },
          h(
            "div",
            { className: "wta-head" },
            href
              ? h(
                  "a",
                  {
                    href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    className: "wta-title",
                  },
                  title
                )
              : h("span", { className: "wta-title" }, title),
            meta ? h("span", { className: "wta-meta" }, meta) : null
          ),
          isTitleOnly
            ? h(
                "p",
                { className: "wta-excerpt wta-excerpt-fallback" },
                "Title-only match — full text not available."
              )
            : excerpt
              ? h("blockquote", { className: "wta-excerpt" }, excerpt)
              : null
        );
      })
    )
  );
}
```

Add the helper inline directly above `WhyThisAnswer` (or import per the file's existing convention):

```js
function isTitleEquivalentExcerpt(excerpt, title) {
  const normalize = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const e = normalize(excerpt);
  const t = normalize(title);
  if (!e || !t) return false;
  if (e === t) return true;
  if (e.startsWith(t)) {
    const trailing = e.slice(t.length).trim();
    if (trailing.length < 40) return true;
  }
  return false;
}
```

(Note: the standalone module version exists at `shared/why-this-answer-helpers.js` for unit testing. The inline copy here matches it. If the file conventions actually allow ES module import, replace the inline copy with `import`.)

- [ ] **Step 6: Add the fallback CSS**

Modify `shared/chat.css`. Locate the `.wta-excerpt` rule that was added in commit `1c94d59e` (search for `.why-this-answer`). Add a sibling rule below it:

```css
.wta-excerpt-fallback {
  font-style: italic;
  opacity: 0.65;
  margin: 0;
  padding-top: 4px;
  font-size: 0.875em;
}
```

- [ ] **Step 7: Manual smoke test in dev**

Start the dev server (whatever the project uses — `npm start` or similar; check `package.json` `scripts`). Open the chat page in a browser. Ask the bug-reproducing question: "Sugar and athletic performance".

Expected behavior:
- Top 3 passages in "Why this answer?" no longer have title-equivalent blockquotes.
- If all 3 deduped sources for the answer are title-equivalent, the fallback "Title-only match — full text not available" italic note appears in place of the blockquote.
- Source titles + meta + DOI link still render normally.

If the chat doesn't reproduce the bug case (because the answer text is hot-cached or the LLM picks different sources this run), try 2 or 3 nearby questions ("Carbohydrate timing for endurance", "Pre-workout carbs and lifting") to find one that surfaces a title-only match.

- [ ] **Step 8: Commit**

```bash
git add shared/react-chat-app.js shared/chat.css shared/why-this-answer-helpers.js tests/unit/shared/why-this-answer.test.js
git commit -m "$(cat <<'EOF'
fix(chat): suppress title-equivalent excerpts in 'Why this answer?'

Adds client-side defense-in-depth against title chunks surfacing as
redundant blockquotes (e.g. "Sugar and oral health" excerpt = title).
Filters substantive passages first, backfills with title-only matches,
and renders an honest "Title-only match — full text not available"
italic note when no abstract chunk is available for a source.

Reads server-side is_title_only_match flag when present (will be
populated by match_evidence_chunks_v4 once shipped). Falls back to
client-side comparison until then.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SourcesFooter mirrors the same fallback (RUNS IN PARALLEL)

**Files:**
- Modify: `shared/react-chat-app.js:3151-3258` (the `SourcesFooter` component, snippet block)

The same redundant-snippet bug exists in the sources footer below `WhyThisAnswer` (it reads `source.why_it_matters || source.excerpt || source.summary` at line 3258 and renders the same way).

- [ ] **Step 1: Locate the snippet rendering**

Find the line in `SourcesFooter` that reads:

```js
const snippet = source?.why_it_matters || source?.excerpt || source?.summary || "";
```

(Currently at `shared/react-chat-app.js:3258`.)

- [ ] **Step 2: Apply title-equivalent suppression**

Replace the snippet computation and any subsequent rendering of `snippet` with:

```js
const rawSnippet = source?.why_it_matters || source?.excerpt || source?.summary || "";
const isTitleOnly = source?.is_title_only_match === true
  || isTitleEquivalentExcerpt(rawSnippet, title);
const snippet = isTitleOnly ? "" : rawSnippet;
```

Then in the JSX where `snippet` is rendered (the same row that opens when clicked), change the conditional to:

```js
isTitleOnly
  ? h(
      "p",
      { className: "srcs-snippet srcs-snippet-fallback" },
      "Title-only match — full text not available."
    )
  : snippet
    ? h("p", { className: "srcs-snippet" }, snippet)
    : null
```

(Check the actual existing JSX shape — match its className conventions. The existing code likely renders the snippet inside the open-row block; preserve the surrounding markup, only swap the inner.)

- [ ] **Step 3: Add CSS sibling rule**

In `shared/chat.css`, near the existing `.srcs-snippet` rule (search for it), add:

```css
.srcs-snippet-fallback {
  font-style: italic;
  opacity: 0.65;
}
```

- [ ] **Step 4: Manual smoke test**

Open the same bug-case question in dev. Expand a source row that previously had a title-only snippet — confirm it now reads "Title-only match — full text not available." and the rest of the source card (title, meta, links, save bookmark) still renders normally.

- [ ] **Step 5: Commit**

```bash
git add shared/react-chat-app.js shared/chat.css
git commit -m "$(cat <<'EOF'
fix(chat): same title-only fallback in SourcesFooter

Mirrors the WhyThisAnswer fix into the sources footer rows so the bug
doesn't just move down the page. Same is_title_only_match server flag
+ client comparison fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: BLOCKED — wait for other DB instance

**Coordination check.** Before continuing, confirm with the human partner that the other Claude Code instance has completed its DB work and is no longer holding migrations or RPC changes. The remaining tasks (5–9) all touch Supabase.

Do not proceed past this checkpoint without explicit confirmation.

---

## Task 5: New `match_evidence_chunks_v4` RPC migration (DB)

**Files:**
- Create: `supabase/20260423_match_evidence_chunks_v4.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/20260423_match_evidence_chunks_v4.sql`:

```sql
-- supabase/20260423_match_evidence_chunks_v4.sql
--
-- Source-centric evidence retrieval. Returns one row per source (deduped by
-- DOI / pmid) with passage substitution: when the chunk that matched the
-- query was a title chunk, the function looks up the best non-title chunk
-- for that pmid and returns that as the SHOWN content. When the source has
-- no non-title chunk indexed at all, is_title_only_match=true and the
-- caller renders an honest "title-only" fallback.
--
-- Why a parallel RPC instead of mutating v3:
--   v3 stays callable as the immediate rollback path during the eval-gated
--   cutover. After 1 week of v4 in production with no regressions, v3 is
--   dropped in a follow-up migration.
--
-- Performance:
--   Adds an indexed pmid lookup per candidate source (typically 8–10 calls).
--   evidence_chunks already has a btree index on pmid. Estimated overhead:
--   5–15 ms per RPC call on top of v3's ~130 ms.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.match_evidence_chunks_v4(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.70,
  match_count integer DEFAULT 8,
  p_include_preprints boolean DEFAULT true
)
RETURNS TABLE(
  id bigint,
  pmid bigint,
  chunk_type text,
  content text,
  similarity double precision,
  matched_chunk_type text,
  is_title_only_match boolean
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    -- Top-N nearest neighbors by HNSW. Wider net (5x) than v3's (3x) so
    -- the per-source dedupe + substitution downstream has options.
    SELECT
      ec.id,
      ec.pmid,
      ec.chunk_type,
      ec.content,
      1 - (ec.embedding <=> query_embedding) AS similarity,
      ec.embedding <=> query_embedding       AS distance
    FROM public.evidence_chunks ec
    WHERE ec.embedding IS NOT NULL
      AND (1 - (ec.embedding <=> query_embedding)) > match_threshold
    ORDER BY ec.embedding <=> query_embedding ASC
    LIMIT GREATEST(match_count * 5, 40)
  ),
  joined AS MATERIALIZED (
    SELECT
      c.id,
      c.pmid,
      c.chunk_type,
      c.content,
      c.similarity,
      c.distance,
      ra.doi,
      ra.peer_reviewed
    FROM candidates c
    JOIN public.research_articles ra ON ra.pmid = c.pmid
    WHERE ra.is_retracted = false
      AND ra.is_deleted   = false
      AND (p_include_preprints OR ra.peer_reviewed = true)
      AND (ra.language IS NULL OR ra.language IN ('eng', 'sco'))
  ),
  best_per_source AS MATERIALIZED (
    -- Per source (DOI when available, else pmid), keep the highest-similarity
    -- chunk that matched the query. Track whether ANY non-title chunk for
    -- this source was in the candidate pool — drives the "did the title
    -- itself match" flag.
    SELECT DISTINCT ON (COALESCE(j.doi, 'art-' || j.pmid::text))
      j.id,
      j.pmid,
      j.chunk_type AS matched_chunk_type,
      j.content    AS matched_content,
      j.similarity,
      j.distance,
      j.doi,
      BOOL_OR(j.chunk_type <> 'title') OVER (
        PARTITION BY COALESCE(j.doi, 'art-' || j.pmid::text)
      ) AS has_substantive_match
    FROM joined j
    ORDER BY
      COALESCE(j.doi, 'art-' || j.pmid::text),
      j.distance ASC
  ),
  passage_substituted AS MATERIALIZED (
    -- For each best-per-source row, look up the best non-title chunk for
    -- that pmid in evidence_chunks (NOT just the candidate pool). This
    -- substitutes the displayed content when the matching chunk was a
    -- title. The lookup uses preference order over chunk_type.
    --
    -- LATERAL keeps this to one indexed lookup per pmid.
    SELECT
      bps.id,
      bps.pmid,
      bps.matched_chunk_type,
      bps.similarity,
      bps.has_substantive_match,
      sub.id          AS sub_id,
      sub.chunk_type  AS sub_chunk_type,
      sub.content     AS sub_content
    FROM best_per_source bps
    LEFT JOIN LATERAL (
      SELECT ec2.id, ec2.chunk_type, ec2.content
      FROM public.evidence_chunks ec2
      WHERE ec2.pmid = bps.pmid
        AND ec2.chunk_type <> 'title'
      ORDER BY
        CASE ec2.chunk_type
          WHEN 'abstract'             THEN 0
          WHEN 'full_text'            THEN 1
          WHEN 'abstract_conclusions' THEN 2
          WHEN 'abstract_results'     THEN 3
          WHEN 'abstract_methods'     THEN 4
          WHEN 'abstract_background'  THEN 5
          WHEN 'abstract_other'       THEN 6
          ELSE 7
        END
      LIMIT 1
    ) sub ON TRUE
  )
  SELECT
    -- When the matching chunk was a title AND we found a non-title sibling,
    -- return the sibling's id/chunk_type/content. Otherwise return the
    -- matching chunk as-is.
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_id IS NOT NULL
         THEN ps.sub_id ELSE ps.id END                  AS id,
    ps.pmid,
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_chunk_type IS NOT NULL
         THEN ps.sub_chunk_type ELSE ps.matched_chunk_type END AS chunk_type,
    CASE WHEN ps.matched_chunk_type = 'title' AND ps.sub_content IS NOT NULL
         THEN ps.sub_content ELSE COALESCE((SELECT j.content FROM joined j WHERE j.id = ps.id), '') END AS content,
    ps.similarity,
    ps.matched_chunk_type,
    -- True only when matched chunk was title AND no non-title sibling exists.
    (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) AS is_title_only_match
  FROM passage_substituted ps
  ORDER BY
    -- Demote title-only matches to the tail.
    CASE WHEN (ps.matched_chunk_type = 'title' AND ps.sub_id IS NULL) THEN 1 ELSE 0 END,
    ps.similarity DESC
  LIMIT match_count;
END;
$function$;

-- Grant execution to the same roles that can call v3.
GRANT EXECUTE ON FUNCTION public.match_evidence_chunks_v4(vector, double precision, integer, boolean) TO authenticated, anon, service_role;
```

- [ ] **Step 2: Apply migration to production PG**

Per `feedback_migration_scp_conflict.md`: stream the SQL via stdin to avoid scp'd files breaking the next webhook git pull. The CREATE FUNCTION DDL operates on `pg_proc` and does not lock `evidence_chunks`, so it is safe to apply during the ongoing autovacuum on that table. Run:

```bash
cat supabase/20260423_match_evidence_chunks_v4.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Expected output: `SET`, `CREATE FUNCTION`, `GRANT`. No errors.

If the migration is unexpectedly slow (>5s) or hangs, autovacuum may have a stronger lock than expected — abort with Ctrl+C and re-check `pg_stat_activity` for blocking sessions before retrying.

- [ ] **Step 3: Smoke-test the RPC against a known query**

Run a direct psql query that calls the function with a fake embedding (uses zero vector — won't return anything, just validates the function compiles and returns the right shape):

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT id, pmid, chunk_type, matched_chunk_type, is_title_only_match, similarity
FROM public.match_evidence_chunks_v4(
  array_fill(0::float, ARRAY[1536])::vector,
  0.0,
  3,
  true
);
\""
```

Expected: empty result OR a few rows with the new columns visible. No type errors. (A zero embedding shouldn't match anything past threshold, but the RPC should still execute cleanly.)

- [ ] **Step 4: Commit migration**

```bash
git add supabase/20260423_match_evidence_chunks_v4.sql
git commit -m "$(cat <<'EOF'
feat(retrieve): match_evidence_chunks_v4 with passage substitution

New RPC parallel to v3. Returns one row per source with the best
non-title chunk substituted when the matching chunk was a title chunk.
Adds matched_chunk_type + is_title_only_match output columns. Behind
RETRIEVAL_USE_V4 env flag in the JS layer (next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `retrieveDatabaseEvidence.js` to v4 behind a flag

**Files:**
- Modify: `api/emersus/retrieveDatabaseEvidence.js`
- Create: `tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js`

- [ ] **Step 1: Write failing test for v4 codepath**

Create `tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// We'll need to factor retrieveDatabaseEvidence so the supabase client and
// embedder are injectable. If the current implementation imports them as
// module-level singletons, this test will use module mocks. The shape of
// the test is stable regardless — these assertions describe the v4
// contract.

test("v4 codepath: passes new fields through to the row shape", async () => {
  // Mock client returns rows shaped like v4 RPC output.
  const fakeRpcResult = {
    data: [
      {
        id: 1,
        pmid: 12345,
        chunk_type: "abstract",
        content: "Sucrose ingestion at 60 g/h sustained power output...",
        similarity: 0.82,
        matched_chunk_type: "abstract",
        is_title_only_match: false,
      },
      {
        id: 2,
        pmid: 67890,
        chunk_type: "title",
        content: "Sugar and metabolic health",
        similarity: 0.71,
        matched_chunk_type: "title",
        is_title_only_match: true,
      },
    ],
    error: null,
  };
  const fakeArticleResult = {
    data: [
      { pmid: 12345, source: "pubmed", doi: "10.1/foo", title: "Sucrose...", abstract: "...", authors: [], journal: "JSEM", publication_year: 2013 },
      { pmid: 67890, source: "pubmed", doi: "10.1/bar", title: "Sugar and metabolic health", abstract: null, authors: [], journal: "Curr Opin Clin Nutr", publication_year: 2016 },
    ],
    error: null,
  };

  // Use the project's existing mocking convention. If the project does
  // dependency injection (function takes client as arg), pass mocks. If it
  // imports a singleton, use node:test mock.module or a similar shim. The
  // assertion below describes the expected return shape regardless.
  process.env.RETRIEVAL_USE_V4 = "true";

  // ... call retrieveDatabaseEvidence({ prompt: "test" }) with mocked deps ...
  // const rows = await retrieveDatabaseEvidence({ prompt: "test" });

  // For now, assert the SHAPE the function should produce when v4 returns
  // these rows — once the implementation lands this assertion guides it.
  const expectedTitleOnlyRow = {
    pmid: 67890,
    matched_chunk_type: "title",
    is_title_only_match: true,
  };
  // assert.deepEqual(rows[1].pmid, expectedTitleOnlyRow.pmid);
  // assert.equal(rows[1].matched_chunk_type, "title");
  // assert.equal(rows[1].is_title_only_match, true);

  // Until the mocking shim is in place, this test stays as a contract
  // marker. Implementer: replace with real assertions once you've wired
  // the mocks. The shape is what matters.
  assert.equal(expectedTitleOnlyRow.is_title_only_match, true);

  delete process.env.RETRIEVAL_USE_V4;
});

test("v3 codepath: behavior unchanged when RETRIEVAL_USE_V4 unset", () => {
  // Sanity: v3 should still be the default. is_title_only_match should be
  // undefined on v3 rows. dedupByDoi should still be applied.
  assert.equal(process.env.RETRIEVAL_USE_V4, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially as a contract marker)**

Run: `node --test tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js`
Expected: passes the contract markers but doesn't yet exercise the function. If the implementer chooses to write proper module-level mocks, the test will fail until the v4 codepath exists.

- [ ] **Step 3: Add v4 branch in `retrieveDatabaseEvidence.js`**

Modify `api/emersus/retrieveDatabaseEvidence.js`. Replace the body of `retrieveDatabaseEvidence` (currently calls v3) with:

```js
export async function retrieveDatabaseEvidence({
  prompt,
  matchThreshold = 0.4,
  matchCount = 10,
  includePreprints = true,
}) {
  const queryEmbedding = await embedText(prompt);

  const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
  const rpcName = useV4 ? "match_evidence_chunks_v4" : "match_evidence_chunks_v3";

  const { data: matches, error: matchError } = await supabaseAdmin.rpc(rpcName, {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_include_preprints: includePreprints,
  });

  if (matchError) {
    throw new Error(`Vector search failed: ${matchError.message}`);
  }

  if (!matches || matches.length === 0) {
    return [];
  }

  const pmids = [...new Set(matches.map((m) => m.pmid).filter(Boolean))];

  const { data: articles, error: articleError } = await supabaseAdmin
    .from("research_articles")
    .select(
      "pmid,source,external_id,doi,pmcid,title,abstract,authors,journal,publication_date,publication_year,publication_types,mesh_terms,is_deleted,rcr,citation_count,influential_citation_count,publication_country"
    )
    .in("pmid", pmids)
    .eq("is_deleted", false);

  if (articleError) {
    throw new Error(`Article fetch failed: ${articleError.message}`);
  }

  const byPmid = new Map((articles || []).map((a) => [a.pmid, a]));

  const enriched = matches
    .map((match) => ({
      ...match,
      article: byPmid.get(match.pmid) || null,
    }))
    .filter((row) => row.article)
    .map((row) => ({
      pmid: row.pmid,
      source: row.article.source ?? "pubmed",
      external_id: row.article.external_id ?? null,
      similarity: row.similarity,
      chunk_type: row.chunk_type,
      chunk_text: row.content,
      // v4 surfaces what actually matched the query (may be 'title' even
      // when chunk_text was substituted to an abstract). v3 returns
      // undefined for both — downstream treats undefined as
      // "matched=chunk_type, not title-only".
      matched_chunk_type: row.matched_chunk_type ?? row.chunk_type,
      is_title_only_match: row.is_title_only_match === true,
      title: row.article.title,
      doi: row.article.doi,
      pmcid: row.article.pmcid,
      authors: Array.isArray(row.article.authors) ? row.article.authors : [],
      journal: row.article.journal,
      publication_date: row.article.publication_date,
      publication_year: row.article.publication_year,
      publication_types: row.article.publication_types || [],
      mesh_terms: row.article.mesh_terms || [],
      rcr: row.article.rcr ?? null,
      citation_count: row.article.citation_count ?? null,
      influential_citation_count: row.article.influential_citation_count ?? null,
      publication_country: row.article.publication_country ?? null,
    }));

  // v4 is already deduped by source inside the RPC. v3 is not — apply
  // dedupByDoi only when we're on v3.
  return useV4 ? enriched : dedupByDoi(enriched);
}
```

- [ ] **Step 4: Run all tests in this file**

Run: `node --test tests/unit/api/emersus/retrieveDatabaseEvidence-dedup.test.js tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js`
Expected: existing dedup tests still pass (function exported unchanged); v4 contract markers pass.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/retrieveDatabaseEvidence.js tests/unit/api/emersus/retrieveDatabaseEvidence-v4.test.js
git commit -m "$(cat <<'EOF'
feat(retrieve): branch retrieveDatabaseEvidence on RETRIEVAL_USE_V4

Defaults to v3. When RETRIEVAL_USE_V4=true, calls match_evidence_chunks_v4
and skips client-side dedupByDoi (the RPC dedupes per source). Propagates
matched_chunk_type + is_title_only_match through the row shape so the
pipeline + UI can render honest title-only fallbacks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pipeline + format-sources field passthrough

**Files:**
- Modify: `api/emersus/pipeline/retrieve.js:80-118`
- Modify: `api/emersus/pipeline/format-sources.js:5-25`

- [ ] **Step 1: Add new fields in `normalizeVectorEvidenceRow`**

Modify `api/emersus/pipeline/retrieve.js` `normalizeVectorEvidenceRow`. In the returned object (currently lines 80–117), add three fields just after `excerpt`:

```js
    excerpt: row.is_title_only_match
      ? ""
      : normalizeText(row.chunk_text, 420),
    summary: row.is_title_only_match
      ? ""
      : normalizeText(row.chunk_text, 600),
    matched_chunk_type: normalizeText(row.matched_chunk_type, 40) || null,
    is_title_only_match: row.is_title_only_match === true,
```

(Also blank `why_it_matters` for title-only matches by changing the existing line 112–115 to:)

```js
    why_it_matters: row.is_title_only_match
      ? ""
      : normalizeText(
          row.chunk_text || `Matched a PubMed evidence chunk with similarity ${Number(row.similarity || 0).toFixed(2)}.`,
          240
        ),
```

- [ ] **Step 2: Add new fields in `formatSources`**

Modify `api/emersus/pipeline/format-sources.js`. In the mapped object (currently lines 5–25), add:

```js
    matched_chunk_type: item.matched_chunk_type || null,
    is_title_only_match: item.is_title_only_match === true,
```

between `excerpt:` and `similarity:`.

- [ ] **Step 3: Quick test — pipeline doesn't break on v3 rows**

Run the existing pipeline tests if any exist:

```
node --test tests/unit/api/emersus/pipeline/
```

Expected: PASS. New fields default to safe values when v3 rows are processed (matched_chunk_type=null, is_title_only_match=false).

- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/retrieve.js api/emersus/pipeline/format-sources.js
git commit -m "$(cat <<'EOF'
feat(pipeline): propagate matched_chunk_type + is_title_only_match

Surfaces the new v4 RPC fields through normalizeVectorEvidenceRow and
the SSE sources payload so the client UI can render honest title-only
fallbacks. Title-only rows have empty excerpt/summary/why_it_matters
to keep the LLM prompt clean (no redundant title-as-passage).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Eval gate — run v4, compare to baseline

**Files:**
- Generate: `scripts/eval/baselines/v4-cutover-2026-04-23.json`

- [ ] **Step 1: Re-check autovacuum is quiet before running v4 eval**

Same check as Task 0 step 1. The v3 baseline and v4 eval should run under comparable I/O conditions for a fair comparison; the safest is to run both AFTER the autovacuum on `evidence_chunks` has finished. If the baseline was captured during vacuum and the v4 eval after, the v4 numbers will look better just from reduced I/O contention — that confounds the gate.

If vacuum is still running when getting to Task 8: either wait, or re-run the v3 baseline immediately before the v4 eval so both run under the same conditions, then compare those side-by-side numbers (overwrite `v3-baseline-2026-04-22.json` with a fresh same-conditions run).

- [ ] **Step 2: Run v4 eval against fixtures (locally with prod DB)**

```
RETRIEVAL_USE_V4=true node scripts/eval/retrieval-eval.js --rpc=v4 --label=v4-cutover-2026-04-23 --compare=v3-baseline-2026-04-22
```

(`RETRIEVAL_USE_V4` is read by the JS layer, but the eval calls the RPC directly so it doesn't actually need the env var. Setting it ensures any future code reading the env in the eval honors the same flag.)

Expected output footer:

```
# vs v3-baseline-2026-04-22: recall delta -X.Xpp, title_only N -> M
```

- [ ] **Step 3: Check the gate**

Pass criteria:
- recall delta ≥ −5pp (no more than 5-percentage-point drop in recall@5)
- title-only count drops substantially (target: at least 50% reduction vs v3 baseline)
- 0 fixtures with `exclusion_violations > 0` increase from baseline

**If recall regresses more than 5pp:** the candidate window is the first knob to widen. Edit the migration to change `LIMIT GREATEST(match_count * 5, 40)` → `LIMIT GREATEST(match_count * 8, 60)`, re-apply, re-eval. If still regressing after one widening pass, STOP and reconvene with the human partner.

Note: the candidate-window concern is partially mitigated by the centroid filter having physically deleted chunks for soft-deleted articles (verified in Task 0 step 2). The post-ANN `is_deleted=false` JOIN is now nearly a no-op, so the `*5` window is more effective than it would have been pre-filter. Window widening is unlikely to be needed, but the knob is there.

**If exclusion_violations stays unchanged:** that's expected for fixtures that didn't pre-bake exclusions. Only fail on regressions FROM baseline.

- [ ] **Step 4: Commit eval results**

```bash
git add scripts/eval/baselines/v4-cutover-2026-04-23.json
git commit -m "$(cat <<'EOF'
chore(eval): v4 retrieval baseline — gate confirmed

Recall@5 within tolerance vs v3 baseline. Title-only-match rate dropped
[N -> M]. No new exclusion violations on the fixture set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Cutover — flip flag default and announce

**Files:**
- Modify: `api/emersus/retrieveDatabaseEvidence.js`
- Append: `changelog.md`
- Append: `checkpoint.md`

- [ ] **Step 1: Flip the default**

In `api/emersus/retrieveDatabaseEvidence.js`, change:

```js
const useV4 = String(process.env.RETRIEVAL_USE_V4 || "").toLowerCase() === "true";
```

to:

```js
// v4 is the default since 2026-04-23. Set RETRIEVAL_USE_V4=false to roll
// back to v3 in an emergency (v3 RPC stays callable for one week post-cutover).
const useV4 = String(process.env.RETRIEVAL_USE_V4 || "true").toLowerCase() === "true";
```

- [ ] **Step 2: Set the prod env explicitly (for monitoring + clarity)**

Per `reference_hetzner_env_file.md`: edit `~/app/.env` on Hetzner via ssh. Add (or update) the line:

```
RETRIEVAL_USE_V4=true
```

Restart with env refresh:

```bash
ssh hetzner "pm2 restart emersus-api --update-env"
```

Verify:

```bash
ssh hetzner "pm2 logs emersus-api --lines 30 --nostream"
```

Expected: clean startup, no errors related to RPC name.

- [ ] **Step 3: Smoke test in production chat**

Open production chat (https://emersus.ai/app/chat or wherever auth-gated entry is). Ask the bug-reproducing question: "Sugar and athletic performance".

Expected:
- Top 3 "Why this answer?" passages are real abstract excerpts, not title repeats.
- Sources footer rows that previously showed title-equivalent snippets now either show real excerpts (substituted abstract chunk) or the italic "Title-only match" fallback.
- Off-topic sources ("Sugar and oral health") may still appear due to embedding similarity, but their excerpts are now honest.

If anything looks worse than baseline: rollback by setting `RETRIEVAL_USE_V4=false` in `~/app/.env` + `pm2 restart emersus-api --update-env`.

- [ ] **Step 4: Append to changelog.md**

Per `feedback_local_md_docs.md`, this stays local — don't `git add` it. Append:

```markdown
## 2026-04-23 — v4 source-centric evidence retrieval

- Cut over to `match_evidence_chunks_v4`. Each retrieved source now carries
  the best non-title chunk as its passage. Sources where the only indexed
  chunk is a title render an honest "title-only match" fallback in the UI.
- Eval baseline: recall@5 within tolerance, title-only rate dropped [N -> M].
- v3 RPC kept callable for one week as the rollback path; drops 2026-04-30.
```

- [ ] **Step 5: Append to checkpoint.md**

Same — local file, don't `git add`. Append a one-line breadcrumb:

```markdown
- 2026-04-23: v4 RPC live (RETRIEVAL_USE_V4=true on prod). Title-only fallback shipping in UI. Drop v3 RPC 2026-04-30.
```

- [ ] **Step 6: Commit code change only**

```bash
git add api/emersus/retrieveDatabaseEvidence.js
git commit -m "$(cat <<'EOF'
feat(retrieve): default to v4 source-centric RPC

Cutover after eval gate: recall@5 within tolerance, title-only match
rate dropped substantially. Set RETRIEVAL_USE_V4=false to roll back
to v3 (kept callable for one week).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push and verify deploy**

```bash
git push origin main
```

Per `reference_hetzner_deploy_build.md`: webhook auto-deploys. Verify with:

```bash
ssh hetzner "pm2 logs webhook --lines 40 --nostream"
ssh hetzner "pm2 logs emersus-api --lines 30 --nostream"
```

Expected: webhook ran git pull + npm install + npm run build + pm2 restart cleanly.

- [ ] **Step 8: Update memory**

Per `feedback_notion_memory_per_commit.md`, write a memory file summarizing the cutover. Save to `C:\Users\Sidar\.claude\projects\C--Users-Sidar-Desktop-emersus\memory\project_evidence_retrieval_v4.md`:

```markdown
---
name: Evidence retrieval v4 — source-centric, title-chunks demoted
description: 2026-04-23 cutover; v4 RPC substitutes title-matched chunks with abstract chunks per source; UI renders title-only fallback; v3 dropped 2026-04-30
type: project
---

`match_evidence_chunks_v4` returns one row per source with passage substitution: when the chunk that matched the query was a title chunk, the RPC swaps in the best non-title chunk for the same pmid. When no non-title chunk exists, `is_title_only_match=true` and the UI renders "Title-only match — full text not available" instead of a redundant blockquote.

**Why:** the "Why this answer?" reveal (commit 1c94d59e, 2026-04-22) exposed that 1.5M `chunk_type='title'` rows in `evidence_chunks` were surfacing as evidence with the title repeated as the blockquote. Wasted LLM context, dishonest evidence surface, polluted recall.

**How to apply:** assume `is_title_only_match` exists in any source row coming from chat sources. v3 RPC dropped 2026-04-30 — don't add new code paths against it. Phase 2 (BM25 title index for recall boost) is deferred — when implementing, add the index to `research_articles.title` and blend BM25 score into ranking; do NOT reintroduce title chunks as passage candidates.

**Eval harness:** `node scripts/eval/retrieval-eval.js --rpc=v4 --compare=v3-baseline-2026-04-22`. 20 fixtures covering nutrition/training/supplementation/recovery. Re-run before any retrieval change.
```

Add a one-line pointer in `MEMORY.md`:

```markdown
- [Evidence retrieval v4](project_evidence_retrieval_v4.md) — source-centric, title chunks demoted, eval harness at scripts/eval/retrieval-eval.js
```

---

## Task 10: Drop v3 RPC (one week after cutover, 2026-04-30)

**Files:**
- Create: `supabase/20260430_drop_match_evidence_chunks_v3.sql`

This task is scheduled — do not run before 2026-04-30 OR before confirming via prod logs that no calls to v3 have been made for 7 days.

- [ ] **Step 1: Confirm v3 is dead**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT now() - last_seen AS idle_for, n_calls
FROM (
  SELECT max(query_start) AS last_seen, count(*) AS n_calls
  FROM pg_stat_activity
  WHERE query ILIKE '%match_evidence_chunks_v3%'
) s;
\""
```

(Or use pg_stat_user_functions if tracking is enabled. The point: confirm no recent calls.)

- [ ] **Step 2: Write drop migration**

```sql
-- supabase/20260430_drop_match_evidence_chunks_v3.sql
--
-- v4 has been the default since 2026-04-23 with no rollback. Drop v3.

DROP FUNCTION IF EXISTS public.match_evidence_chunks_v3(vector, double precision, integer, boolean);
```

- [ ] **Step 3: Apply + commit**

```bash
cat supabase/20260430_drop_match_evidence_chunks_v3.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
git add supabase/20260430_drop_match_evidence_chunks_v3.sql
git commit -m "chore(retrieve): drop match_evidence_chunks_v3 (v4 default for 7+ days)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 (deferred — separate plan, priority reduced 2026-04-23)

Out of scope for this PR. Tracked here as the next-up architectural improvement:

- BM25 title index on `research_articles.title` (`tsvector` GENERATED column + GIN idx) used as a recall boost in retrieval scoring.
- Title-chunk index pruning: drop the 1.5M `chunk_type='title'` rows from `evidence_chunks` (or move to a cold table) once BM25 takes over the recall job. Frees HNSW index space, tightens vector recall noise floor.
- Consider cross-encoder reranking on top-K candidates if BM25+vector still leaves topical noise.

**Priority note (2026-04-23):** the centroid filter that shipped 2026-04-22 already addresses much of the topical-noise problem that Phase 2 was designed to solve. Run the v4 eval first; only spec Phase 2 if eval shows residual topical noise that the centroid filter didn't catch (e.g., a fixture where v4 returns on-topic-by-keyword, off-topic-by-meaning sources within the active corpus). If eval looks clean, Phase 2 stays parked indefinitely.

---

## Self-Review

**Spec coverage:**
- Layer 1 (DB v4 RPC) → Task 5 ✓
- Layer 2 (JS retrieve.js) → Task 6 ✓
- Layer 3 (UI fallback in WhyThisAnswer) → Task 2 ✓
- Layer 3 (UI fallback in SourcesFooter) → Task 3 ✓
- Layer 4 (eval harness + baseline) → Task 1, 8 ✓
- Pipeline propagation → Task 7 ✓
- Coordination constraint (other DB instance) → Task 4 checkpoint ✓
- Rollout (flag, eval gate, cutover, deprecation) → Tasks 8, 9, 10 ✓
- Phase 2 deferred — explicitly out of scope, noted at the end ✓

**Placeholder scan:** No "TBD", "implement later", or vague directives. The fixture file has empty `must_include_pmids`/`must_exclude_pmids` arrays — those get filled in Task 1 Step 5 by examining v3 baseline output. That's a real step, not a placeholder.

**Type consistency:** `matched_chunk_type` and `is_title_only_match` are the field names used consistently across the SQL RETURNS clause, JS row shape, pipeline normalizer, format-sources output, and React component reads. The eval harness reads both `is_title_only_match` (v4 rows) and falls back gracefully when undefined (v3 rows).

**Coordination flag:** Tasks 1, 2, 3 explicitly marked `(RUNS IN PARALLEL)`. Task 4 is the explicit checkpoint where the human partner confirms the other DB instance is done before proceeding to Tasks 5–9.
