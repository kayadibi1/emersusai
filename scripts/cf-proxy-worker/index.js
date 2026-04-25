const ALLOWED_SCHEMES = new Set(['https:', 'http:']);
const PRIVATE_HOST_RE = /^(localhost$|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('method not allowed', { status: 405 });

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    if (!target) return new Response('missing url param', { status: 400 });

    let parsed;
    try { parsed = new URL(target); }
    catch { return new Response('invalid url', { status: 400 }); }

    if (!ALLOWED_SCHEMES.has(parsed.protocol))
      return new Response('scheme not allowed', { status: 400 });
    if (PRIVATE_HOST_RE.test(parsed.hostname))
      return new Response('private address blocked', { status: 403 });

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: {
          'User-Agent': request.headers.get('User-Agent') ?? 'Mozilla/5.0',
          'Accept': request.headers.get('Accept') ?? 'application/pdf,*/*',
          'Referer': request.headers.get('Referer') ?? '',
        },
      });
    } catch {
      return new Response('upstream fetch failed', { status: 502 });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      },
    });
  },
};
