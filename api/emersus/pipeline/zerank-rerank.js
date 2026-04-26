// api/emersus/pipeline/zerank-rerank.js
//
// Cross-encoder reranker for the production retrieval path. Wraps
// ZeroEntropy's hosted zerank-2 API. Feature-flagged via
// CHAT_ZERANK_RERANK_ENABLED.
//
// Why zerank-2: the 2026-04-25 200-fixture rerank shootout (paired
// Wilcoxon, Bonferroni-corrected α=0.0056) found Z2 (HyDE + dense +
// zerank-2) the only stat-sig winner over baseline at +10pp doi@10
// (p=0.0047). Z2 vs C2 (HyDE + Cohere v3.5) was +3.2pp NOT sig — pick
// on price (zerank $0.025/M tok vs Cohere $0.05/M).
//
// Integration shape: drop-in replacement for jina-rerank in
// retrieveDatabaseEvidence.js. Returns same candidates with _zerank_score
// + _zerank_rank attached. dedupByDoi tiebreaks on _zerank_score first.
//
// Non-fatal: any API error (401, 429, 5xx, timeout) logs and returns the
// input candidates unchanged so retrieval never blocks on rerank.
//
// Cost at default pool size 50: ~25K tokens/call → ~$0.000625/query.

const ZERANK_URL = "https://api.zeroentropy.dev/v1/models/rerank";
const DEFAULT_MODEL = "zerank-2";
const DEFAULT_POOL_SIZE = 50;
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
 * Rerank candidates by zerank-2 cross-encoder relevance.
 *
 * @param {Object} opts
 * @param {string} opts.query — the user question, not the HyDE passage.
 * @param {Array<Object>} opts.candidates — each needs a content/chunk_text field.
 * @param {number} [opts.topN] — return top-N by rerank score (default = pool size).
 * @param {string} [opts.model] — override default model.
 * @param {string} [opts.contentField] — which field holds the doc text (default "chunk_text").
 * @returns {Promise<Array<Object>>} candidates ordered by descending zerank
 *   score with `_zerank_score` and `_zerank_rank` attached. On any failure,
 *   returns the input array unchanged (sliced to topN) — never throws.
 */
export async function zerankRerank({
  query,
  candidates,
  topN = DEFAULT_POOL_SIZE,
  model = DEFAULT_MODEL,
  contentField = "chunk_text",
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const apiKey = process.env.ZEROENTROPY_API_KEY;
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
        ZERANK_URL,
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
            _zerank_score: r.relevance_score,
            _zerank_rank: null,
          }))
          .map((c, i) => ({ ...c, _zerank_rank: i + 1 }));
      }

      if (res.status === 429 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const txt = await res.text().catch(() => "");
      console.warn(`[zerank-rerank] ${res.status}: ${txt.slice(0, 120)} — falling back to unranked`);
      return pool.slice(0, topN);
    } catch (err) {
      console.warn(`[zerank-rerank] attempt ${attempt} failed: ${err.message}`);
      if (attempt === 2) return pool.slice(0, topN);
    }
  }
  return pool.slice(0, topN);
}

export function isZerankConfigured() {
  return Boolean(process.env.ZEROENTROPY_API_KEY);
}
