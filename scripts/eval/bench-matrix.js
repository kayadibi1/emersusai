// scripts/eval/bench-matrix.js
//
// Retrieval matrix benchmark. Runs N stacks × M fixtures, measures
// recall@{10, 50, 100}, MRR@10, exclusion violations, latency, and
// estimated cost per stack. Produces:
//
//   * scripts/eval/results/matrix-<date>.csv   — per-cell flat table
//   * scripts/eval/results/matrix-<date>.md    — per-stack aggregate report
//   * scripts/eval/results/matrix-<date>.json  — full raw payload
//
// Usage:
//   node scripts/eval/bench-matrix.js                       # all stacks, default fixtures
//   node scripts/eval/bench-matrix.js --only=S0,S2,S5       # select stacks by id
//   node scripts/eval/bench-matrix.js --stacks=path.json    # alt stacks config file
//   node scripts/eval/bench-matrix.js --fixtures=path.json  # alt fixture file
//   node scripts/eval/bench-matrix.js --label=2026-04-24a   # override output stem
//   node scripts/eval/bench-matrix.js --limit=5             # first N fixtures only
//
// Environment:
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENAI_API_KEY required.
//   COHERE_API_KEY / JINA_API_KEY / VOYAGE_API_KEY optional — stacks
//   referencing a backend you haven't configured are skipped with a
//   warning instead of failing the whole run.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin, openai } from "../../api/lib/clients.js";
import { STRATEGIES } from "./lib/query-expand.js";
import { rerank as crossRerank, isConfigured as rerankConfigured } from "./lib/cross-rerank.js";
import { rankEvidence, dedupeEvidence } from "../../api/emersus/rerank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DEFAULT = path.join(__dirname, "fixtures", "retrieval.json");
const STACKS_DEFAULT = path.join(__dirname, "stacks.json");
const RESULTS_DIR = path.join(__dirname, "results");

// Fixed eval knobs. match_count=100 so we can measure recall@100.
// match_threshold=0.0 so we get the honest top-K without pre-filtering.
const MATCH_COUNT = 100;
const MATCH_THRESHOLD = 0.0;
const CANDIDATE_MULTIPLIER = 10;
const RRF_K = 60;
// Cap docs sent to cross-encoder reranker. 50 is the sweet spot per
// Anthropic's reranker guidance — plenty of reordering room, half the
// tokens of top-100, keeps us inside Jina's 100K-tok/min free-tier rate
// limit at ~4 calls/min.
const RERANK_POOL_SIZE = 50;

