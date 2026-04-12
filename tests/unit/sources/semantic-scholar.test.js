// tests/unit/sources/semantic-scholar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { semanticScholar, sanitizeToKeywords } from "../../../scripts/sources/semantic-scholar.js";

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

test("semanticScholar sanitizes boolean queries down to keywords before sending", async () => {
  let capturedQuery = null;
  nock("https://api.semanticscholar.org")
    .get("/graph/v1/paper/search")
    .query((q) => { capturedQuery = q; return true; })
    .reply(200, { total: 0, offset: 0, data: [] });

  try {
    for await (const _p of semanticScholar.fetchPapers(
      '(creatine OR "creatine monohydrate") AND ("resistance training" OR strength)',
      { target: 1 },
    )) {
      break;
    }
  } catch (_) {
    // throws SourcePermanentError on 0 results; ignore
  }

  assert.ok(capturedQuery, "capturedQuery should be set");
  assert.ok(!capturedQuery.query.includes(" OR "), "no OR in sent query");
  assert.ok(!capturedQuery.query.includes(" AND "), "no AND in sent query");
  assert.ok(!capturedQuery.query.includes('"'), "no quotes in sent query");
  assert.ok(capturedQuery.query.includes("creatine"), "keywords preserved");
  nock.cleanAll();
});

test("semanticScholar stops paginating before offset+limit hits S2's 1000 cap", async () => {
  // Regression: S2's /paper/search endpoint returns 400
  // `Relevance search offset + limit must be < 1000` once you
  // paginate past ~9 pages. The adapter should stop early rather
  // than hitting the error. We simulate 20 non-empty pages and
  // verify that at most 9 requests fire (offsets 0, 100, ..., 800).
  let requestCount = 0;
  const makePage = (offset) => ({
    total: 5000, // fake huge total so the pagination doesn't terminate naturally
    offset,
    next: offset + 100,
    data: Array.from({ length: 100 }, (_, i) => ({
      paperId: `p-${offset + i}`,
      title: `Fake paper ${offset + i}`,
      year: 2024,
      authors: [],
      externalIds: {},
      publicationTypes: ["JournalArticle"],
    })),
  });
  nock("https://api.semanticscholar.org")
    .get("/graph/v1/paper/search")
    .query(true)
    .times(20)
    .reply((uri) => {
      requestCount += 1;
      const m = uri.match(/offset=(\d+)/);
      const offset = m ? Number(m[1]) : 0;
      return [200, makePage(offset)];
    });

  const yielded = [];
  for await (const paper of semanticScholar.fetchPapers("fake-query", { target: 2000 })) {
    yielded.push(paper);
  }

  // We expect at most 9 requests (offsets 0, 100, 200, ..., 800). The
  // 10th request would be at offset=900 which produces 900+100=1000
  // and hits the cap.
  assert.ok(
    requestCount <= 9,
    `expected ≤9 requests before hitting S2 offset cap, got ${requestCount}`,
  );
  // And at most 900 papers yielded (9 pages × 100).
  assert.ok(yielded.length <= 900);
  nock.cleanAll();
});

test("semanticScholar adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "semantic-scholar"), "semantic-scholar should be in registry");
});
