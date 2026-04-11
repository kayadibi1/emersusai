# Multi-source ingestion enablement — design spec

**Date**: 2026-04-11
**Status**: approved (brainstormed in the phase 2 hotfix session)
**Supersedes**: the checkpoint.md open-follow-up #1 ("drop pmid PK, add surrogate id, rewire FK, rewrite RPC") — see Approach Decision below for why we're NOT doing that migration

## Problem

Phase 2 of the topic discovery pipeline deployed 2026-04-11 but shipped with a hard filter restricting ingestion to pubmed only (`SUPPORTED_SOURCE_IDS = ["pubmed"]` in `jobs/ingest-topic.js`). The filter exists because `research_articles.pmid` is `bigint NOT NULL PRIMARY KEY`, and non-pubmed sources don't have PubMed IDs. Removing the filter without addressing the PK constraint would cause `ingest-topic-from-source.js` to silently drop every non-pubmed paper via its null-pmid skip branch.

Seven source adapters are already coded, tested, and self-register with the ingestion registry: `pubmed`, `europepmc`, `biorxiv`, `medrxiv`, `sportrxiv`, `crossref`, `doaj`. Only one (`pubmed`) is actually routed traffic. The others are dead code.

The broader goal is to expand retrieval coverage beyond pubmed's ~42M records to include open-access aggregators (OpenAlex, OpenAIRE, CORE), preprint servers (biorxiv, medrxiv, sportrxiv), systematic review indexes (Epistemonikos), and a high-quality metadata graph (Semantic Scholar). The total addressable corpus grows from ~42M to roughly 500M+ deduplicated paper-like records.

## Goals

1. Enable actively-routed ingestion from 10 paper-content sources: pubmed (already live and unchanged), europepmc, biorxiv, medrxiv, sportrxiv (all four activated by lifting the filter), OpenAlex, Semantic Scholar, Epistemonikos, OpenAIRE, CORE (all five new adapters written in this work). `crossref` and `doaj` remain registered in the plugin list but are not routed traffic — see the "Registered but deprioritized" section for why.
2. Preserve the existing retrieval path at the schema level — `match_evidence_chunks` RPC and `evidence_chunks` FK semantics are untouched, `retrieveDatabaseEvidence.js`'s core query path works unchanged (`retrieveDatabaseEvidence.js` does get one new helper function added for cross-source dedup, but no changes to how it queries research_articles or evidence_chunks)
3. Zero downtime during rollout — no maintenance window, no ALTER TABLE on the 20 GB `evidence_chunks` table
4. Deduplicate papers that appear in multiple sources (e.g., a paper indexed in both pubmed and OpenAlex) at retrieval time, without corrupting the raw ingestion record
5. Keep the design extensible so additional source adapters (PEDro, PMC full-text, ClinicalTrials.gov) can be added later as pure code changes without another round of schema work

## Non-goals

- **Column renames or PK changes.** `research_articles.pmid` stays `NOT NULL PRIMARY KEY bigint`. The column name is now misleading for non-pubmed rows but this is a naming debt, not a correctness bug. A future cosmetic `ALTER TABLE ... RENAME COLUMN pmid TO article_id` migration can happen quietly if it ever matters.
- **PMC full-text retrieval.** Tracked as a separate follow-up. It's a retrieval-quality multiplier, not a coverage addition, and needs a different schema (long-form chunking, different vector strategy).
- **ClinicalTrials.gov.** Trials are a different content type (protocols, enrollment criteria, arms) and mixing them into the paper-shaped `research_articles` table would force NULL-heavy schema compromises. Tracked as a phase-4 follow-up.
- **PEDro (Physiotherapy Evidence Database).** Requires a formal data-sharing agreement with PEDro's data team. Can be added in a future session once access is granted.
- **Guideline documents (WHO, NICE, USPSTF, ACSM position stands).** Manual curation, not an API ingestion target.
- **Podcast/YouTube/blog transcripts.** Different credibility tier; mixing them with peer-reviewed literature in a single retrieval pool would corrupt trust scoring. Needs a credibility-tier schema first.
- **Reintroducing DOI dedup into the `match_evidence_chunks` RPC.** The v2 attempt at this triggered a 30s planner pathology, fixed by the hotfix. We're doing dedup in the JS layer (`retrieveDatabaseEvidence.js`) instead, which is simpler and dodges the planner issue entirely.
- **The citation backfill pipeline** for Semantic Scholar citations (`jobs/s2-citation-backfill.js`). Already exists, already works, untouched by this spec.

