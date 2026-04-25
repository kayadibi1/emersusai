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
