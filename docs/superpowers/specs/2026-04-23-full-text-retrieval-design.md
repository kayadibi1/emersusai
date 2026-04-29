# Full-text + abstract retrieval for title-filter survivors — design

**Date:** 2026-04-23
**Status:** spec — ready to hand off to a fresh Claude Code instance
**Depends on:** `2026-04-23-title-only-filter-design.md` (completes the title-filter pass whose survivors this spec enriches)

---

## 0. Handoff context for the receiving instance

You will walk into this project with zero memory of the title-filter work. Orient before you do anything.

### Read these first (in order)
1. `CLAUDE.md` — repo conventions. Note: local dev points at prod Supabase, `.md` files are gitignored by design, `infra/` is untracked.
2. `docs/superpowers/specs/2026-04-23-title-only-filter-design.md` — the title-filter spec. This spec is its follow-up.
3. `scripts/title-filter/README.md` — the pattern this one mirrors.

### Relevant memory items (at `~/.claude/projects/C--Users-Sidar-Desktop-emersus/memory/`)
- `project_supabase_admin_role.md` — use `-U supabase_admin` for schema/write ops (postgres user lacks REFERENCES on auth.users).
- `reference_hetzner_ssh.md` — `ssh hetzner`, DB via `docker exec supabase-db psql`.
- `reference_hetzner_env_file.md` — prod env is `~/app/.env` on Hetzner (contains `DATABASE_URL`, `OPENAI_API_KEY`, `CORE_API_KEY`).
- `feedback_migration_scp_conflict.md` — migrations piped via `cat FILE.sql | ssh hetzner 'docker exec -i ...'`, never scp.
- `feedback_verify_vendor_pricing.md` — show the math, don't quote memory for pricing.
- `feedback_openai_strict_mode.md` — strict:true tool schemas require every property in `required`.
- `evidence_chunks` tuning: `reference_evidence_chunks_vacuum_tuning.md` — when to REINDEX HNSW.

### DB connection pattern for local scripts

Hetzner Postgres exposes port 5433; tunnel it to local 54324 and swap the host:
```bash
ssh -fN -L 54324:127.0.0.1:5433 hetzner
HETZNER_DB=$(ssh hetzner "grep '^DATABASE_URL=' ~/app/.env | cut -d= -f2-")
export DATABASE_URL=$(echo "$HETZNER_DB" | sed 's|@127.0.0.1:5433|@127.0.0.1:54324|')
```
(`supabase_admin` user is fine for both reads and writes.)

### Existing abstractions to reuse
- `scripts/title-filter/lib/pg.js` — pg wrapper with `withPg` + `toPgVector`.
- `api/lib/clients.js` — OpenAI client + `.env.local` loader.
- `scripts/sources/openalex.js:34` — `reconstructAbstract(invertedIndex)` — **reuse, don't rewrite**.
- `scripts/sources/semantic-scholar.js` — S2 fetch + parse.
- `scripts/sources/europepmc.js` — EuropePMC parse; defines `abstractText` handling.
- `scripts/sources/openaire.js` — OpenAIRE `descriptions[0]` shape.

---

## 1. Problem + goal

Of ~1.44M rows in `research_articles`:
- **~289k were title-only** as of 2026-04-23 (submitted to a title-filter batch; gpt-4o-mini classifies them as `relevant` or `irrelevant`).
- After filter completes, ~185k survivors (estimate based on 32% drop rate on smoke test) need real content: **abstract + full text** where legally available.
- Currently outside pubmed, **full text coverage is effectively zero** (3,459 pubmed rows have full text; all other sources have empty `full_text` columns).

**Goal:** populate abstracts for all ~185k survivors, and full text for the legally-OA subset (~150k), so these rows contribute to retrieval.

**Non-goals:**
- Paywalled closed-access papers. We accept ~35k survivors stay abstract-only forever.
- Re-processing papers that already have abstracts/full text. Idempotency guards handle that.
- Pubmed title-only rows. Handled separately via `scripts/reparse-pubmed-enrichment.js` precedent.

