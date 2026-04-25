// scripts/eval/lib/cross-rerank.js
//
// Cross-encoder reranker adapters for the retrieval matrix eval. Kept
// separate from api/emersus/rerank.js, which is the production heuristic
// freshness+quality+similarity+RCR blend — different thing entirely.
//
// Supported backends:
//   * "cohere"   — Cohere Rerank v3.5 / v4.0 (set COHERE_API_KEY)
//   * "jina"     — Jina Reranker v2 / v3 (set JINA_API_KEY)
//   * "voyage"   — Voyage Rerank 2.5 (set VOYAGE_API_KEY)
//   * "zerank"   — ZeroEntropy zerank-2 (set ZEROENTROPY_API_KEY)
//   * "selfhost" — Self-hosted cross-encoder (BGE-reranker-v2-m3 etc) via
//                  Text Embeddings Inference REST. Set SELFHOST_RERANK_URL
//                  (e.g. http://127.0.0.1:8081). No API key.
//   * "none"     — identity, preserves input order (baseline stack)
//
// All three vendors offer free-tier API access sufficient for a single
// matrix run (~260-900 calls total). No SDK dependency — direct fetch
// so we don't inflate package-lock.
//
// Input shape  : { query: string, candidates: [{ id, content }, ...] }
// Output shape : array of { id, content, score } re-ordered by score desc
//                (plus original rank preserved as `original_rank`).

const COHERE_URL = "https://api.cohere.com/v2/rerank";
const JINA_URL   = "https://api.jina.ai/v1/rerank";
const VOYAGE_URL = "https://api.voyageai.com/v1/rerank";
const ZERANK_URL = "https://api.zeroentropy.dev/v1/models/rerank";

const DEFAULT_COHERE_MODEL = "rerank-v3.5";
const DEFAULT_JINA_MODEL   = "jina-reranker-v2-base-multilingual";
const DEFAULT_VOYAGE_MODEL = "rerank-2.5";
const DEFAULT_ZERANK_MODEL = "zerank-2";

