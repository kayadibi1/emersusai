// tests/unit/jobs/classify-candidates.test.js
// Uses dependency injection (createClassifier) to avoid mock.module — Node v24
// has mock.module only from v22.3+ but it wasn't available in this environment.
import { test } from "node:test";
import assert from "node:assert/strict";

const { createClassifier, buildClassifierPrompt } = await import("../../../jobs/classify-candidates.js");

// --- Helpers ---

function makeOpenai(results) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({ results }),
            },
          }],
        }),
      },
    },
  };
}

function makeSql({ researchTopicsRows = [], upsertWasInsert = true } = {}) {
  const calls = [];
  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("research_topics")) {
      return Promise.resolve({ rows: researchTopicsRows });
    }
    // Upsert → topic_candidates
    return Promise.resolve({ rows: [{ was_insert: upsertWasInsert }] });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(items, feedId) {
  const log = [];
  return {
    data: { items, feedId },
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("buildClassifierPrompt includes all items", () => {
  const items = [
    { title: "Article A", abstract: "About muscles", url: "https://a.com" },
    { title: "Article B", abstract: null, url: "https://b.com" },
  ];
  const p = buildClassifierPrompt(items);
  assert.ok(p.system.length > 0, "system prompt must be non-empty");
  assert.ok(p.user.includes("Article A"), "user prompt must include item 1 title");
  assert.ok(p.user.includes("Article B"), "user prompt must include item 2 title");
  assert.ok(p.user.includes("2 articles"), "user prompt should mention item count");
});

test("classifies 3 items, 2 pass threshold → 2 inserted", async () => {
  const results = [
    { is_exercise_science: true,  topic_key: "foo", raw_term: "Foo", confidence: 0.9, rationale: "yes", suggested_query: "foo AND bar" },
    { is_exercise_science: true,  topic_key: "baz", raw_term: "Baz", confidence: 0.8, rationale: "yes", suggested_query: "baz AND qux" },
    { is_exercise_science: false, topic_key: null,  raw_term: null,  confidence: 0.1, rationale: "no",  suggested_query: null },
  ];
  const items = [
    { url: "https://a.com", title: "A", abstract: null },
    { url: "https://b.com", title: "B", abstract: null },
    { url: "https://c.com", title: "C", abstract: null },
  ];

  const sql = makeSql({ upsertWasInsert: true });
  const handler = createClassifier({ openaiClient: makeOpenai(results) });
  const ctx = makeCtx(items, "test-feed");

  const out = await handler(ctx, { sql });
  assert.equal(out.inserted, 2, "2 items should be inserted");
  assert.equal(out.skipped, 1, "1 item should be skipped (not exercise science)");
  assert.equal(out.updated, 0);
});

test("item confidence below threshold is skipped", async () => {
  const results = [
    { is_exercise_science: true, topic_key: "low_conf", raw_term: "Low", confidence: 0.3, rationale: "maybe", suggested_query: null },
    { is_exercise_science: true, topic_key: "high_conf", raw_term: "High", confidence: 0.95, rationale: "yes", suggested_query: "high AND something" },
  ];
  const items = [
    { url: "https://a.com", title: "A", abstract: null },
    { url: "https://b.com", title: "B", abstract: null },
  ];

  const sql = makeSql({ upsertWasInsert: true });
  const handler = createClassifier({ openaiClient: makeOpenai(results) });
  const ctx = makeCtx(items, "test-feed");

  const out = await handler(ctx, { sql });
  assert.equal(out.inserted, 1, "only the high-confidence item should be inserted");
  assert.equal(out.skipped, 1, "low-confidence item should be skipped");
});

test("topic already in research_topics is skipped", async () => {
  const results = [
    { is_exercise_science: true, topic_key: "existing_topic", raw_term: "Existing", confidence: 0.9, rationale: "yes", suggested_query: "existing" },
  ];
  const items = [{ url: "https://a.com", title: "A", abstract: null }];

  // Simulate research_topics already containing this topic
  const sql = makeSql({ researchTopicsRows: [{ "?column?": 1 }] });
  const handler = createClassifier({ openaiClient: makeOpenai(results) });
  const ctx = makeCtx(items, "test-feed");

  const out = await handler(ctx, { sql });
  assert.equal(out.inserted, 0, "topic already in research_topics should not insert");
  assert.equal(out.skipped, 1, "should be counted as skipped");
});

test("on conflict do update → counts as updated not inserted", async () => {
  const results = [
    { is_exercise_science: true, topic_key: "existing_cand", raw_term: "E", confidence: 0.8, rationale: "yes", suggested_query: "e" },
  ];
  const items = [{ url: "https://a.com", title: "A", abstract: null }];

  // upsertWasInsert: false → it was an UPDATE
  const sql = makeSql({ upsertWasInsert: false });
  const handler = createClassifier({ openaiClient: makeOpenai(results) });
  const ctx = makeCtx(items, "test-feed");

  const out = await handler(ctx, { sql });
  assert.equal(out.inserted, 0);
  assert.equal(out.updated, 1, "conflict update should count as updated");
  assert.equal(out.skipped, 0);
});

test("classifier returns invalid JSON → throws", async () => {
  const badOpenai = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "this is not json at all!!!" } }],
        }),
      },
    },
  };
  const items = [{ url: "https://a.com", title: "A", abstract: null }];
  const sql = makeSql();
  const handler = createClassifier({ openaiClient: badOpenai });
  const ctx = makeCtx(items, "test-feed");

  await assert.rejects(
    () => handler(ctx, { sql }),
    /classifier returned invalid JSON/,
    "should throw on invalid JSON"
  );
});

test("empty items list returns zero counts without calling openai", async () => {
  let called = false;
  const openai = {
    chat: { completions: { create: async () => { called = true; return { choices: [] }; } } },
  };
  const sql = makeSql();
  const handler = createClassifier({ openaiClient: openai });
  const ctx = makeCtx([], "test-feed");

  const out = await handler(ctx, { sql });
  assert.equal(out.inserted, 0);
  assert.equal(out.updated, 0);
  assert.equal(out.skipped, 0);
  assert.equal(called, false, "openai should not be called for empty items");
});

test("null openai client throws", async () => {
  const handler = createClassifier({ openaiClient: null });
  const items = [{ url: "https://a.com", title: "A", abstract: null }];
  const sql = makeSql();
  const ctx = makeCtx(items, "test-feed");

  await assert.rejects(
    () => handler(ctx, { sql }),
    /OPENAI client not configured/,
    "should throw when openai is null"
  );
});
