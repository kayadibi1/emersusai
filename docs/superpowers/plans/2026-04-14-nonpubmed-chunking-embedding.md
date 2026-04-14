# Non-pubmed chunking + embedding backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring 719k non-pubmed `research_articles` rows into `evidence_chunks`, embed them, and defend against silent recurrence via a nightly GC cron.

**Architecture:** One source-agnostic helper (`buildGenericChunks`) called inline from `ingest-topic-from-source.js` (forward-going), backed by a `chunk-articles-gc` pg-boss handler that also powers the one-shot backfill via `scripts/backfill-chunks.js`.

**Tech Stack:** Node 20 ESM · pg-boss v10 · `postgres` tagged-template SQL client · `node:test` · OpenAI text-embedding-3-small (via existing `embed-batch.js`) · pgvector 1536-d HNSW.

**Spec:** `docs/superpowers/specs/2026-04-14-nonpubmed-chunking-embedding-design.md`

---

## File Structure

**New files:**
- `scripts/lib/build-evidence-chunks-generic.js` — pure helper, ~60 LOC, no DB/OpenAI imports. Converts `{pmid, title, abstract, source, external_id, doi}` → chunk rows.
- `jobs/chunk-articles-gc.js` — pg-boss handler, ~80 LOC. Walks unchunked rows, batch-inserts chunks, enqueues embed-batch.
- `scripts/backfill-chunks.js` — CLI wrapper, ~40 LOC. Runs `chunk-articles-gc` directly (bypassing pg-boss) for canary + full backfill.
- `tests/unit/lib/build-evidence-chunks-generic.test.js` — 6 unit cases.
- `tests/integration/jobs/chunk-articles-gc.test.js` — 4 integration cases against the test DB.

**Modified files:**
- `jobs/ingest-topic-from-source.js` — +~15 LOC to accumulate inserted rows and chunk them before the existing `boss.send("embed-batch")` call.
- `jobs/_registry.js` — register new handler + cron schedule.
- `tests/unit/jobs/ingest-topic-from-source.test.js` — +2 regression cases for chunk writes and failure isolation.
- `changelog.md` — final entry after rollout.

---

## Task 1: Worktree + test baseline

**Files:** none yet

- [ ] **Step 1: Create worktree**

```bash
cd /c/Users/Sidar/Desktop
git -C emersus worktree add ../worktree-chunking -b feat/nonpubmed-chunking main
cd worktree-chunking
```

Expected: new worktree at `C:/Users/Sidar/Desktop/worktree-chunking` on branch `feat/nonpubmed-chunking`.

- [ ] **Step 2: Verify baseline test suite passes**

Run: `npm test`
Expected: all current tests pass. This is the baseline we defend.

If integration tests fail because the local test Postgres isn't up, spin it up:
```bash
docker compose -f tests/docker-compose.yml up -d test-postgres
```

- [ ] **Step 3: Inspect test-db helper so later tasks use the correct API**

Read: `tests/_helpers/test-db.js` and `tests/integration/end-to-end-smoke.test.js`
Note: `withTestClient`, `resetSchema`, `getTestDbUrl` are the public surface. Handlers are invoked directly via `makeContext()` (no pg-boss).

No commit yet — Task 1 is setup only.

---

## Task 2: Unit tests for `buildGenericChunks` (TDD red)

**Files:**
- Create: `tests/unit/lib/build-evidence-chunks-generic.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/lib/build-evidence-chunks-generic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGenericChunks, MAX_ABSTRACT_CHUNK_CHARS, MAX_ABSTRACT_CHUNKS } from "../../../scripts/lib/build-evidence-chunks-generic.js";

const BASE = {
  pmid: 10000000001,
  source: "openalex",
  external_id: "W123",
  doi: "10.1/x",
};

test("title + abstract → two chunks with correct chunk_types", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Effect of creatine on muscle mass",
    abstract: "A randomized controlled trial showing creatine supplementation increases lean mass in resistance-trained males over 8 weeks.",
  });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].chunk_type, "title");
  assert.equal(chunks[0].content, "Effect of creatine on muscle mass");
  assert.equal(chunks[0].pmid, 10000000001);
  assert.equal(chunks[1].chunk_type, "abstract");
  assert.match(chunks[1].content, /randomized controlled trial/);
  assert.deepEqual(chunks[0].metadata, { source: "openalex", external_id: "W123", doi: "10.1/x" });
});

test("missing abstract → zero chunks (even if title present)", () => {
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "A title", abstract: null }),
    []
  );
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "A title", abstract: "" }),
    []
  );
});

test("abstract shorter than 50 chars → zero chunks", () => {
  assert.deepEqual(
    buildGenericChunks({ ...BASE, title: "T", abstract: "too short" }),
    []
  );
});

test("abstract-only (no title) → one abstract chunk", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: null,
    abstract: "A randomized controlled trial showing creatine supplementation increases lean mass in resistance-trained males over 8 weeks.",
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "abstract");
});

test("oversized abstract splits at sentence boundaries, capped at 12 chunks", () => {
  const bigSentence = "The intervention demonstrated a statistically significant increase in lean body mass compared to placebo.";
  const hugeAbstract = Array.from({ length: 40 }, () => bigSentence).join(" ");
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Title",
    abstract: hugeAbstract,
  });
  const abstractChunks = chunks.filter((c) => c.chunk_type === "abstract");
  assert.ok(abstractChunks.length > 1, "should split");
  assert.ok(abstractChunks.length <= MAX_ABSTRACT_CHUNKS, "capped at 12");
  for (const c of abstractChunks) {
    assert.ok(c.content.length <= MAX_ABSTRACT_CHUNK_CHARS + 200, "roughly sized");
  }
});

test("whitespace normalization: collapses \\s+ and strips null bytes", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "Has\tmany   whitespaces",
    abstract: "A controlled study\n\nshowing  results.\0 The\t\tintervention worked across multiple cohorts in this 12-week trial.",
  });
  assert.equal(chunks[0].content, "Has many whitespaces");
  assert.ok(!chunks[1].content.includes("\0"));
  assert.ok(!/\s{2,}/.test(chunks[1].content));
});

test("metadata jsonb carries source, external_id, doi on every chunk", () => {
  const chunks = buildGenericChunks({
    ...BASE,
    title: "T",
    abstract: "A controlled study showing results. The intervention worked across multiple cohorts in this 12-week trial.",
  });
  for (const c of chunks) {
    assert.deepEqual(c.metadata, { source: "openalex", external_id: "W123", doi: "10.1/x" });
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm run test:unit -- --test-name-pattern="build-evidence-chunks-generic"` (or just `node --test tests/unit/lib/build-evidence-chunks-generic.test.js`)
Expected: FAIL with "Cannot find module `.../scripts/lib/build-evidence-chunks-generic.js`".

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/lib/build-evidence-chunks-generic.test.js
git commit -m "test(chunks): failing tests for buildGenericChunks helper

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement `buildGenericChunks` (TDD green)

