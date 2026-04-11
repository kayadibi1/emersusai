// tests/unit/sources/semantic-scholar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { semanticScholar } from "../../../scripts/sources/semantic-scholar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/semantic-scholar/${name}`), "utf8");
}

test("semanticScholar.fetchPapers yields normalized IngestedPaper items", async () => {
  const fixture = loadFixture("search-creatine.json");

  nock("https://api.semanticscholar.org")
    .get("/graph/v1/paper/search")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of semanticScholar.fetchPapers("creatine", { target: 2 })) {
    results.push(paper);
  }

  assert.equal(results.length, 2);
  for (const p of results) {
    assert.equal(p.source, "semantic-scholar");
    assert.ok(p.externalId, "externalId must be set (S2 paperId)");
    assert.ok(p.title, "title must be set");
    assert.ok(p.abstract, "abstract must be set");
  }

  assert.equal(results[0].externalId, "c7f3e9a2b4d5c8f1a3e6b8d2c4f9a1e3b5c7d8f2");
  assert.equal(results[0].doi, "10.1186/1550-2783-4-6");
  assert.equal(results[0].journal, "Journal of the International Society of Sports Nutrition");
  assert.equal(results[0].publishedAt.getFullYear(), 2007);
  assert.deepEqual(results[0].authors, ["Richard B. Kreider", "Chad M. Kerksick"]);
  assert.equal(results[0].peerReviewed, true);
  // S2's PubMed id should land in sourceMetadata for audit
  assert.equal(results[0].sourceMetadata.pubmed_id, "17908288");

  assert.ok(nock.isDone(), "s2 search endpoint should have been called");
});

test("semanticScholar sends x-api-key header when SEMANTIC_SCHOLAR_API_KEY is set", async () => {
  const originalKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  process.env.SEMANTIC_SCHOLAR_API_KEY = "test-s2-key-xyz";
  try {
    const fixture = loadFixture("search-creatine.json");
    let capturedHeader = null;
    nock("https://api.semanticscholar.org", {
      reqheaders: {
        "x-api-key": (val) => { capturedHeader = val; return true; },
      },
    })
      .get("/graph/v1/paper/search")
      .query(true)
      .reply(200, fixture);

    for await (const _p of semanticScholar.fetchPapers("creatine", { target: 1 })) {
      break;
    }

    assert.equal(capturedHeader, "test-s2-key-xyz");
  } finally {
    if (originalKey === undefined) delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    else process.env.SEMANTIC_SCHOLAR_API_KEY = originalKey;
    nock.cleanAll();
  }
});

test("semanticScholar adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "semantic-scholar"), "semantic-scholar should be in registry");
});
