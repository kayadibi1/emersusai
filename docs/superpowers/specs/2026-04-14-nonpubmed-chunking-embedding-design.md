# Non-pubmed chunking + embedding backfill — design spec

**Date:** 2026-04-14
**Status:** Approved, pending plan
**Author:** Claude (brainstorming session 2026-04-14)

## Problem

Phase-3 multi-source enablement (2026-04-12) shipped 8 non-pubmed ingestion adapters that populate `research_articles` with synthetic-pmid rows (≥ 10^10). It did **not** port the chunking step. Pubmed rows are chunked into `evidence_chunks` via `scripts/import-pubmed.js` + `scripts/chunk-structured-abstracts.js`; non-pubmed rows never enter `evidence_chunks` at all.

As of 2026-04-14:

- `research_articles`: 1,134,041 rows (pubmed 415k + non-pubmed 719k).
- `evidence_chunks`: 1,189,776 rows, **all** with real pubmed pmids (< 10^10).
- Zero synthetic-pmid chunks → 719k non-pubmed rows are silently unretrievable via `match_evidence_chunks`.

This is a retrieval-quality regression disguised as a successful multi-source deploy. 63% of the corpus is invisible to the chat pipeline.

## Goals

1. Bring all 719k existing non-pubmed rows into `evidence_chunks` + embed them.
2. Ensure all future non-pubmed ingests chunk + embed automatically.
3. Defend against recurrence of "silent pipeline skip" via a GC backstop.
4. Keep the change source-agnostic — same code path handles any future adapter.

Non-goals:

- Richer chunk_types (MeSH-like fields, openalex concepts, etc.) — considered and deferred (YAGNI).
- Re-chunking existing pubmed rows — untouched by this work.
- Source-specific retrieval boosts — separate concern.

## Design decisions locked during brainstorming

1. **Chunk scope:** `title` + flat `abstract` only. No structured sections (no non-pubmed row has `abstract_sections`). Matches pubmed's unsectioned path. Downstream retrieval needs zero changes.
2. **Where chunking happens:** inline in `jobs/ingest-topic-from-source.js` (forward-going) + a nightly `chunk-articles-gc` pg-boss cron job (backstop + backfill mechanism).
3. **Rows without abstracts** (~26k mostly S2): **skipped entirely**. No chunks, no tracker column. GC query filters by `abstract IS NOT NULL AND length(abstract) >= 50`, so skipped rows are ignored but stay re-scan candidates cheaply (index-backed query, ~26k rows is trivial).
4. **Rollout:** staged canary on sportrxiv (325 rows, ~$0.001) → verify end-to-end → unleash on full 719k (~$3, ~2h).

## Architecture

One source-agnostic helper + one new pg-boss handler + one CLI wrapper + one surgical edit to the existing ingest handler. The helper is the only new piece of business logic; everything else wires it into existing infrastructure.

```
┌───────────────────────────────────────────────────┐
│ scripts/lib/build-evidence-chunks-generic.js      │◄──── new helper, pure,
│   buildGenericChunks({ pmid, title, abstract,     │      unit-testable
│                        source, external_id, doi })│
│   → [{pmid, chunk_type, content, metadata}]       │
└───────────────────────────────────────────────────┘
        ▲                               ▲
        │                               │
┌───────┴─────────────┐       ┌─────────┴─────────────┐
│ jobs/ingest-        │       │ jobs/                 │
│  topic-from-source  │       │  chunk-articles-gc    │◄── new handler,
│  .js (existing)     │       │  .js (new)            │    cron 0 7 * * * UTC
│                     │       │                       │
│ after INSERT rows:  │       │ SELECT 1000 rows w/   │
│   chunks = ...      │       │   abstract but no     │
│   INSERT chunks     │       │   evidence_chunks     │
│   boss.send(        │       │ chunks + INSERT       │
│     "embed-batch")  │       │ boss.send("embed-     │
│                     │       │   batch")             │
└─────────────────────┘       └───────────────────────┘
                                        ▲
                                        │
                           ┌────────────┴────────────┐
                           │ scripts/                │◄── new CLI, runs the
                           │  backfill-chunks.js     │    handler in --direct
                           │  [--source=X]           │    mode (bypasses
                           │  [--limit=N]            │    pg-boss for pacing)
                           │  [--loop] [--dry-run]   │
                           └─────────────────────────┘
```

The existing `embed-batch` handler picks up rows with `embedding IS NULL` and needs zero changes.

## Components

### `scripts/lib/build-evidence-chunks-generic.js` (new, ~60 LOC)

Pure helper, no DB or OpenAI imports. Unit-testable in plain node.

**Signature:**
```js
export function buildGenericChunks({ pmid, title, abstract, source, external_id, doi })
  → Array<{ pmid, chunk_type, content, metadata }>
```

