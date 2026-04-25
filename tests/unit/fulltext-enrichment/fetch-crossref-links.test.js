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