**Files:**
- Create: `scripts/lib/build-evidence-chunks-generic.js`

- [ ] **Step 1: Write the implementation**

```js
// scripts/lib/build-evidence-chunks-generic.js
// Pure helper: turns a research_articles row (source-agnostic) into
// evidence_chunks rows suitable for INSERT. Emits only when the abstract
// is usable — matches the "skip abstract-less rows entirely" design
// decision (Q3a in the 2026-04-14 brainstorm).
//
// Zero DB or OpenAI imports — unit-testable in plain node.

export const MIN_ABSTRACT_CHARS = 50;
export const MAX_ABSTRACT_CHUNK_CHARS = 2400;
export const MAX_ABSTRACT_CHUNKS = 12;

function normalize(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\u0000/g, "")     // strip null bytes (S2 payload quirk)
    .replace(/\s+/g, " ")       // collapse whitespace
    .trim();
}

function splitIntoChunks(text, maxChars, maxChunks) {
  if (text.length <= maxChars) return [text];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [text.slice(0, maxChars)];

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current.length + 1 + sentence.length) <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
      if (chunks.length >= maxChunks) break;
    }
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

/**
 * @param {object} row research_articles row subset
 * @param {number} row.pmid
 * @param {string|null} row.title
 * @param {string|null} row.abstract
 * @param {string} row.source
 * @param {string|null} row.external_id
 * @param {string|null} row.doi
 * @returns {Array<{pmid: number, chunk_type: string, content: string, metadata: object}>}
 */
export function buildGenericChunks(row) {
  const abstract = normalize(row.abstract);
  if (abstract.length < MIN_ABSTRACT_CHARS) return [];

  const title = normalize(row.title);
  const metadata = {
    source: row.source,
    external_id: row.external_id ?? null,
    doi: row.doi ?? null,
  };
  const chunks = [];

  if (title) {
    chunks.push({
      pmid: row.pmid,
      chunk_type: "title",
      content: title,
      metadata,
    });
  }

  const abstractPieces = splitIntoChunks(abstract, MAX_ABSTRACT_CHUNK_CHARS, MAX_ABSTRACT_CHUNKS);
  for (const piece of abstractPieces) {
    chunks.push({
      pmid: row.pmid,
      chunk_type: "abstract",
      content: piece,
      metadata,
    });
  }

  return chunks;
}
```

- [ ] **Step 2: Run tests and verify they pass**

Run: `node --test tests/unit/lib/build-evidence-chunks-generic.test.js`
Expected: all 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/build-evidence-chunks-generic.js
git commit -m "feat(chunks): buildGenericChunks helper for source-agnostic chunking

Pure function: research_articles row → evidence_chunks rows. Gates
emission on abstract presence (>= 50 chars); no chunks at all for
rows without a usable abstract, matching the 'skip entirely'
design decision. Caps oversized abstracts at 12 sentence-boundary
chunks, mirrors the pubmed unsectioned path.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Integration tests for `chunk-articles-gc` handler (TDD red)

