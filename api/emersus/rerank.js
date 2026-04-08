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

// Weighted blend: freshness 0.35 + quality 0.35 + similarity 0.30.
// Items must already have `published_at`, `evidence_level`, `source_type`,
// and a similarity-like field (`similarity` or `database_score`). This is
// the shape produced by normalizeVectorEvidenceRow in workflow.js.
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
      const rankingScore =
        freshnessScore * 0.35 + qualityScore * 0.35 + similarityScore * 0.3;

      return {
        ...item,
        freshness_score: Number(freshnessScore.toFixed(2)),
        quality_score: Number(qualityScore.toFixed(2)),
        ranking_score: Number(rankingScore.toFixed(2)),
      };
    })
    .sort((left, right) => right.ranking_score - left.ranking_score);
}

export function dedupeEvidence(evidence) {
  const byId = new Map();

  for (const item of evidence) {
    const key =
      item.source_id ||
      item.pmid ||
      item.doi ||
      item.url ||
      `${item.title}:${item.excerpt}`;

    const existing = byId.get(key);

    if (
      !existing ||
      Number(item.ranking_score || 0) > Number(existing.ranking_score || 0)
    ) {
      byId.set(key, item);
    }
  }

  return [...byId.values()];
}
