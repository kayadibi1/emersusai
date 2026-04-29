# Anchor-Verified Citations (AVC) v1 — Implementation Plan

**Goal:** Build a backend research script that runs the AVC verifier against 1000 generated chat samples and emits a markdown decision report.

**Architecture:** Three new modules (`anchor-verify.js`, `anchor-source-scope.js`, `anchor-verifier-bench.js`) plus one extension to `claim-modes.js` (add `extractAnchorsForClaim`). All work happens via a CLI bench script — no prod path changes, no DB writes, no UI.

**Tech Stack:** Node 20, ES modules, OpenAI Responses API (gpt-5.4 / gpt-5.4-mini), Supabase (admin client, read-only for `research_articles.full_text/abstract`), node:test.

**Spec:** `docs/superpowers/specs/2026-04-26-anchor-verified-citations-design.md`

---

## File map

| File | Status | Purpose |
|---|---|---|
| `api/emersus/pipeline/anchor-verify.js` | NEW | Pure verifier functions (normalize, substring, judge fallback) |
| `api/emersus/pipeline/anchor-source-scope.js` | NEW | Async source scope resolver with per-pmid cache |
| `api/emersus/pipeline/claim-modes.js` | EXTEND | Add `extractAnchorsForClaim(claim, sources)` |
| `scripts/eval/anchor-verifier-bench.js` | NEW | Bench entry point (sample gen + verify + report) |
| `scripts/eval/lib/anchor-bench-metrics.js` | NEW | Pure aggregation/reporting helpers |
| `tests/unit/api/emersus/pipeline/anchor-verify.test.js` | NEW | Unit tests for verifier |
| `tests/unit/api/emersus/pipeline/anchor-source-scope.test.js` | NEW | Unit tests for scope resolver |
| `tests/unit/scripts/eval/anchor-bench-metrics.test.js` | NEW | Unit tests for metrics aggregation |

---

## Task 1 — `anchor-verify.js` skeleton + `normalizeForSubstring`

**Files:**
- Create: `api/emersus/pipeline/anchor-verify.js`
- Create: `tests/unit/api/emersus/pipeline/anchor-verify.test.js`

- [ ] **Step 1.1: Write failing test for `normalizeForSubstring`**

```js
// tests/unit/api/emersus/pipeline/anchor-verify.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForSubstring } from "../../../../../api/emersus/pipeline/anchor-verify.js";

test("normalize lowercases", () => {
  assert.equal(normalizeForSubstring("Trained Men"), "trained men");
});
test("normalize collapses whitespace", () => {
  assert.equal(normalizeForSubstring("  trained\nmen  "), "trained men");
});
test("normalize unifies '5 g' / '5g' / '5 grams'", () => {
  assert.equal(normalizeForSubstring("5 g"), "5g");
  assert.equal(normalizeForSubstring("5g"), "5g");
  assert.equal(normalizeForSubstring("5 grams"), "5g");
  assert.equal(normalizeForSubstring("5  G"), "5g");
});
test("normalize unifies week/wk", () => {
  assert.equal(normalizeForSubstring("8 weeks"), "8wk");
  assert.equal(normalizeForSubstring("8 wk"), "8wk");
  assert.equal(normalizeForSubstring("eight weeks"), "8wk");
  assert.equal(normalizeForSubstring("twelve wk"), "12wk");
});
test("normalize converts number-words up to twenty", () => {
  assert.equal(normalizeForSubstring("twenty subjects"), "20 subjects");
});
test("normalize handles null/undefined", () => {
  assert.equal(normalizeForSubstring(null), "");
  assert.equal(normalizeForSubstring(undefined), "");
});
```

- [ ] **Step 1.2: Run, expect FAIL**

```
node --test tests/unit/api/emersus/pipeline/anchor-verify.test.js
# expect: ERR_MODULE_NOT_FOUND
```

- [ ] **Step 1.3: Implement minimal**

```js
// api/emersus/pipeline/anchor-verify.js
const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

const NUMBER_WORDS_RE = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`,
  "gi",
);