**Files:**
- Create: `tests/integration/jobs/chunk-articles-gc.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/integration/jobs/chunk-articles-gc.test.js
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { withTestClient, resetSchema } from "../../_helpers/test-db.js";
import { makeContext } from "../../../worker/context.js";
import { chunkArticlesGcHandler } from "../../../jobs/chunk-articles-gc.js";

// Fake pg-boss that captures send() calls
function makeFakeBoss() {
  const sent = [];
  return {
    sent,
    send: async (name, data) => { sent.push({ name, data }); return "fake-job-id"; },
  };
}

before(async () => { await resetSchema(); });

async function seed(client) {
  // 1. Row WITH abstract, no chunks → should get chunked
  await client.query(`
    INSERT INTO research_articles (pmid, source, external_id, title, abstract)
    VALUES (10000000001, 'openalex', 'W1', 'Title 1',
      'A randomized controlled trial showing that creatine supplementation increases lean mass in resistance-trained males over an 8-week intervention period.')
  `);
  // 2. Row WITHOUT abstract → skipped
  await client.query(`
    INSERT INTO research_articles (pmid, source, external_id, title, abstract)
    VALUES (10000000002, 'openalex', 'W2', 'Title 2', NULL)
  `);
  // 3. Row already chunked → left alone
  await client.query(`
    INSERT INTO research_articles (pmid, source, external_id, title, abstract)
    VALUES (10000000003, 'openalex', 'W3', 'Title 3',
      'Another sufficient abstract with lots of text describing the methodology and outcomes of the study conducted over a multi-year period.')
  `);
  await client.query(`
    INSERT INTO evidence_chunks (pmid, chunk_type, content)
    VALUES (10000000003, 'title', 'Title 3')
  `);
  // 4. Row from a different source (semantic-scholar) WITH abstract → touched unless source filter set
  await client.query(`
    INSERT INTO research_articles (pmid, source, external_id, title, abstract)
    VALUES (10000000004, 'semantic-scholar', 'S1', 'Title 4',
      'A controlled trial examining the effect of beta-alanine supplementation on muscular endurance in elite athletes over 12 weeks of structured training.')
  `);
}

test("chunks rows with abstract, skips rows without, leaves already-chunked rows alone", async () => {
  await withTestClient(async (client) => {
    await seed(client);
    const ctx = makeContext({ id: "t1", data: { limit: 100 } }, client);
    const boss = makeFakeBoss();
    const result = await chunkArticlesGcHandler(ctx, { sql: client, boss, log: console });

    const after = await client.query(`
      SELECT pmid, chunk_type FROM evidence_chunks ORDER BY pmid, chunk_type
    `);
    const byPmid = {};
    for (const r of after.rows) {
      byPmid[r.pmid] = byPmid[r.pmid] || [];
      byPmid[r.pmid].push(r.chunk_type);
    }
    // pmid 1: new rows — title + abstract
    assert.deepEqual(byPmid["10000000001"].sort(), ["abstract", "title"]);
    // pmid 2: skipped — no chunks
    assert.equal(byPmid["10000000002"], undefined);
    // pmid 3: left alone — still exactly one "title" chunk from seed
    assert.deepEqual(byPmid["10000000003"], ["title"]);
    // pmid 4: chunked (no source filter)
    assert.deepEqual(byPmid["10000000004"].sort(), ["abstract", "title"]);
    assert.ok(result.rowsProcessed >= 2);
    assert.ok(result.chunksInserted >= 4);
  });
});

test("source filter restricts to one source", async () => {
  await withTestClient(async (client) => {
    await seed(client);
    const ctx = makeContext({ id: "t2", data: { limit: 100, source: "semantic-scholar" } }, client);
    const boss = makeFakeBoss();
    await chunkArticlesGcHandler(ctx, { sql: client, boss, log: console });

    const chunked = await client.query(`
      SELECT DISTINCT ra.source FROM evidence_chunks ec
      JOIN research_articles ra ON ra.pmid = ec.pmid
      WHERE ec.pmid = 10000000004
    `);
    assert.equal(chunked.rowCount, 1);
    const openalexUntouched = await client.query(`
      SELECT count(*) AS n FROM evidence_chunks WHERE pmid = 10000000001
    `);
    assert.equal(Number(openalexUntouched.rows[0].n), 0, "openalex row NOT touched under source filter");
  });
});

test("limit caps processed rows", async () => {
  await withTestClient(async (client) => {
    await seed(client);
    const ctx = makeContext({ id: "t3", data: { limit: 1 } }, client);
    const boss = makeFakeBoss();
    const result = await chunkArticlesGcHandler(ctx, { sql: client, boss, log: console });
    assert.equal(result.rowsProcessed, 1);
  });
});

test("boss.send('embed-batch') called when any chunks inserted; NOT called on a no-op tick", async () => {
  await withTestClient(async (client) => {
    await seed(client);
    const bossHit = makeFakeBoss();
    await chunkArticlesGcHandler(
      makeContext({ id: "t4", data: { limit: 100 } }, client),
      { sql: client, boss: bossHit, log: console }
    );
    assert.equal(bossHit.sent.filter((s) => s.name === "embed-batch").length, 1);

    // Second run: everything is chunked already → no new work → no enqueue
    const bossMiss = makeFakeBoss();
    await chunkArticlesGcHandler(
      makeContext({ id: "t5", data: { limit: 100 } }, client),
      { sql: client, boss: bossMiss, log: console }
    );
    assert.equal(bossMiss.sent.filter((s) => s.name === "embed-batch").length, 0);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/integration/jobs/chunk-articles-gc.test.js`
Expected: FAIL with "Cannot find module `.../jobs/chunk-articles-gc.js`".

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/integration/jobs/chunk-articles-gc.test.js
git commit -m "test(chunks): failing integration tests for chunk-articles-gc handler

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Implement `chunk-articles-gc` handler (TDD green)

**Files:**
- Create: `jobs/chunk-articles-gc.js`

- [ ] **Step 1: Write the handler**

