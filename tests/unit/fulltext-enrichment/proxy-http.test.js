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
