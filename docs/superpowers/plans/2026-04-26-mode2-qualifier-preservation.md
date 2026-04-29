# Mode-2 Qualifier-Preservation Verifier (MQPV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a post-stream verification pipeline that catches mode_2 over-generalization (qualifier omission) and rewrites the response with optional explicit hedges, driving the validated 56% mode_2 rate to ≤10%.

**Architecture:** Four new pipeline modules (qualifier extractor, validator, rewriter, orchestrator) wired into `stream.js` after the existing grounding verifier, gated behind `MODE2_VERIFIER_ENABLED` flag. Schema additions to `chat_grounding_samples` capture per-chat telemetry. Bench-driven scale-back (no real-traffic shadow window — production launch is months away).

**Tech Stack:** Node 20, ES modules, OpenAI Responses API (gpt-5.4-mini), Supabase (admin client + schema migration), node:test. All within existing Emersus codebase patterns — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md`

---

## File map

| File | Status | Purpose |
|---|---|---|
| `supabase/20260427_mode2_telemetry.sql` | NEW | Schema migration: add mode2_* columns + `synthetic` flag |
| `api/emersus/pipeline/mode2-qualifier-extract.js` | NEW | Per-source open-ended K/V qualifier extraction with per-chat cache |
| `api/emersus/pipeline/mode2-validate.js` | NEW | Whole-response qualifier-preservation judge |
| `api/emersus/pipeline/mode2-rewriter.js` | NEW | Whole-response rewriter with two modes (preserve / preserve_or_hedge) |
| `api/emersus/pipeline/mode2-pipeline.js` | NEW | Orchestrator: extract → validate → conditional rewrites |
| `api/emersus/pipeline/mode2-flags.js` | NEW | Centralized feature-flag/config helpers (avoids scattering env reads) |
| `api/emersus/pipeline/stream.js` | MODIFY | Wire orchestrator into post-stream path; emit `verifying` + `prose_updated` SSE events |
| `api/emersus/pipeline/prompt.js` | MODIFY | Add Rule 8 (preserve-or-hedge instruction) |
| `shared/react-chat-app.js` | MODIFY | Handle `verifying` + `prose_updated` SSE events |
| `scripts/eval/mode2-bench.js` | NEW | Bench harness (gen / mqpv / ablation phases) |
| `scripts/mode2-trend.js` | NEW | Trend report from `chat_grounding_samples` |
| `scripts/lib/mode2-bench-metrics.js` | NEW | Pure aggregation helpers (testable) |
| `tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js` | NEW | Unit tests (parser + cache) |
| `tests/unit/api/emersus/pipeline/mode2-validate.test.js` | NEW | Unit tests (parser + judge mock) |
| `tests/unit/api/emersus/pipeline/mode2-rewriter.test.js` | NEW | Unit tests (length-ratio fallback + mode switching) |
| `tests/unit/api/emersus/pipeline/mode2-pipeline.test.js` | NEW | Unit tests (orchestrator with mocked stages) |
| `tests/unit/scripts/lib/mode2-bench-metrics.test.js` | NEW | Unit tests for aggregation |

---

## Task 1: Schema migration

**Files:**
- Create: `supabase/20260427_mode2_telemetry.sql`

The migration adds 14 columns to `chat_grounding_samples` (per spec §5) and a `synthetic` boolean flag. Per memory `project_supabase_admin_role.md`, prod migrations run via `psql -U supabase_admin` on Hetzner.

- [ ] **Step 1.1: Create the migration SQL**

```sql
-- supabase/20260427_mode2_telemetry.sql
-- Mode-2 Qualifier-Preservation Verifier (MQPV) telemetry columns.
-- Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md §5

ALTER TABLE chat_grounding_samples
  ADD COLUMN IF NOT EXISTS synthetic boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode2_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode2_rewrites_attempted smallint,
  ADD COLUMN IF NOT EXISTS mode2_initial_failures int,
  ADD COLUMN IF NOT EXISTS mode2_after_r1_failures int,
  ADD COLUMN IF NOT EXISTS mode2_final_failures int,
  ADD COLUMN IF NOT EXISTS mode2_extraction_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_validation_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_rewrite_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS mode2_extraction_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_validation_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_rewrite_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_total_latency_ms int,
  ADD COLUMN IF NOT EXISTS mode2_qualifiers_dropped_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS mode2_pre_prose text,
  ADD COLUMN IF NOT EXISTS mode2_post_prose text,
  ADD COLUMN IF NOT EXISTS mode2_validation_json jsonb;

-- Index for trend reports filtering synthetic vs real
CREATE INDEX IF NOT EXISTS idx_chat_grounding_samples_synthetic_created
  ON chat_grounding_samples (synthetic, created_at DESC);

-- Index for mode2_enabled filtering (early A/B comparison)
CREATE INDEX IF NOT EXISTS idx_chat_grounding_samples_mode2_enabled
  ON chat_grounding_samples (mode2_enabled, created_at DESC)
  WHERE mode2_enabled = true;

COMMENT ON COLUMN chat_grounding_samples.synthetic IS 'true = bench-generated row; false = real-prod sampled row';
COMMENT ON COLUMN chat_grounding_samples.mode2_enabled IS 'whether the MQPV pipeline ran for this chat';
COMMENT ON COLUMN chat_grounding_samples.mode2_qualifiers_dropped_breakdown IS '{[qualifier_type]: count} aggregated across all claims this chat';
```

- [ ] **Step 1.2: Apply locally to verify SQL is valid**

Migration is run on Hetzner only (single-DB stack — local dev points at prod). Validate by running it against prod via psql with `IF NOT EXISTS` guards making it idempotent:

```bash
ssh hetzner 'docker exec -u 0 supabase-db psql -U supabase_admin -d postgres' < supabase/20260427_mode2_telemetry.sql
```

Expected: ALTER TABLE and CREATE INDEX statements complete without error. (Per memory `feedback_migration_scp_conflict.md`, pipe-via-stdin is the right pattern, not scp.)

- [ ] **Step 1.3: Verify columns landed**

Run:
```bash
ssh hetzner 'docker exec -u 0 supabase-db psql -U supabase_admin -d postgres -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = '\''chat_grounding_samples'\'' AND column_name LIKE '\''mode2%'\''
ORDER BY ordinal_position;"'
```
Expected: 15 mode2_* rows returned (14 columns plus mode2_enabled, plus the synthetic column visible separately).

- [ ] **Step 1.4: Commit**

```bash
git add supabase/20260427_mode2_telemetry.sql
git commit -m "feat(grounding): mode2_* telemetry columns on chat_grounding_samples"
```

---

## Task 2: `mode2-flags.js` — centralized config

**Files:**
- Create: `api/emersus/pipeline/mode2-flags.js`

Why centralize: env reads sprinkled across modules become impossible to test (`process.env.MODE2_VERIFIER_ENABLED` mocked one place but not another). Single helper module with named exports.

- [ ] **Step 2.1: Write the file**

```js
// api/emersus/pipeline/mode2-flags.js
//
// Centralized feature-flag and config helpers for the Mode-2 Qualifier-
// Preservation Verifier (MQPV). All env reads happen here so tests can
// mock once and downstream modules read pure functions.

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return String(raw).toLowerCase() === "true";
}

function envNumber(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export function mode2VerifierEnabled() {
  return envFlag("MODE2_VERIFIER_ENABLED", false);
}

export function mode2Rewrite2Enabled() {
  // Whether the second rewrite (preserve-or-hedge fallback) is allowed.
  // Bench-driven scale-back may set this to false if telemetry shows
  // rewrite #2 rarely activates and rarely helps.
  return envFlag("MODE2_REWRITE_2_ENABLED", true);
}

export function mode2DisabledQualifiers() {
  // Comma-separated qualifier types to skip in the validator (e.g.,
  // "effect_size,sample_size"). Bench-driven scale-back fills this in.
  const raw = process.env.MODE2_DISABLED_QUALIFIERS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function mode2ExtractorModel() {
  return process.env.MODE2_EXTRACTOR_MODEL || "gpt-5.4-mini";
}

export function mode2ValidatorModel() {
  return process.env.MODE2_VALIDATOR_MODEL || "gpt-5.4-mini";
}

export function mode2RewriterModel() {
  return process.env.MODE2_REWRITER_MODEL || "gpt-5.4-mini";
}

export function mode2LengthRatioFloor() {
  return envNumber("MODE2_LENGTH_RATIO_FLOOR", 0.6);
}

export function mode2LengthRatioCeiling() {
  return envNumber("MODE2_LENGTH_RATIO_CEILING", 1.5);
}
```

- [ ] **Step 2.2: Verify syntax**

```bash
node --check api/emersus/pipeline/mode2-flags.js
```
Expected: no output (valid).

- [ ] **Step 2.3: Commit**

```bash
git add api/emersus/pipeline/mode2-flags.js
git commit -m "feat(mqpv): centralized feature-flag/config helpers"
```

---

## Task 3: `mode2-qualifier-extract.js` — per-source extractor

**Files:**
- Create: `api/emersus/pipeline/mode2-qualifier-extract.js`
- Create: `tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js`

Reuses the `callJudge` pattern from `claim-modes.js` (already shipped). Open-ended K/V output via gpt-5.4-mini. Per-chat cache as a Map.

- [ ] **Step 3.1: Write failing tests for the parser**

```js
// tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQualifierExtractionResponse,
  buildQualifierExtractor,
} from "../../../../../api/emersus/pipeline/mode2-qualifier-extract.js";

test("parser: well-formed JSON with multiple qualifiers", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"population":"trained men","dose":"5g/day","duration":"8 weeks"}}'
  );
  assert.equal(r.error, null);
  assert.deepEqual(r.qualifiers, {
    population: "trained men",
    dose: "5g/day",
    duration: "8 weeks",
  });
});

test("parser: ```json``` fences tolerated", () => {
  const r = parseQualifierExtractionResponse(
    '```json\n{"qualifiers":{"population":"x"}}\n```'
  );
  assert.equal(r.error, null);
  assert.equal(r.qualifiers.population, "x");
});

test("parser: empty qualifier dict is valid", () => {
  const r = parseQualifierExtractionResponse('{"qualifiers":{}}');
  assert.equal(r.error, null);
  assert.deepEqual(r.qualifiers, {});
});

test("parser: malformed JSON returns error + empty qualifiers", () => {
  const r = parseQualifierExtractionResponse("not json");
  assert.equal(r.error, "malformed_json");
  assert.deepEqual(r.qualifiers, {});
});

test("parser: non-string values coerced to strings", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"sample_size":24,"effect_size":0.07}}'
  );
  assert.equal(r.qualifiers.sample_size, "24");
  assert.equal(r.qualifiers.effect_size, "0.07");
});

test("parser: drops keys with empty values", () => {
  const r = parseQualifierExtractionResponse(
    '{"qualifiers":{"population":"trained men","dose":""}}'
  );
  assert.equal(r.qualifiers.population, "trained men");
  assert.ok(!("dose" in r.qualifiers));
});

test("buildQualifierExtractor: caches per source_id within instance", async () => {
  let callCount = 0;
  const mockCallJudge = async () => {
    callCount += 1;
    return '{"qualifiers":{"population":"trained men"}}';
  };
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  await extractor.extract({ source_id: 1, title: "t", excerpt: "e" }); // same source_id
  await extractor.extract({ source_id: 2, title: "t", excerpt: "e" });
  assert.equal(callCount, 2, "second call for source_id=1 should hit cache");
});

