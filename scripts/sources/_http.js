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
  constructor(statusCode, headers, body, url) {
    this.status = statusCode;
    this._headers = headers;
    this._body = body;
    this._url = url;
  }
  /** @param {string} name */
  get(name) {
    return this._headers[name.toLowerCase()] ?? null;
  }
  async text() { return this._body; }
  /**
   * Parse the body as JSON. Tolerates leading garbage (PHP warnings, HTML
   * error blocks) by scanning for the first `{` or `[` if a strict parse
   * fails. api.biorxiv.org regularly emits ~35 KB of `<br /><b>Warning:`
   * preamble before the actual JSON body — discovered 2026-04-21 when
   * the funder include broke. Throws SourceTransientError (not raw
   * SyntaxError) so adapters get a typed error consistent with the rest
   * of the taxonomy and pg-boss retry policy applies cleanly.
   */
  async json() {
    try {
      return JSON.parse(this._body);
    } catch (firstErr) {
      const trimmed = this._body.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        // Strict failure on a body that looks like JSON — genuinely malformed.
        throw new SourceTransientError(
          `malformed JSON from ${this._url}: ${firstErr.message}`,
          { cause: firstErr },
        );
      }
      // Body has leading garbage. Find the first plausible JSON start
      // and try again from there.
      let salvageIdx = -1;
      for (let i = 0; i < this._body.length; i++) {
        const c = this._body.charCodeAt(i);
        if (c === 0x7b || c === 0x5b) { // '{' or '['
          salvageIdx = i;
          break;
        }
      }
      if (salvageIdx > 0) {
        try {
          return JSON.parse(this._body.slice(salvageIdx));
        } catch {
          // fall through to typed throw below
        }
      }
      throw new SourceTransientError(
        `non-JSON response from ${this._url} (body starts with ${JSON.stringify(this._body.slice(0, 60))})`,
        { cause: firstErr },
      );
    }
  }
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
          resolve(new SimpleResponse(status, headers, body, url));
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