**Behavior:**
- **Gate on abstract presence.** If `abstract` is missing or shorter than 50 chars, returns `[]` (no title chunk, no chunks at all). Matches the "skip rows without abstracts entirely" decision.
- If the abstract is usable:
  - Emits `{ chunk_type: 'title', content: title }` if `title` present and non-empty.
  - Emits `{ chunk_type: 'abstract', content: abstract }`.
  - If abstract exceeds `MAX_ABSTRACT_CHUNK_CHARS` (2400), sentence-boundary split into multiple `abstract` chunks, capped at 12 to match pubmed path.
- All chunks carry `metadata: { source, external_id, doi }` (jsonb) for retrieval-time debugging.
- Whitespace normalized (`\s+` → single space). Null bytes stripped (S2 payload quirk).

### `jobs/chunk-articles-gc.js` (new, ~80 LOC)

New pg-boss handler. Registered in `jobs/_registry.js`. Scheduled via `worker/index.js` cron table.

**Payload:** `{ limit?: 1000, source?: string }`

**Query:**
```sql
SELECT pmid, title, abstract, source, external_id, doi
FROM research_articles
WHERE abstract IS NOT NULL
  AND length(abstract) >= 50
  AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = research_articles.pmid)
  [AND source = $1]       -- if payload.source provided
ORDER BY pmid
LIMIT $2                  -- payload.limit, default 1000
```

**Flow:**
1. Fetch rows via query above.
2. For each row: `chunks = buildGenericChunks(row)`. Accumulate.
3. Batch-insert `chunks` into `evidence_chunks` at 500 per statement.
4. If any chunks were inserted, `boss.send("embed-batch", { limit: 2000 })` once.
5. Return `{ rowsProcessed, chunksInserted }` (for log visibility).

**Error handling:** wraps each row's chunk-build + insert in try/catch. Failures are logged + counted but do not abort the tick. Bad rows stay re-scan candidates; good rows proceed.

**Concurrency:** singleton via pg-boss `singletonKey = 'chunk-articles-gc'`. If a tick runs > 24h (impossible in practice — 1000-row tick is ~2s), next cron fire is skipped.

**Cron schedule:** `0 7 * * *` UTC (03:00 ET). Same family as `cleanup-job-progress`.

### `scripts/backfill-chunks.js` (new, ~40 LOC)

CLI wrapper that calls the `chunk-articles-gc` handler in `--direct` mode (runs the handler function directly, bypassing pg-boss enqueue/fetch for faster pacing during bulk backfill). Follows the existing `--direct` pattern from `scripts/embed-evidence.js`.

**Flags:**
- `--source=<name>` — restrict to one source. Used for canary.
- `--limit=<N>` — rows per tick, default 1000.
- `--loop` — keep calling handler until a tick inserts 0 chunks (backlog empty).
- `--dry-run` — print `SELECT count(*)` for the GC query, no writes.

**Exit codes:** 0 on success, non-zero on first unrecoverable error.

### `jobs/ingest-topic-from-source.js` (existing, +~10 LOC)

Single surgical edit. After the `INSERT ... ON CONFLICT DO NOTHING RETURNING pmid` block:

```js
if (insertedRows.length > 0) {
  const allChunks = [];
  for (const row of insertedRows) {
    allChunks.push(...buildGenericChunks(row));
  }
  if (allChunks.length > 0) {
    try {
      await sql.from('evidence_chunks').insert(allChunks);  // or batched helper
    } catch (err) {
      logger.warn({ err }, 'chunk-insert failed; GC will retry');
      // do NOT rethrow — ingest stays green, GC covers the miss
    }
  }
}
// existing boss.send("embed-batch") line stays
```