test("buildQualifierExtractor: judge errors fall back to empty qualifiers", async () => {
  const mockCallJudge = async () => { throw new Error("judge timeout"); };
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  const r = await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  assert.deepEqual(r.qualifiers, {});
  assert.match(r.error || "", /judge timeout/);
});

test("buildQualifierExtractor: tracks cost and latency per call", async () => {
  const mockCallJudge = async () => '{"qualifiers":{"population":"x"}}';
  const extractor = buildQualifierExtractor({ callJudge: mockCallJudge });
  const r = await extractor.extract({ source_id: 1, title: "t", excerpt: "e" });
  assert.ok(r.latency_ms >= 0);
  assert.ok(r.cost_usd >= 0);
});
```

- [ ] **Step 3.2: Run, expect FAIL**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js
```
Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3.3: Implement**

```js
// api/emersus/pipeline/mode2-qualifier-extract.js
//
// Per-source qualifier extractor for the Mode-2 Qualifier-Preservation
// Verifier. Reads (title, excerpt, abstract?, full_text?) of one cited
// source and asks gpt-5.4-mini to emit any qualifiers present in the
// source as an open-ended key-value dict. Caches per-source-id within
// a single chat (same source cited twice → one extraction).

import { mode2ExtractorModel } from "./mode2-flags.js";

export const QUALIFIER_EXTRACTION_PROMPT_VERSION = "qualifier-extract-v1";

const SYSTEM_PROMPT = [
  "You are a scientific abstract reader. Extract any QUALIFIERS the source's findings depend on.",
  "",
  "QUALIFIERS are conditions that limit or specify when/where the findings apply:",
  "  - population (trained men, elderly women, mice, etc.)",
  "  - intervention (creatine monohydrate, supervised exercise, etc.)",
  "  - comparator (vs placebo, vs control, vs another intervention)",
  "  - outcome (1RM bench press, hbA1c, time-to-exhaustion)",
  "  - dose (5g/day, 1000 mg, etc.)",
  "  - duration (8 weeks, 6 months, acute single bout)",
  "  - effect_size (+7%, p<0.05, hedges effect)",
  "  - study_design (RCT, meta-analysis, observational, animal model, mechanistic)",
  "  - sample_size (n=24, n=1120)",
  "  - other domain-specific qualifiers as relevant",
  "",
  "OUTPUT JSON only: {\"qualifiers\": {[key]: value}}. Use whatever keys best describe the source. Empty {} if no clear qualifiers.",
  "Use lowercase string values. If multiple values for one key, comma-separate (e.g. \"population\": \"trained men, untrained men\").",
  "",
  "Do NOT extract qualifiers that aren't actually in the source. Do NOT invent specifics.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 600 }) {
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
  if (!res.ok) throw new Error(`Extractor ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export function parseQualifierExtractionResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { qualifiers: {}, error: "malformed_json" };
  }
  if (!parsed || typeof parsed.qualifiers !== "object" || parsed.qualifiers === null) {
    return { qualifiers: {}, error: "malformed_json" };
  }
  const out = {};
  for (const [k, v] of Object.entries(parsed.qualifiers)) {
    if (v == null) continue;
    const sval = String(v).trim();
    if (!sval) continue;
    out[String(k).toLowerCase()] = sval;
  }
  return { qualifiers: out, error: null };
}

function buildUserPrompt({ title, excerpt, abstract, full_text }) {
  const parts = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (excerpt) parts.push(`EXCERPT/CHUNK:\n${excerpt}`);
  if (abstract && abstract !== excerpt) parts.push(`ABSTRACT:\n${abstract}`);
  if (full_text) parts.push(`FULL TEXT (first 8K chars):\n${String(full_text).slice(0, 8000)}`);
  parts.push("\nReturn JSON only.");
  return parts.join("\n\n");
}

// Rough cost estimate. Input: ~system 250 tok + user up to 8K chars (~2K tok).
// Output: up to 600 tokens. gpt-5.4-mini at ~$0.15/M input + $0.60/M output.
function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export function buildQualifierExtractor({
  callJudge = defaultCallJudge,
  model = mode2ExtractorModel(),
} = {}) {
  const cache = new Map();
  return {
    async extract(source) {
      const sid = source?.source_id ?? source?.id;
      if (sid != null && cache.has(sid)) {
        return { ...cache.get(sid), cached: true };
      }
      const t0 = Date.now();
      const userPrompt = buildUserPrompt(source);
      let raw, error = null, parsed = { qualifiers: {} };
      try {
        raw = await callJudge({
          system: SYSTEM_PROMPT,
          user: userPrompt,
          model,
        });
        parsed = parseQualifierExtractionResponse(raw);
        if (parsed.error) error = parsed.error;
      } catch (err) {
        error = err.message || String(err);
      }
      // Heuristic token estimate (we don't have usage from the API in our path).
      const approxInTok = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);
      const approxOutTok = Math.ceil((raw || "").length / 4);
      const result = {
        qualifiers: parsed.qualifiers || {},
        error,
        cost_usd: estimateCostUsd({ inputTokens: approxInTok, outputTokens: approxOutTok }),
        latency_ms: Date.now() - t0,
        prompt_version: QUALIFIER_EXTRACTION_PROMPT_VERSION,
      };
      if (sid != null) cache.set(sid, result);
      return result;
    },
    _cacheSize() { return cache.size; },
  };
}
```

- [ ] **Step 3.4: Run tests, expect 8 PASS**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js
```
Expected: 8 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add api/emersus/pipeline/mode2-qualifier-extract.js \
  tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js
git commit -m "feat(mqpv): per-source qualifier extractor with per-chat cache"
```

---

## Task 4: `mode2-validate.js` — qualifier preservation judge

**Files:**
- Create: `api/emersus/pipeline/mode2-validate.js`
- Create: `tests/unit/api/emersus/pipeline/mode2-validate.test.js`

- [ ] **Step 4.1: Write failing tests**

```js
// tests/unit/api/emersus/pipeline/mode2-validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseValidationResponse,
  validateQualifierPreservation,
  computeQualifiersDroppedBreakdown,
} from "../../../../../api/emersus/pipeline/mode2-validate.js";

test("parseValidationResponse: well-formed", () => {
  const r = parseValidationResponse(JSON.stringify({
    per_claim: [
      { claim_text: "creatine improves strength", source_idx: 2, missing: ["population", "dose"] },
      { claim_text: "vitamin D helps athletes", source_idx: 4, missing: [] },
    ],
  }));
  assert.equal(r.error, null);
  assert.equal(r.per_claim.length, 2);
  assert.deepEqual(r.per_claim[0].missing, ["population", "dose"]);
});

test("parseValidationResponse: ```json fences tolerated", () => {
  const r = parseValidationResponse('```json\n{"per_claim":[]}\n```');
  assert.equal(r.error, null);
  assert.deepEqual(r.per_claim, []);
});

test("parseValidationResponse: malformed", () => {
  const r = parseValidationResponse("not json");
  assert.equal(r.error, "malformed_json");
  assert.deepEqual(r.per_claim, []);
});

test("parseValidationResponse: drops invalid entries (no claim_text)", () => {
  const r = parseValidationResponse(JSON.stringify({
    per_claim: [
      { claim_text: "", source_idx: 1, missing: ["population"] },
      { claim_text: "valid claim", source_idx: 2, missing: ["dose"] },
    ],
  }));
  assert.equal(r.per_claim.length, 1);
  assert.equal(r.per_claim[0].claim_text, "valid claim");
});

test("computeQualifiersDroppedBreakdown sums by qualifier type", () => {
  const perClaim = [
    { claim_text: "a", source_idx: 1, missing: ["population", "dose"] },
    { claim_text: "b", source_idx: 1, missing: ["population", "duration"] },
    { claim_text: "c", source_idx: 2, missing: [] },
  ];
  const b = computeQualifiersDroppedBreakdown(perClaim);
  assert.equal(b.population, 2);
  assert.equal(b.dose, 1);
  assert.equal(b.duration, 1);
  assert.ok(!("study_design" in b));
});

