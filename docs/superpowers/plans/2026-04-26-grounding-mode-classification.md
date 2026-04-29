# Grounding Mode Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a measurement system that classifies every cited factual claim into `{correct, mode_1_misattribution, mode_2_overgen, mode_3_fabrication, mode_4_contradicted, no_marker}`, calibrated against human ground truth, running both offline (extends `grounding-eval.js`) and prod-shadow (extends `grade-grounding-samples.js`).

**Architecture:** Single new module `api/emersus/pipeline/claim-modes.js` exports `extractAtomicClaims` + `classifyClaimModes`, both used by the offline eval and the prod-shadow grader. Per-claim results land in a new `chat_claim_modes` table keyed to `chat_grounding_samples.id`. A two-pass calibration (extraction F1 ≥ 0.85, per-mode classification F1 ≥ 0.75 + kappa ≥ 0.6) gates trust in the metric before any rate is reported. Spec: `docs/superpowers/specs/2026-04-26-grounding-mode-classification-design.md`.

**Tech Stack:** Node 24, ES modules, OpenAI Responses API (`gpt-5.4` judge), Anthropic Messages API (`claude-opus-4-7` labeling assistant), Supabase Postgres, Node's built-in `node:test` runner.

---

## File Structure

**Created:**
- `supabase/migrations/20260426000000_chat_claim_modes.sql` — `chat_claim_modes` table + indexes.
- `api/emersus/pipeline/claim-modes.js` — `extractAtomicClaims` + `classifyClaimModes` + bucket logic.
- `tests/unit/api/emersus/pipeline/claim-modes.test.js` — unit tests for bucket logic + JSON parsing (LLM calls mocked).
- `scripts/eval/calibration/prelabel-extraction.js` — runs `claude-opus-4-7` on 30 answers, writes prelabels.
- `scripts/eval/calibration/prelabel-classification.js` — runs `claude-opus-4-7` on 50 tuples, writes prelabels.
- `scripts/eval/calibration/build-synthetic-mode3.js` — generates 10 mode_3 candidates via topic-mismatched retrieval.
- `scripts/eval/calibration/score-calibration.js` — computes F1 / Cohen's kappa / confusion matrix from final human labels.
- `scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json` — final human-labeled extraction set (output of Pass A review).
- `scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json` — final human-labeled classification set (output of Pass B review).

**Modified:**
- `scripts/eval/grounding-eval.js` — wire `claim-modes.js` after each generated answer, append per-claim modes to JSON + roll up to per-answer rates in MD.
- `scripts/grade-grounding-samples.js` — after existing fidelity+paraphrase grading, call `claim-modes.js` and insert into `chat_claim_modes`.
- `scripts/grounding-trend.js` — add daily/weekly mode-rate aggregations.

---

## Task 1: SQL migration for `chat_claim_modes`

**Files:**
- Create: `supabase/migrations/20260426000000_chat_claim_modes.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Per-claim grounding-mode classifications, keyed to chat_grounding_samples
-- Writer: Sid (2026-04-26)
-- Spec: docs/superpowers/specs/2026-04-26-grounding-mode-classification-design.md

create table if not exists public.chat_claim_modes (
  id                              bigserial primary key,
  sample_id                       bigint not null references public.chat_grounding_samples(id) on delete cascade,
  claim_text                      text not null,
  cited_source_ids                int[] not null default '{}',
  source_scores_json              jsonb not null default '[]'::jsonb,
  mode                            text,
  qualifier_diff_json             jsonb,
  alternate_supporting_sources    jsonb,
  judge_model                     text,
  judge_prompt_version            text,
  grading_status                  text not null default 'ok',
  created_at                      timestamptz not null default now(),

  constraint chat_claim_modes_mode_check check (
    mode is null or mode in (
      'correct',
      'mode_1_misattribution',
      'mode_2_overgen',
      'mode_3_fabrication',
      'mode_4_contradicted',
      'no_marker'
    )
  ),
  constraint chat_claim_modes_status_check check (
    grading_status in ('ok', 'judge_error', 'malformed_json', 'partial')
  )
);

create index if not exists chat_claim_modes_sample_idx
  on public.chat_claim_modes (sample_id);

create index if not exists chat_claim_modes_mode_created_idx
  on public.chat_claim_modes (mode, created_at desc)
  where grading_status = 'ok';

create index if not exists chat_claim_modes_version_idx
  on public.chat_claim_modes (judge_prompt_version, created_at desc);

-- Idempotency: skip claims already graded successfully under the same prompt version
create unique index if not exists chat_claim_modes_idem_idx
  on public.chat_claim_modes (sample_id, md5(claim_text), judge_prompt_version)
  where grading_status = 'ok';
```

- [ ] **Step 2: Apply migration to prod**

Run from local machine:

```bash
cat supabase/migrations/20260426000000_chat_claim_modes.sql \
  | ssh hetzner 'docker exec -i supabase-db psql -U supabase_admin -d postgres'
```

Expected output: `CREATE TABLE`, four `CREATE INDEX` lines, no errors.

- [ ] **Step 3: Verify schema**

```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "\d chat_claim_modes"'
```

Expected: table with all 12 columns, 4 indexes including the unique idempotency index.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260426000000_chat_claim_modes.sql
git commit -m "feat(grounding): add chat_claim_modes table for per-claim mode classification"
```

---

## Task 2: `claim-modes.js` module — bucket logic (pure function, TDD)

**Files:**
- Create: `api/emersus/pipeline/claim-modes.js`
- Create: `tests/unit/api/emersus/pipeline/claim-modes.test.js`

The bucket-assignment function is pure — it takes per-source scores and returns a mode. We TDD this first because it's the algorithm's load-bearing logic and it has no LLM dependency.

- [ ] **Step 1: Write the failing test for the bucket logic**

```javascript
// tests/unit/api/emersus/pipeline/claim-modes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { assignBucket } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("assignBucket: contradicted cited source -> mode_4", () => {
  const scores = [
    { source_index: 1, direction: "contradicts", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_4_contradicted");
});

test("assignBucket: no support and no contradiction -> mode_3", () => {
  const scores = [
    { source_index: 1, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_3_fabrication");
});

test("assignBucket: uncited source scores 2, cited scores 0 -> mode_1", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 0, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_1_misattribution");
});

test("assignBucket: cited source scores 1 -> mode_2", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 1, qualifiers_missing: [] },
    { source_index: 2, direction: "unrelated", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_2_overgen");
});

test("assignBucket: cited scores 2 with qualifier diff -> mode_2", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: ["trained men only"] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "mode_2_overgen");
});

test("assignBucket: cited scores 2 with no qualifier diff -> correct", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "correct");
});

test("assignBucket: both cited and uncited score 2 -> correct + alternate_supporting_sources", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
    { source_index: 2, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1], source_scores: scores });
  assert.equal(result.mode, "correct");
  assert.deepEqual(result.alternate_supporting_sources, [2]);
});

test("assignBucket: empty cited_ids -> no_marker", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [], source_scores: scores });
  assert.equal(result.mode, "no_marker");
});