## Approach decision: sequence vs migration

The checkpoint follow-up originally proposed a full schema migration: drop the pmid PK, add a surrogate `id bigint generated always as identity`, make pmid nullable + UNIQUE, rewire `evidence_chunks.pmid_fkey` to the new id (or add an `article_id` FK column and backfill 1.19M rows), rewrite `match_evidence_chunks` to join on the new column, update `retrieveDatabaseEvidence.js` to query by the new column.

That approach is **rejected** here in favor of a simpler alternative: allocate synthetic pmids for non-pubmed rows from a dedicated sequence starting at 10^10.

### Comparison

| criterion | full migration (rejected) | sequence approach (chosen) |
|---|---|---|
| SQL changes | Drop PK, add column, rewire FK, backfill 1.19M rows, rewrite RPC | `CREATE SEQUENCE` |
| JS changes | Rewrite ingestion handler, rewrite retrieval query, rewrite citation layer | ~10 lines in handler + ~15 lines in citation renderer |
| Downtime | 5-15 min maintenance window | 0 |
| Risk to 20 GB `evidence_chunks` + HNSW vector index | Must touch the FK | Untouched |
| Rollback | Requires reverse transaction or full re-migration | Revert JS change + drop sequence |
| Time to implement | Full session + rehearsal + maintenance window | ~1-2 hours of coding + tests |
| Satisfies the functional requirement | ✓ | ✓ |

### Tradeoffs of the sequence approach

Two real costs, both acceptable:

1. **Semantic misnaming**: the column is called `pmid` but stores non-PubMed IDs for non-pubmed rows. A developer reading `research_articles.pmid = 10000000042` has to check `source` to interpret it. This is naming debt, not a bug. Mitigated by (a) code comments at the sequence definition and the handler site, (b) an optional future cosmetic rename, (c) the `source` column being the authoritative discriminator for anything that cares.

2. **Citation display layer must branch**: the chat UI currently renders citations as "PMID: 12345". For synthetic pmids that produces nonsense ("PMID: 10000000042"). Fix: the renderer branches on `source` and produces `"<source>: <doi or external_id>"` for non-pubmed rows. ~15 lines in `shared/emersus-renderer.js` plus updates to any direct callers.

### Why the sequence works

- Real PubMed IDs are ~42M as of 2026. They grow ~1M/year. Starting synthetic IDs at 10^10 (10 billion) provides ~60 years of collision-free headroom. Expanding to 10^15 would provide ~200,000 years if paranoia demands it; 10^10 is enough.
- `bigint` fits both real and synthetic IDs comfortably (max `bigint` is 2^63 - 1 ≈ 9.2 × 10^18).
- `evidence_chunks.pmid` FK semantics are preserved — the column still stores a bigint that exists as a PK in `research_articles`. The FK has no idea whether the bigint means "real PMID" or "synthetic allocation", and doesn't care.
- `match_evidence_chunks` RPC is completely untouched — it joins on pmid, pmid is still a bigint PK, the join is still valid.
- `retrieveDatabaseEvidence.js`'s query path to `research_articles` is unchanged — it does `.in("pmid", pmids)` and the pmids (real or synthetic) are just bigints. It does gain a new cross-source dedup helper function, but that's a pure post-processing step added after the existing join, not a schema-driven change.
- All existing indexes, stats, and query plans continue to work unchanged.

## Schema change

Single new migration file: `supabase/20260412_research_articles_synthetic_pmid_sequence.sql`

```sql
-- Synthetic PMID allocator for non-pubmed ingestion sources.
-- Lets us keep research_articles.pmid as bigint NOT NULL PRIMARY KEY
-- while still ingesting papers from europepmc, biorxiv, openalex, etc.
-- Starts at 10^10 to leave 60+ years of collision-free headroom before
-- brushing real PubMed IDs (currently ~42M, growing ~1M/year).
CREATE SEQUENCE IF NOT EXISTS public.research_articles_synthetic_pmid_seq
  START WITH 10000000000
  INCREMENT BY 1
  NO CYCLE;

GRANT USAGE, SELECT ON SEQUENCE public.research_articles_synthetic_pmid_seq
  TO supabase_admin, postgres, authenticated, service_role;

COMMENT ON SEQUENCE public.research_articles_synthetic_pmid_seq IS
  'Synthetic pmid allocator for non-pubmed sources. See docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md';
```