test("validateQualifierPreservation: returns no missing when all preserved", async () => {
  const mockCallJudge = async () => JSON.stringify({ per_claim: [] });
  const r = await validateQualifierPreservation({
    prose: "creatine 5g/day for 8 weeks improved 1RM in trained men citesrc1",
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day" } }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.total_missing, 0);
  assert.deepEqual(r.qualifiers_dropped_breakdown, {});
});

test("validateQualifierPreservation: returns missing list when judge flags drops", async () => {
  const mockCallJudge = async () => JSON.stringify({
    per_claim: [
      { claim_text: "creatine improves strength", source_idx: 1, missing: ["population", "dose"] },
    ],
  });
  const r = await validateQualifierPreservation({
    prose: "creatine improves strength citesrc1",
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day" } }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.total_missing, 2);
  assert.equal(r.per_claim_missing.length, 1);
  assert.deepEqual(r.qualifiers_dropped_breakdown, { population: 1, dose: 1 });
});

test("validateQualifierPreservation: judge error returns empty result with error", async () => {
  const mockCallJudge = async () => { throw new Error("judge timeout"); };
  const r = await validateQualifierPreservation({
    prose: "x",
    citedSources: [{ id: 1, qualifiers: {} }],
    callJudge: mockCallJudge,
  });
  assert.equal(r.error, "judge timeout");
  assert.equal(r.total_missing, 0);
});

test("validateQualifierPreservation: skips disabled qualifier types", async () => {
  // The judge returned effect_size as missing, but our config disables that type.
  const mockCallJudge = async () => JSON.stringify({
    per_claim: [
      { claim_text: "x", source_idx: 1, missing: ["effect_size", "population"] },
    ],
  });
  const r = await validateQualifierPreservation({
    prose: "x",
    citedSources: [{ id: 1, qualifiers: {} }],
    callJudge: mockCallJudge,
    disabledQualifiers: ["effect_size"],
  });
  // population is still missing, but effect_size was filtered out
  assert.equal(r.total_missing, 1);
  assert.equal(r.qualifiers_dropped_breakdown.population, 1);
  assert.ok(!("effect_size" in r.qualifiers_dropped_breakdown));
});
```

- [ ] **Step 4.2: Run, expect FAIL**

- [ ] **Step 4.3: Implement**

```js
// api/emersus/pipeline/mode2-validate.js
//
// Whole-response qualifier-preservation judge for MQPV. Takes the
// streamed prose plus per-source qualifier dicts and returns the set
// of (claim, source_idx, missing_qualifiers) deltas. One LLM call per
// chat regardless of claim count.

import { mode2ValidatorModel, mode2DisabledQualifiers } from "./mode2-flags.js";

export const VALIDATION_PROMPT_VERSION = "qualifier-validate-v1";

const SYSTEM_PROMPT = [
  "You audit whether a chat response preserves the qualifiers from cited sources.",
  "",
  "Each cited source has a qualifier dict (e.g. {population: 'trained men', dose: '5g/day'}).",
  "For each empirical claim in the response that carries a citation, decide whether the source's qualifiers are preserved in the claim text.",
  "",
  "PRESERVED means EITHER:",
  "  (a) the qualifier value (or a clear semantic equivalent / paraphrase) appears in the claim text — e.g. claim says 'in trained men' and source qualifier says population: 'resistance-trained males', that's preserved.",
  "  (b) the claim explicitly hedges that the qualifier limits generalization — e.g. claim says 'in this trained-men population, generalization beyond is uncertain'.",
  "",
  "DROPPED means: the qualifier is in the source but the claim states the finding without the qualifier or hedge.",
  "  Example: source qualifier population='trained men' + dose='5g/day' for 8 weeks; claim says 'creatine improves strength' → BOTH population and dose dropped.",
  "",
  "Skip claims that don't carry a citation marker. Skip meta-statements about the evidence itself.",
  "",
  "Output JSON only: {\"per_claim\": [{\"claim_text\": \"...\", \"source_idx\": N, \"missing\": [\"population\", \"dose\", ...]}, ...]}",
  "If no claims have missing qualifiers, return {\"per_claim\": []}.",
  "Do not include any prose outside the JSON.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 1500 }) {
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
  if (!res.ok) throw new Error(`Validator ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export function parseValidationResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { per_claim: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.per_claim)) {
    return { per_claim: [], error: "malformed_json" };
  }
  const out = parsed.per_claim
    .map((c) => ({
      claim_text: String(c?.claim_text || "").trim(),
      source_idx: Number.isInteger(c?.source_idx) ? c.source_idx : null,
      missing: Array.isArray(c?.missing) ? c.missing.map(String).filter(Boolean) : [],
    }))
    .filter((c) => c.claim_text);
  return { per_claim: out, error: null };
}

export function computeQualifiersDroppedBreakdown(perClaim) {
  const out = {};
  for (const c of perClaim || []) {
    for (const q of c.missing || []) {
      out[q] = (out[q] || 0) + 1;
    }
  }
  return out;
}

function buildSourcesBlock(citedSources) {
  return citedSources
    .map((s) => `[${s.id}] qualifiers: ${JSON.stringify(s.qualifiers || {})}`)
    .join("\n");
}

function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export async function validateQualifierPreservation({
  prose,
  citedSources,
  callJudge = defaultCallJudge,
  model = mode2ValidatorModel(),
  disabledQualifiers = mode2DisabledQualifiers(),
} = {}) {
  const t0 = Date.now();
  if (!prose || !citedSources || citedSources.length === 0) {
    return {
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0,
      latency_ms: 0,
      raw_response: null,
      error: null,
    };
  }
  const userPrompt = [
    "RESPONSE PROSE:",
    prose,
    "",
    "CITED SOURCE QUALIFIERS:",
    buildSourcesBlock(citedSources),
    "",
    "Return JSON only.",
  ].join("\n");

  let raw = null;
  let error = null;
  let parsed = { per_claim: [] };
  try {
    raw = await callJudge({ system: SYSTEM_PROMPT, user: userPrompt, model });
    parsed = parseValidationResponse(raw);
    if (parsed.error) error = parsed.error;
  } catch (err) {
    error = err.message || String(err);
  }

  // Filter out disabled qualifier types
  const disabledSet = new Set(disabledQualifiers);
  const filtered = parsed.per_claim.map((c) => ({
    ...c,
    missing: c.missing.filter((q) => !disabledSet.has(q)),
  }));
  const claimsWithMissing = filtered.filter((c) => c.missing.length > 0);

  const breakdown = computeQualifiersDroppedBreakdown(claimsWithMissing);
  const totalMissing = claimsWithMissing.reduce((s, c) => s + c.missing.length, 0);

  const approxInTok = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);
  const approxOutTok = Math.ceil((raw || "").length / 4);

  return {
    per_claim_missing: claimsWithMissing,
    total_missing: totalMissing,
    qualifiers_dropped_breakdown: breakdown,
    cost_usd: estimateCostUsd({ inputTokens: approxInTok, outputTokens: approxOutTok }),
    latency_ms: Date.now() - t0,
    raw_response: raw,
    prompt_version: VALIDATION_PROMPT_VERSION,
    error,
  };
}
```

- [ ] **Step 4.4: Run tests, expect 9 PASS**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-validate.test.js
```

- [ ] **Step 4.5: Commit**

```bash
git add api/emersus/pipeline/mode2-validate.js \
  tests/unit/api/emersus/pipeline/mode2-validate.test.js
git commit -m "feat(mqpv): whole-response qualifier-preservation validator"
```

---

## Task 5: `mode2-rewriter.js` — whole-response rewriter (two modes)

**Files:**
- Create: `api/emersus/pipeline/mode2-rewriter.js`
- Create: `tests/unit/api/emersus/pipeline/mode2-rewriter.test.js`

- [ ] **Step 5.1: Write failing tests**

```js
// tests/unit/api/emersus/pipeline/mode2-rewriter.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteForQualifierPreservation,
  isLengthRatioAcceptable,
} from "../../../../../api/emersus/pipeline/mode2-rewriter.js";

test("isLengthRatioAcceptable: accepts ratios in [0.6, 1.5]", () => {
  assert.equal(isLengthRatioAcceptable(100, 100), true);
  assert.equal(isLengthRatioAcceptable(100, 60), true);
  assert.equal(isLengthRatioAcceptable(100, 150), true);
});

test("isLengthRatioAcceptable: rejects ratios outside [0.6, 1.5]", () => {
  assert.equal(isLengthRatioAcceptable(100, 50), false);
  assert.equal(isLengthRatioAcceptable(100, 200), false);
});

test("isLengthRatioAcceptable: handles zero original gracefully", () => {
  assert.equal(isLengthRatioAcceptable(0, 100), false);
});

test("rewriteForQualifierPreservation: mode=preserve produces rewrite", async () => {
  const mockCallJudge = async ({ system }) => {
    assert.match(system, /preserve.*qualifier/i);
    assert.doesNotMatch(system, /OR explicitly hedge/i);
    return "Creatine 5g/day in trained men over 8 weeks improved 1RM by 7% citesrc1.";
  };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Creatine improves strength citesrc1.",
    validationResult: {
      per_claim_missing: [
        { claim_text: "Creatine improves strength", source_idx: 1, missing: ["population", "dose", "duration"] },
      ],
    },
    citedSources: [{ id: 1, qualifiers: { population: "trained men", dose: "5g/day", duration: "8 weeks" } }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.match(r.prose, /trained men/i);
  assert.equal(r.length_ratio_acceptable, true);
});

test("rewriteForQualifierPreservation: mode=preserve_or_hedge passes hedge instruction", async () => {
  let observedSystem = null;
  const mockCallJudge = async ({ system }) => {
    observedSystem = system;
    return "Creatine improves strength; the cited source is in trained men, generalization beyond is uncertain citesrc1.";
  };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Creatine improves strength citesrc1.",
    validationResult: { per_claim_missing: [] },
    citedSources: [{ id: 1, qualifiers: { population: "trained men" } }],
    mode: "preserve_or_hedge",
    callJudge: mockCallJudge,
  });
  assert.match(observedSystem, /preserve.*OR explicitly hedge/i);
  assert.match(r.prose, /uncertain/i);
});

test("rewriteForQualifierPreservation: length-ratio fallback returns original", async () => {
  const mockCallJudge = async () => "x"; // wildly short
  const r = await rewriteForQualifierPreservation({
    originalProse: "This is a fairly long original prose response that should not be replaced by a much shorter rewrite.",
    validationResult: { per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["dose"] }] },
    citedSources: [{ id: 1, qualifiers: { dose: "5g" } }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.equal(r.length_ratio_acceptable, false);
  assert.equal(r.prose, "This is a fairly long original prose response that should not be replaced by a much shorter rewrite.");
  assert.match(r.error || "", /length_ratio_out_of_bounds/);
});

test("rewriteForQualifierPreservation: judge error returns original prose", async () => {
  const mockCallJudge = async () => { throw new Error("rewrite timeout"); };
  const r = await rewriteForQualifierPreservation({
    originalProse: "Original.",
    validationResult: { per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["dose"] }] },
    citedSources: [{ id: 1, qualifiers: {} }],
    mode: "preserve",
    callJudge: mockCallJudge,
  });
  assert.equal(r.prose, "Original.");
  assert.match(r.error || "", /rewrite timeout/);
});
```

- [ ] **Step 5.2: Run, expect FAIL**

- [ ] **Step 5.3: Implement**

```js
// api/emersus/pipeline/mode2-rewriter.js
//
// Whole-response rewriter for MQPV. Two modes:
//   - "preserve": rewrite preserving all flagged-missing qualifiers
//   - "preserve_or_hedge": preserve OR explicitly hedge that qualifier
//     limits generalization
//
// Length-ratio fallback: if the rewrite is wildly shorter (<60%) or longer
// (>150%) than the original, treat as suspicious and return original prose.

import {
  mode2RewriterModel,
  mode2LengthRatioFloor,
  mode2LengthRatioCeiling,
} from "./mode2-flags.js";

export const REWRITE_PROMPT_VERSION = "qualifier-rewrite-v1";

const SYSTEM_PROMPT_PRESERVE = [
  "You are an editor. Rewrite the chat response below to preserve qualifiers from cited sources that are currently dropped.",
  "",
  "RULES:",
  "  1. For each flagged claim, ensure the listed missing qualifier values appear (or have clear semantic equivalents) in the claim text.",
  "  2. Maintain natural prose flow. Keep the original message structure, tone, and ordering.",
  "  3. Do not invent qualifiers not in the source. Only add what was flagged missing.",
  "  4. Preserve all citation markers (citesrc1, citesrc2, etc.) exactly as they appear.",
  "  5. Do not add new claims that weren't in the original. Only correct qualifier preservation on existing claims.",
  "",
  "Return ONLY the rewritten response prose. No JSON wrapper, no commentary, no preamble.",
].join("\n");

const SYSTEM_PROMPT_PRESERVE_OR_HEDGE = [
  "You are an editor. Rewrite the chat response below to either preserve qualifiers from cited sources OR explicitly hedge that the qualifier limits generalization.",
  "",
  "RULES:",
  "  1. For each flagged claim, EITHER:",
  "      (a) include the missing qualifier value in the claim text (e.g. 'in trained men over 8 weeks'),",
  "      OR",
  "      (b) add an explicit hedge: 'the cited source is in {qualifier_value}, generalization beyond is uncertain'.",
  "  2. Choose whichever reads more naturally. Prefer preservation; hedge only when preservation would break voice.",
  "  3. Maintain natural prose flow. Keep the original message structure, tone, and ordering.",
  "  4. Preserve all citation markers (citesrc1, citesrc2, etc.) exactly as they appear.",
  "  5. Do not invent qualifiers not in the source.",
  "",
  "Return ONLY the rewritten response prose. No JSON wrapper, no commentary, no preamble.",
].join("\n");

async function defaultCallJudge({ system, user, model, maxOutputTokens = 2500 }) {
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
  if (!res.ok) throw new Error(`Rewriter ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export function isLengthRatioAcceptable(originalLength, newLength) {
  if (originalLength <= 0) return false;
  const ratio = newLength / originalLength;
  return ratio >= mode2LengthRatioFloor() && ratio <= mode2LengthRatioCeiling();
}

function buildUserPrompt({ originalProse, validationResult, citedSources }) {
  const sourcesBlock = citedSources
    .map((s) => `[${s.id}] qualifiers: ${JSON.stringify(s.qualifiers || {})}`)
    .join("\n");
  const flaggedBlock = (validationResult.per_claim_missing || [])
    .map((c) => `- claim: "${c.claim_text}" (citesrc${c.source_idx}); missing: ${c.missing.join(", ")}`)
    .join("\n") || "(none flagged — preserve qualifiers as a precaution)";
  return [
    "ORIGINAL RESPONSE:",
    originalProse,
    "",
    "CITED SOURCE QUALIFIERS:",
    sourcesBlock,
    "",
    "FLAGGED CLAIMS WITH MISSING QUALIFIERS:",
    flaggedBlock,
    "",
    "Rewrite the response per the rules above. Return only the prose.",
  ].join("\n");
}

function estimateCostUsd({ inputTokens, outputTokens }) {
  return inputTokens * 0.15e-6 + outputTokens * 0.60e-6;
}

export async function rewriteForQualifierPreservation({
  originalProse,
  validationResult,
  citedSources,
  mode = "preserve",
  callJudge = defaultCallJudge,
  model = mode2RewriterModel(),
}) {
  const t0 = Date.now();
  if (!originalProse) {
    return {
      prose: originalProse,
      length_ratio_acceptable: true,
      cost_usd: 0,
      latency_ms: 0,
      error: null,
      mode,
    };
  }

  const system = mode === "preserve_or_hedge"
    ? SYSTEM_PROMPT_PRESERVE_OR_HEDGE
    : SYSTEM_PROMPT_PRESERVE;
  const user = buildUserPrompt({ originalProse, validationResult, citedSources });

  let rewritten = null;
  let error = null;
  try {
    rewritten = await callJudge({ system, user, model });
    rewritten = String(rewritten || "").trim();
  } catch (err) {
    error = err.message || String(err);
    return {
      prose: originalProse,
      length_ratio_acceptable: false,
      cost_usd: 0,
      latency_ms: Date.now() - t0,
      error,
      mode,
      prompt_version: REWRITE_PROMPT_VERSION,
    };
  }

  const ratioOk = isLengthRatioAcceptable(originalProse.length, rewritten.length);
  if (!ratioOk) {
    return {
      prose: originalProse,
      length_ratio_acceptable: false,
      cost_usd: estimateCostUsd({
        inputTokens: Math.ceil((system.length + user.length) / 4),
        outputTokens: Math.ceil((rewritten || "").length / 4),
      }),
      latency_ms: Date.now() - t0,
      error: "length_ratio_out_of_bounds",
      mode,
      prompt_version: REWRITE_PROMPT_VERSION,
    };
  }

  return {
    prose: rewritten,
    length_ratio_acceptable: true,
    cost_usd: estimateCostUsd({
      inputTokens: Math.ceil((system.length + user.length) / 4),
      outputTokens: Math.ceil(rewritten.length / 4),
    }),
    latency_ms: Date.now() - t0,
    error: null,
    mode,
    prompt_version: REWRITE_PROMPT_VERSION,
  };
}
```

- [ ] **Step 5.4: Run tests, expect 7 PASS**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-rewriter.test.js
```

- [ ] **Step 5.5: Commit**

```bash
git add api/emersus/pipeline/mode2-rewriter.js \
  tests/unit/api/emersus/pipeline/mode2-rewriter.test.js
git commit -m "feat(mqpv): whole-response rewriter (preserve / preserve-or-hedge)"
```

---

## Task 6: `mode2-pipeline.js` — orchestrator

**Files:**
- Create: `api/emersus/pipeline/mode2-pipeline.js`
- Create: `tests/unit/api/emersus/pipeline/mode2-pipeline.test.js`

The orchestrator is the entry point `stream.js` calls. It runs extract → validate → conditional rewrites → re-validate, and returns telemetry. All sub-functions are dependency-injectable for testing.

- [ ] **Step 6.1: Write failing tests with all sub-functions mocked**

```js
// tests/unit/api/emersus/pipeline/mode2-pipeline.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runMode2Pipeline } from "../../../../../api/emersus/pipeline/mode2-pipeline.js";

function makeCtx({ prose = "", evidence = [] } = {}) {
  return {
    prose,
    evidence: { items: evidence },
  };
}

const MOCK_SOURCE = (id) => ({
  id,
  pmid: 1000 + id,
  title: `Source ${id}`,
  excerpt: `excerpt ${id}`,
  abstract: `abstract ${id}`,
  full_text: null,
});

test("returns no rewrite when validation passes (no missing)", async () => {
  const ctx = makeCtx({
    prose: "Original prose citesrc1.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "x" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0.0001,
      latency_ms: 50,
    }),
    rewrite: async () => { throw new Error("should not be called"); },
  });
  assert.equal(r.rewritten_prose, null);
  assert.equal(r.telemetry.rewrites_attempted, 0);
  assert.equal(r.telemetry.initial_failures, 0);
  assert.equal(r.telemetry.final_failures, 0);
});

test("rewrite #1 succeeds, no rewrite #2 needed", async () => {
  const ctx = makeCtx({
    prose: "Original creatine improves strength citesrc1.",
    evidence: [MOCK_SOURCE(1)],
  });
  let validateCalls = 0;
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => {
      validateCalls += 1;
      if (validateCalls === 1) {
        return {
          per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
          total_missing: 1,
          qualifiers_dropped_breakdown: { population: 1 },
          cost_usd: 0.0001,
          latency_ms: 50,
        };
      }
      // After rewrite #1 — no missing
      return {
        per_claim_missing: [],
        total_missing: 0,
        qualifiers_dropped_breakdown: {},
        cost_usd: 0.0001,
        latency_ms: 50,
      };
    },
    rewrite: async () => ({
      prose: "Rewritten with trained men citesrc1.",
      length_ratio_acceptable: true,
      cost_usd: 0.001,
      latency_ms: 1000,
    }),
  });
  assert.equal(r.rewritten_prose, "Rewritten with trained men citesrc1.");
  assert.equal(r.telemetry.rewrites_attempted, 1);
  assert.equal(r.telemetry.initial_failures, 1);
  assert.equal(r.telemetry.after_r1_failures, 0);
  assert.equal(r.telemetry.final_failures, 0);
});

test("rewrite #1 still has missing → rewrite #2 fires (preserve_or_hedge)", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  let validateCalls = 0;
  let rewriteModes = [];
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => {
      validateCalls += 1;
      // initial: 1 missing; after r1: still 1 missing; after r2: 0
      if (validateCalls === 3) {
        return { per_claim_missing: [], total_missing: 0, qualifiers_dropped_breakdown: {}, cost_usd: 0.0001, latency_ms: 50 };
      }
      return {
        per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
        total_missing: 1,
        qualifiers_dropped_breakdown: { population: 1 },
        cost_usd: 0.0001,
        latency_ms: 50,
      };
    },
    rewrite: async ({ mode }) => {
      rewriteModes.push(mode);
      return {
        prose: "Rewritten with hedge.",
        length_ratio_acceptable: true,
        cost_usd: 0.001,
        latency_ms: 1000,
      };
    },
  });
  assert.deepEqual(rewriteModes, ["preserve", "preserve_or_hedge"]);
  assert.equal(r.telemetry.rewrites_attempted, 2);
  assert.equal(r.telemetry.after_r1_failures, 1);
  assert.equal(r.telemetry.final_failures, 0);
});

