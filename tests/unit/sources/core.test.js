// tests/unit/sources/core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { core } from "../../../scripts/sources/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/core/${name}`), "utf8");
}

test("core.fetchPapers yields normalized IngestedPaper items", async () => {
  const originalKey = process.env.CORE_API_KEY;
  process.env.CORE_API_KEY = "test-core-bearer-token";
  try {
    const fixture = loadFixture("search-creatine.json");

    nock("https://api.core.ac.uk", {
      reqheaders: {
        authorization: "Bearer test-core-bearer-token",
      },
    })
      .get("/v3/search/works/")
      .query(true)
      .reply(200, fixture);

    const results = [];
    for await (const paper of core.fetchPapers("creatine", { target: 2 })) {
      results.push(paper);
    }

    assert.equal(results.length, 2);
    for (const p of results) {
      assert.equal(p.source, "core");
      assert.ok(p.externalId, "externalId must be set");
      assert.ok(p.title, "title must be set");
    }

    assert.equal(results[0].externalId, "987654321");
    assert.equal(results[0].doi, "10.1139/apnm-2012-0060");
    assert.deepEqual(results[0].authors, ["Rawson, Eric S.", "Volek, Jeff S."]);
    assert.equal(results[0].publishedAt.getFullYear(), 2013);
    // journal should come from journals[0].title, not publisher
    assert.equal(results[0].journal, "Applied Physiology, Nutrition, and Metabolism");
    assert.equal(results[0].sourceMetadata.publisher, "Canadian Science Publishing");

    // Second has null doi and empty journals[] — should fall back to publisher
    assert.equal(results[1].doi, null);
    assert.equal(results[1].journal, "Elsevier");
  } finally {
    if (originalKey === undefined) delete process.env.CORE_API_KEY;
    else process.env.CORE_API_KEY = originalKey;
    nock.cleanAll();
  }
});

test("core throws SourcePermanentError when CORE_API_KEY is unset", async () => {
  const originalKey = process.env.CORE_API_KEY;
  delete process.env.CORE_API_KEY;
  try {
    const { SourcePermanentError } = await import("../../../scripts/sources/_errors.js");
    await assert.rejects(
      (async () => {
        for await (const _p of core.fetchPapers("creatine", { target: 1 })) {
          break;
        }
      })(),
      (err) => err instanceof SourcePermanentError && /CORE_API_KEY/.test(err.message),
      "should throw SourcePermanentError mentioning CORE_API_KEY"
    );
  } finally {
    if (originalKey !== undefined) process.env.CORE_API_KEY = originalKey;
  }
});

test("core adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "core"), "core should be in registry");
});