test("assignBucket: multi-cite [1,2] one contradicts -> mode_4", () => {
  const scores = [
    { source_index: 1, direction: "supports", support_score: 2, qualifiers_missing: [] },
    { source_index: 2, direction: "contradicts", support_score: 0, qualifiers_missing: [] },
  ];
  const result = assignBucket({ cited_ids: [1, 2], source_scores: scores });
  assert.equal(result.mode, "mode_4_contradicted");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: FAIL — `Cannot find module 'api/emersus/pipeline/claim-modes.js'`.

- [ ] **Step 3: Write minimal `assignBucket` implementation**

```javascript
// api/emersus/pipeline/claim-modes.js

export function assignBucket({ cited_ids, source_scores }) {
  if (!Array.isArray(cited_ids) || cited_ids.length === 0) {
    return { mode: "no_marker", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  const cited = new Set(cited_ids);
  const citedScores = source_scores.filter((s) => cited.has(s.source_index));
  const uncitedScores = source_scores.filter((s) => !cited.has(s.source_index));

  // mode_4: any cited source contradicts the claim
  const citedContradictions = citedScores.filter((s) => s.direction === "contradicts");
  if (citedContradictions.length > 0) {
    return { mode: "mode_4_contradicted", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  // mode_3: no source supports at all AND no source contradicts
  const anySupports = source_scores.some((s) => s.direction === "supports" && s.support_score >= 1);
  const anyContradicts = source_scores.some((s) => s.direction === "contradicts");
  if (!anySupports && !anyContradicts) {
    return { mode: "mode_3_fabrication", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  const bestCitedScore = citedScores.reduce(
    (best, s) => (s.direction === "supports" && s.support_score > best ? s.support_score : best),
    0,
  );
  const bestUncitedScore = uncitedScores.reduce(
    (best, s) => (s.direction === "supports" && s.support_score > best ? s.support_score : best),
    0,
  );

  // mode_1: best uncited support is full (2) AND best cited support is partial or worse (<2)
  if (bestUncitedScore === 2 && bestCitedScore < 2) {
    return { mode: "mode_1_misattribution", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  // Find the cited source(s) with the highest support score and any qualifier diff
  const bestCited = citedScores
    .filter((s) => s.direction === "supports" && s.support_score === bestCitedScore)
    .sort((a, b) => (b.qualifiers_missing?.length || 0) - (a.qualifiers_missing?.length || 0))[0];
  const qualifierDiff = bestCited?.qualifiers_missing?.length ? bestCited.qualifiers_missing : null;

  // mode_2: cited score is 1, OR cited score is 2 with non-empty qualifier diff
  if (bestCitedScore === 1 || (bestCitedScore === 2 && qualifierDiff)) {
    return { mode: "mode_2_overgen", qualifier_diff: qualifierDiff, alternate_supporting_sources: [] };
  }

  // correct: best cited = 2 AND no qualifier diff
  if (bestCitedScore === 2) {
    const alts = uncitedScores
      .filter((s) => s.direction === "supports" && s.support_score === 2)
      .map((s) => s.source_index);
    return { mode: "correct", qualifier_diff: null, alternate_supporting_sources: alts };
  }

  // Fallback (should not occur given the above branches): treat as fabrication
  return { mode: "mode_3_fabrication", qualifier_diff: null, alternate_supporting_sources: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: 9/9 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/claim-modes.js tests/unit/api/emersus/pipeline/claim-modes.test.js
git commit -m "feat(claim-modes): bucket assignment logic for grounding mode classification"
```

---

## Task 3: `claim-modes.js` — atomic-claim extraction (with LLM call)

**Files:**
- Modify: `api/emersus/pipeline/claim-modes.js`
- Modify: `tests/unit/api/emersus/pipeline/claim-modes.test.js`

`extractAtomicClaims(answerText)` calls gpt-5.4 once and returns `[{claim_text, cited_ids: int[]}]`. Tests mock the LLM call.

- [ ] **Step 1: Write the failing test for `parseExtractionResponse`**

The pure-parsing helper (no LLM) is what we test directly. Append to `claim-modes.test.js`:

```javascript
import { parseExtractionResponse } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("parseExtractionResponse: well-formed JSON", () => {
  const raw = JSON.stringify({
    claims: [
      { claim_text: "Creatine improves 1RM by 5%", cited_ids: [3] },
      { claim_text: "Creatine reduces fatigue", cited_ids: [3, 7] },
    ],
  });
  const out = parseExtractionResponse(raw);
  assert.equal(out.claims.length, 2);
  assert.deepEqual(out.claims[0].cited_ids, [3]);
});

test("parseExtractionResponse: strips markdown code fences", () => {
  const raw = "```json\n" + JSON.stringify({ claims: [{ claim_text: "x", cited_ids: [1] }] }) + "\n```";
  const out = parseExtractionResponse(raw);
  assert.equal(out.claims.length, 1);
});

test("parseExtractionResponse: malformed -> error", () => {
  const out = parseExtractionResponse("not json at all");
  assert.equal(out.error, "malformed_json");
  assert.deepEqual(out.claims, []);
});

test("parseExtractionResponse: missing claims array -> error", () => {
  const raw = JSON.stringify({ wrong_key: [] });
  const out = parseExtractionResponse(raw);
  assert.equal(out.error, "malformed_json");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: 4 new tests FAIL with `parseExtractionResponse is not a function`.

- [ ] **Step 3: Implement extraction**

Append to `api/emersus/pipeline/claim-modes.js`:

```javascript
export const EXTRACTION_PROMPT_VERSION = "claim-extraction-v1";

const EXTRACTION_SYSTEM_PROMPT = [
  "You extract atomic factual scientific claims from an exercise/nutrition coach's answer.",
  "",
  "A factual claim is a statement that asserts an empirical relationship, number, or finding (e.g., 'creatine improves 1RM by ~5%', 'beta-alanine reduces fatigue at doses ≥3.2 g/day').",
  "NOT factual claims (do NOT extract): procedural instructions ('do 3 sets of 8'), motivational text ('train hard'), conversational framing ('great question'), hedges with no content ('it depends'), section headers.",
  "",
  "Multi-claim sentences must be SPLIT into atomic claims. 'Creatine improves 1RM and reduces fatigue [3,7]' becomes TWO claims, each carrying [3,7].",
  "Strip the citation markers from claim_text. The cited_ids array carries the integers from [N] markers attached to the source sentence.",
  "",
  "Output JSON only: {\"claims\": [{\"claim_text\": \"<the claim, no markers>\", \"cited_ids\": [int]}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

export function parseExtractionResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { claims: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.claims)) {
    return { claims: [], error: "malformed_json" };
  }
  const claims = parsed.claims
    .map((c) => ({
      claim_text: String(c.claim_text || "").trim(),
      cited_ids: Array.isArray(c.cited_ids) ? c.cited_ids.filter((n) => Number.isInteger(n)) : [],
    }))
    .filter((c) => c.claim_text);
  return { claims, error: null };
}

async function callJudge({ system, user, model, maxOutputTokens }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      max_output_tokens: maxOutputTokens,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export async function extractAtomicClaims(answerText, { model = "gpt-5.4" } = {}) {
  const userPrompt = `ANSWER TEXT:\n${answerText}\n\nReturn the JSON object as specified.`;
  let raw;
  let attempts = 0;
  while (attempts < 2) {
    try {
      raw = await callJudge({ system: EXTRACTION_SYSTEM_PROMPT, user: userPrompt, model, maxOutputTokens: 1000 });
      break;
    } catch (err) {
      attempts += 1;
      if (attempts >= 2) {
        return { claims: [], error: "judge_error", error_message: err.message, prompt_version: EXTRACTION_PROMPT_VERSION };
      }
    }
  }
  const parsed = parseExtractionResponse(raw);
  return { ...parsed, prompt_version: EXTRACTION_PROMPT_VERSION };
}
```

- [ ] **Step 4: Run tests to verify pure-parser tests pass**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: 13/13 PASS (9 bucket + 4 parser).

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/claim-modes.js tests/unit/api/emersus/pipeline/claim-modes.test.js
git commit -m "feat(claim-modes): atomic-claim extraction via gpt-5.4"
```

---

## Task 4: `claim-modes.js` — per-claim classification (with LLM call)

**Files:**
- Modify: `api/emersus/pipeline/claim-modes.js`
- Modify: `tests/unit/api/emersus/pipeline/claim-modes.test.js`

`classifyClaimModes(claims, retrievedSources)` calls gpt-5.4 once per claim and applies `assignBucket`.

- [ ] **Step 1: Write the failing test for `parseClassificationResponse`**

Append to `claim-modes.test.js`:

```javascript
import { parseClassificationResponse } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("parseClassificationResponse: well-formed", () => {
  const raw = JSON.stringify({
    per_source: [
      { source_index: 1, direction: "supports", support_score: 2, scope_qualifiers_in_source_missing_from_claim: [] },
      { source_index: 2, direction: "unrelated", support_score: 0, scope_qualifiers_in_source_missing_from_claim: [] },
    ],
  });
  const out = parseClassificationResponse(raw, 2);
  assert.equal(out.source_scores.length, 2);
  assert.equal(out.source_scores[0].direction, "supports");
  assert.deepEqual(out.source_scores[0].qualifiers_missing, []);
});

test("parseClassificationResponse: maps qualifier field name", () => {
  const raw = JSON.stringify({
    per_source: [
      { source_index: 1, direction: "supports", support_score: 2, scope_qualifiers_in_source_missing_from_claim: ["trained men", "8 weeks"] },
    ],
  });
  const out = parseClassificationResponse(raw, 1);
  assert.deepEqual(out.source_scores[0].qualifiers_missing, ["trained men", "8 weeks"]);
});

test("parseClassificationResponse: malformed -> error", () => {
  const out = parseClassificationResponse("not json", 1);
  assert.equal(out.error, "malformed_json");
});

test("parseClassificationResponse: pads missing source_index entries", () => {
  // Judge returned 1 source but we have 2 — pad missing as unrelated/score=0
  const raw = JSON.stringify({
    per_source: [
      { source_index: 1, direction: "supports", support_score: 2, scope_qualifiers_in_source_missing_from_claim: [] },
    ],
  });
  const out = parseClassificationResponse(raw, 2);
  assert.equal(out.source_scores.length, 2);
  assert.equal(out.source_scores[1].direction, "unrelated");
  assert.equal(out.source_scores[1].support_score, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement classification**

Append to `api/emersus/pipeline/claim-modes.js`:

```javascript
export const CLASSIFY_PROMPT_VERSION = "claim-classify-v1";

const CLASSIFY_SYSTEM_PROMPT = [
  "You evaluate whether each retrieved source supports, contradicts, or is unrelated to a specific factual claim.",
  "",
  "For EACH source you receive, return:",
  "  - direction: 'supports' | 'contradicts' | 'unrelated'",
  "  - support_score: 0, 1, or 2 (only meaningful when direction='supports')",
  "      0 = no support",
  "      1 = partial/qualified — source supports the gist but with narrower scope or weaker effect",
  "      2 = full direct support — source establishes the claim with the same scope and effect",
  "  - scope_qualifiers_in_source_missing_from_claim: list of qualifiers (population, dose, duration, study design) that the source restricts the finding to but the claim drops. Empty list when direction != 'supports' or claim already includes all qualifiers.",
  "",
  "If a source actively states the OPPOSITE of the claim (e.g., source: 'no significant 1RM improvement', claim: 'improves 1RM'), use direction='contradicts'.",
  "If a source is on a different topic entirely, use direction='unrelated'.",
  "",
  "Output JSON only: {\"per_source\": [{\"source_index\": N, \"direction\": \"...\", \"support_score\": N, \"scope_qualifiers_in_source_missing_from_claim\": [...]}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

function formatSourcesForClassifier(sources) {
  return sources.map((it, i) => {
    const text = it.is_title_only_match ? (it.title || "") : `${it.title || ""}\n    ${it.excerpt || "(no excerpt)"}`;
    const header = [it.publication_year, it.publication_type, it.journal].filter(Boolean).join(" · ");
    return `[${i + 1}] ${header}\n    ${text}`;
  }).join("\n\n");
}

export function parseClassificationResponse(raw, expectedSourceCount) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { source_scores: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.per_source)) {
    return { source_scores: [], error: "malformed_json" };
  }
  const byIndex = new Map();
  for (const row of parsed.per_source) {
    const idx = Number(row?.source_index);
    if (!Number.isInteger(idx) || idx < 1 || idx > expectedSourceCount) continue;
    byIndex.set(idx, {
      source_index: idx,
      direction: ["supports", "contradicts", "unrelated"].includes(row.direction) ? row.direction : "unrelated",
      support_score: [0, 1, 2].includes(Number(row.support_score)) ? Number(row.support_score) : 0,
      qualifiers_missing: Array.isArray(row.scope_qualifiers_in_source_missing_from_claim)
        ? row.scope_qualifiers_in_source_missing_from_claim.map(String)
        : [],
    });
  }
  // Pad any missing source indices as unrelated/0
  const source_scores = [];
  for (let i = 1; i <= expectedSourceCount; i += 1) {
    source_scores.push(byIndex.get(i) || { source_index: i, direction: "unrelated", support_score: 0, qualifiers_missing: [] });
  }
  return { source_scores, error: null };
}

export async function classifyClaimModes(claims, retrievedSources, { model = "gpt-5.4" } = {}) {
  const sourcesBlock = formatSourcesForClassifier(retrievedSources);
  const out = [];
  for (const claim of claims) {
    const userPrompt = `CLAIM:\n${claim.claim_text}\n\nRETRIEVED SOURCES:\n${sourcesBlock}\n\nReturn the JSON object as specified.`;
    let raw;
    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      try {
        raw = await callJudge({ system: CLASSIFY_SYSTEM_PROMPT, user: userPrompt, model, maxOutputTokens: 1500 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        attempts += 1;
      }
    }
    if (lastErr) {
      out.push({
        claim_text: claim.claim_text,
        cited_source_ids: claim.cited_ids,
        source_scores: [],
        mode: null,
        qualifier_diff: null,
        alternate_supporting_sources: [],
        grading_status: "judge_error",
        prompt_version: CLASSIFY_PROMPT_VERSION,
        error_message: lastErr.message,
      });
      continue;
    }
    const parsed = parseClassificationResponse(raw, retrievedSources.length);
    if (parsed.error === "malformed_json") {
      out.push({
        claim_text: claim.claim_text,
        cited_source_ids: claim.cited_ids,
        source_scores: [],
        mode: null,
        qualifier_diff: null,
        alternate_supporting_sources: [],
        grading_status: "malformed_json",
        prompt_version: CLASSIFY_PROMPT_VERSION,
      });
      continue;
    }
    const bucket = assignBucket({ cited_ids: claim.cited_ids, source_scores: parsed.source_scores });
    out.push({
      claim_text: claim.claim_text,
      cited_source_ids: claim.cited_ids,
      source_scores: parsed.source_scores,
      mode: bucket.mode,
      qualifier_diff: bucket.qualifier_diff,
      alternate_supporting_sources: bucket.alternate_supporting_sources,
      grading_status: "ok",
      prompt_version: CLASSIFY_PROMPT_VERSION,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/claim-modes.test.js`
Expected: 17/17 PASS (9 bucket + 4 extraction-parse + 4 classification-parse).

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/claim-modes.js tests/unit/api/emersus/pipeline/claim-modes.test.js
git commit -m "feat(claim-modes): per-claim classification + bucket integration"
```

---

## Task 5: Pre-labeling script for extraction (Pass A)

**Files:**
- Create: `scripts/eval/calibration/prelabel-extraction.js`

Reads 30 answers from existing eval results, runs `claude-opus-4-7` to suggest labels, dumps prelabels for human review.

- [ ] **Step 1: Write the script**

```javascript
// scripts/eval/calibration/prelabel-extraction.js
//
// Pre-labels 30 answers with claude-opus-4-7's suggested factual-claim
// extraction. Writes JSON for Sidar to review and finalize.
//
// Usage:
//   node scripts/eval/calibration/prelabel-extraction.js --in=scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json --n=30

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_LABEL_MODEL || "claude-opus-4-7";

function parseArgs(argv) {
  const args = { in: null, out: "scripts/eval/fixtures/grounding-modes-extraction-prelabels.v1.json", n: 30 };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "in") args.in = v;
    else if (k === "out") args.out = v;
    else if (k === "n") args.n = Number(v) || 30;
  }
  if (!args.in) throw new Error("--in=<path> is required");
  return args;
}

async function callClaude({ system, user }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Anthropic failed (${res.status}): ${JSON.stringify(json)}`);
  const text = (json?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return text;
}

const SYSTEM_PROMPT = [
  "You extract atomic factual scientific claims from an exercise/nutrition coach's answer.",
  "Same definition of 'factual claim' as the production extractor: assertions of empirical relationships, numbers, or findings.",
  "NOT claims: procedural instructions, motivation, conversational framing, hedges, headers.",
  "Multi-claim sentences must be split.",
  "",
  "For each claim, also report:",
  "  - confidence: 'high' | 'medium' | 'low' — your confidence that this is a factual claim worth grading",
  "  - reasoning: one short sentence explaining the call",
  "",
  "Output JSON only: {\"claims\": [{\"claim_text\": \"...\", \"cited_ids\": [int], \"confidence\": \"high|medium|low\", \"reasoning\": \"...\"}, ...]}",
].join("\n");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.in, "utf-8");
  const data = JSON.parse(raw);
  const results = (data.results || []).slice(0, args.n);
  console.log(`[prelabel-extract] processing ${results.length} answers via ${ANTHROPIC_MODEL}`);

  const prelabels = [];
  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    const answer = row?.emersus?.text || row?.B?.text || "";
    if (!answer) {
      console.warn(`[prelabel-extract] row ${i} has no answer text — skipping`);
      continue;
    }
    process.stdout.write(`[${i + 1}/${results.length}] `);
    try {
      const text = await callClaude({ system: SYSTEM_PROMPT, user: `ANSWER TEXT:\n${answer}\n\nReturn the JSON object.` });
      const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      prelabels.push({
        index: i,
        question: row.question,
        answer,
        prelabel_claims: parsed.claims || [],
        sidar_final_claims: null,
      });
      console.log(`${(parsed.claims || []).length} claims`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      prelabels.push({ index: i, question: row.question, answer, prelabel_claims: [], error: err.message, sidar_final_claims: null });
    }
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify({ generated_at: new Date().toISOString(), model: ANTHROPIC_MODEL, prelabels }, null, 2));
  console.log(`[prelabel-extract] wrote ${args.out} (${prelabels.length} entries)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify ANTHROPIC_API_KEY is set locally**

```bash
grep ANTHROPIC_API_KEY ~/Desktop/emersus/.env 2>/dev/null || grep ANTHROPIC_API_KEY ~/Desktop/emersus/.env.local 2>/dev/null || echo "NOT SET — add to ~/Desktop/emersus/.env.local"
```

If not set: visit `https://console.anthropic.com/settings/keys`, create a key with the `claude-opus-4-7` model enabled, add to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 3: Run the script (smoke with n=2 first)**

```bash
node scripts/eval/calibration/prelabel-extraction.js \
  --in=scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json \
  --n=2 \
  --out=/tmp/prelabel-smoke.json
```

Expected: prints `2 claims` (or similar) per row, writes 2-entry JSON. Verify the JSON parses cleanly.

- [ ] **Step 4: Run the full 30**

```bash
node scripts/eval/calibration/prelabel-extraction.js \
  --in=scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json \
  --n=30
```

Expected output file: `scripts/eval/fixtures/grounding-modes-extraction-prelabels.v1.json`. ~30 entries, ~150 prelabel claims total.

- [ ] **Step 5: Commit (script only — prelabels are .gitignored as fixtures don't go in git unless explicitly added)**

```bash
git add scripts/eval/calibration/prelabel-extraction.js
git commit -m "feat(calibration): claude-opus-4-7 pre-labeling script for extraction (Pass A)"
```

---

## Task 6: Manual review — finalize extraction calibration set

This is a human task. No code.

- [ ] **Step 1: Open the prelabels file**

Open `scripts/eval/fixtures/grounding-modes-extraction-prelabels.v1.json` in an editor.

- [ ] **Step 2: For each entry, copy `prelabel_claims` to `sidar_final_claims` and edit**

For each of the 30 entries:
- Read the answer text.
- Look at `prelabel_claims` (Claude's suggestion).
- If the prelabel is correct: copy the array to `sidar_final_claims` unchanged.
- If wrong: edit. Add missed factual claims, remove non-factual entries, fix `cited_ids`.
- Aim for ~30 sec/item when Claude is right (high confidence), ~2 min/item when corrections needed.

The accepted shape per entry is `sidar_final_claims: [{claim_text, cited_ids: [int]}, ...]` (drop the `confidence` and `reasoning` fields from the prelabel — those were Claude's working-out, not part of the final label).

- [ ] **Step 3: Save the finalized file**

Save as `scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json` (note name change from prelabels → calibration).

```bash
cp scripts/eval/fixtures/grounding-modes-extraction-prelabels.v1.json \
   scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json
# then edit
```

- [ ] **Step 4: Commit the finalized calibration set**

```bash
git add scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json
git commit -m "data(calibration): finalized extraction calibration set v1 (30 answers, ~150 claims)"
```

---

## Task 7: Calibration scorer — extraction Pass A

**Files:**
- Create: `scripts/eval/calibration/score-calibration.js`

- [ ] **Step 1: Write the scorer**

```javascript
// scripts/eval/calibration/score-calibration.js
//
// Scores calibration results.
//   Pass A (extraction): F1 of extracted claims vs Sidar's final claims.
//   Pass B (classification): per-mode F1 + Cohen's kappa.
//
// Usage:
//   node scripts/eval/calibration/score-calibration.js --pass=A --in=scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json
//   node scripts/eval/calibration/score-calibration.js --pass=B --in=scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json

import "dotenv/config";
import fs from "node:fs/promises";

import { extractAtomicClaims, classifyClaimModes } from "../../../api/emersus/pipeline/claim-modes.js";

function parseArgs(argv) {
  const args = { pass: null, in: null };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k === "pass") args.pass = v;
    else if (k === "in") args.in = v;
  }
  if (!args.pass || !args.in) throw new Error("--pass={A|B} --in=<path> required");
  return args;
}

function normalizeClaim(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function f1(precision, recall) {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function setMatch(predicted, gold) {
  // Best-effort overlap by normalized claim text. A predicted claim "matches"
  // a gold claim if their normalized forms share >= 0.7 token Jaccard.
  const pset = predicted.map((c) => new Set(normalizeClaim(c.claim_text).split(" ")));
  const gset = gold.map((c) => new Set(normalizeClaim(c.claim_text).split(" ")));
  const matchedGold = new Set();
  let tp = 0;
  for (let i = 0; i < pset.length; i += 1) {
    let bestJ = 0;
    let bestIdx = -1;
    for (let j = 0; j < gset.length; j += 1) {
      if (matchedGold.has(j)) continue;
      const a = pset[i];
      const b = gset[j];
      const inter = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size;
      const jacc = union ? inter / union : 0;
      if (jacc > bestJ) { bestJ = jacc; bestIdx = j; }
    }
    if (bestJ >= 0.7) {
      tp += 1;
      matchedGold.add(bestIdx);
    }
  }
  const fp = pset.length - tp;
  const fn = gset.length - tp;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision, recall, f1: f1(precision, recall) };
}

async function scorePassA(inPath) {
  const { prelabels } = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const totals = { tp: 0, fp: 0, fn: 0 };
  let perAnswer = [];
  console.log(`[Pass A] running production extractor on ${prelabels.length} answers...`);
  for (const row of prelabels) {
    if (!Array.isArray(row.sidar_final_claims)) {
      console.warn(`[Pass A] row ${row.index}: no sidar_final_claims — skipping`);
      continue;
    }
    const result = await extractAtomicClaims(row.answer);
    if (result.error) {
      console.warn(`[Pass A] row ${row.index}: extractor error — ${result.error}`);
      continue;
    }
    const m = setMatch(result.claims, row.sidar_final_claims);
    totals.tp += m.tp; totals.fp += m.fp; totals.fn += m.fn;
    perAnswer.push({ index: row.index, ...m });
  }
  const microP = totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : 0;
  const microR = totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : 0;
  const microF1 = f1(microP, microR);
  const gate = microF1 >= 0.85;
  console.log("\n=== PASS A RESULTS ===");
  console.log(`micro precision: ${microP.toFixed(3)}`);
  console.log(`micro recall:    ${microR.toFixed(3)}`);
  console.log(`micro F1:        ${microF1.toFixed(3)}`);
  console.log(`gate (≥ 0.85):   ${gate ? "PASS" : "FAIL"}`);
  console.log(`totals: TP=${totals.tp} FP=${totals.fp} FN=${totals.fn}`);
  if (!gate) process.exit(1);
}

function buildConfusionMatrix(rows, modes) {
  const cm = {};
  for (const m of modes) {
    cm[m] = {};
    for (const m2 of modes) cm[m][m2] = 0;
  }
  for (const r of rows) {
    if (cm[r.gold] && cm[r.gold][r.pred] !== undefined) cm[r.gold][r.pred] += 1;
  }
  return cm;
}

function perModeF1(cm, mode) {
  let tp = cm[mode][mode];
  let fp = 0;
  let fn = 0;
  for (const m of Object.keys(cm)) {
    if (m !== mode) fp += cm[m][mode];
    if (m !== mode) fn += cm[mode][m];
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { mode, n_gold: tp + fn, precision: p, recall: r, f1: f1(p, r) };
}

function cohenKappa(rows) {
  const labels = [...new Set(rows.flatMap((r) => [r.gold, r.pred]))];
  const n = rows.length;
  let agree = 0;
  const goldCount = {};
  const predCount = {};
  for (const r of rows) {
    if (r.gold === r.pred) agree += 1;
    goldCount[r.gold] = (goldCount[r.gold] || 0) + 1;
    predCount[r.pred] = (predCount[r.pred] || 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels) {
    pe += ((goldCount[l] || 0) / n) * ((predCount[l] || 0) / n);
  }
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

async function scorePassB(inPath) {
  const { tuples } = JSON.parse(await fs.readFile(inPath, "utf-8"));
  console.log(`[Pass B] running production classifier on ${tuples.length} tuples...`);
  const rows = [];
  for (const t of tuples) {
    if (!t.sidar_final_mode) continue;
    const out = await classifyClaimModes([{ claim_text: t.claim_text, cited_ids: t.cited_ids }], t.retrieved_sources);
    const pred = out[0]?.mode;
    if (!pred) continue;
    rows.push({ gold: t.sidar_final_mode, pred, synthetic: !!t.synthetic });
  }
  const modes = ["correct", "mode_1_misattribution", "mode_2_overgen", "mode_3_fabrication", "mode_4_contradicted", "no_marker"];
  const cm = buildConfusionMatrix(rows, modes);
  const perMode = modes.map((m) => perModeF1(cm, m));
  const kappa = cohenKappa(rows);
  const synthMode3 = rows.filter((r) => r.synthetic && r.gold === "mode_3_fabrication");
  const natMode3 = rows.filter((r) => !r.synthetic && r.gold === "mode_3_fabrication");
  const synthF1 = synthMode3.length ? f1(
    synthMode3.filter((r) => r.pred === r.gold).length / synthMode3.length, 1
  ) : null;
  const natF1 = natMode3.length ? f1(
    natMode3.filter((r) => r.pred === r.gold).length / natMode3.length, 1
  ) : null;

  console.log("\n=== PASS B RESULTS ===");
  console.log("per-mode F1 (modes with N >= 5 are gated; others are advisory):");
  for (const r of perMode) {
    const flag = r.n_gold < 5 ? " [LOW-N]" : (r.f1 < 0.75 ? " [FAIL gate]" : " [PASS]");
    console.log(`  ${r.mode.padEnd(28)} N=${r.n_gold} P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} F1=${r.f1.toFixed(3)}${flag}`);
  }
  console.log(`\nCohen's kappa: ${kappa.toFixed(3)} ${kappa >= 0.6 ? "PASS" : "FAIL"} (gate ≥ 0.6)`);
  console.log(`mode_3 synthetic accuracy: ${synthMode3.length ? (synthMode3.filter((r) => r.pred === r.gold).length / synthMode3.length).toFixed(3) : "N/A"} (N=${synthMode3.length})`);
  console.log(`mode_3 natural accuracy:   ${natMode3.length ? (natMode3.filter((r) => r.pred === r.gold).length / natMode3.length).toFixed(3) : "N/A"} (N=${natMode3.length})`);

  console.log("\nconfusion matrix (rows=gold, cols=pred):");
  console.log("".padEnd(30) + modes.map((m) => m.slice(0, 8).padEnd(10)).join(""));
  for (const m of modes) {
    console.log(m.padEnd(30) + modes.map((m2) => String(cm[m][m2]).padEnd(10)).join(""));
  }

  const failingGated = perMode.filter((r) => r.n_gold >= 5 && r.f1 < 0.75);
  if (failingGated.length || kappa < 0.6) {
    console.log(`\nGATE: FAIL — failing modes: ${failingGated.map((r) => r.mode).join(", ") || "(kappa)"}`);
    process.exit(1);
  }
  console.log("\nGATE: PASS");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.pass === "A") await scorePassA(args.in);
  else if (args.pass === "B") await scorePassB(args.in);
  else throw new Error("--pass must be A or B");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the Pass A scorer**

```bash
node scripts/eval/calibration/score-calibration.js --pass=A \
  --in=scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json
```

Expected: prints micro-F1. Goal: ≥ 0.85.

- [ ] **Step 3: If gate fails, iterate the extraction prompt**

If F1 < 0.85:
- Read the FN rows (claims Sidar found that the extractor missed).
- Read the FP rows (claims the extractor found that aren't real).
- Adjust the extraction system prompt in `api/emersus/pipeline/claim-modes.js`.
- Bump `EXTRACTION_PROMPT_VERSION = "claim-extraction-v2"`.
- Re-run scorer until gate passes.

- [ ] **Step 4: Commit when gate passes**

```bash
git add scripts/eval/calibration/score-calibration.js api/emersus/pipeline/claim-modes.js
git commit -m "feat(calibration): scorer + extraction prompt at version that passes Pass A gate"
```

---

## Task 8: Synthetic mode_3 generator

**Files:**
- Create: `scripts/eval/calibration/build-synthetic-mode3.js`

Generates 10 mode_3 candidates by deliberately mismatching retrieval (method A from spec).

- [ ] **Step 1: Write the script**

```javascript
// scripts/eval/calibration/build-synthetic-mode3.js
//
// Generates 10 synthetic mode_3 candidates via retrieval-mismatch.
// For each prompt, retrieves with a deliberately off-topic embedding,
// generates an answer with the misaligned retrieval, and writes the
// (prompt, mismatched_sources, answer) tuple for human verification
// that the answer genuinely fabricates with citation.
//
// Usage:
//   node scripts/eval/calibration/build-synthetic-mode3.js

import "dotenv/config";
import fs from "node:fs/promises";

import { buildMessages } from "../../../api/emersus/pipeline/prompt.js";
import { buildRequestBody } from "../../../api/emersus/pipeline/synthesize.js";
import { formatEvidenceForModel, normalizeVectorEvidenceRow } from "../../../api/emersus/pipeline/retrieve.js";
import { retrieveDatabaseEvidence } from "../../../api/emersus/retrieveDatabaseEvidence.js";
import { dedupeEvidence, rankEvidence } from "../../../api/emersus/rerank.js";

const EMERSUS_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const OUT_PATH = "scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json";

// (target_prompt, mismatch_query) — retrieval is run against mismatch_query,
// then the model is asked the target_prompt with that misaligned retrieval set.
const PAIRS = [
  { target: "What's the recommended creatine loading protocol?", mismatch: "stretching routines for hamstring flexibility" },
  { target: "What dose of beta-alanine is effective for sprint performance?", mismatch: "yoga breathing techniques" },
  { target: "Does caffeine improve maximal strength?", mismatch: "vitamin D and bone density in elderly women" },
  { target: "What's the optimal protein intake per kg for hypertrophy?", mismatch: "marathon pacing strategies" },
  { target: "How long does it take to see strength gains from creatine?", mismatch: "swimming stroke technique" },
  { target: "Does fasted cardio burn more fat?", mismatch: "shoulder mobility for overhead athletes" },
  { target: "What's the minimum effective dose of caffeine for endurance?", mismatch: "core stability exercises for back pain" },
  { target: "Does rest-pause training improve hypertrophy vs traditional sets?", mismatch: "ankle dorsiflexion screening" },
  { target: "How does HMB compare to leucine for muscle protein synthesis?", mismatch: "tennis elbow rehabilitation" },
  { target: "What's the effect of sleep deprivation on testosterone?", mismatch: "elliptical machine biomechanics" },
];

async function callOpenAI(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return json?.output_text || (json?.output || []).flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text)).join("\n");
}

async function main() {
  const candidates = [];
  for (let i = 0; i < PAIRS.length; i += 1) {
    const { target, mismatch } = PAIRS[i];
    process.stdout.write(`[${i + 1}/${PAIRS.length}] target="${target.slice(0, 50)}..." `);
    try {
      // Retrieve using the MISMATCH query, not the target
      const ret = await retrieveDatabaseEvidence({ question: mismatch, limit: 6, matchCount: 10, matchThreshold: 0.4 });
      const ranked = rankEvidence(dedupeEvidence((ret.rows || []).map(normalizeVectorEvidenceRow)));
      if (!ranked.length) { console.log("no retrieval — skipping"); continue; }

      // Build the answer with the target question and the mismatched retrieval
      const evidenceForModel = formatEvidenceForModel(ranked);
      const messages = buildMessages({ question: target, evidence: evidenceForModel, sources: ranked });
      const body = buildRequestBody({ model: EMERSUS_MODEL, messages, maxOutputTokens: 700 });
      const answer = await callOpenAI(body);

      candidates.push({
        target_question: target,
        mismatch_query: mismatch,
        retrieved_sources: ranked,
        answer,
        manually_verified_mode_3: null, // Sidar fills this in after reading the answer
      });
      console.log("ok");
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  await fs.writeFile(OUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), model: EMERSUS_MODEL, candidates }, null, 2));
  console.log(`\n[synthetic-mode3] wrote ${OUT_PATH} (${candidates.length} candidates)`);
  console.log("Next: read each candidate's answer and set manually_verified_mode_3 = true|false.");
  console.log("Discard rows where the model refused or self-labeled as inference.");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the script**

```bash
node scripts/eval/calibration/build-synthetic-mode3.js
```

Expected: writes `scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json` with 10 candidates.

- [ ] **Step 3: Manually verify each candidate**

Open the JSON. For each candidate, read the `answer`:
- If the model wrote factual scientific claims with `[N]` citations despite the misaligned retrieval → genuine mode_3 → set `manually_verified_mode_3: true`.
- If the model self-labeled as "the retrieved evidence does not establish..." or refused → set `manually_verified_mode_3: false` and note that this prompt failed to elicit fabrication. Re-roll if needed (re-run script after editing PAIRS).

Goal: 10 verified candidates. If < 10 after first run, edit PAIRS and re-run for the missing slots.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/calibration/build-synthetic-mode3.js scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json
git commit -m "data(calibration): 10 synthetic mode_3 candidates (retrieval-mismatch method)"
```

---

## Task 9: Pre-labeling script for classification (Pass B)

**Files:**
- Create: `scripts/eval/calibration/prelabel-classification.js`

- [ ] **Step 1: Write the script**

```javascript
// scripts/eval/calibration/prelabel-classification.js
//
// Pre-labels 50 (claim, retrieved_sources) tuples with claude-opus-4-7's
// suggested mode classifications.
// Inputs:
//   - 40 natural tuples drawn from extraction-calibration v1 (sidar_final_claims)
//     paired with the corresponding offline-eval retrieval set
//   - 10 synthetic mode_3 candidates from build-synthetic-mode3
//
// Usage:
//   node scripts/eval/calibration/prelabel-classification.js \
//     --extraction=scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json \
//     --eval=scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json \
//     --synthetic=scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json

import "dotenv/config";
import fs from "node:fs/promises";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_LABEL_MODEL || "claude-opus-4-7";
const NATURAL_TARGET = 40;

function parseArgs(argv) {
  const args = {
    extraction: null,
    eval: null,
    synthetic: null,
    out: "scripts/eval/fixtures/grounding-modes-classification-prelabels.v1.json",
  };
  for (const raw of argv) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    if (k in args) args[k] = v;
  }
  if (!args.extraction || !args.eval || !args.synthetic) {
    throw new Error("--extraction --eval --synthetic all required");
  }
  return args;
}

async function callClaude({ system, user }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Anthropic failed (${res.status}): ${JSON.stringify(json)}`);
  return (json?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

const SYSTEM_PROMPT = [
  "You classify whether a claim is correctly grounded by its cited sources, given the full retrieval set.",
  "",
  "Buckets (one wins per claim, by precedence):",
  "  mode_4_contradicted   — at least one cited source actively contradicts the claim",
  "  mode_3_fabrication    — no source supports or contradicts; the claim is not in the retrieval set",
  "  mode_1_misattribution — claim IS supported by an UNCITED source, while the cited source(s) do not fully support it",
  "  mode_2_overgen        — cited source supports the gist but at narrower scope (population, dose, duration), OR cited only partially supports",
  "  correct               — cited source fully supports with no qualifier drift",
  "",
  "Output JSON only: {\"mode\": \"<bucket>\", \"confidence\": \"high|medium|low\", \"reasoning\": \"<one sentence>\"}",
].join("\n");

function formatSources(sources) {
  return sources.map((s, i) => {
    const header = [s.publication_year, s.publication_type, s.journal, s.title].filter(Boolean).join(" · ");
    return `[${i + 1}] ${header}\n    ${s.excerpt || "(no excerpt)"}`;
  }).join("\n\n");
}

function buildNaturalTuples(extraction, evalData) {
  const evalByIndex = new Map((evalData.results || []).map((r, i) => [i, r]));
  const out = [];
  for (const row of extraction.prelabels) {
    const eval_row = evalByIndex.get(row.index);
    if (!eval_row || !Array.isArray(eval_row.evidence)) continue;
    for (const claim of row.sidar_final_claims || []) {
      out.push({
        claim_text: claim.claim_text,
        cited_ids: claim.cited_ids,
        retrieved_sources: eval_row.evidence,
        synthetic: false,
      });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extraction = JSON.parse(await fs.readFile(args.extraction, "utf-8"));
  const evalData = JSON.parse(await fs.readFile(args.eval, "utf-8"));
  const synthetic = JSON.parse(await fs.readFile(args.synthetic, "utf-8"));

  const allNatural = buildNaturalTuples(extraction, evalData);
  console.log(`[prelabel-classify] candidate natural tuples: ${allNatural.length}, target: ${NATURAL_TARGET}`);

  // Sample 40 evenly across answers for stratification
  const stride = Math.max(1, Math.floor(allNatural.length / NATURAL_TARGET));
  const natural = [];
  for (let i = 0; i < allNatural.length && natural.length < NATURAL_TARGET; i += stride) {
    natural.push(allNatural[i]);
  }

  const syntheticTuples = [];
  for (const c of synthetic.candidates) {
    if (!c.manually_verified_mode_3) continue;
    // For synthetic, we need to extract the claim+cited_ids from c.answer.
    // Use the same regex as production to find first cited claim.
    const sentences = c.answer.split(/(?<=[.!?])\s+/);
    const cited = sentences.find((s) => /\[\d+\]|citesrc\d+/.test(s));
    if (!cited) continue;
    const ids = [...cited.matchAll(/citesrc(\d+)|\[(\d+)\]/g)].map((m) => Number(m[1] || m[2]));
    syntheticTuples.push({
      claim_text: cited.replace(/citesrc\d+|\[\d+\]/g, "").trim(),
      cited_ids: [...new Set(ids)],
      retrieved_sources: c.retrieved_sources,
      synthetic: true,
    });
  }
  console.log(`[prelabel-classify] synthetic tuples: ${syntheticTuples.length}`);

  const tuples = [...natural, ...syntheticTuples];
  const prelabels = [];
  for (let i = 0; i < tuples.length; i += 1) {
    const t = tuples[i];
    process.stdout.write(`[${i + 1}/${tuples.length}] `);
    const userPrompt = `CLAIM:\n${t.claim_text}\n\nCITED [N] markers in claim: ${t.cited_ids.join(",") || "(none)"}\n\nRETRIEVED SOURCES:\n${formatSources(t.retrieved_sources)}\n\nReturn the JSON object.`;
    try {
      const text = await callClaude({ system: SYSTEM_PROMPT, user: userPrompt });
      const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      prelabels.push({ ...t, prelabel_mode: parsed.mode, prelabel_confidence: parsed.confidence, prelabel_reasoning: parsed.reasoning, sidar_final_mode: null });
      console.log(`${parsed.mode} (${parsed.confidence})`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      prelabels.push({ ...t, prelabel_mode: null, error: err.message, sidar_final_mode: null });
    }
  }

  await fs.writeFile(args.out, JSON.stringify({ generated_at: new Date().toISOString(), model: ANTHROPIC_MODEL, tuples: prelabels }, null, 2));
  console.log(`[prelabel-classify] wrote ${args.out} (${prelabels.length} tuples)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the script**

```bash
node scripts/eval/calibration/prelabel-classification.js \
  --extraction=scripts/eval/fixtures/grounding-modes-extraction-calibration.v1.json \
  --eval=scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json \
  --synthetic=scripts/eval/fixtures/grounding-modes-synthetic-mode3.v1.json
```

Expected: writes `scripts/eval/fixtures/grounding-modes-classification-prelabels.v1.json` with ~50 tuples (40 natural + 10 synthetic).

- [ ] **Step 3: Commit the script**

```bash
git add scripts/eval/calibration/prelabel-classification.js
git commit -m "feat(calibration): claude-opus-4-7 pre-labeling for classification (Pass B)"
```

---

## Task 10: Manual review — finalize classification calibration set

Human task. No code.

- [ ] **Step 1: Open prelabels file**

`scripts/eval/fixtures/grounding-modes-classification-prelabels.v1.json`

- [ ] **Step 2: Set `sidar_final_mode` per tuple**

For each of the ~50 tuples:
- Read `claim_text`, `cited_ids`, and the relevant `retrieved_sources`.
- Look at `prelabel_mode` (Claude's call) and `prelabel_reasoning`.
- If you agree (high confidence + correct mode): set `sidar_final_mode = prelabel_mode`. ~30 sec.
- If you disagree: re-classify from scratch using the bucket definitions. ~2–3 min.

Mode taxonomy reminder (precedence top to bottom):
- `mode_4_contradicted` — cited source contradicts the claim
- `mode_3_fabrication` — no source supports or contradicts
- `mode_1_misattribution` — uncited source supports better than cited
- `mode_2_overgen` — cited supports partially or with qualifier drop
- `correct` — cited fully supports, no qualifier drop
- `no_marker` — no `[N]` (rare in this set; included only if extraction emitted unmarked claims)

- [ ] **Step 3: Save as calibration file**

```bash
cp scripts/eval/fixtures/grounding-modes-classification-prelabels.v1.json \
   scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json
# then edit, filling in sidar_final_mode for every tuple
```

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json
git commit -m "data(calibration): finalized classification calibration set v1 (50 tuples)"
```

---

## Task 11: Score Pass B and iterate until gates pass

- [ ] **Step 1: Run the Pass B scorer**

```bash
node scripts/eval/calibration/score-calibration.js --pass=B \
  --in=scripts/eval/fixtures/grounding-modes-classification-calibration.v1.json
```

Expected output: per-mode F1, kappa, confusion matrix, synthetic-vs-natural mode_3 accuracy.

- [ ] **Step 2: If gates fail, iterate the classification prompt**

If any mode with N ≥ 5 has F1 < 0.75, OR kappa < 0.6:
- Inspect the confusion matrix to identify which mode is being confused with which.
- Most likely failure: mode_2 ↔ correct boundary (qualifier-diff judgment is fuzzy).
- Tighten the `CLASSIFY_SYSTEM_PROMPT` in `api/emersus/pipeline/claim-modes.js`. Common improvements:
  - Add explicit examples of qualifier-drop ("source: '5g/day in trained men over 8 weeks improves 1RM 5%' → claim: 'creatine improves strength' → score=2 with qualifiers ['5g/day','trained men','8 weeks']").
  - Sharpen the supports/contradicts boundary with explicit negation handling.
- Bump `CLASSIFY_PROMPT_VERSION` from `claim-classify-v1` to `claim-classify-v2`.
- Re-run scorer.

- [ ] **Step 3: When gates pass, commit**

```bash
git add api/emersus/pipeline/claim-modes.js
git commit -m "feat(claim-modes): classification prompt at version that passes Pass B gates"
```

- [ ] **Step 4: Stop condition check**

If after 3 prompt-iteration cycles mode_2 still fails F1 ≥ 0.75 (and other modes pass), per spec Section 4: ship modes {correct, mode_1, mode_3, mode_4} with mode_2 documented as "not reportable in v1." Note this in the eventual prod report.

---

## Task 12: Wire `claim-modes.js` into `grounding-eval.js`

**Files:**
- Modify: `scripts/eval/grounding-eval.js`

- [ ] **Step 1: Add the import + per-answer call**

Open `scripts/eval/grounding-eval.js`. Find the section where each fixture's answer is processed (after `verifyAnswerGrounding` is called). Add this import near the top:

```javascript
import { extractAtomicClaims, classifyClaimModes } from "../../api/emersus/pipeline/claim-modes.js";
```

After the existing per-answer processing, add a per-answer mode classification block. The exact insert location depends on the existing code shape — find the loop that produces each row's result entry, and after the existing fidelity/paraphrase grading add:

```javascript
const extracted = await extractAtomicClaims(emersusAnswer);
let claimModes = [];
const answerModeCounts = {
  correct: 0, mode_1_misattribution: 0, mode_2_overgen: 0,
  mode_3_fabrication: 0, mode_4_contradicted: 0, no_marker: 0,
  judge_error: 0, malformed_json: 0,
};
if (extracted.error) {
  answerModeCounts.judge_error += 1;
} else {
  claimModes = await classifyClaimModes(extracted.claims, evidenceItems);
  for (const cm of claimModes) {
    if (cm.grading_status === "ok" && cm.mode in answerModeCounts) {
      answerModeCounts[cm.mode] += 1;
    } else {
      answerModeCounts[cm.grading_status] = (answerModeCounts[cm.grading_status] || 0) + 1;
    }
  }
}
result.claim_modes = claimModes;
result.answer_mode_counts = answerModeCounts;
```

`emersusAnswer` is the existing variable holding the grounded model's text output, and `evidenceItems` is the existing array of normalized retrieved-source rows passed into `verifyAnswerGrounding`. If those names differ in the current file, substitute the actual identifiers — but they should match because Task 4's `classifyClaimModes` was designed to consume the same shape `verifyAnswerGrounding` already takes.

- [ ] **Step 2: Add per-suite mode-rate aggregation to the MD output**

Find the MD-summary writer in `grounding-eval.js`. Add a section computing aggregate mode rates across all answers:

```javascript
const aggregateModeCounts = results.reduce((agg, r) => {
  if (!r.answer_mode_counts) return agg;
  for (const [k, v] of Object.entries(r.answer_mode_counts)) agg[k] = (agg[k] || 0) + v;
  return agg;
}, {});
const totalClaims = Object.values(aggregateModeCounts).reduce((a, b) => a + b, 0);
const mdModeSection = [
  "## Per-claim mode rates (across all graded claims)",
  "",
  `Total claims: ${totalClaims}`,
  ...Object.entries(aggregateModeCounts).map(([k, v]) =>
    `- ${k}: ${v} (${totalClaims ? (100 * v / totalClaims).toFixed(1) : "0"}%)`
  ),
  "",
].join("\n");
// Append mdModeSection to the existing MD output
```

- [ ] **Step 3: Smoke test on a small sample**

```bash
node scripts/eval/grounding-eval.js --limit=3 --judge=on --label=claim-modes-smoke
```

Expected: completes without error, output JSON contains `claim_modes` arrays and `answer_mode_counts` objects on each result row, MD includes "Per-claim mode rates" section.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/grounding-eval.js
git commit -m "feat(eval): wire claim-modes classification into grounding-eval"
```

---

## Task 13: Run offline eval on full 200-fixture set, write up first numbers

- [ ] **Step 1: Run the full eval**

```bash
node scripts/eval/grounding-eval.js --limit=200 --judge=on --label=claim-modes-baseline
```

Expected runtime: ~25-40 min. Costs: ~$10-15 (existing eval cost + ~$1.20 added by claim-modes calls).

- [ ] **Step 2: Read the generated `.md` summary**

Find the latest `scripts/eval/results/grounding-eval-claim-modes-baseline-*.md`. Capture these numbers:
- Per-mode counts and percentages
- judge_error / malformed_json counts (should be < 5%)

- [ ] **Step 3: Write a short report**

Create `docs/superpowers/specs/2026-04-26-grounding-mode-classification-baseline-results.md`:

```markdown
# Grounding Mode Classification — Baseline Results (offline)

**Date:** <today>
**Eval source:** scripts/eval/results/grounding-eval-claim-modes-baseline-*.md
**Calibration:** Pass A F1=<X>, Pass B per-mode F1 (correct=<X>, mode_1=<X>, ...), kappa=<X>

## Per-mode rates (200 fixtures, ~N claims)
- correct:                <X>%
- mode_1_misattribution:  <X>%
- mode_2_overgen:         <X>%
- mode_3_fabrication:     <X>%
- mode_4_contradicted:    <X>%
- no_marker:              <X>%

## Stop-condition check
- mode_3 + mode_4 combined: <X>%  (gate: <1% for prevention skip)
- mode_1: <X>%                    (gate: <5% for prevention skip)
- Decision: prevention work is [needed | not needed] based on the above.

## Notes
- Calibrated F1 caveats: any mode with F1 < 0.75 is reported with low-confidence flag.
- mode_2 is the noisiest mode per Section 4 of the design spec; treat as directional.
```

- [ ] **Step 4: Commit the report**

```bash
git add docs/superpowers/specs/2026-04-26-grounding-mode-classification-baseline-results.md
git commit -m "docs(grounding): baseline mode-rate measurements from 200-fixture offline eval"
```

---

## Task 14: Enable prod sampling

Operator task. No code.

- [ ] **Step 1: Add `GROUNDING_SAMPLE_RATE` to prod env**

```bash
ssh hetzner 'echo "GROUNDING_SAMPLE_RATE=0.05" >> ~/app/.env && grep GROUNDING_SAMPLE_RATE ~/app/.env'
```

Expected: prints `GROUNDING_SAMPLE_RATE=0.05`.

- [ ] **Step 2: Restart emersus-api with the new env**

```bash
ssh hetzner 'pm2 restart emersus-api --update-env'
```

Expected: `online` status.

- [ ] **Step 3: Verify samples land in `chat_grounding_samples`**

Wait ~10–15 minutes after a few real chats happen, then:

```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT count(*), max(created_at) FROM chat_grounding_samples;"'
```

Expected: count > 0, recent `max(created_at)`.

- [ ] **Step 4: Verify schema is what the algorithm expects**

```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT jsonb_object_keys(sources_json->0) FROM chat_grounding_samples WHERE jsonb_array_length(sources_json) > 0 LIMIT 1;"'
```

Expected keys (any subset of these is fine, but `excerpt` and `title` must be present): `title, journal, publication_year, publication_type, url, similarity, is_title_only_match, excerpt`.

If `excerpt` or `title` is missing, abort and update the source-formatting code in `claim-modes.js` to use whichever fields are actually present.

---

## Task 15: Wire claim-modes into prod-shadow grader

**Files:**
- Modify: `scripts/grade-grounding-samples.js`

- [ ] **Step 1: Add the import and per-row call**

At the top of `scripts/grade-grounding-samples.js`, add:

```javascript
import { extractAtomicClaims, classifyClaimModes, EXTRACTION_PROMPT_VERSION, CLASSIFY_PROMPT_VERSION } from "../api/emersus/pipeline/claim-modes.js";
```

Inside the main loop, after the existing `[fidelity, paraphrase] = await Promise.all(...)` block and BEFORE the `chat_grounding_samples` update, add:

```javascript
// Per-claim mode classification → chat_claim_modes
let claimModeRows = [];
try {
  const extracted = await extractAtomicClaims(row.answer);
  if (extracted.error) {
    claimModeRows = [{
      sample_id: row.id,
      claim_text: "(extraction failed)",
      cited_source_ids: [],
      source_scores_json: [],
      mode: null,
      qualifier_diff_json: null,
      alternate_supporting_sources: null,
      judge_model: JUDGE_MODEL,
      judge_prompt_version: `${EXTRACTION_PROMPT_VERSION},${CLASSIFY_PROMPT_VERSION}`,
      grading_status: extracted.error,
    }];
  } else {
    const classified = await classifyClaimModes(extracted.claims, sources);
    claimModeRows = classified.map((cm) => ({
      sample_id: row.id,
      claim_text: cm.claim_text,
      cited_source_ids: cm.cited_source_ids,
      source_scores_json: cm.source_scores,
      mode: cm.mode,
      qualifier_diff_json: cm.qualifier_diff,
      alternate_supporting_sources: cm.alternate_supporting_sources,
      judge_model: JUDGE_MODEL,
      judge_prompt_version: `${EXTRACTION_PROMPT_VERSION},${CLASSIFY_PROMPT_VERSION}`,
      grading_status: cm.grading_status,
    }));
  }

  if (claimModeRows.length) {
    const { error: insertErr } = await supabaseAdmin.from("chat_claim_modes").insert(claimModeRows);
    if (insertErr) {
      // Idempotency unique index will reject duplicates — that's fine, log and continue
      if (!String(insertErr.message || "").includes("duplicate key")) {
        console.warn(`[grade] sample ${row.id} chat_claim_modes insert error: ${insertErr.message}`);
      }
    }
  }
} catch (err) {
  console.warn(`[grade] sample ${row.id} claim-modes pipeline error: ${err.message}`);
}
```

- [ ] **Step 2: Verify locally against prod (read-only smoke)**

Use the existing `--limit=1` mode to grade exactly one ungraded sample:

```bash
node scripts/grade-grounding-samples.js --limit=1
```

Expected: log lines for fidelity + paraphrase as before, plus chat_claim_modes inserts (visible by counting):

```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT count(*), array_agg(distinct mode) FROM chat_claim_modes;"'
```

Expected: count > 0, modes covers at least one of the bucket values.

- [ ] **Step 3: Commit**

```bash
git add scripts/grade-grounding-samples.js
git commit -m "feat(grade): per-claim mode classification → chat_claim_modes table"
```

---

## Task 16: Extend trend reporter with mode rates

**Files:**
- Modify: `scripts/grounding-trend.js`

- [ ] **Step 1: Add a daily/weekly mode-rate aggregator**

At the bottom of the existing trend logic in `scripts/grounding-trend.js`, append:

```javascript
import { supabaseAdmin } from "../api/lib/clients.js";

async function reportClaimModeTrends({ days = 14 } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("chat_claim_modes")
    .select("mode, grading_status, created_at")
    .gte("created_at", since)
    .eq("grading_status", "ok");
  if (error) { console.error("trend query failed:", error.message); return; }
  if (!data?.length) { console.log("[trend] no chat_claim_modes rows in window"); return; }

  // Bucket by day (YYYY-MM-DD)
  const byDay = new Map();
  for (const row of data) {
    const day = row.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, {});
    const bucket = byDay.get(day);
    bucket[row.mode] = (bucket[row.mode] || 0) + 1;
    bucket._total = (bucket._total || 0) + 1;
  }
  const days_sorted = [...byDay.keys()].sort();
  const modes = ["correct", "mode_1_misattribution", "mode_2_overgen", "mode_3_fabrication", "mode_4_contradicted", "no_marker"];

  console.log("\n=== Claim-mode rates (last", days, "days) ===");
  console.log("date".padEnd(12) + "total".padEnd(8) + modes.map((m) => m.slice(0, 8).padEnd(10)).join(""));
  for (const d of days_sorted) {
    const b = byDay.get(d);
    const total = b._total;
    console.log(d.padEnd(12) + String(total).padEnd(8) + modes.map((m) => {
      const pct = total ? (100 * (b[m] || 0) / total).toFixed(1) + "%" : "0";
      return pct.padEnd(10);
    }).join(""));
  }

  // Window aggregate
  const agg = {};
  let total = 0;
  for (const row of data) {
    agg[row.mode] = (agg[row.mode] || 0) + 1;
    total += 1;
  }
  console.log("\n=== Window aggregate ===");
  for (const m of modes) {
    const pct = total ? (100 * (agg[m] || 0) / total).toFixed(2) + "%" : "0";
    console.log(`  ${m.padEnd(28)} ${String(agg[m] || 0).padEnd(6)} ${pct}`);
  }
}

reportClaimModeTrends({ days: 14 }).catch((err) => console.error(err));
```

- [ ] **Step 2: Run it**

```bash
node scripts/grounding-trend.js
```

Expected: existing trend output + new "Claim-mode rates" + "Window aggregate" sections.

- [ ] **Step 3: Commit**

```bash
git add scripts/grounding-trend.js
git commit -m "feat(trend): daily + window mode-rate reporting alongside cited_fraction"
```

---

## Task 17: Deploy and monitor for one week, write final report

Operator task.

- [ ] **Step 1: Push the branch**

After all earlier task commits are in place:

```bash
git push origin main
```

The webhook will auto-deploy emersus-api. emersus-worker is NOT auto-restarted by the webhook — restart manually since `grade-grounding-samples.js` runs from the worker context (or as a cron):

```bash
ssh hetzner 'pm2 restart emersus-worker --update-env'
```

- [ ] **Step 2: Confirm cron schedule for `grade-grounding-samples.js`**

```bash
ssh hetzner 'pm2 list | grep emersus' && \
  ssh hetzner 'crontab -l 2>/dev/null | grep -i ground || echo NO_CRON'
```

If no cron is scheduled, add one to run every hour:

```bash
ssh hetzner '(crontab -l 2>/dev/null; echo "0 * * * * cd ~/app && /usr/bin/node scripts/grade-grounding-samples.js --limit=100 >> ~/logs/grade-grounding.log 2>&1") | crontab -'
```

- [ ] **Step 3: Wait one week, then run the trend report**

After 7 days of accumulated samples:

```bash
ssh hetzner 'cd ~/app && node scripts/grounding-trend.js | tail -50'
```

- [ ] **Step 4: Write the final prod report**

Create `docs/superpowers/specs/2026-05-03-grounding-mode-classification-prod-results.md`:

```markdown
# Grounding Mode Classification — Prod Results (1 week)

**Window:** <date> to <date>
**Sample rate:** 5% (`GROUNDING_SAMPLE_RATE=0.05`)
**Total samples graded:** N
**Total claims graded:** M

## Mode rates
- correct:                <X>%
- mode_1_misattribution:  <X>%
- mode_2_overgen:         <X>%
- mode_3_fabrication:     <X>%
- mode_4_contradicted:    <X>%
- no_marker:              <X>%
- judge_error / malformed: <X>%

## Comparison vs offline baseline
- (table comparing offline 200-fixture rates to prod rates)

## Stop-condition decision
- mode_3 + mode_4: <X>%  (offline: <Y>%)
- mode_1: <X>%           (offline: <Y>%)
- Verdict: prevention work [is | is not] worth pursuing as a follow-on project.

## Top examples per mode
- (3 sampled real claim+source pairs per mode, with brief commentary)
```

- [ ] **Step 5: Commit the report**

```bash
git add docs/superpowers/specs/2026-05-03-grounding-mode-classification-prod-results.md
git commit -m "docs(grounding): one-week prod mode-rate measurements"
```

This artifact answers the original question: "is Emersus pretending to use evidence, and if so, in what specific ways and how often?"

---

## Self-review

Spec coverage check:

| Spec section | Implemented in |
|---|---|
| 1.1 Atomic-claim extraction | Task 3 |
| 1.1 Per-claim batched entailment | Task 4 |
| 1.1 Source content scored against | Task 4 (`formatSourcesForClassifier`) |
| 1.1 Bucket assignment by precedence | Task 2 (`assignBucket`) |
| 1.1.5 alternate_supporting_sources | Task 2 + Task 15 storage |
| 1.2 Multi-citation handling | Task 3 (extraction splits) + Task 2 (bucket reads cited_ids set) |
| 1.3 Cost model | Tasks 13 + 17 (verified empirically by runtime) |
| 1.4 Storage | Task 1 |
| 1.5 Error handling and partial results | Tasks 3, 4, 15 (retry logic + grading_status) |
| 2.1 Pass A extraction calibration | Tasks 5, 6, 7 |
| 2.2 Pass B mode-classification calibration | Tasks 8, 9, 10, 11 |
| 2.3 Labeling workflow (Sidar + Claude assistant) | Tasks 5, 9 (prelabels) + 6, 10 (review) |
| 2.4 Calibration metrics & gates | Task 7 + Task 11 (`score-calibration.js`) |
| 2.5 Calibration failure modes | Task 11 step 2 (iteration loop) |
| 3.1 New code | Tasks 1, 2, 3, 4, 5, 7, 8, 9 |
| 3.2 Extended code | Tasks 12, 15, 16 |
| 3.3 Rollout order | Tasks numbered to match spec rollout 1–15 |
| 3.4 Stop conditions | Task 13 step 3 + Task 17 step 4 |
| 4 Expected calibration outcomes | Task 11 step 4 (graceful mode_2-fail handoff) |

No gaps.

Type-consistency check: `extractAtomicClaims` returns `{claims, error, prompt_version}` (Task 3) and is consumed in Task 4, Task 7, Task 12, Task 15 — all consistent. `classifyClaimModes` returns array of `{claim_text, cited_source_ids, source_scores, mode, qualifier_diff, alternate_supporting_sources, grading_status, prompt_version}` (Task 4) — consumed identically in Task 12 and Task 15. `assignBucket` returns `{mode, qualifier_diff, alternate_supporting_sources}` — consumed in Task 4 and used for the test contract in Task 2.

Placeholder scan: no TBD / TODO / "implement later" / "similar to Task N" / "appropriate error handling" appear in the plan body. Every task has concrete code or concrete shell commands.
