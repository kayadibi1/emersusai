# Phase 2F — Multi-Source OA Full-Text Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a five-source OA full-text sweep (CORE → S2 → OpenAlex → CrossRef → IA Scholar) for the ~80k Phase 2A survivors without full text, with a Cloudflare Worker relay to bypass IP blocks on PDF downloads.

**Architecture:** Each source is an independent `fetchForDoi(doi)` function returning `{ text?, pdfUrl?, source } | null`. The orchestrator runs them in priority order (first-success-wins); CORE returns text directly, S1–S4 return PDF URLs fed into the existing Grobid pipeline. `proxy-http.js` handles all PDF downloads with automatic 403-retry through `PROXY_URL`. Pagination uses pmid cursor so the script is safe to kill and restart.

**Tech Stack:** Node.js ESM, native `fetch`, Cloudflare Workers + Wrangler CLI, `node:test` + `t.mock.method`, existing `grobid-client.js` / `tei-parser.js` / `fulltext-chunker.js` / `rate-limiter.js`

---

## File Map

### New files created in this plan
| File | Responsibility |
|------|----------------|
| `scripts/cf-proxy-worker/index.js` | CF Worker: validate URL, proxy-fetch from CF edge IP |
| `scripts/cf-proxy-worker/wrangler.toml` | Wrangler deploy config |
| `scripts/fulltext-enrichment/lib/proxy-http.js` | PDF download: direct fetch → 403 retry via `PROXY_URL` |
| `scripts/fulltext-enrichment/lib/fetch-core-doi.js` | S0: CORE API, returns full text directly |
| `scripts/fulltext-enrichment/lib/fetch-s2-pdf.js` | S1: S2 `openAccessPdf.url` |
| `scripts/fulltext-enrichment/lib/fetch-openalex-oa.js` | S2: OpenAlex OA URL fields |
| `scripts/fulltext-enrichment/lib/fetch-crossref-links.js` | S3: CrossRef `link[]` PDF entries |
| `scripts/fulltext-enrichment/lib/fetch-ia-scholar.js` | S4: Internet Archive Scholar |
| `scripts/fulltext-enrichment/phase2f-sweep.js` | Orchestrator: batch cursor sweep + Grobid integration |
| `tests/unit/fulltext-enrichment/proxy-http.test.js` | Unit tests for proxy layer |
| `tests/unit/fulltext-enrichment/fetch-core-doi.test.js` | Unit tests for CORE fetcher |
| `tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js` | Unit tests for S2 fetcher |
| `tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js` | Unit tests for OpenAlex fetcher |
| `tests/unit/fulltext-enrichment/fetch-crossref-links.test.js` | Unit tests for CrossRef fetcher |
| `tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js` | Unit tests for IA Scholar fetcher |

### Existing files read (do not modify)
| File | Interface used |
|------|----------------|
| `scripts/abstract-enrichment/lib/rate-limiter.js` | `new RateLimiter({ rps })` → `await limiter.take()` |
| `scripts/fulltext-enrichment/lib/grobid-client.js` | `processPdf(tmpPath, { fs })` → TEI XML string |
| `scripts/fulltext-enrichment/lib/tei-parser.js` | `parseTeiFullText(xml)` → `{ text, sections: [{title, type, text}] } \| null` |
| `scripts/fulltext-enrichment/lib/fulltext-chunker.js` | `buildBodyChunks({ pmid, sections, provenance })` → chunk array |
| `scripts/abstract-enrichment/lib/pg.js` | `withPg(async fn)` |

---

## Task 1: Cloudflare Worker Proxy

**Files:**
- Create: `scripts/cf-proxy-worker/index.js`
- Create: `scripts/cf-proxy-worker/wrangler.toml`

> Note: `infra/` is gitignored by design. The CF Worker has no secrets, so it lives in `scripts/cf-proxy-worker/` and IS committed. Deploy manually via Wrangler when needed.

- [ ] **Step 1: Create the worker**

