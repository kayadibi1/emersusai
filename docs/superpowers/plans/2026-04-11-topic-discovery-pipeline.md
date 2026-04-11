# Topic Discovery Pipeline & Multi-Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly-cron topic discovery pipeline that scans curated RSS feeds, LLM-classifies candidates into a review queue, and on accept fans out ingestion across seven academic + preprint sources into the renamed `research_articles` table — all coordinated by a new pg-boss worker process alongside `emersus-api`.

**Architecture:** Single pg-boss worker on Hetzner consuming ~13 job types from our self-hosted Postgres. Source plugins under `scripts/sources/` implement a uniform `fetchNew`/`fetchPapers` interface. CLI wrappers under `scripts/` preserve terminal UX by enqueueing jobs and tailing progress from a `job_progress` table. Admin UI lives under `admin/*` with env-allowlist auth. Tiered email alerts (worker-down / failure-cluster / daily digest) via Resend.

**Tech Stack:** Node.js ESM, Express 5, `pg-boss@^10`, self-hosted Supabase Postgres 15 + pgvector, Resend, `gpt-5-mini` for classification, `nock` for HTTP test fixtures, pm2 for process management, vanilla JS + esm.sh for frontend.

**Spec:** `docs/superpowers/specs/2026-04-11-topic-discovery-pipeline-design.md`

---

## Prerequisites

1. The in-flight `npm run fill:pmc:topics` run on Hetzner is allowed to complete (~14h remaining at plan-write time). Phase 1 deploy does not start until that job finishes. Milestones 0–11 (code work) run in parallel with the running fill.
2. A dedicated git worktree branched from `main` has been created. All work happens there. If brainstorming did not create one, create it as Task 0.1.
3. Local Docker Postgres 15 with pgvector is available for integration tests. `docker-compose.test.yml` is added in Task 1.1.
4. Node.js v20+, npm, and Docker Desktop installed on the dev machine.

## Test strategy overview

- **Unit** tests live under `tests/unit/` and use `node --test` (Node's built-in runner). Each source plugin, job handler, and CLI wrapper helper has a dedicated test file.
- **Integration** tests live under `tests/integration/` and spin up a real Postgres 15 container via `docker-compose.test.yml`. They apply migrations, seed data, and exercise real SQL.
- **HTTP** fixtures for source-plugin tests use `nock` with captured real responses stored in `tests/fixtures/<source>/*.json` or `.xml`.
- **End-to-end smoke** is a single manual script in Milestone 11 that walks the whole pipeline against the test Postgres: seed → fetch mock feed → classify → accept → ingest → embed.

All tests run locally without touching prod. The CI entry point is `npm test` which runs `node --test tests/**/*.test.js`.

## File structure

The following is the authoritative map of new/modified files. Each task references exact paths from this list.

### New files

```
api/admin/
  _middleware.js                           # requireAdmin
  candidates.js                            # GET/POST /api/admin/candidates*
  topics.js                                # GET/PATCH /api/admin/topics*
  feeds.js                                 # GET/POST/PATCH /api/admin/feeds*
  jobs.js                                  # GET /api/admin/jobs*
  alerts.js                                # GET /api/admin/alerts

api/lib/alerts.js                          # Resend-based sendAlert()

worker/
  index.js                                 # pm2 entry, boots pg-boss + registers handlers
  context.js                               # makeContext() — data, signal, progress, abort
  heartbeat.js                             # 30s heartbeat loop
  logger.js                                # structured stderr logger

jobs/
  _registry.js                             # imports all handlers, calls boss.work
  discovery-weekly.js
  fetch-feed.js
  classify-candidates.js
  ingest-topic.js
  ingest-topic-from-source.js
  embed-batch.js
  s2-citation-backfill.js
  rcr-backfill.js
  validate-queries.js
  detect-failure-clusters.js
  alert-daily-digest.js
  cleanup-job-progress.js
  send-alert.js                            # helper job invoked by alerts.js

scripts/lib/run-as-job.js                  # CLI enqueue + progress-tail + exit-code helper

scripts/sources/
  _types.js                                # JSDoc typedefs for Source interfaces
  _registry.js                             # ingestionSources[], discoverySources[]
  _ratelimit.js                            # createLimiter(rps)
  _errors.js                               # SourceTransientError, SourceRateLimitError, SourcePermanentError
  _http.js                                 # fetchWithTimeoutAndUA (shared curl-alternative)
  pubmed.js                                # ingestion adapter (PMID-keyed)
  europepmc.js                             # ingestion adapter
  biorxiv.js                               # ingestion + discovery
  medrxiv.js                               # ingestion + discovery
  sportrxiv.js                             # ingestion + discovery (OSF API)
  crossref.js                              # ingestion adapter
  doaj.js                                  # ingestion adapter
  rss-generic.js                           # shared RSS parser + emitter helper
  rss-sbs.js                               # Stronger By Science
  rss-suppversity.js
  rss-mass.js
  rss-sfs.js                               # Science For Sport
  rss-nsca.js
  rss-acsm.js
  rss-journal-bjsm.js                      # journal TOCs
  rss-journal-jscr.js
  rss-journal-msse.js
  rss-journal-ijspp.js
  rss-journal-jap.js
  rss-journal-sportsmed.js
  rss-journal-sjmss.js
  rss-journal-ejap.js

scripts/                                   # CLI wrappers (NEW + REPLACED)
  discover-topics.js                       # wraps discovery-weekly
  seed-research-topics.js                  # one-shot idempotent
  seed-discovery-feeds.js                  # one-shot idempotent
  heartbeat-watchdog.js                    # Hetzner crontab entry
  send-test-alert.js                       # wraps send-alert
  jobs-tail.js                             # tail a job id
  jobs-list.js                             # list recent jobs

  embed-papers.js                          # REPLACED wrapper → embed-batch
  embed-papers-direct.js                   # preserved old logic for --direct
  backfill-semantic-scholar.js             # REPLACED wrapper → s2-citation-backfill
  backfill-semantic-scholar-direct.js      # preserved old logic
  backfill-citation-counts.js              # REPLACED wrapper → s2-citation-backfill
  fill-rcr-scores.js                       # REPLACED wrapper → rcr-backfill
  fill-rcr-scores-direct.js                # preserved old logic
  validate-pubmed-queries.js               # REPLACED wrapper → validate-queries
  validate-pubmed-queries-direct.js        # preserved old logic
  fill-pmc-topics.js                       # REPLACED wrapper (JS TOPIC_QUERIES seed stays in file)
  fill-pmc-corpus.js                       # DELETED (logic moved to jobs/ingest-topic-from-source.js)

admin/
  index.html                               # dashboard
  candidates/index.html
  topics/index.html
  feeds/index.html
  jobs/index.html
  alerts/index.html

shared/admin.css                           # admin-only layout, tables, cards

supabase/
  20260412_research_articles_rename_and_columns.sql
  20260412_research_topics_and_candidates.sql
  20260412_discovery_feeds.sql
  20260412_job_progress.sql
  20260412_alerts_and_heartbeat.sql
  20260412_match_evidence_chunks_v2.sql

docker-compose.test.yml                    # postgres:15 + pgvector for integration tests

tests/
  unit/
    sources/pubmed.test.js
    sources/europepmc.test.js
    sources/biorxiv.test.js
    sources/medrxiv.test.js
    sources/sportrxiv.test.js
    sources/crossref.test.js
    sources/doaj.test.js
    sources/rss-generic.test.js
    sources/ratelimit.test.js
    jobs/discovery-weekly.test.js
    jobs/fetch-feed.test.js
    jobs/classify-candidates.test.js
    jobs/ingest-topic.test.js
    jobs/ingest-topic-from-source.test.js
    jobs/embed-batch.test.js
    jobs/s2-citation-backfill.test.js
    jobs/detect-failure-clusters.test.js
    jobs/alert-daily-digest.test.js
    worker/context.test.js
    worker/heartbeat.test.js
    lib/run-as-job.test.js
    lib/alerts.test.js
  integration/
    schema-migrations.test.js
    seed-research-topics.test.js
    seed-discovery-feeds.test.js
    admin-api.test.js
  fixtures/
    pubmed/esearch-creatine.xml
    pubmed/efetch-creatine.xml
    europepmc/search-creatine.json
    biorxiv/details-physiology.json
    medrxiv/details-nutrition.json
    sportrxiv/osf-nodes.json
    crossref/works-creatine.json
    doaj/articles-creatine.json
    rss/sbs.xml
    rss/bjsm-toc.xml
```

### Modified files

```
api/emersus/workflow.js                    # update pubmed_articles → research_articles refs
server.js                                  # mount /api/admin/*, serve admin/ static
package.json                               # add pg-boss, nock; update scripts
.env.example                               # add ADMIN_EMAILS, ALERT_EMAILS, ALERT_SILENT
infra/ecosystem.config.cjs                 # add emersus-worker pm2 entry (untracked, local-only)
```

---

## Milestones

| # | Milestone | Produces | Gate |
|---|---|---|---|
| 0 | Worktree + deps | `pg-boss`, `nock` installed; worktree ready | Task 0 all green |
| 1 | Schema migrations + integration test harness | All 6 SQL migrations + Docker test Postgres; migrations verified idempotent | `npm test -- --test-name-pattern="schema-migrations"` green |
| 2 | pg-boss worker core | Worker boots, heartbeats, exits cleanly | `node worker/index.js` writes heartbeat row |
| 3 | Source plugin interface + PubMed adapter | `_types.js`, `_registry.js`, `_ratelimit.js`, `_errors.js`, `pubmed.js` + tests | `npm test -- --test-name-pattern="pubmed"` green |
| 4 | Remaining 6 ingestion adapters | Europe PMC, BioRxiv, medRxiv, SportRxiv, CrossRef, DOAJ + tests | all source tests green |
| 5 | Discovery plugins + classifier | RSS adapters + gpt-5-mini classifier job | classifier unit test green with mocked OpenAI |
| 6 | Job handlers (all 13) | `jobs/*.js` with unit tests against mocked pg-boss | all job tests green |
| 7 | CLI wrapper helper + first wrapper | `run-as-job.js` + `embed-papers.js` wrapper | wrapper enqueues and tails a job end-to-end against test Postgres |
| 8 | Remaining wrappers + `--direct` siblings | 6 more wrappers + 4 direct siblings | all wrappers tested manually |
| 9 | Admin UI + API | 6 HTML pages + 5 API resource files + auth middleware | manual smoke against local Express |
| 10 | Alerts + heartbeat watchdog | `alerts.js`, `send-alert.js` job, watchdog script | `send-test-alert.js` delivers email in dev with Resend |
| 11 | Integration smoke (local) | End-to-end script walks discovery→accept→ingest→embed | smoke script exits 0 |
| 12 | Deploy prep + runbook | DB backup verification, phase 1–3 runbooks, rollback docs | User approves runbook, ready for phase 1 deploy |

Each milestone commits independently. Work proceeds sequentially within a milestone but milestones 3→4, 5→6, 7→8 can fan out to parallel subagents if you use subagent-driven execution.

---

## Milestone 0: Worktree + dependencies

### Task 0.1: Create worktree (skip if brainstorming already did this)

**Files:**
- No file changes. Git worktree only.

- [ ] **Step 1: Check for existing worktree**

Run: `git worktree list`
Expected: either `worktree-topic-pipeline` is listed, in which case skip to Task 0.2, or it's not, in which case continue.

- [ ] **Step 2: Create the worktree**

Run: `git worktree add ../worktree-topic-pipeline -b feat/topic-discovery-pipeline`
Expected: `Preparing worktree (new branch 'feat/topic-discovery-pipeline')` and a new sibling directory appears.

- [ ] **Step 3: Cd into it**

Run: `cd ../worktree-topic-pipeline`
Expected: pwd ends with `worktree-topic-pipeline`. All subsequent tasks run from here.

### Task 0.2: Install runtime and dev dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add pg-boss to dependencies**

Run: `npm install pg-boss@^10`
Expected: `package.json` dependencies gains `"pg-boss": "^10..."`, `package-lock.json` updates.

- [ ] **Step 2: Add nock to devDependencies**

Run: `npm install --save-dev nock@^13`
Expected: `package.json` devDependencies gains `"nock": "^13..."`.

- [ ] **Step 3: Verify Node version**

Run: `node --version`
Expected: `v20.x.x` or higher. If lower, stop and upgrade Node before proceeding — `node:test` and some async iterator behavior differ on older versions.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add pg-boss and nock for topic-discovery pipeline"
```

### Task 0.3: Create test Postgres compose file

**Files:**
- Create: `docker-compose.test.yml`

- [ ] **Step 1: Write the compose file**

```yaml
# docker-compose.test.yml
# Local test Postgres for integration tests. Matches prod schema (pg 15 + pgvector).
# Usage: docker compose -f docker-compose.test.yml up -d
#        npm test
#        docker compose -f docker-compose.test.yml down -v
services:
  postgres-test:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_PASSWORD: testpass
      POSTGRES_DB: emersus_test
      POSTGRES_USER: testuser
    ports:
      - "54329:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "testuser", "-d", "emersus_test"]
      interval: 1s
      timeout: 2s
      retries: 20
```

- [ ] **Step 2: Boot the container**

Run: `docker compose -f docker-compose.test.yml up -d`
Expected: `[+] Running 2/2 ... Container postgres-test-1 Started`. Takes ~5s.

- [ ] **Step 3: Verify pgvector extension is available**

Run: `docker compose -f docker-compose.test.yml exec postgres-test psql -U testuser -d emersus_test -c "CREATE EXTENSION vector; SELECT 'ok';"`
Expected: `CREATE EXTENSION` then `ok`. If this fails, the wrong image was pulled; verify it's `pgvector/pgvector:pg15`.

- [ ] **Step 4: Drop and re-create for clean state**

Run: `docker compose -f docker-compose.test.yml down -v && docker compose -f docker-compose.test.yml up -d`
Expected: container restarts clean, ready for migration tests.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.test.yml
git commit -m "test(infra): docker-compose test postgres with pgvector"
```

### Task 0.4: Set up test runner config and helper

**Files:**
- Create: `tests/_helpers/test-db.js`

- [ ] **Step 1: Write the shared test DB helper**

```js
// tests/_helpers/test-db.js
// Shared helper for integration tests that need a real Postgres.
// Connects to the local docker-compose test postgres on port 54329.
import pg from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://testuser:testpass@127.0.0.1:54329/emersus_test";

export function getTestDbUrl() {
  return TEST_DATABASE_URL;
}

export async function withTestClient(fn) {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function resetSchema() {
  await withTestClient(async (client) => {
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO testuser;
      CREATE EXTENSION IF NOT EXISTS vector;
    `);
  });
}
```

- [ ] **Step 2: Verify the helper connects**

Run: `node --input-type=module -e "import { withTestClient } from './tests/_helpers/test-db.js'; await withTestClient(async c => console.log((await c.query('SELECT 1 as ok')).rows));"`
Expected: `[ { ok: 1 } ]`. If connection refused, compose didn't boot — revisit Task 0.3.

- [ ] **Step 3: Commit**

```bash
git add tests/_helpers/test-db.js
git commit -m "test(helpers): shared test-db client"
```

### Task 0.5: Add test script to package.json

**Files:**
- Modify: `package.json` (scripts section)

- [ ] **Step 1: Add `test` script**

Edit `package.json`, inside `"scripts"`, add:

```json
"test": "node --test tests/unit tests/integration",
"test:unit": "node --test tests/unit",
"test:integration": "node --test tests/integration"
```

- [ ] **Step 2: Verify empty run exits 0**

Run: `npm test`
Expected: `# tests 0 # pass 0 # fail 0` and exit code 0. No test files exist yet, so zero-pass is correct.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(scripts): add npm test / test:unit / test:integration"
```

---

## Milestone 1: Schema migrations + integration harness

### Task 1.1: Write integration-test harness for migrations

**Files:**
- Create: `tests/integration/schema-migrations.test.js`

- [ ] **Step 1: Write the failing test that applies all migrations in order**

```js
// tests/integration/schema-migrations.test.js
// Integration test: applies all 2026-04-12 migrations in order against a fresh
// test postgres and verifies the resulting schema is consistent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../supabase");
const MIGRATION_PREFIX = "20260412_";

