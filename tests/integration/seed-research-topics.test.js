// tests/integration/seed-research-topics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema, getTestDbUrl } from "../_helpers/test-db.js";
import { seedResearchTopics } from "../../scripts/seed-research-topics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Explicit list of pipeline migrations (same as schema-migrations.test.js)
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
        id bigserial PRIMARY KEY,
        pmid bigint UNIQUE,
        doi text,
        title text,
        abstract text,
        created_at timestamptz NOT NULL DEFAULT now()
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
  });
}

test("seedResearchTopics inserts the 302 baseline topics idempotently", async () => {
  await resetSchema();
  await applyAllMigrations();

  const result = await seedResearchTopics({ databaseUrl: getTestDbUrl() });
  assert.ok(result.inserted >= 300, `expected >=300 inserted, got ${result.inserted}`);
  assert.equal(result.updated, 0, "first run should not update anything");

  // Re-run — should be idempotent (all updates, no inserts)
  const result2 = await seedResearchTopics({ databaseUrl: getTestDbUrl() });
  assert.equal(result2.inserted, 0, "re-run should not insert new rows");
  assert.ok(result2.updated >= 300, "re-run should touch all rows as updates");

  // Spot-check a known topic
  await withTestClient(async (client) => {
    const { rows } = await client.query(
      "SELECT topic_key, origin, domain FROM research_topics WHERE topic_key = 'creatine'"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, "seed");
    assert.ok(rows[0].domain, "domain should be populated from JS section comment");
  });
});