test("MODE2_REWRITE_2_ENABLED=false skips rewrite #2", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  let rewriteCount = 0;
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
      total_missing: 1,
      qualifiers_dropped_breakdown: { population: 1 },
      cost_usd: 0.0001,
      latency_ms: 50,
    }),
    rewrite: async () => {
      rewriteCount += 1;
      return {
        prose: "Rewritten still missing.",
        length_ratio_acceptable: true,
        cost_usd: 0.001,
        latency_ms: 1000,
      };
    },
    rewrite2Enabled: false,
  });
  assert.equal(rewriteCount, 1, "only rewrite #1 should fire");
  assert.equal(r.telemetry.rewrites_attempted, 1);
});

test("validator error: ship original, no rewrites", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: {}, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0,
      latency_ms: 0,
      error: "validator timeout",
    }),
    rewrite: async () => { throw new Error("should not be called"); },
  });
  assert.equal(r.rewritten_prose, null);
  assert.equal(r.telemetry.rewrites_attempted, 0);
  assert.match(r.telemetry.errors?.validation || "", /validator timeout/);
});

test("rewrite length-ratio fallback ships original prose", async () => {
  const ctx = makeCtx({
    prose: "This is a fairly long original prose that should not be replaced by a tiny rewrite.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "x" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
      total_missing: 1,
      qualifiers_dropped_breakdown: { population: 1 },
      cost_usd: 0,
      latency_ms: 0,
    }),
    rewrite: async () => ({
      prose: "tiny",
      length_ratio_acceptable: false,
      cost_usd: 0.001,
      latency_ms: 1000,
      error: "length_ratio_out_of_bounds",
    }),
  });
  // rewrite returned bad output → keep original
  assert.equal(r.rewritten_prose, null);
  assert.match(r.telemetry.errors?.rewrite_1 || "", /length_ratio/);
});
```

- [ ] **Step 6.2: Run, expect FAIL**

- [ ] **Step 6.3: Implement**

```js
// api/emersus/pipeline/mode2-pipeline.js
//
// Orchestrator for the Mode-2 Qualifier-Preservation Verifier.
// Runs: extract qualifiers → validate prose → conditional rewrites → re-validate.
// All sub-functions are dependency-injectable for testing.

import { buildQualifierExtractor } from "./mode2-qualifier-extract.js";
import { validateQualifierPreservation } from "./mode2-validate.js";
import { rewriteForQualifierPreservation } from "./mode2-rewriter.js";
import { mode2Rewrite2Enabled } from "./mode2-flags.js";

/**
 * Run the MQPV pipeline against a chat context.
 *
 * @param {Object} ctx — emersus pipeline ctx with ctx.prose + ctx.evidence.items
 * @param {Object} [deps] — for testing
 * @param {Object} [deps.extractor] — { extract(source) } pre-built (allows custom callJudge)
 * @param {Function} [deps.validate] — validateQualifierPreservation
 * @param {Function} [deps.rewrite] — rewriteForQualifierPreservation
 * @param {boolean} [deps.rewrite2Enabled] — override env flag
 * @returns {Promise<{ rewritten_prose: string|null, telemetry: object }>}
 */