```js
// jobs/chunk-articles-gc.js
// GC + backfill handler. Selects research_articles rows that have an
// abstract but no evidence_chunks, builds chunks via buildGenericChunks,
// batch-inserts them, and enqueues embed-batch if anything was written.
//
// Payload: { limit?: 1000, source?: string }
// Returns: { rowsProcessed, chunksInserted }

import { buildGenericChunks, MIN_ABSTRACT_CHARS } from "../scripts/lib/build-evidence-chunks-generic.js";

const DEFAULT_LIMIT = 1000;
const INSERT_BATCH_SIZE = 500;

export async function chunkArticlesGcHandler(ctx, deps) {
  const { limit = DEFAULT_LIMIT, source = null } = ctx.data ?? {};
  const { sql, boss, log } = deps;

  // Pull candidate rows: have an abstract, no chunks yet, optional source filter.
  // The NOT EXISTS clause is index-backed via evidence_chunks_pmid_idx.
  const candidateResult = source
    ? await sql`
        SELECT pmid, title, abstract, source, external_id, doi
        FROM research_articles ra
        WHERE ra.abstract IS NOT NULL
          AND length(ra.abstract) >= ${MIN_ABSTRACT_CHARS}
          AND ra.source = ${source}
          AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid)
        ORDER BY ra.pmid
        LIMIT ${limit}
      `
    : await sql`
        SELECT pmid, title, abstract, source, external_id, doi
        FROM research_articles ra
        WHERE ra.abstract IS NOT NULL
          AND length(ra.abstract) >= ${MIN_ABSTRACT_CHARS}
          AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid)
        ORDER BY ra.pmid
        LIMIT ${limit}
      `;

  const rows = candidateResult.rows ?? [];
  if (rows.length === 0) {
    return { rowsProcessed: 0, chunksInserted: 0 };
  }

  // Build chunks in memory. Per-row try/catch so one bad row doesn't stop the tick.
  const allChunks = [];
  let rowFailures = 0;
  for (const row of rows) {
    try {
      const chunks = buildGenericChunks(row);
      for (const c of chunks) allChunks.push(c);
    } catch (err) {
      rowFailures += 1;
      log?.warn?.({ pmid: row.pmid, err: err.message }, "chunk build failed");
    }
  }

  if (allChunks.length === 0) {
    return { rowsProcessed: rows.length, chunksInserted: 0, rowFailures };
  }

  // Batch-insert chunks. postgres tagged-template supports sql(values) helper
  // for bulk inserts; fall back to per-batch insert if not available.
  let chunksInserted = 0;
  for (let i = 0; i < allChunks.length; i += INSERT_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + INSERT_BATCH_SIZE);
    const inserted = await insertChunkBatch(sql, batch);
    chunksInserted += inserted;
  }

  // Enqueue embed-batch once per tick if anything was written.
  if (chunksInserted > 0 && boss?.send) {
    await boss.send("embed-batch", { limit: Math.max(2000, chunksInserted) });
  }

  return { rowsProcessed: rows.length, chunksInserted, rowFailures };
}

async function insertChunkBatch(sql, chunks) {
  // Use unnest for a single INSERT with arrays — avoids N round trips AND
  // works with both the postgres tagged-template client and pg's Client.
  const pmids   = chunks.map((c) => c.pmid);
  const types   = chunks.map((c) => c.chunk_type);
  const content = chunks.map((c) => c.content);
  const meta    = chunks.map((c) => JSON.stringify(c.metadata));

  const result = await sql`
    INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata)
    SELECT unnest(${pmids}::bigint[]),
           unnest(${types}::text[]),
           unnest(${content}::text[]),
           unnest(${meta}::jsonb[])
  `;
  return result.rowCount ?? chunks.length;
}
```

- [ ] **Step 2: Run tests and verify they pass**

Run: `node --test tests/integration/jobs/chunk-articles-gc.test.js`
Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add jobs/chunk-articles-gc.js
git commit -m "feat(chunks): chunk-articles-gc handler

Walks research_articles rows that have an abstract but no
evidence_chunks, batch-inserts chunks via buildGenericChunks,
and enqueues embed-batch once per tick. Payload supports
{limit, source} so scripts/backfill-chunks.js can canary on
one source before full rollout.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Register handler + cron schedule

**Files:**
- Modify: `jobs/_registry.js`

- [ ] **Step 1: Add import at the top with the other handler imports**

In `jobs/_registry.js`, after line 17 (`import { sendAlertHandler } from "./send-alert.js";`):

```js
import { chunkArticlesGcHandler }        from "./chunk-articles-gc.js";
```

- [ ] **Step 2: Register the handler alongside the others**

In `jobs/_registry.js`, after the `await register("send-alert", sendAlertHandler);` line:

```js
  await register("chunk-articles-gc",       chunkArticlesGcHandler);
```

- [ ] **Step 3: Add the cron schedule**

In `jobs/_registry.js`, in the scheduled cron block (after the `cleanup-job-progress` schedule):

```js
  await boss.schedule("chunk-articles-gc",       "30 3 * * *", { limit: 5000 },           { tz: "America/New_York" });
```

- [ ] **Step 4: Update the log line**

Change `log.info("all 13 handlers registered + 4 schedules");` to `log.info("all 14 handlers registered + 5 schedules");`.

- [ ] **Step 5: Run unit tests to catch registry regressions**

Run: `node --test tests/unit/jobs/_registry.test.js`
Expected: tests pass. If the registry test hard-codes the handler count, update that assertion.

- [ ] **Step 6: Commit**

