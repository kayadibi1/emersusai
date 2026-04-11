// scripts/sources/_http.js
// Small wrapper around node:https with:
//   - timeout (via AbortController / request.destroy)
//   - user-agent header
//   - automatic classification of HTTP errors into source error types
//   - retry-after parsing for 429
//
// Uses node:https (not native fetch) so that nock can intercept in tests.
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import {
  SourceTransientError,
  SourceRateLimitError,
  SourcePermanentError,
} from "./_errors.js";

const DEFAULT_UA = "emersus-research-bot/1.0 (+https://emersus.ai)";
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Minimal Response-like object returned by fetchWithTimeoutAndUA.
 * Exposes status, headers (Map-like), text(), json() — enough for all adapters.
 */
class SimpleResponse {
  constructor(statusCode, headers, body) {
    this.status = statusCode;
    this._headers = headers;
    this._body = body;
  }
  /** @param {string} name */
  get(name) {
    return this._headers[name.toLowerCase()] ?? null;
  }
  async text() { return this._body; }
  async json() { return JSON.parse(this._body); }
}

/**
 * Fetch a URL using node:https, with timeout, UA header, and error classification.
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.ua]
 * @param {string} [options.accept]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.headers]
 * @returns {Promise<SimpleResponse>}
 */
export async function fetchWithTimeoutAndUA(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ua = DEFAULT_UA,
    accept = "application/json, application/xml;q=0.9, */*;q=0.8",
    signal: externalSignal,
    headers: extraHeaders = {},
  } = options;

  const parsed = new URL(url);
  const lib = parsed.protocol === "https:" ? https : http;

  const reqHeaders = {
    "user-agent": ua,
    "accept": accept,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])
    ),
  };

  return new Promise((resolve, reject) => {
    const req = lib.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode;
          const headers = res.headers;

          if (status === 429) {
            const retryAfter = headers["retry-after"];
            const retryAfterMs = retryAfter
              ? (isNaN(Number(retryAfter))
                ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
                : Number(retryAfter) * 1000)
              : 60_000;
            return reject(new SourceRateLimitError(`rate limited at ${url}`, retryAfterMs));
          }
          if (status >= 500) {
            return reject(new SourceTransientError(`HTTP ${status} at ${url}`));
          }
          if (status >= 400) {
            return reject(new SourcePermanentError(`HTTP ${status} at ${url}`, { body }));
          }
          resolve(new SimpleResponse(status, headers, body));
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          reject(new SourceTransientError(`network error: ${err.message}`, { cause: err }));
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      if (err.name === "AbortError" || err.message?.includes("socket hang up") || err.code === "ECONNRESET") {
        reject(new SourceTransientError(`request error: ${err.message}`, { cause: err }));
      } else {
        reject(new SourceTransientError(`network error: ${err.message}`, { cause: err }));
      }
    });

    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
      reject(new SourceTransientError(`timeout after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    if (externalSignal) {
      externalSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          req.destroy();
          reject(new SourceTransientError(`aborted: ${url}`));
        },
        { once: true }
      );
    }
  });
}