---

## 2. Pre-flight (run at session start, before implementing)

Verify the title-filter batch has completed and applied its decisions. These numbers drive downstream scope.

```sql
-- Run against hetzner via docker exec:
SELECT source,
       count(*) FILTER (WHERE title_filter_decision = 'relevant')   AS survivors,
       count(*) FILTER (WHERE title_filter_decision = 'irrelevant') AS dropped,
       count(*) FILTER (WHERE title_filter_decision IS NULL)        AS pending
  FROM research_articles
 WHERE source IN ('openalex','semantic-scholar','openaire','europepmc','core')
   AND (abstract IS NULL OR abstract = '')
 GROUP BY source ORDER BY survivors DESC;
```

If any `pending > 0`, the title-filter batch hasn't finished applying. Do NOT start enrichment until `pending = 0` across the board.

**If the batch is stuck or failed**, check:
```bash
cd ~/Desktop/emersus
node scripts/title-filter/batch-status.js
```
Batch id is saved in `scripts/title-filter/data/batch-state.json`.

---

## 3. Phased plan

### Phase 2A — Abstracts (~$6, 2-3 days)

Fetch abstract text for ~185k survivors that currently have `abstract IS NULL`. Per-source pipelines matching `scripts/reparse-pubmed-enrichment.js` pattern.

### Phase 2B — EuropePMC fullTextXML (~$5, 1-2 days)

For any survivor with a pmid or pmcid (across all sources, not just europepmc source-rows), probe EuropePMC for clean JATS XML full text. Free, no PDF parsing, gold-standard structured output.

### Phase 2C — OA PDFs via Unpaywall + Grobid (~$15, 1-2 weeks)

For remaining survivors not covered by 2B but with an OA URL per Unpaywall, download the PDF, parse via Grobid (Docker on Hetzner), extract clean body text. Biggest lift, biggest coverage expansion.

### Gate between phases

**Between 2A+2B → 2C:**

Run a retrieval eval (the one at `scripts/eval/retrieval-eval.js`) before and after 2A+2B. Decision tree:
- If recall gap on `scripts/eval/fixtures/retrieval.json` closed by ≥ 80% → **stop**. 2C is overkill.
- If gap < 50% closed → proceed to 2C.
- If 50-80% closed → spot-check 10 known-failing queries. If they now work → stop. If not → proceed to 2C.

---

## 4. Phase 2A — Abstracts

### Scope

```sql
SELECT source, count(*) AS survivors_missing_abstract
  FROM research_articles
 WHERE title_filter_decision = 'relevant'
   AND (abstract IS NULL OR abstract = '')
   AND is_deleted = false
 GROUP BY source;
```

Expected volumes (scaled from pre-filter counts at ~65% survival):
- openalex: ~150k
- semantic-scholar: ~16k
- openaire: ~9k
- europepmc: ~7k
- core: ~3.5k (paused — license; skip until CORE dataset license lands)

### API details per source

#### OpenAlex
- **Endpoint:** `GET https://api.openalex.org/works/W{id}`
- **Field:** `abstract_inverted_index` (decode via existing `reconstructAbstract` at `scripts/sources/openalex.js:34`)
- **Rate limit:** 10 req/s in polite pool (add `mailto=info@emersus.ai` query param or `User-Agent` with email)
- **Batching:** single-id endpoint only; no batch. Parallelize 8 concurrent requests.
- **Free**

The row's `external_id` is the full OpenAlex ID `W1234567890` (verify; if not, it may be numeric-only and needs `W` prefix restored).

