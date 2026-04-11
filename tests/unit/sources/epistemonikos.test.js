// tests/unit/sources/epistemonikos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { epistemonikos } from "../../../scripts/sources/epistemonikos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/epistemonikos/${name}`), "utf8");
}

test("epistemonikos.fetchPapers yields normalized IngestedPaper items", async () => {
  const originalKey = process.env.EPISTEMONIKOS_API_KEY;
  process.env.EPISTEMONIKOS_API_KEY = "test-epistem-key";
  try {
    const fixture = loadFixture("search-creatine.json");

    nock("https://api.epistemonikos.org")
      .get("/v1/search/documents")
      .query(true)
      .reply(200, fixture);

    const results = [];
    for await (const paper of epistemonikos.fetchPapers("creatine", { target: 2 })) {
      results.push(paper);
    }

    assert.equal(results.length, 2);
    for (const p of results) {
      assert.equal(p.source, "epistemonikos");
      assert.ok(p.externalId, "externalId must be set");
      assert.ok(p.title, "title must be set");
      assert.ok(p.abstract, "abstract must be set");
    }

    assert.equal(results[0].externalId, "ep-123456");
    assert.equal(results[0].doi, "10.1002/14651858.CD009832.pub2");
    assert.equal(results[0].journal, "Cochrane Database of Systematic Reviews");
    assert.equal(results[0].publishedAt.getFullYear(), 2020);
    assert.deepEqual(results[0].authors, ["Smith J", "Jones K", "Brown L"]);
    assert.equal(results[0].peerReviewed, true);
    assert.equal(results[0].sourceMetadata.document_type, "systematic-review");
  } finally {
    if (originalKey === undefined) delete process.env.EPISTEMONIKOS_API_KEY;
    else process.env.EPISTEMONIKOS_API_KEY = originalKey;
    nock.cleanAll();
  }
});

test("epistemonikos throws SourcePermanentError when EPISTEMONIKOS_API_KEY is unset", async () => {
  const originalKey = process.env.EPISTEMONIKOS_API_KEY;
  delete process.env.EPISTEMONIKOS_API_KEY;
  try {
    const { SourcePermanentError } = await import("../../../scripts/sources/_errors.js");
    await assert.rejects(
      (async () => {
        for await (const _p of epistemonikos.fetchPapers("creatine", { target: 1 })) {
          break;
        }
      })(),
      (err) => err instanceof SourcePermanentError && /EPISTEMONIKOS_API_KEY/.test(err.message),
      "should throw SourcePermanentError mentioning EPISTEMONIKOS_API_KEY"
    );
  } finally {
    if (originalKey !== undefined) process.env.EPISTEMONIKOS_API_KEY = originalKey;
  }
});

test("epistemonikos adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "epistemonikos"), "epistemonikos should be in registry");
});
