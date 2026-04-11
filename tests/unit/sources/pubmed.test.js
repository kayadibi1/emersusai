// tests/unit/sources/pubmed.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { pubmed } from "../../../scripts/sources/pubmed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/pubmed/${name}`), "utf8");
}

test("pubmed.fetchPapers yields normalized IngestedPaper items", async () => {
  const esearch = loadFixture("esearch-creatine.xml");
  const efetch = loadFixture("efetch-creatine.xml");

  nock("https://eutils.ncbi.nlm.nih.gov")
    .get("/entrez/eutils/esearch.fcgi")
    .query(true)
    .reply(200, esearch);
  nock("https://eutils.ncbi.nlm.nih.gov")
    .get("/entrez/eutils/efetch.fcgi")
    .query(true)
    .reply(200, efetch);

  const results = [];
  for await (const paper of pubmed.fetchPapers("creatine", { target: 3 })) {
    results.push(paper);
  }
  assert.equal(results.length, 3);
  for (const p of results) {
    assert.equal(p.source, "pubmed");
    assert.equal(p.peerReviewed, true);
    assert.ok(p.externalId, "externalId must be set (PMID)");
    assert.ok(p.title, "title must be set");
  }
  assert.ok(nock.isDone(), "both endpoints should have been called");
});

test("pubmed adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "pubmed"), "pubmed should be in registry");
});
