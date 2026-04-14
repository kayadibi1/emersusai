// tests/unit/lib/build-evidence-chunks-generic.test.js
// Unit tests for the source-agnostic chunk helper. Pure function — no DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGenericChunks,
  MAX_ABSTRACT_CHUNK_CHARS,
  MAX_ABSTRACT_CHUNKS,
} from "../../../scripts/lib/build-evidence-chunks-generic.js";

const BASE = {
  pmid: 10000000001,
  source: "openalex",
  external_id: "W123",
  doi: "10.1/x",
};

test("title + abstract → two chunks with correct chunk_types", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Effect of creatine on muscle mass",
    abstract:
      "A randomized controlled trial showing creatine supplementation increases lean mass in resistance-trained males over 8 weeks.",
  });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].chunk_type, "title");
  assert.equal(chunks[0].content, "Effect of creatine on muscle mass");
  assert.equal(chunks[0].pmid, 10000000001);
  assert.equal(chunks[1].chunk_type, "abstract");
  assert.match(chunks[1].content, /randomized controlled trial/);
  assert.deepEqual(chunks[0].metadata, {
    source: "openalex",
    external_id: "W123",
    doi: "10.1/x",
  });
});

test("missing abstract → zero chunks (even if title present)", () => {
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "A title", abstract: null }),
    []
  );
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "A title", abstract: "" }),
    []
  );
});

test("abstract shorter than 50 chars → zero chunks", () => {
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "T", abstract: "too short" }),
    []
  );
});

test("abstract-only (no title) → one abstract chunk", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: null,
    abstract:
      "A randomized controlled trial showing creatine supplementation increases lean mass in resistance-trained males over 8 weeks.",
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "abstract");
});

test("oversized abstract splits at sentence boundaries, capped at 12 chunks", () => {
  const bigSentence =
    "The intervention demonstrated a statistically significant increase in lean body mass compared to placebo.";
  const hugeAbstract = Array.from({ length: 400 }, () => bigSentence).join(" ");
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Title",
    abstract: hugeAbstract,
  });
  const abstractChunks = chunks.filter((c) => c.chunk_type === "abstract");
  assert.ok(abstractChunks.length > 1, "should split");
  assert.ok(
    abstractChunks.length <= MAX_ABSTRACT_CHUNKS,
    `capped at ${MAX_ABSTRACT_CHUNKS}`
  );
  for (const c of abstractChunks) {
    assert.ok(
      c.content.length <= MAX_ABSTRACT_CHUNK_CHARS + 200,
      "roughly sized"
    );
  }
});

test("whitespace normalization: collapses \\s+ and strips null bytes", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Has\tmany   whitespaces",
    abstract:
      "A controlled study\n\nshowing  results.\0 The\t\tintervention worked across multiple cohorts in this 12-week trial.",
  });
  assert.equal(chunks[0].content, "Has many whitespaces");
  assert.ok(!chunks[1].content.includes("\0"), "null bytes stripped");
  assert.ok(!/\s{2,}/.test(chunks[1].content), "no runs of whitespace");
});

test("metadata jsonb carries source, external_id, doi on every chunk", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "T",
    abstract:
      "A controlled study showing results. The intervention worked across multiple cohorts in this 12-week trial.",
  });
  for (const c of chunks) {
    assert.deepEqual(c.metadata, {
      source: "openalex",
      external_id: "W123",
      doi: "10.1/x",
    });
  }
});
