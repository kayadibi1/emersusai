// tests/unit/jobs/embed-batch.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { embedBatchHandler } from "../../../jobs/embed-batch.js";

// --- Helpers ---

function makeOpenai(vectorDim = 4) {
  return {
    embeddings: {
      create: async ({ input }) => ({
        data: input.map(() => ({
          embedding: Array.from({ length: vectorDim }, (_, i) => i * 0.01),
        })),
      }),
    },
  };
}

function makeSql({ chunkRows = [], updateError = null } = {}) {
  const calls = [];
  let selectCalled = 0;

  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("evidence_chunks") && query.includes("SELECT")) {
      // Return chunks on first call, empty on second (to end loop)
      selectCalled++;
      if (selectCalled === 1 && chunkRows.length > 0) {
        return Promise.resolve({ rows: chunkRows });
      }
      return Promise.resolve({ rows: [] });
    }

    if (query.includes("evidence_chunks") && query.includes("UPDATE")) {
      if (updateError) return Promise.reject(new Error(updateError));
      return Promise.resolve({ rows: [], error: null });
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
    data: { limit: 10, ...data },
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("embeds a batch of chunks and updates them", async () => {
  const chunkRows = [
    { id: 1, pmid: 100, chunk_type: "abstract", content: "muscle protein synthesis" },
    { id: 2, pmid: 101, chunk_type: "abstract", content: "resistance training adaptations" },
  ];
  const sql = makeSql({ chunkRows });
  const openaiClient = makeOpenai(4);
  const ctx = makeCtx({ limit: 10 });

  const out = await embedBatchHandler(ctx, { sql, openaiClient });

  assert.equal(out.embedded, 2, "should embed both chunks");
  assert.equal(out.batches, 1, "should process 1 batch");

  // Should have issued UPDATE for each chunk
  const updateCalls = sql.calls.filter(c =>
    c.query.includes("evidence_chunks") && c.query.includes("UPDATE")
  );
  assert.equal(updateCalls.length, 2, "should UPDATE 2 rows");
});

test("no unembedded chunks → returns embedded=0", async () => {
  const sql = makeSql({ chunkRows: [] });
  const openaiClient = makeOpenai();
  const ctx = makeCtx();

  const out = await embedBatchHandler(ctx, { sql, openaiClient });

  assert.equal(out.embedded, 0);
  assert.equal(out.batches, 0);
});

test("aborted signal before first batch → exits gracefully with 0 embedded", async () => {
  const chunkRows = [
    { id: 1, pmid: 100, chunk_type: "abstract", content: "test" },
  ];
  const sql = makeSql({ chunkRows });
  const openaiClient = makeOpenai();
  const ctx = makeCtx();

  // Pre-abort the context
  ctx.abort();

  const out = await embedBatchHandler(ctx, { sql, openaiClient });

  assert.equal(out.embedded, 0, "aborted before first batch — no embeddings");
});

test("missing openai client throws", async () => {
  const sql = makeSql();
  const ctx = makeCtx();

  await assert.rejects(
    () => embedBatchHandler(ctx, { sql, openaiClient: null }),
    /OPENAI client not configured/,
    "should throw when openai is null"
  );
});

test("progress called at least once with batch stats", async () => {
  const chunkRows = [
    { id: 1, pmid: 100, chunk_type: "abstract", content: "test content" },
  ];
  const sql = makeSql({ chunkRows });
  const openaiClient = makeOpenai();
  const ctx = makeCtx();

  await embedBatchHandler(ctx, { sql, openaiClient });

  assert.ok(ctx.log.length > 0, "progress should be called at least once");
  assert.ok(ctx.log.some(m => m.includes("embedded")), "progress should mention embedded count");
});