#### Semantic Scholar
- **Endpoint:** `POST https://api.semanticscholar.org/graph/v1/paper/batch` (with header `x-api-key: $S2_API_KEY`; env var is `S2_API_KEY` — check `~/app/.env`, if not present, contact user)
- **Body:** `{"ids": ["PAPERID1", "PAPERID2", ...]}` (up to 500)
- **Query params:** `fields=abstract,title,authors,year,venue,openAccessPdf,externalIds,tldr`
- **Rate limit:** 1 request/sec with key
- **Batching:** 500 IDs per call → ~16k / 500 = 32 calls
- **Free**

IDs: S2's `paperId` is stored in `external_id`. Verify format — usually a 40-char hex string or CorpusID, DOI, etc.

#### EuropePMC
- **Endpoint:** `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:{id} SRC:MED&format=json&resultType=core`
- Or direct by pmid: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/article/MED/{pmid}?resultType=core&format=json`
- **Field:** `abstractText`
- **Rate limit:** no documented hard limit; 10 req/s polite
- **Batching:** single only
- **Free**

#### OpenAIRE
- **Endpoint:** `GET https://api.openaire.eu/search/publications?openaireId={id}&format=json`
- **Field:** `descriptions[0]` (may be abstract or pub description)
- **Rate limit:** no documented hard limit; 5 req/s polite
- **Batching:** single
- **Free**

### Pipeline design (per-source one-shot script)

```
scripts/abstract-enrichment/
  ├─ README.md
  ├─ lib/pg.js                    # symlink or re-export from ../title-filter/lib
  ├─ lib/rate-limiter.js          # simple token-bucket per source
  ├─ enrich-openalex.js           # O(N) API calls, UPDATE in batches
  ├─ enrich-s2.js                 # batch-of-500 API calls, UPDATE
  ├─ enrich-europepmc.js
  ├─ enrich-openaire.js
```

Each script:
1. `SELECT pmid, external_id FROM research_articles WHERE title_filter_decision='relevant' AND abstract IS NULL AND source=X AND is_deleted=false ORDER BY pmid LIMIT 1000;`
2. Fetch abstracts via source-specific API (respect rate limit).
3. Parse response with existing adapter function.
4. `UPDATE research_articles SET abstract = $1, content_source = 'phase2a_enrich_{source}', chunks_sectioned_at = NULL, updated_at = now() WHERE pmid = $2 AND (abstract IS NULL OR abstract = '');`
5. Log: rows attempted, rows updated, rows that had no abstract upstream (leave abstract NULL), API errors.
6. Loop until select returns 0 rows.

Setting `chunks_sectioned_at = NULL` signals the downstream chunker to re-chunk this row (include the fresh abstract in evidence_chunks).

### Smoke test each script with `--max-rows=50` before the full run.

### Chunking cascade (automatic)

After abstracts land:
- `jobs/chunk-articles-gc.js` (pg-boss handler; scheduled via `jobs/_registry.js`) picks up rows with `chunks_sectioned_at IS NULL`, chunks the abstract using `shared/chunker.js` (or equivalent), inserts `evidence_chunks`.
- `jobs/embed-batch.js` (pg-boss handler) picks up `evidence_chunks WHERE embedding IS NULL`, embeds with `text-embedding-3-small`, UPDATE.

**Verify both handlers are healthy before starting enrichment:**
```bash
ssh hetzner 'pm2 status emersus-worker'
ssh hetzner "docker exec supabase-db psql -U postgres -d postgres -c \"SELECT queue, count(*) FROM pgboss.job WHERE state='created' GROUP BY queue;\""
```

Per memory `feedback_webhook_doesnt_restart_worker.md`: if you touch files in `jobs/`, manually `ssh hetzner 'pm2 restart emersus-worker --update-env'`.

### Cost

Running on ~185k survivors:
- OpenAlex: 150k × 0 = **$0** (free API)
- S2: 32 batch calls × 0 = **$0**
- EuropePMC / OpenAIRE: free
- **Embedding the new chunks:**
  - 185k × ~8 chunks/paper × ~200 tokens/chunk = ~296M tokens
  - `text-embedding-3-small` @ $0.02/M = **$5.92**