// Cost estimation constants (April 2026 rates).
const OPENAI_RATES = {
  "gpt-4.1-mini": { input: 0.40, output: 1.60 }, // USD per M tokens
  "text-embedding-3-small": { input: 0.02 },
};
const COHERE_RERANK_PER_CALL = 0.002;
const JINA_RERANK_PER_CALL = 0.001;
const VOYAGE_RERANK_PER_CALL = 0.0015;
// zerank-2 is $0.025/1M tokens. 50 docs × ~500 tok = 25K tokens/call → $0.000625
const ZERANK_RERANK_PER_CALL = 0.000625;
// Self-hosted: zero marginal API cost
const SELFHOST_RERANK_PER_CALL = 0;

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    fixtures: FIXTURES_DEFAULT,
    stacks: STACKS_DEFAULT,
    label: new Date().toISOString().slice(0, 10),
    limit: 0,
    stackFilter: null,
    applyProdRerank: false,
  };
  for (const arg of argv.slice(2)) {
    const [k, vRaw] = arg.replace(/^--/, "").split("=");
    const v = vRaw ?? true;
    if (k === "fixtures") args.fixtures = v;
    else if (k === "stacks") args.stacks = v;
    else if (k === "only") {
      args.stackFilter = new Set(String(v).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (k === "label") args.label = v;
    else if (k === "limit") args.limit = Number(v) || 0;
    else if (k === "apply-prod-rerank") args.applyProdRerank = v === true || String(v).toLowerCase() === "true";
  }
  return args;
}

// End-to-end matrix mode: after cross-rerank (or raw if no cross-rerank),
// enrich candidates with the article metadata that api/emersus/rerank.js's
// rankEvidence needs, then run the production heuristic blend (freshness
// 0.30 + quality 0.30 + similarity 0.25 + RCR 0.15) and slice to
// VECTOR_LIMIT=6 — mirrors what retrieve.js feeds the LLM. Reveals
// whether the heuristic preserves or erases retrieval/rerank gains.
const PROD_VECTOR_LIMIT = 6;

async function enrichForProdRerank(candidates) {
  if (!candidates || candidates.length === 0) return [];
  const pmids = [...new Set(candidates.map((c) => Number(c.pmid)).filter(Boolean))];
  const { data: articles, error } = await supabaseAdmin
    .from("research_articles")
    .select("pmid,publication_date,publication_year,publication_types,rcr,source,doi")
    .in("pmid", pmids)
    .eq("is_deleted", false);
  if (error) throw new Error(`enrichForProdRerank: ${error.message}`);
  const byPmid = new Map((articles || []).map((a) => [a.pmid, a]));
  return candidates
    .map((c) => {
      const article = byPmid.get(Number(c.pmid));
      if (!article) return null;
      const pubTypes = Array.isArray(article.publication_types) ? article.publication_types : [];
      return {
        pmid: c.pmid,
        doi: article.doi,
        source_id: c.pmid ? `pmid:${c.pmid}` : null,
        similarity: Number(c.similarity ?? c.score ?? 0),
        database_score: Number(c.similarity ?? c.score ?? 0),
        published_at: article.publication_date || article.publication_year || null,
        evidence_level: pubTypes.join(", "),
        source_type: "pubmed_vector",
        publication_types: pubTypes,
        rcr: article.rcr ?? null,
        // Pass through the fields rankEvidence reads
        title: `pmid:${c.pmid}`, // placeholder; dedup uses source_id first
      };
    })
    .filter(Boolean);
}

async function applyProdRerank(candidates) {
  const enriched = await enrichForProdRerank(candidates);
  if (enriched.length === 0) return [];
  const deduped = dedupeEvidence(enriched);
  const ranked = rankEvidence(deduped);
  return ranked;
}

// ─── Embedding ───────────────────────────────────────────────────────────────

async function embedText(text) {
  if (!openai) throw new Error("OPENAI_API_KEY missing.");
  const input = String(text || "").trim();
  if (!input) throw new Error("Cannot embed empty text.");
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input,
  });
  const emb = response.data[0].embedding;
  const tokens = response.usage?.total_tokens ?? Math.ceil(input.length / 4);
  return { embedding: emb, tokens };
}

// ─── Retrieval ───────────────────────────────────────────────────────────────

async function callRpc({ index, queryEmbedding, queryText }) {
  if (!supabaseAdmin) throw new Error("Supabase admin client missing.");

  if (index === "v4") {
    const { data, error } = await supabaseAdmin.rpc("match_evidence_chunks_v4", {
      query_embedding: queryEmbedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      p_include_preprints: true,
    });
    if (error) throw error;
    return (data || []).map((r, i) => ({
      id: r.id,
      pmid: Number(r.pmid),
      chunk_type: r.chunk_type,
      content: r.content,
      similarity: Number(r.similarity || 0),
      rank: i + 1,
    }));
  }

  if (index === "hybrid_v5") {
    const { data, error } = await supabaseAdmin.rpc("match_evidence_chunks_hybrid_v5", {
      query_embedding: queryEmbedding,
      query_text: queryText,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
      p_include_preprints: true,
      p_rrf_k: RRF_K,
      p_candidate_multiplier: CANDIDATE_MULTIPLIER,
    });
    if (error) throw error;
    return (data || []).map((r, i) => ({
      id: r.id,
      pmid: Number(r.pmid),
      chunk_type: r.chunk_type,
      content: r.content,
      similarity: Number(r.similarity || 0),
      bm25_score: Number(r.bm25_score || 0),
      rrf_score: Number(r.rrf_score || 0),
      rank: i + 1,
    }));
  }

  throw new Error(`Unknown index: ${index}`);
}

