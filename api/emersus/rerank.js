// Shared rerank + scoring for the Emersus evidence pipeline.
//
// Single source of truth for how retrieved PubMed chunks are scored and
// ordered. Both retrieveDatabaseEvidence.js (candidate fetch) and
// workflow.js (synthesis) import from here so the pipeline runs exactly
// one rerank, not two.
//
// The old two-pass rerank — (similarity + pub_type_weight*0.03) inside
// retrieval, then (0.35*freshness + 0.35*quality + 0.30*similarity) in
// workflow — has been collapsed into this module. The second blend won,
// because it's what the UI's freshness/quality badges and the confidence
// score already use; keeping both was redundant and the pre-slice inside
// retrieval meant the workflow rerank was only seeing 6 candidates
// instead of the full 10 from the RPC.

function clamp(value, min, max) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function scoreEvidenceFreshness(publishedAt) {
  if (!publishedAt) return 0.45;

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) return 0.45;

  const daysOld = (Date.now() - publishedTime) / (1000 * 60 * 60 * 24);

  if (daysOld <= 180) return 1;
  if (daysOld <= 365 * 2) return 0.82;
  if (daysOld <= 365 * 5) return 0.66;
  return 0.5;
}

export function scoreEvidenceQuality(evidenceLevel, sourceType) {
  const text = `${evidenceLevel} ${sourceType}`.toLowerCase();

  if (/meta|systematic|guideline|consensus|review/.test(text)) return 1;
  if (/trial|rct|peer|journal|database/.test(text)) return 0.84;
  return 0.68;
}

// Score a paper's impact from its NIH iCite Relative Citation Ratio.
//
// RCR is field-normalized (1.0 = average for field), so we center the
// scale on 1.0 → 0.5 and use a log transform so extreme outliers (max
// observed ~911) don't dominate. Floor 0.25 guards against an RCR=0
// paper from being ranked below 0 after the weighted blend; cap 1.0
// saturates at log2(1+rcr)=7 (≈ rcr 127), comfortably above p99.
//
// NULL/missing RCR → 0.5 (neutral). About half the corpus has no RCR
// yet (recent papers NIH hasn't computed). Penalizing them would be
// unfair and would systematically demote newer research.
export function scoreEvidenceImpact(rcr) {
  if (rcr === null || rcr === undefined) return 0.5;
  const numeric = Number(rcr);
  if (!Number.isFinite(numeric)) return 0.5;
  if (numeric <= 0) return 0.25;

  // log2(1+rcr) maps:  0 → 0,  1 → 1,  5 → 2.58,  50 → 5.67,  911 → 9.83
  // Subtract 1 to center on median (rcr=1 → 0). Divide by 6 so a
  // log2 delta of 6 saturates the boost (≈ rcr 63+).
  const centered = (Math.log2(1 + numeric) - 1) / 6;
  return clamp(0.5 + centered, 0.25, 1);
}

// Weighted blend: freshness 0.30 + quality 0.30 + similarity 0.25 + impact 0.15.
// Items must already have `published_at`, `evidence_level`, `source_type`,
// a similarity-like field (`similarity` or `database_score`), and
// optionally `rcr` (NIH iCite Relative Citation Ratio; missing values
// score as neutral). This is the shape produced by
// normalizeVectorEvidenceRow in workflow.js.
//
// Impact (RCR) was added to push field-defining / heavily-cited papers
// toward the top when semantic and quality signals are otherwise tied,
// without letting it dominate: weight is 15%, and the score function
// centers on median. A paper with median impact and good semantic
// match will still beat a paper with max impact and weak semantic
// match — impact is a tiebreaker, not a replacement.
export function rankEvidence(evidence) {
  return [...evidence]
    .map((item) => {
      const freshnessScore = scoreEvidenceFreshness(item.published_at);
      const qualityScore = scoreEvidenceQuality(
        item.evidence_level,
        item.source_type
      );
      const similarityScore = clamp(
        item.similarity ?? item.database_score ?? 0,
        0,
        1
      );
      const impactScore = scoreEvidenceImpact(item.rcr);
      const rankingScore =
        freshnessScore * 0.3 +
        qualityScore * 0.3 +
        similarityScore * 0.25 +
        impactScore * 0.15;

      return {
        ...item,
        freshness_score: Number(freshnessScore.toFixed(2)),
        quality_score: Number(qualityScore.toFixed(2)),
        impact_score: Number(impactScore.toFixed(2)),
        ranking_score: Number(rankingScore.toFixed(2)),
      };
    })
    .sort((left, right) => right.ranking_score - left.ranking_score);
}