- **Total Phase 2A: ~$6**

### Wall-clock

- OpenAlex 150k rows × 1 req/row ÷ 10 req/s = **4.2 hours** (dominant)
- S2: 32 batches × 1s = seconds
- EuropePMC 7k × 1 req / 10 req/s = **12 min**
- OpenAIRE 9k × 1 req / 5 req/s = **30 min**
- Chunking + embedding lag: background, usually catches up within hours

### Resume / idempotency
- Re-running each script picks up where it left off via the `abstract IS NULL` WHERE clause.
- The UPDATE has `AND (abstract IS NULL OR abstract='')` to be safe against races.
- No state files needed.

---

## 5. Phase 2B — EuropePMC fullTextXML

### Scope

Any survivor with a pmid OR pmcid — **regardless of `source` column** — is eligible. EuropePMC indexes PMC-OA papers irrespective of which aggregator gave us the row.

```sql
-- Eligibility: has pmid OR pmcid, is a survivor, doesn't already have full text.
SELECT count(*)
  FROM research_articles
 WHERE title_filter_decision = 'relevant'
   AND is_deleted = false
   AND (pmid IS NOT NULL OR pmcid IS NOT NULL)
   AND (full_text IS NULL OR full_text = '');
```

Coverage estimate: ~60-70k of 185k survivors have PMC-OA full text.

### API

- **Endpoint:**
  - By pmid: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/MED/{pmid}/fullTextXML`
  - By pmcid: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/{pmcid}/fullTextXML`
- **Returns:** JATS XML if PMC-OA, 404 otherwise.
- **Rate limit:** no documented hard limit; 5 req/s polite.
- **Free**

### JATS XML structure

Look inside `<article>/<body>`:
- `<sec>` (section) elements with `<title>` and paragraph content
- `<p>` paragraphs
- Ignore: `<fig>`, `<table-wrap>`, `<ref-list>`, `<back>` (references)
- Keep: `<abstract>` (confirm matches existing column), `<body>/<sec>` recursively

Existing parser to consider: `scripts/lib/abstract-sections-chunks.js` already has JATS-like parsing for structured abstracts. It may be extendable, or at minimum serves as a reference.

Use a permissive XML parser: `fast-xml-parser` (already in `node_modules` per the pubmed path). Check `package.json`.

### Text extraction rules

- Concatenate section titles + paragraph text, separated by `\n\n`.
- Drop `<xref>` tags entirely (citation markers) before text extraction — they add noise.
- Drop `<fig>` and `<table-wrap>` subtrees completely.
- Skip `<back>` (references, acknowledgments, supplementary).
- Enforce sanity bounds: if extracted text < 500 chars or > 500k chars, log anomaly and don't store.

### Storage

Write to existing `full_text` column on research_articles.

```sql
UPDATE research_articles
   SET full_text = $1,
       has_full_text = true,
       content_source = 'phase2b_europepmc_jats',
       chunks_sectioned_at = NULL,
       updated_at = now()
 WHERE pmid = $2;
```

### Pipeline

`scripts/fulltext-enrichment/enrich-europepmc-jats.js`:

```
1. SELECT pending rows (as above, LIMIT 500 per page)
2. For each row, pick pmcid if set (PMC endpoint is richer), else pmid
3. GET fullTextXML
4. If 404 → UPDATE SET has_full_text = false (mark probed; avoid retry)
5. If 200 + XML → parse → UPDATE with text
6. Respect 5 req/s
7. Resume via WHERE clause
```

Add a "probed" marker so we skip papers that returned 404 on retries. Suggestion: add column `fulltext_probed_at TIMESTAMPTZ` (see schema changes below).

### Chunking will refresh automatically

Same cascade as Phase 2A — `chunks_sectioned_at = NULL` triggers the chunker.

