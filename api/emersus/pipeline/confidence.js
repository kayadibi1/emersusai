import {
  scoreEvidenceFreshness,
  scoreEvidenceQuality,
  scoreEvidenceImpact,
} from "../rerank.js";

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function computeConfidence({ plan, evidence }) {
  const sources = Array.isArray(evidence) ? evidence.slice(0, 5) : [];
  const totalSources = sources.length;
  const recentSourceCount = sources.filter(
    (source) =>
      Number(source?.freshness_score ?? scoreEvidenceFreshness(source?.published_at)) >= 0.82
  ).length;
  const highQualitySourceCount = sources.filter(
    (source) =>
      Number(
        source?.quality_score ??
          scoreEvidenceQuality(source?.evidence_level, source?.source_type)
      ) >= 0.84
  ).length;
  const highImpactSourceCount = sources.filter(
    (source) => Number(source?.impact_score ?? scoreEvidenceImpact(source?.rcr)) >= 0.7
  ).length;

  const recencySupport = totalSources ? recentSourceCount / totalSources : 0;
  const qualitySupport = totalSources ? highQualitySourceCount / totalSources : 0;
  const impactSupport = totalSources ? highImpactSourceCount / totalSources : 0;
  const coverageSupport = Math.min(totalSources / 4, 1);
  const riskPenalty = plan?.riskLevel === "medium" ? 0.08 : 0;

  const score = clamp(
    0.2 +
      recencySupport * 0.3 +
      qualitySupport * 0.25 +
      impactSupport * 0.1 +
      coverageSupport * 0.2 -
      riskPenalty,
    0.18,
    0.95
  );

  return {
    score: Number(score.toFixed(2)),
    label: score >= 0.75 ? "high" : score >= 0.5 ? "moderate" : "low",
    rationale:
      score >= 0.75
        ? "The top retrieved studies are recent, relevant, and relatively strong."
        : score >= 0.5
          ? "The recommendation has useful support, but evidence quality, recency, or personalization is mixed."
          : "The retrieved support is limited or only partially matched to the question.",
  };
}
