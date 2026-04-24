/**
 * pipeline/retrieve.js — Vector evidence retrieval + formatting.
 *
 * Extracted verbatim from workflow.js. Provides the retrieve pipeline stage
 * that fetches pgvector evidence, deduplicates, reranks, and formats it for
 * the LLM synthesis prompt.
 */

import { retrieveDatabaseEvidence as retrieveVectorDatabaseEvidence } from "../retrieveDatabaseEvidence.js";
import { rankEvidence, dedupeEvidence } from "../rerank.js";
import { formatCitationUrl, formatCitationLabel } from "../../../shared/citation-format.js";
import { normalizeText, normalizeList } from "./sanitize.js";
import { ShortCircuit } from "./context.js";
import { formatSources } from "./format-sources.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const VECTOR_LIMIT = 6;
const VECTOR_MATCH_THRESHOLD = 0.4;
// Bumped from 10 → 25 on 2026-04-24 alongside the Jina rerank integration.
// A pool of 10 left the cross-encoder with nothing to reorder and capped
// what the heuristic rankEvidence blend could pick from. 25 is the sweet
// spot: wide enough for Jina to surface a relevant candidate from ranks
// 15-25 that cosine-sim missed, narrow enough that per-request cost
// (both Jina tokens and enrichment SQL) stays trivial.
const VECTOR_MATCH_COUNT = 25;

// ─── Helpers (verbatim from workflow.js) ─────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parsePublicationTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 80))
    .filter(Boolean)
    .slice(0, 6);
}

function parseAuthors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 160))
    .filter(Boolean)
    .slice(0, 12);
}

function formatAuthorLabel(authors) {
  const normalized = parseAuthors(authors);

  if (normalized.length === 0) {
    return "";
  }

  const firstAuthor = normalized[0];
  const surname = firstAuthor.split(/\s+/).slice(-1)[0] || firstAuthor;
  return normalized.length === 1 ? surname : `${surname} et al.`;
}

// ─── Row normalisation (verbatim from workflow.js ~lines 1448–1504) ──────────

export function normalizeVectorEvidenceRow(row) {
  const publicationTypes = parsePublicationTypes(row.publication_types);
  const publicationYear = normalizeText(row.publication_year, 8);
  const publicationDate = normalizeText(row.publication_date, 40);
  const pmid = normalizeText(row.pmid, 32);
  const doi = normalizeText(row.doi, 160);
  const sourceTag = row.source || "pubmed";
  // Build a citation-source object that formatCitationUrl/Label understands.
  // row.pmid is numeric; pass it as-is so the SYNTHETIC_PMID_FLOOR guard works.
  const citationSource = {
    source: sourceTag,
    pmid: typeof row.pmid === "number" ? row.pmid : Number(row.pmid) || null,
    doi,
    external_id: row.external_id ?? null,
  };
  const citationLabel = formatCitationLabel(citationSource);
  const citationUrl = formatCitationUrl(citationSource);

  return {
    source_id: citationLabel || (pmid ? `pmid:${pmid}` : null),
    source: sourceTag,
    external_id: row.external_id ?? null,
    pmid,
    doi,
    pmcid: normalizeText(row.pmcid, 40),
    authors: parseAuthors(row.authors),
    author_label: formatAuthorLabel(row.authors),
    title: normalizeText(row.title, 240),
    journal: normalizeText(row.journal, 160),
    publication_year: publicationYear,
    publication_date: publicationDate,
    publication_types: publicationTypes,
    publication_type: publicationTypes.join(", "),
    chunk_type: normalizeText(row.chunk_type, 40),
    chunk_text: normalizeText(row.chunk_text, 1200),
    // For title-only matches, blank the excerpt-bearing fields so neither
    // the LLM prompt nor the UI sees redundant title-as-passage. The UI
    // renders an honest "title-only match" fallback in this case.
    excerpt: row.is_title_only_match ? "" : normalizeText(row.chunk_text, 420),
    summary: row.is_title_only_match ? "" : normalizeText(row.chunk_text, 600),
    matched_chunk_type: normalizeText(row.matched_chunk_type, 40) || null,
    is_title_only_match: row.is_title_only_match === true,
    similarity: clamp(Number(row.similarity || 0), 0, 1),
    database_score: clamp(Number(row.similarity || 0), 0, 1),
    // Credibility/impact signals from retrieveDatabaseEvidence — flow
    // into rankEvidence's scoreEvidenceImpact() + get surfaced in the
    // final evidence object so the UI / confidence score can show them.
    rcr: row.rcr ?? null,
    citation_count: row.citation_count ?? null,
    influential_citation_count: row.influential_citation_count ?? null,
    publication_country: row.publication_country ?? null,
    source_type: "pubmed_vector",
    evidence_level: publicationTypes.join(", "),
    published_at: publicationDate || publicationYear,
    url: citationUrl || "",
    why_it_matters: row.is_title_only_match
      ? ""
      : normalizeText(
          row.chunk_text || `Matched a PubMed evidence chunk with similarity ${Number(row.similarity || 0).toFixed(2)}.`,
          240
        ),
    mesh_terms: Array.isArray(row.mesh_terms) ? row.mesh_terms.slice(0, 8) : [],
  };
}