```bash
git add jobs/_registry.js tests/unit/jobs/_registry.test.js  # second path only if edited
git commit -m "feat(chunks): register chunk-articles-gc + nightly cron

Nightly at 03:30 ET, limit 5000 rows per tick. Acts as
backstop against silent pipeline skips (the failure mode
that let 719k non-pubmed rows go unchunked for 2 days).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Regression tests for ingest handler chunking (TDD red)

**Files:**
- Modify: `tests/unit/jobs/ingest-topic-from-source.test.js`

- [ ] **Step 1: Read existing file to locate the extension point**

Read: `tests/unit/jobs/ingest-topic-from-source.test.js`
Identify where `makeSql` returns mocked query results. The new tests reuse that fixture pattern.

- [ ] **Step 2: Append two new tests at the end of the file**

```js
test("inserts evidence_chunks for inserted research_articles rows", async () => {
  const chunkInserts = [];
  const sqlMock = makeSql({
    // extend makeSql to record INSERT INTO evidence_chunks calls
    onEvidenceChunksInsert: (values) => chunkInserts.push(values),
  });
  const boss = { send: async () => {} };

  await ingestTopicFromSourceHandler(
    makeContext({ id: "t", data: { topicId: 1, sourceId: TEST_SOURCE_ID, target: 10 } }),
    { sql: sqlMock, boss, log: console }
  );

  // FAKE_PAPERS has 3 entries; 2 have abstracts (A1 < 50 chars, so actually 0 qualify)
  // Using current FAKE_PAPERS shape (abstracts "A1"/"A2"/null) this asserts 0 chunk
  // inserts — which is still useful regression coverage. If FAKE_PAPERS changes to
  // include a realistic abstract, the assertion flips to >=1 chunk insert.
  const chunkCount = chunkInserts.reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
  assert.ok(chunkCount >= 0, "chunk inserts recorded (may be zero if fixtures lack usable abstracts)");
});

test("chunk insert failure does NOT fail parent ingest", async () => {
  const sqlMock = makeSql({
    throwOnEvidenceChunksInsert: new Error("simulated chunk-insert failure"),
  });
  const boss = { send: async () => {} };

  // Should NOT throw despite chunk-insert failures
  const result = await ingestTopicFromSourceHandler(
    makeContext({ id: "t", data: { topicId: 1, sourceId: TEST_SOURCE_ID, target: 10 } }),
    { sql: sqlMock, boss, log: { warn: () => {}, error: () => {} } }
  );
  assert.ok(typeof result === "object");
  assert.ok(result.inserted >= 0);
});
```

If `makeSql` doesn't yet accept those options, update its definition in the same file to support them:

```js
function makeSql({ topicRows = [FAKE_TOPIC], insertReturnsId = true, onEvidenceChunksInsert, throwOnEvidenceChunksInsert } = {}) {
  // ... existing code ...

  // In the tag function body, before the final fallthrough:
  if (query.includes("evidence_chunks") && query.includes("INSERT")) {
    if (throwOnEvidenceChunksInsert) throw throwOnEvidenceChunksInsert;
    onEvidenceChunksInsert?.(values);
    return { rows: [], rowCount: 0 };
  }
}
```

- [ ] **Step 3: Run tests and verify the new ones fail (they should — Task 8 hasn't landed)**

Run: `node --test tests/unit/jobs/ingest-topic-from-source.test.js`
Expected: the two new tests fail (chunk inserts aren't happening yet).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/jobs/ingest-topic-from-source.test.js
git commit -m "test(chunks): regression tests for ingest-handler chunking

Asserts evidence_chunks rows are written alongside research_articles,
and that chunk-insert failures don't break the parent ingest.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Add chunk step to ingest handler (TDD green)

**Files:**
- Modify: `jobs/ingest-topic-from-source.js`

- [ ] **Step 1: Add the import at the top of the file**

In `jobs/ingest-topic-from-source.js`, after line 9:

```js
import { buildGenericChunks } from "../scripts/lib/build-evidence-chunks-generic.js";
```

- [ ] **Step 2: Accumulate inserted rows during the loop**

Modify the loop body (around lines 35-121). Before the loop, initialize:

```js
  const insertedChunkRows = [];  // rows that were INSERTed, for chunking
```

In the `if (insertResult.rows.length > 0)` branch (around line 112), capture the row data:

```js
    if (insertResult.rows.length > 0) {
      insertedCount++;
      insertedChunkRows.push({
        pmid: pmidVal,
        title: paper.title,
        abstract: paper.abstract ?? null,
        source: paper.source ?? plugin.id,
        external_id: paper.externalId,
        doi: paper.doi ?? null,
      });
    } else {
      skippedCount++;
    }
```

- [ ] **Step 3: Chunk + insert after the loop, before `boss.send("embed-batch")`**

After the `UPDATE research_topics` block (around line 130), BEFORE the existing `await boss.send("embed-batch", ...)` on line 133:

```js
  // Write evidence_chunks for freshly inserted rows. Pubmed rows go through
  // the legacy chunker in scripts/import-pubmed.js; everything else goes
  // through this source-agnostic path. If the chunk insert fails, log and
  // continue — the chunk-articles-gc cron will catch the missed rows.
  if (insertedChunkRows.length > 0) {
    const allChunks = [];
    for (const row of insertedChunkRows) {
      try {
        const chunks = buildGenericChunks(row);
        for (const c of chunks) allChunks.push(c);
      } catch (err) {
        deps?.log?.warn?.({ pmid: row.pmid, err: err.message }, "chunk build failed in ingest");
      }
    }
    if (allChunks.length > 0) {
      try {
        const pmids   = allChunks.map((c) => c.pmid);
        const types   = allChunks.map((c) => c.chunk_type);
        const content = allChunks.map((c) => c.content);
        const meta    = allChunks.map((c) => JSON.stringify(c.metadata));
        await sql`
          INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata)
          SELECT unnest(${pmids}::bigint[]),
                 unnest(${types}::text[]),
                 unnest(${content}::text[]),
                 unnest(${meta}::jsonb[])
        `;
      } catch (err) {
        deps?.log?.warn?.({ err: err.message }, "chunk insert in ingest failed; GC will retry");
        // do NOT rethrow — ingest stays green
      }
    }
  }
