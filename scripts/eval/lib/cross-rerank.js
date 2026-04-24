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

const DEFAULT_COHERE_MODEL = "rerank-v3.5";
const DEFAULT_JINA_MODEL   = "jina-reranker-v2-base-multilingual";
const DEFAULT_VOYAGE_MODEL = "rerank-2.5";

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
  const res = await fetch(COHERE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Cohere rerank ${res.status}: ${txt.slice(0, 200)}`);
  }
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

async function jinaRerank({ query, candidates, topN, model }) {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("JINA_API_KEY missing.");
  const body = {
    model: model || DEFAULT_JINA_MODEL,
    query,
    documents: candidates.map((c) => stripForRerank(c.content)),
    top_n: topN,
  };
  const res = await fetch(JINA_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Jina rerank ${res.status}: ${txt.slice(0, 200)}`);
  }
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
  if (backend === "cohere") return cohereRerank({ query, candidates, topN, model });
  if (backend === "jina")   return jinaRerank({ query, candidates, topN, model });
  if (backend === "voyage") return voyageRerank({ query, candidates, topN, model });
  throw new Error(`Unknown rerank backend: ${backend}`);
}

export function isConfigured(backend) {
  if (backend === "none" || !backend) return true;
  if (backend === "cohere") return Boolean(process.env.COHERE_API_KEY);
  if (backend === "jina")   return Boolean(process.env.JINA_API_KEY);
  if (backend === "voyage") return Boolean(process.env.VOYAGE_API_KEY);
  return false;
}