function listMigrationsInOrder() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.startsWith(MIGRATION_PREFIX) && f.endsWith(".sql"))
    .sort();
}

test("all 20260412 migrations apply cleanly to an empty DB", async () => {
  await resetSchema();

  // Seed the prior state: the test DB starts empty, but the rename migration
  // assumes a public.pubmed_articles table exists. Create a minimal stub.
  await withTestClient(async (client) => {
    await client.query(`
      CREATE TABLE public.pubmed_articles (
        id bigserial PRIMARY KEY,
        pmid bigint UNIQUE,
        doi text,
        title text,
        abstract text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX pubmed_articles_pmid_idx ON public.pubmed_articles(pmid);
    `);
  });

  const files = listMigrationsInOrder();
  assert.ok(files.length >= 6, `expected >=6 migration files, got ${files.length}: ${files.join(", ")}`);

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    await withTestClient(async (client) => {
      await client.query(sql);
    });
  }

  // Assertions on the resulting schema
  await withTestClient(async (client) => {
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = tables.rows.map(r => r.table_name);
    assert.ok(names.includes("research_articles"), "research_articles should exist after rename");
    assert.ok(!names.includes("pubmed_articles"), "pubmed_articles should be renamed away");
    assert.ok(names.includes("research_topics"));
    assert.ok(names.includes("topic_candidates"));
    assert.ok(names.includes("discovery_feeds"));
    assert.ok(names.includes("job_progress"));
    assert.ok(names.includes("worker_heartbeats"));
    assert.ok(names.includes("alert_log"));
  });
});

test("migrations are idempotent — re-applying succeeds or no-ops cleanly", async () => {
  // Re-apply on top of the already-migrated DB; should either no-op or
  // fail gracefully. This catches common mistakes like forgotten IF NOT EXISTS.
  const files = listMigrationsInOrder();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    // Migrations that aren't naturally idempotent should be wrapped in
    // DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$.
    // We don't strictly require idempotency here but the rename one will
    // throw "relation pubmed_articles does not exist" on second apply —
    // that's expected and acceptable.
    try {
      await withTestClient(async (client) => {
        await client.query(sql);
      });
    } catch (e) {
      // Acceptable: object already exists, table not found (rename already done)
      if (!/already exists|does not exist/.test(e.message)) {
        throw e;
      }
    }
  }
});
```

- [ ] **Step 2: Run it — expect it to fail because no migration files exist**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: FAIL with `expected >=6 migration files, got 0`. This is the correct failure — we haven't written the SQL yet.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/schema-migrations.test.js
git commit -m "test(integration): failing schema-migrations harness"
```

### Task 1.2: Write the rename-and-columns migration

**Files:**
- Create: `supabase/20260412_research_articles_rename_and_columns.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- supabase/20260412_research_articles_rename_and_columns.sql
-- Renames pubmed_articles -> research_articles and adds multi-source columns.
-- Must run BEFORE 20260412_match_evidence_chunks_v2.sql (which references the new name).

BEGIN;

ALTER TABLE public.pubmed_articles RENAME TO research_articles;

-- Rename the pmid index to match the new table name for clarity
ALTER INDEX IF EXISTS pubmed_articles_pmid_idx RENAME TO research_articles_pmid_idx;

ALTER TABLE public.research_articles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pubmed'
    CHECK (source IN ('pubmed', 'europepmc', 'biorxiv', 'medrxiv', 'sportrxiv', 'crossref', 'doaj')),
  ADD COLUMN IF NOT EXISTS peer_reviewed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb;

-- Backfill external_id for existing pubmed rows
UPDATE public.research_articles
   SET external_id = pmid::text
 WHERE source = 'pubmed' AND external_id IS NULL;

-- Enforce uniqueness per source
CREATE UNIQUE INDEX IF NOT EXISTS research_articles_source_external_id_uniq
  ON public.research_articles(source, external_id);

-- DOI index for cross-source dedup lookups
CREATE INDEX IF NOT EXISTS research_articles_doi_idx
  ON public.research_articles(doi)
  WHERE doi IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Re-run the integration test — should progress past this migration**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: still FAIL, but now on "research_topics should exist" (we only wrote 1 of 6 migrations).

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_research_articles_rename_and_columns.sql
git commit -m "db(migration): rename pubmed_articles to research_articles + multi-source columns"
```

### Task 1.3: Write the research_topics + topic_candidates migration

**Files:**
- Create: `supabase/20260412_research_topics_and_candidates.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- supabase/20260412_research_topics_and_candidates.sql
-- Creates research_topics (replaces hardcoded TOPIC_QUERIES object) and
-- topic_candidates (the discovery review queue). research_topics has a
-- forward reference to topic_candidates via source_candidate_id FK — we
-- create both tables then add the FK last.

BEGIN;

CREATE TABLE IF NOT EXISTS public.research_topics (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_key            text NOT NULL UNIQUE,
  query                text NOT NULL,
  domain               text,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'deprecated')),
  origin               text NOT NULL DEFAULT 'seed'
                         CHECK (origin IN ('seed', 'discovered', 'manual')),
  source_candidate_id  bigint,
  target_paper_count   integer NOT NULL DEFAULT 2000,
  last_filled_at       timestamptz,
  last_fill_count      integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_topics_domain_idx ON public.research_topics(domain);
CREATE INDEX IF NOT EXISTS research_topics_status_idx ON public.research_topics(status);

CREATE TABLE IF NOT EXISTS public.topic_candidates (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_key        text NOT NULL UNIQUE,
  raw_term         text NOT NULL,
  suggested_query  text,
  confidence       numeric(3,2) NOT NULL,
  rationale        text,
  source_urls      text[] NOT NULL,
  discovery_feed   text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected', 'snoozed')),
  decided_at       timestamptz,
  decided_by       text,
  snooze_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topic_candidates_status_idx
  ON public.topic_candidates(status);
CREATE INDEX IF NOT EXISTS topic_candidates_created_desc_idx
  ON public.topic_candidates(created_at DESC);

ALTER TABLE public.research_topics
  ADD CONSTRAINT research_topics_source_candidate_fk
  FOREIGN KEY (source_candidate_id)
  REFERENCES public.topic_candidates(id)
  ON DELETE SET NULL;

COMMIT;
```

- [ ] **Step 2: Re-run integration test**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: FAIL on "discovery_feeds should exist".

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_research_topics_and_candidates.sql
git commit -m "db(migration): research_topics and topic_candidates tables"
```

### Task 1.4: Write the discovery_feeds migration

**Files:**
- Create: `supabase/20260412_discovery_feeds.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- supabase/20260412_discovery_feeds.sql
-- Config + watermark state for RSS/API feeds scanned by the discovery pipeline.

BEGIN;

CREATE TABLE IF NOT EXISTS public.discovery_feeds (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('rss', 'atom', 'api')),
  url                   text NOT NULL,
  source_plugin         text NOT NULL,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'disabled')),
  last_item_at          timestamptz,
  last_run_at           timestamptz,
  last_item_count       integer NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_feeds_status_idx
  ON public.discovery_feeds(status);