**Important:** The chunker needs to treat full_text differently from abstract:
- Abstract chunks: whole abstract or by structured sections
- Full text chunks: by JATS sections, split further if section > 1k tokens

Review `shared/chunker.js` (or equivalent) to confirm it handles full_text. If not, this is a code change in chunker logic, not just a new script.

### Cost

- API calls: free
- Embedding new chunks:
  - 60k × ~30 chunks/paper (full text is denser) × 250 tokens = ~450M tokens
  - @ $0.02/M = **$9**
- Storage: ~36k chars avg × 60k = **~2 GB** full text + ~8 GB new evidence_chunks table growth + proportional HNSW index growth

### Wall-clock

- ~60k API calls / 5 req/s = **3.3 hours**
- Chunking + embedding lag: background

---

## 6. Phase 2C — OA PDFs via Unpaywall + Grobid

Heaviest phase. Only attempt if Phase 2A+2B did not close the retrieval quality gap.

### Scope

```sql
-- Survivors that Phase 2B did NOT cover (no full text yet, no pmcid/pmid path).
SELECT count(*)
  FROM research_articles
 WHERE title_filter_decision = 'relevant'
   AND is_deleted = false
   AND (full_text IS NULL OR full_text = '')
   AND doi IS NOT NULL  -- Unpaywall needs DOI
   AND fulltext_probed_at IS NULL;  -- haven't checked yet
```

Expected: ~80-100k survivors.

### Three new tools

1. **Unpaywall client** — probe OA URL for each DOI.
2. **PDF downloader** — stream PDFs from publisher URLs, respect per-domain rate limits.
3. **Grobid** — self-hosted on Hetzner, parses PDFs to TEI XML.

### 6.1 Unpaywall

- **Endpoint:** `GET https://api.unpaywall.org/v2/{doi}?email=info@emersus.ai`
- **Rate limit:** 100,000 calls/day, registered via email in URL
- **Response field:** `best_oa_location.url_for_pdf` (preferred), `best_oa_location.url` as fallback
- **Free**

Cache all Unpaywall responses. A new table is appropriate:

```sql
CREATE TABLE unpaywall_cache (
  doi          text PRIMARY KEY,
  oa_status    text,         -- 'gold', 'green', 'hybrid', 'bronze', 'closed'
  oa_url       text,         -- best_oa_location.url_for_pdf or .url
  is_oa        boolean NOT NULL,
  raw          jsonb,        -- full response, for debugging
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
```

### 6.2 PDF downloader

- Use `fetch` with 30s timeout + exponential backoff (3 retries).
- Stream to `/home/emersus/data/pdfs/{sha256_of_url}.pdf` on Hetzner.
- **Important:** per-domain rate limit (max 3 concurrent per publisher domain).
- Skip PDFs >50 MB (abuse or malformed).
- On 403/429: back off and mark `fulltext_probed_at = now(), has_full_text = false`.

### 6.3 Grobid on Hetzner

```bash
# On Hetzner:
docker run -d --name grobid --rm -p 8070:8070 \
  --memory="4g" --cpus="4" \
  lfoppiano/grobid:0.8.1
```

Health check: `curl http://localhost:8070/api/version`.

**API:** `POST http://localhost:8070/api/processFulltextDocument` with multipart form, field `input=@file.pdf`. Returns TEI XML.

Throughput: ~100 papers/min on 4 cores. 100k papers = ~17 hours of Grobid time.

### 6.4 TEI XML → structured text

TEI XML sections: `<TEI>/<text>/<body>/<div>` recursively. Same rules as JATS:
- Keep section titles + paragraph text
- Drop references (`<listBibl>`), figures (`<figure>`), tables (`<table>`), formulas
- Use `@type` attribute on `<div>` to detect Methods / Results / Discussion / Conclusion

Package `xml-js` or `fast-xml-parser` works. There's also a TEI-specific package `tei-viewer` (probably over-kill).

