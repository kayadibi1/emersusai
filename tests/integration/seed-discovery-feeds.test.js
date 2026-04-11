// tests/integration/seed-discovery-feeds.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema, getTestDbUrl } from "../_helpers/test-db.js";
import { seedDiscoveryFeeds, INITIAL_FEEDS } from "../../scripts/seed-discovery-feeds.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Explicit list of pipeline migrations
const PIPELINE_MIGRATIONS = [
  "20260412_research_articles_rename_and_columns.sql",
  "20260412_research_topics_and_candidates.sql",
  "20260412_discovery_feeds.sql",
  "20260412_job_progress.sql",
  "20260412_alerts_and_heartbeat.sql",
  "20260412_match_evidence_chunks_v2.sql",
];

async function applyAllMigrations() {
  const dir = resolve(__dirname, "../../supabase");
  const available = readdirSync(dir);
  const files = PIPELINE_MIGRATIONS.filter(f => available.includes(f));
  await withTestClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.pubmed_articles (
        id bigserial PRIMARY KEY, pmid bigint UNIQUE, doi text, title text, abstract text,
        is_retracted boolean NOT NULL DEFAULT false,
        is_deleted   boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS pubmed_articles_pmid_idx ON public.pubmed_articles(pmid);
      CREATE TABLE IF NOT EXISTS public.evidence_chunks (
        id bigserial PRIMARY KEY, pmid bigint, chunk_type text, content text, embedding vector(1536)
      );
    `);
    for (const f of files) await client.query(readFileSync(resolve(dir, f), "utf8"));
  });
}

test("seedDiscoveryFeeds inserts the initial ~20 feeds idempotently", async () => {
  await resetSchema();
  await applyAllMigrations();

  assert.ok(INITIAL_FEEDS.length >= 18, `expected >=18 initial feeds, got ${INITIAL_FEEDS.length}`);

  const r1 = await seedDiscoveryFeeds({ databaseUrl: getTestDbUrl() });
  assert.equal(r1.inserted, INITIAL_FEEDS.length);

  const r2 = await seedDiscoveryFeeds({ databaseUrl: getTestDbUrl() });
  assert.equal(r2.inserted, 0);
  assert.equal(r2.updated, INITIAL_FEEDS.length);
});
