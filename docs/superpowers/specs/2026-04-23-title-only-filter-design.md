# Title-only source filter — design

**Date:** 2026-04-23
**Status:** spec — pending user review
**Author:** collaborative (Claude + Sidar)

## Problem

Of ~1.44M rows in `research_articles`, **~296k have no abstract** (`abstract IS NULL OR abstract = ''`). These are ingestion drop-offs — the source API returned a title and metadata but no abstract. Breakdown:

| source | title-only | total | % title-only | has evidence_chunks |
|---|---|---|---|---|
| openalex | 234,044 | 470,326 | 49.8% | 0 |
| semantic-scholar | 25,220 | 46,986 | 53.7% | 0 |
| openaire | 14,125 | 124,695 | 11.3% | 0 |
| europepmc | 10,383 | 257,475 | 4.0% | 0 |
| pubmed | 6,848 | 417,946 | 1.6% | 4,229 |
| core | 5,474 | 49,593 | 11.0% | 0 |

We want to retrieve abstracts/full text for the relevant ones — but that pipeline is non-trivial (different API per source, rate limits, storage) and would waste work on papers we don't want anyway. Before enrichment, **filter out titles that are clearly off-scope for exercise science / sports nutrition**.

## Scope

**In scope for this spec:**
- Classify 5 sources' title-only rows: openalex, semantic-scholar, openaire, europepmc, core. Total ~289k.
- Soft-delete rows classified as irrelevant (`is_deleted = true`) and stamp provenance on 3 new columns.
- Calibration gate before the full run.

**Explicitly out of scope:**
- **Pubmed title-only rows (6.8k).** User decision 2026-04-23: leave untouched. 4.2k of these have chunks that contribute to retrieval; rather than filter them, a future enrichment pass (pubmed efetch retry) may recover their abstracts.
- **Enrichment pipeline.** Per user decision "C" (aggressive filter first, re-evaluate after), enrichment is a follow-up spec once we see what survives.
- **Cross-source DOI dedup.** Known pre-existing limitation; not unique to this filter.

## Non-goals

- Training a persistent reusable classifier. For 289k one-shot rows + future monthly deltas of ~10k, direct LLM classification is cheaper and more accurate than a fresh LogReg (~$9 vs ~1 day of labeling work).
- Three-way classification with a "review" bucket. User decision: drop uncertain titles. The prompt explicitly biases the LLM toward `irrelevant` when unsure.

## Approach

**Direct LLM classification (gpt-4.1-mini) with a calibration gate.**

Rejected alternatives:
- **Centroid distance + existing LogReg weights on title embeddings** — $0.60 cost but weights were trained on per-paper mean *chunk* embeddings, different vector distribution than single-title embeddings. Unquantified accuracy risk on 15-token inputs.
- **Train a title-specific LogReg on 500 labeled titles** — rigorous but 1-2 days of work to save $9 of LLM calls. Not worth it for one-shot scope.

## Re-ingestion protection

Both ingestion paths use `ON CONFLICT DO NOTHING` on `(source, external_id)`:
- `jobs/ingest-openalex-bulk.js:99-125`
- `jobs/ingest-topic-from-source.js:75-110`

Setting `is_deleted = true` leaves the row occupying its `(source, external_id)` slot, so future ingests silently bounce off. Existing precedent: OpenAlex bulk already uses `is_deleted=true` to mark DROP-type rows as dedup placeholders.

Retrieval is unaffected: 289k of the 289k in-scope rows have 0 evidence_chunks entries, so they're not in the HNSW index.

## Schema changes

