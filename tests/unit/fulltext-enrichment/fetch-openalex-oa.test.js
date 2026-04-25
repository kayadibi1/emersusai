// tests/unit/fulltext-enrichment/fetch-openalex-oa.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('returns primary_location pdf_url when present', async (t) => {
  let capturedUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    capturedUrl = url;
    return {
      ok: true, status: 200,
      json: async () => ({
        primary_location: { pdf_url: 'https://publisher.com/paper.pdf' },
        open_access: { oa_url: 'https://repo.edu/paper.pdf' },
      }),
    };
  });

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/test');
  assert.equal(result.pdfUrl, 'https://publisher.com/paper.pdf');
  assert.equal(result.source, 'phase2f_openalex');
  assert.equal(result.text, null);
  assert.ok(capturedUrl.includes('/works/https://doi.org/10.1000/test'), `URL should not encode DOI slash, got: ${capturedUrl}`);
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
  assert.equal(result.source, 'phase2f_openalex');
  assert.equal(result.text, null);
});

test('returns null when both pdf_url fields are null', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    json: async () => ({
      primary_location: { pdf_url: null },
      open_access: { oa_url: null },
    }),
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/closed');
  assert.equal(result, null);
});

test('returns null on 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/notfound');
  assert.equal(result, null);
});

test('returns null on network error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Network error');
  });

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-openalex-oa.js');
  const result = await fetchForDoi('10.1000/error');
  assert.equal(result, null);
});
