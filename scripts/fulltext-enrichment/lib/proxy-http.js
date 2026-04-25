// scripts/fulltext-enrichment/lib/proxy-http.js
const RETRY_STATUSES = new Set([403, 407, 429]);

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/pdf,*/*;q=0.9',
};

async function attemptFetch(url, { doi, proxyUrl } = {}) {
  const fetchUrl = proxyUrl
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
  const proxyUrl = process.env.PROXY_URL;
  let resp = await attemptFetch(url, { doi });
  let via = 'direct';

  if (RETRY_STATUSES.has(resp.status)) {
    if (!proxyUrl) {
      const err = new Error(`HTTP ${resp.status} with no PROXY_URL`);
      err.code = 'PROXY_BLOCKED';
      throw err;
    }
    resp = await attemptFetch(url, { doi, proxyUrl });
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
