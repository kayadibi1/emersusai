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

    // Honor Retry-After header (seconds or HTTP-date), but cap at 60s.
    // Some APIs (OpenAlex when daily quota hit) return Retry-After=12688
    // (3.5 HOURS) — sleeping for that pegs the whole worker. If the server
    // really needs hours, we'd rather throw transient and let the caller
    // back off / move on / drop the row to retry tomorrow.
    const MAX_RETRY_AFTER_MS = 60_000;
    let waitMs = baseMs * Math.pow(2, attempt);
    const retryAfter = resp.headers.get('retry-after');
    if (retryAfter) {
      const asInt = parseInt(retryAfter, 10);
      if (!isNaN(asInt)) {
        waitMs = Math.max(waitMs, Math.min(asInt * 1000, MAX_RETRY_AFTER_MS));
      } else {
        const asDate = Date.parse(retryAfter);
        if (!isNaN(asDate)) {
          waitMs = Math.max(waitMs, Math.min(asDate - Date.now(), MAX_RETRY_AFTER_MS));
        }
      }
    }
    // Final safety belt — never sleep more than the cap regardless of math
    if (waitMs > MAX_RETRY_AFTER_MS) waitMs = MAX_RETRY_AFTER_MS;
    // Drain body so the connection can be reused
    try { await resp.text(); } catch {}
    await sleep(waitMs);
  }

  throw lastErr ?? new Error('fetch-retry exhausted without response');
}