### 6.5 Quality filters (crucial — PDF extraction fails often)

Reject extracted text if any of:
- Length < 1,000 chars → likely a scanned PDF that Grobid couldn't parse
- Length > 500k chars → likely a book or misparse
- Non-ASCII ratio > 40% → OCR garbage
- Repeated-lines ratio > 30% → headers/footers leaked in
- No section structure detected → probably failed parse

Store rejection reason in a `fulltext_reject_reason` column (add in schema changes).

### 6.6 Pipeline

```
scripts/fulltext-enrichment/
  ├─ unpaywall-probe.js          # POST all DOIs, populate unpaywall_cache
  ├─ pdf-download.js             # stream OA PDFs to disk, record metadata
  ├─ grobid-process.js           # dispatch PDFs to Grobid, save TEI XML
  ├─ grobid-extract.js           # TEI XML → full_text, UPDATE research_articles
  ├─ lib/unpaywall.js
  ├─ lib/rate-limiter-per-domain.js
  ├─ lib/pdf-download.js
  ├─ lib/grobid-client.js
  ├─ lib/tei-parser.js
  └─ lib/quality-gate.js
```

Pipeline sequence (run from Hetzner, not local — PDFs live there):
1. `unpaywall-probe.js` — ~80k DOIs / 100k daily quota fits in one day
2. `pdf-download.js` — ~80k × ~2 MB = ~160 GB; may take 1-2 days; per-domain rate limits
3. `grobid-process.js` — ~17 hours Grobid compute
4. `grobid-extract.js` — parse TEI, UPDATE DB (idempotent; can re-run)

### Schema changes (for Phase 2C)

```sql
-- supabase/20260424_fulltext_columns.sql
ALTER TABLE research_articles
  ADD COLUMN IF NOT EXISTS fulltext_probed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulltext_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS oa_status TEXT;

CREATE TABLE IF NOT EXISTS unpaywall_cache (
  doi text PRIMARY KEY,
  oa_status text,
  oa_url text,
  is_oa boolean NOT NULL,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Index for resume queries
CREATE INDEX IF NOT EXISTS fulltext_pending_idx
  ON research_articles (pmid)
  WHERE title_filter_decision = 'relevant'
    AND is_deleted = false
    AND (full_text IS NULL OR full_text = '')
    AND fulltext_probed_at IS NULL;
```

Apply with `cat FILE.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1"` per memory.

### Cost

- Unpaywall: free
- PDF downloads: free (bandwidth from Hetzner; 16 TB monthly allowance on current plan)
- Grobid: free (self-hosted)
- **Embedding new chunks:**
  - ~70k successful extractions × ~40 chunks × 300 tokens = ~840M tokens
  - @ $0.02/M = **$16.80**
- **Storage:**
  - PDFs: ~160 GB intermediate (delete after Grobid processes — keep TEI XML as ~10 GB)
  - Full text in DB: ~36k chars avg × 70k = ~2.5 GB
  - New chunks: ~12 GB table growth + HNSW index growth
  - **Total DB growth: ~15 GB** (current 8 GB → 23 GB)
  - Hetzner has 160 GB SSD, plenty of room

### Wall-clock

- Unpaywall probe: ~15 min
- PDF downloads: 24-48h (rate-limited per publisher)
- Grobid processing: ~17h
- Extraction UPDATE: ~1h
- Chunking + embedding lag: background, ~1-2 days
- **End-to-end: ~3-4 days including chunker catching up**

### Risks / things that will go wrong

1. **Publisher blocks:** some publisher CDNs (Elsevier, Wiley) aggressively block scrapers. Expected failure rate: 15-25%. Handle gracefully.
2. **Grobid OOM on giant PDFs:** add timeout per PDF (120s); kill + skip.
3. **HNSW index bloat:** adding 2-3M chunks will fragment HNSW. Per memory, `REINDEX CONCURRENTLY` when query latency degrades (monitor with `scripts/eval/retrieval-eval.js`).
4. **Legal:** Unpaywall-returned URLs are explicitly OA. For DOIs that aren't in Unpaywall's index, DO NOT attempt Sci-Hub or similar — keep these abstract-only.
5. **Disk pressure:** delete PDFs after Grobid ingests them to avoid disk-full. TEI XML takes ~100 KB vs PDF 2 MB.