function stripForRerank(content, maxChars = 2500) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function cohereRerank({ query, candidates, topN, model }) {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error("COHERE_API_KEY missing.");
  const body = {
    model: model || DEFAULT_COHERE_MODEL,
    query,
    documents: candidates.map((c) => stripForRerank(c.content)),
    top_n: topN,
  };
  // Cohere trial keys are rate-limited to 10 calls/minute. Production keys
  // are not. Retry on 429 with 7s backoff (covers the 1-minute window) up
  // to 3 attempts so a trial-key eval can plough through.
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(COHERE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      return results
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((r) => ({
          ...candidates[r.index],
          score: r.relevance_score,
          original_rank: r.index,
        }));
    }
    const txt = await res.text().catch(() => "");
    if (res.status === 429 && attempt < 4) {
      const waitMs = 7000;
      console.warn(`  [cohere] 429 attempt ${attempt} — sleeping ${waitMs / 1000}s for trial-key rate-limit window…`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    lastErr = new Error(`Cohere rerank ${res.status}: ${txt.slice(0, 200)}`);
    break;
  }
  throw lastErr || new Error("Cohere rerank failed (unknown)");
}

async function jinaRerank({ query, candidates, topN, model }) {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("JINA_API_KEY missing.");
  // Jina free tier: 100K tokens/minute. Rerank calls with 50 docs × ~500
  // tokens = 25K/call so we can safely issue ~3 calls/min. When the matrix
  // sustains more than that, we retry on 429 with a 65s sleep (crosses the
  // rate-limit window). Three tries total then give up.
  const body = {
    model: model || DEFAULT_JINA_MODEL,
    query,
    documents: candidates.map((c) => stripForRerank(c.content)),
    top_n: topN,
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(JINA_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const results = Array.isArray(json.results) ? json.results : [];
      return results
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((r) => ({
          ...candidates[r.index],
          score: r.relevance_score,
          original_rank: r.index,
        }));
    }
    const txt = await res.text().catch(() => "");
    if (res.status === 429 && attempt < 3) {
      const waitMs = 65_000; // span one full 60s rate-limit window
      console.warn(`  [jina] 429 on attempt ${attempt} — sleeping ${waitMs / 1000}s for rate-limit window…`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    lastErr = new Error(`Jina rerank ${res.status}: ${txt.slice(0, 200)}`);
    break;
  }
  throw lastErr || new Error("Jina rerank failed (unknown)");
}

async function voyageRerank({ query, candidates, topN, model }) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY missing.");
  const body = {
    model: model || DEFAULT_VOYAGE_MODEL,
    query,
    documents: candidates.map((c) => stripForRerank(c.content)),
    top_k: topN,
  };
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Voyage rerank ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const results = Array.isArray(json.data) ? json.data : [];
  return results
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map((r) => ({
      ...candidates[r.index],
      score: r.relevance_score,
      original_rank: r.index,
    }));
}

async function zerankRerank({ query, candidates, topN, model }) {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  if (!apiKey) throw new Error("ZEROENTROPY_API_KEY missing.");
  const body = {
    model: model || DEFAULT_ZERANK_MODEL,
    query,
    documents: candidates.map((c) => stripForRerank(c.content)),
    top_n: topN,
  };
  const res = await fetch(ZERANK_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Zerank rerank ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  // ZeroEntropy returns { results: [{ index, relevance_score }, ...] }
  const results = Array.isArray(json.results) ? json.results : [];
  return results
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map((r) => ({
      ...candidates[r.index],
      score: r.relevance_score,
      original_rank: r.index,
    }));
}

async function selfhostRerank({ query, candidates, topN }) {
  const baseUrl = process.env.SELFHOST_RERANK_URL;
  if (!baseUrl) throw new Error("SELFHOST_RERANK_URL missing (e.g. http://127.0.0.1:8081).");
  // Text Embeddings Inference (TEI) caps batch size (typically 32 for BGE
  // models on CPU). Chunk the candidate list, score each chunk, then merge.
  // The /rerank endpoint returns indexes RELATIVE TO the chunk, so we
  // re-base them to global candidate indexes before sorting.
  const url = `${baseUrl.replace(/\/$/, "")}/rerank`;
  const CHUNK = Number(process.env.SELFHOST_BATCH_SIZE || 32);
  const allScored = [];
  for (let off = 0; off < candidates.length; off += CHUNK) {
    const slice = candidates.slice(off, off + CHUNK);
    const body = {
      query,
      texts: slice.map((c) => stripForRerank(c.content)),
      raw_scores: false,
      truncate: true,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Selfhost rerank ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    const results = Array.isArray(json) ? json : [];
    for (const r of results) {
      const globalIdx = off + r.index;
      allScored.push({ ...candidates[globalIdx], score: r.score, original_rank: globalIdx });
    }
  }
  return allScored.sort((a, b) => b.score - a.score).slice(0, topN);
}

async function identityRerank({ candidates, topN }) {
  return candidates.slice(0, topN).map((c, i) => ({
    ...c,
    score: 1 - i / Math.max(candidates.length, 1),
    original_rank: i,
  }));
}

export async function rerank({
  backend = "none",
  query,
  candidates,
  topN = 10,
  model = null,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (backend === "none" || !backend) {
    return identityRerank({ candidates, topN });
  }
  if (backend === "cohere")   return cohereRerank({ query, candidates, topN, model });
  if (backend === "jina")     return jinaRerank({ query, candidates, topN, model });
  if (backend === "voyage")   return voyageRerank({ query, candidates, topN, model });
  if (backend === "zerank")   return zerankRerank({ query, candidates, topN, model });
  if (backend === "selfhost") return selfhostRerank({ query, candidates, topN });
  throw new Error(`Unknown rerank backend: ${backend}`);
}

export function isConfigured(backend) {
  if (backend === "none" || !backend) return true;
  if (backend === "cohere")   return Boolean(process.env.COHERE_API_KEY);
  if (backend === "jina")     return Boolean(process.env.JINA_API_KEY);
  if (backend === "voyage")   return Boolean(process.env.VOYAGE_API_KEY);
  if (backend === "zerank")   return Boolean(process.env.ZEROENTROPY_API_KEY);
  if (backend === "selfhost") return Boolean(process.env.SELFHOST_RERANK_URL);
  return false;
}