// ─── Retrieval (verbatim from workflow.js ~lines 1518–1547) ──────────────────

async function retrieveVectorEvidence(question, { includePreprints = true } = {}) {
  try {
    // Retrieval returns the raw candidate pool (up to VECTOR_MATCH_COUNT).
    // All ranking happens here via the shared rerank module so there is
    // exactly one rerank pass in the pipeline, operating on the full pool
    // instead of a pre-truncated subset. includePreprints is threaded
    // through to match_evidence_chunks_v3 — false for Free, true for Pro.
    const matches = await retrieveVectorDatabaseEvidence({
      prompt: question,
      matchThreshold: VECTOR_MATCH_THRESHOLD,
      matchCount: VECTOR_MATCH_COUNT,
      includePreprints,
    });

    return {
      available: matches.length > 0,
      method: "vector",
      evidence: rankEvidence(
        dedupeEvidence(matches.map(normalizeVectorEvidenceRow))
      ).slice(0, VECTOR_LIMIT),
      error: null,
    };
  } catch (error) {
    console.error("Vector evidence retrieval failed:", error);
    return {
      available: false,
      method: null,
      evidence: [],
      error: error.message || "Vector evidence retrieval failed.",
    };
  }
}

// ─── Formatting (verbatim from workflow.js ~lines 1549–1581) ─────────────────

export function formatEvidenceForModel(evidence) {
  if (!evidence.length) {
    return "No database evidence retrieved.";
  }

  // Compact two-line shape per doc: a single pipe-separated metadata header
  // followed by the excerpt. Saves ~35 input tokens per doc vs the old
  // labelled "Authors:/PMID:/Journal:/Year:/Publication type:" stack while
  // still surfacing every field the model actually uses (year, study type,
  // journal, pmid, title, excerpt). The model has no trouble parsing this
  // shape — labels are only useful when fields are ambiguous.
  //
  // Sliced to VECTOR_LIMIT so the model and the right-rail sources panel
  // see the same set. Previously this was hardcoded to 5 while the panel
  // used 6, so the sixth source showed up in the UI but was invisible to
  // the LLM.
  // Retrieved evidence is wrapped in <source_untrusted id="N">…</source_untrusted>
  // delimiters so the prompt's trust-boundary rule can instruct the model to
  // ignore any imperatives embedded inside (prompt-injection defense — authors,
  // titles, and abstracts are user-authored upstream data, not instructions).
  return evidence
    .slice(0, VECTOR_LIMIT)
    .map((item, index) => {
      const year = item.publication_year || item.published_at || "";
      const pubType = item.publication_type || item.evidence_level || "";
      const headerParts = [
        year || null,
        pubType || null,
        item.journal || null,
        item.pmid ? `pmid ${item.pmid}` : null,
        item.author_label || null,
      ].filter(Boolean);
      const header = `[${index + 1}] ${headerParts.length ? `${headerParts.join(" · ")} — ` : ""}${item.title || "Untitled evidence"}`;
      const inner = item.excerpt ? `${header}\n${item.excerpt}` : header;
      return `<source_untrusted id="${index + 1}">\n${inner}\n</source_untrusted>`;
    })
    .join("\n\n");
}