---

## 7. Chunking updates needed (applies to all phases)

Current `shared/chunker.js` (verify path) likely produces 1-3 chunks per abstract. For full text, it needs to:
- Split by JATS/TEI section boundaries first
- Within a section, further split if > 500 tokens (overlap 50 tokens)
- Produce `chunk_type` metadata: `'title' | 'abstract' | 'body_intro' | 'body_methods' | 'body_results' | 'body_discussion' | 'body_conclusion'`
- `evidence_chunks.chunk_type` already exists (per `20260423_match_evidence_chunks_v4.sql`); extend the enum

Also consider: per memory `project_retrieval_phase2_phase3_pending`, there's an open question about **contextual embeddings** (Anthropic-style chunk context prefixes). If Phase 2C lands substantial new chunks, it's worth re-running the contextualization trial at `scripts/eval/contextualization-trial.js` BEFORE committing to non-contextual embeddings on all the new chunks.

---

## 8. Monitoring during each phase

- After every 10k rows processed: sanity sample 50 abstracts / 20 full texts, eyeball for gibberish
- Watch pgboss queue for backpressure: `SELECT queue, count(*) FROM pgboss.job WHERE state='created' GROUP BY queue;`
- Watch HNSW index health: if retrieval latency climbs > 300ms p95, pause and REINDEX

---

## 9. Rollback

### Abstract enrichment (Phase 2A)
```sql
UPDATE research_articles
   SET abstract = NULL,
       content_source = NULL,
       chunks_sectioned_at = NULL,
       updated_at = now()
 WHERE content_source LIKE 'phase2a_enrich_%';
-- Then delete chunks:
DELETE FROM evidence_chunks WHERE pmid IN (SELECT pmid FROM research_articles WHERE content_source LIKE 'phase2a_enrich_%');
```

### Full text (Phase 2B / 2C)
```sql
UPDATE research_articles
   SET full_text = NULL,
       has_full_text = false,
       content_source = CASE WHEN content_source LIKE 'phase2b_%' OR content_source LIKE 'phase2c_%' THEN NULL ELSE content_source END,
       fulltext_probed_at = NULL,
       chunks_sectioned_at = NULL
 WHERE content_source LIKE 'phase2b_%' OR content_source LIKE 'phase2c_%';
```

Each phase is independently reversible via the `content_source` tag.

---

## 10. Success criteria

Per phase:

### Phase 2A
- [ ] ~180k+ rows now have abstracts (survivor count minus ~5k upstream-null-abstract rows)
- [ ] Chunking caught up: `research_articles` rows with `chunks_sectioned_at IS NULL AND abstract IS NOT NULL` = 0 within 24h of enrichment finish
- [ ] Retrieval eval recall improves by > 5 percentage points on the known-failing fixtures at `scripts/eval/fixtures/retrieval.json`

### Phase 2B
- [ ] ~50k+ rows now have full_text (PMC-OA subset of survivors)
- [ ] Chunking produces > 10 chunks per full-text row (sanity check)
- [ ] Retrieval eval recall improves further by > 3 pp

### Phase 2C
- [ ] ~60k+ rows have full_text (OA PDF-parsed subset)
- [ ] Quality gate rejects < 25% of attempted extractions
- [ ] Retrieval eval recall improves by > 5 pp vs end-of-2B baseline
- [ ] HNSW query latency stays under 200ms p95

---

## 11. File layout deliverable