// RRF fusion across multiple candidate lists from multi-query expansion.
// Each list contributes rank-based reciprocal-rank-fusion weight to every
// pmid it contains. Dedupe is by pmid (one best chunk per source).
function fuseMultiQuery(candidateLists, k = RRF_K) {
  const acc = new Map();
  for (const list of candidateLists) {
    for (const cand of list) {
      const existing = acc.get(cand.pmid);
      const rrf = 1 / (k + cand.rank);
      if (!existing) {
        acc.set(cand.pmid, { ...cand, rrf_fused: rrf });
      } else {
        existing.rrf_fused += rrf;
        // Keep the representative chunk with the best similarity observed.
        if (cand.similarity > existing.similarity) {
          existing.id = cand.id;
          existing.chunk_type = cand.chunk_type;
          existing.content = cand.content;
          existing.similarity = cand.similarity;
        }
      }
    }
  }
  const fused = Array.from(acc.values()).sort((a, b) => b.rrf_fused - a.rrf_fused);
  return fused.map((c, i) => ({ ...c, rank: i + 1 }));
}

// ─── DOI lookup (canonical-paper resolution) ─────────────────────────────────
// pmid-level recall undercounts cross-source duplicates: a paper indexed under
// pmid A (pubmed) and pmid B (semantic-scholar) with the same DOI is a single
// canonical paper. The fixture's must_include_pmids may list one but the
// retrieval can legitimately surface the other. DOI-level recall collapses
// these so equivalent papers count as hits.

const _pmidDoiCache = new Map();

async function loadPmidToDoi(pmids) {
  const need = [...new Set(pmids.map(Number).filter(Boolean))]
    .filter((p) => !_pmidDoiCache.has(p));
  if (need.length === 0) return;
  // Batch the IN-list to keep the URL under PostgREST limits.
  const batch = 500;
  for (let i = 0; i < need.length; i += batch) {
    const slice = need.slice(i, i + batch);
    const { data, error } = await supabaseAdmin
      .from("research_articles")
      .select("pmid,doi")
      .in("pmid", slice);
    if (error) throw new Error(`loadPmidToDoi: ${error.message}`);
    for (const row of data || []) {
      const doi = row.doi ? String(row.doi).toLowerCase().trim() : null;
      _pmidDoiCache.set(Number(row.pmid), doi || null);
    }
    // Mark unresolved pmids as null so we don't re-query them.
    for (const p of slice) {
      if (!_pmidDoiCache.has(p)) _pmidDoiCache.set(p, null);
    }
  }
}

function pmidToDoiKey(pmid) {
  // For pmids without a DOI in research_articles, use the pmid itself as
  // the canonical key. This preserves pmid-level matching for orphans.
  const doi = _pmidDoiCache.get(Number(pmid));
  return doi || `pmid:${pmid}`;
}

// ─── Per-stack execution ─────────────────────────────────────────────────────

