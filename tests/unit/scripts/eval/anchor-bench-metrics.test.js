import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMetrics,
  renderMarkdown,
  selectAuditSubset,
} from "../../../../scripts/eval/lib/anchor-bench-metrics.js";

const fixture = {
  per_chat: [
    {
      question: "q1",
      sources: [{ index: 1, pmid: 100 }, { index: 2, pmid: 200 }],
      claims: [
        {
          claim_text: "claim A",
          existing_mode: "mode_2_overgen",
          anchors: [
            { result: "PASS_VERBATIM", scope_actually_matched: "chunk", kind_hint: "dose", text: "5g/day", attributed_source_id: 1 },
            { result: "FAIL", kind_hint: "population", text: "trained men", attributed_source_id: 1 },
          ],
        },
        {
          claim_text: "claim B",
          existing_mode: "correct",
          anchors: [
            { result: "PASS_VERBATIM", scope_actually_matched: "abstract", kind_hint: "duration", text: "8wk", attributed_source_id: 2 },
          ],
        },
      ],
    },
    {
      question: "q2",
      sources: [{ index: 1, pmid: 300 }],
      claims: [
        {
          claim_text: "claim C",
          existing_mode: "mode_2_overgen",
          anchors: [],
        },
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
  assert.equal(overgen.claims, 2);

  const correct = m.by_mode.find((b) => b.mode === "correct");
  assert.equal(correct.total_anchors, 1);
  assert.equal(correct.failed_anchors, 0);
});

test("scope distribution reports passing anchors by scope", () => {
  const m = aggregateMetrics(fixture);
  assert.equal(m.scope.chunk, 1);
  assert.equal(m.scope.abstract, 1);
  assert.equal(m.scope.full_text, 0);
});

test("by_kind breakdown groups by kind_hint", () => {
  const m = aggregateMetrics(fixture);
  const dose = m.by_kind.find((k) => k.kind === "dose");
  assert.equal(dose.total, 1);
  assert.equal(dose.failed, 0);
  const pop = m.by_kind.find((k) => k.kind === "population");
  assert.equal(pop.total, 1);
  assert.equal(pop.failed, 1);
});

test("renderMarkdown emits non-empty markdown with all section headers", () => {
  const m = aggregateMetrics(fixture);
  const md = renderMarkdown(m, { runId: "test-run" });
  assert.match(md, /Anchor-Verifier Bench/);
  assert.match(md, /## Headline/);
  assert.match(md, /## Per-mode breakdown/);
  assert.match(md, /## Scope distribution/);
  assert.match(md, /## Per-kind anchor breakdown/);
  assert.match(md, /Ship-decision rule/);
});

test("audit subset is deterministic given same seed", () => {
  const data = {
    per_chat: Array.from({ length: 10 }, (_, i) => ({
      question: `q${i}`,
      sources: [{ index: 1, pmid: 100 + i }],
      claims: [
        {
          claim_text: `c${i}`,
          existing_mode: "mode_2_overgen",
          anchors: [
            {
              text: `a${i}`,
              kind_hint: "dose",
              attributed_source_id: 1,
              source_quote: null,
              result: "FAIL",
            },
          ],
        },
      ],
    })),
  };
  const a = selectAuditSubset(data, { n: 5, seed: 42 });
  const b = selectAuditSubset(data, { n: 5, seed: 42 });
  assert.deepEqual(
    a.map((x) => x.claim_text),
    b.map((x) => x.claim_text),
    "same seed should produce identical selection",
  );
  assert.equal(a.length, 5);
});

test("audit subset only includes FAIL anchors", () => {
  const data = {
    per_chat: [
      {
        sources: [],
        claims: [
          {
            claim_text: "c1",
            anchors: [
              { result: "PASS_VERBATIM", text: "a", kind_hint: "dose" },
              { result: "FAIL", text: "b", kind_hint: "dose" },
              { result: "PASS_JUDGED", text: "c", kind_hint: "dose" },
            ],
          },
        ],
      },
    ],
  };
  const audit = selectAuditSubset(data, { n: 10 });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].anchor.text, "b");
});
