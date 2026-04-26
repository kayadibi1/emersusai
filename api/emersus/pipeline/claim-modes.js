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

export const EXTRACTION_PROMPT_VERSION = "claim-extraction-v1";

const EXTRACTION_SYSTEM_PROMPT = [
  "You extract atomic factual scientific claims from an exercise/nutrition coach's answer.",
  "",
  "A factual claim is a statement that asserts an empirical relationship, number, or finding (e.g., 'creatine improves 1RM by ~5%', 'beta-alanine reduces fatigue at doses ≥3.2 g/day').",
  "NOT factual claims (do NOT extract): procedural instructions ('do 3 sets of 8'), motivational text ('train hard'), conversational framing ('great question'), hedges with no content ('it depends'), section headers.",
  "",
  "Multi-claim sentences must be SPLIT into atomic claims. 'Creatine improves 1RM and reduces fatigue [3,7]' becomes TWO claims, each carrying [3,7].",
  "Strip the citation markers from claim_text. The cited_ids array carries the integers from [N] markers attached to the source sentence.",
  "",
  "Output JSON only: {\"claims\": [{\"claim_text\": \"<the claim, no markers>\", \"cited_ids\": [int]}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

export function parseExtractionResponse(raw) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { claims: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.claims)) {
    return { claims: [], error: "malformed_json" };
  }
  const claims = parsed.claims
    .map((c) => ({
      claim_text: String(c.claim_text || "").trim(),
      cited_ids: Array.isArray(c.cited_ids) ? c.cited_ids.filter((n) => Number.isInteger(n)) : [],
    }))
    .filter((c) => c.claim_text);
  return { claims, error: null };
}

