// tests/integration/jobs/chunk-articles-gc.test.js
// Integration: hits the local test Postgres (docker-compose.test.yml).

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getTestDbUrl, resetSchema } from "../../_helpers/test-db.js";
import { chunkArticlesGcHandler } from "../../../jobs/chunk-articles-gc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase");
const PIPELINE_MIGRATIONS = [
  "20260412_research_articles_rename_and_columns.sql",
  "20260412_research_articles_source_check_expand.sql",
  "20260412_research_articles_synthetic_pmid_sequence.sql",
  "20260412_research_topics_and_candidates.sql",
  "20260412_discovery_feeds.sql",
  "20260412_job_progress.sql",
  "20260412_alerts_and_heartbeat.sql",
  "20260412_match_evidence_chunks_v2.sql",
];

async function applyAllMigrations(client) {
  const available = readdirSync(MIGRATIONS_DIR);
  const files = PIPELINE_MIGRATIONS.filter((f) => available.includes(f));
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
      embedding vector(1536),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- Stub roles that prod migrations GRANT to. The minimal local test
    -- Postgres runs as testuser and has no supabase_admin/postgres role.
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        CREATE ROLE supabase_admin;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
    END $$;
  `);
  for (const f of files) {
    await client.query(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"));
  }
}

// Tagged-template sql helper matching the production worker shape.
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

function makeFakeBoss() {
  const sent = [];
  return {
    sent,
    async send(name, data) {
      sent.push({ name, data });
      return "fake-job-id";
    },
  };
}

let client;

before(async () => {
  await resetSchema();
  client = new pg.Client({ connectionString: getTestDbUrl() });
  await client.connect();
  await applyAllMigrations(client);
});

after(async () => {
  if (client) await client.end();
});

beforeEach(async () => {
  await client.query(`TRUNCATE evidence_chunks, research_articles RESTART IDENTITY CASCADE`);
});

async function seedFour() {
  // 1. openalex row WITH abstract, no chunks → should be chunked
  await client.query(
    `INSERT INTO research_articles (pmid, source, external_id, title, abstract)
     VALUES (10000000001, 'openalex', 'W1', 'Title 1',
       'A randomized controlled trial showing that creatine supplementation increases lean mass in resistance-trained males over an 8-week intervention period.')`
  );
  // 2. openalex row WITHOUT abstract → skipped
  await client.query(
    `INSERT INTO research_articles (pmid, source, external_id, title, abstract)
     VALUES (10000000002, 'openalex', 'W2', 'Title 2', NULL)`
  );
  // 3. openalex row already chunked → left alone
  await client.query(
    `INSERT INTO research_articles (pmid, source, external_id, title, abstract)
     VALUES (10000000003, 'openalex', 'W3', 'Title 3',
       'Another sufficient abstract with lots of text describing the methodology and outcomes of the study conducted over a multi-year period.')`
  );
  await client.query(
    `INSERT INTO evidence_chunks (pmid, chunk_type, content)
     VALUES (10000000003, 'title', 'Title 3')`
  );
  // 4. semantic-scholar row WITH abstract → touched unless source filter set
  await client.query(
    `INSERT INTO research_articles (pmid, source, external_id, title, abstract)
     VALUES (10000000004, 'semantic-scholar', 'S1', 'Title 4',
       'A controlled trial examining the effect of beta-alanine supplementation on muscular endurance in elite athletes over 12 weeks of structured training.')`
  );
}

test("chunks rows with abstract, skips rows without, leaves already-chunked rows alone", async () => {
  await seedFour();
  const sql = makeSql(client);
  const boss = makeFakeBoss();
  const ctx = { id: "t1", data: { limit: 100 } };
  const result = await chunkArticlesGcHandler(ctx, { sql, boss, log: console });

  const after = await client.query(
    `SELECT pmid, chunk_type FROM evidence_chunks ORDER BY pmid, chunk_type`
  );
  const byPmid = {};
  for (const r of after.rows) {
    byPmid[r.pmid] = byPmid[r.pmid] || [];
    byPmid[r.pmid].push(r.chunk_type);
  }
  assert.deepEqual(byPmid["10000000001"].sort(), ["abstract", "title"]);
  assert.equal(byPmid["10000000002"], undefined);
  assert.deepEqual(byPmid["10000000003"], ["title"]);
  assert.deepEqual(byPmid["10000000004"].sort(), ["abstract", "title"]);
  assert.ok(result.rowsProcessed >= 2);
  assert.ok(result.chunksInserted >= 4);
});

test("source filter restricts to one source", async () => {
  await seedFour();
  const sql = makeSql(client);
  const boss = makeFakeBoss();
  const ctx = { id: "t2", data: { limit: 100, source: "semantic-scholar" } };
  await chunkArticlesGcHandler(ctx, { sql, boss, log: console });

  const openalexChunks = await client.query(
    `SELECT count(*)::int AS n FROM evidence_chunks WHERE pmid = 10000000001`
  );
  assert.equal(openalexChunks.rows[0].n, 0, "openalex NOT touched under source filter");
  const s2Chunks = await client.query(
    `SELECT count(*)::int AS n FROM evidence_chunks WHERE pmid = 10000000004`
  );
  assert.ok(s2Chunks.rows[0].n >= 2, "semantic-scholar row got chunks");
});

test("limit caps processed rows", async () => {
  await seedFour();
  const sql = makeSql(client);
  const boss = makeFakeBoss();
  const ctx = { id: "t3", data: { limit: 1 } };
  const result = await chunkArticlesGcHandler(ctx, { sql, boss, log: console });
  assert.equal(result.rowsProcessed, 1);
});

test("boss.send('embed-batch') called only when chunks are inserted", async () => {
  await seedFour();
  const sql = makeSql(client);
  const bossHit = makeFakeBoss();
  await chunkArticlesGcHandler({ id: "t4", data: { limit: 100 } }, { sql, boss: bossHit, log: console });
  assert.equal(bossHit.sent.filter((s) => s.name === "embed-batch").length, 1);

  // Second run: everything is chunked already → no-op tick → no enqueue
  const bossMiss = makeFakeBoss();
  await chunkArticlesGcHandler({ id: "t5", data: { limit: 100 } }, { sql, boss: bossMiss, log: console });
  assert.equal(bossMiss.sent.filter((s) => s.name === "embed-batch").length, 0);
});
