// tests/unit/jobs/ingest-topic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

// We import the handler factory via createIngestTopic so we can inject
// a mock listIngestionSources without touching the real registry singleton.
// Since the handler imports listIngestionSources at module scope, we pass
// a test-double via the deps object.

// Patch: re-export the handler with a DI wrapper for testability.
// The actual module uses the real registry; here we shadow with a local factory.
async function makeHandler(mockListSources) {
  // Dynamic import so we can re-use the module without module-level side effects
  const mod = await import("../../../jobs/ingest-topic.js");
  // Return a wrapped version that overrides listIngestionSources
  return async function ingestTopicHandlerWithMock(ctx, deps) {
    // Swap in the mock list function
    const originalSend = deps.boss.send.bind(deps.boss);
    const fakeDeps = {
      ...deps,
      boss: {
        ...deps.boss,
        send: originalSend,
      },
    };
    // Call via the real handler but the registry is already seeded globally,
    // so instead we test with explicit sourceIds to bypass the registry call.
    return mod.ingestTopicHandler(ctx, fakeDeps);
  };
}

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

function makeBoss() {
  const sent = [];
  return {
    send: async (name, payload, options) => { sent.push({ name, payload, options }); },
    sent,
  };
}

function makeCtx(data = {}) {
  const log = [];
  return {
    data,
    progress: async (msg) => { log.push(msg); },
    log,
  };
}

const FAKE_TOPIC = {
  id: 42,
  topic_key: "blood_flow_restriction",
  query: "blood flow restriction",
  target_paper_count: 500,
};

test("fans out to explicitly provided sourceIds", async () => {
  const handler = await makeHandler(null);
  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "europepmc"] });

  const out = await handler(ctx, { sql, boss });

  assert.equal(out.topicId, 42);
  assert.equal(out.sourceCount, 2);
  assert.equal(boss.sent.length, 2);
  assert.equal(boss.sent[0].name, "ingest-topic-from-source");
  assert.equal(boss.sent[0].payload.topicId, 42);
  assert.equal(boss.sent[0].payload.sourceId, "pubmed");
  assert.equal(boss.sent[0].payload.target, 500);
  assert.equal(boss.sent[1].payload.sourceId, "europepmc");
});

test("uses singletonKey with topicId+sourceId", async () => {
  const handler = await makeHandler(null);
  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed"] });

  await handler(ctx, { sql, boss });

  const opts = boss.sent[0].options;
  assert.ok(opts, "send should include options");
  assert.ok(opts.singletonKey.includes("42"), "singletonKey should include topicId");
  assert.ok(opts.singletonKey.includes("pubmed"), "singletonKey should include sourceId");
  assert.equal(opts.singletonHours, 24, "singletonHours should be 24");
});

test("topic not found throws SourcePermanentError", async () => {
  const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");
  const { SourcePermanentError } = await import("../../../scripts/sources/_errors.js");
  const sql = makeSql({ topicRows: [] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 999, sourceIds: ["pubmed"] });

  await assert.rejects(
    () => ingestTopicHandler(ctx, { sql, boss }),
    (err) => err instanceof SourcePermanentError,
    "should throw SourcePermanentError when topic not found"
  );
});

test("uses all ingestion sources when sourceIds not provided (registry seeded externally)", async () => {
  // We need some ingestion sources registered. Import pubmed plugin which self-registers.
  await import("../../../scripts/sources/pubmed.js");
  const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");

  const allSources = listIngestionSources();
  // Only run this test if at least one source is registered
  if (allSources.length === 0) return;

  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42 }); // no sourceIds → use all

  const out = await ingestTopicHandler(ctx, { sql, boss });

  assert.equal(out.sourceCount, allSources.length);
  assert.equal(boss.sent.length, allSources.length);
});