```js
// scripts/cf-proxy-worker/index.js
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);
const PRIVATE_HOST_RE = /^(localhost$|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    if (!target) return new Response('missing url param', { status: 400 });

    let parsed;
    try { parsed = new URL(target); }
    catch { return new Response('invalid url', { status: 400 }); }

    if (!ALLOWED_SCHEMES.has(parsed.protocol))
      return new Response('scheme not allowed', { status: 400 });
    if (PRIVATE_HOST_RE.test(parsed.hostname))
      return new Response('private address blocked', { status: 403 });

    const upstream = await fetch(target, {
      headers: {
        'User-Agent': request.headers.get('User-Agent') ?? 'Mozilla/5.0',
        'Accept': request.headers.get('Accept') ?? 'application/pdf,*/*',
        'Referer': request.headers.get('Referer') ?? '',
      },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
        'Content-Length': upstream.headers.get('Content-Length') ?? '',
      },
    });
  },
};
```

- [ ] **Step 2: Create wrangler config**

```toml
# scripts/cf-proxy-worker/wrangler.toml
name = "emersus-pdf-proxy"
main = "index.js"
compatibility_date = "2024-01-01"
```

- [ ] **Step 3: Install Wrangler and deploy**

Run from the repo root (or `scripts/cf-proxy-worker/`):
```bash
npm install -g wrangler
cd scripts/cf-proxy-worker
wrangler login   # opens browser — approve in Cloudflare dashboard
wrangler deploy
```

Expected output: `Published emersus-pdf-proxy (https://emersus-pdf-proxy.<your-subdomain>.workers.dev)`

- [ ] **Step 4: Smoke-test the worker**

```bash
curl -I "https://emersus-pdf-proxy.<your-subdomain>.workers.dev/?url=https%3A%2F%2Fhttpbin.org%2Fget"
```

Expected: `HTTP/2 200`

- [ ] **Step 5: Add PROXY_URL to Hetzner env**

```bash
ssh hetzner "echo 'PROXY_URL=https://emersus-pdf-proxy.<your-subdomain>.workers.dev' >> ~/app/.env"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/cf-proxy-worker/
git commit -m "feat(phase2f): Cloudflare Worker PDF proxy relay"
```

---

## Task 2: proxy-http.js

**Files:**
- Create: `scripts/fulltext-enrichment/lib/proxy-http.js`
- Create: `tests/unit/fulltext-enrichment/proxy-http.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/proxy-http.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

function makeFetchMock(status, { body = PDF_BYTES, contentType = 'application/pdf' } = {}) {
  return async (_url) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => h === 'content-type' ? contentType : null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });
}

test('returns buffer and via=direct on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', makeFetchMock(200));
  const { downloadPdf } = await import('../../../scripts/fulltext-enrichment/lib/proxy-http.js');
  const result = await downloadPdf('https://example.com/paper.pdf', { doi: '10.1000/test' });
  assert.equal(result.via, 'direct');
  assert.equal(result.contentType, 'application/pdf');
  assert.ok(result.buffer.length > 0);
});

test('retries via proxy on 403 and succeeds', async (t) => {
  const originalProxy = process.env.PROXY_URL;
  process.env.PROXY_URL = 'https://test-proxy.workers.dev';
  t.after(() => { process.env.PROXY_URL = originalProxy; });

  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    callCount++;
    // First call (direct) returns 403; second (proxy) returns 200
    return makeFetchMock(callCount === 1 ? 403 : 200)();
  });

  const { downloadPdf } = await import('../../../scripts/fulltext-enrichment/lib/proxy-http.js');
  const result = await downloadPdf('https://example.com/paper.pdf');
  assert.equal(result.via, 'proxy');
  assert.equal(callCount, 2);
});

test('throws PROXY_BLOCKED when proxy also returns 403', async (t) => {
  const originalProxy = process.env.PROXY_URL;
  process.env.PROXY_URL = 'https://test-proxy.workers.dev';
  t.after(() => { process.env.PROXY_URL = originalProxy; });

  t.mock.method(globalThis, 'fetch', makeFetchMock(403));

  const { downloadPdf } = await import('../../../scripts/fulltext-enrichment/lib/proxy-http.js');
  await assert.rejects(
    () => downloadPdf('https://example.com/paper.pdf'),
    (err) => { assert.equal(err.code, 'PROXY_BLOCKED'); return true; }
  );
});

test('throws PROXY_BLOCKED when no PROXY_URL and direct returns 403', async (t) => {
  const originalProxy = process.env.PROXY_URL;
  delete process.env.PROXY_URL;
  t.after(() => { if (originalProxy) process.env.PROXY_URL = originalProxy; });

  t.mock.method(globalThis, 'fetch', makeFetchMock(403));

  const { downloadPdf } = await import('../../../scripts/fulltext-enrichment/lib/proxy-http.js');
  await assert.rejects(
    () => downloadPdf('https://example.com/paper.pdf'),
    (err) => { assert.equal(err.code, 'PROXY_BLOCKED'); return true; }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/proxy-http.test.js
```

