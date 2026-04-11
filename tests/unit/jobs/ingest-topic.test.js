// tests/unit/jobs/ingest-topic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
// Side-effect import: ensure the pubmed plugin is in the registry so the
// handler's available-source intersection keeps pubmed entries.
import "../../../scripts/sources/pubmed.js";

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

test("fans out to explicitly provided sourceIds (phase 2: pubmed only)", async () => {
  // Phase 2 constraint: SUPPORTED_SOURCE_IDS = ["pubmed"] in the handler.
  // Non-pubmed entries in requestedSourceIds are filtered out. europepmc
  // will come back when the multi-source schema rework lands.
  const handler = await makeHandler(null);
  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "europepmc"] });

  const out = await handler(ctx, { sql, boss });

  assert.equal(out.topicId, 42);
  assert.equal(out.sourceCount, 1, "only pubmed survives the phase 2 filter");
  assert.equal(boss.sent.length, 1);
  assert.equal(boss.sent[0].name, "ingest-topic-from-source");
  assert.equal(boss.sent[0].payload.topicId, 42);
  assert.equal(boss.sent[0].payload.sourceId, "pubmed");
  assert.equal(boss.sent[0].payload.target, 500);
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

test("sends ingest-topic-from-source with retryLimit 5 + backoff", async () => {
  // Regression: the 2026-04-11 phase 2 deploy landed 14 permanently-failed
  // ingest-topic-from-source jobs because pg-boss's default retryLimit: 2
  // plus no backoff couldn't absorb NCBI's TCP-drop throttling. Fix B
  // bumps retry to 5 with exponential backoff.
  const handler = await makeHandler(null);
  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed"] });

  await handler(ctx, { sql, boss });

  const opts = boss.sent[0].options;
  assert.equal(opts.retryLimit, 5, "retryLimit should be 5");
  assert.equal(opts.retryBackoff, true, "retryBackoff should be true");
  assert.equal(opts.retryDelay, 15, "retryDelay should be 15 seconds");
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

  // Filter out deprioritized + disabled sources that the handler skips
  const DEPRIORITIZED = new Set(["crossref", "doaj"]);
  const disabled = new Set(
    (process.env.INGEST_DISABLED_SOURCES || "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const legacySupported = new Set(["pubmed"]);
  const expected = process.env.MULTI_SOURCE_ENABLED === "true"
    ? allSources.filter((s) => !DEPRIORITIZED.has(s.id) && !disabled.has(s.id))
    : allSources.filter((s) => legacySupported.has(s.id) && !DEPRIORITIZED.has(s.id) && !disabled.has(s.id));

  const sql = makeSql({ topicRows: [FAKE_TOPIC] });
  const boss = makeBoss();
  const ctx = makeCtx({ topicId: 42 }); // no sourceIds → use all

  const out = await ingestTopicHandler(ctx, { sql, boss });

  assert.equal(out.sourceCount, expected.length);
  assert.equal(boss.sent.length, expected.length);
});

test("when MULTI_SOURCE_ENABLED is unset, only pubmed source is routed", async () => {
  const originalFlag = process.env.MULTI_SOURCE_ENABLED;
  delete process.env.MULTI_SOURCE_ENABLED;
  try {
    // Register biorxiv + europepmc alongside pubmed so the available list
    // has multiple sources. The handler should still filter to pubmed.
    await import("../../../scripts/sources/europepmc.js");
    await import("../../../scripts/sources/biorxiv.js");
    const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");

    const sql = makeSql({ topicRows: [FAKE_TOPIC] });
    const boss = makeBoss();
    const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "europepmc", "biorxiv"] });

    await ingestTopicHandler(ctx, { sql, boss });

    assert.equal(boss.sent.length, 1, "only one source should fan out");
    assert.equal(boss.sent[0].payload.sourceId, "pubmed");
  } finally {
    if (originalFlag !== undefined) process.env.MULTI_SOURCE_ENABLED = originalFlag;
  }
});

test("when MULTI_SOURCE_ENABLED=true, all non-deprioritized sources are routed", async () => {
  const originalFlag = process.env.MULTI_SOURCE_ENABLED;
  process.env.MULTI_SOURCE_ENABLED = "true";
  try {
    await import("../../../scripts/sources/europepmc.js");
    await import("../../../scripts/sources/biorxiv.js");
    const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");

    const sql = makeSql({ topicRows: [FAKE_TOPIC] });
    const boss = makeBoss();
    const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "europepmc", "biorxiv"] });

    await ingestTopicHandler(ctx, { sql, boss });

    const sentIds = boss.sent.map(j => j.payload.sourceId).sort();
    assert.deepEqual(sentIds, ["biorxiv", "europepmc", "pubmed"]);
  } finally {
    if (originalFlag !== undefined) process.env.MULTI_SOURCE_ENABLED = originalFlag;
    else delete process.env.MULTI_SOURCE_ENABLED;
  }
});

test("crossref and doaj are filtered out even when MULTI_SOURCE_ENABLED=true", async () => {
  const originalFlag = process.env.MULTI_SOURCE_ENABLED;
  process.env.MULTI_SOURCE_ENABLED = "true";
  try {
    await import("../../../scripts/sources/crossref.js");
    await import("../../../scripts/sources/doaj.js");
    const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");

    const sql = makeSql({ topicRows: [FAKE_TOPIC] });
    const boss = makeBoss();
    const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "crossref", "doaj"] });

    await ingestTopicHandler(ctx, { sql, boss });

    const sentIds = boss.sent.map(j => j.payload.sourceId);
    assert.deepEqual(sentIds, ["pubmed"], "only pubmed should survive the deprioritized filter");
  } finally {
    if (originalFlag !== undefined) process.env.MULTI_SOURCE_ENABLED = originalFlag;
    else delete process.env.MULTI_SOURCE_ENABLED;
  }
});

test("INGEST_DISABLED_SOURCES env var excludes listed sources", async () => {
  const originalFlag = process.env.MULTI_SOURCE_ENABLED;
  const originalDisabled = process.env.INGEST_DISABLED_SOURCES;
  process.env.MULTI_SOURCE_ENABLED = "true";
  process.env.INGEST_DISABLED_SOURCES = "biorxiv, europepmc";
  try {
    await import("../../../scripts/sources/europepmc.js");
    await import("../../../scripts/sources/biorxiv.js");
    const { ingestTopicHandler } = await import("../../../jobs/ingest-topic.js");

    const sql = makeSql({ topicRows: [FAKE_TOPIC] });
    const boss = makeBoss();
    const ctx = makeCtx({ topicId: 42, sourceIds: ["pubmed", "europepmc", "biorxiv"] });

    await ingestTopicHandler(ctx, { sql, boss });

    const sentIds = boss.sent.map(j => j.payload.sourceId);
    assert.deepEqual(sentIds, ["pubmed"], "both biorxiv and europepmc should be filtered out");
  } finally {
    if (originalFlag !== undefined) process.env.MULTI_SOURCE_ENABLED = originalFlag;
    else delete process.env.MULTI_SOURCE_ENABLED;
    if (originalDisabled !== undefined) process.env.INGEST_DISABLED_SOURCES = originalDisabled;
    else delete process.env.INGEST_DISABLED_SOURCES;
  }
});
