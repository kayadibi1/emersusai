# Phase 2F — Multi-Source OA Full-Text Sweep

**Date:** 2026-04-24  
**Status:** Approved for implementation  
**Goal:** Programmatically recover full texts for the ~80k Phase 2A survivors that have a DOI but no full text, using five OA data sources in priority order, with a pluggable IP-bypass proxy layer.

---

## Background

Phases 2B (EuropePMC JATS), 2C (Unpaywall + Grobid), and 2E (gap-fill strategies) collectively recovered ~2,000 full texts (~2.4% of 82k Phase 2A survivors). The remaining gap is primarily publisher IP-blocking of the Hetzner server ASN. Cookie-based auth (JHU OpenAthens) achieves 16–17% hit rate but requires manual re-export. Phase 2F takes a purely programmatic approach: query OA-specific fields from five sources that are either text-API responses (no download needed) or curated OA PDF URLs (where anti-bot, not paywalls, is the barrier).

---

## Architecture Overview

`scripts/fulltext-enrichment/phase2f-sweep.js` orchestrates a batch sweep over all rows matching:

```sql
has_full_text = false
AND content_source LIKE 'phase2%'
AND doi IS NOT NULL
```

Rows are processed in batches of 50. Per row, five strategies are attempted in priority order — first success wins, remaining strategies are skipped. Results write back to `research_articles` and emit chunks to `data/chunks-phase2f.jsonl`. After the sweep, existing `fulltext-chunk-submit.js` + `fulltext-chunk-apply.js` handle embedding and insertion into `evidence_chunks`.

A companion Cloudflare Worker (`infra/cf-proxy-worker/index.js`) serves as the download relay for IP-blocked PDF fetches. All API calls (CORE, S2, OpenAlex, CrossRef, IA Scholar) go direct; only PDF CDN downloads use the proxy on 403 retry.

---

## Source Strategies

Attempted in order S0 → S4. First success wins.

| # | Source | Endpoint | Returns | Needs Grobid | Rate limit |
|---|--------|----------|---------|--------------|------------|
| S0 | CORE | `GET /v3/works?doi={doi}` | Parsed full text | No | 10 RPS (API key) |
| S1 | Semantic Scholar | `GET /graph/v1/paper/DOI:{doi}?fields=openAccessPdf` | PDF URL | Yes | 1 RPS (unauthed) / 10 RPS (`S2_API_KEY` — reuse from Phase 2A) |
| S2 | OpenAlex | `GET /works/https://doi.org/{doi}?select=open_access,primary_location` | PDF URL | Yes | 10 RPS |
| S3 | CrossRef | `GET /works/{doi}?mailto=info@emersus.ai` → `link[]` filtered to `content-type: application/pdf` | PDF URL | Yes | 50 RPS (polite pool) |
| S4 | Internet Archive Scholar | `GET /api/search?q=doi:{doi}` | PDF URL | Yes | 3 RPS |

**S0 rationale:** CORE returns pre-parsed text — no download, no Grobid, no proxy usage. Highest priority.  
**S1/S2 rationale:** Both curate OA-only fields; coverage complementary to Unpaywall.  
**S3/S4 rationale:** Long-tail coverage. CrossRef links are publisher-deposited (authoritative but lower hit rate). IA Scholar covers green OA and older papers.

Each strategy is a separate file under `scripts/fulltext-enrichment/lib/`:
- `fetch-core-doi.js`
- `fetch-s2-pdf.js`
- `fetch-openalex-oa.js`
- `fetch-crossref-links.js`
- `fetch-ia-scholar.js`

Each exports: `fetchForDoi(doi, pg) → { text?, pdfUrl?, source } | null`

---

## Proxy Layer

**Module:** `scripts/fulltext-enrichment/lib/proxy-http.js`

**Interface:** `downloadPdf(url, opts) → { buffer, contentType, via }`

**Behavior:**
1. Direct fetch with realistic headers (`User-Agent`, `Accept`, `Referer` set to `https://doi.org/{doi}`).
2. On 403 / 407 / 429 → retry once through `process.env.PROXY_URL`.
3. On proxy failure → throw `{ code: 'PROXY_BLOCKED' }`. Orchestrator tags row `phase2f_proxy_blocked` and continues. These rows remain eligible for future cookie-based runs.

`via` field in return value is `'direct'` or `'proxy'` for per-run logging.