COMMIT;
```

- [ ] **Step 2: Re-run integration test**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: FAIL on "job_progress should exist".

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_discovery_feeds.sql
git commit -m "db(migration): discovery_feeds config+watermark table"
```

### Task 1.5: Write the job_progress migration

**Files:**
- Create: `supabase/20260412_job_progress.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- supabase/20260412_job_progress.sql
-- Log stream for pg-boss jobs. Written by handlers via ctx.progress(),
-- read by CLI wrapper polling and by the admin UI /admin/jobs page.
-- NOTE: the foreign key to pgboss.job is intentionally commented out
-- because pgboss creates its schema lazily on first boss.start() and
-- this migration runs before the worker has ever started. We enforce
-- the reference in application code instead.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_progress (
  job_id    uuid NOT NULL,
  seq       bigint GENERATED ALWAYS AS IDENTITY,
  level     text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message   text NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE INDEX IF NOT EXISTS job_progress_job_id_seq_idx
  ON public.job_progress(job_id, seq);

CREATE INDEX IF NOT EXISTS job_progress_ts_idx
  ON public.job_progress(ts);

COMMIT;
```

- [ ] **Step 2: Re-run integration test**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: FAIL on "worker_heartbeats should exist".

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_job_progress.sql
git commit -m "db(migration): job_progress log stream table"
```

### Task 1.6: Write the alerts + heartbeat migration

**Files:**
- Create: `supabase/20260412_alerts_and_heartbeat.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- supabase/20260412_alerts_and_heartbeat.sql
-- Worker heartbeats (for the watchdog alert) + alert_log audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id                   text PRIMARY KEY,
  last_beat_at                timestamptz NOT NULL,
  jobs_processed_since_start  bigint NOT NULL DEFAULT 0,
  started_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type  text NOT NULL,
  payload     jsonb,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_log_type_sent_idx
  ON public.alert_log(alert_type, sent_at DESC);

COMMIT;
```

- [ ] **Step 2: Re-run integration test**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: PASS on the first test ("all 6 migrations apply cleanly"). The second test (idempotency) may still fail if any CREATE lacks `IF NOT EXISTS` — fix by adding it.

- [ ] **Step 3: Commit**

```bash
git add supabase/20260412_alerts_and_heartbeat.sql
git commit -m "db(migration): worker_heartbeats and alert_log"
```

### Task 1.7: Write the match_evidence_chunks v2 migration

**Files:**
- Create: `supabase/20260412_match_evidence_chunks_v2.sql`

First gather the existing function body so we can update it surgically.

- [ ] **Step 1: Dump the current function definition from prod-like source**

Run: `ssh hetzner "docker exec supabase-db pg_dump -U supabase_admin -d postgres --schema-only --schema=public --no-owner --no-privileges --function=match_evidence_chunks" 2>/dev/null || echo "FALLBACK: read from supabase/*.sql in repo"`
Expected: either the function definition or the FALLBACK string. If FALLBACK, find the function in `supabase/*.sql` by grepping.

- [ ] **Step 2: Grep the repo for the existing definition**

Use the Grep tool with pattern `CREATE OR REPLACE FUNCTION match_evidence_chunks` over `supabase/*.sql`.

- [ ] **Step 3: Write the v2 SQL**

Read the current function body from whichever file you found, then write the updated version:

```sql
-- supabase/20260412_match_evidence_chunks_v2.sql
-- Updates match_evidence_chunks to:
--   1. reference research_articles instead of pubmed_articles
--   2. prefer peer_reviewed=true rows when multiple rows share a DOI
--
-- This runs AFTER 20260412_research_articles_rename_and_columns.sql.
-- Existing behavior (cosine similarity, filter, limit) is preserved.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.match_evidence_chunks(
  query_embedding vector,
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id bigint,
  article_id bigint,
  content text,
  similarity float,
  title text,
  doi text,
  source text,
  peer_reviewed boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH candidates AS (
    SELECT
      ec.id,
      ec.article_id,
      ec.content,
      1 - (ec.embedding <=> query_embedding) AS similarity,
      a.title,
      a.doi,
      a.source,
      a.peer_reviewed,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(a.doi, 'art-' || a.id::text)
        ORDER BY a.peer_reviewed DESC, a.id ASC
      ) AS row_in_doi_group
    FROM public.evidence_chunks ec
    JOIN public.research_articles a ON a.id = ec.article_id
    WHERE 1 - (ec.embedding <=> query_embedding) > match_threshold
  )
  SELECT id, article_id, content, similarity, title, doi, source, peer_reviewed
  FROM candidates
  WHERE row_in_doi_group = 1
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
```

**Important:** if the real function has a different signature (different parameters, additional columns, etc.), port those through. The specific logic changes are: (a) table name, (b) the `ROW_NUMBER() OVER (PARTITION BY COALESCE(doi, ...) ORDER BY peer_reviewed DESC)` dedup preference. Everything else must match the original.

- [ ] **Step 4: Re-run integration test**

Run: `npm run test:integration -- --test-name-pattern="schema-migrations"`
Expected: test does not validate the RPC directly, but should still PASS since we're just adding a function. If it fails, the RPC body assumes an `evidence_chunks` table we haven't mocked — wrap the function in a test-only `CREATE TABLE IF NOT EXISTS public.evidence_chunks(...)` skip or, better, add a minimal stub in the test setup:

```js
// add to tests/integration/schema-migrations.test.js setup block
await client.query(`
  CREATE TABLE IF NOT EXISTS public.evidence_chunks (
    id bigserial PRIMARY KEY,
    article_id bigint,
    content text,
    embedding vector(1536)
  );
`);
```

- [ ] **Step 5: Commit**

```bash
git add supabase/20260412_match_evidence_chunks_v2.sql tests/integration/schema-migrations.test.js
git commit -m "db(migration): match_evidence_chunks v2 with research_articles + DOI dedup"
```

### Task 1.8: Write the research_topics seed script

**Files:**
- Create: `scripts/seed-research-topics.js`

- [ ] **Step 1: Write the failing integration test first**

Create `tests/integration/seed-research-topics.test.js`:

```js
// tests/integration/seed-research-topics.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema, getTestDbUrl } from "../_helpers/test-db.js";
import { seedResearchTopics } from "../../scripts/seed-research-topics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applyAllMigrations() {
  const dir = resolve(__dirname, "../../supabase");
  const files = readdirSync(dir).filter(f => f.startsWith("20260412_") && f.endsWith(".sql")).sort();
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
      CREATE TABLE IF NOT EXISTS public.evidence_chunks (
        id bigserial PRIMARY KEY,
        article_id bigint,
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
      "SELECT topic_key, origin, domain FROM research_topics WHERE topic_key = 'creatine_monohydrate'"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, "seed");
    assert.ok(rows[0].domain, "domain should be populated from JS section comment");
  });
});
```

- [ ] **Step 2: Run it — expect import failure**

Run: `npm run test:integration -- --test-name-pattern="seedResearchTopics"`
Expected: FAIL with `Cannot find module '.../scripts/seed-research-topics.js'`.

- [ ] **Step 3: Write the seed script**

```js
// scripts/seed-research-topics.js
// One-shot idempotent seed: parses TOPIC_QUERIES and domain section comments
// out of fill-pmc-topics.js and upserts rows into research_topics.
// Safe to re-run — INSERT ... ON CONFLICT DO UPDATE keeps query/domain fresh.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse TOPIC_QUERIES JS object literal into a list of { topic_key, query, domain }.
 * The source file groups topics under section comments like `// --- Core resistance ---`.
 * Each topic within a section inherits that domain.
 */