Applied via `infra/apply-migrations.sh` against the Hetzner Postgres as `supabase_admin`. Runs in milliseconds. No table locks. Idempotent (`IF NOT EXISTS`).

## Ingestion handler changes

### `jobs/ingest-topic-from-source.js`

Replace the current pmid-derivation block with:

```js
// Extract the real PubMed ID when the source is pubmed AND the externalId
// is numeric. Everything else gets a synthetic pmid allocated from the
// sequence, which keeps research_articles.pmid NOT NULL happy without
// requiring a schema migration. See
// docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md
// for the rationale.
const isPubmedSource = plugin.id === "pubmed" || paper.source === "pubmed";
const realPmid = isPubmedSource && Number.isFinite(Number(paper.externalId))
  ? Number(paper.externalId)
  : null;

let pmidVal = realPmid;
if (pmidVal == null) {
  const { rows } = await sql`
    SELECT nextval('research_articles_synthetic_pmid_seq')::bigint AS id
  `;
  pmidVal = Number(rows[0].id);
}
```

Key properties:
- The existing `INSERT ... ON CONFLICT (pmid) DO NOTHING` keeps working. Synthetic pmids are monotonically allocated and never collide with existing rows (on conflict is effectively a no-op for the synthetic path).
- The `source_metadata` jsonb blob receives the source's real `externalId` (DOI, OSF ID, biorxiv DOI, etc.) via the existing spread of `paper.sourceMetadata`. No change needed.
- The `external_id` column on `research_articles` already stores `paper.externalId` directly — retrieval code can use that for non-pubmed rows.

### `jobs/ingest-topic.js`

Replace the hard pubmed-only filter with a feature-flag gated filter that excludes deprioritized sources:

```js
// OLD:
const SUPPORTED_SOURCE_IDS = ["pubmed"];
// ... later ...
const sourceIds = requested.filter(id =>
  SUPPORTED_SOURCE_IDS.includes(id) && available.includes(id)
);

// NEW:
const MULTI_SOURCE_ENABLED = process.env.MULTI_SOURCE_ENABLED === "true";
const LEGACY_SUPPORTED_SOURCE_IDS = ["pubmed"];
// Sources that are registered as plugins but should not receive fanout
// traffic: metadata-only sources without abstracts (crossref, doaj) and
// any source explicitly disabled via the INGEST_DISABLED_SOURCES env var.
const DEPRIORITIZED_SOURCE_IDS = ["crossref", "doaj"];
const disabledSources = (process.env.INGEST_DISABLED_SOURCES || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ... later in the handler ...
const filterCandidate = (id) =>
  available.includes(id) &&
  !DEPRIORITIZED_SOURCE_IDS.includes(id) &&
  !disabledSources.includes(id);

const sourceIds = MULTI_SOURCE_ENABLED
  ? requested.filter(filterCandidate)
  : requested.filter(id => LEGACY_SUPPORTED_SOURCE_IDS.includes(id) && filterCandidate(id));
```

Behavior: when `MULTI_SOURCE_ENABLED=true`, fanout goes to every registered source the caller requests, except deprioritized sources (crossref, doaj) and sources disabled via `INGEST_DISABLED_SOURCES`. When the flag is off or unset, behavior is identical to the pre-change pubmed-only path.

## Registered source adapters

### New adapters to be written (5)

All follow the existing pattern in `scripts/sources/*.js`: export a default `ingestion` object with an `id`, `name`, `peerReviewed`, and `async *fetchPapers(query, opts)` generator. Self-register via `registerIngestion()` at module load. Add a side-effect import in `jobs/_registry.js`.

