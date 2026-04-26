export function assignBucket({ cited_ids, source_scores }) {
  if (!Array.isArray(cited_ids) || cited_ids.length === 0) {
    return { mode: "no_marker", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  const cited = new Set(cited_ids);
  const citedScores = source_scores.filter((s) => cited.has(s.source_index));
  const uncitedScores = source_scores.filter((s) => !cited.has(s.source_index));

  // mode_4: any cited source contradicts the claim
  const citedContradictions = citedScores.filter((s) => s.direction === "contradicts");
  if (citedContradictions.length > 0) {
    return { mode: "mode_4_contradicted", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  // mode_3: no source supports at all AND no source contradicts
  const anySupports = source_scores.some((s) => s.direction === "supports" && s.support_score >= 1);
  const anyContradicts = source_scores.some((s) => s.direction === "contradicts");
  if (!anySupports && !anyContradicts) {
    return { mode: "mode_3_fabrication", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  const bestCitedScore = citedScores.reduce(
    (best, s) => (s.direction === "supports" && s.support_score > best ? s.support_score : best),
    0,
  );
  const bestUncitedScore = uncitedScores.reduce(
    (best, s) => (s.direction === "supports" && s.support_score > best ? s.support_score : best),
    0,
  );

  // mode_1: best uncited support is full (2) AND best cited support is partial or worse (<2)
  if (bestUncitedScore === 2 && bestCitedScore < 2) {
    return { mode: "mode_1_misattribution", qualifier_diff: null, alternate_supporting_sources: [] };
  }

  // Find the cited source(s) at the best score with the largest qualifier_missing list
  const bestCited = citedScores
    .filter((s) => s.direction === "supports" && s.support_score === bestCitedScore)
    .sort((a, b) => (b.qualifiers_missing?.length || 0) - (a.qualifiers_missing?.length || 0))[0];
  const qualifierDiff = bestCited?.qualifiers_missing?.length ? bestCited.qualifiers_missing : null;

  // mode_2: cited score is 1, OR cited score is 2 with non-empty qualifier diff
  if (bestCitedScore === 1 || (bestCitedScore === 2 && qualifierDiff)) {
    return { mode: "mode_2_overgen", qualifier_diff: qualifierDiff, alternate_supporting_sources: [] };
  }

  // correct: best cited = 2 AND no qualifier diff
  if (bestCitedScore === 2) {
    const alts = uncitedScores
      .filter((s) => s.direction === "supports" && s.support_score === 2)
      .map((s) => s.source_index);
    return { mode: "correct", qualifier_diff: null, alternate_supporting_sources: alts };
  }

  return { mode: "mode_3_fabrication", qualifier_diff: null, alternate_supporting_sources: [] };
}