```sql
-- supabase/20260424_title_filter_columns.sql

ALTER TABLE research_articles
  ADD COLUMN title_filter_decision TEXT,
  ADD COLUMN title_filter_model    TEXT,
  ADD COLUMN title_filter_at       TIMESTAMPTZ;

ALTER TABLE research_articles
  ADD CONSTRAINT title_filter_decision_values
  CHECK (title_filter_decision IS NULL OR title_filter_decision IN ('relevant','irrelevant'));

CREATE INDEX title_filter_pending_idx
  ON research_articles (pmid)
  WHERE title_filter_decision IS NULL
    AND is_deleted = false
    AND (abstract IS NULL OR abstract = '')
    AND source IN ('openalex','semantic-scholar','openaire','europepmc','core');

-- Separate table keeps research_articles lean (1.7 GB vector bloat avoided on
-- the hot table). Join cost is negligible; embeddings are only used for
-- calibration sampling and potential future title-level retrieval.
CREATE TABLE research_article_title_embeddings (
  pmid      bigint PRIMARY KEY REFERENCES research_articles(pmid) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  embedded_at timestamptz DEFAULT now()
);
```

## Pipeline

Six ordered steps. Each is idempotent and resumable.

### Step 1 — Embed 289k titles

Script: `scripts/title-filter/embed-titles.js`

Iterate `WHERE title_filter_decision IS NULL AND (abstract IS NULL OR abstract = '') AND source IN (...) AND pmid NOT IN (SELECT pmid FROM research_article_title_embeddings)` in 1000-row batches. Batch 100 titles per OpenAI embedding call (text-embedding-3-large). Insert into `research_article_title_embeddings`.

Cost: ~289k × ~15 tokens × $0.13/M = **~$0.60**. Wall clock: ~2 hours.

### Step 2 — Stratified calibration sample

Script: `scripts/title-filter/export-calibration-sample.sql`

Sample 230 titles:
- 50 per distance band to `fitness_v1` centroid: `<0.45`, `0.45–0.55`, `0.55–0.65`, `>0.65` (200 total, stratified by source within each band)
- 30 uniform-random from the full pending set

Export to `scripts/title-filter/data/calibration-230.jsonl`.

### Step 3 — LLM classifies the 230

Script: `scripts/title-filter/label-calibration.js`

Uses the production prompt (Section "Prompt") with gpt-4.1-mini in batches of 50. Writes results to `scripts/title-filter/data/calibration-230-labeled.jsonl`.

### Step 4 — Human spot-check 30

Script: `scripts/title-filter/build-spotcheck.js` generates `scripts/title-filter/data/spotcheck-30.md` — a markdown table with 30 stratified rows (including every ambiguous-looking case), blank human-label column. User fills it in, runs `scripts/title-filter/score-spotcheck.js` to compute agreement.

**Gate:**
- **≥ 90% agreement** → proceed to Step 5.
- **80–89%** → inspect failures, refine prompt, re-run Step 3 on same 230.
- **< 80%** → abandon Approach 3, fall back to training a title-specific LogReg (Approach 2).

### Step 5 — Full run

Script: `scripts/title-filter/run-full-filter.js`

```
loop:
  select 500 pmids where title_filter_decision is null and ... (partial index)
  split into 10 batches of 50 titles
  5 concurrent LLM calls (gpt-4.1-mini, strict:true classify_titles tool)
  per batch: UPDATE research_articles SET title_filter_decision=..., is_deleted = (decision='irrelevant'), title_filter_model=..., title_filter_at=now() WHERE pmid IN (...)
  log: N classified, M relevant, K irrelevant, rate
  sleep on 429s with exponential backoff
until zero pending
```

Cost: 289k × ~50 tokens in / ~5 tokens out × gpt-4.1-mini pricing ≈ **~$9**.
Wall clock: ~4–6 hours at 5 concurrent requests.

**Resumable:** re-running the script picks up where it left off via the partial index.

### Step 6 — Post-run sanity review

Script: `scripts/title-filter/post-run-review.sql`

Outputs:
- Drop rate per source
- Drop rate per fitness-centroid distance band (sanity: higher bands should drop more)
- 50 random KEPT titles (should look ~all on-topic)
- 50 random DROPPED titles (should look ~all off-topic)
- For the 4k pubmed-chunk-LogReg-dropped papers: cross-check title-filter decision. Expect high agreement (~85%+); significant divergence flags a prompt issue.

## Prompt

System prompt (stored in `scripts/title-filter/lib/prompt.js`):