| file | upstream | auth | rate limit | existing key? |
|---|---|---|---|---|
| `scripts/sources/openalex.js` | `https://api.openalex.org/works` | polite pool via `mailto=info@emersus.ai` query param | 10 req/sec polite, self-limit to 8 RPS | none required |
| `scripts/sources/semantic-scholar.js` | `https://api.semanticscholar.org/graph/v1/paper/search` | `x-api-key` header | 10 req/sec with key, self-limit to 8 RPS | `SEMANTIC_SCHOLAR_API_KEY` already set in `~/app/.env` — thin adapter wraps existing `scripts/lib/semantic-scholar.js` |
| `scripts/sources/epistemonikos.js` | `https://api.epistemonikos.org/v1/search/documents` | API key in header | ~2 RPS self-limit | `EPISTEMONIKOS_API_KEY` — **user obtains via email to Epistemonikos** |
| `scripts/sources/openaire.js` | `https://api.openaire.eu/search/publications` | none | ~2 RPS self-limit | none required |
| `scripts/sources/core.js` | `https://api.core.ac.uk/v3/search/works` | Bearer token | 10 RPS free tier | `CORE_API_KEY` — **user obtains via self-service registration at core.ac.uk** |

Each adapter:
- Uses `fetchWithTimeoutAndUA` from `scripts/sources/_http.js` (same HTTP wrapper pubmed uses)
- Creates its own `createLimiter(N)` at module load — the race-fixed limiter from the phase 2 hotfix
- Emits normalized `IngestedPaper` objects matching the existing shape (`externalId`, `source`, `title`, `abstract`, `doi`, `publishedAt`, `journal`, `authors`, `peerReviewed`, `sourceMetadata`)
- Respects `opts.target` (max papers to yield) and `opts.signal` (abort)
- Throws `SourcePermanentError` for "query returned 0 results" and `SourceTransientError` for rate-limit / network errors (these map to pg-boss retry behavior)

### Existing adapters activated (4)

No code changes — these are already coded, tested, and registered. They just start receiving traffic when the `SUPPORTED_SOURCE_IDS` filter is lifted.

| file | upstream | existing state |
|---|---|---|
| `scripts/sources/europepmc.js` | `https://www.ebi.ac.uk/europepmc/webservices/rest/search` | coded, unit tests pass, registers on import |
| `scripts/sources/biorxiv.js` | `https://api.biorxiv.org/details/biorxiv` | coded, unit tests pass, shares limiter with medrxiv via `_shared-limiters.js` |
| `scripts/sources/medrxiv.js` | `https://api.biorxiv.org/details/medrxiv` | coded, unit tests pass |
| `scripts/sources/sportrxiv.js` | OSF preprints API | coded, unit tests pass |

### Registered but deprioritized (2)

`crossref.js` and `doaj.js` are metadata-only — they return DOIs and bibliographic stubs but no abstracts. Without abstracts, there's nothing for the embedding pipeline to chunk, so papers ingested via these sources would have zero `evidence_chunks` and be invisible to retrieval. Kept registered in case they're useful for DOI lookups or future content-type expansion. Not routed traffic by `ingest-topic`'s fanout.

## Cross-source dedup

The same paper will show up from multiple sources. Example: a paper with DOI `10.1123/jsep.2024-0042` might be indexed by pubmed, europepmc, OpenAlex, and Semantic Scholar — four rows in `research_articles`, each with a different pmid (real or synthetic) but the same DOI.

**Dedup at retrieval time in JS**, not at insert time. Implementation in `api/emersus/retrieveDatabaseEvidence.js`:

```js
// After the match_evidence_chunks RPC returns and we've joined to
// research_articles rows, group by DOI and keep the highest-similarity
// chunk per DOI group. Papers without a DOI are kept as-is (fall back
// to (source, external_id) as the dedup key).
function dedupByDoi(matches) {
  const byDoi = new Map();
  const withoutDoi = [];
  for (const m of matches) {
    const doi = m.article?.doi;
    if (!doi) { withoutDoi.push(m); continue; }
    const existing = byDoi.get(doi);
    if (!existing || m.similarity > existing.similarity) {
      byDoi.set(doi, m);
    }
  }
  return [...byDoi.values(), ...withoutDoi];
}
```

Called after the join, before returning to rerank. ~15 lines, no SQL changes.

**Why not an insert-time DOI unique constraint**:
- DOIs change over time — a preprint on biorxiv gets a preprint DOI, the same paper when published in a journal gets a new journal DOI. An insert-time unique would reject the second ingestion or force an upsert with ambiguous semantics.
- Some sources don't return DOIs reliably (preprint servers sometimes omit them).
- Different sources return slightly different metadata for the same paper (different author name formats, different abstract tokenizations). Preserving all variants during ingestion makes it possible to pick the "best" variant at retrieval time and to debug source quality independently.
- Retrieval-time dedup is a pure JS change with no schema implications and no lock contention.

