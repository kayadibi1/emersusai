// tests/integration/end-to-end-smoke.test.js
// End-to-end integration smoke test for the topic discovery pipeline.
//
// Exercises the full chain:
//   discovery-weekly → fetch-feed → classify-candidates (via DI mock)
//   → topic_candidates row → research_topics row → ingest-topic → ingest-topic-from-source
//   → research_articles rows → embed-batch → evidence_chunks embeddings
//
// All handlers are called DIRECTLY (not via pg-boss) using makeContext().
// A fake boss object captures .send() calls so we can assert fanout.
// OpenAI is mocked via the DI parameter supported by createClassifier().
// The ingestion source plugin is a mock registered under id "pubmed" (it
// overrides the real pubmed adapter — safe here because real adapters are
// never imported into this file).
// The CHECK constraint on research_articles.source is dropped in setup so
// we can freely use "mock-source" or rely on the default "pubmed" id.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomUUID } from "node:crypto";

import { withTestClient, resetSchema, getTestDbUrl } from "../_helpers/test-db.js";
import { makeContext } from "../../worker/context.js";

// Import handlers — they do NOT self-import source plugins
import { discoveryWeeklyHandler } from "../../jobs/discovery-weekly.js";
import { fetchFeedHandler } from "../../jobs/fetch-feed.js";
import { createClassifier } from "../../jobs/classify-candidates.js";
import { ingestTopicHandler } from "../../jobs/ingest-topic.js";
import { ingestTopicFromSourceHandler } from "../../jobs/ingest-topic-from-source.js";
import { embedBatchHandler } from "../../jobs/embed-batch.js";

// Import registries — BEFORE any real adapter is imported
import {
  registerIngestion,
  registerDiscovery,
  getIngestionSource,
  getDiscoverySource,
} from "../../scripts/sources/_registry.js";

// ─────────────────────────────────────────────────────────────
// Mock plugins — registered before any real adapter can clash
// ─────────────────────────────────────────────────────────────

const MOCK_SOURCE_ID = "pubmed"; // use an allowed CHECK value; no real pubmed imported

const mockIngestionPlugin = {
  id: MOCK_SOURCE_ID,
  name: "Mock PubMed (smoke test)",
  peerReviewed: true,
  async *fetchPapers(query, opts) {
    const count = opts?.target ?? 3;
    for (let i = 0; i < Math.min(count, 3); i++) {
      yield {
        externalId: `smoke-${i}-${Date.now()}`,
        source: MOCK_SOURCE_ID,
        title: `Smoke paper ${i} — ${query.slice(0, 30)}`,
        abstract: "Mock abstract for smoke test.",
        doi: null,
        publishedAt: new Date("2026-01-15"),
        journal: "Journal of Smoke Testing",
        authors: ["Smith J", "Doe A"],
        peerReviewed: true,
        sourceMetadata: { smokeTest: true },
      };
    }
  },
};

registerIngestion(mockIngestionPlugin);

const mockDiscoveryPlugin = {
  id: "mock-discovery",
  name: "Mock Discovery Feed (smoke test)",
  kind: "rss",
  async fetchNew(feedRow) {
    return [
      {
        url: "https://example.com/bfr-1",
        title: "Blood flow restriction training improves muscle hypertrophy",
        abstract: "A randomised trial examining BFR training effects on hypertrophy in trained individuals.",
        publishedAt: new Date("2026-01-10"),
        feedId: feedRow.id,
      },
      {
        url: "https://example.com/creatine-1",
        title: "Creatine loading phase optimisation review",
        abstract: "Systematic review of creatine loading protocols and their effect on performance.",
        publishedAt: new Date("2026-01-11"),
        feedId: feedRow.id,
      },
    ];
  },
};

registerDiscovery(mockDiscoveryPlugin);

// ─────────────────────────────────────────────────────────────
// Mock OpenAI client — used by createClassifier DI
// ─────────────────────────────────────────────────────────────

