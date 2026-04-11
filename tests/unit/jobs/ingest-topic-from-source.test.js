// tests/unit/jobs/ingest-topic-from-source.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ingestTopicFromSourceHandler } from "../../../jobs/ingest-topic-from-source.js";
import { registerIngestion } from "../../../scripts/sources/_registry.js";
import { SourcePermanentError } from "../../../scripts/sources/_errors.js";

// --- Test fixture plugin ---
// Registered with id "pubmed-test" but yields papers tagged source: "pubmed"
// so the handler's phase 2 filter (pmid required, source must be pubmed
// AND externalId must be numeric) keeps them. The plugin id must also be
// "pubmed" for the handler's `plugin.id === "pubmed"` branch. We pick a
// distinct test id and tag papers with source: "pubmed" — the handler
// accepts either branch via `||`, so the paper.source tag is enough.
const TEST_SOURCE_ID = "test-ingest-src-unit";

const FAKE_PAPERS = [
  { externalId: "1001", source: "pubmed", title: "Paper 1", abstract: "A1", doi: null, publishedAt: null, journal: null, authors: [], peerReviewed: true, sourceMetadata: { pmid: "1001" } },
  { externalId: "1002", source: "pubmed", title: "Paper 2", abstract: "A2", doi: "10.1/a", publishedAt: new Date("2024-01-01"), journal: "J1", authors: ["Auth A"], peerReviewed: false, sourceMetadata: { pmid: "1002" } },
  { externalId: "1003", source: "pubmed", title: "Paper 3", abstract: null, doi: null, publishedAt: null, journal: null, authors: [], peerReviewed: true, sourceMetadata: { pmid: "1003" } },
];

before(() => {
  registerIngestion({
    id: TEST_SOURCE_ID,
    name: "Unit Test Source",
    peerReviewed: true,
    async *fetchPapers(query, opts) {
      for (const p of FAKE_PAPERS) {
        if (opts?.signal?.aborted) break;
        yield p;
      }
    },
  });
});

const FAKE_TOPIC = {
  id: 1,
  topic_key: "test_topic",
  query: "test query",
  target_paper_count: 100,
};

function makeSql({ topicRows = [FAKE_TOPIC], insertReturnsId = true } = {}) {
  const calls = [];
  const tag = function (strings, ...values) {
    const query = strings.join("?");
    calls.push({ query, values });

    if (query.includes("research_topics") && query.includes("SELECT")) {
      return Promise.resolve({ rows: topicRows });
    }
    if (query.includes("research_articles") && query.includes("INSERT")) {
      return Promise.resolve({ rows: insertReturnsId ? [{ id: Math.random() }] : [] });
    }
    return Promise.resolve({ rows: [] });
  };
  tag.calls = calls;
  return tag;
}

function makeBoss() {
  const sent = [];
  return {
    send: async (name, payload) => { sent.push({ name, payload }); },
    sent,
  };
}

function makeCtx(data = {}) {
  const log = [];
  const controller = new AbortController();
  return {
    data: { topicId: 1, sourceId: TEST_SOURCE_ID, target: 100, ...data },
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

// --- Tests ---

test("inserts 3 papers and returns correct counts", async () => {
  const sql = makeSql({ insertReturnsId: true });
  const boss = makeBoss();
  const ctx = makeCtx();

  const out = await ingestTopicFromSourceHandler(ctx, { sql, boss });

  assert.equal(out.inserted, 3, "all 3 papers should be inserted");
  assert.equal(out.skipped, 0, "no skips when all inserts succeed");
});

test("ON CONFLICT skips are counted as skipped", async () => {
  const sql = makeSql({ insertReturnsId: false }); // simulate DO NOTHING
  const boss = makeBoss();
  const ctx = makeCtx();

  const out = await ingestTopicFromSourceHandler(ctx, { sql, boss });

  assert.equal(out.inserted, 0);
  assert.equal(out.skipped, 3);
});

test("enqueues embed-batch follow-up job", async () => {
  const sql = makeSql();
  const boss = makeBoss();
  const ctx = makeCtx();

  await ingestTopicFromSourceHandler(ctx, { sql, boss });

  const embedJob = boss.sent.find(j => j.name === "embed-batch");
  assert.ok(embedJob, "should enqueue embed-batch after insert");
  assert.equal(embedJob.payload.limit, 1000);
});

test("updates research_topics last_filled_at and last_fill_count", async () => {
  const sql = makeSql();
  const boss = makeBoss();
  const ctx = makeCtx();

  await ingestTopicFromSourceHandler(ctx, { sql, boss });

  const updateCall = sql.calls.find(c =>
    c.query.includes("research_topics") && c.query.includes("UPDATE")
  );
  assert.ok(updateCall, "should UPDATE research_topics");
  assert.ok(updateCall.query.includes("last_filled_at"), "should update last_filled_at");
});

test("unknown source throws SourcePermanentError", async () => {
  const sql = makeSql();
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 1, sourceId: "nonexistent-source", target: 100 });

  await assert.rejects(
    () => ingestTopicFromSourceHandler(ctx, { sql, boss }),
    (err) => err instanceof SourcePermanentError,
    "should throw SourcePermanentError for unknown source"
  );
});

test("topic not found throws SourcePermanentError", async () => {
  const sql = makeSql({ topicRows: [] });
  const boss = makeBoss();
  const ctx = makeCtx();

  await assert.rejects(
    () => ingestTopicFromSourceHandler(ctx, { sql, boss }),
    (err) => err instanceof SourcePermanentError,
    "should throw SourcePermanentError for missing topic"
  );
});

test("aborted signal stops iteration early (signal pre-aborted)", async () => {
  // Plugin that checks the signal on each yield
  const ABORT_SOURCE = "test-abort-src-pre";

  // Only register if not already registered
  try {
    registerIngestion({
      id: ABORT_SOURCE,
      name: "Abort Test Source (pre-aborted)",
      peerReviewed: true,
      async *fetchPapers(query, opts) {
        for (let i = 0; i < 100; i++) {
          if (opts?.signal?.aborted) break;
          yield { externalId: `a-${i}`, source: "test", title: `P${i}`, abstract: null, doi: null, publishedAt: null, journal: null, authors: [], peerReviewed: true, sourceMetadata: {} };
        }
      },
    });
  } catch (e) {
    if (!e.message.includes("duplicate")) throw e;
  }

  const sql = makeSql();
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 1, sourceId: ABORT_SOURCE, target: 100 });

  // Pre-abort the signal before the handler starts
  ctx.abort();

  const out = await ingestTopicFromSourceHandler(ctx, { sql, boss });
  // With a pre-aborted signal, the loop checks ctx.signal.aborted after the first yield
  // and the generator checks opts.signal.aborted before each yield.
  // Either way we get 0 inserted because the outer loop breaks on ctx.signal.aborted.
  assert.equal(out.inserted + out.skipped, 0, "pre-aborted signal should produce 0 inserts");
});