export async function runMode2Pipeline(ctx, deps = {}) {
  const t0 = Date.now();
  const evidenceItems = ctx?.evidence?.items || [];
  const prose = ctx?.prose || "";

  const extractor = deps.extractor || buildQualifierExtractor();
  const validate = deps.validate || validateQualifierPreservation;
  const rewrite = deps.rewrite || rewriteForQualifierPreservation;
  const rewrite2Enabled = deps.rewrite2Enabled !== undefined ? deps.rewrite2Enabled : mode2Rewrite2Enabled();

  const telemetry = {
    rewrites_attempted: 0,
    initial_failures: 0,
    after_r1_failures: null,
    final_failures: 0,
    extraction_cost_usd: 0,
    validation_cost_usd: 0,
    rewrite_cost_usd: 0,
    extraction_latency_ms: 0,
    validation_latency_ms: 0,
    rewrite_latency_ms: 0,
    total_latency_ms: 0,
    qualifiers_dropped_breakdown: {},
    validation_json: null,
    errors: {},
  };

  if (!prose || evidenceItems.length === 0) {
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Phase 1: extract qualifiers per cited source (parallel)
  const extractStart = Date.now();
  const sourceWithIdx = evidenceItems.map((it, i) => ({
    ...it,
    source_id: i + 1,
    id: i + 1,
  }));
  const extractionResults = await Promise.all(
    sourceWithIdx.map((s) => extractor.extract(s))
  );
  telemetry.extraction_latency_ms = Date.now() - extractStart;
  for (const e of extractionResults) {
    telemetry.extraction_cost_usd += e.cost_usd || 0;
  }
  const citedSources = sourceWithIdx.map((s, i) => ({
    id: s.id,
    qualifiers: extractionResults[i]?.qualifiers || {},
  }));

  // Phase 2: initial validation
  const v0Start = Date.now();
  const v0 = await validate({ prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v0Start;
  telemetry.validation_cost_usd += v0.cost_usd || 0;
  telemetry.initial_failures = v0.total_missing || 0;
  telemetry.qualifiers_dropped_breakdown = v0.qualifiers_dropped_breakdown || {};
  telemetry.validation_json = v0;
  if (v0.error) telemetry.errors.validation = v0.error;

  if (v0.error || telemetry.initial_failures === 0) {
    telemetry.final_failures = telemetry.initial_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Phase 3: rewrite #1 (preserve)
  const r1Start = Date.now();
  const r1 = await rewrite({
    originalProse: prose,
    validationResult: v0,
    citedSources,
    mode: "preserve",
  });
  telemetry.rewrite_latency_ms += Date.now() - r1Start;
  telemetry.rewrite_cost_usd += r1.cost_usd || 0;
  telemetry.rewrites_attempted = 1;
  if (r1.error) telemetry.errors.rewrite_1 = r1.error;

  if (r1.error || !r1.length_ratio_acceptable) {
    // Rewrite failed; ship original
    telemetry.after_r1_failures = telemetry.initial_failures;
    telemetry.final_failures = telemetry.initial_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Re-validate after rewrite #1
  const v1Start = Date.now();
  const v1 = await validate({ prose: r1.prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v1Start;
  telemetry.validation_cost_usd += v1.cost_usd || 0;
  telemetry.after_r1_failures = v1.total_missing || 0;

  if (v1.total_missing === 0 || !rewrite2Enabled) {
    telemetry.final_failures = telemetry.after_r1_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: r1.prose, telemetry };
  }

  // Phase 4: rewrite #2 (preserve_or_hedge)
  const r2Start = Date.now();
  const r2 = await rewrite({
    originalProse: r1.prose,
    validationResult: v1,
    citedSources,
    mode: "preserve_or_hedge",
  });
  telemetry.rewrite_latency_ms += Date.now() - r2Start;
  telemetry.rewrite_cost_usd += r2.cost_usd || 0;
  telemetry.rewrites_attempted = 2;
  if (r2.error) telemetry.errors.rewrite_2 = r2.error;

  if (r2.error || !r2.length_ratio_acceptable) {
    // Rewrite #2 failed; ship rewrite #1's output
    telemetry.final_failures = telemetry.after_r1_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: r1.prose, telemetry };
  }

  // Re-validate after rewrite #2 (informational only)
  const v2Start = Date.now();
  const v2 = await validate({ prose: r2.prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v2Start;
  telemetry.validation_cost_usd += v2.cost_usd || 0;
  telemetry.final_failures = v2.total_missing || 0;
  telemetry.total_latency_ms = Date.now() - t0;
  return { rewritten_prose: r2.prose, telemetry };
}
```

- [ ] **Step 6.4: Run tests, expect 6 PASS**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-pipeline.test.js
```

- [ ] **Step 6.5: Commit**

```bash
git add api/emersus/pipeline/mode2-pipeline.js \
  tests/unit/api/emersus/pipeline/mode2-pipeline.test.js
git commit -m "feat(mqpv): orchestrator with retry-with-hedge fallback"
```

---

## Task 7: Wire orchestrator into `stream.js`

**Files:**
- Modify: `api/emersus/pipeline/stream.js`

The hook point is right after the existing `verifyAnswerGrounding` call (around line 507). Two SSE events (`verifying`, `prose_updated`) emitted when MQPV is enabled and runs.

- [ ] **Step 7.1: Add imports + helper**

In `api/emersus/pipeline/stream.js`, add at the top alongside existing imports:

```js
import { runMode2Pipeline } from "./mode2-pipeline.js";
import { mode2VerifierEnabled } from "./mode2-flags.js";
```

- [ ] **Step 7.2: Insert MQPV call after grounding verifier in finalize sequence**

Find the existing line (around 505-511):
```js
ctx.prose = state.proseBuffer;
ctx.sources = formatSources(ctx.evidence?.items || []);
ctx.grounding = verifyAnswerGrounding({
  answerText: ctx.prose,
  evidenceItems: ctx.evidence?.items || [],
  mode: groundingEnforcementEnabled() ? "citation" : "legacy",
});
```

Replace with (the addition is the `if (mode2VerifierEnabled())` block plus the SSE events):

```js
ctx.prose = state.proseBuffer;
ctx.sources = formatSources(ctx.evidence?.items || []);
ctx.grounding = verifyAnswerGrounding({
  answerText: ctx.prose,
  evidenceItems: ctx.evidence?.items || [],
  mode: groundingEnforcementEnabled() ? "citation" : "legacy",
});

// Mode-2 Qualifier-Preservation Verifier (MQPV).
// Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md
// Runs after grounding verifier; rewrites prose if cited claims dropped
// source qualifiers. Flag-gated (default off).
if (mode2VerifierEnabled() && (ctx.evidence?.items?.length || 0) > 0) {
  // Tell the client we're verifying so it can show a "checking sources" indicator
  // on the just-streamed prose.
  sendSSE(res, { type: "verifying" });
  try {
    const mqpv = await runMode2Pipeline(ctx);
    ctx.mode2 = mqpv.telemetry;
    ctx.mode2_pre_prose = ctx.prose;
    if (mqpv.rewritten_prose) {
      ctx.prose = mqpv.rewritten_prose;
      ctx.mode2_post_prose = ctx.prose;
      // Re-run grounding verifier so the badge reflects the rewritten prose.
      ctx.grounding = verifyAnswerGrounding({
        answerText: ctx.prose,
        evidenceItems: ctx.evidence?.items || [],
        mode: groundingEnforcementEnabled() ? "citation" : "legacy",
      });
      sendSSE(res, { type: "prose_updated", content: ctx.prose });
    } else {
      ctx.mode2_post_prose = ctx.prose;
    }
  } catch (err) {
    console.warn("[mqpv] pipeline failed:", err?.message || err);
    ctx.mode2 = { error: err.message || String(err), errors: { pipeline: err.message } };
  }
}
```

- [ ] **Step 7.3: Apply same change to the `streamToBuffer` path (line ~573)**

Find the second occurrence (around line 573-580 in `streamToBuffer`):
```js
ctx.prose = state.proseBuffer;
ctx.sources = formatSources(ctx.evidence?.items || []);
ctx.grounding = verifyAnswerGrounding({
  answerText: ctx.prose,
  evidenceItems: ctx.evidence?.items || [],
  mode: groundingEnforcementEnabled() ? "citation" : "legacy",
});
```

Replace with (no SSE here — `streamToBuffer` is the JSON-mode path; the rewrite happens silently and just shows up in the response):

```js
ctx.prose = state.proseBuffer;
ctx.sources = formatSources(ctx.evidence?.items || []);
ctx.grounding = verifyAnswerGrounding({
  answerText: ctx.prose,
  evidenceItems: ctx.evidence?.items || [],
  mode: groundingEnforcementEnabled() ? "citation" : "legacy",
});

// MQPV — buffer-mode parallel.
if (mode2VerifierEnabled() && (ctx.evidence?.items?.length || 0) > 0) {
  try {
    const mqpv = await runMode2Pipeline(ctx);
    ctx.mode2 = mqpv.telemetry;
    ctx.mode2_pre_prose = ctx.prose;
    if (mqpv.rewritten_prose) {
      ctx.prose = mqpv.rewritten_prose;
      ctx.mode2_post_prose = ctx.prose;
      ctx.grounding = verifyAnswerGrounding({
        answerText: ctx.prose,
        evidenceItems: ctx.evidence?.items || [],
        mode: groundingEnforcementEnabled() ? "citation" : "legacy",
      });
    } else {
      ctx.mode2_post_prose = ctx.prose;
    }
  } catch (err) {
    console.warn("[mqpv] pipeline failed:", err?.message || err);
    ctx.mode2 = { error: err.message || String(err), errors: { pipeline: err.message } };
  }
}
```

- [ ] **Step 7.4: Update `maybeSampleGroundingTurn` in `workflow.js` to write mode2_* telemetry**

In `api/emersus/workflow.js`, find `maybeSampleGroundingTurn` (around line 41) and extend the insert payload:

```js
// In api/emersus/workflow.js, replace the `await supabaseAdmin.from(...).insert({...})` block:
await supabaseAdmin.from("chat_grounding_samples").insert({
  user_id: ctx.supabaseUserId || null,
  thread_id: ctx.threadId || null,
  message_id: ctx._openaiResponseId || null,
  question: String(ctx.question || "").slice(0, 4000),
  sources_json: sources,
  answer: String(ctx.prose || "").slice(0, 16000),
  grounding_json: ctx.grounding || null,
  model: ctx._synthesisModel || null,
  // MQPV telemetry (null when MQPV didn't run)
  synthetic: false,
  mode2_enabled: !!ctx.mode2,
  mode2_rewrites_attempted: ctx.mode2?.rewrites_attempted ?? null,
  mode2_initial_failures: ctx.mode2?.initial_failures ?? null,
  mode2_after_r1_failures: ctx.mode2?.after_r1_failures ?? null,
  mode2_final_failures: ctx.mode2?.final_failures ?? null,
  mode2_extraction_cost_usd: ctx.mode2?.extraction_cost_usd ?? null,
  mode2_validation_cost_usd: ctx.mode2?.validation_cost_usd ?? null,
  mode2_rewrite_cost_usd: ctx.mode2?.rewrite_cost_usd ?? null,
  mode2_extraction_latency_ms: ctx.mode2?.extraction_latency_ms ?? null,
  mode2_validation_latency_ms: ctx.mode2?.validation_latency_ms ?? null,
  mode2_rewrite_latency_ms: ctx.mode2?.rewrite_latency_ms ?? null,
  mode2_total_latency_ms: ctx.mode2?.total_latency_ms ?? null,
  mode2_qualifiers_dropped_breakdown: ctx.mode2?.qualifiers_dropped_breakdown || null,
  mode2_pre_prose: ctx.mode2_pre_prose ? String(ctx.mode2_pre_prose).slice(0, 16000) : null,
  mode2_post_prose: ctx.mode2_post_prose ? String(ctx.mode2_post_prose).slice(0, 16000) : null,
  mode2_validation_json: ctx.mode2?.validation_json || null,
});
```

- [ ] **Step 7.5: Verify syntax**

```bash
node --check api/emersus/pipeline/stream.js
node --check api/emersus/workflow.js
```

- [ ] **Step 7.6: Commit**

```bash
git add api/emersus/pipeline/stream.js api/emersus/workflow.js
git commit -m "feat(mqpv): wire orchestrator into stream.js + workflow telemetry"
```

---

## Task 8: Add Rule 8 to synthesis prompt

**Files:**
- Modify: `api/emersus/pipeline/prompt.js`

Pre-emptive instruction so the model is aware of qualifier-preservation expectations and reduces drops before the validator catches them.

- [ ] **Step 8.1: Find the existing rule list and append Rule 8**

In `api/emersus/pipeline/prompt.js`, find the existing grounding rules (search for `"6. NEVER emit a marker"` or `"7. Preserve"`). After the last rule, add:

```js
"8. Your output will be checked for qualifier preservation by an automated validator. For each cited claim, preserve the source's population, dose, duration, study design, comparator, and effect-size — OR explicitly hedge that generalization is uncertain (e.g., 'the cited source is in trained men, generalization beyond is uncertain'). Dropping a qualifier without hedging will trigger an automatic rewrite that may alter your phrasing.",
```

This pre-emptive instruction reduces mode_2 emissions before the rewriter has to step in.

- [ ] **Step 8.2: Verify syntax**

```bash
node --check api/emersus/pipeline/prompt.js
```

- [ ] **Step 8.3: Commit**

```bash
git add api/emersus/pipeline/prompt.js
git commit -m "feat(mqpv): synthesis prompt Rule 8 — qualifier-preservation expectation"
```

---

## Task 9: Frontend — handle new SSE events

**Files:**
- Modify: `shared/react-chat-app.js`

Find the existing SSE event handler (around line 4586-4710 per spec). Add cases for `verifying` and `prose_updated`.

- [ ] **Step 9.1: Locate the SSE event dispatch**

In `shared/react-chat-app.js`, find the section where SSE events are processed:
```js
let sseGrounding = null;
// ...
sseGrounding = event.grounding || null;
```

This is part of an event-type switch.

- [ ] **Step 9.2: Add `verifying` and `prose_updated` cases**

Add to the switch (location: near the existing event-type handlers, around line 4670):

```js
// MQPV: server is running post-stream qualifier verification.
// Show a subtle "checking sources" indicator on the just-rendered message.
if (event.type === "verifying") {
  setMessages((prev) => {
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
      updated[lastIdx] = { ...updated[lastIdx], verifying: true };
    }
    return updated;
  });
  continue;
}

// MQPV: server completed rewrite, replace prose in place.
if (event.type === "prose_updated" && typeof event.content === "string") {
  setMessages((prev) => {
    const updated = [...prev];
    const lastIdx = updated.length - 1;
    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
      updated[lastIdx] = {
        ...updated[lastIdx],
        content: event.content,
        verifying: false,
        rewrittenByMqpv: true,
      };
    }
    return updated;
  });
  continue;
}
```

- [ ] **Step 9.3: Add visual indicator for `verifying` state**

In the assistant message render block (find where `message.role === "assistant"` is rendered), add a subtle indicator:

```jsx
{message.verifying && h("div", {
  className: "mqpv-verifying-indicator",
  style: { fontSize: "0.85em", color: "#888", fontStyle: "italic", marginTop: "0.25em" },
}, "checking sources…")}
```

- [ ] **Step 9.4: Smoke test in browser**

Run dev server (or just `npm run build`):
```bash
npm run build
```
Expected: build succeeds.

(Manual smoke test deferred to Task 12 end-to-end verification.)

- [ ] **Step 9.5: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat(mqpv): frontend handles verifying + prose_updated SSE events"
```

---

## Task 10: `mode2-bench.js` — synthetic data harness

**Files:**
- Create: `scripts/eval/mode2-bench.js`

The bench script has three phases following the AVC v1 bench pattern (`anchor-verifier-bench.js`):
- **gen** — run prod chat workflow against fixtures, capture (Q, sources, original prose) to file
- **mqpv** — read source file, run MQPV pipeline against captured chats, write per-chat telemetry to chat_grounding_samples with synthetic=true
- **ablation** — re-run mqpv with config flags (skipQualifier, skipRewrite2) on same source chats

- [ ] **Step 10.1: Write the script**

```js
// scripts/eval/mode2-bench.js
//
// Bench harness for the Mode-2 Qualifier-Preservation Verifier.
// Spec: docs/superpowers/specs/2026-04-26-mode2-qualifier-preservation-design.md §4.8
//
// Three phases:
//   gen      — run prod chat workflow against fixtures, capture
//              {question, sources, original_prose} per chat
//   mqpv     — read captured chats, run MQPV pipeline, write per-chat
//              telemetry to chat_grounding_samples with synthetic=true
//   ablation — re-run mqpv with --skipQualifier=X or --skipRewrite2

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { generateRecommendationJSON } from "../../api/emersus/workflow.js";
import { runMode2Pipeline } from "../../api/emersus/pipeline/mode2-pipeline.js";
import { supabaseAdmin } from "../../api/lib/clients.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");
const FIXTURES_DEFAULT = "scripts/eval/fixtures/retrieval-v2.json";

function parseArgs(argv) {
  const args = {
    mode: "all",
    samples: 200,
    fixtures: FIXTURES_DEFAULT,
    concurrency: 4,
    sourceFile: null,
    runId: null,
    skipQualifier: null,
    skipRewrite2: false,
  };
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=");
    args[k] = v ?? true;
  }
  if (args.samples) args.samples = Number(args.samples);
  if (args.concurrency) args.concurrency = Number(args.concurrency);
  if (args.skipRewrite2 === "true" || args.skipRewrite2 === true) args.skipRewrite2 = true;
  else args.skipRewrite2 = false;
  return args;
}

async function loadFixtures(filePath, n) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const all = Array.isArray(raw) ? raw : raw.fixtures || [];
  return all.slice(0, n);
}

// ─── Phase: sample generation ────────────────────────────────────────────────

async function generatePhase({ samples, fixtures, concurrency, runId }) {
  const fixturesArr = await loadFixtures(fixtures, samples);
  console.log(`[mode2-bench/gen] loaded ${fixturesArr.length} fixtures`);
  const out = [];
  const startedAt = Date.now();
  let cursor = 0, inFlight = 0, done = 0;

  await new Promise((resolve) => {
    function pump() {
      if (cursor >= fixturesArr.length && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < fixturesArr.length) {
        const fixture = fixturesArr[cursor++];
        inFlight += 1;
        runOneChat(fixture)
          .then((rec) => out.push(rec))
          .catch((err) => {
            console.warn(`[gen] fixture failed: ${err.message}`);
            out.push({ question: fixture.question, error: err.message });
          })
          .finally(() => {
            inFlight -= 1;
            done += 1;
            if (done % 25 === 0 || done === fixturesArr.length) {
              console.log(`[mode2-bench/gen] ${done}/${fixturesArr.length} (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`);
            }
            pump();
          });
      }
    }
    pump();
  });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const sourcePath = path.join(RESULTS_DIR, `mode2-bench-source-${runId}.json`);
  await fs.writeFile(sourcePath, JSON.stringify({
    run_id: runId,
    generated_at: new Date().toISOString(),
    n_chats: out.length,
    samples: out,
  }, null, 2));
  console.log(`[mode2-bench/gen] wrote ${sourcePath}`);
  return sourcePath;
}

async function runOneChat(fixture) {
  const question = fixture.question || fixture.prompt;
  if (!question) throw new Error("fixture missing question");
  const t = Date.now();
  // Note: MQPV must be DISABLED during gen so we capture the original prose,
  // not the rewritten prose. The mqpv phase re-runs MQPV on captured chats.
  const wasEnabled = process.env.MODE2_VERIFIER_ENABLED;
  process.env.MODE2_VERIFIER_ENABLED = "false";
  try {
    const result = await generateRecommendationJSON({
      question,
      threadId: `mode2-bench-${Math.random().toString(36).slice(2, 10)}`,
    });
    return {
      fixture_id: fixture.id || fixture.metadata?.target_pmid || null,
      question,
      original_prose: result.answer_text || result.summary || "",
      sources: (result.sources || []).map((s) => ({
        index: s.index,
        pmid: s.pmid,
        doi: s.doi,
        title: s.title,
        excerpt: s.excerpt,
        publication_year: s.year || s.publication_year,
        publication_type: s.publication_type,
        journal: s.journal,
      })),
      grounding: result.grounding || null,
      latency_ms: Date.now() - t,
    };
  } finally {
    if (wasEnabled !== undefined) process.env.MODE2_VERIFIER_ENABLED = wasEnabled;
    else delete process.env.MODE2_VERIFIER_ENABLED;
  }
}

// ─── Phase: MQPV processing ──────────────────────────────────────────────────

async function mqpvPhase({ sourceFile, runId, concurrency, skipQualifier, skipRewrite2 }) {
  const sourceData = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const samples = sourceData.samples || [];
  console.log(`[mode2-bench/mqpv] processing ${samples.length} captured chats`);

  // Apply ablation flags to env for this run
  if (skipQualifier) process.env.MODE2_DISABLED_QUALIFIERS = skipQualifier;
  if (skipRewrite2) process.env.MODE2_REWRITE_2_ENABLED = "false";

  const startedAt = Date.now();
  let processed = 0;
  for (const sample of samples) {
    if (sample.error || !sample.original_prose) {
      processed += 1;
      continue;
    }
    try {
      // Build a synthetic ctx for the orchestrator
      const ctx = {
        prose: sample.original_prose,
        evidence: {
          items: (sample.sources || []).map((s, i) => ({
            ...s,
            source_id: i + 1,
            id: i + 1,
          })),
        },
      };
      const mqpv = await runMode2Pipeline(ctx);
      const t = mqpv.telemetry;

      // Write to chat_grounding_samples with synthetic=true
      await supabaseAdmin.from("chat_grounding_samples").insert({
        user_id: null,
        thread_id: `mode2-bench-${runId}`,
        message_id: null,
        question: String(sample.question || "").slice(0, 4000),
        sources_json: sample.sources || [],
        answer: String(mqpv.rewritten_prose || sample.original_prose).slice(0, 16000),
        grounding_json: sample.grounding || null,
        model: "bench-synthetic",
        synthetic: true,
        mode2_enabled: true,
        mode2_rewrites_attempted: t.rewrites_attempted,
        mode2_initial_failures: t.initial_failures,
        mode2_after_r1_failures: t.after_r1_failures,
        mode2_final_failures: t.final_failures,
        mode2_extraction_cost_usd: t.extraction_cost_usd,
        mode2_validation_cost_usd: t.validation_cost_usd,
        mode2_rewrite_cost_usd: t.rewrite_cost_usd,
        mode2_extraction_latency_ms: t.extraction_latency_ms,
        mode2_validation_latency_ms: t.validation_latency_ms,
        mode2_rewrite_latency_ms: t.rewrite_latency_ms,
        mode2_total_latency_ms: t.total_latency_ms,
        mode2_qualifiers_dropped_breakdown: t.qualifiers_dropped_breakdown || null,
        mode2_pre_prose: String(sample.original_prose).slice(0, 16000),
        mode2_post_prose: String(mqpv.rewritten_prose || sample.original_prose).slice(0, 16000),
        mode2_validation_json: t.validation_json || null,
      });
    } catch (err) {
      console.warn(`[mqpv] chat error: ${err.message}`);
    }
    processed += 1;
    if (processed % 10 === 0 || processed === samples.length) {
      console.log(`[mode2-bench/mqpv] ${processed}/${samples.length} (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`);
    }
  }
  console.log(`[mode2-bench/mqpv] done; rows in chat_grounding_samples with thread_id=mode2-bench-${runId}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const runId = args.runId || new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");

  if (args.mode === "gen" || args.mode === "all") {
    args.sourceFile = await generatePhase({
      samples: args.samples,
      fixtures: args.fixtures,
      concurrency: args.concurrency,
      runId,
    });
  }
  if (args.mode === "mqpv" || args.mode === "all") {
    if (!args.sourceFile) throw new Error("--sourceFile required for --mode=mqpv");
    await mqpvPhase({
      sourceFile: args.sourceFile,
      runId,
      concurrency: args.concurrency,
      skipQualifier: args.skipQualifier,
      skipRewrite2: args.skipRewrite2,
    });
  }
  console.log(`[mode2-bench] done. runId=${runId}`);
}

main().catch((err) => {
  console.error("[mode2-bench] FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 10.2: Verify syntax**

```bash
node --check scripts/eval/mode2-bench.js
```

- [ ] **Step 10.3: Smoke test with 2 chats**

Pre-req: schema migration (Task 1) must be applied. Local `.env` needs OPENAI_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

```bash
node scripts/eval/mode2-bench.js --mode=all --samples=2 --concurrency=1
```
Expected: writes a `mode2-bench-source-{ts}.json` file with 2 captures, then 2 rows inserted into `chat_grounding_samples` with `synthetic=true`.

Verify in DB:
```bash
ssh hetzner 'docker exec -u 0 supabase-db psql -U supabase_admin -d postgres -c "
SELECT thread_id, mode2_rewrites_attempted, mode2_initial_failures, mode2_final_failures, mode2_total_latency_ms
FROM chat_grounding_samples WHERE synthetic=true ORDER BY created_at DESC LIMIT 5;"'
```
Expected: 2 rows visible with non-null mode2_* values.

- [ ] **Step 10.4: Commit**

```bash
git add scripts/eval/mode2-bench.js
git commit -m "feat(mqpv): mode2-bench harness (gen + mqpv + ablation phases)"
```

---

## Task 11: `mode2-trend.js` — cost / effectiveness report

**Files:**
- Create: `scripts/lib/mode2-bench-metrics.js`
- Create: `tests/unit/scripts/lib/mode2-bench-metrics.test.js`
- Create: `scripts/mode2-trend.js`

Pure aggregation in a lib file (testable), I/O wrapper in `mode2-trend.js`.

- [ ] **Step 11.1: Test-first metrics aggregation**

```js
// tests/unit/scripts/lib/mode2-bench-metrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  renderMarkdown,
  buildRecommendations,
} from "../../../../scripts/lib/mode2-bench-metrics.js";

const SAMPLE_ROWS = [
  // Chat 1: 0 rewrites (no missing)
  { mode2_rewrites_attempted: 0, mode2_initial_failures: 0, mode2_after_r1_failures: null, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0005, mode2_rewrite_cost_usd: 0,
    mode2_total_latency_ms: 2500, mode2_qualifiers_dropped_breakdown: {} },
  // Chat 2: 1 rewrite (r1 fixed everything)
  { mode2_rewrites_attempted: 1, mode2_initial_failures: 3, mode2_after_r1_failures: 0, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.001, mode2_rewrite_cost_usd: 0.005,
    mode2_total_latency_ms: 6000, mode2_qualifiers_dropped_breakdown: { population: 2, dose: 1 } },
  // Chat 3: 2 rewrites (r1 didn't fix; r2 hedged)
  { mode2_rewrites_attempted: 2, mode2_initial_failures: 4, mode2_after_r1_failures: 2, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0015, mode2_rewrite_cost_usd: 0.010,
    mode2_total_latency_ms: 12000, mode2_qualifiers_dropped_breakdown: { population: 3, study_design: 1 } },
];

test("aggregate: counts rewrites distribution", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.equal(m.headline.total_chats, 3);
  assert.equal(m.headline.rewrites_0_count, 1);
  assert.equal(m.headline.rewrites_1_count, 1);
  assert.equal(m.headline.rewrites_2_count, 1);
});

test("aggregate: cost averages", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.ok(m.cost.avg_total_usd > 0);
  assert.ok(m.cost.avg_extraction_usd > 0);
  assert.ok(m.cost.avg_rewrite_usd > 0);
});

test("aggregate: effectiveness — initial vs final mode_2 rate", () => {
  const m = aggregate(SAMPLE_ROWS);
  // total claims-with-missing initially: 0+3+4 = 7
  // total claims-with-missing finally: 0+0+0 = 0
  assert.equal(m.effectiveness.total_initial_failures, 7);
  assert.equal(m.effectiveness.total_final_failures, 0);
});

test("aggregate: qualifiers_dropped breakdown summed", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.equal(m.qualifiers_dropped_total.population, 5); // 0 + 2 + 3
  assert.equal(m.qualifiers_dropped_total.dose, 1);
  assert.equal(m.qualifiers_dropped_total.study_design, 1);
});

test("buildRecommendations: flags drop-rewrite-2 when rare and ineffective", () => {
  const lowR2 = [
    ...Array.from({ length: 100 }, () => ({
      mode2_rewrites_attempted: 1,
      mode2_initial_failures: 1,
      mode2_after_r1_failures: 0,
      mode2_final_failures: 0,
      mode2_extraction_cost_usd: 0.001,
      mode2_validation_cost_usd: 0.001,
      mode2_rewrite_cost_usd: 0.005,
      mode2_total_latency_ms: 6000,
      mode2_qualifiers_dropped_breakdown: {},
    })),
    // 1 chat with rewrite_2 that didn't help
    { mode2_rewrites_attempted: 2, mode2_initial_failures: 1, mode2_after_r1_failures: 1, mode2_final_failures: 1,
      mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0015, mode2_rewrite_cost_usd: 0.010,
      mode2_total_latency_ms: 12000, mode2_qualifiers_dropped_breakdown: {} },
  ];
  const m = aggregate(lowR2);
  const recs = buildRecommendations(m);
  assert.ok(recs.some((r) => /drop rewrite #?2/i.test(r)), "should recommend dropping rewrite #2");
});

test("buildRecommendations: flags latency regression", () => {
  const slow = Array.from({ length: 100 }, (_, i) => ({
    mode2_rewrites_attempted: 1,
    mode2_initial_failures: 1,
    mode2_after_r1_failures: 0,
    mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001,
    mode2_validation_cost_usd: 0.001,
    mode2_rewrite_cost_usd: 0.005,
    // 6 chats > 10000 ms (over the 5% threshold)
    mode2_total_latency_ms: i < 6 ? 12000 : 5000,
    mode2_qualifiers_dropped_breakdown: {},
  }));
  const m = aggregate(slow);
  const recs = buildRecommendations(m);
  assert.ok(recs.some((r) => /latency/i.test(r)), "should recommend latency review");
});

test("renderMarkdown: emits all sections", () => {
  const m = aggregate(SAMPLE_ROWS);
  const md = renderMarkdown(m, { runId: "test", recommendations: ["x"] });
  assert.match(md, /## Headline/);
  assert.match(md, /## Cost/);
  assert.match(md, /## Effectiveness/);
  assert.match(md, /## Activation distribution/);
  assert.match(md, /## Qualifier-drop breakdown/);
  assert.match(md, /## Recommendations/);
});
```

- [ ] **Step 11.2: Run, expect FAIL**

- [ ] **Step 11.3: Implement metrics lib**

```js
// scripts/lib/mode2-bench-metrics.js
//
// Pure aggregation + markdown rendering for the MQPV bench/trend report.

export function aggregate(rows) {
  const headline = {
    total_chats: 0,
    rewrites_0_count: 0,
    rewrites_1_count: 0,
    rewrites_2_count: 0,
  };
  const cost = {
    total_usd: 0,
    total_extraction_usd: 0,
    total_validation_usd: 0,
    total_rewrite_usd: 0,
  };
  const latency = {
    samples: [],
  };
  const effectiveness = {
    total_initial_failures: 0,
    total_after_r1_failures: 0,
    total_final_failures: 0,
    chats_with_initial_failures: 0,
    chats_with_final_failures: 0,
  };
  const qualifiersDropped = {};

  for (const r of rows || []) {
    headline.total_chats += 1;
    const ra = r.mode2_rewrites_attempted ?? 0;
    if (ra === 0) headline.rewrites_0_count += 1;
    else if (ra === 1) headline.rewrites_1_count += 1;
    else if (ra === 2) headline.rewrites_2_count += 1;

    cost.total_extraction_usd += r.mode2_extraction_cost_usd || 0;
    cost.total_validation_usd += r.mode2_validation_cost_usd || 0;
    cost.total_rewrite_usd += r.mode2_rewrite_cost_usd || 0;
    cost.total_usd += (r.mode2_extraction_cost_usd || 0) + (r.mode2_validation_cost_usd || 0) + (r.mode2_rewrite_cost_usd || 0);

    if (r.mode2_total_latency_ms != null) latency.samples.push(r.mode2_total_latency_ms);

    const init = r.mode2_initial_failures ?? 0;
    const r1 = r.mode2_after_r1_failures ?? 0;
    const fin = r.mode2_final_failures ?? 0;
    effectiveness.total_initial_failures += init;
    effectiveness.total_after_r1_failures += r1;
    effectiveness.total_final_failures += fin;
    if (init > 0) effectiveness.chats_with_initial_failures += 1;
    if (fin > 0) effectiveness.chats_with_final_failures += 1;

    const breakdown = r.mode2_qualifiers_dropped_breakdown || {};
    for (const [k, v] of Object.entries(breakdown)) {
      qualifiersDropped[k] = (qualifiersDropped[k] || 0) + (Number(v) || 0);
    }
  }

  const n = headline.total_chats || 1;
  cost.avg_total_usd = cost.total_usd / n;
  cost.avg_extraction_usd = cost.total_extraction_usd / n;
  cost.avg_validation_usd = cost.total_validation_usd / n;
  cost.avg_rewrite_usd = cost.total_rewrite_usd / n;

  const sortedLatency = [...latency.samples].sort((a, b) => a - b);
  const pct = (p) => {
    if (sortedLatency.length === 0) return 0;
    const idx = Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * p));
    return sortedLatency[idx];
  };
  latency.p50_ms = pct(0.5);
  latency.p95_ms = pct(0.95);
  latency.p99_ms = pct(0.99);

  return {
    headline,
    cost,
    latency,
    effectiveness,
    qualifiers_dropped_total: qualifiersDropped,
  };
}

export function buildRecommendations(metrics) {
  const recs = [];
  const { headline, cost, latency, effectiveness, qualifiers_dropped_total } = metrics;
  const n = headline.total_chats || 1;

  // Drop rewrite #2 if rare AND ineffective
  const r2Rate = headline.rewrites_2_count / n;
  if (r2Rate < 0.02 && headline.rewrites_2_count >= 1) {
    // Compute incremental contribution: total chats with after_r1>0 vs final=0
    // (proxy: if rewrite #2 fires <2% of chats, it's not pulling its weight)
    recs.push("**Drop rewrite #2** — activates in <2% of chats. Set MODE2_REWRITE_2_ENABLED=false.");
  }

  // Drop low-incidence qualifiers
  const totalDropped = Object.values(qualifiers_dropped_total).reduce((s, v) => s + v, 0);
  for (const [q, count] of Object.entries(qualifiers_dropped_total)) {
    const share = totalDropped > 0 ? count / totalDropped : 0;
    if (share < 0.05 && count >= 1) {
      recs.push(`**Consider dropping qualifier '${q}' from validation** — only ${count} drops (${(share * 100).toFixed(1)}% of all). Add to MODE2_DISABLED_QUALIFIERS.`);
    }
  }

  // Cost ceiling
  if (cost.avg_total_usd > 0.0075) {
    recs.push(`**Cost ceiling exceeded** — avg cost/chat is $${cost.avg_total_usd.toFixed(4)}, above $0.0075 baseline (1.5× projected). Review extractor or rewriter prompts.`);
  }

  // Latency regression: >5% of chats over 10s
  const overThresholdCount = latency.samples.filter((ms) => ms > 10000).length;
  const overThresholdRate = overThresholdCount / (latency.samples.length || 1);
  if (overThresholdRate > 0.05) {
    recs.push(`**Latency regression** — ${(overThresholdRate * 100).toFixed(1)}% of chats exceeded 10s post-stream pause. Investigate slow path.`);
  }

  // Rewriter ineffective: rewrite #1 produces same-or-more failures in >10% of chats
  // (using after_r1_failures vs initial_failures from rows where rewrites_attempted >= 1)
  // Approximation at aggregate level: if total after_r1 > 0.9 * total_initial, rewriter is weak
  if (headline.rewrites_1_count > 0) {
    const proportion = effectiveness.total_after_r1_failures / Math.max(1, effectiveness.total_initial_failures);
    if (proportion > 0.9) {
      recs.push(`**Rewriter ineffective** — rewrite #1 reduces failures by only ${((1 - proportion) * 100).toFixed(1)}%. Iterate rewriter prompt.`);
    }
  }

  return recs;
}

export function renderMarkdown(metrics, { runId, recommendations = [] } = {}) {
  const { headline, cost, latency, effectiveness, qualifiers_dropped_total } = metrics;
  const n = headline.total_chats || 1;
  const pct = (numerator, denominator) =>
    denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";
  const usd = (v) => `$${(v ?? 0).toFixed(5)}`;
  const lines = [
    `# MQPV Trend — ${runId}`,
    "",
    "## Headline",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total chats | ${headline.total_chats} |`,
    `| 0 rewrites | ${headline.rewrites_0_count} (${pct(headline.rewrites_0_count, n)}) |`,
    `| 1 rewrite | ${headline.rewrites_1_count} (${pct(headline.rewrites_1_count, n)}) |`,
    `| 2 rewrites | ${headline.rewrites_2_count} (${pct(headline.rewrites_2_count, n)}) |`,
    "",
    "## Cost",
    "",
    "| Phase | Total | Avg/chat |",
    "|---|---:|---:|",
    `| Extraction | ${usd(cost.total_extraction_usd)} | ${usd(cost.avg_extraction_usd)} |`,
    `| Validation | ${usd(cost.total_validation_usd)} | ${usd(cost.avg_validation_usd)} |`,
    `| Rewrite | ${usd(cost.total_rewrite_usd)} | ${usd(cost.avg_rewrite_usd)} |`,
    `| **Total** | **${usd(cost.total_usd)}** | **${usd(cost.avg_total_usd)}** |`,
    "",
    `Projected at 30K chats/mo: **$${(cost.avg_total_usd * 30000).toFixed(2)}/mo**.`,
    `Projected at 300K chats/mo: **$${(cost.avg_total_usd * 300000).toFixed(2)}/mo**.`,
    "",
    "## Effectiveness",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total initial failures (pre-MQPV) | ${effectiveness.total_initial_failures} |`,
    `| Total after rewrite #1 | ${effectiveness.total_after_r1_failures} |`,
    `| Total final failures (post-MQPV) | ${effectiveness.total_final_failures} |`,
    `| Reduction | ${pct(effectiveness.total_initial_failures - effectiveness.total_final_failures, effectiveness.total_initial_failures)} |`,
    `| Chats with ≥1 initial failure | ${effectiveness.chats_with_initial_failures} (${pct(effectiveness.chats_with_initial_failures, n)}) |`,
    `| Chats with ≥1 final failure | ${effectiveness.chats_with_final_failures} (${pct(effectiveness.chats_with_final_failures, n)}) |`,
    "",
    "## Activation distribution",
    "",
    "| Latency percentile | Value |",
    "|---|---:|",
    `| p50 post-stream latency | ${latency.p50_ms ?? 0} ms |`,
    `| p95 | ${latency.p95_ms ?? 0} ms |`,
    `| p99 | ${latency.p99_ms ?? 0} ms |`,
    "",
    "## Qualifier-drop breakdown",
    "",
    "| Qualifier type | Times dropped |",
    "|---|---:|",
    ...Object.entries(qualifiers_dropped_total).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Recommendations",
    "",
    recommendations.length === 0 ? "_No flagged recommendations at this run._" : recommendations.map((r) => `- ${r}`).join("\n"),
    "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 11.4: Run lib tests, expect 7 PASS**

```bash
node --test tests/unit/scripts/lib/mode2-bench-metrics.test.js
```

- [ ] **Step 11.5: Implement the trend script**

```js
// scripts/mode2-trend.js
//
// Reads chat_grounding_samples (filterable to synthetic-only or real-only),
// aggregates, emits markdown report.
//
// Usage:
//   node scripts/mode2-trend.js                                    # last 7 days, all rows
//   node scripts/mode2-trend.js --synthetic-only                   # bench rows only
//   node scripts/mode2-trend.js --real-only                        # production rows only
//   node scripts/mode2-trend.js --since=2026-04-26                 # date filter
//   node scripts/mode2-trend.js --thread-id=mode2-bench-z2-live    # specific bench run

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../api/lib/clients.js";
import {
  aggregate,
  renderMarkdown,
  buildRecommendations,
} from "./lib/mode2-bench-metrics.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");

function parseArgs(argv) {
  const args = { syntheticOnly: false, realOnly: false, since: null, threadId: null };
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "synthetic-only") args.syntheticOnly = true;
    else if (k === "real-only") args.realOnly = true;
    else if (k === "since") args.since = v;
    else if (k === "thread-id") args.threadId = v;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let q = supabaseAdmin
    .from("chat_grounding_samples")
    .select("*")
    .eq("mode2_enabled", true);
  if (args.syntheticOnly) q = q.eq("synthetic", true);
  if (args.realOnly) q = q.eq("synthetic", false);
  if (args.threadId) q = q.eq("thread_id", args.threadId);
  if (args.since) q = q.gte("created_at", args.since);
  q = q.order("created_at", { ascending: false }).limit(10000);

  const { data, error } = await q;
  if (error) {
    console.error("[mode2-trend] supabase error:", error.message);
    process.exit(1);
  }
  console.log(`[mode2-trend] fetched ${data?.length || 0} rows`);

  const metrics = aggregate(data || []);
  const recommendations = buildRecommendations(metrics);
  const runId = args.threadId || (args.syntheticOnly ? "synthetic" : args.realOnly ? "real" : "all");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  const md = renderMarkdown(metrics, { runId: `${runId}-${ts}`, recommendations });

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `mode2-trend-${runId}-${ts}.md`);
  await fs.writeFile(outPath, md);
  console.log(`[mode2-trend] wrote ${outPath}`);
  if (recommendations.length > 0) {
    console.log("\n[mode2-trend] recommendations:");
    recommendations.forEach((r) => console.log(`  - ${r}`));
  }
}

main().catch((err) => {
  console.error("[mode2-trend] FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 11.6: Verify syntax + lib tests pass**

```bash
node --check scripts/mode2-trend.js
node --check scripts/lib/mode2-bench-metrics.js
node --test tests/unit/scripts/lib/mode2-bench-metrics.test.js
```

- [ ] **Step 11.7: Commit**

```bash
git add scripts/lib/mode2-bench-metrics.js \
  tests/unit/scripts/lib/mode2-bench-metrics.test.js \
  scripts/mode2-trend.js
git commit -m "feat(mqpv): mode2-trend report with auto-flagged recommendations"
```

---

## Task 12: End-to-end smoke

**Files:** Likely none (run only)

- [ ] **Step 12.1: Run all unit tests together**

```bash
node --test tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js \
  tests/unit/api/emersus/pipeline/mode2-validate.test.js \
  tests/unit/api/emersus/pipeline/mode2-rewriter.test.js \
  tests/unit/api/emersus/pipeline/mode2-pipeline.test.js \
  tests/unit/scripts/lib/mode2-bench-metrics.test.js
```
Expected: ~37 tests pass (8+9+7+6+7).

- [ ] **Step 12.2: Apply schema migration to Hetzner if not done in Task 1**

```bash
ssh hetzner 'docker exec -u 0 supabase-db psql -U supabase_admin -d postgres' < supabase/20260427_mode2_telemetry.sql
```

- [ ] **Step 12.3: Locally probe a chat with MQPV enabled**

Set local env vars:
```bash
export MODE2_VERIFIER_ENABLED=true
```

Run a single chat via the workflow (uses prod Supabase per CLAUDE.md):
```bash
node -e "
import('./api/emersus/workflow.js').then(async ({ generateRecommendationJSON }) => {
  process.env.MODE2_VERIFIER_ENABLED = 'true';
  process.env.GROUNDING_SAMPLE_RATE = '1.0'; // force-sample for the test
  const t = Date.now();
  const r = await generateRecommendationJSON({
    question: 'does creatine improve strength in trained men',
    threadId: 'mqpv-smoke-' + Date.now(),
  });
  console.log('latency_ms:', Date.now() - t);
  console.log('mode2 telemetry:', JSON.stringify(r.mode2 || null, null, 2));
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
"
```
Expected: completes in 10-25s; logs show non-null mode2 telemetry. If `mode2_rewrites_attempted >= 1`, rewriter ran successfully.

- [ ] **Step 12.4: Verify a row in chat_grounding_samples**

```bash
ssh hetzner 'docker exec -u 0 supabase-db psql -U supabase_admin -d postgres -c "
SELECT thread_id, mode2_enabled, mode2_rewrites_attempted, mode2_initial_failures, mode2_final_failures, mode2_total_latency_ms
FROM chat_grounding_samples WHERE thread_id LIKE '\''mqpv-smoke-%'\'' ORDER BY created_at DESC LIMIT 5;"'
```
Expected: at least 1 row returned with all mode2_* fields populated.

- [ ] **Step 12.5: Run a 10-chat bench end-to-end**

```bash
node scripts/eval/mode2-bench.js --mode=all --samples=10 --concurrency=2
```
Expected: writes a source file + 10 rows in chat_grounding_samples with synthetic=true.

- [ ] **Step 12.6: Run trend report on the bench output**

```bash
node scripts/mode2-trend.js --synthetic-only --since=$(date -u +%Y-%m-%d)
```
Expected: writes `scripts/eval/results/mode2-trend-synthetic-{ts}.md` with at least the 10-bench rows aggregated. If recommendations are flagged, they should be visible.

- [ ] **Step 12.7: Commit any fixes from smoke**

```bash
git add -p
git commit -m "fix(mqpv): smoke-run fixes"
```

---

## Operational note (out of plan scope)

After the plan completes, run the full bench:

```bash
node scripts/eval/mode2-bench.js --mode=all --samples=1000 --concurrency=4
```

Wall clock: ~60-90 min. Cost: ~$5-10. Then:

```bash
node scripts/mode2-trend.js --synthetic-only --thread-id=mode2-bench-{runId}
```

Then ablation passes (skip rewrite #2; skip per-qualifier) on the captured source file:

```bash
# Source file from the gen phase is reusable. Re-run mqpv mode with flags.
node scripts/eval/mode2-bench.js --mode=mqpv --sourceFile=scripts/eval/results/mode2-bench-source-{runId}.json --runId={runId}-no-r2 --skipRewrite2=true
node scripts/eval/mode2-bench.js --mode=mqpv --sourceFile=scripts/eval/results/mode2-bench-source-{runId}.json --runId={runId}-no-effect-size --skipQualifier=effect_size
```

Compare via `mode2-trend.js --thread-id=mode2-bench-{runId-variant}` for each. Pick optimal config based on cost/effectiveness, then ship to prod by setting `MODE2_VERIFIER_ENABLED=true` (plus any `MODE2_REWRITE_2_ENABLED=false` / `MODE2_DISABLED_QUALIFIERS=...` overrides) in `~/app/.env` and pm2-restarting per the standard deploy pattern.
