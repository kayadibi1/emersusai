# Topic Discovery Pipeline & Multi-Source Ingestion — Design Spec

**Status:** Approved via brainstorming 2026-04-11. Ready for implementation plan.

**Author:** Claude Opus 4.6 (paired with kayadibi1)

**Related:**
- Predecessor spec: `2026-04-11-pubmed-topic-expansion-design.md` (the 300-topic static list this builds on top of)
- Predecessor plan: `docs/superpowers/plans/2026-04-11-pubmed-topic-expansion.md`

---

## 1. Goal

Replace the hand-curated `TOPIC_QUERIES` JS object in `scripts/fill-pmc-topics.js` with a **self-updating, multi-source research pipeline** that:

1. Discovers new exercise-science topics from curated academic + practitioner RSS feeds via an LLM classifier.
2. Surfaces candidates in an admin review UI for human accept/reject/snooze.
3. Stores accepted topics in a Postgres table (`research_topics`) instead of a hardcoded JS object.
4. Ingests papers for each topic from **seven** sources — PubMed, Europe PMC, BioRxiv, medRxiv, SportRxiv, CrossRef, DOAJ — not just PubMed.
5. Coordinates all long-running work (discovery, ingestion, embedding, backfills) through a **pg-boss job queue** running in a new `emersus-worker` process alongside the existing `emersus-api`.
6. Emits **tiered email alerts** (worker-down, failure clusters, daily digest) so silent failure is detectable.

The JS `TOPIC_QUERIES` object stays in `fill-pmc-topics.js` as permanent idempotent-seed disaster recovery data, but is never read at runtime after the seed migration.

## 2. Scope

### 2.1 In scope (v1)