**Why not fix it in `match_evidence_chunks` (the SQL RPC)**:
- The v2 attempt at this exact thing (window function over `PARTITION BY doi ORDER BY similarity DESC`) triggered a 30s planner pathology that forced the phase 2 hotfix. The single-CTE shape that survived the hotfix doesn't have a natural place to dedupe without risking the same regression.
- JS dedup runs on a small result set (typically 50-100 matches from the initial RPC) — trivial overhead.

## Citation display

In `shared/emersus-renderer.js` (or whichever module formats citations for the chat UI):

```js
function formatCitationId(article) {
  if (!article) return null;
  if (article.source === "pubmed" && article.pmid < 10000000000) {
    return `PMID: ${article.pmid}`;
  }
  if (article.doi) {
    return `${article.source}: ${article.doi}`;
  }
  return `${article.source}: ${article.external_id}`;
}
```

The `article.pmid < 10000000000` check is defensive — it guarantees we never display a synthetic pmid as a "PMID: ..." label even if something upstream misclassified the source. Real PubMed IDs are always below this threshold.

Update any callers that construct `"PMID: ..."` labels directly to route through `formatCitationId`. There are approximately 2-3 such sites based on a grep of the rendering code.

## Rate limiting

Each adapter's limiter is per-process and per-source. The worker runs one process so they share the same module instance. There's no cross-source rate coordination because upstream APIs are independent — pubmed's NCBI quota doesn't care about openalex's polite pool.

Shared limiters (via `_shared-limiters.js`) exist only for sources that share upstream infra:
- biorxiv + medrxiv share `api.biorxiv.org` → shared 1 RPS limiter (existing)
- If we discover other shared-backend sources later, extend `_shared-limiters.js` following the same pattern

The limiter implementation is the race-free version shipped in the phase 2 hotfix. No further limiter work is needed for this spec.

## Testing strategy

### Unit tests (per adapter)

Each new adapter gets a test file at `tests/unit/sources/<name>.test.js` that:
- Loads a fixture response (stored in `tests/fixtures/<source>/*.xml` or `*.json`)
- Mocks the upstream HTTP call via `nock`
- Calls `adapter.fetchPapers(query, {target: N})` and asserts on the yielded `IngestedPaper` shape
- Verifies the adapter self-registers in the registry

Follows the pattern already established in `tests/unit/sources/pubmed.test.js`, `biorxiv.test.js`, etc.

### Integration test

A new `tests/integration/multi-source-e2e.test.js` that:
- Seeds a temporary `research_topics` row
- Enqueues an `ingest-topic` job with a small `target: 5` to avoid hammering real APIs
- Waits for fanout to all registered sources
- Asserts each source's job reaches `completed` state
- Asserts at least N rows land in `research_articles` with distinct `source` values
- Cleans up the temporary topic + rows

Runs against a staging DB or via transaction rollback on prod (to avoid leaving test data in the corpus).

### Manual smoke test

After deploy, on Hetzner:
- `node scripts/lib/run-as-job.js ingest-topic '{"topicId":"1","sourceIds":["openalex"]}'` for each new source individually
- Verify synthetic pmids get allocated (query `SELECT source, min(pmid), max(pmid) FROM research_articles GROUP BY source`)
- Verify no source has >20% job failure rate

## Rollout strategy

### Feature flags (implemented in the handler section)

The two env flags that gate multi-source ingestion are defined in the handler (see "Ingestion handler changes → `jobs/ingest-topic.js`" above). Summary of their rollout semantics:

- **`MULTI_SOURCE_ENABLED`** — set to `"true"` in `~/app/.env` to flip from pubmed-only to multi-source fanout. Unset or any other value keeps behavior identical to the pre-change pubmed-only path. Gives us a revertible dial during the initial rollout: if any source misbehaves in prod we can flip the flag and immediately revert to pubmed-only without a deploy.

- **`INGEST_DISABLED_SOURCES`** — comma-separated list of source IDs to exclude from fanout even when `MULTI_SOURCE_ENABLED=true`. Used if one specific source is hitting rate limits or returning garbage data while others are fine. Example: `INGEST_DISABLED_SOURCES="epistemonikos,core"` disables those two while leaving the rest enabled.