```
supabase/
  ├─ 20260424_fulltext_columns.sql                       # Phase 2C only
scripts/
  ├─ abstract-enrichment/                                # Phase 2A
  │   ├─ README.md
  │   ├─ lib/pg.js
  │   ├─ lib/rate-limiter.js
  │   ├─ enrich-openalex.js
  │   ├─ enrich-s2.js
  │   ├─ enrich-europepmc.js
  │   └─ enrich-openaire.js
  ├─ fulltext-enrichment/                                # Phases 2B + 2C
  │   ├─ README.md
  │   ├─ lib/pg.js
  │   ├─ lib/rate-limiter-per-domain.js
  │   ├─ lib/unpaywall.js
  │   ├─ lib/pdf-download.js
  │   ├─ lib/grobid-client.js
  │   ├─ lib/jats-parser.js
  │   ├─ lib/tei-parser.js
  │   ├─ lib/quality-gate.js
  │   ├─ enrich-europepmc-jats.js                        # Phase 2B
  │   ├─ unpaywall-probe.js                              # Phase 2C
  │   ├─ pdf-download.js                                 # Phase 2C
  │   ├─ grobid-process.js                               # Phase 2C
  │   └─ grobid-extract.js                               # Phase 2C
docs/superpowers/specs/
  └─ 2026-04-23-full-text-retrieval-design.md            # this file (already exists, update as implementation evolves)
```

---

## 12. Cost + time summary

| Phase | Embedding cost | Other cost | Wall-clock | Eng effort |
|---|---|---|---|---|
| 2A abstracts | $6 | $0 | ~5h API + hours chunking | 2-3 days |
| 2B EuropePMC | $9 | $0 | ~4h API + hours chunking | 1-2 days |
| 2C Unpaywall/Grobid | $17 | $0 | ~3 days | 1-2 weeks |
| **Total** | **~$32** | **$0** | ~4 days end-to-end | **~3-4 weeks eng** |

---

## 13. Gotchas learned from the title-filter work (apply here)

1. **Use text-embedding-3-small, not -large**: evidence_chunks is 1536-dim. The large model is 3072-dim and will not fit.
2. **supabase_admin for ALTER TABLE**: postgres user will error with "must be owner".
3. **Batch API supports `/v1/responses`** (confirmed 2026-04-23) if any phase uses LLM classification.
4. **Don't scp migration SQL files to Hetzner**: pipe via `cat | ssh`. scp'd files break next webhook git pull.
5. **Strict:true superset-data pattern** for any tool calls (per `feedback_openai_strict_mode`).
6. **Local dev points at prod Supabase.** Every UPDATE in this spec hits live data. Smoke test with `--max-rows=50` before full runs.
7. **`.md` files are gitignored.** This spec stays local; never `git add`.
8. **Memory is at `~/.claude/projects/C--Users-Sidar-Desktop-emersus/memory/`.** Consult before committing to architectural decisions.

---

## 14. Handoff checklist for the receiving instance

Before you write any code, confirm:
- [ ] Title-filter batch has `pending = 0` per the pre-flight SQL
- [ ] SSH tunnel to Hetzner Postgres works (`psql "$DATABASE_URL" -c 'select now()'`)
- [ ] `$OPENAI_API_KEY` is available locally (check `.env`)
- [ ] `S2_API_KEY` is on Hetzner (if not, ask Sidar)
- [ ] `emersus-worker` pm2 process is up (`pm2 status`)
- [ ] Chunking + embedding pgboss queues are draining (`SELECT state, count(*) FROM pgboss.job ... GROUP BY state`)

Then:
- [ ] Start with Phase 2A, smallest source first (core if licensed, else europepmc 7k).
- [ ] Smoke test each script with `--max-rows=50` before full runs.
- [ ] Gate Phase 2C on Phase 2A+2B eval delta.

When phasewise work completes, run `scripts/eval/retrieval-eval.js` to confirm retrieval improved, and record the baseline in `scripts/eval/baselines/`.