async function callJudge({ system, user, model, maxOutputTokens }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      max_output_tokens: maxOutputTokens,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI failed (${res.status}): ${JSON.stringify(json)}`);
  return json?.output_text || (json?.output || [])
    .flatMap((o) => (o.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
    .join("\n");
}

export async function extractAtomicClaims(answerText, { model = "gpt-5.4" } = {}) {
  const userPrompt = `ANSWER TEXT:\n${answerText}\n\nReturn the JSON object as specified.`;
  let raw;
  let attempts = 0;
  let lastErr = null;
  while (attempts < 2) {
    try {
      raw = await callJudge({ system: EXTRACTION_SYSTEM_PROMPT, user: userPrompt, model, maxOutputTokens: 1000 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      attempts += 1;
    }
  }
  if (lastErr) {
    return { claims: [], error: "judge_error", error_message: lastErr.message, prompt_version: EXTRACTION_PROMPT_VERSION };
  }
  const parsed = parseExtractionResponse(raw);
  return { ...parsed, prompt_version: EXTRACTION_PROMPT_VERSION };
}

export const CLASSIFY_PROMPT_VERSION = "claim-classify-v1";

const CLASSIFY_SYSTEM_PROMPT = [
  "You evaluate whether each retrieved source supports, contradicts, or is unrelated to a specific factual claim.",
  "",
  "For EACH source you receive, return:",
  "  - direction: 'supports' | 'contradicts' | 'unrelated'",
  "  - support_score: 0, 1, or 2 (only meaningful when direction='supports')",
  "      0 = no support",
  "      1 = partial/qualified — source supports the gist but with narrower scope or weaker effect",
  "      2 = full direct support — source establishes the claim with the same scope and effect",
  "  - scope_qualifiers_in_source_missing_from_claim: list of qualifiers (population, dose, duration, study design) that the source restricts the finding to but the claim drops. Empty list when direction != 'supports' or claim already includes all qualifiers.",
  "",
  "If a source actively states the OPPOSITE of the claim (e.g., source: 'no significant 1RM improvement', claim: 'improves 1RM'), use direction='contradicts'.",
  "If a source is on a different topic entirely, use direction='unrelated'.",
  "",
  "Output JSON only: {\"per_source\": [{\"source_index\": N, \"direction\": \"...\", \"support_score\": N, \"scope_qualifiers_in_source_missing_from_claim\": [...]}, ...]}",
  "Do not include any prose outside the JSON object.",
].join("\n");

function formatSourcesForClassifier(sources) {
  return sources.map((it, i) => {
    const text = it.is_title_only_match ? (it.title || "") : `${it.title || ""}\n    ${it.excerpt || "(no excerpt)"}`;
    const header = [it.publication_year, it.publication_type, it.journal].filter(Boolean).join(" · ");
    return `[${i + 1}] ${header}\n    ${text}`;
  }).join("\n\n");
}

export function parseClassificationResponse(raw, expectedSourceCount) {
  const cleaned = String(raw || "").replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { source_scores: [], error: "malformed_json" };
  }
  if (!parsed || !Array.isArray(parsed.per_source)) {
    return { source_scores: [], error: "malformed_json" };
  }
  const byIndex = new Map();
  for (const row of parsed.per_source) {
    const idx = Number(row?.source_index);
    if (!Number.isInteger(idx) || idx < 1 || idx > expectedSourceCount) continue;
    byIndex.set(idx, {
      source_index: idx,
      direction: ["supports", "contradicts", "unrelated"].includes(row.direction) ? row.direction : "unrelated",
      support_score: [0, 1, 2].includes(Number(row.support_score)) ? Number(row.support_score) : 0,
      qualifiers_missing: Array.isArray(row.scope_qualifiers_in_source_missing_from_claim)
        ? row.scope_qualifiers_in_source_missing_from_claim.map(String)
        : [],
    });
  }
  const source_scores = [];
  for (let i = 1; i <= expectedSourceCount; i += 1) {
    source_scores.push(byIndex.get(i) || { source_index: i, direction: "unrelated", support_score: 0, qualifiers_missing: [] });
  }
  return { source_scores, error: null };
}

export async function classifyClaimModes(claims, retrievedSources, { model = "gpt-5.4" } = {}) {
  const sourcesBlock = formatSourcesForClassifier(retrievedSources);
  const out = [];
  for (const claim of claims) {
    const userPrompt = `CLAIM:\n${claim.claim_text}\n\nRETRIEVED SOURCES:\n${sourcesBlock}\n\nReturn the JSON object as specified.`;
    let raw;
    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      try {
        raw = await callJudge({ system: CLASSIFY_SYSTEM_PROMPT, user: userPrompt, model, maxOutputTokens: 1500 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        attempts += 1;
      }
    }
    if (lastErr) {
      out.push({
        claim_text: claim.claim_text,
        cited_source_ids: claim.cited_ids,
        source_scores: [],
        mode: null,
        qualifier_diff: null,
        alternate_supporting_sources: [],
        grading_status: "judge_error",
        prompt_version: CLASSIFY_PROMPT_VERSION,
        error_message: lastErr.message,
      });
      continue;
    }
    const parsed = parseClassificationResponse(raw, retrievedSources.length);
    if (parsed.error === "malformed_json") {
      out.push({
        claim_text: claim.claim_text,
        cited_source_ids: claim.cited_ids,
        source_scores: [],
        mode: null,
        qualifier_diff: null,
        alternate_supporting_sources: [],
        grading_status: "malformed_json",
        prompt_version: CLASSIFY_PROMPT_VERSION,
      });
      continue;
    }
    const bucket = assignBucket({ cited_ids: claim.cited_ids, source_scores: parsed.source_scores });
    out.push({
      claim_text: claim.claim_text,
      cited_source_ids: claim.cited_ids,
      source_scores: parsed.source_scores,
      mode: bucket.mode,
      qualifier_diff: bucket.qualifier_diff,
      alternate_supporting_sources: bucket.alternate_supporting_sources,
      grading_status: "ok",
      prompt_version: CLASSIFY_PROMPT_VERSION,
    });
  }
  return out;
}