export function normalizeForSubstring(text) {
  if (text == null) return "";
  let s = String(text).toLowerCase();
  s = s.replace(NUMBER_WORDS_RE, (m) => String(NUMBER_WORDS[m.toLowerCase()]));
  // Unify dose units: "5 g" / "5g" / "5 grams" / "5gram" → "5g"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams|gm)\b/g, "$1g");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:mg|milligram|milligrams)\b/g, "$1mg");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:kg|kilogram|kilograms)\b/g, "$1kg");
  // Time units: "8 wk" / "8 weeks" / "8week" → "8wk"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:wk|wks|week|weeks)\b/g, "$1wk");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/g, "$1d");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:mo|mos|month|months)\b/g, "$1mo");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b/g, "$1y");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
```

- [ ] **Step 1.4: Run tests, expect PASS**

```
node --test tests/unit/api/emersus/pipeline/anchor-verify.test.js
# expect: 6 pass
```

- [ ] **Step 1.5: Commit**

```
git add api/emersus/pipeline/anchor-verify.js tests/unit/api/emersus/pipeline/anchor-verify.test.js
git commit -m "feat(grounding): anchor-verify normalizeForSubstring helper"
```

---

## Task 2 — `verifyAnchor` substring search across scopes

**Files:**
- Modify: `api/emersus/pipeline/anchor-verify.js`
- Modify: `tests/unit/api/emersus/pipeline/anchor-verify.test.js`

- [ ] **Step 2.1: Add failing tests**

```js
import { verifyAnchor } from "../../../../../api/emersus/pipeline/anchor-verify.js";

const SCOPE = {
  chunk: "Creatine 5g per day for 8 weeks improved 1RM",
  full_text: "Resistance-trained men aged 20-25 received creatine 5 g per day for 8 weeks. Bench press 1RM rose by 6.8%.",
  abstract: "RCT in trained men of creatine supplementation",
};

test("verify FAIL when source_quote is null", async () => {
  const r = await verifyAnchor(
    { text: "5g/day", source_quote: null, attributed_source_id: 1 },
    SCOPE,
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.scope_actually_matched, null);
});

test("verify PASS_VERBATIM via chunk scope", async () => {
  const r = await verifyAnchor(
    { text: "5g/day", source_quote: "5g per day", attributed_source_id: 1 },
    SCOPE,
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "chunk");
});

test("verify PASS_VERBATIM via full_text when chunk lacks the anchor", async () => {
  const r = await verifyAnchor(
    { text: "trained men", source_quote: "resistance-trained men", attributed_source_id: 1 },
    SCOPE,
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "full_text");
});

test("verify PASS_VERBATIM via abstract when neither chunk nor full_text matches", async () => {
  const r = await verifyAnchor(
    { text: "RCT", source_quote: "RCT", attributed_source_id: 1 },
    { chunk: "no methods info", full_text: "results section only", abstract: "RCT in trained men" },
  );
  assert.equal(r.result, "PASS_VERBATIM");
  assert.equal(r.scope_actually_matched, "abstract");
});

test("verify substring is case + unit normalized", async () => {
  const r = await verifyAnchor(
    { text: "8 weeks", source_quote: "EIGHT WEEKS", attributed_source_id: 1 },
    SCOPE,
  );
  assert.equal(r.result, "PASS_VERBATIM");
});

test("verify FAIL_NO_SUBSTRING when not found anywhere and no judge configured", async () => {
  const r = await verifyAnchor(
    { text: "12 weeks", source_quote: "12 weeks", attributed_source_id: 1 },
    SCOPE,
    { judge: null }, // disabled
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.scope_actually_matched, null);
});
```

- [ ] **Step 2.2: Run, expect FAIL (verifyAnchor not exported)**

```
node --test tests/unit/api/emersus/pipeline/anchor-verify.test.js
```

- [ ] **Step 2.3: Implement**

```js
// add to api/emersus/pipeline/anchor-verify.js

export async function verifyAnchor(anchor, scope, opts = {}) {
  if (!anchor || anchor.source_quote == null || anchor.source_quote === "") {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  const needle = normalizeForSubstring(anchor.source_quote);
  if (!needle) {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  const order = ["chunk", "full_text", "abstract"];
  for (const scopeName of order) {
    const text = scope?.[scopeName];
    if (!text) continue;
    if (normalizeForSubstring(text).includes(needle)) {
      return { result: "PASS_VERBATIM", scope_actually_matched: scopeName, judge_response: null };
    }
  }
  // judge fallback (Task 3)
  const judge = opts.judge === undefined ? defaultJudge : opts.judge;
  if (!judge) {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  const judgeResult = await judge({ anchor, scope });
  if (judgeResult.passes) {
    return {
      result: "PASS_JUDGED",
      scope_actually_matched: judgeResult.scope_used || null,
      judge_response: judgeResult,
    };
  }
  return { result: "FAIL", scope_actually_matched: null, judge_response: judgeResult };
}

// Lazy stub — Task 3 implements defaultJudge
let defaultJudge = null;
export function __setDefaultJudge(fn) { defaultJudge = fn; }
```

- [ ] **Step 2.4: Run, expect PASS**

```
node --test tests/unit/api/emersus/pipeline/anchor-verify.test.js
# expect: 12 pass total (6 from Task 1 + 6 new)
```

- [ ] **Step 2.5: Commit**

```
git add api/emersus/pipeline/anchor-verify.js tests/unit/api/emersus/pipeline/anchor-verify.test.js
git commit -m "feat(grounding): verifyAnchor with substring search across chunk/full_text/abstract"
```

---

## Task 3 — Judge fallback wiring

**Files:**
- Modify: `api/emersus/pipeline/anchor-verify.js`
- Modify: `tests/unit/api/emersus/pipeline/anchor-verify.test.js`

- [ ] **Step 3.1: Add tests with injected mock judge**

```js
test("verify PASS_JUDGED when substring fails but judge passes", async () => {
  const mockJudge = async ({ anchor, scope }) => ({
    passes: true,
    scope_used: "full_text",
    raw_response: "Yes, the source states '6.8% improvement' which the claim '7%' rounds to.",
    matched_quote: "6.8% improvement",
  });
  const r = await verifyAnchor(
    { text: "7%", source_quote: "7%", attributed_source_id: 1 },
    { chunk: "no number here", full_text: "creatine improved 1RM by 6.8%", abstract: "" },
    { judge: mockJudge },
  );
  assert.equal(r.result, "PASS_JUDGED");
  assert.equal(r.scope_actually_matched, "full_text");
  assert.ok(r.judge_response.matched_quote);
});

test("verify FAIL when both substring and judge fail", async () => {
  const mockJudge = async () => ({ passes: false, raw_response: "No, source does not state this." });
  const r = await verifyAnchor(
    { text: "12 wk", source_quote: "12 weeks", attributed_source_id: 1 },
    { chunk: "8 weeks duration", full_text: null, abstract: null },
    { judge: mockJudge },
  );
  assert.equal(r.result, "FAIL");
  assert.equal(r.judge_response.passes, false);
});

test("verify treats judge errors as FAIL with metadata", async () => {
  const mockJudge = async () => { throw new Error("judge timeout"); };
  const r = await verifyAnchor(
    { text: "7%", source_quote: "7%", attributed_source_id: 1 },
    { chunk: "no number", full_text: null, abstract: null },
    { judge: mockJudge },
  );
  assert.equal(r.result, "FAIL");
  assert.match(r.judge_response.error || "", /timeout/);
});
```

- [ ] **Step 3.2: Make verifyAnchor catch judge errors + add `runJudge`**

```js
// in anchor-verify.js, replace the judge call section in verifyAnchor with:
  const judge = opts.judge === undefined ? defaultJudge : opts.judge;
  if (!judge) {
    return { result: "FAIL", scope_actually_matched: null, judge_response: null };
  }
  let judgeResult;
  try {
    judgeResult = await judge({ anchor, scope });
  } catch (err) {
    return {
      result: "FAIL",
      scope_actually_matched: null,
      judge_response: { passes: false, error: err.message },
    };
  }
  if (judgeResult?.passes) {
    return {
      result: "PASS_JUDGED",
      scope_actually_matched: judgeResult.scope_used || null,
      judge_response: judgeResult,
    };
  }
  return { result: "FAIL", scope_actually_matched: null, judge_response: judgeResult };
```

- [ ] **Step 3.3: Add `runJudgeOpenAI` real implementation**

```js
// new export in anchor-verify.js — used as default judge in production paths
export async function runJudgeOpenAI({ anchor, scope, model = "gpt-5.4-mini" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const sources = ["chunk", "full_text", "abstract"]
    .map((k) => (scope?.[k] ? `[${k}]\n${scope[k]}` : null))
    .filter(Boolean)
    .join("\n\n---\n\n");

  const system = [
    "You verify whether a SOURCE text explicitly supports a specific ANCHOR phrase from a research claim.",
    "Return JSON: { \"passes\": true|false, \"matched_quote\": \"...\" or null, \"scope_used\": \"chunk\"|\"full_text\"|\"abstract\"|null, \"reasoning\": \"...\" }.",
    "passes=true ONLY if the SOURCE explicitly states the anchor's content (light paraphrase OK; semantic equivalence with same numeric / population / duration is OK).",
    "passes=false if SOURCE does not state the anchor, or only states something more general / different scope / different numbers.",
    "If passes=true, set matched_quote to the verbatim phrase from the source that backs the anchor.",
  ].join("\n");

  const user = [
    `ANCHOR phrase: ${anchor.text}`,
    `EXTRACTOR'S CLAIMED QUOTE: ${anchor.source_quote || "(none)"}`,
    "",
    "SOURCE (multiple scopes):",
    sources || "(empty)",
    "",
    "Return JSON only.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      max_output_tokens: 300,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Judge ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  const text = json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
  let parsed;
  try {
    const cleaned = String(text || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { passes: false, error: "judge_malformed_json", raw_response: text };
  }
  return {
    passes: parsed.passes === true,
    matched_quote: parsed.matched_quote || null,
    scope_used: parsed.scope_used || null,
    reasoning: parsed.reasoning || null,
    raw_response: text,
  };
}

// Wire as default judge
__setDefaultJudge(runJudgeOpenAI);
```

- [ ] **Step 3.4: Run all anchor-verify tests, expect PASS**

```
node --test tests/unit/api/emersus/pipeline/anchor-verify.test.js
# expect: 15 pass total
```

- [ ] **Step 3.5: Commit**

```
git add api/emersus/pipeline/anchor-verify.js tests/unit/api/emersus/pipeline/anchor-verify.test.js
git commit -m "feat(grounding): anchor-verify judge fallback (gpt-5.4-mini) with error handling"
```

---

## Task 4 — `anchor-source-scope.js`

**Files:**
- Create: `api/emersus/pipeline/anchor-source-scope.js`
- Create: `tests/unit/api/emersus/pipeline/anchor-source-scope.test.js`

- [ ] **Step 4.1: Add failing tests with mocked Supabase**

```js
// tests/unit/api/emersus/pipeline/anchor-source-scope.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceScopeResolver } from "../../../../../api/emersus/pipeline/anchor-source-scope.js";

function fakeSupabase(rows) {
  return {
    from: () => ({
      select: () => ({
        in: async (col, ids) => ({
          data: rows.filter((r) => ids.includes(r[col])),
          error: null,
        }),
      }),
    }),
  };
}

test("resolver returns chunk + full_text + abstract when has_full_text=true", async () => {
  const resolver = buildSourceScopeResolver({
    supabase: fakeSupabase([
      { pmid: 7670456, abstract: "RCT abstract", full_text: "Methods. Results.", has_full_text: true },
    ]),
  });
  const scope = await resolver.resolve({ pmid: 7670456, fallbackChunk: "chunk text" });
  assert.equal(scope.chunk, "chunk text");
  assert.equal(scope.full_text, "Methods. Results.");
  assert.equal(scope.abstract, "RCT abstract");
});

test("resolver returns null full_text when has_full_text=false", async () => {
  const resolver = buildSourceScopeResolver({
    supabase: fakeSupabase([
      { pmid: 1, abstract: "abs", full_text: null, has_full_text: false },
    ]),
  });
  const scope = await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  assert.equal(scope.full_text, null);
  assert.equal(scope.abstract, "abs");
});

test("resolver caches per-pmid (single Supabase call for repeated pmid)", async () => {
  let callCount = 0;
  const supabase = {
    from: () => ({
      select: () => ({
        in: async (col, ids) => {
          callCount += 1;
          return { data: ids.map((id) => ({ pmid: id, abstract: "a", full_text: null, has_full_text: false })), error: null };
        },
      }),
    }),
  };
  const resolver = buildSourceScopeResolver({ supabase });
  await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  await resolver.resolve({ pmid: 1, fallbackChunk: "c" });
  await resolver.resolve({ pmid: 2, fallbackChunk: "c" });
  assert.equal(callCount, 2, "second call for pmid=1 should hit cache");
});

test("resolver handles missing pmid gracefully", async () => {
  const resolver = buildSourceScopeResolver({ supabase: fakeSupabase([]) });
  const scope = await resolver.resolve({ pmid: 999, fallbackChunk: "fallback chunk" });
  assert.equal(scope.chunk, "fallback chunk");
  assert.equal(scope.full_text, null);
  assert.equal(scope.abstract, null);
});
```

- [ ] **Step 4.2: Run, expect FAIL**

- [ ] **Step 4.3: Implement**

```js
// api/emersus/pipeline/anchor-source-scope.js
import { supabaseAdmin } from "../../lib/clients.js";

/**
 * Build a per-chat scope resolver. Each call to .resolve() returns
 * { chunk, full_text, abstract } for a given pmid. Cached within
 * the resolver instance so repeated lookups for the same pmid hit
 * memory, not Supabase.
 */
export function buildSourceScopeResolver({ supabase = supabaseAdmin } = {}) {
  const cache = new Map(); // pmid -> { abstract, full_text, has_full_text }
  return {
    async resolve({ pmid, fallbackChunk }) {
      let row = cache.get(pmid);
      if (!row) {
        const { data, error } = await supabase
          .from("research_articles")
          .select("pmid,abstract,full_text,has_full_text")
          .in("pmid", [pmid]);
        if (error) {
          console.warn(`[anchor-source-scope] fetch error for pmid ${pmid}: ${error.message}`);
          row = { abstract: null, full_text: null, has_full_text: false };
        } else {
          row = data?.[0] || { abstract: null, full_text: null, has_full_text: false };
        }
        cache.set(pmid, row);
      }
      return {
        chunk: fallbackChunk || "",
        full_text: row.has_full_text ? (row.full_text || null) : null,
        abstract: row.abstract || null,
      };
    },
  };
}
```

- [ ] **Step 4.4: Run tests, expect PASS**

- [ ] **Step 4.5: Commit**

```
git add api/emersus/pipeline/anchor-source-scope.js tests/unit/api/emersus/pipeline/anchor-source-scope.test.js
git commit -m "feat(grounding): anchor-source-scope resolver with per-pmid cache"
```

---

## Task 5 — `claim-modes.js` extension: `extractAnchorsForClaim`

**Files:**
- Modify: `api/emersus/pipeline/claim-modes.js`

- [ ] **Step 5.1: Add the function (no unit test — integration validated in Task 10 smoke)**

```js
// append to api/emersus/pipeline/claim-modes.js

export const ANCHOR_EXTRACTION_PROMPT_VERSION = "anchor-extraction-v1";

const ANCHOR_EXTRACTION_SYSTEM_PROMPT = [
  "You extract specifier ANCHORS from a single factual research claim and locate the verbatim quote in cited sources that backs each anchor.",
  "",
  "AN ANCHOR is any specifier-like phrase tying a claim to empirical specifics: doses (5g/day), durations (8 weeks), populations (trained men), study designs (RCT, meta-analysis), interventions (creatine monohydrate), comparators (vs placebo), outcomes (1RM bench press), effect sizes (+7%, p<0.05).",
  "",
  "DO NOT extract anchors from generic words: 'improve', 'study', 'research', 'evidence', 'support', 'shown'.",
  "",
  "FOR EACH ANCHOR you find:",
  "  - text: the anchor phrase, copied from the claim verbatim",
  "  - kind_hint: one of {dose, duration, population, intervention, comparator, outcome, effect_size, study_design, sample_size, other}",
  "  - attributed_source_id: integer — which cited source's content backs this anchor; pick from the cited_ids list",
  "  - source_quote: the verbatim phrase from that source's content that backs the anchor (or null if no source backs it)",
  "  - scope_used: which part of the source you found the quote in: 'chunk', 'full_text', or 'abstract'",
  "",
  "If a claim has NO specifier anchors (it's a general/synthesis statement), return anchors: []. This is fine — synthesis claims don't need anchor verification.",
  "If you cannot find ANY source quote that backs an anchor, set source_quote: null. Do not invent quotes.",
  "",
  "Output JSON only: {\"anchors\": [{\"text\": \"...\", \"kind_hint\": \"...\", \"attributed_source_id\": N, \"source_quote\": \"...\" or null, \"scope_used\": \"chunk|full_text|abstract|null\"}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

function formatSourcesForAnchorExtractor(sources) {
  return sources.map((it, i) => {
    const sections = [];
    if (it.chunk) sections.push(`[chunk]\n${it.chunk}`);
    if (it.abstract) sections.push(`[abstract]\n${it.abstract}`);
    if (it.full_text) sections.push(`[full_text]\n${it.full_text.slice(0, 12000)}`); // cap at 12K to stay under context
    return `=== source ${i + 1} (id=${it.id}) ===\n${sections.join("\n\n")}`;
  }).join("\n\n");
}

export function parseAnchorExtractionResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { anchors: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.anchors)) {
    return { anchors: [], error: "malformed_json" };
  }
  const anchors = parsed.anchors
    .map((a) => ({
      text: String(a.text || "").trim(),
      kind_hint: String(a.kind_hint || "other"),
      attributed_source_id: Number.isInteger(a.attributed_source_id) ? a.attributed_source_id : null,
      source_quote: a.source_quote && String(a.source_quote).trim() ? String(a.source_quote).trim() : null,
      scope_used: ["chunk", "full_text", "abstract"].includes(a.scope_used) ? a.scope_used : null,
    }))
    .filter((a) => a.text);
  return { anchors, error: null };
}

/**
 * Extract anchors for ONE claim against the cited sources.
 * sources is the resolved-scope array: [{ id, chunk, abstract, full_text }, ...].
 * Returns { anchors: [...], error?, prompt_version }.
 */
export async function extractAnchorsForClaim(claim, sources, { model = "gpt-5.4-mini" } = {}) {
  if (!claim || !claim.claim_text) {
    return { anchors: [], error: "no_claim", prompt_version: ANCHOR_EXTRACTION_PROMPT_VERSION };
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    return { anchors: [], error: "no_sources", prompt_version: ANCHOR_EXTRACTION_PROMPT_VERSION };
  }
  const sourcesBlock = formatSourcesForAnchorExtractor(sources);
  const userPrompt = [
    `CLAIM:\n${claim.claim_text}`,
    `\nCITED SOURCE IDs: ${(claim.cited_ids || []).join(", ") || "(none)"}`,
    `\nCITED SOURCES:\n${sourcesBlock}`,
    "\nReturn the JSON object as specified.",
  ].join("\n");

  let raw;
  let attempts = 0;
  let lastErr = null;
  while (attempts < 2) {
    try {
      raw = await callJudge({ system: ANCHOR_EXTRACTION_SYSTEM_PROMPT, user: userPrompt, model, maxOutputTokens: 1200 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      attempts += 1;
    }
  }
  if (lastErr) {
    return { anchors: [], error: "judge_error", error_message: lastErr.message, prompt_version: ANCHOR_EXTRACTION_PROMPT_VERSION };
  }
  const parsed = parseAnchorExtractionResponse(raw);
  return { ...parsed, prompt_version: ANCHOR_EXTRACTION_PROMPT_VERSION };
}
```

- [ ] **Step 5.2: Add a parser smoke test (skip the live LLM call)**

```js
// at end of tests/unit/api/emersus/pipeline/anchor-verify.test.js
import { parseAnchorExtractionResponse } from "../../../../../api/emersus/pipeline/claim-modes.js";

test("anchor parser handles well-formed JSON", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"5g/day","kind_hint":"dose","attributed_source_id":2,"source_quote":"5 g per day","scope_used":"chunk"}]}');
  assert.equal(r.anchors.length, 1);
  assert.equal(r.anchors[0].kind_hint, "dose");
  assert.equal(r.anchors[0].scope_used, "chunk");
});

test("anchor parser tolerates ```json``` fences", () => {
  const r = parseAnchorExtractionResponse('```json\n{"anchors":[]}\n```');
  assert.equal(r.error, null);
  assert.equal(r.anchors.length, 0);
});

test("anchor parser rejects malformed JSON", () => {
  const r = parseAnchorExtractionResponse("not json");
  assert.equal(r.error, "malformed_json");
});

test("anchor parser drops anchors without text", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"","kind_hint":"dose"},{"text":"5g","kind_hint":"dose","attributed_source_id":1,"source_quote":"5g","scope_used":"chunk"}]}');
  assert.equal(r.anchors.length, 1);
});

