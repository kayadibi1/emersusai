// api/emersus/pipeline/jina-rerank.js
//
// Cross-encoder reranker for the production retrieval path. Wraps Jina's
// hosted Reranker v2 API. Feature-flagged via CHAT_JINA_RERANK_ENABLED.
//
// Integration shape (to be finalized once the paired-diff matrix lands):
//   * The ranker takes (query, candidates[]) and returns the same
//     candidates reordered by Jina's cross-encoder relevance score.
//   * Called from retrieveDatabaseEvidence.js either before or after the
//     heuristic rankEvidence — decision pending e2e matrix results.
//   * Non-fatal: any API error (401, 429 after retries, 5xx) logs and
//     returns the input candidates unchanged, so retrieval never blocks
//     on rerank.
//
// Jina free-tier limits:
//   * 100K tokens/minute rate limit
//   * 10M tokens one-time free bucket per API key
//   * Above free: $0.02/M tokens
//
// At default JINA_RERANK_POOL_SIZE=50, each call is ~25K tokens → we can
// sustain 4 calls/minute on free tier. On 429, we retry once after a 2s
// backoff. If the retry also fails we return unchanged candidates so
// chat continues to work (just without cross-encoder rerank that turn).

const JINA_URL = "https://api.jina.ai/v1/rerank";
const DEFAULT_MODEL = "jina-reranker-v2-base-multilingual";
const DEFAULT_POOL_SIZE = 50; // docs sent to Jina per call
const DEFAULT_TIMEOUT_MS = 8000;

function stripForRerank(content, maxChars = 2000) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Rerank candidates by Jina cross-encoder relevance.
 *
 * @param {Object} opts
 * @param {string} opts.query — the user question, not the HyDE passage.
 * @param {Array<Object>} opts.candidates — each needs a content/chunk_text field.
 *   Any shape works; we pass through unchanged and attach a score.
 * @param {number} [opts.topN] — return top-N by rerank score (default 50).
 * @param {string} [opts.model] — override default model.
 * @param {string} [opts.contentField] — which field holds the doc text (default "chunk_text").
 * @returns {Promise<Array<Object>>} candidates ordered by descending
 *   Jina score. On any failure, returns the input array unchanged
 *   (slice to topN) with score=null — never throws.
 */
export async function jinaRerank({
  query,
  candidates,
  topN = DEFAULT_POOL_SIZE,
  model = DEFAULT_MODEL,
  contentField = "chunk_text",
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    return candidates.slice(0, topN);
  }

  const pool = candidates.slice(0, Math.min(DEFAULT_POOL_SIZE, candidates.length));
  const body = {
    model,
    query: String(query || "").trim(),
    documents: pool.map((c) => stripForRerank(c[contentField] || c.content || "")),
    top_n: Math.min(topN, pool.length),
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        JINA_URL,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        DEFAULT_TIMEOUT_MS
      );

      if (res.ok) {
        const json = await res.json();
        const results = Array.isArray(json.results) ? json.results : [];
        return results
          .sort((a, b) => b.relevance_score - a.relevance_score)
          .map((r) => ({
            ...pool[r.index],
            _jina_score: r.relevance_score,
            _jina_rank: null, // filled below
          }))
          .map((c, i) => ({ ...c, _jina_rank: i + 1 }));
      }

      if (res.status === 429 && attempt === 1) {
        // Short backoff — if we're rate-limited we'd rather return
        // unchanged than block chat for 60s.
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const txt = await res.text().catch(() => "");
      console.warn(`[jina-rerank] ${res.status}: ${txt.slice(0, 120)} — falling back to unranked`);
      return pool.slice(0, topN);
    } catch (err) {
      console.warn(`[jina-rerank] attempt ${attempt} failed: ${err.message}`);
      if (attempt === 2) return pool.slice(0, topN);
    }
  }
  return pool.slice(0, topN);
}

export function isJinaConfigured() {
  return Boolean(process.env.JINA_API_KEY);
}
