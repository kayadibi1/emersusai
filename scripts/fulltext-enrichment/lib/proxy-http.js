// scripts/fulltext-enrichment/lib/proxy-http.js
//
// PROXY_URL formats supported:
//   http://user:pass@host:port  — standard HTTP CONNECT proxy (mobile/residential)
//   https://*.workers.dev       — CF Worker relay (GET ?url=<encoded>)
//
// Cookie fallback: if COOKIES_FILE is set, tried after proxy failure for
// publisher domains where institutional access is available.
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { existsSync } from 'node:fs';
import { loadCookieJar } from './cookie-jar.js';

const RETRY_STATUSES = new Set([403, 407, 429]);

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/pdf,*/*;q=0.9',
};

function isConnectProxy(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.username;
  } catch { return false; }
}

let _jar = null;
function getJar() {
  if (_jar) return _jar;
  const path = process.env.COOKIES_FILE;
  if (!path || !existsSync(path)) return null;
  try { _jar = loadCookieJar(path); return _jar; } catch { return null; }
}

async function attemptFetch(url, { doi, proxyUrl, cookieHeader } = {}) {
  const headers = {
    ...DEFAULT_HEADERS,
    ...(doi ? { Referer: `https://doi.org/${doi}` } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  if (proxyUrl && isConnectProxy(proxyUrl)) {
    const dispatcher = new ProxyAgent(proxyUrl);
    return undiciFetch(url, {
      headers,
      signal: AbortSignal.timeout(60_000),
      redirect: 'follow',
      dispatcher,
    });
  }

  const fetchUrl = proxyUrl
    ? `${proxyUrl}?url=${encodeURIComponent(url)}`
    : url;

  return fetch(fetchUrl, {
    headers,
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });
}

export async function downloadPdf(url, { doi } = {}) {
  const proxyUrl = process.env.PROXY_URL;

  // 1. Direct
  let resp = await attemptFetch(url, { doi });
  let via = 'direct';

  // 2. Proxy fallback on block
  if (RETRY_STATUSES.has(resp.status)) {
    if (proxyUrl) {
      resp = await attemptFetch(url, { doi, proxyUrl });
      via = 'proxy';
    }

    // 3. Cookie fallback — try institutional access for blocked publisher domains
    if (!resp.ok || RETRY_STATUSES.has(resp.status)) {
      const jar = getJar();
      const cookieHeader = jar?.cookieHeaderFor(url);
      if (cookieHeader) {
        resp = await attemptFetch(url, { doi, cookieHeader });
        via = 'cookies';
      }
    }

    if (!resp.ok) {
      const err = new Error(`Blocked: HTTP ${resp.status} on all paths`);
      err.code = 'PROXY_BLOCKED';
      throw err;
    }
  } else if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.code = `HTTP_${resp.status}`;
    throw err;
  }

  const cl = parseInt(resp.headers.get('content-length') ?? '0', 10);
  if (cl > 50 * 1024 * 1024) {
    const err = new Error(`Response too large: ${cl} bytes`);
    err.code = 'PDF_TOO_LARGE';
    throw err;
  }
  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType, via };
}