const mockOpenai = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              results: [
                {
                  is_exercise_science: true,
                  topic_key: "smoke_bfr_training",
                  raw_term: "Blood Flow Restriction Training",
                  confidence: 0.92,
                  rationale: "Directly about BFR training methodology.",
                  suggested_query: "(blood flow restriction) AND (hypertrophy OR strength)",
                },
                {
                  is_exercise_science: true,
                  topic_key: "smoke_creatine_loading",
                  raw_term: "Creatine Loading",
                  confidence: 0.88,
                  rationale: "Creatine supplementation is a core exercise science topic.",
                  suggested_query: "(creatine loading) AND (performance OR strength)",
                },
              ],
            }),
          },
        }],
      }),
    },
  },
};

const mockEmbeddingOpenai = {
  embeddings: {
    create: async ({ input }) => ({
      data: input.map((_, i) => ({
        embedding: Array.from({ length: 1536 }, (_, j) => (j + i) * 0.0001),
      })),
    }),
  },
};

// ─────────────────────────────────────────────────────────────
// Migrations helper (shared across integration tests)
// ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

const PIPELINE_MIGRATIONS = [
  "20260412_research_articles_rename_and_columns.sql",
  "20260412_research_topics_and_candidates.sql",
  "20260412_discovery_feeds.sql",
  "20260412_job_progress.sql",
  "20260412_alerts_and_heartbeat.sql",
  "20260412_match_evidence_chunks_v2.sql",
];