test("anchor parser nullifies invalid scope_used", () => {
  const r = parseAnchorExtractionResponse('{"anchors":[{"text":"5g","kind_hint":"dose","attributed_source_id":1,"source_quote":"5g","scope_used":"made_up"}]}');
  assert.equal(r.anchors[0].scope_used, null);
});
```

- [ ] **Step 5.3: Run all unit tests, expect PASS**

- [ ] **Step 5.4: Commit**

```
git add api/emersus/pipeline/claim-modes.js tests/unit/api/emersus/pipeline/anchor-verify.test.js
git commit -m "feat(grounding): extractAnchorsForClaim — per-claim anchor extraction with source attribution"
```

---

## Task 6 — Bench script: sample generation phase

**Files:**
- Create: `scripts/eval/anchor-verifier-bench.js`

- [ ] **Step 6.1: Skeleton with CLI parsing + sample-gen mode**

```js
// scripts/eval/anchor-verifier-bench.js
import "../../api/lib/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { runWorkflow } from "../../api/emersus/workflow.js";

const RESULTS_DIR = path.resolve("scripts/eval/results");

function parseArgs(argv) {
  const args = { mode: "all", samples: 1000, fixtures: "scripts/eval/fixtures/retrieval-v2.json", concurrency: 6, sourceFile: null, runId: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.replace(/^--/, "").split("=");
      args[k] = v ?? true;
    }
  }
  if (args.samples) args.samples = Number(args.samples);
  if (args.concurrency) args.concurrency = Number(args.concurrency);
  return args;
}