async function runStackOnFixture({ stack, fixture, applyProd = false }) {
  const t0 = Date.now();
  const transform = STRATEGIES[stack.query_transform];
  if (!transform) throw new Error(`Unknown query_transform: ${stack.query_transform}`);

  // 1. Query transform
  const transformStart = Date.now();
  let queryStrings;
  let transformTokensIn = 0;
  let transformTokensOut = 0;
  try {
    // multi-query, hyde, picos all hit the LLM. identity doesn't.
    queryStrings = await transform(fixture.question);
    // Rough token accounting: each LLM call ~200 in + ~100 out, N=1 for identity,
    // N>1 for expansions. We can't easily introspect the helper's actual tokens
    // without plumbing through — use a conservative estimate.
    if (stack.query_transform !== "none") {
      transformTokensIn = 300;
      transformTokensOut = 150;
      if (stack.query_transform === "multi-query+picos") {
        transformTokensIn = 600;
        transformTokensOut = 300;
      }
    }
  } catch (err) {
    return {
      error: `query_transform_failed: ${err.message}`,
      latency_ms: Date.now() - t0,
    };
  }
  const transformMs = Date.now() - transformStart;

  // 2. Embed each query variant.
  const embedStart = Date.now();
  let embeddings;
  let embedTokens = 0;
  try {
    embeddings = await Promise.all(queryStrings.map((q) => embedText(q)));
    embedTokens = embeddings.reduce((a, e) => a + e.tokens, 0);
  } catch (err) {
    return {
      error: `embed_failed: ${err.message}`,
      latency_ms: Date.now() - t0,
    };
  }
  const embedMs = Date.now() - embedStart;

  // 3. Retrieval — one RPC per query variant.
  const rpcStart = Date.now();
  let candidateLists;
  try {
    candidateLists = await Promise.all(
      queryStrings.map((q, i) =>
        callRpc({ index: stack.index, queryEmbedding: embeddings[i].embedding, queryText: q })
      )
    );
  } catch (err) {
    return {
      error: `rpc_failed: ${err.message}`,
      latency_ms: Date.now() - t0,
    };
  }
  const rpcMs = Date.now() - rpcStart;

  // 4. Fuse across query variants (if multi-query). Single-variant stacks
  //    pass through unchanged.
  const fused = candidateLists.length === 1
    ? candidateLists[0]
    : fuseMultiQuery(candidateLists);

  // 5. Cross-encoder rerank (optional).
  let final = fused.slice(0, MATCH_COUNT);
  let rerankMs = 0;
  let rerankCalls = 0;
  if (stack.rerank && stack.rerank !== "none") {
    const rerankStart = Date.now();
    try {
      final = await crossRerank({
        backend: stack.rerank,
        query: fixture.question,
        candidates: fused.slice(0, RERANK_POOL_SIZE).map((c) => ({
          id: c.id,
          pmid: c.pmid,
          chunk_type: c.chunk_type,
          content: c.content,
          similarity: c.similarity,
          rrf_score: c.rrf_score,
        })),
        topN: RERANK_POOL_SIZE,
      });
      rerankCalls = 1;
    } catch (err) {
      return {
        error: `rerank_failed: ${err.message}`,
        latency_ms: Date.now() - t0,
      };
    }
    rerankMs = Date.now() - rerankStart;
  }

  // 5b. Production heuristic rerank (--apply-prod-rerank): applies
  // api/emersus/rerank.js's rankEvidence blend + dedupe, producing the
  // ordering the LLM actually sees in chat. Captures whether the
  // freshness/quality/RCR weights preserve or erase retrieval gains.
  let prodRanked = null;
  let prodRerankMs = 0;
  if (applyProd) {
    const prodStart = Date.now();
    try {
      prodRanked = await applyProdRerank(final.slice(0, MATCH_COUNT));
    } catch (err) {
      return {
        error: `prod_rerank_failed: ${err.message}`,
        latency_ms: Date.now() - t0,
      };
    }
    prodRerankMs = Date.now() - prodStart;
  }

  // 6. Metrics. When applyProd is on, measure on post-heuristic ordering
  // (what prod actually surfaces). Otherwise measure on retrieval/rerank
  // output (what the matrix has historically reported).
  const measuredRows = applyProd ? prodRanked : final;
  const topPmids = measuredRows.map((r) => Number(r.pmid));
  // Resolve DOIs for the top-100 returned pmids and the fixture's must lists
  // so DOI-level recall can collapse cross-source duplicates.
  await loadPmidToDoi([
    ...topPmids.slice(0, 100),
    ...(fixture.must_include_pmids || []),
    ...(fixture.must_exclude_pmids || []),
  ]);
  const metrics = measureRecall({ topPmids, fixture });

  // 7. Cost estimate.
  const cost = estimateCost({
    transformTokensIn,
    transformTokensOut,
    embedTokens,
    rerankBackend: stack.rerank,
    rerankCalls,
  });

  return {
    stack_id: stack.id,
    fixture_question: fixture.question,
    query_variants: queryStrings.length,
    candidate_pool_size: fused.length,
    prod_rerank_applied: applyProd,
    ...metrics,
    latency_ms: Date.now() - t0,
    transform_ms: transformMs,
    embed_ms: embedMs,
    rpc_ms: rpcMs,
    rerank_ms: rerankMs,
    prod_rerank_ms: prodRerankMs,
    cost_usd: cost,
    top_10_pmids: topPmids.slice(0, 10),
    top_6_pmids: topPmids.slice(0, 6),
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

function measureRecall({ topPmids, fixture }) {
  const mustInclude = (fixture.must_include_pmids || []).map(Number);
  const mustExclude = (fixture.must_exclude_pmids || []).map(Number);
  const mustIncludeSet = new Set(mustInclude);

  const top6 = new Set(topPmids.slice(0, 6));
  const top10 = new Set(topPmids.slice(0, 10));
  const top50 = new Set(topPmids.slice(0, 50));
  const top100 = new Set(topPmids.slice(0, 100));

  const denom = Math.max(mustInclude.length, 1);
  const recall6 = mustInclude.filter((p) => top6.has(p)).length / denom;
  const recall10 = mustInclude.filter((p) => top10.has(p)).length / denom;
  const recall50 = mustInclude.filter((p) => top50.has(p)).length / denom;
  const recall100 = mustInclude.filter((p) => top100.has(p)).length / denom;

  // Hit-recall variant: recall is 1 if ANY must_include is in top-K (useful
  // for fixtures where multiple pmids are duplicates of the same paper and
  // surfacing ANY is a pass).
  const hitAt6 = mustInclude.some((p) => top6.has(p)) ? 1 : 0;
  const hitAt10 = mustInclude.some((p) => top10.has(p)) ? 1 : 0;
  const hitAt50 = mustInclude.some((p) => top50.has(p)) ? 1 : 0;
  const hitAt100 = mustInclude.some((p) => top100.has(p)) ? 1 : 0;

  // MRR@10: reciprocal rank of the first must_include in top-10, or 0.
  let mrr10 = 0;
  for (let i = 0; i < Math.min(topPmids.length, 10); i += 1) {
    if (mustIncludeSet.has(topPmids[i])) {
      mrr10 = 1 / (i + 1);
      break;
    }
  }

  // Exclusion violations (at the top-6 cut users see, and at top-10).
  const exclusions6 = mustExclude.filter((p) => top6.has(p)).length;
  const exclusions10 = mustExclude.filter((p) => top10.has(p)).length;

  // ─── DOI-level recall (collapses cross-source duplicates) ────────────────
  // Same metrics computed by canonical paper key (DOI when available, pmid
  // fallback when DOI is missing) so that pmid-X and pmid-Y of the same
  // DOI count as a single canonical paper. Resolves the false-regression
  // observed in 2026-04-25 hybrid_v5 eval where v5 surfaced semantic-scholar
  // pmids of papers the fixture only listed under pubmed pmids.
  const mustIncludeKeys = mustInclude.map(pmidToDoiKey);
  const mustExcludeKeys = mustExclude.map(pmidToDoiKey);
  const mustIncludeKeySet = new Set(mustIncludeKeys);
  const mustIncludeKeyDedupCount = mustIncludeKeySet.size;

  const top6Keys = new Set(topPmids.slice(0, 6).map(pmidToDoiKey));
  const top10Keys = new Set(topPmids.slice(0, 10).map(pmidToDoiKey));
  const top50Keys = new Set(topPmids.slice(0, 50).map(pmidToDoiKey));
  const top100Keys = new Set(topPmids.slice(0, 100).map(pmidToDoiKey));

  const denomDoi = Math.max(mustIncludeKeyDedupCount, 1);
  const recall6Doi = [...mustIncludeKeySet].filter((k) => top6Keys.has(k)).length / denomDoi;
  const recall10Doi = [...mustIncludeKeySet].filter((k) => top10Keys.has(k)).length / denomDoi;
  const recall50Doi = [...mustIncludeKeySet].filter((k) => top50Keys.has(k)).length / denomDoi;
  const recall100Doi = [...mustIncludeKeySet].filter((k) => top100Keys.has(k)).length / denomDoi;

  let mrr10Doi = 0;
  for (let i = 0; i < Math.min(topPmids.length, 10); i += 1) {
    if (mustIncludeKeySet.has(pmidToDoiKey(topPmids[i]))) {
      mrr10Doi = 1 / (i + 1);
      break;
    }
  }

  const exclusionKeySet = new Set(mustExcludeKeys);
  const exclusions6Doi = [...top6Keys].filter((k) => exclusionKeySet.has(k)).length;
  const exclusions10Doi = [...top10Keys].filter((k) => exclusionKeySet.has(k)).length;

  return {
    recall_at_6: recall6,
    recall_at_10: recall10,
    recall_at_50: recall50,
    recall_at_100: recall100,
    hit_at_6: hitAt6,
    hit_at_10: hitAt10,
    hit_at_50: hitAt50,
    hit_at_100: hitAt100,
    mrr_at_10: mrr10,
    exclusion_violations_at_6: exclusions6,
    exclusion_violations_at_10: exclusions10,
    must_include_count: mustInclude.length,
    must_exclude_count: mustExclude.length,
    // DOI-level metrics (canonical-paper recall)
    recall_at_6_doi: recall6Doi,
    recall_at_10_doi: recall10Doi,
    recall_at_50_doi: recall50Doi,
    recall_at_100_doi: recall100Doi,
    mrr_at_10_doi: mrr10Doi,
    exclusion_violations_at_6_doi: exclusions6Doi,
    exclusion_violations_at_10_doi: exclusions10Doi,
    must_include_doi_count: mustIncludeKeyDedupCount,
  };
}

// ─── Cost ────────────────────────────────────────────────────────────────────

function estimateCost({ transformTokensIn, transformTokensOut, embedTokens, rerankBackend, rerankCalls }) {
  const mini = OPENAI_RATES["gpt-4.1-mini"];
  const emb = OPENAI_RATES["text-embedding-3-small"];
  const transformCost =
    (transformTokensIn / 1_000_000) * mini.input +
    (transformTokensOut / 1_000_000) * mini.output;
  const embedCost = (embedTokens / 1_000_000) * emb.input;
  let rerankCost = 0;
  if (rerankBackend === "cohere")        rerankCost = rerankCalls * COHERE_RERANK_PER_CALL;
  else if (rerankBackend === "jina")     rerankCost = rerankCalls * JINA_RERANK_PER_CALL;
  else if (rerankBackend === "voyage")   rerankCost = rerankCalls * VOYAGE_RERANK_PER_CALL;
  else if (rerankBackend === "zerank")   rerankCost = rerankCalls * ZERANK_RERANK_PER_CALL;
  else if (rerankBackend === "selfhost") rerankCost = rerankCalls * SELFHOST_RERANK_PER_CALL;
  return Number((transformCost + embedCost + rerankCost).toFixed(6));
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregatePerStack(rows) {
  const byStack = new Map();
  for (const r of rows) {
    if (r.error) {
      const ex = byStack.get(r.stack_id) || { stack_id: r.stack_id, errors: 0, count: 0 };
      ex.errors += 1;
      ex.count = (ex.count || 0);
      byStack.set(r.stack_id, ex);
      continue;
    }
    const ex = byStack.get(r.stack_id) || {
      stack_id: r.stack_id,
      count: 0,
      recall_at_10: 0, recall_at_50: 0, recall_at_100: 0,
      hit_at_10: 0, hit_at_50: 0, hit_at_100: 0,
      mrr_at_10: 0,
      exclusion_violations_at_10: 0,
      recall_at_10_doi: 0, recall_at_50_doi: 0, recall_at_100_doi: 0,
      mrr_at_10_doi: 0,
      exclusion_violations_at_10_doi: 0,
      latency_ms: 0,
      cost_usd: 0,
      errors: 0,
    };
    ex.count += 1;
    ex.recall_at_10 += r.recall_at_10;
    ex.recall_at_50 += r.recall_at_50;
    ex.recall_at_100 += r.recall_at_100;
    ex.hit_at_10 += r.hit_at_10;
    ex.hit_at_50 += r.hit_at_50;
    ex.hit_at_100 += r.hit_at_100;
    ex.mrr_at_10 += r.mrr_at_10;
    ex.exclusion_violations_at_10 += r.exclusion_violations_at_10;
    ex.recall_at_10_doi += r.recall_at_10_doi || 0;
    ex.recall_at_50_doi += r.recall_at_50_doi || 0;
    ex.recall_at_100_doi += r.recall_at_100_doi || 0;
    ex.mrr_at_10_doi += r.mrr_at_10_doi || 0;
    ex.exclusion_violations_at_10_doi += r.exclusion_violations_at_10_doi || 0;
    ex.latency_ms += r.latency_ms;
    ex.cost_usd += r.cost_usd;
    byStack.set(r.stack_id, ex);
  }
  const agg = [];
  const safe = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  for (const ex of byStack.values()) {
    const n = Math.max(ex.count, 1);
    agg.push({
      stack_id: ex.stack_id,
      fixtures: ex.count || 0,
      errors: ex.errors || 0,
      mean_recall_at_10: Number((safe(ex.recall_at_10) / n).toFixed(3)),
      mean_recall_at_50: Number((safe(ex.recall_at_50) / n).toFixed(3)),
      mean_recall_at_100: Number((safe(ex.recall_at_100) / n).toFixed(3)),
      hit_rate_at_10: Number((safe(ex.hit_at_10) / n).toFixed(3)),
      hit_rate_at_50: Number((safe(ex.hit_at_50) / n).toFixed(3)),
      hit_rate_at_100: Number((safe(ex.hit_at_100) / n).toFixed(3)),
      mean_mrr_at_10: Number((safe(ex.mrr_at_10) / n).toFixed(3)),
      total_exclusion_violations: safe(ex.exclusion_violations_at_10),
      mean_recall_at_10_doi: Number((safe(ex.recall_at_10_doi) / n).toFixed(3)),
      mean_recall_at_50_doi: Number((safe(ex.recall_at_50_doi) / n).toFixed(3)),
      mean_recall_at_100_doi: Number((safe(ex.recall_at_100_doi) / n).toFixed(3)),
      mean_mrr_at_10_doi: Number((safe(ex.mrr_at_10_doi) / n).toFixed(3)),
      total_exclusion_violations_doi: safe(ex.exclusion_violations_at_10_doi),
      mean_latency_ms: Math.round(safe(ex.latency_ms) / n),
      total_cost_usd: Number(safe(ex.cost_usd).toFixed(4)),
    });
  }
  return agg;
}

// ─── Output writers ──────────────────────────────────────────────────────────

function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = r[c];
          if (v === undefined || v === null) return "";
          if (Array.isArray(v)) return `"${v.join(";")}"`;
          const s = String(v).replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(",")
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

function toMarkdownReport({ stacks, fixtures, rows, agg, label, durationSec }) {
  const lines = [];
  lines.push(`# Retrieval Matrix Results — ${label}`);
  lines.push("");
  lines.push(`**Stacks:** ${stacks.length} | **Fixtures:** ${fixtures.length} | **Cells run:** ${rows.length} | **Wall time:** ${durationSec}s`);
  lines.push("");
  lines.push("## Per-stack aggregate");
  lines.push("");
  lines.push("| Stack | Label | Recall@10 | Recall@50 | Recall@100 | Hit@10 | MRR@10 | Excl viol | Latency | Cost |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const stackById = new Map(stacks.map((s) => [s.id, s]));
  const sortedAgg = [...agg].sort((a, b) => b.mean_recall_at_10 - a.mean_recall_at_10);
  for (const a of sortedAgg) {
    const s = stackById.get(a.stack_id);
    const label = s?.label || a.stack_id;
    const err = a.errors ? ` ⚠${a.errors}err` : "";
    lines.push(
      `| ${a.stack_id} | ${label}${err} | ${(a.mean_recall_at_10 * 100).toFixed(1)}% | ${(a.mean_recall_at_50 * 100).toFixed(1)}% | ${(a.mean_recall_at_100 * 100).toFixed(1)}% | ${(a.hit_rate_at_10 * 100).toFixed(1)}% | ${a.mean_mrr_at_10.toFixed(3)} | ${a.total_exclusion_violations} | ${a.mean_latency_ms}ms | $${a.total_cost_usd.toFixed(4)} |`
    );
  }
  lines.push("");
  lines.push("## Per-fixture × stack recall@10 matrix");
  lines.push("");
  const byFixture = new Map();
  for (const r of rows) {
    if (!r.fixture_question) continue;
    if (!byFixture.has(r.fixture_question)) byFixture.set(r.fixture_question, {});
    byFixture.get(r.fixture_question)[r.stack_id] = r;
  }
  const stackIds = stacks.map((s) => s.id);
  lines.push(`| Fixture | ${stackIds.join(" | ")} |`);
  lines.push(`|---|${stackIds.map(() => "---:").join("|")}|`);
  for (const [question, cells] of byFixture.entries()) {
    const q = question.length > 48 ? question.slice(0, 45) + "…" : question;
    const cellStrs = stackIds.map((sid) => {
      const r = cells[sid];
      if (!r) return "—";
      if (r.error) return "ERR";
      return `${(r.recall_at_10 * 100).toFixed(0)}%`;
    });
    lines.push(`| ${q} | ${cellStrs.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Error log");
  lines.push("");
  const errRows = rows.filter((r) => r.error);
  if (errRows.length === 0) {
    lines.push("_No errors._");
  } else {
    for (const e of errRows) {
      lines.push(`- \`${e.stack_id}\` × "${e.fixture_question}" → ${e.error}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();

  const fixtures = JSON.parse(await fs.readFile(args.fixtures, "utf8"));
  const stacksAll = JSON.parse(await fs.readFile(args.stacks, "utf8"));
  const stacks = args.stackFilter
    ? stacksAll.filter((s) => args.stackFilter.has(s.id))
    : stacksAll;
  const useFixtures = args.limit ? fixtures.slice(0, args.limit) : fixtures;

  // Early config check: skip stacks that need API keys we don't have.
  const viableStacks = [];
  for (const s of stacks) {
    if (!rerankConfigured(s.rerank)) {
      console.warn(`# [${s.id}] skipped: ${s.rerank} rerank configured but API key missing.`);
      continue;
    }
    viableStacks.push(s);
  }

  console.log(`# Running matrix: ${viableStacks.length} stacks × ${useFixtures.length} fixtures = ${viableStacks.length * useFixtures.length} cells`);

  const rows = [];
  let cellIdx = 0;
  const totalCells = viableStacks.length * useFixtures.length;
  for (const stack of viableStacks) {
    console.log(`\n## Stack ${stack.id} — ${stack.label}`);
    for (const fixture of useFixtures) {
      cellIdx += 1;
      const result = await runStackOnFixture({ stack, fixture, applyProd: args.applyProdRerank });
      rows.push({
        stack_id: stack.id,
        fixture_question: fixture.question,
        ...result,
      });
      if (result.error) {
        console.log(`  [${cellIdx}/${totalCells}] ${fixture.question.padEnd(55)} ERR: ${result.error}`);
      } else {
        const tail = `pmid@10=${(result.recall_at_10 * 100).toFixed(0)}% doi@10=${(result.recall_at_10_doi * 100).toFixed(0)}% doi@100=${(result.recall_at_100_doi * 100).toFixed(0)}% mrr=${result.mrr_at_10_doi.toFixed(2)} ${result.latency_ms}ms $${result.cost_usd.toFixed(4)}`;
        console.log(`  [${cellIdx}/${totalCells}] ${fixture.question.padEnd(55)} ${tail}`);
      }
    }
  }

  const agg = aggregatePerStack(rows);
  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stem = path.join(RESULTS_DIR, `matrix-${args.label}`);

  const csvColumns = [
    "stack_id", "fixture_question", "recall_at_10", "recall_at_50", "recall_at_100",
    "hit_at_10", "hit_at_50", "hit_at_100", "mrr_at_10", "exclusion_violations_at_10",
    "candidate_pool_size", "query_variants", "latency_ms", "transform_ms", "embed_ms",
    "rpc_ms", "rerank_ms", "cost_usd", "top_10_pmids", "error",
  ];
  await fs.writeFile(`${stem}.csv`, toCsv(rows, csvColumns));
  await fs.writeFile(
    `${stem}.md`,
    toMarkdownReport({ stacks: viableStacks, fixtures: useFixtures, rows, agg, label: args.label, durationSec })
  );
  await fs.writeFile(
    `${stem}.json`,
    JSON.stringify({ args, stacks: viableStacks, fixtures: useFixtures, rows, agg, durationSec }, null, 2)
  );

  console.log(`\n# Done in ${durationSec}s`);
  console.log(`# CSV:  ${stem}.csv`);
  console.log(`# MD:   ${stem}.md`);
  console.log(`# JSON: ${stem}.json`);

  // Print the aggregate ranking — DOI metrics first (canonical-paper recall),
  // pmid metrics second for back-compat with prior runs.
  console.log("\n# Aggregate ranking by DOI recall@10 (canonical paper):");
  const sortedDoi = [...agg].sort((a, b) => b.mean_recall_at_10_doi - a.mean_recall_at_10_doi);
  for (const a of sortedDoi) {
    console.log(
      `  ${a.stack_id.padEnd(4)} doi@10=${(a.mean_recall_at_10_doi * 100).toFixed(1)}% doi@100=${(a.mean_recall_at_100_doi * 100).toFixed(1)}% mrr_doi=${a.mean_mrr_at_10_doi.toFixed(3)} | pmid@10=${(a.mean_recall_at_10 * 100).toFixed(1)}% pmid@100=${(a.mean_recall_at_100 * 100).toFixed(1)}% $${a.total_cost_usd.toFixed(4)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