No change to the pubmed path (which continues going through `scripts/import-pubmed.js`'s chunker). Non-pubmed flows through `ingest-topic-from-source.js` exclusively, so the branch is clean.

## Data flow

### Forward-going (new ingests)
```
ingest-topic-from-source handler
  ├─ INSERT research_articles (ON CONFLICT DO NOTHING)
  ├─ For each inserted row: buildGenericChunks() → batch INSERT evidence_chunks
  └─ boss.send("embed-batch", { limit: 1000 })
       └─ embed-batch handler
            ├─ SELECT chunks WHERE embedding IS NULL (batched 50)
            ├─ OpenAI text-embedding-3-small
            └─ UPDATE evidence_chunks SET embedding = ...
```

### GC / backfill
```
scripts/backfill-chunks.js --loop [--source=X] [--limit=N]
  └─ while (chunks_inserted > 0):
       chunk-articles-gc handler (run direct, not via pg-boss)
         ├─ SELECT <=limit research_articles lacking chunks
         ├─ buildGenericChunks() × N
         ├─ INSERT evidence_chunks (batched at 500)
         └─ boss.send("embed-batch", { limit: 2000 })
```

### Retrieval (unchanged, verified)
```
retrieveDatabaseEvidence.js
  ├─ OpenAI embed query
  ├─ match_evidence_chunks v2 RPC (source-agnostic; all pmids eligible)
  ├─ dedupByDoi() — collapses cross-source duplicates (phase 3, already in place)
  └─ Returns chunks regardless of pmid magnitude (synthetic ≥ 10^10 welcome)
```

## Error handling

| Scenario | Behavior |
|---|---|
| Chunk INSERT fails in ingest handler | Logged, ingest proceeds. GC picks up missing chunks on next run. Ingest never regresses because chunking is flaky. |
| Oversized abstract (> 2400 × 12 chars) | Truncated beyond 12-chunk cap, warning logged. Matches pubmed cap. |
| Null bytes / invalid UTF-8 in payload | Sanitized via same helper used by `embed-batch.js` (`sanitizeForJson`). Covers S2's 2026-04-10 quirk. |
| Backfill script interrupted mid-run | Idempotent: GC query only finds rows without chunks. Re-run picks up where it stopped. `--loop` halts at 0-row tick. |
| `embed-batch` fails downstream | Chunks sit with `embedding IS NULL`. `embed-batch` re-entrant; re-enqueued after every GC tick. Converges. |
| GC cron overlapping with itself | pg-boss `singletonKey` prevents it. |
| Partial embed-batch mid-backfill (OpenAI rate limit) | Existing exponential backoff + retry-hint parser in `embed-batch.js` handles it. Total cost bounded by $3. |

### Rollback

```sql
DELETE FROM evidence_chunks WHERE pmid >= 10000000000;
```

Single statement. `research_articles` rows stay put. HNSW index rebuilds on next insert (no manual reindex needed).

## Testing

### Unit — `tests/unit/lib/build-evidence-chunks-generic.test.js` (6 cases)
1. title + abstract → 2 chunks with correct chunk_types.
2. No abstract (or `< 50` chars) → `[]` regardless of title presence (abstract-gate).
3. Abstract-only (no title) → 1 abstract chunk.
4. Oversized abstract → multi-chunk, sentence-boundary splits, capped at 12.
5. Whitespace normalization: `\s+` → single space; null bytes stripped.
6. Metadata jsonb carries `{source, external_id, doi}`.

### Integration — `tests/integration/jobs/chunk-articles-gc.test.js` (4 cases)
1. Seeds 3 research_articles: one with abstract (gets chunked), one without (skipped), one already-chunked (left alone). Post-state assertions.
2. `payload.source` filter honored (only that source's rows touched).
3. `payload.limit` honored.
4. `boss.send("embed-batch")` called once after a successful tick (mocked).

### Regression — extend `tests/unit/jobs/ingest-topic-from-source.test.js`
1. After INSERT research_articles, evidence_chunks rows are written.
2. Chunk INSERT failure does NOT fail the parent ingest handler.

### Manual canary (executed during rollout)
1. Deploy code to Hetzner.
2. `node scripts/backfill-chunks.js --source=sportrxiv --loop` (325 rows).
3. `SELECT count(*) FROM evidence_chunks WHERE pmid >= 10000000000` → expect ~650 (title + abstract × 325).
4. Wait ~30s for `embed-batch` to drain. Verify `SELECT count(*) FROM evidence_chunks WHERE pmid >= 10000000000 AND embedding IS NOT NULL` ≈ ~650.
5. Run a test query via `retrieveDatabaseEvidence.js` for a sportrxiv-specific topic (e.g., "blood-flow-restriction training in endurance athletes"). Confirm at least one synthetic-pmid row appears in the result set.
6. Only then: `node scripts/backfill-chunks.js --loop` (full 719k, ~2h wall clock, ~$3 OpenAI).

## Rollout order

1. Merge code + migrations (no schema migration actually needed — all columns exist).
2. Deploy to Hetzner via existing `scripts/deploy-app.sh`.
3. Verify tests pass (`npm test`).
4. Canary on sportrxiv.
5. Full backfill.
6. Register `chunk-articles-gc` cron schedule. First fire next night at 03:00 ET.
7. Log expected corpus growth in `changelog.md`: evidence_chunks ~1.19M → ~2.6M.

## Open questions / deferred

None flagged during brainstorming. All decisions are locked.

Future work (out of scope):

- Richer chunk_types (openalex concepts, openaire subjects as separate `keywords` chunk_type).
- Re-chunking existing pubmed flat-abstract rows if we ever want stricter consistency.
- Source-weighted retrieval boosts (e.g., pubmed/europepmc weighted higher than preprints).