Expected: `FAIL` — `Cannot find module '.../proxy-http.js'`

- [ ] **Step 3: Implement proxy-http.js**

```js
// scripts/fulltext-enrichment/lib/proxy-http.js
const RETRY_STATUSES = new Set([403, 407, 429]);

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/pdf,*/*;q=0.9',
};

async function attemptFetch(url, { doi, viaProxy = false } = {}) {
  const proxyUrl = process.env.PROXY_URL;
  const fetchUrl = viaProxy && proxyUrl
    ? `${proxyUrl}?url=${encodeURIComponent(url)}`
    : url;

  return fetch(fetchUrl, {
    headers: {
      ...DEFAULT_HEADERS,
      ...(doi ? { Referer: `https://doi.org/${doi}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });
}

export async function downloadPdf(url, { doi } = {}) {
  let resp = await attemptFetch(url, { doi });
  let via = 'direct';

  if (RETRY_STATUSES.has(resp.status)) {
    const proxyUrl = process.env.PROXY_URL;
    if (!proxyUrl) {
      const err = new Error(`HTTP ${resp.status} with no PROXY_URL`);
      err.code = 'PROXY_BLOCKED';
      throw err;
    }
    resp = await attemptFetch(url, { doi, viaProxy: true });
    via = 'proxy';
    if (!resp.ok) {
      const err = new Error(`Proxy returned HTTP ${resp.status}`);
      err.code = 'PROXY_BLOCKED';
      throw err;
    }
  } else if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.code = `HTTP_${resp.status}`;
    throw err;
  }

  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType, via };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/proxy-http.test.js
```

Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/proxy-http.js tests/unit/fulltext-enrichment/proxy-http.test.js
git commit -m "feat(phase2f): proxy-http download layer with CF Worker fallback"
```

---

## Task 3: fetch-core-doi.js (S0)

**Files:**
- Create: `scripts/fulltext-enrichment/lib/fetch-core-doi.js`
- Create: `tests/unit/fulltext-enrichment/fetch-core-doi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/fetch-core-doi.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeCoreMock(results) {
  return async (_url, _opts) => ({
    ok: true,
    status: 200,
    json: async () => ({ results, totalHits: results.length }),
  });
}

test('returns text when CORE has fullText for DOI', async (t) => {
  const originalKey = process.env.CORE_API_KEY;
  process.env.CORE_API_KEY = 'test-key';
  t.after(() => { process.env.CORE_API_KEY = originalKey; });

  t.mock.method(globalThis, 'fetch', makeCoreMock([{
    fullText: 'This randomized controlled trial examined the effect of creatine supplementation on muscle strength. '.repeat(10),
    doi: '10.1000/test',
  }]));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-core-doi.js');
  const result = await fetchForDoi('10.1000/test');
  assert.ok(result !== null);
  assert.equal(result.source, 'phase2f_core');
  assert.ok(result.text.length >= 500);
  assert.equal(result.pdfUrl, null);
});

test('returns null when CORE has no result', async (t) => {
  const originalKey = process.env.CORE_API_KEY;
  process.env.CORE_API_KEY = 'test-key';
  t.after(() => { process.env.CORE_API_KEY = originalKey; });

  t.mock.method(globalThis, 'fetch', makeCoreMock([]));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-core-doi.js');
  const result = await fetchForDoi('10.1000/missing');
  assert.equal(result, null);
});

test('returns null when CORE_API_KEY is not set', async (t) => {
  const originalKey = process.env.CORE_API_KEY;
  delete process.env.CORE_API_KEY;
  t.after(() => { if (originalKey) process.env.CORE_API_KEY = originalKey; });

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-core-doi.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-core-doi.test.js
```

Expected: `FAIL` — module not found

- [ ] **Step 3: Implement fetch-core-doi.js**

