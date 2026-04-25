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