async function loadFixtures(filePath, n) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const all = Array.isArray(raw) ? raw : raw.fixtures || [];
  return all.slice(0, n);
}

async function generateSamples({ samples, fixtures, concurrency, runId }) {
  const fixturesArr = await loadFixtures(fixtures, samples);
  console.log(`[anchor-bench/gen] loaded ${fixturesArr.length} fixtures from ${fixtures}`);
  const out = [];
  let inFlight = 0;
  let cursor = 0;
  let done = 0;
  const total = fixturesArr.length;
  const startedAt = Date.now();

  await new Promise((resolve, reject) => {
    function pump() {
      if (cursor >= total && inFlight === 0) return resolve();
      while (inFlight < concurrency && cursor < total) {
        const fixture = fixturesArr[cursor++];
        inFlight += 1;
        runOne(fixture).then((rec) => {
          out.push(rec);
          inFlight -= 1;
          done += 1;
          if (done % 25 === 0) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
            console.log(`[anchor-bench/gen] ${done}/${total} (${elapsed}s elapsed)`);
          }
          pump();
        }).catch((err) => {
          console.warn(`[anchor-bench/gen] error on fixture: ${err.message}`);
          inFlight -= 1;
          done += 1;
          pump();
        });
      }
    }
    pump();
  });

  const sourcePath = path.join(RESULTS_DIR, `anchor-bench-source-${runId}.json`);
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(sourcePath, JSON.stringify({ run_id: runId, generated_at: new Date().toISOString(), n_chats: out.length, samples: out }, null, 2));
  console.log(`[anchor-bench/gen] wrote ${out.length} samples to ${sourcePath}`);
  return sourcePath;
}

