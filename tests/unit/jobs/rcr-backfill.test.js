// tests/unit/jobs/rcr-backfill.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { rcrBackfillHandler } from "../../../jobs/rcr-backfill.js";

// --- Helpers ---

function makeSql({ pmidRows = [] } = {}) {
  const calls = [];
  let selectCount = 0;

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("research_articles") && query.includes("SELECT")) {
      selectCount++;
      return Promise.resolve({ rows: selectCount === 1 ? pmidRows : [] });
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
    data: { batchSize: 200, pauseMs: 0, ...data },
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Mock global fetch for iCite ---

function withMockFetch(mockBody, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => mockBody,
  });
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// --- Tests ---

test("rcrBackfillHandler is a function", () => {
  assert.equal(typeof rcrBackfillHandler, "function");
});

test("returns {checked, updated} shape", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  const out = await rcrBackfillHandler(ctx, { sql });

  assert.ok("checked" in out);
  assert.ok("updated" in out);
});

test("empty table → checked=0 updated=0", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  const out = await rcrBackfillHandler(ctx, { sql });

  assert.equal(out.checked, 0);
  assert.equal(out.updated, 0);
});

test("pre-aborted signal exits immediately", async () => {
  const sql = makeSql({ pmidRows: [{ pmid: 12345 }] });
  const ctx = makeCtx();
  ctx.abort();

  const out = await rcrBackfillHandler(ctx, { sql });

  assert.equal(out.checked, 0);
  assert.equal(out.updated, 0);
});

test("one batch with iCite data → updates rcr", async () => {
  const pmidRows = [{ pmid: 100 }, { pmid: 200 }];
  const sql = makeSql({ pmidRows });
  const ctx = makeCtx({ pauseMs: 0 });

  const mockBody = {
    data: [
      { pmid: 100, relative_citation_ratio: 1.5 },
      { pmid: 200, relative_citation_ratio: 2.1 },
    ],
  };

  const out = await withMockFetch(mockBody, () =>
    rcrBackfillHandler(ctx, { sql })
  );

  assert.equal(out.checked, 2);
  assert.equal(out.updated, 2);

  const updateCalls = sql.calls.filter(c =>
    c.query.includes("research_articles") && c.query.includes("UPDATE")
  );
  assert.equal(updateCalls.length, 2, "should UPDATE both articles");
});

test("iCite returns null RCR → updated=0", async () => {
  const pmidRows = [{ pmid: 999 }];
  const sql = makeSql({ pmidRows });
  const ctx = makeCtx({ pauseMs: 0 });

  const mockBody = {
    data: [
      { pmid: 999, relative_citation_ratio: null },
    ],
  };

  const out = await withMockFetch(mockBody, () =>
    rcrBackfillHandler(ctx, { sql })
  );

  assert.equal(out.checked, 1);
  assert.equal(out.updated, 0, "null RCR should not be written");
});

test("queries research_articles filtering on rcr IS NULL", async () => {
  const sql = makeSql({ pmidRows: [] });
  const ctx = makeCtx();

  await rcrBackfillHandler(ctx, { sql });

  const selectCall = sql.calls.find(c =>
    c.query.includes("research_articles") && c.query.includes("rcr")
  );
  assert.ok(selectCall, "should query with rcr IS NULL filter");
});
