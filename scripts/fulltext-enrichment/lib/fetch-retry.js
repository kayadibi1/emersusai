// fetch wrapper with retry-with-backoff for transient HTTP errors (429/5xx).
//
// Why: every fetch-*.js adapter previously did `if (!resp.ok) return null`,
// which conflated permanent miss (404/400) with transient throttle (429) and
// upstream failure (502/503/504). The phase2f sweep then marked the row
// `phase2f_exhausted`, permanently burning the signal — every CORE 429 lost
// a potential full-text recovery.
//
// Behavior:
//   - 4xx (except 429): permanent — return resp, caller decides
//   - 429: honor Retry-After header if present; otherwise exponential backoff
//   - 5xx: exponential backoff
//   - Network errors: backoff
//   - After maxRetries: throw Error with .transient=true so caller can avoid
//     marking the row exhausted

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
  const { maxRetries = 3, baseMs = 1000, label = url } = retryConfig;

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let resp;
    try {
      resp = await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) {
        const e = new Error(`fetch network error after ${maxRetries + 1} attempts: ${label} — ${err.message}`);
        e.transient = true;
        e.cause = err;
        throw e;
      }
      await sleep(baseMs * Math.pow(2, attempt));
      continue;
    }

    // Permanent: 2xx (success), 4xx-except-429 (real miss), 3xx (handled by fetch)
    if (resp.status !== 429 && resp.status < 500) return resp;

    // Transient: 429 or 5xx
    if (attempt === maxRetries) {
      const e = new Error(`fetch transient ${resp.status} after ${maxRetries + 1} attempts: ${label}`);
      e.transient = true;
      e.status = resp.status;
      // Drain body to free the connection
      try { await resp.text(); } catch {}
      throw e;
    }

    // Honor Retry-After header (seconds, integer or HTTP-date)
    let waitMs = baseMs * Math.pow(2, attempt);
    const retryAfter = resp.headers.get('retry-after');
    if (retryAfter) {
      const asInt = parseInt(retryAfter, 10);
      if (!isNaN(asInt)) {
        waitMs = Math.max(waitMs, asInt * 1000);
      } else {
        const asDate = Date.parse(retryAfter);
        if (!isNaN(asDate)) {
          waitMs = Math.max(waitMs, asDate - Date.now());
        }
      }
    }
    // Drain body so the connection can be reused
    try { await resp.text(); } catch {}
    await sleep(waitMs);
  }

  throw lastErr ?? new Error('fetch-retry exhausted without response');
}
