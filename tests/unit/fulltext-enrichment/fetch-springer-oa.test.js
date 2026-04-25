process.env.SPRINGER_API_KEY = process.env.SPRINGER_API_KEY ?? 'test-springer-key';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_JATS = `<?xml version="1.0"?>
<article>
  <body>
    <sec sec-type="intro"><title>Introduction</title>
      <p>Creatine supplementation significantly improves high-intensity exercise performance. ${'word '.repeat(60)}</p>
    </sec>
    <sec sec-type="methods"><title>Methods</title>
      <p>Randomized controlled trial. Double-blind. ${'word '.repeat(60)}</p>
    </sec>
  </body>
</article>`;

const EMPTY_JATS = `<?xml version="1.0"?><article><front><title>Test</title></front></article>`;

test('returns text+sections when Springer has JATS full text', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    text: async () => SAMPLE_JATS,
    headers: { get: () => null },
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-springer-oa.js');
  const result = await fetchForDoi('10.1007/s00421-024-0001');
  assert.ok(result !== null);
  assert.equal(result.source, 'phase2f_springer');
  assert.equal(result.pdfUrl, null);
  assert.ok(result.text.length >= 500);
  assert.ok(Array.isArray(result.sections));
  assert.ok(result.sections.length > 0);
});

test('returns null when body is missing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, status: 200,
    text: async () => EMPTY_JATS,
    headers: { get: () => null },
  }));

  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-springer-oa.js');
  const result = await fetchForDoi('10.1007/s00421-024-0002');
  assert.equal(result, null);
});

test('returns null when SPRINGER_API_KEY is not set', async (t) => {
  const { fetchForDoi } = await import('../../../scripts/fulltext-enrichment/lib/fetch-springer-oa.js');
  const orig = process.env.SPRINGER_API_KEY;
  delete process.env.SPRINGER_API_KEY;
  t.after(() => { if (orig) process.env.SPRINGER_API_KEY = orig; });
  const result = await fetchForDoi('10.1007/s00421-024-0003');
  assert.equal(result, null);
});
