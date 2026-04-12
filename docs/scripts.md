# Scripts reference

All scripts are ES modules, run via `node` or the `npm run` aliases below. They load env from `.env.local` through `api/lib/clients.js`.

⚠️ **These scripts write to PRODUCTION.** `.env.local` points at the live Hetzner Supabase (`https://supabase.emersus.ai`). Any `fill:*` / `embed:*` / `import:*` run will modify real data. Confirm intent before running locally.

## package.json scripts
| Command | File | Purpose |
|---|---|---|
| `npm run fetch:pmc` | `scripts/fetch-pmc-fulltext.js` | Download PubMed Central full-text XMLs, parse into title/abstract/body. |
| `npm run fill:pmc` | `scripts/fill-pmc-corpus.js` | Load parsed PMC docs into `knowledge_documents`. |
| `npm run fill:pmc:topics` | `scripts/fill-pmc-topics.js` | Classify PMC docs by topic (strength / cardio / nutrition / mental_performance) via OpenAI. Batched. |
| `npm run import:pubmed` | `scripts/import-pubmed.js` | Ingest raw MEDLINE downloads (PubMed records, separate from PMC full text). |
| `npm run embed:evidence` | `scripts/embed-evidence.js` | Generate embeddings for all rows in `knowledge_documents` via OpenAI `text-embedding-3-small`. Batched + retryable. |
| `npm run test:retrieval` | `scripts/test-retrieval.js` | Smoke test: run `retrieveDatabaseEvidence()` against a sample query, print ranked results. |
| `npm run test:visual-artifacts` | `scripts/test-visual-artifacts.js` | Test widget HTML rendering pipeline. |
| `npm run test:widget-fence` | `scripts/test-widget-fence-routing.js` | Verify widget fence parser routes correctly by type. |

## Typical pipeline
1. `fetch:pmc` → raw XMLs cached to disk.
2. `fill:pmc` → rows inserted into `knowledge_documents`.
3. `fill:pmc:topics` → topic tags assigned.
4. `embed:evidence` → embeddings computed, stored in pgvector column.
5. `test:retrieval` → confirm search works end-to-end.

## `scripts/import-usda-foods.js`

One-time USDA FoodData Central importer. Loads Foundation, SR Legacy,
FNDDS, and Branded datasets into `foods` and `food_nutrients`.

### Usage

```bash
npm run import:usda                              # all four datasets
node scripts/import-usda-foods.js --datasets=foundation,sr_legacy
node scripts/import-usda-foods.js --resume       # pick up from checkpoint
node scripts/import-usda-foods.js --dry-run      # parse without writes
```

### Notes

- Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env.
- ~15 GB free disk needed (downloads, unzipped JSON, Postgres growth).
- Full run takes 2–4 hours on the Hetzner box (Foundation + SR +
  FNDDS are ~10 min; Branded is the long tail).
- Stream-parses Branded (1.5 GB unzipped) via `stream-json`.
- Checkpointed: safe to SIGINT and resume with `--resume`.
- Quality filter rejects ~5–15% of Branded rows (no kcal, malformed
  descriptions, negative values).
- Idempotent: re-run safe for quarterly Branded refreshes.