```js
// scripts/fulltext-enrichment/lib/fetch-core-doi.js
import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const CORE_BASE = 'https://api.core.ac.uk/v3';
const limiter = new RateLimiter({ rps: 10 });

export async function fetchForDoi(doi) {
  if (!process.env.CORE_API_KEY) return null;
  await limiter.take();

  let resp;
  try {
    resp = await fetch(
      `${CORE_BASE}/search/works?q=doi:"${encodeURIComponent(doi)}"&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.CORE_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch { return null; }

  if (!resp.ok) return null;

  const body = await resp.json();
  const result = body?.results?.[0];
  if (!result) return null;

  const text = result.fullText;
  if (!text || text.length < 500) return null;

  return { text, pdfUrl: null, source: 'phase2f_core' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-core-doi.test.js
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/fetch-core-doi.js tests/unit/fulltext-enrichment/fetch-core-doi.test.js
git commit -m "feat(phase2f): CORE API full-text fetcher (S0)"
```

---

## Task 4: fetch-s2-pdf.js (S1)

**Files:**
- Create: `scripts/fulltext-enrichment/lib/fetch-s2-pdf.js`
- Create: `tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('returns pdfUrl when S2 has openAccessPdf', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({ openAccessPdf: { url: 'https://arxiv.org/pdf/2301.00001.pdf' } }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-s2-pdf.js');
  const result = await fetchForDoi('10.48550/arXiv.2301.00001');
  assert.equal(result.pdfUrl, 'https://arxiv.org/pdf/2301.00001.pdf');
  assert.equal(result.source, 'phase2f_s2');
  assert.equal(result.text, null);
});

test('returns null when openAccessPdf is absent', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({ openAccessPdf: null }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-s2-pdf.js');
  const result = await fetchForDoi('10.1000/closed');
  assert.equal(result, null);
});

test('returns null on 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-s2-pdf.js');
  const result = await fetchForDoi('10.1000/notfound');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js
```

Expected: `FAIL` — module not found

- [ ] **Step 3: Implement fetch-s2-pdf.js**

```js
// scripts/fulltext-enrichment/lib/fetch-s2-pdf.js
import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const limiter = new RateLimiter({ rps: process.env.S2_API_KEY ? 10 : 1 });

export async function fetchForDoi(doi) {
  await limiter.take();

  const headers = { Accept: 'application/json' };
  if (process.env.S2_API_KEY) headers['x-api-key'] = process.env.S2_API_KEY;

  let resp;
  try {
    resp = await fetch(
      `${S2_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
  } catch { return null; }

  if (resp.status === 404 || resp.status === 400) return null;
  if (!resp.ok) return null;

  const body = await resp.json();
  const pdfUrl = body?.openAccessPdf?.url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_s2' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/fetch-s2-pdf.js tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js
git commit -m "feat(phase2f): Semantic Scholar OA PDF fetcher (S1)"
```

---

## Task 5: fetch-openalex-oa.js (S2)

**Files:**
- Create: `scripts/fulltext-enrichment/lib/fetch-openalex-oa.js`
- Create: `tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('returns primary_location pdf_url when present', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      primary_location: { pdf_url: 'https://publisher.com/paper.pdf' },
      open_access: { oa_url: 'https://repo.edu/paper.pdf' },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://publisher.com/paper.pdf');
  assert.equal(result.source, 'phase2f_openalex');
});

test('falls back to open_access.oa_url when primary_location has no pdf_url', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      primary_location: { pdf_url: null },
      open_access: { oa_url: 'https://repo.edu/paper.pdf' },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://repo.edu/paper.pdf');
});

test('returns null on 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/notfound');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js
```

Expected: `FAIL` — module not found

- [ ] **Step 3: Implement fetch-openalex-oa.js**

```js
// scripts/fulltext-enrichment/lib/fetch-openalex-oa.js
import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const OA_BASE = 'https://api.openalex.org';
const limiter = new RateLimiter({ rps: 10 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetch(
      `${OA_BASE}/works/https://doi.org/${encodeURIComponent(doi)}?select=open_access,primary_location`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'EmersusBot/1.0 (mailto:info@emersus.ai)',
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch { return null; }

  if (resp.status === 404) return null;
  if (!resp.ok) return null;

  const body = await resp.json();
  const pdfUrl = body?.primary_location?.pdf_url ?? body?.open_access?.oa_url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_openalex' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/fetch-openalex-oa.js tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js
git commit -m "feat(phase2f): OpenAlex OA URL fetcher (S2)"
```

---

## Task 6: fetch-crossref-links.js (S3)

**Files:**
- Create: `scripts/fulltext-enrichment/lib/fetch-crossref-links.js`
- Create: `tests/unit/fulltext-enrichment/fetch-crossref-links.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/fetch-crossref-links.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('returns PDF link from CrossRef link array', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      message: {
        link: [
          { URL: 'https://publisher.com/paper.html', 'content-type': 'text/html' },
          { URL: 'https://publisher.com/paper.pdf', 'content-type': 'application/pdf' },
        ],
      },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-crossref-links.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://publisher.com/paper.pdf');
  assert.equal(result.source, 'phase2f_crossref');
});

test('matches unspecified content-type when URL ends in .pdf', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      message: {
        link: [{ URL: 'https://publisher.com/fulltext.pdf', 'content-type': 'unspecified' }],
      },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-crossref-links.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://publisher.com/fulltext.pdf');
});

test('returns null when no PDF links', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({ message: { link: [{ URL: 'https://pub.com/paper', 'content-type': 'text/html' }] } }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-crossref-links.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-crossref-links.test.js
```

Expected: `FAIL` — module not found

- [ ] **Step 3: Implement fetch-crossref-links.js**

```js
// scripts/fulltext-enrichment/lib/fetch-crossref-links.js
import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const CR_BASE = 'https://api.crossref.org';
const limiter = new RateLimiter({ rps: 50 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetch(
      `${CR_BASE}/works/${encodeURIComponent(doi)}?mailto=info@emersus.ai`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
    );
  } catch { return null; }

  if (resp.status === 404) return null;
  if (!resp.ok) return null;

  const body = await resp.json();
  const links = body?.message?.link ?? [];

  const pdfLink = links.find((l) =>
    l['content-type'] === 'application/pdf' ||
    (l['content-type'] === 'unspecified' && typeof l.URL === 'string' && l.URL.toLowerCase().endsWith('.pdf'))
  );

  if (!pdfLink?.URL) return null;

  return { text: null, pdfUrl: pdfLink.URL, source: 'phase2f_crossref' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-crossref-links.test.js
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/fetch-crossref-links.js tests/unit/fulltext-enrichment/fetch-crossref-links.test.js
git commit -m "feat(phase2f): CrossRef link-array PDF fetcher (S3)"
```

---

## Task 7: fetch-ia-scholar.js (S4)

**Files:**
- Create: `scripts/fulltext-enrichment/lib/fetch-ia-scholar.js`
- Create: `tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('returns pdf_url from IA Scholar hit', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      hits: {
        hits: [{ _source: { doi: '10.1000/test', pdf_url: 'https://web.archive.org/paper.pdf' } }],
      },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-ia-scholar.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://web.archive.org/paper.pdf');
  assert.equal(result.source, 'phase2f_ia');
});

test('falls back to ia_pdf_url when pdf_url is absent', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      hits: {
        hits: [{ _source: { ia_pdf_url: 'https://archive.org/ia.pdf' } }],
      },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-ia-scholar.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://archive.org/ia.pdf');
});

test('returns null when no hits', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({ hits: { hits: [] } }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-ia-scholar.js');
  const result = await fetchForDoi('10.1000/notfound');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js
```

Expected: `FAIL` — module not found

- [ ] **Step 3: Implement fetch-ia-scholar.js**

```js
// scripts/fulltext-enrichment/lib/fetch-ia-scholar.js
import { RateLimiter } from '../../abstract-enrichment/lib/rate-limiter.js';

const IA_BASE = 'https://scholar.archive.org';
const limiter = new RateLimiter({ rps: 3 });

export async function fetchForDoi(doi) {
  await limiter.take();

  let resp;
  try {
    resp = await fetch(
      `${IA_BASE}/api/search?q=doi:${encodeURIComponent(doi)}&limit=1`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
    );
  } catch { return null; }

  if (!resp.ok) return null;

  const body = await resp.json();
  const hit = body?.hits?.hits?.[0]?._source;
  if (!hit) return null;

  const pdfUrl = hit.pdf_url ?? hit.ia_pdf_url ?? null;
  if (!pdfUrl) return null;

  return { text: null, pdfUrl, source: 'phase2f_ia' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-test-module-mocks --test tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add scripts/fulltext-enrichment/lib/fetch-ia-scholar.js tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js
git commit -m "feat(phase2f): Internet Archive Scholar fetcher (S4)"
```

---

## Task 8: phase2f-sweep.js (Orchestrator)

**Files:**
- Create: `scripts/fulltext-enrichment/phase2f-sweep.js`

No unit test for the orchestrator — it is an integration script. Verification is done by dry-running against the prod DB on Hetzner (steps below).

- [ ] **Step 1: Create data directory on Hetzner (one-time setup)**

```bash
ssh hetzner "mkdir -p ~/phase2c-runtime/scripts/fulltext-enrichment/data"
```

- [ ] **Step 2: Implement phase2f-sweep.js**

```js
// scripts/fulltext-enrichment/phase2f-sweep.js
import 'dotenv/config';
import { mkdir, writeFile, unlink, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { withPg } from '../abstract-enrichment/lib/pg.js';
import { downloadPdf } from './lib/proxy-http.js';
import { processPdf } from './lib/grobid-client.js';
import { parseTeiFullText } from './lib/tei-parser.js';
import { buildBodyChunks } from './lib/fulltext-chunker.js';
import { fetchForDoi as fetchCore } from './lib/fetch-core-doi.js';
import { fetchForDoi as fetchS2 } from './lib/fetch-s2-pdf.js';
import { fetchForDoi as fetchOpenAlex } from './lib/fetch-openalex-oa.js';
import { fetchForDoi as fetchCrossRef } from './lib/fetch-crossref-links.js';
import { fetchForDoi as fetchIA } from './lib/fetch-ia-scholar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const CHUNKS_FILE = join(DATA_DIR, 'chunks-phase2f.jsonl');
const BATCH_SIZE = 50;
const MIN_TEXT_LEN = 1000;

// Strategies in priority order. needsPdf=false means the fn returns text directly.
const STRATEGIES = [
  { fn: fetchCore,     needsPdf: false },
  { fn: fetchS2,       needsPdf: true },
  { fn: fetchOpenAlex, needsPdf: true },
  { fn: fetchCrossRef, needsPdf: true },
  { fn: fetchIA,       needsPdf: true },
];

async function pdfToChunks(buffer, { pmid, doi, source }) {
  const tmpPath = join(tmpdir(), `phase2f-${randomBytes(8).toString('hex')}.pdf`);
  try {
    await writeFile(tmpPath, buffer);
    const tei = await processPdf(tmpPath, { fs });
    const parsed = parseTeiFullText(tei);
    if (!parsed || parsed.text.length < MIN_TEXT_LEN) return null;
    const chunks = buildBodyChunks({ pmid, sections: parsed.sections, provenance: source });
    return { text: parsed.text, chunks };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function processRow(row, pg) {
  for (const { fn, needsPdf } of STRATEGIES) {
    let result;
    try { result = await fn(row.doi, pg); } catch { continue; }
    if (!result) continue;

    if (!needsPdf) {
      if (!result.text || result.text.length < MIN_TEXT_LEN) continue;
      const sections = [{ title: null, type: 'body_other', text: result.text }];
      const chunks = buildBodyChunks({ pmid: row.pmid, sections, provenance: result.source });
      return { fullText: result.text, chunks, source: result.source, via: 'direct' };
    }

    let download;
    try {
      download = await downloadPdf(result.pdfUrl, { doi: row.doi });
    } catch (err) {
      if (err.code === 'PROXY_BLOCKED') {
        await pg.query(
          `UPDATE research_articles
             SET content_source = 'phase2f_proxy_blocked'
           WHERE pmid = $1`,
          [row.pmid]
        );
        return null;
      }
      continue;
    }

    const grobid = await pdfToChunks(download.buffer, {
      pmid: row.pmid,
      doi: row.doi,
      source: result.source,
    }).catch(() => null);

    if (!grobid) continue;
    return { fullText: grobid.text, chunks: grobid.chunks, source: result.source, via: download.via };
  }
  return null;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  let lastPmid = BigInt(process.argv[2] ?? 0);
  let totalProcessed = 0;
  let totalSucceeded = 0;

  await withPg(async (pg) => {
    while (true) {
      const { rows } = await pg.query(
        `SELECT pmid, doi FROM research_articles
          WHERE pmid > $1
            AND has_full_text = false
            AND doi IS NOT NULL
            AND content_source LIKE 'phase2%'
            AND content_source NOT LIKE 'phase2f%'
          ORDER BY pmid
          LIMIT $2`,
        [lastPmid, BATCH_SIZE]
      );
      if (!rows.length) break;

      for (const row of rows) {
        lastPmid = row.pmid;
        totalProcessed++;

        const result = await processRow(row, pg);

        if (result) {
          totalSucceeded++;
          await pg.query(
            `UPDATE research_articles
                SET full_text = $1, has_full_text = true, content_source = $2
              WHERE pmid = $3`,
            [result.fullText, result.source, row.pmid]
          );
          for (const chunk of result.chunks) {
            await appendFile(CHUNKS_FILE, JSON.stringify(chunk) + '\n');
          }
          console.log(`[phase2f] OK pmid=${row.pmid} source=${result.source} via=${result.via} chunks=${result.chunks.length}`);
        } else {
          // Only mark exhausted if not already set to a phase2f tag (proxy_blocked sets its own)
          const { rows: [cur] } = await pg.query(
            `SELECT content_source FROM research_articles WHERE pmid = $1`, [row.pmid]
          );
          if (!cur?.content_source?.startsWith('phase2f_')) {
            await pg.query(
              `UPDATE research_articles SET content_source = 'phase2f_exhausted' WHERE pmid = $1`,
              [row.pmid]
            );
          }
          console.log(`[phase2f] EXHAUSTED pmid=${row.pmid}`);
        }

        if (totalProcessed % 100 === 0) {
          console.log(`[phase2f] progress processed=${totalProcessed} succeeded=${totalSucceeded} lastPmid=${lastPmid}`);
        }
      }
    }
  });

  console.log(`[phase2f] DONE total=${totalProcessed} succeeded=${totalSucceeded}`);
}

main().catch((err) => { console.error('[phase2f] FATAL', err); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add scripts/fulltext-enrichment/phase2f-sweep.js
git commit -m "feat(phase2f): orchestrator sweep — 5-source OA full-text pipeline"
```

- [ ] **Step 4: Push and deploy to Hetzner**

```bash
git push
ssh hetzner "cd ~/app && git pull"
```

Expected: webhook auto-deploys, but `phase2f-sweep.js` is a one-off script — no pm2 restart needed.

- [ ] **Step 5: Dry-run on Hetzner — check Grobid is up**

```bash
ssh hetzner "curl -s http://localhost:8070/api/version"
```

Expected: `{"version":"0.8.1",...}`

If Grobid is not running:
```bash
ssh hetzner "docker run -d --name grobid --rm -p 8070:8070 --memory=4g --cpus=4 lfoppiano/grobid:0.8.1"
```

- [ ] **Step 6: Dry-run — first 10 rows only (verify no crashes)**

```bash
ssh hetzner "cd ~/app && node scripts/fulltext-enrichment/phase2f-sweep.js 2>&1 | head -30"
```

Expected: lines like `[phase2f] OK pmid=...` or `[phase2f] EXHAUSTED pmid=...` — no FATAL.

- [ ] **Step 7: Full run with nohup**

```bash
ssh hetzner "cd ~/app && nohup node scripts/fulltext-enrichment/phase2f-sweep.js > ~/phase2f-sweep.log 2>&1 &"
```

Monitor:
```bash
ssh hetzner "tail -f ~/phase2f-sweep.log"
```

To resume after interruption (pass last logged pmid as arg):
```bash
ssh hetzner "cd ~/app && nohup node scripts/fulltext-enrichment/phase2f-sweep.js <lastPmid> >> ~/phase2f-sweep.log 2>&1 &"
```

- [ ] **Step 8: After sweep completes — embed and insert chunks**

```bash
ssh hetzner "cd ~/app && node scripts/fulltext-enrichment/fulltext-chunk-submit.js data/chunks-phase2f.jsonl"
# wait for batch to complete (check OpenAI dashboard)
ssh hetzner "cd ~/app && node scripts/fulltext-enrichment/fulltext-chunk-apply.js"
```

- [ ] **Step 9: Verify results**

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"
SELECT content_source, COUNT(*)
FROM research_articles
WHERE content_source LIKE 'phase2f%'
GROUP BY 1 ORDER BY 2 DESC;\""
```

---

## All tests green check

After completing Tasks 2–7, run the full Phase 2F unit test suite:

```bash
node --experimental-test-module-mocks --test \
  tests/unit/fulltext-enrichment/proxy-http.test.js \
  tests/unit/fulltext-enrichment/fetch-core-doi.test.js \
  tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js \
  tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js \
  tests/unit/fulltext-enrichment/fetch-crossref-links.test.js \
  tests/unit/fulltext-enrichment/fetch-ia-scholar.test.js
```

Expected: 18 passing (3 per file)
