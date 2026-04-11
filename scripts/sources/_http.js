// scripts/sources/_http.js
// Small wrapper around fetch with:
//   - timeout (via AbortController)
//   - user-agent header
//   - automatic classification of HTTP errors into source error types
//   - retry-after parsing for 429
import {
  SourceTransientError,
  SourceRateLimitError,
  SourcePermanentError,
} from "./_errors.js";

const DEFAULT_UA = "emersus-research-bot/1.0 (+https://emersus.ai)";
const DEFAULT_TIMEOUT_MS = 25_000;

export async function fetchWithTimeoutAndUA(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ua = DEFAULT_UA,
    accept = "application/json, application/xml;q=0.9, */*;q=0.8",
    signal: externalSignal,
    ...rest
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let resp;
  try {
    resp = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": ua,
        "Accept": accept,
        ...(rest.headers ?? {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new SourceTransientError(`timeout after ${timeoutMs}ms: ${url}`, { cause: err });
    }
    throw new SourceTransientError(`network error: ${err.message}`, { cause: err });
  }
  clearTimeout(timer);

  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    const retryAfterMs = retryAfter
      ? (isNaN(Number(retryAfter)) ? Math.max(0, new Date(retryAfter).getTime() - Date.now()) : Number(retryAfter) * 1000)
      : 60_000;
    throw new SourceRateLimitError(`rate limited at ${url}`, retryAfterMs);
  }
  if (resp.status >= 500) {
    throw new SourceTransientError(`HTTP ${resp.status} at ${url}`);
  }
  if (resp.status >= 400) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new SourcePermanentError(`HTTP ${resp.status} at ${url}`, { body });
  }
  return resp;
}