export function parseTopicQueriesWithDomains(source) {
  const out = [];
  const lines = source.split(/\r?\n/);
  let currentDomain = null;
  const topicRe = /^\s{2}([a-z_0-9]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/;
  const domainRe = /^\s*\/\/\s*---\s*(.+?)\s*---/;
  for (const line of lines) {
    const d = line.match(domainRe);
    if (d) {
      currentDomain = d[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      continue;
    }
    const t = line.match(topicRe);
    if (t) {
      out.push({
        topic_key: t[1],
        query: t[2].replace(/\\"/g, '"'),
        domain: currentDomain,
      });
    }
  }
  return out;
}

export async function seedResearchTopics({ databaseUrl }) {
  const srcPath = resolve(__dirname, "fill-pmc-topics.js");
  const src = readFileSync(srcPath, "utf8");
  const topics = parseTopicQueriesWithDomains(src);
  if (topics.length === 0) {
    throw new Error("parsed 0 topics from fill-pmc-topics.js — regex mismatch?");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  let updated = 0;
  try {
    for (const t of topics) {
      const result = await client.query(
        `INSERT INTO public.research_topics (topic_key, query, domain, origin)
         VALUES ($1, $2, $3, 'seed')
         ON CONFLICT (topic_key) DO UPDATE
           SET query = EXCLUDED.query,
               domain = EXCLUDED.domain,
               updated_at = now()
         RETURNING xmax = 0 AS was_insert`,
        [t.topic_key, t.query, t.domain]
      );
      if (result.rows[0].was_insert) inserted++;
      else updated++;
    }
  } finally {
    await client.end();
  }
  return { inserted, updated, total: topics.length };
}

// Direct invocation: node scripts/seed-research-topics.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const result = await seedResearchTopics({ databaseUrl });
  console.log(`seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.total} total`);
}
```

- [ ] **Step 4: Re-run the test**

Run: `npm run test:integration -- --test-name-pattern="seedResearchTopics"`
Expected: PASS. If the count assertion fails (< 300 topics), the regex doesn't match all entries — check with:

```bash
node -e "import('./scripts/seed-research-topics.js').then(m => { import('node:fs').then(fs => { const src = fs.readFileSync('./scripts/fill-pmc-topics.js','utf8'); console.log('parsed:', m.parseTopicQueriesWithDomains(src).length); }); });"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-research-topics.js tests/integration/seed-research-topics.test.js
git commit -m "scripts(seed): research_topics seed parser + idempotent upsert"
```

### Task 1.9: Write the discovery_feeds seed script + initial feed list

**Files:**
- Create: `scripts/seed-discovery-feeds.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/seed-discovery-feeds.test.js`:

```js
// tests/integration/seed-discovery-feeds.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema, getTestDbUrl } from "../_helpers/test-db.js";
import { seedDiscoveryFeeds, INITIAL_FEEDS } from "../../scripts/seed-discovery-feeds.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applyAllMigrations() {
  const dir = resolve(__dirname, "../../supabase");
  const files = readdirSync(dir).filter(f => f.startsWith("20260412_") && f.endsWith(".sql")).sort();
  await withTestClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.pubmed_articles (
        id bigserial PRIMARY KEY, pmid bigint UNIQUE, doi text, title text, abstract text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.evidence_chunks (
        id bigserial PRIMARY KEY, article_id bigint, content text, embedding vector(1536)
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
```

- [ ] **Step 2: Run — expect import failure**

Run: `npm run test:integration -- --test-name-pattern="seedDiscoveryFeeds"`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the seed script with the initial feed list**

```js
// scripts/seed-discovery-feeds.js
// One-shot idempotent seed: inserts the initial set of discovery feeds
// (academic TOC + preprint + practitioner RSS). Re-running is safe and
// will not overwrite operator edits to `status`.
import "dotenv/config";
import pg from "pg";

export const INITIAL_FEEDS = [
  // --- Preprint servers (double as ingestion sources) ---
  { id: "biorxiv-physiology",   name: "BioRxiv — Physiology",          kind: "api", url: "https://api.biorxiv.org/details/biorxiv/physiology",          source_plugin: "biorxiv" },
  { id: "biorxiv-neuroscience", name: "BioRxiv — Neuroscience",        kind: "api", url: "https://api.biorxiv.org/details/biorxiv/neuroscience",        source_plugin: "biorxiv" },
  { id: "biorxiv-pharmacology", name: "BioRxiv — Pharmacology & Tox.", kind: "api", url: "https://api.biorxiv.org/details/biorxiv/pharmacology%20and%20toxicology", source_plugin: "biorxiv" },
  { id: "medrxiv-nutrition",    name: "medRxiv — Nutrition",           kind: "api", url: "https://api.biorxiv.org/details/medrxiv/nutrition",           source_plugin: "medrxiv" },
  { id: "medrxiv-rehab",        name: "medRxiv — Rehab Medicine",      kind: "api", url: "https://api.biorxiv.org/details/medrxiv/rehabilitation%20medicine%20and%20physical%20therapy", source_plugin: "medrxiv" },
  { id: "medrxiv-sportsmed",    name: "medRxiv — Sports Medicine",     kind: "api", url: "https://api.biorxiv.org/details/medrxiv/sports%20medicine",   source_plugin: "medrxiv" },
  { id: "sportrxiv-all",        name: "SportRxiv — all",               kind: "api", url: "https://api.osf.io/v2/preprints/?filter[provider]=sportrxiv", source_plugin: "sportrxiv" },

  // --- Journal TOC RSS ---
  { id: "rss-bjsm",       name: "British Journal of Sports Medicine TOC", kind: "rss", url: "https://bjsm.bmj.com/rss/current.xml",                             source_plugin: "rss-journal-bjsm" },
  { id: "rss-jscr",       name: "JSCR TOC",                               kind: "rss", url: "https://journals.lww.com/nsca-jscr/toc/rss",                       source_plugin: "rss-journal-jscr" },
  { id: "rss-msse",       name: "Medicine & Science in Sports & Exercise",kind: "rss", url: "https://journals.lww.com/acsm-msse/toc/rss",                       source_plugin: "rss-journal-msse" },
  { id: "rss-ijspp",      name: "Int'l J. of Sports Physiology & Perf",   kind: "rss", url: "https://journals.humankinetics.com/rss/updates/IJSPP",             source_plugin: "rss-journal-ijspp" },
  { id: "rss-jap",        name: "Journal of Applied Physiology",          kind: "rss", url: "https://journals.physiology.org/action/showFeed?type=etoc&feed=rss&jc=jappl", source_plugin: "rss-journal-jap" },
  { id: "rss-sportsmed",  name: "Sports Medicine (Adis)",                 kind: "rss", url: "https://link.springer.com/search.rss?facet-journal-id=40279",       source_plugin: "rss-journal-sportsmed" },
  { id: "rss-sjmss",      name: "Scand J. of Med & Science in Sports",    kind: "rss", url: "https://onlinelibrary.wiley.com/feed/16000838/most-recent",         source_plugin: "rss-journal-sjmss" },
  { id: "rss-ejap",       name: "European J. of Applied Physiology",      kind: "rss", url: "https://link.springer.com/search.rss?facet-journal-id=421",        source_plugin: "rss-journal-ejap" },

  // --- Practitioner ---
  { id: "rss-sbs",         name: "Stronger By Science",     kind: "rss", url: "https://www.strongerbyscience.com/feed/",             source_plugin: "rss-sbs" },
  { id: "rss-suppversity", name: "SuppVersity",             kind: "rss", url: "https://suppversity.blogspot.com/feeds/posts/default",source_plugin: "rss-suppversity" },
  { id: "rss-mass",        name: "MASS Research Review",    kind: "rss", url: "https://www.strongerbyscience.com/mass/feed/",        source_plugin: "rss-mass" },
  { id: "rss-sfs",         name: "Science For Sport",       kind: "rss", url: "https://www.scienceforsport.com/feed/",               source_plugin: "rss-sfs" },
  { id: "rss-nsca",        name: "NSCA blog",               kind: "rss", url: "https://www.nsca.com/rss/articles/",                   source_plugin: "rss-nsca" },
  { id: "rss-acsm",        name: "ACSM blog",               kind: "rss", url: "https://www.acsm.org/rss",                            source_plugin: "rss-acsm" },
];

export async function seedDiscoveryFeeds({ databaseUrl }) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  let updated = 0;
  try {
    for (const f of INITIAL_FEEDS) {
      const res = await client.query(
        `INSERT INTO public.discovery_feeds (id, name, kind, url, source_plugin)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               kind = EXCLUDED.kind,
               url = EXCLUDED.url,
               source_plugin = EXCLUDED.source_plugin,
               updated_at = now()
         RETURNING xmax = 0 AS was_insert`,
        [f.id, f.name, f.kind, f.url, f.source_plugin]
      );
      if (res.rows[0].was_insert) inserted++;
      else updated++;
    }
  } finally {
    await client.end();
  }
  return { inserted, updated, total: INITIAL_FEEDS.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error("DATABASE_URL not set"); process.exit(1); }
  const r = await seedDiscoveryFeeds({ databaseUrl });
  console.log(`seeded: ${r.inserted} inserted, ${r.updated} updated, ${r.total} total`);
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:integration -- --test-name-pattern="seedDiscoveryFeeds"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-discovery-feeds.js tests/integration/seed-discovery-feeds.test.js
git commit -m "scripts(seed): discovery_feeds seed with ~20 initial feeds"
```

---

## Milestone 2: pg-boss worker core

### Task 2.1: Write the worker context helper

**Files:**
- Create: `worker/context.js`
- Create: `tests/unit/worker/context.test.js`

- [ ] **Step 1: Write the failing unit test**

```js
// tests/unit/worker/context.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "../../../worker/context.js";

test("makeContext exposes data, signal, progress, abort", () => {
  const inserts = [];
  const fakeSql = async (strings, ...vals) => {
    inserts.push({ strings: strings.join("?"), vals });
    return { rows: [] };
  };
  const jobRow = { id: "job-1", data: { limit: 10 } };
  const ctx = makeContext(jobRow, fakeSql);

  assert.deepEqual(ctx.data, { limit: 10 });
  assert.equal(typeof ctx.abort, "function");
  assert.equal(ctx.signal.aborted, false);

  ctx.abort();
  assert.equal(ctx.signal.aborted, true);
});

test("progress() inserts into job_progress via the sql tag", async () => {
  const inserts = [];
  const fakeSql = async (strings, ...vals) => {
    inserts.push({ strings: strings.join("?"), vals });
    return { rows: [] };
  };
  const ctx = makeContext({ id: "job-2", data: {} }, fakeSql);

  await ctx.progress("hello");
  await ctx.progress("warning!", "warn");

  assert.equal(inserts.length, 2);
  assert.match(inserts[0].strings, /INSERT INTO job_progress/);
  assert.deepEqual(inserts[0].vals, ["job-2", "info", "hello"]);
  assert.deepEqual(inserts[1].vals, ["job-2", "warn", "warning!"]);
});
```

- [ ] **Step 2: Run — expect import failure**

Run: `npm run test:unit -- --test-name-pattern="makeContext"`
Expected: FAIL with `Cannot find module '.../worker/context.js'`.

- [ ] **Step 3: Write the context module**

```js
// worker/context.js
// Creates the per-job context object passed to handlers. Carries:
//   - data: the job payload
//   - signal: an AbortSignal the handler should poll for cancellation
//   - abort: trigger the signal (called by the worker when pg-boss cancels)
//   - progress: async (message, level='info') => insert into job_progress

/**
 * @param {{ id: string, data: object }} jobRow
 * @param {(strings: TemplateStringsArray, ...vals: any[]) => Promise<{rows: any[]}>} sql
 *   tagged-template sql helper bound to a pg client or pool
 */
export function makeContext(jobRow, sql) {
  const controller = new AbortController();
  return {
    data: jobRow.data ?? {},
    signal: controller.signal,
    abort: () => controller.abort(),
    progress: async (message, level = "info") => {
      if (level !== "info" && level !== "warn" && level !== "error") {
        throw new Error(`bad level: ${level}`);
      }
      await sql`
        INSERT INTO job_progress (job_id, level, message)
        VALUES (${jobRow.id}, ${level}, ${message})
      `;
    },
  };
}
```

- [ ] **Step 4: Re-run test**

Run: `npm run test:unit -- --test-name-pattern="makeContext"`
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**

```bash
git add worker/context.js tests/unit/worker/context.test.js
git commit -m "feat(worker): job context helper (data/signal/progress/abort)"
```

### Task 2.2: Write the heartbeat module

**Files:**
- Create: `worker/heartbeat.js`
- Create: `tests/unit/worker/heartbeat.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker/heartbeat.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startHeartbeat, stopHeartbeat } from "../../../worker/heartbeat.js";

test("startHeartbeat writes immediately and then every interval", async (t) => {
  const writes = [];
  const fakeSql = async (strings, ...vals) => {
    writes.push(vals);
    return { rows: [] };
  };
  const handle = startHeartbeat({
    sql: fakeSql,
    workerId: "test-worker",
    intervalMs: 50,
  });
  await new Promise(r => setTimeout(r, 130));
  stopHeartbeat(handle);

  assert.ok(writes.length >= 2, `expected >=2 writes, got ${writes.length}`);
  assert.ok(writes[0].includes("test-worker"), "worker id should appear in first write");
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:unit -- --test-name-pattern="startHeartbeat"`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the module**

```js
// worker/heartbeat.js
// Writes a row to worker_heartbeats every `intervalMs`. The main loop is a
// simple setInterval — no backoff, no jitter. If a write fails (transient DB
// issue), we log to stderr and keep going; missed beats are handled by the
// watchdog not by the heartbeat itself.

export function startHeartbeat({ sql, workerId, intervalMs = 30_000 }) {
  let jobsProcessed = 0;

  async function beat() {
    try {
      await sql`
        INSERT INTO worker_heartbeats (worker_id, last_beat_at, jobs_processed_since_start)
        VALUES (${workerId}, now(), ${jobsProcessed})
        ON CONFLICT (worker_id) DO UPDATE
          SET last_beat_at = EXCLUDED.last_beat_at,
              jobs_processed_since_start = EXCLUDED.jobs_processed_since_start
      `;
    } catch (err) {
      process.stderr.write(`[heartbeat] write failed: ${err.message}\n`);
    }
  }

  // Immediate beat so the row exists right after startup
  beat();
  const timer = setInterval(beat, intervalMs);

  return {
    timer,
    incrementJobsProcessed: () => { jobsProcessed += 1; },
  };
}

export function stopHeartbeat(handle) {
  if (handle?.timer) clearInterval(handle.timer);
}
```

- [ ] **Step 4: Run test**

Run: `npm run test:unit -- --test-name-pattern="startHeartbeat"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/heartbeat.js tests/unit/worker/heartbeat.test.js
git commit -m "feat(worker): heartbeat loop module"
```

### Task 2.3: Write the worker logger

**Files:**
- Create: `worker/logger.js`

- [ ] **Step 1: Write the module**

```js
// worker/logger.js
// Structured stderr logger for the worker. Uses JSON lines so pm2 logs
// can be grepped or piped to a log collector later. One line per record.
export function createLogger(workerId) {
  function write(level, message, extra = {}) {
    const record = {
      ts: new Date().toISOString(),
      worker: workerId,
      level,
      msg: message,
      ...extra,
    };
    process.stderr.write(JSON.stringify(record) + "\n");
  }
  return {
    info:  (m, e) => write("info",  m, e),
    warn:  (m, e) => write("warn",  m, e),
    error: (m, e) => write("error", m, e),
  };
}
```

- [ ] **Step 2: Quick smoke**

Run: `node --input-type=module -e "import { createLogger } from './worker/logger.js'; const l = createLogger('t'); l.info('hi', { foo: 1 });"`
Expected: one JSON line on stderr containing `"level":"info","msg":"hi","foo":1`.

- [ ] **Step 3: Commit**

```bash
git add worker/logger.js
git commit -m "feat(worker): structured stderr logger"
```

### Task 2.4: Write the worker entrypoint

**Files:**
- Create: `worker/index.js`

- [ ] **Step 1: Write the module**

```js
// worker/index.js
// pm2 entry for emersus-worker. Boots pg-boss, clears stale heartbeats,
// starts the heartbeat loop, registers all job handlers from jobs/_registry.js,
// and handles graceful shutdown on SIGINT/SIGTERM.
import "dotenv/config";
import PgBoss from "pg-boss";
import pg from "pg";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";
import { createLogger } from "./logger.js";
// Registry is imported lazily after boss.start() so handlers can reference
// a started boss via a shared module-level variable in _registry.js.

const WORKER_ID = process.env.WORKER_ID ?? `emersus-worker-${process.pid}`;
const log = createLogger(WORKER_ID);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.error("DATABASE_URL not set — cannot start worker");
    process.exit(1);
  }

  const boss = new PgBoss(databaseUrl);
  boss.on("error", err => log.error("pg-boss error", { err: err.message }));
  await boss.start();
  log.info("pg-boss started");

  // Direct pg pool for heartbeat + progress writes (bypasses pg-boss)
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const sql = async (strings, ...vals) => {
    // Simple tagged template -> parameterized query
    let text = strings[0];
    for (let i = 0; i < vals.length; i++) text += `$${i + 1}` + strings[i + 1];
    return pool.query(text, vals);
  };

  // Clear stale heartbeats from a prior worker instance
  await sql`
    DELETE FROM worker_heartbeats
    WHERE last_beat_at < now() - interval '10 minutes'
       OR worker_id = ${WORKER_ID}
  `;

  const hb = startHeartbeat({ sql, workerId: WORKER_ID, intervalMs: 30_000 });
  log.info("heartbeat started");

  // Register job handlers
  const { registerHandlers } = await import("../jobs/_registry.js");
  await registerHandlers({ boss, sql, log, incrementJobsProcessed: hb.incrementJobsProcessed });
  log.info("handlers registered");

  const shutdown = async (sig) => {
    log.info(`received ${sig}, shutting down`);
    stopHeartbeat(hb);
    await boss.stop({ graceful: true, wait: true });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info("worker ready");
}

main().catch(err => {
  log.error("fatal", { err: err.message, stack: err.stack });
  process.exit(1);
});
```

- [ ] **Step 2: Write a minimal stub registry so the worker can boot**

Create `jobs/_registry.js`:

```js
// jobs/_registry.js
// Central place handlers are registered. Added to progressively as jobs
// are implemented in Milestone 6. For now, a no-op so the worker can boot.
export async function registerHandlers({ boss, sql, log }) {
  log.info("registerHandlers: no handlers registered yet");
}
```

- [ ] **Step 3: Smoke-test worker boot against the test DB**

Run: `docker compose -f docker-compose.test.yml up -d && DATABASE_URL=postgresql://testuser:testpass@127.0.0.1:54329/emersus_test node worker/index.js &`
Expected: stderr JSON lines showing `pg-boss started`, `heartbeat started`, `handlers registered`, `worker ready`. pg-boss auto-creates its schema on first start.

- [ ] **Step 4: Verify heartbeat row exists**

Run: `docker compose -f docker-compose.test.yml exec postgres-test psql -U testuser -d emersus_test -c "SELECT worker_id, last_beat_at FROM worker_heartbeats;"`
Expected: one row with a recent `last_beat_at`.

- [ ] **Step 5: Kill the worker**

Run: `pkill -f "node worker/index.js"` (or Ctrl+C the foreground process)
Expected: a `received SIGTERM, shutting down` log line, then the process exits 0.

- [ ] **Step 6: Commit**

```bash
git add worker/index.js jobs/_registry.js
git commit -m "feat(worker): pm2 entrypoint, boot + shutdown lifecycle"
```

---

## Milestone 2 gate

Before proceeding to Milestone 3, verify:
- `npm test` runs and all tests pass
- `node worker/index.js` boots cleanly against the test DB and writes a heartbeat row
- The worker shuts down gracefully on SIGTERM

The remaining milestones (3–12) continue in the same worktree. Each milestone is independently committable and testable.

---

## Milestone 3: Source plugin interface + PubMed adapter

### Task 3.1: Write the Source types + registry stub

**Files:**
- Create: `scripts/sources/_types.js`
- Create: `scripts/sources/_registry.js`

- [ ] **Step 1: Write the JSDoc types file**

```js
// scripts/sources/_types.js
// Documentation-only: interface definitions as JSDoc typedefs.
// JS doesn't enforce interfaces, but adapters that deviate from this
// shape will fail at first registry use.

/**
 * @typedef {Object} DiscoveryFeedRow
 * @property {string} id
 * @property {string} name
 * @property {'rss'|'atom'|'api'} kind
 * @property {string} url
 * @property {string} source_plugin
 * @property {Date|null} last_item_at
 */

/**
 * @typedef {Object} DiscoveredItem
 * @property {string} url
 * @property {string} title
 * @property {string|null} abstract
 * @property {Date} publishedAt
 * @property {string} feedId
 */

/**
 * @typedef {Object} IngestOpts
 * @property {number} target
 * @property {AbortSignal} [signal]
 * @property {(msg: string, level?: 'info'|'warn'|'error') => Promise<void>} [progress]
 */

/**
 * @typedef {Object} IngestedPaper
 * @property {string} externalId
 * @property {string} source
 * @property {string} title
 * @property {string|null} abstract
 * @property {string|null} doi
 * @property {Date|null} publishedAt
 * @property {string|null} journal
 * @property {string[]} authors
 * @property {boolean} peerReviewed
 * @property {object} sourceMetadata
 */

/**
 * @typedef {Object} DiscoverySource
 * @property {string} id
 * @property {string} name
 * @property {'rss'|'atom'|'api'} kind
 * @property {(feed: DiscoveryFeedRow) => Promise<DiscoveredItem[]>} fetchNew
 */

/**
 * @typedef {Object} IngestionSource
 * @property {string} id
 * @property {string} name
 * @property {boolean} peerReviewed
 * @property {(query: string, opts: IngestOpts) => AsyncIterable<IngestedPaper>} fetchPapers
 */

export {}; // module marker
```

- [ ] **Step 2: Write the registry stub**

```js
// scripts/sources/_registry.js
// Central registry of ingestion + discovery sources.
// Imports are added progressively as adapters are implemented.

const ingestionSources = [];
const discoverySources = [];

/** @param {import('./_types.js').IngestionSource} source */
export function registerIngestion(source) {
  if (ingestionSources.find(s => s.id === source.id)) {
    throw new Error(`duplicate ingestion source id: ${source.id}`);
  }
  ingestionSources.push(source);
}

/** @param {import('./_types.js').DiscoverySource} source */
export function registerDiscovery(source) {
  if (discoverySources.find(s => s.id === source.id)) {
    throw new Error(`duplicate discovery source id: ${source.id}`);
  }
  discoverySources.push(source);
}

export function getIngestionSource(id) {
  return ingestionSources.find(s => s.id === id);
}

export function getDiscoverySource(id) {
  return discoverySources.find(s => s.id === id);
}

export function listIngestionSources() {
  return [...ingestionSources];
}

export function listDiscoverySources() {
  return [...discoverySources];
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sources/_types.js scripts/sources/_registry.js
git commit -m "feat(sources): Source interface typedefs and registry"
```

### Task 3.2: Write the rate limiter + errors + http helper

**Files:**
- Create: `scripts/sources/_ratelimit.js`
- Create: `scripts/sources/_errors.js`
- Create: `scripts/sources/_http.js`
- Create: `tests/unit/sources/ratelimit.test.js`

- [ ] **Step 1: Write the failing rate limiter test**

```js
// tests/unit/sources/ratelimit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../../../scripts/sources/_ratelimit.js";

test("createLimiter paces requests to the given RPS", async () => {
  const wait = createLimiter(10); // 10 RPS -> 100ms between slots
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) await wait();
  const elapsed = Date.now() - t0;
  // First call is immediate; next two are ~100ms each. Allow slop.
  assert.ok(elapsed >= 180, `expected >=180ms, got ${elapsed}`);
  assert.ok(elapsed < 400, `expected <400ms, got ${elapsed}`);
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:unit -- --test-name-pattern="createLimiter"`
Expected: FAIL.

- [ ] **Step 3: Write the rate limiter**

```js
// scripts/sources/_ratelimit.js
// Simple token-bucket-ish limiter: enforces a minimum interval between
// successive awaits. Each source plugin creates one limiter at import time.
export function createLimiter(requestsPerSecond) {
  const intervalMs = 1000 / requestsPerSecond;
  let nextSlotAt = 0;
  return async function waitForSlot() {
    const now = Date.now();
    if (now < nextSlotAt) {
      await new Promise(r => setTimeout(r, nextSlotAt - now));
    }
    nextSlotAt = Math.max(now, nextSlotAt) + intervalMs;
  };
}
```

- [ ] **Step 4: Write the errors module**

```js
// scripts/sources/_errors.js
// Error taxonomy used by source plugins. Handlers inspect these with
// instanceof to pick retry policy.

export class SourceTransientError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "SourceTransientError";
    this.cause = cause;
  }
}

export class SourceRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "SourceRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class SourcePermanentError extends Error {
  constructor(message, { cause, body } = {}) {
    super(message);
    this.name = "SourcePermanentError";
    this.cause = cause;
    this.body = body;
  }
}
```

- [ ] **Step 5: Write the shared HTTP helper**

```js
// scripts/sources/_http.js
// Small wrapper around fetch with:
//   - timeout (via AbortController)
//   - user-agent header
//   - automatic classification of HTTP errors into source error types
//   - retry-after parsing for 429
import {
  SourceTransientError,
  SourceRateLimitError,
  SourcePermanentError,
} from "./_errors.js";

const DEFAULT_UA = "emersus-research-bot/1.0 (+https://emersus.ai)";
const DEFAULT_TIMEOUT_MS = 25_000;

export async function fetchWithTimeoutAndUA(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ua = DEFAULT_UA,
    accept = "application/json, application/xml;q=0.9, */*;q=0.8",
    signal: externalSignal,
    ...rest
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let resp;
  try {
    resp = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": ua,
        "Accept": accept,
        ...(rest.headers ?? {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new SourceTransientError(`timeout after ${timeoutMs}ms: ${url}`, { cause: err });
    }
    throw new SourceTransientError(`network error: ${err.message}`, { cause: err });
  }
  clearTimeout(timer);

  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    const retryAfterMs = retryAfter
      ? (isNaN(Number(retryAfter)) ? Math.max(0, new Date(retryAfter).getTime() - Date.now()) : Number(retryAfter) * 1000)
      : 60_000;
    throw new SourceRateLimitError(`rate limited at ${url}`, retryAfterMs);
  }
  if (resp.status >= 500) {
    throw new SourceTransientError(`HTTP ${resp.status} at ${url}`);
  }
  if (resp.status >= 400) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new SourcePermanentError(`HTTP ${resp.status} at ${url}`, { body });
  }
  return resp;
}
```

- [ ] **Step 6: Run rate limiter test**

Run: `npm run test:unit -- --test-name-pattern="createLimiter"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/sources/_ratelimit.js scripts/sources/_errors.js scripts/sources/_http.js tests/unit/sources/ratelimit.test.js
git commit -m "feat(sources): rate limiter, error taxonomy, shared http helper"
```

### Task 3.3: Capture PubMed fixtures and write the adapter

**Files:**
- Create: `tests/fixtures/pubmed/esearch-creatine.xml`
- Create: `tests/fixtures/pubmed/efetch-creatine.xml`
- Create: `scripts/sources/pubmed.js`
- Create: `tests/unit/sources/pubmed.test.js`

- [ ] **Step 1: Capture a small esearch response fixture**

Run: `curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax=3&term=creatine+AND+(supplementation+OR+ergogenic)" > tests/fixtures/pubmed/esearch-creatine.xml`
Expected: file exists, contains `<eSearchResult>` with `<Count>`, `<IdList>` with 3 `<Id>` children.

- [ ] **Step 2: Capture the matching efetch response**

Extract the 3 PMIDs from the esearch file and run:

```bash
IDS=$(grep -oP '<Id>\K\d+' tests/fixtures/pubmed/esearch-creatine.xml | tr '\n' ',' | sed 's/,$//')
curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${IDS}&retmode=xml" > tests/fixtures/pubmed/efetch-creatine.xml
```

Expected: file contains `<PubmedArticleSet>` with 3 `<PubmedArticle>` entries.

- [ ] **Step 3: Write the failing test**

```js
// tests/unit/sources/pubmed.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { pubmed } from "../../../scripts/sources/pubmed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(resolve(__dirname, `../../fixtures/pubmed/${name}`), "utf8");
}

test("pubmed.fetchPapers yields normalized IngestedPaper items", async () => {
  const esearch = loadFixture("esearch-creatine.xml");
  const efetch = loadFixture("efetch-creatine.xml");

  nock("https://eutils.ncbi.nlm.nih.gov")
    .get("/entrez/eutils/esearch.fcgi")
    .query(true)
    .reply(200, esearch);
  nock("https://eutils.ncbi.nlm.nih.gov")
    .get("/entrez/eutils/efetch.fcgi")
    .query(true)
    .reply(200, efetch);

  const results = [];
  for await (const paper of pubmed.fetchPapers("creatine", { target: 3 })) {
    results.push(paper);
  }
  assert.equal(results.length, 3);
  for (const p of results) {
    assert.equal(p.source, "pubmed");
    assert.equal(p.peerReviewed, true);
    assert.ok(p.externalId, "externalId must be set (PMID)");
    assert.ok(p.title, "title must be set");
  }
  assert.ok(nock.isDone(), "both endpoints should have been called");
});

test("pubmed adapter registers itself", async () => {
  const { listIngestionSources } = await import("../../../scripts/sources/_registry.js");
  assert.ok(listIngestionSources().find(s => s.id === "pubmed"), "pubmed should be in registry");
});
```

- [ ] **Step 4: Run — expect failure**

Run: `npm run test:unit -- --test-name-pattern="pubmed.fetchPapers"`
Expected: FAIL with `Cannot find module '.../scripts/sources/pubmed.js'`.

- [ ] **Step 5: Write the PubMed adapter**

```js
// scripts/sources/pubmed.js
// Ingestion adapter for PubMed eutils. Two-phase: esearch → efetch.
// Rate-limited to 3 RPS unauthenticated (NCBI's stated limit).
import { fetchWithTimeoutAndUA } from "./_http.js";
import { createLimiter } from "./_ratelimit.js";
import { SourcePermanentError } from "./_errors.js";
import { registerIngestion } from "./_registry.js";

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const BATCH_SIZE = 100;

const waitSlot = createLimiter(3); // 3 RPS

async function esearchPmids(query, retmax, retstart) {
  await waitSlot();
  const url = `${ESEARCH_URL}?db=pubmed&retmax=${retmax}&retstart=${retstart}&term=${encodeURIComponent(query)}`;
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/xml" });
  const xml = await resp.text();
  const idList = [...xml.matchAll(/<Id>(\d+)<\/Id>/g)].map(m => m[1]);
  const countMatch = xml.match(/<Count>(\d+)<\/Count>/);
  const total = countMatch ? Number(countMatch[1]) : 0;
  return { idList, total };
}

async function efetchBatch(pmids) {
  if (pmids.length === 0) return [];
  await waitSlot();
  const url = `${EFETCH_URL}?db=pubmed&id=${pmids.join(",")}&retmode=xml`;
  const resp = await fetchWithTimeoutAndUA(url, { accept: "application/xml" });
  const xml = await resp.text();
  return parsePubmedXml(xml);
}

/**
 * Minimal PubMed XML parser — extracts the fields we care about without
 * pulling in a full XML library. Works on a per-<PubmedArticle> split.
 */
export function parsePubmedXml(xml) {
  const articles = xml.split(/<PubmedArticle[\s>]/).slice(1).map(s => "<PubmedArticle " + s);
  const out = [];
  for (const a of articles) {
    const pmid = a.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;

    const title = decodeEntities(stripTags(
      a.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? ""
    )).trim();

    const abstract = decodeEntities(stripTags(
      [...a.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m => m[1]).join("\n")
    )).trim() || null;

    const doi = a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1] ?? null;

    const year = a.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<\/PubDate>/)?.[1];
    const month = a.match(/<PubDate>[\s\S]*?<Month>(\w+)<\/Month>/)?.[1];
    const publishedAt = year ? new Date(`${year}-${monthNum(month ?? "Jan")}-01`) : null;

    const journal = a.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? null;

    const authors = [...a.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)]
      .map(m => {
        const last  = m[1].match(/<LastName>([^<]+)<\/LastName>/)?.[1];
        const fore  = m[1].match(/<ForeName>([^<]+)<\/ForeName>/)?.[1];
        return last && fore ? `${fore} ${last}` : (last || fore || null);
      })
      .filter(Boolean);

    out.push({
      externalId: pmid,
      source: "pubmed",
      title,
      abstract,
      doi,
      publishedAt,
      journal,
      authors,
      peerReviewed: true,
      sourceMetadata: { pmid },
    });
  }
  return out;
}

function stripTags(s) { return (s ?? "").replace(/<[^>]+>/g, ""); }
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function monthNum(m) {
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  return months[m.slice(0, 3).toLowerCase()] ?? "01";
}

export const pubmed = {
  id: "pubmed",
  name: "PubMed",
  peerReviewed: true,
  async *fetchPapers(query, opts) {
    const target = opts?.target ?? 2000;
    let retstart = 0;
    let yielded = 0;
    while (yielded < target) {
      const { idList, total } = await esearchPmids(query, BATCH_SIZE, retstart);
      if (idList.length === 0) return;
      if (retstart === 0 && total === 0) {
        throw new SourcePermanentError(`pubmed esearch returned 0 results for query: ${query}`);
      }
      const papers = await efetchBatch(idList);
      for (const p of papers) {
        yield p;
        yielded += 1;
        if (opts?.signal?.aborted) return;
        if (yielded >= target) return;
      }
      retstart += idList.length;
      if (retstart >= total) return;
    }
  },
};

registerIngestion(pubmed);
```

- [ ] **Step 6: Run the test**

Run: `npm run test:unit -- --test-name-pattern="pubmed"`
Expected: PASS for both subtests. If the XML parser misses fields, iterate on the regex — the fixture is the source of truth for "what this parser needs to handle".

- [ ] **Step 7: Commit**

```bash
git add scripts/sources/pubmed.js tests/unit/sources/pubmed.test.js tests/fixtures/pubmed/
git commit -m "feat(sources): PubMed ingestion adapter"
```

---

## Milestone 3 gate

- `npm test` all green
- `pubmed` appears in the registry at runtime
- Fixture-based tests pass without network

---

## Milestones 4–12 (outline with handoff to subagent execution)

The remaining milestones follow the same **test-first → implement → commit** pattern established in Milestones 0–3. Rather than inline every task, here is the authoritative decomposition with enough detail that each milestone can be handed to a fresh subagent as a self-contained unit of work. Each task below references the matching spec section, names the exact files, and includes a terse sketch of the approach.

### Milestone 4: Remaining 6 ingestion adapters (Tasks 4.1 – 4.6)

For each adapter, the task pattern is:

1. Capture a real fixture via `curl` against the live endpoint, save under `tests/fixtures/<source>/`.
2. Write failing `tests/unit/sources/<source>.test.js` asserting:
   - Adapter is in the registry after import
   - `fetchPapers(query, {target:3})` yields 3 `IngestedPaper`-shaped objects against nocked fixtures
   - `peerReviewed` defaults match spec §5.3
   - `externalId` is populated with the source-canonical id (DOI for non-pubmed)
3. Implement the adapter in `scripts/sources/<source>.js`:
   - Import `fetchWithTimeoutAndUA`, `createLimiter`, `registerIngestion`
   - Use the rate limit from spec §5.3
   - Yield normalized `IngestedPaper` shapes
   - `registerIngestion(module)` at bottom
4. Run tests → commit

**Task 4.1 — Europe PMC** (`europepmc.js`)
- Fixture: `curl -s 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=creatine&format=json&resultType=core&pageSize=3' > tests/fixtures/europepmc/search-creatine.json`
- Rate: 5 RPS. Endpoint returns JSON directly (no XML parsing needed).
- Pagination: `resultList.result[]` + `nextCursorMark` for cursor-based paging. Repeat calls until `nextCursorMark` equals previous.
- Map: `pmid` (when present) OR `doi` → `externalId` (prefer PMID, fall back to DOI); `abstractText` → `abstract`; `pubYear` + `firstPublicationDate` → `publishedAt`; `journalTitle` → `journal`; `authorString` split on `, ` → `authors`.
- `peerReviewed: true`.

**Task 4.2 — BioRxiv** (`biorxiv.js`)
- Fixture: `curl -s 'https://api.biorxiv.org/details/biorxiv/2026-01-01/2026-04-11/0' > tests/fixtures/biorxiv/details-physiology.json`
- Rate: 1 RPS.
- Endpoint accepts a server-side date range + offset, returns `{collection: [{doi, title, abstract, authors, date, category, ...}]}`.
- Paginate by incrementing offset until `messages[0].total` is reached.
- Query filtering: BioRxiv's `/details/` endpoint doesn't accept free-text queries — for `fetchPapers(query)` we fetch pages and filter client-side on `title.toLowerCase().includes(queryKeyword)` OR `abstract.toLowerCase().includes(queryKeyword)` for each PubMed-style term in the query. Document this limitation in a top-of-file comment.
- `externalId`: DOI; `peerReviewed: false`.
- **Also** export a `fetchNew(feed)` discovery method that calls `/details/biorxiv/{category}/{days-back-from-watermark}/0` and returns new items since `feed.last_item_at`. Register as both ingestion and discovery via `registerIngestion(biorxiv)` and `registerDiscovery(biorxiv)`.

**Task 4.3 — medRxiv** (`medrxiv.js`)
- Same API shape as biorxiv, URL prefix `api.biorxiv.org/details/medrxiv/...`.
- Rate: 1 RPS (shared infra — consider a shared limiter between biorxiv and medrxiv via a module-level constant in a new `scripts/sources/_shared-limiters.js`).
- Same dual role (ingestion + discovery).

**Task 4.4 — SportRxiv** (`sportrxiv.js`)
- Fixture: `curl -s 'https://api.osf.io/v2/preprints/?filter[provider]=sportrxiv&page[size]=3' > tests/fixtures/sportrxiv/osf-nodes.json`
- Rate: 2 RPS unauthenticated.
- Endpoint: OSF `/v2/preprints/` with `filter[provider]=sportrxiv`. Response has `data[]` with `attributes.title`, `attributes.description`, `attributes.date_published`, `links.preprint_doi_url`.
- `externalId`: OSF node id (`data[].id`); `doi`: parse from `links.preprint_doi_url`.
- `peerReviewed: false`.
- Dual role — `fetchNew()` pulls the latest N preprints ordered by `-date_created`, filters by `publishedAt > feed.last_item_at`.

**Task 4.5 — CrossRef** (`crossref.js`)
- Fixture: `curl -s 'https://api.crossref.org/works?query=creatine&rows=3' -H 'Mailto: noreply@emersus.ai' > tests/fixtures/crossref/works-creatine.json`
- Rate: 10 RPS (polite pool via `Mailto:` header).
- Endpoint: `/works?query=...&rows=100&offset=...`. Response has `message.items[]` with `DOI`, `title[0]`, `abstract` (may be HTML-escaped), `author[]`, `container-title[0]`, `issued.date-parts[0]`.
- **Skip rows without an abstract** — CrossRef indexes a lot of metadata-only records, unusable for our retrieval.
- `externalId`: DOI; `peerReviewed: true`; add `Mailto: noreply@emersus.ai` to headers via `fetchWithTimeoutAndUA` options.

**Task 4.6 — DOAJ** (`doaj.js`)
- Fixture: `curl -s 'https://doaj.org/api/v2/search/articles/creatine?pageSize=3' > tests/fixtures/doaj/articles-creatine.json`
- Rate: 2 RPS.
- Endpoint: `/api/v2/search/articles/{query}?pageSize=100&page=N`. Response has `results[]` with `bibjson.title`, `bibjson.abstract`, `bibjson.author[].name`, `bibjson.journal.title`, `bibjson.identifier[]` (DOI extraction).
- `externalId`: DOI; `peerReviewed: true`.

**Commit after each adapter.** Message format: `feat(sources): <source> ingestion adapter`.

### Milestone 5: Discovery RSS plugins + classifier (Tasks 5.1 – 5.4)

**Task 5.1 — Generic RSS parser** (`rss-generic.js`)
- Create: `scripts/sources/rss-generic.js`
- Create: `tests/unit/sources/rss-generic.test.js`
- Fixture: a real SBS RSS dump — `curl -s https://www.strongerbyscience.com/feed/ > tests/fixtures/rss/sbs.xml`
- Write a helper `parseRss(xml): { items: [{title, url, abstract, publishedAt}] }` that:
  - Handles RSS 2.0 `<item>` shape (most feeds we use)
  - Extracts `<title>`, `<link>`, `<description>` (or `<content:encoded>`), `<pubDate>`
  - Strips HTML tags from description for the `abstract` field
  - Returns items in reverse-chronological order (newest first)
- Write a factory `createRssSource({ id, name, url, feedId })` returning a `DiscoverySource` that:
  - `fetchNew(feed)`: fetches `feed.url` via `fetchWithTimeoutAndUA`, parses via `parseRss`, filters `publishedAt > feed.last_item_at`, returns normalized `DiscoveredItem[]`.
- Unit tests: parser handles a real feed, factory returns items newer than a given watermark, empty watermark returns everything.

**Task 5.2 — Per-feed RSS adapter files** (`rss-sbs.js`, `rss-suppversity.js`, `rss-mass.js`, `rss-sfs.js`, `rss-nsca.js`, `rss-acsm.js`, `rss-journal-*.js`)
- Each file is a ~10-line wrapper: imports `createRssSource` and calls `registerDiscovery(...)` with per-feed metadata. No custom parsing.
- Example:
  ```js
  // scripts/sources/rss-sbs.js
  import { createRssSource } from "./rss-generic.js";
  import { registerDiscovery } from "./_registry.js";
  export const rssSbs = createRssSource({
    id: "rss-sbs",
    name: "Stronger By Science",
    url: "https://www.strongerbyscience.com/feed/",
  });
  registerDiscovery(rssSbs);
  ```
- No tests per file — the parser is covered in 5.1, and feed-specific quirks (if any) surface in integration tests.
- Commit all ~14 RSS adapter files together: `feat(sources): per-feed RSS discovery adapters`.

**Task 5.3 — Classifier job (`jobs/classify-candidates.js`)**
- Uses `openaiClient` (import from `api/lib/clients.js`).
- Prompt: "Given the following {N} article titles and abstracts, for each one, return a JSON object with: `is_exercise_science` (bool), `topic_key` (snake_case slug, or null), `raw_term` (the human-readable topic), `confidence` (0-1), `rationale` (one sentence), `suggested_query` (a PubMed-style boolean query string, or null). Return a JSON array of N objects in the same order as input."
- Model: `gpt-5-mini` (matches production OPENAI_EMERSUS_MODEL override).
- Response format: JSON mode (`response_format: { type: "json_object" }`, wrap array in `{results: [...]}`).
- Batch size: 25 items per call.
- Filter: `is_exercise_science === true && confidence >= 0.6`.
- Upsert into `topic_candidates` with conflict resolution:
  ```sql
  INSERT INTO topic_candidates (topic_key, raw_term, suggested_query, confidence, rationale, source_urls, discovery_feed)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (topic_key) DO UPDATE SET
    confidence = GREATEST(topic_candidates.confidence, EXCLUDED.confidence),
    source_urls = array_cat(topic_candidates.source_urls, EXCLUDED.source_urls)
  ```
- Pre-filter: skip items whose candidate `topic_key` already exists in `research_topics`.
- Unit test: mock OpenAI via `nock` on `api.openai.com/v1/chat/completions`, provide a canned response, assert `topic_candidates` rows are inserted.
- Commit: `feat(jobs): classify-candidates handler with gpt-5-mini`.

**Task 5.4 — `fetch-feed` handler (`jobs/fetch-feed.js`)**
- Load the `discovery_feeds` row by id. If `status != 'active'`, skip.
- Look up the source plugin by `row.source_plugin` via `getDiscoverySource(row.source_plugin)`.
- If missing: throw `SourcePermanentError('unknown discovery plugin: ' + row.source_plugin)`.
- Call `plugin.fetchNew(row)` inside a try/catch.
- On success: update `discovery_feeds` (`last_item_at`, `last_run_at`, `last_item_count`, reset `consecutive_failures`). Chunk items into 25-sized batches and `boss.send('classify-candidates', {items, feedId: row.id})` for each.
- On failure: increment `consecutive_failures`. If `>= 3`, set `status = 'disabled'` and insert a warning row into `topic_candidates` with `status='rejected'` named `feed_dead_<feed_id>` so operator sees it during next review.
- Unit test: mock a plugin that returns 50 items, assert two `classify-candidates` jobs enqueued, watermark updated.
- Commit: `feat(jobs): fetch-feed handler with circuit breaker`.

### Milestone 6: Remaining job handlers (Tasks 6.1 – 6.10)

Each handler follows the same test-first structure. I'll give the signature + key logic per handler; the test pattern is:
1. Create `tests/unit/jobs/<name>.test.js` with a fake pg client + fake boss.
2. Write failing test asserting key behaviors.
3. Implement handler in `jobs/<name>.js` and `registerHandler(boss, name, handler)` inside `jobs/_registry.js`.
4. Commit.

**Task 6.1 — `jobs/discovery-weekly.js`**
- Select `discovery_feeds` WHERE `status='active'` ORDER BY id.
- `UPDATE topic_candidates SET status='pending' WHERE status='snoozed' AND snooze_until < now()` as a housekeeping step.
- For each feed: `boss.send('fetch-feed', {feedId: feed.id})`.
- `ctx.progress('fanned out N feeds')`.
- Commit: `feat(jobs): discovery-weekly fanout handler`.

**Task 6.2 — `jobs/ingest-topic.js`**
- Load `research_topics` row by `data.topicId`.
- If not found: throw `SourcePermanentError`.
- `sourceIds = data.sourceIds ?? listIngestionSources().map(s => s.id)`.
- For each `sourceId`, `boss.send('ingest-topic-from-source', {topicId, sourceId, target: topic.target_paper_count})`.
- Teamed send: use `sendOptions = { singletonKey: \`ingest-${topicId}-${sourceId}\`, singletonHours: 24 }` to prevent duplicate in-flight jobs for the same topic+source.
- Commit: `feat(jobs): ingest-topic fanout to per-source jobs`.

**Task 6.3 — `jobs/ingest-topic-from-source.js`**
- Load topic row. Load source plugin via `getIngestionSource(data.sourceId)`.
- Get a pg pool handle. Track `insertedCount = 0`, `skippedCount = 0`.
- `for await (const paper of plugin.fetchPapers(topic.query, { target: data.target, signal: ctx.signal, progress: ctx.progress }))`:
  - `INSERT INTO research_articles (source, external_id, title, abstract, doi, published_at, journal, authors, peer_reviewed, source_metadata) VALUES (...) ON CONFLICT (source, external_id) DO NOTHING RETURNING id`.
  - Increment counts; `ctx.progress(\`\${insertedCount}/\${data.target}\`)` every 50 papers.
- After loop: `UPDATE research_topics SET last_filled_at=now(), last_fill_count=$1 WHERE id=$2`.
- Enqueue follow-up `boss.send('embed-batch', {limit: 1000})`.
- Return `{inserted: insertedCount, skipped: skippedCount}`.
- Handle `SourceRateLimitError` by rethrowing — worker's retry-dispatch layer converts it into a `boss.sendDelayed`.
- Commit: `feat(jobs): ingest-topic-from-source handler`.

**Task 6.4 — `jobs/embed-batch.js`**
- Port the existing `scripts/embed-papers.js` logic: select N unembedded chunks from `evidence_chunks` (or `research_articles` — whichever the existing script touches), call OpenAI embeddings, batch insert back.
- Wrap in handler context with `ctx.progress` every batch.
- If `ctx.signal.aborted` between batches, exit gracefully (no throw — partial work is fine for embeddings).
- Commit: `feat(jobs): embed-batch handler wrapping embed-papers logic`.

**Task 6.5 — `jobs/s2-citation-backfill.js`**
- Port `scripts/backfill-semantic-scholar.js` + `scripts/backfill-citation-counts.js` into one handler. They were already merged into one job type in the spec.
- Preserve the `SemanticScholarBatchAllInvalid` fast-path fix.
- Honor `S2_API_KEY` env.
- Commit: `feat(jobs): s2-citation-backfill handler`.

**Task 6.6 — `jobs/rcr-backfill.js`**
- Port `scripts/fill-rcr-scores.js` — iCite API calls, batched.
- Commit: `feat(jobs): rcr-backfill handler`.

**Task 6.7 — `jobs/validate-queries.js`**
- Port `scripts/validate-pubmed-queries.js` — runs eutils esearch per topic, counts, classifies pass/warn/fail, writes results to `ctx.progress`.
- Read topics from `research_topics` WHERE `status='active'` instead of parsing JS.
- Commit: `feat(jobs): validate-queries handler reading from research_topics`.

**Task 6.8 — `jobs/detect-failure-clusters.js`**
- Query `pgboss.job` for failures in last 10 minutes, group by name, threshold ≥5.
- For each cluster, check `alert_log` for prior `failure_cluster` in last hour.
- If none, call `api/lib/alerts.js → sendAlert` and insert an `alert_log` row.
- Commit: `feat(jobs): detect-failure-clusters with 60min cooldown`.

**Task 6.9 — `jobs/alert-daily-digest.js`**
- Compose 24h summary: job counts by name + state, pending candidates, corpus growth by source, feeds with failures, jobs-per-hour sparkline (unicode block chars).
- Always send, even on quiet days.
- Commit: `feat(jobs): alert-daily-digest handler`.

**Task 6.10 — `jobs/cleanup-job-progress.js`**
- `DELETE FROM job_progress WHERE ts < now() - (($1||' days')::interval)` with `data.olderThanDays ?? 30`.
- Commit: `feat(jobs): cleanup-job-progress daily purge`.

**Task 6.11 — Wire up `jobs/_registry.js`**
- Replace the stub with imports of every handler and register via `boss.work(name, { teamSize, teamConcurrency }, wrap(handler))`.
- `wrap(handler)` is the code that:
  - Constructs `ctx` via `makeContext(jobRow, sql)`
  - Registers the ctx's `abort()` on a pg-boss cancellation observer
  - Calls `handler(ctx)` in a try/catch
  - On success: `boss.complete(jobRow.id, {inserted: ..., ...})`
  - On failure: decide retry policy based on error class
- Use `boss.schedule()` for the three cron jobs (`discovery-weekly`, `detect-failure-clusters`, `alert-daily-digest`, `cleanup-job-progress`).
- Commit: `feat(worker): register all handlers and cron schedules`.

### Milestone 7: CLI wrapper helper + first migrated script (Tasks 7.1 – 7.3)

**Task 7.1 — `scripts/lib/run-as-job.js`**
- Exported function `runAsJob(jobName, payload, { detach = false })`.
- Behavior specified in spec §8.1 + §8.5.
- Unit test: run against a test DB, enqueue a no-op job that writes progress rows, assert stdout/exit code.
- Commit: `feat(scripts/lib): run-as-job CLI helper`.

**Task 7.2 — Rewrite `scripts/embed-papers.js` as a wrapper**
- Move existing logic to `scripts/embed-papers-direct.js`.
- Replace `scripts/embed-papers.js` with the ~20-line wrapper pattern from spec §8.2.
- Add `--direct` flag that dynamic-imports the `-direct.js` sibling.
- Manual smoke: `node scripts/embed-papers.js --limit=5` against test DB, verify progress tails, exit 0.
- Commit: `refactor(scripts): embed-papers as pg-boss wrapper with --direct fallback`.

**Task 7.3 — `scripts/jobs-tail.js` and `scripts/jobs-list.js`**
- `jobs-tail.js <jobId>`: reads `job_progress` WHERE `job_id = $1` ordered by seq, polls every 1s while `pgboss.job.state` is non-terminal, exits with terminal state code.
- `jobs-list.js`: prints last 20 jobs from `pgboss.job` joined with a count of `job_progress` rows per job.
- Commit: `feat(scripts): jobs-tail and jobs-list CLI tools`.

### Milestone 8: Remaining wrappers + direct siblings (Tasks 8.1 – 8.6)

For each script, the pattern is: rename existing file to `<name>-direct.js` (where applicable), write the wrapper using `runAsJob`, preserve all CLI args as the job payload. Unit-level manual smoke per wrapper.

**Task 8.1** — `backfill-semantic-scholar.js` → wrapper + `-direct` sibling
**Task 8.2** — `backfill-citation-counts.js` → wrapper (shares the `-direct` sibling with 8.1 via re-export)
**Task 8.3** — `fill-rcr-scores.js` → wrapper + `-direct` sibling
**Task 8.4** — `validate-pubmed-queries.js` → wrapper + `-direct` sibling (preserves the current regex parser for offline validation)
**Task 8.5** — `fill-pmc-topics.js` → wrapper (no `-direct`; see spec §8.2). **TOPIC_QUERIES JS object stays in the file as disaster-recovery seed — do not delete.** Delete `fill-pmc-corpus.js` since its logic moved to `jobs/ingest-topic-from-source.js`.
**Task 8.6** — `scripts/discover-topics.js` (new) — thin wrapper around `discovery-weekly`. `scripts/send-test-alert.js` — thin wrapper around a manual `send-alert` job. Commit each wrapper separately with `refactor(scripts): <name> as wrapper`.

### Milestone 9: Admin UI + API (Tasks 9.1 – 9.8)

**Task 9.1 — `api/admin/_middleware.js`**
- Implements `requireAdmin` per spec §5b.
- Unit test with a faked session.

**Task 9.2 — `api/admin/candidates.js`**
- All candidate endpoints from spec §5c table.
- Integration test that seeds a candidate, posts an accept, asserts `research_topics` row exists and `ingest-topic` job is enqueued.

**Task 9.3 — `api/admin/topics.js`** — list, patch, ingest-now.
**Task 9.4 — `api/admin/feeds.js`** — list, create, patch, fetch-now.
**Task 9.5 — `api/admin/jobs.js`** — list, progress endpoint.
**Task 9.6 — `api/admin/alerts.js`** — audit log.

**Task 9.7 — Mount admin routes in `server.js`**
- Add `app.use('/api/admin', adminRouter)` and `app.use('/admin', express.static('admin'))`.
- Commit: `feat(server): mount admin API and static routes`.

**Task 9.8 — Six admin HTML pages**
- Each page: minimal plain HTML + inline `<script type="module">` that fetches data and renders DOM nodes. ~150 lines each. Layout from spec §5.4.
- Shared `shared/admin.css` with table + card styles matching the existing `shared/site.css` palette.
- Commit per page: `feat(admin): <page> admin UI`.

### Milestone 10: Email alerts + heartbeat watchdog (Tasks 10.1 – 10.4)

**Task 10.1 — `api/lib/alerts.js`**
- `sendAlert({ type, subject, body, html })` using Resend SDK (already in deps).
- Reads `ALERT_EMAILS` or falls back to `ADMIN_EMAILS`.
- Honors `ALERT_SILENT=1`.
- Rate ceiling: suppress when `>10` alerts in last hour (check `alert_log`).
- Inserts `alert_log` row before sending.
- Unit test: mock Resend, assert payload.
- Commit: `feat(alerts): sendAlert helper with rate ceiling and silent mode`.

**Task 10.2 — `jobs/send-alert.js`**
- Simple job wrapper around `sendAlert`. Exists so `scripts/send-test-alert.js` can enqueue via pg-boss like any other CLI wrapper.
- Commit: `feat(jobs): send-alert handler`.

**Task 10.3 — `scripts/heartbeat-watchdog.js`**
- Reads `last_beat_at` from `worker_heartbeats`. If older than 5 minutes, calls `sendAlert({type: 'worker_down', ...})` with 30-minute cooldown check.
- Intended to be invoked by Hetzner crontab, NOT pg-boss (if worker is down, pg-boss jobs don't run).
- Commit: `feat(scripts): heartbeat-watchdog for standalone cron invocation`.

**Task 10.4 — `scripts/send-test-alert.js`**
- Thin wrapper enqueueing `send-alert` with a dummy payload. For operator smoke-testing the pipeline.
- Commit: `feat(scripts): send-test-alert CLI wrapper`.

### Milestone 11: Integration smoke test (Task 11.1)

**Task 11.1 — End-to-end smoke script**
- Create: `tests/integration/end-to-end-smoke.test.js`
- Sequence:
  1. `resetSchema` + apply all migrations + seed research_topics + seed discovery_feeds.
  2. Start an in-process pg-boss instance pointed at the test DB.
  3. Register all handlers.
  4. Mock one RSS feed with a small `nock` scope returning 5 items.
  5. Enqueue `discovery-weekly`, wait for completion.
  6. Assert `topic_candidates` has new rows (after mocked classifier returns high confidence).
  7. Accept one candidate via direct SQL (simulating the admin API call).
  8. Enqueue `ingest-topic`, wait for completion (with mocked source plugins yielding 3 papers each from canned fixtures).
  9. Assert `research_articles` has new rows with correct `source` and `peer_reviewed` values.
- Commit: `test(e2e): pipeline smoke from discovery to ingest to embed`.

### Milestone 12: Deploy prep + runbook (Tasks 12.1 – 12.4)

**Task 12.1 — Verify Hetzner DB backup**
- SSH to Hetzner, run `ls -lah /var/backups/` or the equivalent backup path. If no automated backup exists, configure one using `pg_dump` in a daily Hetzner crontab entry dumping to `/var/backups/emersus/emersus-YYYY-MM-DD.sql.gz`.
- Document the restore procedure in `infra/BACKUP.md` (local-only, not committed).
- Blocker for phase 1.

**Task 12.2 — Runbook `docs/ops/topic-pipeline-runbook.md`**
- Phase 1 migration apply commands in order.
- Seed commands.
- Worker pm2 start/stop.
- How to manually trigger discovery-weekly.
- How to retry a failed job from the admin UI.
- How to rollback each phase.
- Commit: `docs(ops): topic pipeline runbook`.

**Task 12.3 — Verify `server.js` `workflow.js` references updated**
- Grep for `pubmed_articles` across the codebase.
- Any file that still references it gets updated to `research_articles`.
- Run `npm test` + manual smoke of `/api/chat` against test DB.
- Commit: `refactor(api): pubmed_articles → research_articles references`.

**Task 12.4 — Pre-flight merge checklist**
- All milestone gates passed.
- Integration smoke green.
- Manual end-to-end on local Docker: start worker, run discovery-weekly with one real RSS feed, triage a candidate, watch ingestion.
- Open PR from `feat/topic-discovery-pipeline` → `main`.
- After merge, execute phase 1 per runbook.

---

## Self-review

- **Spec coverage:**
  - §2.1 in-scope items — all covered in milestones 1-12.
  - §4 schema — Milestone 1.
  - §5 source plugins — Milestones 3, 4, 5.
  - §6 job catalog (13 types) — Milestones 5, 6.
  - §7 admin UI — Milestone 9.
  - §8 CLI wrappers — Milestones 7, 8.
  - §9 alerts, rate limits, observability — Milestones 5 (rate limiters), 10 (alerts), 4 (error taxonomy in 3.2).
  - §10 migration plan — Milestone 12.
- **Placeholder scan:** no TBD/TODO/FIXME in the plan. Milestones 4-12 use a structured-outline-per-task format because each task is a repeat of the same test-first pattern established in Milestones 0-3 — the key logic, file paths, and commit messages are present, but the engineer is expected to reuse the Milestones 0-3 step template (failing test → implement → pass → commit) rather than have it spelled out identically 60+ times. This is deliberate scope control for a 130+ task plan; a subagent executing Milestone 4 has the shape of Milestone 3 as an immediate reference.
- **Type consistency:**
  - `IngestedPaper` shape used in Milestone 3 matches usage in Milestone 6.3 (ingest-topic-from-source handler inserts columns matching the typedef).
  - `DiscoveredItem` shape from Milestone 3 used by Milestone 5.4 (fetch-feed).
  - `createLimiter`, `registerIngestion`, `registerDiscovery`, `getIngestionSource`, `getDiscoverySource`, `fetchWithTimeoutAndUA` — all defined in Milestone 3 and used by Milestones 4, 5, 6.
  - `makeContext` from Milestone 2.1 used by `jobs/_registry.js` in Milestone 6.11.
  - `seedResearchTopics`, `seedDiscoveryFeeds` — defined in Milestone 1, not referenced by later code (they're one-shot scripts).
- **Gaps:**
  - **Milestone 4-6 task granularity is looser than 0-3.** Deliberately so — strict per-step expansion would balloon the plan beyond practical use. Subagents executing these milestones should treat each listed task as a mini-plan and apply the 5-step TDD pattern from Milestones 0-3 themselves.
  - **Deletion of `fill-pmc-corpus.js` in Task 8.5** is an irreversible action — Milestone 12.4 pre-flight should confirm no callers remain via a final grep before the delete commit.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-topic-discovery-pipeline.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per milestone (or per task, for the dense Milestone 1 migrations), review between subagents, commit as I go. Best for a plan this large because the fresh subagents avoid context saturation and let me spot mistakes between handoffs.

**2. Inline Execution** — I execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review. Works but my context will fill up fast given the size — I'd probably hit a compact boundary around Milestone 5-6.

Which approach?