- 7 ingestion source adapters behind a `Source` interface
- Weekly discovery cron (Monday 03:00 America/New_York via pg-boss `boss.schedule`)
- gpt-5-mini classifier with JSON mode, confidence ≥ 0.6 filter
- New tables: `research_topics`, `topic_candidates`, `discovery_feeds`, `job_progress`, `worker_heartbeats`, `alert_log`
- Rename `pubmed_articles` → `research_articles` + add `source`, `peer_reviewed`, `external_id`, `source_metadata` columns
- Update `match_evidence_chunks` RPC to prefer `peer_reviewed = true` rows when multiple share a DOI
- `emersus-worker` pm2 process + pg-boss queue tables
- Admin UI under `/admin/*` (6 pages): dashboard, candidates, topics, feeds, jobs, alerts — env-based `ADMIN_EMAILS` allowlist for auth
- CLI wrapper pattern: every long-running script becomes a thin wrapper that enqueues a job and tails progress, preserving interactive UX
- Migrated scripts: `embed-papers`, `backfill-semantic-scholar`, `backfill-citation-counts`, `fill-rcr-scores`, `validate-pubmed-queries`, `fill-pmc-topics`, `fill-pmc-corpus`
- Seed scripts: `seed-research-topics.js` (parses JS baseline), `seed-discovery-feeds.js` (inserts ~20 feeds)
- `--direct` fallback flag on wrappers for the first month post-deploy
- Email alerts via Resend: worker-down (5min threshold), failure clusters (5 in 10min), daily digest (08:00 America/New_York, always-send dead-man's-switch)
- Verify/configure Hetzner DB nightly backup as phase 1 prerequisite

### 2.2 Out of scope (v1)

- Automatic query generation with auto-accept above a confidence threshold (human edits query before accept)
- Topic version history / edit audit log
- Non-English sources
- Full-text (`tsvector`) indexing on abstracts
- Cross-source total request budget coordination
- Migrating dev/probe scripts (they stay as direct `node scripts/x.js`)
- Reddit / YouTube discovery sources (burned us last attempt, RSS is the right signal)
- External webhooks

## 3. Architecture

### 3.1 Component layout

A single new `emersus-worker` pm2 process on Hetzner, sibling to the existing `emersus-api`, sharing the same self-hosted Postgres (which now also hosts the `pgboss.*` schema).

```
┌────────────────────────────────────────────────────────────────┐
│                       HETZNER VPS                              │
│                                                                │
│  ┌──────────────┐   ┌─────────────────┐   ┌────────────────┐   │
│  │  Caddy       │   │ emersus-api     │   │ emersus-worker │   │
│  │  (:443)      │──▶│  (pm2)          │   │  (pm2, NEW)    │   │
│  └──────────────┘   │  Express 5      │   │  pg-boss       │   │
│                     │  /api/* /admin  │   │  consumer      │   │
│                     └────────┬────────┘   └────────┬───────┘   │
│                              │                     │           │
│                              ▼                     ▼           │
│                     ┌─────────────────────────────────────┐    │
│                     │  supabase-db (Postgres 15)          │    │
│                     │  pgboss.*  +  public.*              │    │
│                     └─────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Control flow

**Discovery (weekly):**
1. pg-boss internal scheduler fires `discovery-weekly` at Monday 03:00 America/New_York.
2. Handler SELECTs active feeds from `discovery_feeds`, fans out one `fetch-feed` job per feed.
3. Each `fetch-feed` calls its source plugin's `fetchNew()`, updates the feed's watermark state, and chunks the results into `classify-candidates` jobs (25 items per chunk).
4. `classify-candidates` calls gpt-5-mini JSON mode, filters by confidence ≥ 0.6, pre-dedups against existing `topic_candidates` and `research_topics`, upserts new rows.

**Review (human-in-the-loop):**
1. Operator opens `/admin/candidates/`, sees ranked pending candidates with confidence, rationale, source URLs, editable query.
2. Accept button: `POST /api/admin/candidates/:id/accept` → inserts `research_topics` row → flips candidate to `accepted` → enqueues `ingest-topic` job.
3. Reject / snooze flip status, set `decided_at`. Snooze sets `snooze_until`; discovery job resets snoozed rows to `pending` once expired.

**Ingestion (on accept or manual fill):**
1. `ingest-topic` handler loads the `research_topics` row, fans out one `ingest-topic-from-source` per source (default: all 7).
2. Each `ingest-topic-from-source` loads its source plugin, iterates `plugin.fetchPapers(query, opts)`, inserts into `research_articles` with `(source, external_id)` conflict = skip.
3. On completion, updates `research_topics.last_filled_at / last_fill_count`.
4. Enqueues a follow-up `embed-batch` job for any new unembedded paragraphs.

### 3.3 Orthogonal concerns

- **Queue infrastructure** (pg-boss, worker, job schemas) is boring plumbing, owned by `worker/` and `jobs/`.
- **Source plugins** (the 7 ingestion adapters + ~20 discovery adapters) are domain logic, owned by `scripts/sources/`.

The worker is a thin dispatcher — every interesting decision lives in a plugin module.

## 4. Database schema

### 4.1 Rename: `pubmed_articles` → `research_articles`

```sql
ALTER TABLE public.pubmed_articles RENAME TO research_articles;
```

Indexes, FKs, sequences, and the `match_evidence_chunks` RPC are all updated to reference the new name in the same migration. All ~20-30 scripts and API handlers that reference `pubmed_articles` get updated.

### 4.2 New columns on `research_articles`

```sql
ALTER TABLE public.research_articles
  ADD COLUMN source text NOT NULL DEFAULT 'pubmed'
    CHECK (source IN ('pubmed', 'europepmc', 'biorxiv', 'medrxiv', 'sportrxiv', 'crossref', 'doaj')),
  ADD COLUMN peer_reviewed boolean NOT NULL DEFAULT true,
  ADD COLUMN external_id text,
  ADD COLUMN source_metadata jsonb;

UPDATE public.research_articles SET external_id = pmid::text WHERE source = 'pubmed';

CREATE UNIQUE INDEX research_articles_source_external_id_uniq
  ON public.research_articles(source, external_id);

CREATE INDEX research_articles_doi_idx
  ON public.research_articles(doi)
  WHERE doi IS NOT NULL;
```

`external_id` is the canonical identifier within a source (PMID for `pubmed`, DOI for the others). The `(source, external_id)` unique constraint means the same paper can appear twice if present in two sources (e.g., a BioRxiv preprint + its post-review PubMed row), and the DOI index is the cross-source dedup key used by the retrieval RPC.

### 4.3 `research_topics`

```sql
CREATE TABLE public.research_topics (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_key            text NOT NULL UNIQUE,
  query                text NOT NULL,
  domain               text,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'deprecated')),
  origin               text NOT NULL DEFAULT 'seed'
                         CHECK (origin IN ('seed', 'discovered', 'manual')),
  source_candidate_id  bigint,  -- FK added after topic_candidates exists
  target_paper_count   integer NOT NULL DEFAULT 2000,
  last_filled_at       timestamptz,
  last_fill_count      integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_topics_domain_idx  ON public.research_topics(domain);
