// tests/unit/sources/openaire.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { openaire, sanitizeToKeywords } from "../../../scripts/sources/openaire.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/openaire/${name}`), "utf8");
}

test("openaire.fetchPapers yields normalized IngestedPaper items from Graph v1", async () => {
  const fixture = loadFixture("publications-creatine.json");

  nock("https://api.openaire.eu")
    .get("/graph/v1/researchProducts")
    .query(true)
    .reply(200, fixture);

  const results = [];
  for await (const paper of openaire.fetchPapers("creatine", { target: 2 })) {
    results.push(paper);
  }

  assert.equal(results.length, 2);
  for (const p of results) {
    assert.equal(p.source, "openaire");
    assert.ok(p.externalId, "externalId must be set");
    assert.ok(p.title, "title must be set");
  }

  assert.equal(results[0].title, "Creatine supplementation and muscle strength: a meta-analysis");
  assert.equal(results[0].externalId, "doi_dedup___::f2ef26f432cc9e0b8cedaba451799145");
  assert.equal(results[0].doi, "10.1519/JSC.0b013e318028a73d");
  assert.equal(results[0].journal, "Journal of Strength and Conditioning Research");
  assert.deepEqual(results[0].authors, ["Branch JD", "Smith KA"]);
  assert.equal(results[0].publishedAt.getFullYear(), 2003);
  assert.equal(results[0].sourceMetadata.pubmed_id, "12831472");
  assert.equal(results[0].sourceMetadata.publisher, "Human Kinetics");
  // <jats:p> wrappers should be stripped
  assert.ok(!/jats:/.test(results[0].abstract), "jats: tags should be stripped");
  assert.ok(results[0].abstract.includes("meta-analysis"));

  assert.ok(nock.isDone(), "openaire graph v1 endpoint should have been called");
});

test("sanitizeToKeywords strips boolean operators and caps to 3 unique keywords", () => {
  const query = '(creatine OR "creatine monohydrate" OR phosphocreatine) AND ("resistance training" OR strength OR hypertrophy)';
  const clean = sanitizeToKeywords(query);
  assert.ok(!clean.includes(" OR "), "no OR");
  assert.ok(!clean.includes(" AND "), "no AND");
  assert.ok(!clean.includes('"'), "no double quotes");
  assert.ok(!clean.includes("("), "no open parens");
  assert.ok(!clean.includes(")"), "no close parens");
  // Should contain the first 3 unique keywords: "creatine creatine monohydrate"
  // → de-duped → "creatine monohydrate phosphocreatine"
  const keywords = clean.split(" ").filter(Boolean);
  assert.equal(keywords.length, 3, `expected 3 keywords, got ${JSON.stringify(keywords)}`);
  assert.equal(keywords[0], "creatine");
});

test("sanitizeToKeywords handles empty and non-string input", () => {
  assert.equal(sanitizeToKeywords(""), "");
  assert.equal(sanitizeToKeywords(null), "");
  assert.equal(sanitizeToKeywords(undefined), "");
});

test("openaire adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "openaire"), "openaire should be in registry");
});