Both flags are read at worker boot. Changing them requires `pm2 restart emersus-worker --update-env` to take effect.

### Deployment sequence

1. Merge the spec + plan to main (docs only, no code)
2. Write + test all 5 new adapters in a feature branch
3. Run the sequence migration against prod (idempotent, zero-downtime)
4. Merge the feature branch to main with `MULTI_SOURCE_ENABLED=false` by default
5. Deploy to Hetzner via webhook auto-pull + pm2 restart
6. Verify everything still works in pubmed-only mode (no regression)
7. Set `MULTI_SOURCE_ENABLED=true` in `~/app/.env`, `pm2 restart emersus-worker --update-env`
8. Smoke-test each new source individually via `run-as-job.js`
9. Watch `pgboss.job` state and `research_articles` row growth for 24h
10. Document findings, close the follow-up

### Rollback

At any point in steps 7-9, flip `MULTI_SOURCE_ENABLED=false` and `pm2 restart emersus-worker --update-env`. Ingestion reverts to pubmed-only instantly. Rows already ingested from other sources remain in the DB (they're not harmful — they're just untouched by retrieval dedup and have valid synthetic pmids).

To fully revert the schema change, drop the sequence:
```sql
DROP SEQUENCE IF EXISTS public.research_articles_synthetic_pmid_seq;
```
Only needed if we decide the sequence approach was wrong and want to go back to pubmed-only permanently. Ingested non-pubmed rows would need to be deleted first.

## Monitoring

### What to watch

During the first 24 hours after enabling multi-source:

1. **Per-source job success rate** — query `pgboss.job` grouped by `data->>'sourceId'` and `state`. Alert if any source has >20% failure rate over 1 hour.
2. **Per-source row growth** — `SELECT source, count(*) FROM research_articles WHERE created_at > now() - interval '1 hour' GROUP BY source`. Validates each source is actually producing inserts.
3. **Synthetic pmid allocation rate** — `SELECT last_value FROM research_articles_synthetic_pmid_seq`. Growing at a reasonable rate; not growing faster than inserts (would indicate orphan allocation).
4. **Worker heartbeat + error log** — existing `heartbeat-watchdog` already alerts on stale heartbeats. Error log should show source-specific warnings but no unhandled throws.
5. **Retrieval quality** — a few test prompts ("creatine loading", "periodization for hypertrophy", "knee rehab after ACL") should return results that include non-pubmed sources in the citations. Subjective quality check.

### What triggers rollback

- Any source >50% failure rate over 15 minutes → disable that source via `INGEST_DISABLED_SOURCES`
- Any unhandled exception from an adapter crashing the worker → disable that source + investigate
- Retrieval latency regression >2x baseline → disable multi-source via `MULTI_SOURCE_ENABLED=false` and investigate (likely the JS dedup is not O(1) and needs optimization)
- Disk usage spike on `/var/lib/postgresql/data` beyond expected growth → pause ingestion and investigate duplicate/garbage data

## Out of scope (explicit)

- PMC full-text retrieval (deferred as separate follow-up)
- ClinicalTrials.gov ingestion (deferred as phase 4)
- PEDro ingestion (blocked on data-sharing agreement)
- Guideline document curation (manual, not API-driven)
- Podcast / YouTube / blog transcript ingestion (needs credibility tier schema first)
- Reintroducing DOI dedup in `match_evidence_chunks` RPC (doing it in JS instead)
- Renaming `research_articles.pmid` to `article_id` (cosmetic, future)
- Changes to `jobs/s2-citation-backfill.js` (already exists and works)
- Changes to `match_evidence_chunks` RPC (untouched)
- Changes to `retrieveDatabaseEvidence.js` beyond adding the dedup function (no schema-driven changes)
- Changes to `evidence_chunks` schema or indexes (untouched)

## Risks + mitigations