```
You classify scientific paper titles by whether they fall within the scope
of an exercise-science / sports-nutrition research chat assistant.

RELEVANT means the title is about one or more of:
- Exercise physiology (cardiorespiratory, muscular, metabolic responses to exercise)
- Resistance training, endurance training, concurrent training, periodization
- Sports nutrition (macros, hydration, supplements, ergogenic aids, nutrient timing)
- Body composition, weight management, recovery, sleep-for-athletes
- Sports medicine (injury prevention and rehab in active populations, return-to-play)
- Mental health, stress, motivation as they affect training or athletic performance
- Health-related physical activity applicable to training recommendations
- Methodology papers directly about the above (e.g., VO2max testing protocols)

IRRELEVANT means the title is about something else, including but not limited to:
- Clinical medicine unrelated to activity/nutrition (cancer chemotherapy, cardiac
  surgery, psychiatric pharmacology, infectious disease treatment, surgical technique)
- Animal, cell, or molecular studies with no obvious translation to human
  athletic performance or training
- Veterinary medicine, agricultural science, food industry topics
- Non-biomedical topics (economics, humanities, materials science, etc.)
- Case reports on rare pathologies without training/nutrition angle

When a title is genuinely ambiguous (e.g., could be clinical-only OR could
inform training), lean IRRELEVANT. This filter is aggressive by design.

Output one decision per input title. Use the classify_titles tool.
```

Tool schema (strict:true superset-data pattern per `feedback_openai_strict_mode`):

```json
{
  "type": "function",
  "function": {
    "name": "classify_titles",
    "strict": true,
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": ["classifications"],
      "properties": {
        "classifications": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["pmid", "decision"],
            "properties": {
              "pmid": {"type": "integer"},
              "decision": {"type": "string", "enum": ["relevant","irrelevant"]}
            }
          }
        }
      }
    }
  }
}
```

User message format (batch of 50):
```
Classify these 50 titles. Output exactly 50 classifications, one per pmid.

1. pmid=12345 | title="Effects of beta-alanine supplementation on HIIT in trained cyclists" | journal="Eur J Appl Physiol"
2. pmid=67890 | title="Novel silicon-germanium alloys for photovoltaics" | journal="Appl Surf Sci"
...
```

## Rollback

One UPDATE, keyed on model version for precision:

```sql
UPDATE research_articles
SET is_deleted = false,
    title_filter_decision = NULL,
    title_filter_model = NULL,
    title_filter_at = NULL
WHERE title_filter_decision = 'irrelevant'
  AND title_filter_model = 'gpt-4.1-mini-2026-03-14';  -- whatever was used
```

No `evidence_chunks` deletions happen in this spec (per user: skip pubmed; other sources have 0 chunks).

## Monitoring during the full run

Log every 1k rows classified:
- pending count (from partial index)
- relevant / irrelevant counts this session
- total cost (tokens × rate)
- ETA
- any 429/5xx error counts

Abort-and-investigate conditions:
- Error rate > 5% → investigate before continuing
- Drop rate outside 30–70% per source → prompt issue
- Per-batch drop rate oscillating wildly → LLM instability, refine prompt

## Success criteria

1. Calibration spot-check agreement ≥ 90%.
2. All 289k rows classified (pending count = 0).
3. Full-run cost ≤ $15 (buffer over $9 estimate).
4. Wall clock ≤ 12 hours.
5. Post-run sample review shows:
   - 50/50 kept titles look on-topic (≥ 95%)
   - 50/50 dropped titles look off-topic (≥ 95%)
   - Cross-check with chunk-LogReg on pubmed subset shows ≥ 85% agreement.

## Future work (out of scope, for reference)

1. **Enrichment pipeline** for rows that survive: openalex `abstract_inverted_index` → decode; s2 API; europepmc API; openaire API; CORE (license pending). Sequenced per-source.
2. **Hook into new-ingest path** so fresh title-only rows are classified inline before chunking is attempted.
3. **Monthly delta run** — same script, resumes automatically via partial index. Estimated cost ~$0.30 per 10k delta.
4. **Pubmed title-only handling** — revisit separately; likely an efetch retry rather than a classify-and-drop.