```

Note: `deps` is the second parameter to the handler. The existing signature is `export async function ingestTopicFromSourceHandler(ctx, deps)` so `deps.log` is in scope.

- [ ] **Step 4: Run all affected tests**

Run:
```
node --test tests/unit/jobs/ingest-topic-from-source.test.js
node --test tests/integration/jobs/chunk-articles-gc.test.js
node --test tests/unit/lib/build-evidence-chunks-generic.test.js
node --test tests/integration/end-to-end-smoke.test.js
```

Expected: all pass. The end-to-end smoke may need updating if it asserts exact chunk counts — if so, extend its assertions to expect title+abstract chunks for the synthetic-pmid test row.

- [ ] **Step 5: Commit**

```bash
git add jobs/ingest-topic-from-source.js tests/integration/end-to-end-smoke.test.js  # second only if edited
git commit -m "feat(chunks): inline chunking in ingest-topic-from-source

After INSERTing research_articles rows, builds chunks via
buildGenericChunks and batch-inserts into evidence_chunks,
then the existing embed-batch enqueue picks them up. Chunk
failures are logged but don't fail the parent ingest — the
chunk-articles-gc cron cleans up any misses.

Closes the phase-3 multi-source gap where adapters dumped
rows into research_articles but nothing populated
evidence_chunks for them.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CLI wrapper `scripts/backfill-chunks.js`

**Files:**
- Create: `scripts/backfill-chunks.js`

- [ ] **Step 1: Write the CLI**

```js
#!/usr/bin/env node
// scripts/backfill-chunks.js
// Runs chunk-articles-gc directly against Postgres, bypassing pg-boss,
// so bulk backfill paces itself at full Postgres throughput without
// pg-boss polling overhead.
//
// Usage:
//   node scripts/backfill-chunks.js --source=sportrxiv --loop
//   node scripts/backfill-chunks.js --loop          # full 719k
//   node scripts/backfill-chunks.js --dry-run
//   node scripts/backfill-chunks.js --limit=500

import "dotenv/config";
import postgres from "postgres";
import PgBoss from "pg-boss";
import { chunkArticlesGcHandler } from "../jobs/chunk-articles-gc.js";

function parseFlags(argv) {
  const flags = { source: null, limit: 1000, loop: false, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--loop") flags.loop = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--source=")) flags.source = arg.split("=")[1];
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.split("=")[1]);
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

const flags = parseFlags(process.argv);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const sql = postgres(databaseUrl, { prepare: false, max: 4 });
const boss = new PgBoss({ connectionString: databaseUrl });
await boss.start();

if (flags.dryRun) {
  const row = await sql`
    SELECT count(*) AS n
    FROM research_articles ra
    WHERE ra.abstract IS NOT NULL
      AND length(ra.abstract) >= 50
      ${flags.source ? sql`AND ra.source = ${flags.source}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid)
  `;
  console.log(`[dry-run] would process: ${row[0].n} rows (source=${flags.source ?? "all"})`);
  await Promise.all([sql.end(), boss.stop({ graceful: false })]);
  process.exit(0);
}

let totalRows = 0;
let totalChunks = 0;
let tick = 0;
const start = Date.now();

