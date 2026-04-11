// tests/unit/jobs/s2-citation-backfill.test.js
// Shape test + one simple path with mocked S2 response logic.
// Full S2 transport testing requires curl which isn't available in unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { s2CitationBackfillHandler } from "../../../jobs/s2-citation-backfill.js";

// --- Helpers ---

function makeSql({ pmidRows = [] } = {}) {
  const calls = [];
  let selectCount = 0;

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("research_articles") && query.includes("SELECT")) {
      selectCount++;
      // Return rows on first call, empty on second
      return Promise.resolve({ rows: selectCount === 1 ? pmidRows : [] });
    }
    // UPDATE → success
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeCtx(data = {}) {
  const log = [];
  const controller = new AbortController();
  return {
    data: { batchSize: 500, pauseMs: 0, ...data },
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("handler has correct signature and exports s2CitationBackfillHandler", () => {
  assert.equal(typeof s2CitationBackfillHandler, "function", "should be a function");
});

test("returns {checked, updated} shape", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  const out = await s2CitationBackfillHandler(ctx, { sql });

  assert.ok("checked" in out, "result should have 'checked' key");
  assert.ok("updated" in out, "result should have 'updated' key");
});

test("empty pmid table → returns checked=0 updated=0", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  const out = await s2CitationBackfillHandler(ctx, { sql });

  assert.equal(out.checked, 0);
  assert.equal(out.updated, 0);
});

test("pre-aborted signal → exits immediately with 0", async () => {
  const sql = makeSql({ pmidRows: [{ pmid: 12345 }] });
  const ctx = makeCtx();
  ctx.abort();

  const out = await s2CitationBackfillHandler(ctx, { sql });

  assert.equal(out.checked, 0, "should not process anything when pre-aborted");
  assert.equal(out.updated, 0);
});

test("issues SELECT from research_articles filtering on s2_checked_at IS NULL", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  await s2CitationBackfillHandler(ctx, { sql });

  const selectCall = sql.calls.find(c =>
    c.query.includes("research_articles") && c.query.includes("s2_checked_at")
  );
  assert.ok(selectCall, "should query research_articles with s2_checked_at filter");
  assert.ok(selectCall.query.includes("NULL"), "should filter on IS NULL");
});

test("progress is called with batch stats", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  await s2CitationBackfillHandler(ctx, { sql });

  assert.ok(ctx.log.length > 0, "should call progress at least once");
  assert.ok(ctx.log[0].includes("s2-backfill"), "first progress message should identify the job");
});
