import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { formatEvidenceForModel } = await import(
  "../../../../../api/emersus/pipeline/retrieve.js"
);
const { retrieve } = await import(
  "../../../../../api/emersus/pipeline/retrieve.js"
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
    assert.deepStrictEqual(next.evidence.items, []);
    assert.equal(next.evidence.formatted, null);
  });
});