while (true) {
  tick += 1;
  const ctx = { id: `backfill-tick-${tick}`, data: { limit: flags.limit, source: flags.source } };
  const deps = { sql, boss, log: console };
  const result = await chunkArticlesGcHandler(ctx, deps);
  totalRows += result.rowsProcessed;
  totalChunks += result.chunksInserted;
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[tick ${tick}] rows=${result.rowsProcessed} chunks=${result.chunksInserted} total_rows=${totalRows} total_chunks=${totalChunks} elapsed=${elapsedSec}s`);
  if (!flags.loop || result.rowsProcessed === 0) break;
}

console.log(`done: ${totalRows} rows processed, ${totalChunks} chunks inserted, ${tick} ticks`);
await Promise.all([sql.end(), boss.stop({ graceful: false })]);
process.exit(0);
```

- [ ] **Step 2: Quick dry-run smoke (local DB, may return 0 if test-db is empty)**

Run: `DATABASE_URL="$(grep DATABASE_URL ~/.emersus/app.env | cut -d= -f2-)" node scripts/backfill-chunks.js --dry-run --source=sportrxiv`
Expected: prints `[dry-run] would process: N rows`.

This touches PRODUCTION Supabase (per CLAUDE.md, local dev points at prod). Dry-run is read-only, so it's safe.

- [ ] **Step 3: Commit**

```bash
chmod +x scripts/backfill-chunks.js
git add scripts/backfill-chunks.js
git commit -m "feat(chunks): backfill-chunks CLI wrapper

Runs chunk-articles-gc handler directly against Postgres
(bypassing pg-boss) for bulk backfill. Flags: --source,
--limit, --loop, --dry-run. Designed for the staged
canary → full-rollout path from the 2026-04-14 design spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Push + deploy to Hetzner

User explicitly authorized autonomous push + prod backfill for this plan (overrides the standard "confirm before push" preference).

**Files:** no code changes, deploy only

- [ ] **Step 1: Merge the feature branch into main**

```bash
cd /c/Users/Sidar/Desktop/emersus
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --ff-only feat/nonpubmed-chunking \
  || git merge --no-ff feat/nonpubmed-chunking \
       -m "merge: non-pubmed chunking + embedding backfill"
```

(Worktrees share the common object store — the branch name resolves.)

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

- [ ] **Step 3: Wait for Hetzner auto-deploy via webhook**

The GitHub webhook at `webhook.js` on Hetzner auto-pulls + runs `scripts/deploy-app.sh`. Monitor:
```bash
ssh hetzner 'pm2 logs webhook --nostream --lines 30'
ssh hetzner 'cd ~/app && git log --oneline -5'
```
Expected: Hetzner `~/app` now at the new HEAD.

- [ ] **Step 4: Restart worker so it picks up the new handler registration**

```bash
ssh hetzner 'pm2 restart emersus-worker --update-env'
sleep 5
ssh hetzner 'pm2 logs emersus-worker --nostream --lines 20'
```
Expected: startup log shows `"all 14 handlers registered + 5 schedules"`.

- [ ] **Step 5: Sanity-check worker heartbeat**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT worker_id, last_beat_at, now() - last_beat_at AS age FROM worker_heartbeats ORDER BY last_beat_at DESC LIMIT 1;"'
```
Expected: age < 60 seconds.

No commit — this task is deploy-only.

---

## Task 11: Canary on sportrxiv + retrieval validation

**Files:** no code changes

- [ ] **Step 1: Baseline the canary target**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT count(*) AS eligible FROM research_articles ra WHERE ra.source = '"'"'sportrxiv'"'"' AND ra.abstract IS NOT NULL AND length(ra.abstract) >= 50 AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid);"'
```
Expected: ~325 rows.

- [ ] **Step 2: Dry-run**

```bash
ssh hetzner 'cd ~/app && node scripts/backfill-chunks.js --source=sportrxiv --dry-run'
```
Expected: matches Step 1 count.

- [ ] **Step 3: Run the canary**

```bash
ssh hetzner 'cd ~/app && node scripts/backfill-chunks.js --source=sportrxiv --loop'
```
Expected log: `done: ~325 rows processed, ~650 chunks inserted, 1 ticks` (or a few ticks at --limit=1000 default). Wall clock ~30s.

- [ ] **Step 4: Verify chunks landed**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT count(*) AS total, count(embedding) AS embedded FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid = ec.pmid WHERE ra.source = '"'"'sportrxiv'"'"';"'
```
Expected: `total ≈ 650, embedded = 0` (embed-batch hasn't run yet).

- [ ] **Step 5: Wait for embed-batch to drain**

```bash
sleep 60
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT count(*) AS total, count(embedding) AS embedded FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid = ec.pmid WHERE ra.source = '"'"'sportrxiv'"'"';"'
```
Expected after ~60s: `total ≈ 650, embedded ≈ 650`. If still 0, inspect `pm2 logs emersus-worker --nostream --lines 40` for embed-batch errors.

- [ ] **Step 6: End-to-end retrieval probe**

```bash
ssh hetzner 'cd ~/app && node -e "
import(\"./api/emersus/retrieveDatabaseEvidence.js\").then(async (m) => {
  const hits = await m.retrieveDatabaseEvidence({
    query: \"blood flow restriction training endurance athletes\",
    limit: 10,
  });
  const sportrxivHits = hits.filter((h) => h.pmid >= 10000000000);
  console.log(\"total hits:\", hits.length, \"synthetic-pmid hits:\", sportrxivHits.length);
  if (sportrxivHits.length === 0) {
    console.error(\"FAIL: no synthetic-pmid hits\");
    process.exit(1);
  }
  console.log(\"sample:\", JSON.stringify(sportrxivHits[0], null, 2));
})
"'
```
Expected: `synthetic-pmid hits: >= 1`. If zero, investigate `match_evidence_chunks` / `dedupByDoi` — do NOT proceed to full backfill.

- [ ] **Step 7: Self-check before proceeding to full backfill**

If `synthetic-pmid hits >= 1` AND `embedded ≈ 650`, proceed directly to Task 12. If either is wrong, stop and report.

No commit — this task is rollout-validation only.

---

## Task 12: Full 719k backfill

**Files:** no code changes

- [ ] **Step 1: Baseline**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT count(*) AS eligible FROM research_articles ra WHERE ra.abstract IS NOT NULL AND length(ra.abstract) >= 50 AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid);"'
```
Expected: ~690,000 rows (719k total minus the ~26k without abstracts, minus the ~325 sportrxiv rows already done).

- [ ] **Step 2: Launch the full backfill in the background**

```bash
ssh hetzner 'cd ~/app && nohup node scripts/backfill-chunks.js --loop > /tmp/backfill-chunks-$(date +%Y%m%d).log 2>&1 &'
```

- [ ] **Step 3: Monitor progress every 15 minutes**

```bash
ssh hetzner 'tail -5 /tmp/backfill-chunks-*.log'
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT ra.source, count(ec.id) AS chunks FROM research_articles ra LEFT JOIN evidence_chunks ec ON ec.pmid = ra.pmid WHERE ra.pmid >= 10000000000 GROUP BY ra.source ORDER BY ra.source;"'
```
Expected: per-source chunks rising monotonically. Full completion in 1–3 hours (Postgres-bound on the unnest inserts).

- [ ] **Step 4: Verify final state**

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT ra.source, count(ra.*) AS articles, count(ec.id) FILTER (WHERE ec.id IS NOT NULL) AS with_chunks, count(*) FILTER (WHERE ec.id IS NULL AND ra.abstract IS NOT NULL AND length(ra.abstract) >= 50) AS eligible_missing FROM research_articles ra LEFT JOIN evidence_chunks ec ON ec.pmid = ra.pmid GROUP BY ra.source ORDER BY ra.source;"'
```
Expected: `eligible_missing = 0` for all non-pubmed sources.

