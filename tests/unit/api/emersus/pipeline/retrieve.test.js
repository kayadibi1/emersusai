import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

const { formatEvidenceForModel } = await import(
  "../../../../../api/emersus/pipeline/retrieve.js"
);
const { retrieve } = await import(
  "../../../../../api/emersus/pipeline/retrieve.js"
);
const { ShortCircuit } = await import(
  "../../../../../api/emersus/pipeline/context.js"
);

describe("formatEvidenceForModel", () => {
  it("returns placeholder when no evidence", () => {
    assert.equal(formatEvidenceForModel([]), "No database evidence retrieved.");
  });
  it("formats evidence with header and excerpt", () => {
    const evidence = [{
      publication_year: "2023", publication_type: "Meta-Analysis",
      journal: "JSCR", pmid: "12345", author_label: "Smith et al.",
      title: "Creatine and strength", excerpt: "Creatine improved...",
    }];
    const out = formatEvidenceForModel(evidence);
    assert.ok(out.includes("[1]"));
    assert.ok(out.includes("2023"));
    assert.ok(out.includes("Smith et al."));
    assert.ok(out.includes("Creatine improved"));
  });
});

describe("retrieve", () => {
  it("skips vector retrieval when retrievalPolicy says skip", async () => {
    const ctx = {
      question: "log this",
      retrievalPolicy: { mode: "skip", reason: "food_log_request" },
      _timer: {
        record() {},
      },
    };

    const next = await retrieve(ctx);

    assert.equal(next.evidence.status, "skipped");
    assert.equal(next.evidence.reason, "food_log_request");
    assert.equal(next.evidence.usePolicy, "action_only_no_evidence");
    assert.deepStrictEqual(next.evidence.items, []);
    assert.equal(next.evidence.formatted, null);
  });

  it("short-circuits before synthesis when no database evidence is available", async () => {
    const fetchSpy = mock.method(globalThis, "fetch", async () => {
      throw new Error("OpenAI should not be called without usable evidence");
    });
    const ctx = {
      question: "What is the best protein dose?",
      stableUserId: "user_1",
      plan: { topic: "general", riskLevel: "low" },
      retrievalPolicy: { mode: "run", reason: "default" },
      tier: "free",
      _timer: {
        record() {},
      },
    };

    try {
      await assert.rejects(
        () => retrieve(ctx, {
          retrieveVectorEvidenceImpl: async () => ({
            available: false,
            method: "vector",
            evidence: [],
            error: null,
          }),
        }),
        (err) => {
          assert.ok(err instanceof ShortCircuit);
          assert.equal(err.response.guardrail.response_mode, "insufficient_evidence");
          assert.match(err.response.answer_text, /without leaning on pretrained knowledge/i);
          assert.deepStrictEqual(err.response.sources, []);
          return true;
        },
      );
      assert.equal(fetchSpy.mock.callCount(), 0, "no OpenAI/API fetch should occur");
    } finally {
      fetchSpy.mock.restore();
    }
  });

  it("short-circuits title-only retrieval instead of treating titles as support", async () => {
    const ctx = {
      question: "Does creatine improve endurance?",
      stableUserId: "user_1",
      plan: { topic: "general", riskLevel: "low" },
      retrievalPolicy: { mode: "run", reason: "default" },
      tier: "free",
      _timer: { record() {} },
    };

    await assert.rejects(
      () => retrieve(ctx, {
        retrieveVectorEvidenceImpl: async () => ({
          available: true,
          method: "vector",
          evidence: [{
            source_id: "pmid:1",
            title: "Creatine and endurance performance",
            excerpt: "",
            summary: "",
            is_title_only_match: true,
            url: "https://pubmed.ncbi.nlm.nih.gov/1/",
          }],
          error: null,
        }),
      }),
      (err) => {
        assert.ok(err instanceof ShortCircuit);
        assert.equal(err.response.guardrail.response_mode, "insufficient_evidence");
        assert.equal(err.response.sources.length, 1);
        assert.match(err.response.answer_text, /related database sources/i);
        return true;
      },
    );
  });

  it("refuses common pretraining-trap questions when retrieval returns no evidence", async () => {
    const trapQuestions = [
      "What is the standard creatine dose?",
      "How much protein should I eat per day?",
      "Does caffeine improve endurance?",
    ];

    for (const question of trapQuestions) {
      const ctx = {
        question,
        stableUserId: "user_1",
        plan: { topic: "general", riskLevel: "low" },
        retrievalPolicy: { mode: "run", reason: "default" },
        tier: "free",
        _timer: { record() {} },
      };

      await assert.rejects(
        () => retrieve(ctx, {
          retrieveVectorEvidenceImpl: async () => ({
            available: false,
            method: "vector",
            evidence: [],
            error: null,
          }),
        }),
        (err) => {
          assert.ok(err instanceof ShortCircuit);
          assert.equal(err.response.guardrail.response_mode, "insufficient_evidence");
          assert.doesNotMatch(err.response.answer_text, /\b(3-5\s*g|1\.6\s*g|caffeine improves)\b/i);
          return true;
        },
      );
    }
  });
});