CREATE INDEX research_topics_status_idx  ON public.research_topics(status);
```

Seeded from the existing `TOPIC_QUERIES` JS object via idempotent `seed-research-topics.js`. The JS object stays in `fill-pmc-topics.js` as permanent disaster-recovery seed data and is never read at runtime after the seed migration.

### 4.4 `topic_candidates`

```sql
CREATE TABLE public.topic_candidates (
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

ALTER TABLE public.research_topics
  ADD CONSTRAINT research_topics_source_candidate_fk
  FOREIGN KEY (source_candidate_id) REFERENCES public.topic_candidates(id);

CREATE INDEX topic_candidates_status_idx        ON public.topic_candidates(status);
CREATE INDEX topic_candidates_created_desc_idx  ON public.topic_candidates(created_at DESC);
```

Dedup semantics:
- `topic_key` unique: if the same term shows up in 3 feeds, it becomes one row. On collision, `classify-candidates` upserts with `confidence = GREATEST(existing, new)` and `source_urls = array_cat(...)`.
- Discovery job pre-filters with `topic_key NOT IN (SELECT topic_key FROM topic_candidates) AND NOT IN (SELECT topic_key FROM research_topics)`.
- Snoozed rows with `snooze_until < now()` are flipped to `pending` by a housekeeping step at the start of `discovery-weekly`.

### 4.5 `discovery_feeds`

```sql
CREATE TABLE public.discovery_feeds (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('rss', 'atom', 'api')),
  url                   text NOT NULL,
  source_plugin         text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_item_at          timestamptz,
  last_run_at           timestamptz,
  last_item_count       integer NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

Config + per-feed watermark state live in one table (no separate watermarks table). `fetch-feed` reads the row, calls the plugin, writes back `last_item_at / last_run_at / last_item_count`. On `consecutive_failures ≥ 3`, the job marks the feed `status='disabled'` and logs a warning candidate row so the operator notices within two weeks.

Admin page `/admin/feeds/` shows health and exposes "Fetch now" (one-off `fetch-feed` enqueue) and an "Add feed" form.

### 4.6 `job_progress`

```sql
CREATE TABLE public.job_progress (
  job_id     uuid NOT NULL REFERENCES pgboss.job(id) ON DELETE CASCADE,
  seq        bigint GENERATED ALWAYS AS IDENTITY,
  level      text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message    text NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX job_progress_job_id_seq_idx ON public.job_progress(job_id, seq);
```

Handlers call `ctx.progress(message, level)` which inserts here. Both the CLI wrapper poller and the admin jobs view stream from this table. A nightly `cleanup-job-progress` job deletes rows older than 30 days.

### 4.7 `worker_heartbeats` and `alert_log`

```sql
CREATE TABLE public.worker_heartbeats (
  worker_id                  text PRIMARY KEY,
  last_beat_at               timestamptz NOT NULL,
  jobs_processed_since_start bigint NOT NULL DEFAULT 0
);

CREATE TABLE public.alert_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type  text NOT NULL,
  payload     jsonb,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_log_type_sent_idx ON public.alert_log(alert_type, sent_at DESC);
```

`worker_heartbeats`: worker writes `last_beat_at = now()` every 30 seconds. Worker startup clears stale heartbeats older than 10 minutes to avoid ghost rows masking a real death.

`alert_log`: every email alert inserts a row before sending. Used for per-type cooldowns and a `/admin/alerts/` audit view.

### 4.8 Updated RPC: `match_evidence_chunks`

The existing `match_evidence_chunks` function must be updated to:
1. Reference `research_articles` instead of `pubmed_articles`.
2. Prefer peer-reviewed rows when multiple rows share a DOI.

```sql
-- relevant change inside the function body
WITH ranked AS (
  SELECT
    a.*,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(a.doi, 'art-' || a.id::text)
      ORDER BY a.peer_reviewed DESC, a.id ASC
    ) AS rn
  FROM research_articles a
  WHERE ...
)
SELECT * FROM ranked WHERE rn = 1
ORDER BY similarity DESC
LIMIT ...;
```

The exact body lives in `supabase/20260412_match_evidence_chunks_v2.sql`, applied as the last schema migration in phase 1 with a `SET search_path = public, extensions` like the existing function.

## 5. Source plugins

### 5.1 The `Source` interface

Documented in `scripts/sources/_types.js` as JSDoc typedefs. Two roles, some plugins implement both:

```js
/**
 * @typedef {Object} DiscoverySource
 * @property {string} id
 * @property {string} name
 * @property {'rss'|'atom'|'api'} kind
 * @property {(feed: DiscoveryFeedRow) => Promise<DiscoveredItem[]>} fetchNew
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
 * @typedef {Object} IngestionSource
 * @property {string} id
 * @property {string} name
 * @property {boolean} peerReviewed
 * @property {(query: string, opts: IngestOpts) => AsyncIterable<IngestedPaper>} fetchPapers
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
```

### 5.2 Registry

`scripts/sources/_registry.js` exports `ingestionSources` and `discoverySources` arrays plus a `getIngestionSource(id)` helper. Adding a new source = one new file + one import/export line.

### 5.3 Ingestion adapters (7)

| Plugin | Endpoint | Rate limit | `peerReviewed` | `externalId` |
|---|---|---|---|---|
| `pubmed.js` | `eutils.ncbi.nlm.nih.gov/entrez/eutils/*` | 3 RPS (350ms) | `true` | PMID |
| `europepmc.js` | `www.ebi.ac.uk/europepmc/webservices/rest/search` | 5 RPS (200ms, self-cap) | `true` | DOI or PMID |
| `biorxiv.js` | `api.biorxiv.org/details/biorxiv/{query}` | 1 RPS (1000ms) | `false` | DOI |
| `medrxiv.js` | `api.biorxiv.org/details/medrxiv/{query}` | 1 RPS (1000ms) | `false` | DOI |
| `sportrxiv.js` | `api.osf.io/v2/nodes/?filter[tags]=sportrxiv` | 2 RPS (500ms) | `false` | OSF node id |
| `crossref.js` | `api.crossref.org/works?query=...` | 10 RPS (100ms, polite pool via `Mailto:` header) | `true` | DOI |
| `doaj.js` | `doaj.org/api/v2/search/articles/{query}` | 2 RPS (500ms) | `true` | DOI |

`biorxiv`, `medrxiv`, and `sportrxiv` double as `DiscoverySource` implementations (they expose subject RSS feeds separately from the paper-fetch API).

Rate limits live adjacent to the plugin via `scripts/sources/_ratelimit.js`:

```js
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

### 5.4 Initial discovery feed list (~20)

Academic:
- `biorxiv-physiology`, `biorxiv-neuroscience`, `biorxiv-pharmacology` (via biorxiv plugin)
- `medrxiv-nutrition`, `medrxiv-rehab`, `medrxiv-sportsmed` (via medrxiv plugin)
- `sportrxiv-all` (via sportrxiv plugin)
- `europepmc-exercise` (via europepmc plugin, "grant:(exercise OR sport)" saved search)
- `pubmed-sportsmed-30d` (eutils esearch "sports medicine[mh] AND last 30 days[pdat]" via pubmed plugin)
- Journal TOC RSS feeds (generic `rss-journal.js` plugin or per-journal file): Sports Medicine (Adis), BJSM, JSCR, IJSPP, JAP, MSSE, SJMSS, EJAP

Practitioner:
- `rss-sbs` (Stronger By Science), `rss-suppversity`, `rss-mass`, `rss-sfs` (Science For Sport), `rss-nsca`, `rss-acsm`

All seeded into `discovery_feeds` by `seed-discovery-feeds.js`. Adding a feed after seeding happens via the `/admin/feeds/` form or by editing and re-running the idempotent seed script.

### 5.5 Classifier separation

Discovery source `fetchNew` returns raw items; the LLM classifier in `classify-candidates` turns items into topics. Adding a new RSS feed never touches classifier code. Swapping classifier models never touches adapters. This boundary is load-bearing.

## 6. Job catalog

### 6.1 Types

| Job name | Payload | Triggered by | Concurrency | Retries | Handler |
|---|---|---|---|---|---|
| `discovery-weekly` | `{}` | `boss.schedule` (Mon 03:00 America/New_York) | 1 | 2 | `jobs/discovery-weekly.js` |
| `fetch-feed` | `{feedId}` | `discovery-weekly` fanout | 4 | 3 | `jobs/fetch-feed.js` |
| `classify-candidates` | `{items, feedId}` | `fetch-feed` fanout | 2 | 2 | `jobs/classify-candidates.js` |
| `ingest-topic` | `{topicId, sourceIds?}` | admin accept button, manual CLI | 4 | 3 | `jobs/ingest-topic.js` |
| `ingest-topic-from-source` | `{topicId, sourceId, target}` | `ingest-topic` fanout | 2 per source | 3 | `jobs/ingest-topic-from-source.js` |
| `embed-batch` | `{limit}` | post-ingest, manual, nightly cron | 1 | 2 | `jobs/embed-batch.js` |
| `s2-citation-backfill` | `{limit, batchSize}` | manual, weekly cron | 1 | 3 | `jobs/s2-citation-backfill.js` |
| `rcr-backfill` | `{limit}` | manual, weekly cron | 1 | 2 | `jobs/rcr-backfill.js` |
| `validate-queries` | `{topics?, passMin, warnMin}` | manual CLI | 1 | 0 | `jobs/validate-queries.js` |
| `detect-failure-clusters` | `{}` | `boss.schedule` every 5min | 1 | 0 | `jobs/detect-failure-clusters.js` |
| `alert-daily-digest` | `{}` | `boss.schedule` daily 08:00 America/New_York | 1 | 1 | `jobs/alert-daily-digest.js` |
| `cleanup-job-progress` | `{olderThan}` | `boss.schedule` daily 02:00 America/New_York | 1 | 1 | `jobs/cleanup-job-progress.js` |

### 6.2 Per-source team concurrency

`ingest-topic-from-source` is limited to 2 parallel jobs per source via pg-boss per-team settings. Effective parallelism: 7 sources × 2 = up to 14 in-flight ingestion jobs, but each source's own rate limit is always respected. Implementation: team name `ingest-topic-from-source:<sourceId>` with `teamSize=2`.

### 6.3 Retry policy

- **Transient** (`SourceTransientError`): pg-boss exponential backoff, 3 retries, ~30s/2min/5min.
- **Rate limit** (`SourceRateLimitError`, carries `retryAfterMs`): handler catches and `boss.sendDelayed(sameJob, retryAfterMs)`. Does **not** consume a retry. Fixes the S2 thrashing pattern from 2026-04-11.
- **Permanent** (`SourcePermanentError`): no retries, fail the job, log to `job_progress` at `error` level, visible in admin.

### 6.4 Ingestion fanout: job per source, not loop

Accepting a topic enqueues one `ingest-topic` which fans out 7 `ingest-topic-from-source` children. This gives us per-source retries, per-source cancellation, and parallelism across sources, at the cost of a more complex job graph. Accepted tradeoff per design approval.

## 7. Admin UI

### 7.1 Routes

Six static HTML pages under `admin/` served by the existing `emersus-api` Express app:

- `admin/index.html` — dashboard
- `admin/candidates/index.html` — pending topic candidates
- `admin/topics/index.html` — active research topics
- `admin/feeds/index.html` — discovery feed health
- `admin/jobs/index.html` — recent job runs
- `admin/alerts/index.html` — alert audit log

No SPA, no bundler. Matches the existing `/app/` page pattern: vanilla JS + esm.sh imports + plain DOM.

### 7.2 Auth

`requireAdmin` middleware checks `session.user.email ∈ ADMIN_EMAILS`. Env-based allowlist, one entry for starters, managed via `~/app/.env` on Hetzner.

### 7.3 API endpoints

All under `/api/admin/*`, all behind `requireAdmin`:

- `GET /api/admin/candidates?status=pending&limit=50`
- `POST /api/admin/candidates/:id/accept` — body `{query?, domain?, target?}`
- `POST /api/admin/candidates/:id/reject`
- `POST /api/admin/candidates/:id/snooze` — body `{until}`
- `GET /api/admin/topics?status=active`
- `PATCH /api/admin/topics/:id`
- `POST /api/admin/topics/:id/ingest` — body `{sourceIds?}`
- `GET /api/admin/feeds`
- `POST /api/admin/feeds` (create)
- `PATCH /api/admin/feeds/:id`
- `POST /api/admin/feeds/:id/fetch-now`
- `GET /api/admin/jobs?state=...&limit=50`
- `GET /api/admin/jobs/:id/progress?since=<seq>`
- `GET /api/admin/alerts?days=30`

Handlers live in `api/admin/*.js`, one file per resource.

### 7.4 Candidate review card

Per-candidate card shows: confidence badge, raw term, rationale, source URL list, editable `suggested_query` in a textarea, editable domain select, editable `target_paper_count` input, and three action buttons. Accept is a single POST — no confirmation modal; snooze covers "not sure yet".

### 7.5 Job progress streaming

Modal over the jobs list polls `GET /api/admin/jobs/:id/progress?since=<seq>` every 1 second while the job is active. Same endpoint used by the CLI `run-as-job` wrapper. No websockets, no SSE — polling is cheap at single-operator scale.

## 8. CLI wrapper pattern

### 8.1 Helper: `scripts/lib/run-as-job.js`

Every migrated script imports this helper and calls `runAsJob(name, payload)`. Responsibilities:

1. Boot pg-boss client.
2. Enqueue job with `retryLimit: 0` (CLI runs are interactive; failure surfaces immediately).
3. Print `[run-as-job] enqueued <name> as <id>` to stderr.
4. Poll `job_progress` for new rows (by `seq`) and print each to stdout, prefixed by level.
5. Poll `pgboss.job.state` for terminal transitions.
6. On SIGINT, `boss.cancel(jobId)` then exit 130. The worker observes the cancellation via `AbortSignal` on the handler context.
7. Exit 0 on `completed`, 1 on `failed`, 130 on `cancelled`.

Total ~100 lines. Shared by all wrappers.

### 8.2 Example wrapper

```js
// scripts/embed-papers.js
import { parseArgs } from "node:util";
import { runAsJob } from "./lib/run-as-job.js";

const { values } = parseArgs({
  options: {
    limit:   { type: "string",  default: "1000" },
    dryRun:  { type: "boolean", default: false },
    direct:  { type: "boolean", default: false },
  },
});

if (values.direct) {
  const { runDirect } = await import("./embed-papers-direct.js");
  await runDirect({ limit: Number(values.limit), dryRun: values.dryRun });
} else {
  await runAsJob("embed-batch", {
    limit: Number(values.limit),
    dryRun: values.dryRun,
  });
}
```

`--direct` is the v1 escape hatch: the old script logic lives in a `scripts/<name>-direct.js` sibling, callable to bypass pg-boss entirely. Removed in v2 after a month of clean operation.

**Scope of `--direct`:** only wrappers whose pre-migration logic is a single self-contained file get a `-direct.js` sibling. That's `embed-papers`, `backfill-semantic-scholar`, `backfill-citation-counts` (shares `backfill-semantic-scholar-direct.js` since they merge into one job), `fill-rcr-scores`, and `validate-pubmed-queries`.

Wrappers **without** a `--direct` path:
- `scripts/fill-pmc-topics.js` — pre-migration logic spawns the now-deleted `fill-pmc-corpus.js`, so a direct path would require keeping a second deleted file. Not worth the duplication. Rollback for this script is "run the seed script to restore `research_topics` from the JS baseline, then run the wrapper".
- `scripts/fill-pmc-corpus.js` — deleted entirely; logic lives only in `jobs/ingest-topic-from-source.js`.
- `scripts/discover-topics.js` — pipeline is net-new, there is no pre-migration direct path.

### 8.3 Handler context

Worker injects `{data, signal, progress, abort}` into each handler. Handlers poll `signal.aborted` in their work loops and throw `JobCancelled` when they see it. `progress(msg, level)` inserts into `job_progress`.

### 8.4 `--detach` flag

Every wrapper supports `--detach`: enqueue, print the job ID to stdout, exit immediately. For long-running work where the operator wants to close the laptop. Re-tail later via `node scripts/jobs-tail.js <jobId>`.

### 8.5 Scripts that get wrapped

| Script file | Wraps into | Payload |
|---|---|---|
| `scripts/embed-papers.js` | `embed-batch` | `{limit, dryRun}` |
| `scripts/backfill-semantic-scholar.js` | `s2-citation-backfill` | `{limit, batchSize}` |
| `scripts/backfill-citation-counts.js` | `s2-citation-backfill` | `{limit, batchSize}` (same job, merged) |
| `scripts/fill-rcr-scores.js` | `rcr-backfill` | `{limit}` |
| `scripts/validate-pubmed-queries.js` | `validate-queries` | `{topics, passMin, warnMin}` |
| `scripts/fill-pmc-topics.js` | bulk enqueue of `ingest-topic` (one per active topic) | `{topicIds?}` or `{all: true}` |
| `scripts/fill-pmc-corpus.js` | `ingest-topic-from-source` | `{topicId, sourceId, target}` |
| `scripts/discover-topics.js` (new) | `discovery-weekly` | `{}` |
| `scripts/send-test-alert.js` (new) | manual `sendAlert` | `{subject, body}` |

Dev/probe scripts (`test-retrieval.js`, `probe-*.js`, migration runners) are **not** wrapped.

## 9. Error handling, rate limits, observability, alerts

### 9.1 Error taxonomy

`scripts/sources/_errors.js`:
- `SourceTransientError` — 5xx, network, timeout → pg-boss retries 3× with backoff.
- `SourceRateLimitError(retryAfterMs)` — 429 → handler `boss.sendDelayed` without consuming a retry.
- `SourcePermanentError` — 400, 404, schema drift, "no valid ids given" → no retries, mark failed.

### 9.2 Observability signals

| Signal | Location |
|---|---|
| Current active jobs | `/admin/jobs?state=active` |
| Recent failures (24h) | Dashboard counter + `/admin/jobs?state=failed` |
| Per-feed health | `/admin/feeds` — `consecutive_failures` column |
| Topic fill coverage | `/admin/topics` — `last_filled_at`, `last_fill_count` |
| Corpus growth | Dashboard sparkline over `research_articles(created_at)` |
| Worker alive | pm2 status + `worker_heartbeats.last_beat_at` |
| Queue depth | Dashboard counter: `SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created','retry','active')` |

### 9.3 Email alert tiers

**Tier 1 — Immediate: worker heartbeat lost.** Hetzner crontab runs `scripts/heartbeat-watchdog.js` every 2 minutes (separate from pg-boss — if the worker is down, pg-boss jobs don't fire). Checks `SELECT max(last_beat_at) FROM worker_heartbeats`. If older than 5 minutes, sends immediate alert via Resend. 30-minute cooldown enforced via `alert_log`.

**Tier 2 — Immediate: failure cluster.** pg-boss scheduled job `detect-failure-clusters` runs every 5 minutes. Groups failed jobs from the last 10 minutes by name; any name with **≥5 failures** triggers an alert. 60-minute cooldown per-job-name via `alert_log`.

**Tier 3 — Daily digest.** pg-boss scheduled job `alert-daily-digest` runs at 08:00 America/New_York (handles DST via `boss.schedule(..., { tz: 'America/New_York' })`). Content: 24h job summary (completed/failed by name), pending candidate count, corpus growth by source, any feeds with `consecutive_failures > 0`, jobs-per-hour sparkline. **Always sent, even on quiet days** — dead-man's-switch for the whole system. Missing digest = something is broken.

### 9.4 Alert fatigue guardrails

- Per-type cooldowns (30min worker, 60min cluster, 1/day digest)
- No alerts on individual job failures — only clusters
- Rate ceiling: `sendAlert()` suppresses if >10 alerts in the last hour; suppression count surfaces in the next digest
- `ALERT_SILENT=1` env flag bypasses sending (for deliberate painful migrations)
- No v1 opt-out of the daily digest

### 9.5 Rate limit enforcement

Lives in the source plugin via `createLimiter(rps)`. Per-source table in §5.3. Not duplicated in handlers or worker config.

## 10. Migration plan

### 10.1 Phase 0 — Parallel to current fill (now)

The existing `fill-pmc-topics.js` run is in flight and writes to `pubmed_articles`. We do **not** apply the rename until it finishes. Implementation work proceeds in parallel:

- Write spec (this doc) + invoke `writing-plans`
- Implementation in a dedicated worktree branched from `main`
- Local testing: pg-boss against Docker Postgres, source plugins tested via `nock` + fixtures, handlers unit-tested
- No production contact

### 10.2 Phase 1 prerequisite — Hetzner DB backup

Before any production schema change, verify (or configure) a nightly automated backup of the self-hosted Supabase Postgres. Acceptance criteria: can point to a timestamped dump file from the previous night, and know the restore procedure. If no automated backup exists today, one is configured here as a blocking prerequisite to phase 1.

### 10.3 Phase 1 — Schema & seed

Runs only after the current fill is done.

1. Merge implementation PR to `main` (Hetzner git pull webhook fires, but new code isn't wired up yet).
2. SSH to Hetzner, apply migrations in order against self-hosted Supabase (as `supabase_admin`):
   - `20260412_pgboss_bootstrap.sql` (or let `boss.start()` create it on first worker boot)
   - `20260412_research_articles_rename_and_columns.sql`
   - `20260412_research_topics_and_candidates.sql`
   - `20260412_discovery_feeds.sql`
   - `20260412_job_progress.sql`
   - `20260412_alerts_and_heartbeat.sql`
   - `20260412_match_evidence_chunks_v2.sql`
3. Run seeds:
   - `node scripts/seed-research-topics.js`
   - `node scripts/seed-discovery-feeds.js`
4. Verify retrieval still works — hand-rolled curl against `/api/chat` asking a retrieval-triggering question. Regression gate for the rename.

### 10.4 Phase 2 — Worker deploy

1. Add `emersus-worker` pm2 entry on Hetzner. `pm2 start ecosystem.config.cjs --only emersus-worker`.
2. Verify `worker_heartbeats.last_beat_at` updates within 30s of start.
3. Add Hetzner crontab entry for `heartbeat-watchdog` every 2 minutes.
4. `node scripts/send-test-alert.js` — confirm email arrives.
5. `node scripts/discover-topics.js` — watch job progress, confirm `topic_candidates` rows appear, confirm `discovery_feeds` watermarks update.

### 10.5 Phase 3 — Cutover

1. New wrappers replace old scripts in the same file paths. Git history preserves the old versions. `--direct` flag is the escape hatch for the first month.
2. Open `/admin/candidates/`, triage the first discovered batch, accept one candidate, watch 7 `ingest-topic-from-source` jobs execute.
3. Enable weekly schedule: `boss.schedule('discovery-weekly', '0 3 * * 1', {}, { tz: 'America/New_York' })`. Loaded on next worker startup.

### 10.6 Phase 4 — First-week validation

- First daily digest email arrives 08:00 America/New_York the day after deploy.
- First weekly `discovery-weekly` fires Monday 03:00 America/New_York.
- First end-to-end topic (discovered → accepted → filled across 7 sources → embedded) serves as the full smoke test.

### 10.7 Rollback

| Phase | Break mode | Rollback |
|---|---|---|
| 1 (schema) | Retrieval breaks | Re-apply old `match_evidence_chunks` from git; if catastrophic, reverse-rename and drop new columns |
| 2 (worker) | Worker crash loops | `pm2 stop emersus-worker`. API stays up — worker is a separate process. |
| 3 (wrappers) | Handler misbehaves | Wrappers keep `--direct` escape hatch for v1 |
| 4 (schedule) | Weekly job misbehaves | `boss.unschedule('discovery-weekly')` via CLI, fix, re-schedule |

### 10.8 Testing strategy

1. **Unit tests per source plugin** — `nock` with captured real responses, assert normalized shape matches `IngestedPaper` / `DiscoveredItem`. Fast, deterministic.
2. **Unit tests per job handler** — in-memory pg-boss, mocked source plugins. Assert progress writes, fanout, error classification.
3. **Integration tests against Docker Postgres** — `docker-compose.test.yml` with postgres:15+pgvector, apply migrations in order, run seed, assert row counts.
4. **Manual end-to-end smoke before phase 1 deploy** — throwaway DB branch, one feed, 5 items, confirm candidate surfaces and can be accepted/ingested end-to-end.
5. **Production smoke after phase 1 deploy** — one topic fill end-to-end, count new `research_articles` rows, confirm embedding.

## 11. File tree (post-implementation)

```
api/
  admin/
    _middleware.js
    candidates.js
    topics.js
    feeds.js
    jobs.js
    alerts.js
  lib/
    alerts.js                            (new)
  emersus/
    workflow.js                          (update: match_evidence_chunks references research_articles)

worker/
  index.js                               (pm2 entry, boots pg-boss, registers jobs)
  context.js                             (handler context helper)
  heartbeat.js                           (30s heartbeat loop)

jobs/
  _registry.js
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

scripts/
  lib/
    run-as-job.js
  sources/
    _types.js
    _registry.js
    _ratelimit.js
    _errors.js
    pubmed.js
    europepmc.js
    biorxiv.js
    medrxiv.js
    sportrxiv.js
    crossref.js
    doaj.js
    rss-sbs.js
    rss-suppversity.js
    rss-mass.js
    rss-sfs.js
    rss-nsca.js
    rss-acsm.js
    rss-journal.js                       (generic journal TOC adapter)
  embed-papers.js                        (wrapper)
  embed-papers-direct.js                 (old logic for --direct fallback)
  backfill-semantic-scholar.js           (wrapper)
  backfill-semantic-scholar-direct.js
  backfill-citation-counts.js            (wrapper, merged into s2-citation-backfill; --direct delegates to backfill-semantic-scholar-direct.js)
  fill-rcr-scores.js                     (wrapper)
  fill-rcr-scores-direct.js
  validate-pubmed-queries.js             (wrapper; reuses existing regex parser for TOPIC_QUERIES in --direct path)
  validate-pubmed-queries-direct.js      (old logic for --direct fallback)
  fill-pmc-topics.js                     (wrapper — still contains TOPIC_QUERIES JS object as disaster-recovery seed; no --direct path, see §8.2)
  fill-pmc-corpus.js                     (DELETED — logic moved to jobs/ingest-topic-from-source.js)
  discover-topics.js                     (wrapper → discovery-weekly)
  seed-research-topics.js                (one-shot, idempotent)
  seed-discovery-feeds.js                (one-shot, idempotent)
  heartbeat-watchdog.js                  (Hetzner cron, every 2min)
  send-test-alert.js                     (wrapper for test emails)
  jobs-tail.js                           (tail any job by ID)
  jobs-list.js                           (list recent jobs from CLI)

admin/
  index.html
  candidates/index.html
  topics/index.html
  feeds/index.html
  jobs/index.html
  alerts/index.html

shared/
  admin.css                              (new — admin-only layout)

supabase/
  20260412_research_articles_rename_and_columns.sql
  20260412_research_topics_and_candidates.sql
  20260412_discovery_feeds.sql
  20260412_job_progress.sql
  20260412_alerts_and_heartbeat.sql
  20260412_match_evidence_chunks_v2.sql

infra/                                   (untracked, local-only)
  ecosystem.config.cjs                   (gain emersus-worker entry)
```

## 12. Env vars added on Hetzner

- `ADMIN_EMAILS` — comma-separated allowlist for `/admin/*` and `/api/admin/*`
- `ALERT_EMAILS` — optional; falls back to `ADMIN_EMAILS` if unset
- `ALERT_SILENT` — optional; `1` suppresses email sends (logs still written)
- `DATABASE_URL` — must be readable by the worker process (already set for API)

## 13. Dependencies added

- `pg-boss` (runtime, ~200 KB, Postgres-native queue)
- `nock` (dev, HTTP fixture mocking for source plugin tests)

No Redis. No new Docker services. No bundler. No framework.

## 14. Open questions (explicitly resolved in brainstorming, preserved for future-me)

- **Q: Why not rename `research_articles` to avoid the DOI-based dual-row pattern?**
  A: Deliberate. DOI dedup at query time in `match_evidence_chunks` is cleaner than store-once/update-source, because preprints and post-review versions have different peer-review status that we want retrieval to reason about.
- **Q: Why not migrate all existing scripts including dev/probe tools?**
  A: Scoped out — dev tools benefit zero from the queue's three properties (scheduling, retries, crash-safety), and the interactive feedback loop is better as plain scripts.
- **Q: Why env-based admin allowlist instead of RBAC?**
  A: One operator, no growth plan toward multi-user admin. RBAC is unused complexity at this scale.
- **Q: Why daily digest always-send?**
  A: Dead-man's-switch. Quiet days = "no failures" confirmation; missing digest = "something is broken". Opt-out would defeat the purpose.
- **Q: Why no webhooks/SSE for admin job progress streaming?**
  A: One operator, one concurrent viewer. 1s polling is cheap and avoids SSE/websocket plumbing.

---

**End of spec.**
