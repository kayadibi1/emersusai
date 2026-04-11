// Tests for pure XML extraction helpers in scripts/lib/pubmed-xml.js.
// Uses realistic PubMed XML fragments so we catch real-world quirks
// like nested attributes, entity-encoded text, and mixed structured /
// unstructured abstracts.
//
// Run: node scripts/test-pubmed-xml-parsers.js

import assert from "node:assert/strict";
import {
  parseRetractionStatus,
  parseStructuredAbstract,
  parsePublicationCountry,
  parseAuthorKeywords,
} from "./lib/pubmed-xml.js";

// ── Fixtures ────────────────────────────────────────────────────────

// Fully enriched article: retracted, structured abstract, US-published,
// has author keywords.
const ENRICHED_XML = `
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">12345678</PMID>
    <Article>
      <Abstract>
        <AbstractText Label="BACKGROUND">Creatine is a popular ergogenic aid used in strength sports.</AbstractText>
        <AbstractText Label="METHODS">We enrolled 40 trained lifters and assigned them 5 g/day creatine monohydrate or placebo.</AbstractText>
        <AbstractText Label="RESULTS">The creatine group gained 8.2% more strength in bench press (p&lt;0.01).</AbstractText>
        <AbstractText Label="CONCLUSIONS">Creatine supplementation improved strength outcomes.</AbstractText>
      </Abstract>
    </Article>
    <MedlineJournalInfo>
      <Country>United States</Country>
      <MedlineTA>J Strength Cond Res</MedlineTA>
    </MedlineJournalInfo>
    <KeywordList Owner="NOTNLM">
      <Keyword MajorTopicYN="N">creatine</Keyword>
      <Keyword MajorTopicYN="Y">ergogenic aid</Keyword>
      <Keyword MajorTopicYN="N">strength training</Keyword>
    </KeywordList>
    <CommentsCorrectionsList>
      <CommentsCorrections RefType="Cites">
        <RefSource>Some paper this cites.</RefSource>
        <PMID Version="1">55555555</PMID>
      </CommentsCorrections>
      <CommentsCorrections RefType="RetractionIn">
        <RefSource>Retraction in: J Strength Cond Res. 2023 Mar;37(3):e142.</RefSource>
        <PMID Version="1">87654321</PMID>
      </CommentsCorrections>
    </CommentsCorrectionsList>
  </MedlineCitation>
</PubmedArticle>`;

// Plain article: unstructured abstract, English journal, no keywords,
// no retraction.
const PLAIN_XML = `
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">11111111</PMID>
    <Article>
      <Abstract>
        <AbstractText>This is a single-paragraph abstract with no section labels.</AbstractText>
      </Abstract>
    </Article>
    <MedlineJournalInfo>
      <Country>England</Country>
      <MedlineTA>BMJ</MedlineTA>
    </MedlineJournalInfo>
  </MedlineCitation>
</PubmedArticle>`;

// Edge case: comments/corrections present but RetractionIn is absent
// — e.g. only RetractionOf (which means THIS article IS a retraction
// notice, not a retracted paper) — must NOT flag as retracted.
const RETRACTION_NOTICE_XML = `
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">22222222</PMID>
    <Article>
      <ArticleTitle>Retraction: Some Previous Paper</ArticleTitle>
    </Article>
    <CommentsCorrectionsList>
      <CommentsCorrections RefType="RetractionOf">
        <RefSource>The original paper that we are retracting.</RefSource>
        <PMID Version="1">33333333</PMID>
      </CommentsCorrections>
    </CommentsCorrectionsList>
  </MedlineCitation>
</PubmedArticle>`;

// No abstract element at all (happens for very old articles).
const NO_ABSTRACT_XML = `
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">44444444</PMID>
    <Article><ArticleTitle>Old paper with no abstract</ArticleTitle></Article>
  </MedlineCitation>
</PubmedArticle>`;

// ── parseRetractionStatus ──────────────────────────────────────────

{
  const r = parseRetractionStatus(ENRICHED_XML);
  assert.equal(r.isRetracted, true, "enriched fixture should be retracted");
  assert.ok(
    r.retractionNotes && r.retractionNotes.includes("J Strength Cond Res"),
    `retractionNotes should capture the RefSource, got: ${r.retractionNotes}`
  );
}
{
  const r = parseRetractionStatus(PLAIN_XML);
  assert.equal(r.isRetracted, false);
  assert.equal(r.retractionNotes, null);
}
{
  // A retraction notice refers back to the paper it retracts via
  // RetractionOf. The notice itself is not retracted.
  const r = parseRetractionStatus(RETRACTION_NOTICE_XML);
  assert.equal(
    r.isRetracted,
    false,
    "retraction notice must not be flagged as retracted"
  );
  assert.equal(r.retractionNotes, null);
}
{
  // Empty input / missing
  assert.deepEqual(parseRetractionStatus(""), {
    isRetracted: false,
    retractionNotes: null,
  });
  assert.deepEqual(parseRetractionStatus(null), {
    isRetracted: false,
    retractionNotes: null,
  });
  assert.deepEqual(parseRetractionStatus(undefined), {
    isRetracted: false,
    retractionNotes: null,
  });
}

// ── parseStructuredAbstract ────────────────────────────────────────

{
  const s = parseStructuredAbstract(ENRICHED_XML);
  assert.ok(s && typeof s === "object", "structured abstract should be an object");
  assert.ok(s.BACKGROUND && s.BACKGROUND.includes("ergogenic aid"));
  assert.ok(s.METHODS && s.METHODS.includes("40 trained lifters"));
  assert.ok(s.RESULTS && s.RESULTS.includes("8.2%"), "should handle entity-decoded text");
  assert.ok(s.CONCLUSIONS && s.CONCLUSIONS.includes("improved strength"));
  // HTML entities must be decoded back to plain text.
  assert.ok(
    s.RESULTS.includes("p<0.01"),
    `< should be decoded, got: ${s.RESULTS}`
  );
}
{
  // Unstructured abstract returns null — caller keeps using the plain
  // abstract field.
  assert.equal(parseStructuredAbstract(PLAIN_XML), null);
}
{
  assert.equal(parseStructuredAbstract(NO_ABSTRACT_XML), null);
  assert.equal(parseStructuredAbstract(""), null);
}

// ── parsePublicationCountry ────────────────────────────────────────

assert.equal(parsePublicationCountry(ENRICHED_XML), "United States");
assert.equal(parsePublicationCountry(PLAIN_XML), "England");
assert.equal(parsePublicationCountry(NO_ABSTRACT_XML), null);
assert.equal(parsePublicationCountry(""), null);

// ── parseAuthorKeywords ────────────────────────────────────────────

{
  const kw = parseAuthorKeywords(ENRICHED_XML);
  assert.deepEqual(
    kw,
    ["creatine", "ergogenic aid", "strength training"],
    `expected 3 lowercased trimmed keywords, got: ${JSON.stringify(kw)}`
  );
}
{
  // No KeywordList element → empty array.
  assert.deepEqual(parseAuthorKeywords(PLAIN_XML), []);
  assert.deepEqual(parseAuthorKeywords(""), []);
}

// ── Defensive: malformed fragments don't throw ─────────────────────
assert.doesNotThrow(() => parseRetractionStatus("<garbage>"));
assert.doesNotThrow(() => parseStructuredAbstract("<Abstract><AbstractText"));
assert.doesNotThrow(() => parsePublicationCountry("<MedlineJournalInfo>"));
assert.doesNotThrow(() => parseAuthorKeywords("<KeywordList>"));

console.log("pubmed xml parser tests: OK");