async function applyAllMigrations(client) {
  const dir = resolve(__dirname, "../../supabase");
  const available = readdirSync(dir);
  const files = PIPELINE_MIGRATIONS.filter(f => available.includes(f));
  // Stub predecessor table that the rename migration expects.
  // Must include all columns used by ingest-topic-from-source (published_at, journal, authors)
  // as well as the columns added by later migrations (source, peer_reviewed, external_id, source_metadata).
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.pubmed_articles (
      id            bigserial PRIMARY KEY,
      pmid          bigint UNIQUE,
      doi           text,
      title         text,
      abstract      text,
      published_at  timestamptz,
      journal       text,
      authors       text[] NOT NULL DEFAULT '{}',
      is_retracted  boolean NOT NULL DEFAULT false,
      is_deleted    boolean NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pubmed_articles_pmid_idx ON public.pubmed_articles(pmid);
    CREATE TABLE IF NOT EXISTS public.evidence_chunks (
      id bigserial PRIMARY KEY,
      pmid bigint,
      chunk_type text,
      content text,
      embedding vector(1536)
    );
  `);
  for (const f of files) {
    await client.query(readFileSync(resolve(dir, f), "utf8"));
  }
}

// ─────────────────────────────────────────────────────────────
// Shared pg pool for the duration of this test file
// ─────────────────────────────────────────────────────────────

let pool;

// Tagged-template sql helper backed by the pool
function makeSql(client) {
  return function sql(strings, ...values) {
    let text = "";
    const params = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    });
    return client.query(text, params);
  };
}

// A fake pg-boss that records .send() calls
function makeFakeBoss() {
  const calls = [];
  return {
    calls,
    async send(queue, data, opts) {
      calls.push({ queue, data, opts });
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────

before(async () => {
  // Fresh schema
  await resetSchema();
  await withTestClient(async (client) => {
    await applyAllMigrations(client);
    // Drop the source CHECK constraint so the mock plugin ID can be anything
    await client.query(`
      ALTER TABLE public.research_articles
        DROP CONSTRAINT IF EXISTS research_articles_source_check
    `);
    // Seed one stub research_topic for the ingest-topic / ingest-topic-from-source steps
    await client.query(`
      INSERT INTO public.research_topics (topic_key, query, domain, origin)
      VALUES ('test_topic_smoke', 'blood flow restriction training', 'resistance_training', 'seed')
    `);
    // Insert the mock discovery feed
    await client.query(`
      INSERT INTO public.discovery_feeds (id, name, kind, url, source_plugin)
      VALUES ('mock-feed', 'Mock Discovery Feed', 'rss', 'https://example.com/mock-feed', 'mock-discovery')
    `);
  });

  pool = new pg.Pool({ connectionString: getTestDbUrl() });
});

after(async () => {
  await pool?.end();
});

// ─────────────────────────────────────────────────────────────
// Helper: acquire a client from the pool + build ctx/deps
// ─────────────────────────────────────────────────────────────

async function withPoolClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// Step 1 — discovery-weekly fans out fetch-feed jobs
// ─────────────────────────────────────────────────────────────

test("step 1: discovery-weekly fans out fetch-feed for active feeds", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const boss = makeFakeBoss();
    const ctx = makeContext({ id: randomUUID(), data: {} }, sql);

    const result = await discoveryWeeklyHandler(ctx, { sql, boss });

    assert.ok(result.feedsDispatched >= 1, `expected >=1 feed dispatched, got ${result.feedsDispatched}`);
    const fetchFeedCalls = boss.calls.filter(c => c.queue === "fetch-feed");
    assert.ok(fetchFeedCalls.length >= 1, "expected at least one fetch-feed job enqueued");
    const mockFeedCall = fetchFeedCalls.find(c => c.data.feedId === "mock-feed");
    assert.ok(mockFeedCall, "expected fetch-feed job for mock-feed");
  });
});

// ─────────────────────────────────────────────────────────────
// Step 2 — fetch-feed fetches items and enqueues classify-candidates
// ─────────────────────────────────────────────────────────────

test("step 2: fetch-feed returns items and enqueues classify-candidates", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const boss = makeFakeBoss();
    const ctx = makeContext({ id: randomUUID(), data: { feedId: "mock-feed" } }, sql);

    const result = await fetchFeedHandler(ctx, { sql, boss });

    assert.equal(result.skipped, undefined, "feed should not be skipped");
    assert.ok(result.itemCount >= 2, `expected >=2 items, got ${result.itemCount}`);
    assert.ok(result.jobsEnqueued >= 1, "expected at least one classify-candidates job");
    const classifyCalls = boss.calls.filter(c => c.queue === "classify-candidates");
    assert.ok(classifyCalls.length >= 1, "classify-candidates job should be enqueued");

    // Verify watermark was updated
    const updated = await sql`SELECT last_run_at, last_item_count FROM discovery_feeds WHERE id = 'mock-feed'`;
    assert.ok(updated.rows[0].last_run_at !== null, "last_run_at should be set");
    assert.equal(Number(updated.rows[0].last_item_count), 2);
  });
});

// ─────────────────────────────────────────────────────────────
// Step 3 — classify-candidates upserts topic_candidates rows
// ─────────────────────────────────────────────────────────────

test("step 3: classify-candidates inserts topic_candidates rows", async () => {
  const items = [
    {
      url: "https://example.com/bfr-1",
      title: "Blood flow restriction training improves muscle hypertrophy",
      abstract: "A randomised trial examining BFR training.",
      publishedAt: new Date("2026-01-10").toISOString(),
      feedId: "mock-feed",
    },
    {
      url: "https://example.com/creatine-1",
      title: "Creatine loading phase optimisation review",
      abstract: "Systematic review of creatine protocols.",
      publishedAt: new Date("2026-01-11").toISOString(),
      feedId: "mock-feed",
    },
  ];

  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const ctx = makeContext(
      { id: randomUUID(), data: { items, feedId: "mock-feed" } },
      sql
    );

    // Use the DI factory with mock openai
    const classifyCandidatesHandler = createClassifier({ openaiClient: mockOpenai });
    const result = await classifyCandidatesHandler(ctx, { sql });

    assert.ok(result.inserted >= 1, `expected >=1 inserted candidate, got ${result.inserted}`);

    const rows = await sql`SELECT topic_key, confidence, status FROM topic_candidates ORDER BY topic_key`;
    assert.ok(rows.rows.length >= 1, "topic_candidates should have rows");
    const keys = rows.rows.map(r => r.topic_key);
    assert.ok(keys.includes("smoke_bfr_training") || keys.includes("smoke_creatine_loading"),
      `expected smoke topic keys, got: ${keys.join(", ")}`);
  });
});

// ─────────────────────────────────────────────────────────────
// Step 4 — promote a candidate to research_topics (simulates human accept)
// ─────────────────────────────────────────────────────────────

let discoveredTopicId;

test("step 4: promote topic_candidate to research_topics (simulates accept)", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);

    // Get a pending candidate
    const candidates = await sql`SELECT * FROM topic_candidates WHERE status = 'pending' LIMIT 1`;
    assert.ok(candidates.rows.length >= 1, "need at least one pending candidate");

    const c = candidates.rows[0];

    // Mark as accepted
    await sql`UPDATE topic_candidates SET status = 'accepted', decided_at = now() WHERE id = ${c.id}`;

    // Insert into research_topics (as discovery pipeline admin would)
    const inserted = await sql`
      INSERT INTO public.research_topics (topic_key, query, domain, origin, source_candidate_id)
      VALUES (
        ${c.topic_key},
        ${c.suggested_query ?? c.raw_term},
        'resistance_training',
        'discovered',
        ${c.id}
      )
      ON CONFLICT (topic_key) DO NOTHING
      RETURNING id
    `;
    // If already exists (shouldn't happen), just fetch the id
    if (inserted.rows.length === 0) {
      const existing = await sql`SELECT id FROM research_topics WHERE topic_key = ${c.topic_key}`;
      discoveredTopicId = existing.rows[0].id;
    } else {
      discoveredTopicId = inserted.rows[0].id;
    }

    assert.ok(discoveredTopicId, "discoveredTopicId must be set");

    // Verify origin=discovered
    const check = await sql`SELECT origin FROM research_topics WHERE id = ${discoveredTopicId}`;
    assert.equal(check.rows[0].origin, "discovered");
  });
});

// ─────────────────────────────────────────────────────────────
// Step 5 — ingest-topic fans out ingest-topic-from-source jobs
// ─────────────────────────────────────────────────────────────

test("step 5: ingest-topic fans out ingest-topic-from-source jobs", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const boss = makeFakeBoss();
    const ctx = makeContext(
      { id: randomUUID(), data: { topicId: discoveredTopicId, sourceIds: [MOCK_SOURCE_ID] } },
      sql
    );

    const result = await ingestTopicHandler(ctx, { sql, boss });

    assert.equal(result.topicId, discoveredTopicId);
    assert.equal(result.sourceCount, 1);

    const ingestCalls = boss.calls.filter(c => c.queue === "ingest-topic-from-source");
    assert.equal(ingestCalls.length, 1, "expected one ingest-topic-from-source job");
    assert.equal(ingestCalls[0].data.sourceId, MOCK_SOURCE_ID);
    assert.equal(ingestCalls[0].data.topicId, discoveredTopicId);
  });
});

// ─────────────────────────────────────────────────────────────
// Step 6 — ingest-topic-from-source inserts research_articles
// ─────────────────────────────────────────────────────────────

test("step 6: ingest-topic-from-source inserts 3 research_articles", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const boss = makeFakeBoss();
    const ctx = makeContext(
      {
        id: randomUUID(),
        data: { topicId: discoveredTopicId, sourceId: MOCK_SOURCE_ID, target: 3 },
      },
      sql
    );

    const result = await ingestTopicFromSourceHandler(ctx, { sql, boss });

    assert.ok(result.inserted >= 3, `expected >=3 inserted, got ${result.inserted}`);
    assert.equal(result.skipped, 0);

    // Verify rows in DB
    const rows = await sql`SELECT id, title, source FROM research_articles`;
    assert.ok(rows.rows.length >= 3, `expected >=3 research_articles rows, got ${rows.rows.length}`);

    // embed-batch should have been enqueued
    const embedCalls = boss.calls.filter(c => c.queue === "embed-batch");
    assert.equal(embedCalls.length, 1, "embed-batch job should be enqueued");
  });
});

// ─────────────────────────────────────────────────────────────
// Step 6b — also ingest the seed topic to have additional articles
// for the embed-batch step
// ─────────────────────────────────────────────────────────────

test("step 6b: ingest the pre-seeded test_topic_smoke topic too", async () => {
  // Get the seed topic id
  let seedTopicId;
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const r = await sql`SELECT id FROM research_topics WHERE topic_key = 'test_topic_smoke'`;
    seedTopicId = r.rows[0].id;
  });

  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const boss = makeFakeBoss();
    const ctx = makeContext(
      {
        id: randomUUID(),
        data: { topicId: seedTopicId, sourceId: MOCK_SOURCE_ID, target: 3 },
      },
      sql
    );
    const result = await ingestTopicFromSourceHandler(ctx, { sql, boss });
    assert.ok(result.inserted >= 3, `seed topic: expected >=3 inserted, got ${result.inserted}`);
  });
});

// ─────────────────────────────────────────────────────────────
// Step 7 — seed evidence_chunks for embed-batch (manually insert chunks
// pointing at the real research_articles we just created)
// ─────────────────────────────────────────────────────────────

test("step 7: seed evidence_chunks from inserted research_articles", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);

    // Insert one evidence_chunk per research_article (using pmid as a FK stand-in)
    const articles = await sql`SELECT id, pmid, title, abstract FROM research_articles LIMIT 6`;
    assert.ok(articles.rows.length >= 3, "need articles to create chunks");

    for (const a of articles.rows) {
      await sql`
        INSERT INTO evidence_chunks (pmid, chunk_type, content)
        VALUES (
          ${a.pmid},
          'abstract',
          ${(a.abstract ?? a.title ?? "").slice(0, 500)}
        )
      `;
    }

    const count = await sql`SELECT count(*) FROM evidence_chunks WHERE embedding IS NULL`;
    assert.ok(Number(count.rows[0].count) >= 3, "expect >=3 unembedded chunks");
  });
});

// ─────────────────────────────────────────────────────────────
// Step 8 — embed-batch embeds the unembedded chunks
// ─────────────────────────────────────────────────────────────

test("step 8: embed-batch embeds unembedded evidence_chunks", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);
    const ctx = makeContext({ id: randomUUID(), data: { limit: 50 } }, sql);

    const result = await embedBatchHandler(ctx, { sql, openaiClient: mockEmbeddingOpenai });

    assert.ok(result.embedded >= 3, `expected >=3 embeddings, got ${result.embedded}`);

    // Verify embeddings were written
    const nonNull = await sql`SELECT count(*) FROM evidence_chunks WHERE embedding IS NOT NULL`;
    assert.ok(Number(nonNull.rows[0].count) >= 3, "evidence_chunks should have non-null embeddings");
  });
});

// ─────────────────────────────────────────────────────────────
// Final assertions — overall pipeline state
// ─────────────────────────────────────────────────────────────

test("final: overall pipeline state assertions", async () => {
  await withPoolClient(async (client) => {
    const sql = makeSql(client);

    // At least one accepted candidate
    const accepted = await sql`SELECT count(*) FROM topic_candidates WHERE status = 'accepted'`;
    assert.ok(Number(accepted.rows[0].count) >= 1,
      `expected >=1 accepted candidate, got ${accepted.rows[0].count}`);

    // At least one discovered topic
    const discovered = await sql`SELECT count(*) FROM research_topics WHERE origin = 'discovered'`;
    assert.ok(Number(discovered.rows[0].count) >= 1,
      `expected >=1 discovered topic, got ${discovered.rows[0].count}`);

    // At least 3 research_articles
    const articles = await sql`SELECT count(*) FROM research_articles`;
    assert.ok(Number(articles.rows[0].count) >= 3,
      `expected >=3 articles, got ${articles.rows[0].count}`);

    // At least 3 evidence_chunks with embeddings
    const embedded = await sql`SELECT count(*) FROM evidence_chunks WHERE embedding IS NOT NULL`;
    assert.ok(Number(embedded.rows[0].count) >= 3,
      `expected >=3 embedded chunks, got ${embedded.rows[0].count}`);

    // job_progress rows written throughout
    const progress = await sql`SELECT count(*) FROM job_progress`;
    assert.ok(Number(progress.rows[0].count) >= 5,
      `expected >=5 job_progress rows, got ${progress.rows[0].count}`);
  });
});