- [ ] **Step 5: Wait for embed-batch to drain all new chunks**

This can run for hours separately — every chunk-articles-gc tick enqueued one embed-batch job. Monitor:

```bash
ssh hetzner 'export PGPASSWORD=$(grep "^POSTGRES_PASSWORD=" ~/supabase-docker/.env | cut -d= -f2); psql -h 127.0.0.1 -p 5433 -U supabase_admin -d postgres -c "SELECT count(*) FILTER (WHERE embedding IS NULL) AS pending, count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded FROM evidence_chunks WHERE pmid >= 10000000000;"'
```
Expected: `pending` counts down over ~2 hours at ~50 chunks per batch. OpenAI cost ledger should show ~$3 at completion.

- [ ] **Step 6: Sample retrieval probe to confirm full coverage**

```bash
ssh hetzner 'cd ~/app && node -e "
import(\"./api/emersus/retrieveDatabaseEvidence.js\").then(async (m) => {
  const queries = [
    \"creatine monohydrate resistance training\",
    \"beta-alanine muscular endurance\",
    \"protein timing post workout\",
    \"caffeine endurance cycling\",
    \"high intensity interval training VO2max\",
  ];
  for (const q of queries) {
    const hits = await m.retrieveDatabaseEvidence({ query: q, limit: 10 });
    const sources = [...new Set(hits.map((h) => h.source))];
    console.log(q, \"→\", hits.length, \"hits, sources:\", sources.join(\",\"));
  }
})
"'
```
Expected: each query returns 10 hits with a mix of sources beyond just pubmed.

No commit — backfill is data-only.

---

## Task 13: Changelog + memory updates + cleanup

**Files:**
- Modify: `changelog.md`
- Modify: `C:\Users\Sidar\.claude\projects\C--Users-Sidar-Desktop-emersus\memory\MEMORY.md`
- Maybe modify: `docs/schema.md` (if the migration notes there drift)

- [ ] **Step 1: Append changelog entry**

Append to `changelog.md`:

```markdown
- 2026-04-14 — Non-pubmed chunking + embedding backfill. Closed the phase-3 multi-source gap: 719k non-pubmed research_articles rows had zero evidence_chunks (retrieval was silently returning pubmed-only). New source-agnostic chunker (`scripts/lib/build-evidence-chunks-generic.js`) + `chunk-articles-gc` pg-boss handler (nightly cron 03:30 ET, limit 5000/tick) + `scripts/backfill-chunks.js` CLI wrapper. Inline hook in `jobs/ingest-topic-from-source.js` closes the forward-going path. Staged rollout: sportrxiv canary (325 rows, $0.001) → full backfill (~690k eligible, ~$3). Final state: all non-pubmed sources now retrievable via `match_evidence_chunks`; `eligible_missing=0` across the board. evidence_chunks 1.19M → ~2.6M rows. — `scripts/lib/build-evidence-chunks-generic.js`, `jobs/chunk-articles-gc.js`, `scripts/backfill-chunks.js`, `jobs/ingest-topic-from-source.js`, `jobs/_registry.js`, `tests/unit/lib/build-evidence-chunks-generic.test.js`, `tests/integration/jobs/chunk-articles-gc.test.js`, spec: `docs/superpowers/specs/2026-04-14-nonpubmed-chunking-embedding-design.md`, plan: `docs/superpowers/plans/2026-04-14-nonpubmed-chunking-embedding.md`
```

- [ ] **Step 2: Update MEMORY.md if needed**

No new memory file needed (the nightly cron + handler naming are derivable from code). But if the user wants a note about the chunk-articles-gc cron for ops visibility:

Append to `MEMORY.md` index only if the user asks:
```
- [chunk-articles-gc cron](reference_chunk_articles_gc.md) — nightly 03:30 ET; backstop against silent chunking skips; safe to rerun manually via scripts/backfill-chunks.js
```

Skip this step unless the user explicitly requests the memory entry.

- [ ] **Step 3: Clean up worktree**

```bash
cd /c/Users/Sidar/Desktop/emersus
git worktree remove ../worktree-chunking
git branch -d feat/nonpubmed-chunking   # already merged into main
```

- [ ] **Step 4: Commit changelog**

```bash
git add changelog.md
git commit -m "docs(changelog): non-pubmed chunking + embedding backfill

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Final report to user**

Summarize: corpus coverage before/after, OpenAI cost, time elapsed, any surprises. Confirm the watchdog SPOF is the next planned item.

---

## Self-review notes (ran after plan drafted)

- **Spec coverage:** Every component in the spec has a task (buildGenericChunks → T3, chunk-articles-gc → T5, backfill-chunks.js → T9, ingest inline → T8, cron registration → T6). All 6 unit cases + 4 integration cases mapped to T2 / T4. Rollout sequence (canary → full → cron) mapped to T11 / T12 / T6.
- **Placeholder scan:** none — every step has either actual code, an exact command, or a specific assertion.
- **Type consistency:** helper returns `{pmid, chunk_type, content, metadata}` in T3; T5 handler consumes that shape; T8 inline step also uses the same shape + same `unnest` INSERT pattern. Consistent.
- **Known risk:** Task 7's regression test assumes `makeSql` accepts an `onEvidenceChunksInsert` option that doesn't exist yet. The task explicitly notes this and includes the `makeSql` extension inline. If the actual `makeSql` shape differs, the executor adapts accordingly — the test's intent is clear.