async function runOne(fixture) {
  const question = fixture.question || fixture.prompt;
  const t = Date.now();
  const result = await runWorkflow({
    prompt: question,
    threadId: `anchor-bench-${Math.random().toString(36).slice(2, 10)}`,
    userId: null,
    skipPersistence: true,
  });
  return {
    fixture_id: fixture.id || null,
    question,
    answer_text: result.summary || result.answer_text || "",
    sources: (result.sources || []).map((s) => ({
      index: s.index,
      pmid: s.pmid,
      doi: s.doi,
      title: s.title,
      excerpt: s.excerpt,
      similarity: s.similarity,
    })),
    grounding: result.grounding || null,
    latency_ms: Date.now() - t,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = args.runId || new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  if (args.mode === "gen" || args.mode === "all") {
    const src = await generateSamples({ samples: args.samples, fixtures: args.fixtures, concurrency: args.concurrency, runId });
    args.sourceFile = src;
  }
  // Verify + report phases added in Tasks 7 + 8
  if (args.mode === "verify" || args.mode === "all" || args.mode === "report") {
    console.log("[anchor-bench] verify/report phases not yet wired (Task 7/8)");
  }
}

main().catch((err) => {
  console.error("[anchor-bench] FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 6.2: Verify `runWorkflow` import path**

```
grep -nE "^export" api/emersus/workflow.js | head
# expect: export async function runWorkflow / handleChatRequest / similar
# adjust the import + call site if the actual export name differs
```

- [ ] **Step 6.3: Smoke test with `--samples=2`**

```
node scripts/eval/anchor-verifier-bench.js --mode=gen --samples=2 --concurrency=2
# expect: writes scripts/eval/results/anchor-bench-source-{ts}.json with 2 entries
```

- [ ] **Step 6.4: Commit**

```
git add scripts/eval/anchor-verifier-bench.js
git commit -m "feat(eval): anchor-verifier-bench — sample generation phase"
```

---

## Task 7 — Bench script: verification phase

**Files:**
- Modify: `scripts/eval/anchor-verifier-bench.js`

- [ ] **Step 7.1: Add `verifyPhase` wired through claim-modes + anchor-verify**

```js
// add to scripts/eval/anchor-verifier-bench.js
import { extractAtomicClaims, classifyClaimModes, extractAnchorsForClaim } from "../../api/emersus/pipeline/claim-modes.js";
import { verifyAnchor } from "../../api/emersus/pipeline/anchor-verify.js";
import { buildSourceScopeResolver } from "../../api/emersus/pipeline/anchor-source-scope.js";

async function verifyPhase({ sourceFile, runId, concurrency = 4 }) {
  const sourceData = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const samples = sourceData.samples || [];
  console.log(`[anchor-bench/verify] verifying ${samples.length} chats from ${sourceFile}`);
  const resolver = buildSourceScopeResolver();
  const verified = [];
  let done = 0;
  const startedAt = Date.now();

  // Sequential per-chat (within-chat parallelism is enough — claim extraction is one call,
  // anchor extraction is per-claim, verification is per-anchor).
  for (const sample of samples) {
    try {
      const ext = await extractAtomicClaims(sample.answer_text);
      const claims = ext.claims || [];
      const sourcesForChat = sample.sources || [];

      // For each cited source, resolve scope (chunk + full_text + abstract)
      const scopeBySourceId = new Map();
      for (const s of sourcesForChat) {
        if (!s.pmid) continue;
        const scope = await resolver.resolve({ pmid: s.pmid, fallbackChunk: s.excerpt || "" });
        scopeBySourceId.set(s.index, scope);
      }

      // For each claim, extract anchors then verify each
      const claimRecords = [];
      for (const claim of claims) {
        const sourcesWithScope = sourcesForChat
          .filter((s) => (claim.cited_ids || []).includes(s.index))
          .map((s) => ({
            id: s.index,
            chunk: scopeBySourceId.get(s.index)?.chunk || s.excerpt,
            abstract: scopeBySourceId.get(s.index)?.abstract,
            full_text: scopeBySourceId.get(s.index)?.full_text,
          }));
        if (sourcesWithScope.length === 0) {
          claimRecords.push({ claim_text: claim.claim_text, cited_ids: claim.cited_ids, anchors: [], anchor_extraction_error: "no_cited_sources" });
          continue;
        }
        const anchorExt = await extractAnchorsForClaim(claim, sourcesWithScope);
        const anchorRecords = [];
        for (const anchor of anchorExt.anchors || []) {
          const scope = scopeBySourceId.get(anchor.attributed_source_id) || { chunk: "", full_text: null, abstract: null };
          const v = await verifyAnchor(anchor, scope);
          anchorRecords.push({ ...anchor, ...v });
        }
        claimRecords.push({
          claim_text: claim.claim_text,
          cited_ids: claim.cited_ids,
          anchors: anchorRecords,
          anchor_extraction_error: anchorExt.error || null,
        });
      }

      // Cross-check against existing claim-modes mode classification
      const modeRecords = await classifyClaimModes(
        claims,
        sourcesForChat.map((s) => ({
          title: s.title,
          excerpt: s.excerpt,
          publication_year: s.publication_year,
          publication_type: s.publication_type,
          journal: s.journal,
          is_title_only_match: false,
        })),
      );
      const modeByText = new Map(modeRecords.map((m) => [m.claim_text, m]));
      for (const cr of claimRecords) {
        const mr = modeByText.get(cr.claim_text);
        cr.existing_mode = mr?.mode || null;
        cr.existing_qualifier_diff = mr?.qualifier_diff || null;
      }

      verified.push({ ...sample, claims: claimRecords });
    } catch (err) {
      console.warn(`[anchor-bench/verify] chat error: ${err.message}`);
      verified.push({ ...sample, claims: [], verify_error: err.message });
    }
    done += 1;
    if (done % 10 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`[anchor-bench/verify] ${done}/${samples.length} (${elapsed}s elapsed)`);
    }
  }

  const verifiedPath = path.join(RESULTS_DIR, `anchor-bench-${runId}.json`);
  await fs.writeFile(verifiedPath, JSON.stringify({ run_id: runId, verified_at: new Date().toISOString(), n_chats: verified.length, per_chat: verified }, null, 2));
  console.log(`[anchor-bench/verify] wrote ${verified.length} verified chats to ${verifiedPath}`);
  return verifiedPath;
}

// wire into main():
//   if (args.mode === "verify" || args.mode === "all") {
//     args.verifiedFile = await verifyPhase({ sourceFile: args.sourceFile, runId, concurrency: args.concurrency });
//   }
```

- [ ] **Step 7.2: Run on the 2-sample fixture from Task 6**

```
node scripts/eval/anchor-verifier-bench.js --mode=verify --sourceFile=scripts/eval/results/anchor-bench-source-{ts}.json
# expect: produces anchor-bench-{ts}.json with claim-level + anchor-level verification
```

- [ ] **Step 7.3: Commit**

```
git add scripts/eval/anchor-verifier-bench.js
git commit -m "feat(eval): anchor-verifier-bench verify phase — extract+verify claim anchors"
```

---

## Task 8 — Bench script: markdown report

**Files:**
- Create: `scripts/eval/lib/anchor-bench-metrics.js`
- Create: `tests/unit/scripts/eval/anchor-bench-metrics.test.js`
- Modify: `scripts/eval/anchor-verifier-bench.js`

- [ ] **Step 8.1: Test-first metrics aggregation**

```js
// tests/unit/scripts/eval/anchor-bench-metrics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateMetrics } from "../../../../scripts/eval/lib/anchor-bench-metrics.js";

const fixture = {
  per_chat: [
    {
      claims: [
        { existing_mode: "mode_2_overgen", anchors: [
          { result: "PASS_VERBATIM", scope_actually_matched: "chunk", kind_hint: "dose" },
          { result: "FAIL", kind_hint: "population" },
        ]},
        { existing_mode: "correct", anchors: [
          { result: "PASS_VERBATIM", scope_actually_matched: "abstract", kind_hint: "duration" },
        ]},
      ],
    },
    {
      claims: [
        { existing_mode: "mode_2_overgen", anchors: [] }, // no anchors
      ],
    },
  ],
};

test("aggregates anchor counts and pass/fail", () => {
  const m = aggregateMetrics(fixture);
  assert.equal(m.headline.total_chats, 2);
  assert.equal(m.headline.total_claims, 3);
  assert.equal(m.headline.total_anchors, 3);
  assert.equal(m.headline.pass_verbatim, 2);
  assert.equal(m.headline.fail, 1);
  assert.equal(m.headline.claims_with_failed_anchor, 1);
  assert.equal(m.headline.claims_with_no_anchors, 1);
});

test("per-mode breakdown buckets correctly", () => {
  const m = aggregateMetrics(fixture);
  const overgen = m.by_mode.find((b) => b.mode === "mode_2_overgen");
  assert.equal(overgen.total_anchors, 2);
  assert.equal(overgen.failed_anchors, 1);
});

test("scope distribution reports passing anchors by scope", () => {
  const m = aggregateMetrics(fixture);
  assert.equal(m.scope.chunk, 1);
  assert.equal(m.scope.abstract, 1);
  assert.equal(m.scope.full_text, 0);
});
```

- [ ] **Step 8.2: Implement `aggregateMetrics` + `renderMarkdown`**

```js
// scripts/eval/lib/anchor-bench-metrics.js
export function aggregateMetrics(verified) {
  const headline = {
    total_chats: 0, total_claims: 0, total_anchors: 0,
    pass_verbatim: 0, pass_judged: 0, fail: 0,
    claims_with_failed_anchor: 0, claims_with_no_anchors: 0,
  };
  const byMode = new Map();
  const scope = { chunk: 0, full_text: 0, abstract: 0 };
  const byKind = new Map();

  for (const chat of verified.per_chat || []) {
    headline.total_chats += 1;
    for (const claim of chat.claims || []) {
      headline.total_claims += 1;
      const mode = claim.existing_mode || "unknown";
      const bucket = byMode.get(mode) || { mode, total_anchors: 0, failed_anchors: 0, claims: 0, claims_with_failed_anchor: 0 };
      bucket.claims += 1;
      const claimAnchors = claim.anchors || [];
      if (claimAnchors.length === 0) {
        headline.claims_with_no_anchors += 1;
      }
      let claimHasFail = false;
      for (const a of claimAnchors) {
        headline.total_anchors += 1;
        bucket.total_anchors += 1;
        if (a.result === "PASS_VERBATIM") {
          headline.pass_verbatim += 1;
          if (a.scope_actually_matched && scope[a.scope_actually_matched] != null) scope[a.scope_actually_matched] += 1;
        } else if (a.result === "PASS_JUDGED") {
          headline.pass_judged += 1;
          if (a.scope_actually_matched && scope[a.scope_actually_matched] != null) scope[a.scope_actually_matched] += 1;
        } else {
          headline.fail += 1;
          bucket.failed_anchors += 1;
          claimHasFail = true;
        }
        const kind = a.kind_hint || "other";
        const kb = byKind.get(kind) || { kind, total: 0, failed: 0 };
        kb.total += 1;
        if (a.result === "FAIL") kb.failed += 1;
        byKind.set(kind, kb);
      }
      if (claimHasFail) {
        headline.claims_with_failed_anchor += 1;
        bucket.claims_with_failed_anchor += 1;
      }
      byMode.set(mode, bucket);
    }
  }
  return { headline, by_mode: [...byMode.values()], scope, by_kind: [...byKind.values()] };
}

export function renderMarkdown(metrics, { runId } = {}) {
  const h = metrics.headline;
  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-");
  const lines = [
    `# Anchor-Verifier Bench — ${runId}`,
    "",
    "## Headline",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total chats | ${h.total_chats} |`,
    `| Total claims | ${h.total_claims} |`,
    `| Total anchors | ${h.total_anchors} |`,
    `| Anchors PASS (verbatim) | ${h.pass_verbatim} (${pct(h.pass_verbatim, h.total_anchors)}) |`,
    `| Anchors PASS (judged) | ${h.pass_judged} (${pct(h.pass_judged, h.total_anchors)}) |`,
    `| Anchors FAIL | ${h.fail} (${pct(h.fail, h.total_anchors)}) |`,
    `| Claims with ≥1 failed anchor | ${h.claims_with_failed_anchor} (${pct(h.claims_with_failed_anchor, h.total_claims)}) |`,
    `| Claims with no anchors (synthesis-class) | ${h.claims_with_no_anchors} (${pct(h.claims_with_no_anchors, h.total_claims)}) |`,
    "",
    "## Per-mode breakdown",
    "",
    "| Existing mode | Claims | Anchors | Failed anchors | Anchor-fail rate | Claims with ≥1 fail |",
    "|---|---:|---:|---:|---:|---:|",
    ...metrics.by_mode.map((b) => `| ${b.mode} | ${b.claims} | ${b.total_anchors} | ${b.failed_anchors} | ${pct(b.failed_anchors, b.total_anchors)} | ${b.claims_with_failed_anchor} |`),
    "",
    "## Scope distribution (passing anchors)",
    "",
    "| Scope | Count |",
    "|---|---:|",
    `| chunk | ${metrics.scope.chunk} |`,
    `| full_text | ${metrics.scope.full_text} |`,
    `| abstract | ${metrics.scope.abstract} |`,
    "",
    "## Per-kind anchor breakdown",
    "",
    "| Kind | Total | Failed | Fail % |",
    "|---|---:|---:|---:|",
    ...metrics.by_kind.sort((a, b) => b.total - a.total).map((k) => `| ${k.kind} | ${k.total} | ${k.failed} | ${pct(k.failed, k.total)} |`),
    "",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 8.3: Wire into bench `reportPhase`**

```js
// scripts/eval/anchor-verifier-bench.js — add reportPhase
import { aggregateMetrics, renderMarkdown } from "./lib/anchor-bench-metrics.js";

async function reportPhase({ verifiedFile, runId }) {
  const verified = JSON.parse(await fs.readFile(verifiedFile, "utf8"));
  const metrics = aggregateMetrics(verified);
  const md = renderMarkdown(metrics, { runId });
  const mdPath = path.join(RESULTS_DIR, `anchor-bench-${runId}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`[anchor-bench/report] wrote ${mdPath}`);
  return mdPath;
}

// in main, after verify:
//   if (args.mode === "report" || args.mode === "all") {
//     await reportPhase({ verifiedFile: args.verifiedFile, runId });
//   }
```

- [ ] **Step 8.4: Run all unit tests, expect PASS**

- [ ] **Step 8.5: Commit**

```
git add scripts/eval/lib/anchor-bench-metrics.js tests/unit/scripts/eval/anchor-bench-metrics.test.js scripts/eval/anchor-verifier-bench.js
git commit -m "feat(eval): anchor-bench metrics aggregation + markdown report"
```

---

## Task 9 — Audit-subset emission for Claude FRR review

**Files:**
- Modify: `scripts/eval/anchor-verifier-bench.js`
- Modify: `scripts/eval/lib/anchor-bench-metrics.js`

- [ ] **Step 9.1: Add `selectAuditSubset` (deterministic random)**

```js
// scripts/eval/lib/anchor-bench-metrics.js — append
export function selectAuditSubset(verified, { n = 50, seed = 42 } = {}) {
  const failed = [];
  for (const chat of verified.per_chat || []) {
    for (const claim of chat.claims || []) {
      for (const a of claim.anchors || []) {
        if (a.result === "FAIL") {
          failed.push({
            question: chat.question,
            claim_text: claim.claim_text,
            existing_mode: claim.existing_mode,
            anchor: a,
            attributed_source: (chat.sources || []).find((s) => s.index === a.attributed_source_id) || null,
          });
        }
      }
    }
  }
  // Deterministic shuffle (Mulberry32 seeded by `seed`)
  let s = seed;
  const rng = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const arr = [...failed];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}
```

- [ ] **Step 9.2: Wire into report phase, write JSONL**

```js
// scripts/eval/anchor-verifier-bench.js — extend reportPhase
import { selectAuditSubset } from "./lib/anchor-bench-metrics.js";

// inside reportPhase:
  const audit = selectAuditSubset(verified, { n: 50 });
  const auditPath = path.join(RESULTS_DIR, `anchor-bench-${runId}-audit.jsonl`);
  await fs.writeFile(auditPath, audit.map((a) => JSON.stringify(a)).join("\n"));
  console.log(`[anchor-bench/report] wrote ${audit.length} audit anchors to ${auditPath}`);
```

- [ ] **Step 9.3: Add unit test for deterministic ordering**

```js
// tests/unit/scripts/eval/anchor-bench-metrics.test.js — append
import { selectAuditSubset } from "../../../../scripts/eval/lib/anchor-bench-metrics.js";

test("audit subset is deterministic given same seed", () => {
  const data = { per_chat: Array.from({ length: 10 }, (_, i) => ({
    question: `q${i}`,
    sources: [{ index: 1, pmid: 100 + i }],
    claims: [{ claim_text: `c${i}`, existing_mode: "mode_2_overgen", anchors: [
      { text: `a${i}`, kind_hint: "dose", attributed_source_id: 1, source_quote: null, result: "FAIL" },
    ]}],
  })) };
  const a = selectAuditSubset(data, { n: 5, seed: 42 });
  const b = selectAuditSubset(data, { n: 5, seed: 42 });
  assert.deepEqual(a.map((x) => x.claim_text), b.map((x) => x.claim_text));
  assert.equal(a.length, 5);
});
```

- [ ] **Step 9.4: Run all unit tests, expect PASS**

- [ ] **Step 9.5: Commit**

```
git add scripts/eval/lib/anchor-bench-metrics.js scripts/eval/anchor-verifier-bench.js tests/unit/scripts/eval/anchor-bench-metrics.test.js
git commit -m "feat(eval): anchor-bench audit subset emission for Claude FRR review"
```

---

## Task 10 — End-to-end smoke (10 chats) + final fixes

**Files:**
- Likely none (run only)

- [ ] **Step 10.1: Run end-to-end smoke**

```
node scripts/eval/anchor-verifier-bench.js --mode=all --samples=10 --concurrency=2
```

Expected outputs in `scripts/eval/results/`:
- `anchor-bench-source-{ts}.json` — 10 captured chats
- `anchor-bench-{ts}.json` — 10 verified chats with anchor records
- `anchor-bench-{ts}.md` — headline + per-mode + scope + kind tables, all populated
- `anchor-bench-{ts}-audit.jsonl` — up to 50 FAIL anchors (≤ all FAILs in 10 chats; could be 0)

- [ ] **Step 10.2: Inspect output for sanity**

- Anchors actually extracted? (>0 across 10 chats expected)
- Source quotes look plausible? (paste a sample into Claude/grep against source manually)
- Latency per chat ≤ 30s?
- Any uncaught exceptions in the log?

- [ ] **Step 10.3: Fix issues found in 10.2 and re-run if needed**

- [ ] **Step 10.4: Commit any fixes**

```
git add -p
git commit -m "fix(eval): anchor-bench smoke fixes from 10-chat run"
```

---

## Operational note (out of plan scope)

After the plan completes, run the full 1000-chat bench out-of-band:

```
node scripts/eval/anchor-verifier-bench.js --mode=all --samples=1000 --concurrency=6
```

Expected wall clock: ~30-60 min. Expected cost: ~$3-5 (chat generation $1, anchor extraction + verification $2-4).

The Claude-as-judge audit on the 50-anchor JSONL is a separate manual or scripted step that reads the audit file and computes false-rejection rate. Not part of v1 plan; ship-decision is made from the resulting numbers.
