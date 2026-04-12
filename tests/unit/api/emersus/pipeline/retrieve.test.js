import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Stub external modules that require runtime infra (DB, openai, etc.)
await mock.module("../../../../../api/emersus/retrieveDatabaseEvidence.js", {
  namedExports: { retrieveDatabaseEvidence: async () => [] },
});
await mock.module("../../../../../api/emersus/rerank.js", {
  namedExports: {
    rankEvidence: (arr) => arr,
    dedupeEvidence: (arr) => arr,
  },
});
await mock.module("../../../../../shared/citation-format.js", {
  namedExports: {
    formatCitationUrl: () => "",
    formatCitationLabel: () => "",
  },
});

const { formatEvidenceForModel } = await import(
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