// Dual-pass dedup. Pass 1 collapses by strongest available identifier
// (source_id → pmid → doi → external_id → url → normalized title). Pass 2
// re-collapses on (normalized title + first-author surname + year) so cases
// where the SAME paper was ingested under multiple DOIs survive only once.
// This happens in practice with:
//   - Zenodo versioned records: each version gets its own DOI, yet the
//     retrieval index stores them as separate research_articles rows.
//   - Crossref / OpenAlex emitting two DOIs for the same work (rare).
//   - Same paper indexed from multiple sources where one lacks a DOI (the
//     DOI-present row and the DOI-absent row skip each other on Pass 1).
//
// Secondary-pass collision risk (two genuinely different papers with
// identical title + same first-author surname + same year) is negligible
// vs. the observed dupe rate. If a future case pops up, extend the key
// with journal or add a manual override list.
function primaryDedupKey(item) {
  const normalizedTitle = String(item.title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return (
    item.source_id ||
    (item.pmid ? `pmid:${item.pmid}` : null) ||
    (item.doi ? `doi:${String(item.doi).toLowerCase()}` : null) ||
    (item.external_id ? `ext:${String(item.external_id).toLowerCase()}` : null) ||
    item.url ||
    (normalizedTitle ? `title:${normalizedTitle}` : null) ||
    null
  );
}

function secondaryDedupKey(item) {
  const title = String(item.title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const rawAuthor = Array.isArray(item.authors) && item.authors[0]
    ? String(item.authors[0])
    : String(item.author_label || "");
  // Heuristic first-author surname: trim, lowercase, first whitespace- or
  // comma-separated token. Handles "Morton RW" → "morton", "Morton, Robert"
  // → "morton". Good enough to match across sources that normalize author
  // order differently.
  const firstAuthorSurname = rawAuthor
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)[0] || "";
  const year = String(item.publication_year || "").slice(0, 4);
  if (!title || !year) return null;
  return `${title}|${firstAuthorSurname}|${year}`;
}

function rankingScoreOf(item) {
  return Number(item.ranking_score || item.similarity || 0);
}

export function dedupeEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return [];

  // Pass 1: primary identifier-based dedup.
  const byPrimary = new Map();
  const unkeyed = [];
  for (const item of evidence) {
    const key = primaryDedupKey(item);
    if (!key) { unkeyed.push(item); continue; }
    const existing = byPrimary.get(key);
    if (!existing || rankingScoreOf(item) > rankingScoreOf(existing)) {
      byPrimary.set(key, item);
    }
  }

  // Pass 2: secondary (title + first-author surname + year) dedup. Catches
  // same-paper-different-DOI cases that primary dedup can't see.
  const bySecondary = new Map();
  const final = [];
  for (const item of [...byPrimary.values(), ...unkeyed]) {
    const secondary = secondaryDedupKey(item);
    if (!secondary) { final.push(item); continue; }
    const existing = bySecondary.get(secondary);
    if (!existing || rankingScoreOf(item) > rankingScoreOf(existing)) {
      bySecondary.set(secondary, item);
    }
  }
  for (const item of bySecondary.values()) final.push(item);

  return final;
}