| risk | mitigation |
|---|---|
| A new adapter has a bug that corrupts `research_articles` rows | Each adapter has unit tests against fixtures before it ships. Per-source disable flag allows instant isolation. Insert uses `ON CONFLICT DO NOTHING` so retries don't double-insert. |
| Upstream API changes break an adapter | `_http.js` classifies errors as `SourceTransientError` (retried by pg-boss) vs `SourcePermanentError` (job fails permanently without retry). Transient = recoverable automatically; permanent = alert fires via existing `detect-failure-clusters` cron. |
| Synthetic pmid allocation races produce duplicates | Sequences in Postgres are atomic and concurrency-safe by design. `nextval` never returns the same value twice within a database cluster. Tested behavior since Postgres 7.1. |
| Synthetic pmid collision with a future real PMID | Starting at 10^10 gives ~60 years of collision-free headroom at PubMed's current growth rate. If paranoid, we could start at 10^15 instead — no cost to do so. |
| Retrieval-time dedup is slow on large result sets | Dedup is O(N) where N is the RPC result size, typically 50-100 matches. Trivial. If it ever becomes a bottleneck, the dedup can move back into the RPC via a corrected window function. |
| Cross-source DOI dedup misses variants (preprint DOI vs published DOI) | Acceptable. Users will occasionally see both a preprint and a published version in their results. We can add smarter dedup (e.g., title fuzzy match, same-first-author) in a future iteration. |
| Env flag `MULTI_SOURCE_ENABLED` gets accidentally set to `true` in an unrelated deploy | Flag defaults to `false` if unset or any value other than exactly `"true"`. Explicit opt-in only. Git-tracked `.env.example` documents the default. |
| Epistemonikos or CORE API key obtaining is delayed | Adapters gate themselves on `process.env.<SOURCE>_API_KEY` presence at module load time. Missing key = adapter throws a `SourcePermanentError` with a clear "set env var X" message. The other sources continue working. |
| A new source rate limits harder than expected under production load | Each adapter has its own limiter at a conservative rate. Per-source disable flag allows quick mitigation. Pg-boss retries absorb transient rate limit errors. |
| Disk growth from 5 new sources fills `~/backups` before the 3-day retention window cleans up | Current disk is 301 GB total, 220 GB free after initial backup. Even if the corpus doubles from new sources, 3 × 16 GB = 48 GB well under headroom. Monitor via the existing `backup-db.sh` disk-free check. |

## Operational prerequisites

The user (Sidar) must complete these before the implementation plan can execute:

1. ✅ **OpenAlex polite-pool email** — confirmed as `info@emersus.ai`. No action required beyond this confirmation.
2. ✅ **Semantic Scholar API key** — already set in `~/app/.env` as `SEMANTIC_SCHOLAR_API_KEY`. No action.
3. ⏳ **Epistemonikos API key** — email https://www.epistemonikos.org/en/about_us/contact_us requesting API access. Response time: up to a week.
4. ⏳ **CORE API key** — register at https://core.ac.uk/services/api, create key in dashboard. Instant, self-service.
5. ❌ **PEDro data-sharing agreement** — explicitly out of scope for this spec. Handle separately if desired.

Items 3 and 4 are the blocking prerequisites for their respective adapters to actually ingest. The implementation plan will accommodate this by writing the adapters first (can be done without keys using fixture-based tests), merging them in disabled state, and enabling each source individually as keys arrive.

## Success criteria

The work is complete when:

1. The sequence migration is applied to prod and non-pubmed sources can insert into `research_articles`
2. All 5 new adapters (OpenAlex, Semantic Scholar, Epistemonikos, OpenAIRE, CORE) have unit tests passing in CI
3. All 10 actively-routed adapters — pubmed (unchanged), europepmc, biorxiv, medrxiv, sportrxiv (reactivated), OpenAlex, Semantic Scholar, Epistemonikos, OpenAIRE, CORE (newly written) — are registered and `ingest-topic` successfully fans out to each one when `MULTI_SOURCE_ENABLED=true`
4. A manual smoke test for each source confirms papers get inserted with correct `source` + `external_id` + synthetic-or-real pmid
5. `retrieveDatabaseEvidence.js` includes the DOI dedup function and unit tests for it pass
6. `shared/emersus-renderer.js` renders non-pubmed citations correctly
7. `MULTI_SOURCE_ENABLED=true` is set in prod `~/app/.env` and the worker is restarted
8. 24 hours of post-enablement monitoring shows <5% source-level job failure rate across all sources
9. A memory entry is added documenting the sequence approach so the naming debt is tracked
10. The checkpoint.md follow-up #1 is marked resolved
