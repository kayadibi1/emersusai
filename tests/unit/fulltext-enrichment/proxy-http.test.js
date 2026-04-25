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

test('CONNECT proxy format detected via URL with credentials', async (t) => {
  // isConnectProxy should return true for http://user:pass@host:port
  const { downloadPdf } = await import('../../../scripts/fulltext-enrichment/lib/proxy-http.js');
  const originalProxy = process.env.PROXY_URL;
  // Set a CONNECT-style proxy URL — the undici ProxyAgent path will be taken
  // We can't fully mock undici.fetch here, but we can verify the format detection
  // doesn't throw on the URL itself (connection will fail with ECONNREFUSED,
  // which we catch and rethrow as a different error)
  process.env.PROXY_URL = 'http://user:pass@127.0.0.1:1'; // nothing listening
  t.after(() => { process.env.PROXY_URL = originalProxy; });

  t.mock.method(globalThis, 'fetch', makeFetchMock(403)); // direct returns 403
  // Proxy attempt via undici CONNECT will fail with connection error, not PROXY_BLOCKED
  // That means it throws something OTHER than PROXY_BLOCKED — proving the code
  // took the CONNECT path instead of the relay path
  await assert.rejects(
    () => downloadPdf('https://example.com/paper.pdf'),
    (err) => { assert.notEqual(err.code, 'PROXY_BLOCKED'); return true; }
  );
});