function buildSkippedEvidence(reason) {
  return {
    status: "skipped",
    reason,
    available: false,
    usable: false,
    usePolicy: "action_only_no_evidence",
    method: null,
    items: [],
    formatted: null,
    error: null,
  };
}

function hasUsableEvidence(items) {
  return Array.isArray(items) && items.some((item) =>
    item?.is_title_only_match !== true &&
    typeof item?.excerpt === "string" &&
    item.excerpt.trim().length >= 120
  );
}

function buildInsufficientEvidenceResponse(ctx) {
  const items = Array.isArray(ctx.evidence?.items) ? ctx.evidence.items : [];
  const hasRelatedSources = items.length > 0;
  const answerText = hasRelatedSources
    ? "I found related database sources, but the retrieved passages are not strong enough to answer without leaning on pretrained knowledge. Ask me to narrow the question, or try a more specific version so I can retrieve usable evidence."
    : "I don't have enough retrieved database evidence to answer that without leaning on pretrained knowledge. Ask me to narrow the question, or try a more specific version so I can retrieve usable evidence.";

  return {
    user: {
      id: ctx.stableUserId || null,
      profile_used: {},
    },
    plan: ctx.plan,
    summary: answerText,
    answer_text: answerText,
    recommendations: {
      general: [],
    },
    confidence: {
      score: 0.18,
      label: "insufficient",
      rationale: hasRelatedSources
        ? "Related database sources were retrieved, but none contained enough passage-level support to ground an answer."
        : "No usable database evidence was retrieved for this question.",
    },
    limitations: [
      "Emersus is configured to avoid answering from pretrained model knowledge when retrieved evidence is insufficient.",
    ],
    sources: formatSources(items),
    cards: [],
    guardrail: {
      status: "allowed",
      response_mode: "insufficient_evidence",
      reasons: [ctx.evidence?.usePolicy || "no_usable_evidence"],
    },
  };
}

// ─── Pipeline stage ───────────────────────────────────────────────────────────

export async function retrieve(ctx, { retrieveVectorEvidenceImpl = retrieveVectorEvidence } = {}) {
  if (ctx.retrievalPolicy?.mode === "skip") {
    ctx._timer.record("retrieval_ms", 0);
    ctx.evidence = buildSkippedEvidence(ctx.retrievalPolicy.reason);
    return ctx;
  }

  const start = Date.now();
  const result = await retrieveVectorEvidenceImpl(ctx.question, {
    includePreprints: ctx.tier === "pro",
  });
  ctx._timer.record("retrieval_ms", Date.now() - start);
  const items = result.evidence.slice(0, VECTOR_LIMIT);
  const usable = hasUsableEvidence(items);
  ctx.evidence = {
    status: "completed",
    reason: null,
    available: result.available,
    usable,
    usePolicy: result.available
      ? (usable ? "retrieved_evidence_only" : "no_usable_evidence")
      : "no_usable_evidence",
    method: result.method,
    items,
    formatted: formatEvidenceForModel(result.evidence),
    error: result.error,
  };

  if (ctx.evidence.usePolicy === "no_usable_evidence") {
    throw new ShortCircuit(buildInsufficientEvidenceResponse(ctx));
  }

  return ctx;
}
