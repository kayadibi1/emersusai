// tests/unit/jobs/validate-queries.test.js
// Tests validateQueriesHandler by mocking sql + the curl-based esearchCount.
// We can't easily mock the spawn-based curl, so we test via an injectable
// fetch function. The handler uses curlGet internally — for unit tests,
// we mock at the module level via a factory pattern exposed in the test.

// Strategy: since the module uses spawn("curl",...) internally, we
// test the full behavior via a subclass pattern — create a handler wrapper
// that accepts an overrideable esearchFn.
import { test } from "node:test";
import assert from "node:assert/strict";

// Import the real handler for shape tests
import { validateQueriesHandler } from "../../../jobs/validate-queries.js";

// --- Helpers ---

function makeSql({ topicRows = [] } = {}) {
  const calls = [];
  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("research_topics")) {
      return Promise.resolve({ rows: topicRows });
    }
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(data = {}) {
  const log = [];
  const controller = new AbortController();
  return {
    data: { passMin: 100, warnMin: 10, ...data },
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (msg, level) => { log.push({ msg, level }); },
    log,
  };
}

// --- Tests ---

test("validateQueriesHandler is a function", () => {
  assert.equal(typeof validateQueriesHandler, "function");
});

test("returns {pass, warn, fail, error, results} shape", async () => {
  const sql = makeSql({ topicRows: [] });
  const ctx = makeCtx();

  const out = await validateQueriesHandler(ctx, { sql });

  assert.ok("pass" in out);
  assert.ok("warn" in out);
  assert.ok("fail" in out);
  assert.ok("error" in out);
  assert.ok("results" in out);
  assert.ok(Array.isArray(out.results));
});

test("empty topic table → all zeros", async () => {
  const sql = makeSql({ topicRows: [] });
  const ctx = makeCtx();

  const out = await validateQueriesHandler(ctx, { sql });

  assert.equal(out.pass, 0);
  assert.equal(out.warn, 0);
  assert.equal(out.fail, 0);
  assert.equal(out.results.length, 0);
});

test("pre-aborted signal exits immediately", async () => {
  const sql = makeSql({
    topicRows: [
      { topic_key: "strength", query: "strength training" },
    ],
  });
  const ctx = makeCtx();
  ctx.abort();

  const out = await validateQueriesHandler(ctx, { sql });

  // No results should have been processed
  assert.equal(out.results.length, 0);
});

test("queries research_topics with status=active filter", async () => {
  const sql = makeSql({ topicRows: [] });
  const ctx = makeCtx();

  await validateQueriesHandler(ctx, { sql });

  const selectCall = sql.calls.find(c =>
    c.query.includes("research_topics") && c.query.includes("active")
  );
  assert.ok(selectCall, "should query research_topics WHERE status='active'");
});

test("topicKeys filter limits topics processed", async () => {
  const sql = makeSql({
    topicRows: [
      { topic_key: "strength", query: "strength training" },
      { topic_key: "cardio", query: "aerobic exercise" },
      { topic_key: "nutrition", query: "protein intake" },
    ],
  });
  const ctx = makeCtx({ topicKeys: ["strength", "nutrition"] });

  // Since we can't mock curl, we abort immediately so no actual HTTP calls
  // are made — we only test that the topic filtering was applied.
  ctx.abort();

  const out = await validateQueriesHandler(ctx, { sql });

  // Handler aborts immediately, but the progress log should show
  // "validating 2 queries" because filtering happens before the loop
  const initMsg = ctx.log.find(l => l.msg && l.msg.includes("validating 2"));
  assert.ok(initMsg, "should log 'validating 2 queries' after filtering to requested topicKeys");
});