**Cloudflare Worker** (`infra/cf-proxy-worker/index.js`):
- `GET /?url=<encoded>` — validates URL is not localhost/RFC-1918, fetches, streams response with original `Content-Type`.
- Deployed to `proxy.emersus.workers.dev` (or equivalent).
- `PROXY_URL=https://proxy.emersus.workers.dev` set in `~/app/.env` on Hetzner.
- Free tier: 100k req/day — sufficient for the one-time bulk run and ongoing handler.

**Swap path:** Changing `PROXY_URL` to any `http://` or `socks5://` address (Bright Data, Fly.io relay, Tor) requires zero code changes.

---

## Data Flow

```
phase2f-sweep.js
  └─ for each gap row (doi NOT NULL, has_full_text=false)
       ├─ S0: fetch-core-doi      → text? ──────────────────────────┐
       ├─ S1: fetch-s2-pdf        → pdfUrl? → proxy-http → Grobid  │
       ├─ S2: fetch-openalex-oa   → pdfUrl? → proxy-http → Grobid  ├─ write full_text
       ├─ S3: fetch-crossref-links→ pdfUrl? → proxy-http → Grobid  │  tag phase2f_<source>
       └─ S4: fetch-ia-scholar    → pdfUrl? → proxy-http → Grobid  │  emit to chunks-phase2f.jsonl
                                                                     └─────────────────────────────
  └─ exhausted → tag phase2f_exhausted (no full_text written)

chunks-phase2f.jsonl
  └─ fulltext-chunk-submit.js → OpenAI Batch API (text-embedding-3-small)
  └─ fulltext-chunk-apply.js  → INSERT INTO evidence_chunks (ON CONFLICT DO NOTHING)
```

---

## Error Taxonomy

| Tag | Meaning |
|-----|---------|
| `phase2f_core` | CORE returned parsed text directly |
| `phase2f_s2` | S2 openAccessPdf URL → Grobid success |
| `phase2f_openalex` | OpenAlex OA URL → Grobid success |
| `phase2f_crossref` | CrossRef PDF link → Grobid success |
| `phase2f_ia` | IA Scholar PDF → Grobid success |
| `phase2f_exhausted` | All five strategies returned null |
| `phase2f_proxy_blocked` | URL found but 403 on both direct + proxy |
| `phase2f_grobid_fail` | PDF downloaded but Grobid couldn't parse |
| `phase2f_rejected_short` | Parsed text < 1000 chars |

---

## Resumability

The sweep adds `AND content_source NOT LIKE 'phase2f%'` to the row query. Every row Phase 2F finishes — success or failure — gets a `phase2f_*` tag, so re-running the script skips already-processed rows. `fulltext_probed_at` is not used here because Phase 2C already sets it on all its rows (success and fail), which would cause Phase 2F to skip them incorrectly.

---

## Ongoing pg-boss Handler (Future)

`jobs/fulltext-phase2f.js` — thin wrapper. Receives `{ articleId }` from queue, loads the row's DOI, calls the same five strategy functions from `lib/`, writes result. Triggered by the existing article-ingestion handler after Phase 2A classification completes. No new infrastructure — same `proxy-http.js`, same env vars, same Grobid container.

---

## Files Changed / Created

### New
- `scripts/fulltext-enrichment/phase2f-sweep.js`
- `scripts/fulltext-enrichment/lib/fetch-core-doi.js`
- `scripts/fulltext-enrichment/lib/fetch-s2-pdf.js`
- `scripts/fulltext-enrichment/lib/fetch-openalex-oa.js`
- `scripts/fulltext-enrichment/lib/fetch-crossref-links.js`
- `scripts/fulltext-enrichment/lib/fetch-ia-scholar.js`
- `scripts/fulltext-enrichment/lib/proxy-http.js`
- `infra/cf-proxy-worker/index.js`

### Unchanged
- `scripts/fulltext-enrichment/lib/grobid-client.js`
- `scripts/fulltext-enrichment/lib/fulltext-chunker.js`
- `scripts/fulltext-enrichment/lib/tei-parser.js`
- `scripts/fulltext-enrichment/fulltext-chunk-submit.js`
- `scripts/fulltext-enrichment/fulltext-chunk-apply.js`

---

## Out of Scope

- Cookie-based publisher auth (separate manual effort, existing Phase 2C handles it)
- arXiv / OSF / PsyArxiv preprint stubs (already partially handled in Phase 2E Strategy 2; extend there, not here)
- Repository long-tail HTML parsers (dspace, scholarworks etc.) — too low yield to build now
