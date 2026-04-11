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

test("esearch URL includes api_key, tool, email when NCBI_API_KEY is set", async () => {
  const originalKey = process.env.NCBI_API_KEY;
  process.env.NCBI_API_KEY = "test-ncbi-key-abc123";
  try {
    const esearch = loadFixture("esearch-creatine.xml");
    const efetch = loadFixture("efetch-creatine.xml");

    let capturedQuery = null;
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/esearch.fcgi")
      .query((q) => { capturedQuery = q; return true; })
      .reply(200, esearch);
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/efetch.fcgi")
      .query(true)
      .reply(200, efetch);

    // Drain at least one paper so both HTTP calls fire.
    for await (const _p of pubmed.fetchPapers("creatine", { target: 1 })) {
      break;
    }

    assert.ok(capturedQuery, "esearch must have been called");
    assert.equal(capturedQuery.api_key, "test-ncbi-key-abc123");
    assert.equal(capturedQuery.tool, "emersus");
    assert.equal(capturedQuery.email, "info@emersus.ai");
  } finally {
    if (originalKey === undefined) delete process.env.NCBI_API_KEY;
    else process.env.NCBI_API_KEY = originalKey;
    nock.cleanAll();
  }
});

test("efetch URL includes api_key, tool, email when NCBI_API_KEY is set", async () => {
  const originalKey = process.env.NCBI_API_KEY;
  process.env.NCBI_API_KEY = "test-ncbi-key-xyz789";
  try {
    const esearch = loadFixture("esearch-creatine.xml");
    const efetch = loadFixture("efetch-creatine.xml");

    let capturedQuery = null;
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/esearch.fcgi")
      .query(true)
      .reply(200, esearch);
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/efetch.fcgi")
      .query((q) => { capturedQuery = q; return true; })
      .reply(200, efetch);

    for await (const _p of pubmed.fetchPapers("creatine", { target: 1 })) {
      break;
    }

    assert.ok(capturedQuery, "efetch must have been called");
    assert.equal(capturedQuery.api_key, "test-ncbi-key-xyz789");
    assert.equal(capturedQuery.tool, "emersus");
    assert.equal(capturedQuery.email, "info@emersus.ai");
  } finally {
    if (originalKey === undefined) delete process.env.NCBI_API_KEY;
    else process.env.NCBI_API_KEY = originalKey;
    nock.cleanAll();
  }
});

test("URLs omit api_key when NCBI_API_KEY is unset", async () => {
  const originalKey = process.env.NCBI_API_KEY;
  delete process.env.NCBI_API_KEY;
  try {
    const esearch = loadFixture("esearch-creatine.xml");
    const efetch = loadFixture("efetch-creatine.xml");

    let esearchQuery = null;
    let efetchQuery = null;
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/esearch.fcgi")
      .query((q) => { esearchQuery = q; return true; })
      .reply(200, esearch);
    nock("https://eutils.ncbi.nlm.nih.gov")
      .get("/entrez/eutils/efetch.fcgi")
      .query((q) => { efetchQuery = q; return true; })
      .reply(200, efetch);

    for await (const _p of pubmed.fetchPapers("creatine", { target: 1 })) {
      break;
    }

    assert.equal(esearchQuery.api_key, undefined, "esearch should not send api_key when unset");
    assert.equal(efetchQuery.api_key, undefined, "efetch should not send api_key when unset");
  } finally {
    if (originalKey !== undefined) process.env.NCBI_API_KEY = originalKey;
    nock.cleanAll();
  }
});
