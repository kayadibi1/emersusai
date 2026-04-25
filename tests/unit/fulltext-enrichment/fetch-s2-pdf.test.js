// tests/unit/fulltext-enrichment/fetch-s2-pdf.test.js
process.env.S2_API_KEY = process.env.S2_API_KEY ?? 'test-key-s2';

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
