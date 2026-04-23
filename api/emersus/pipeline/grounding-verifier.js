const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

const GENERIC_SENTENCE_RE = /^(yes|no|maybe|it depends|probably|possibly|generally|overall)[\s,.;:!-]*$/i;

const INFERENCE_LABEL_RE =
  /\b(as a coaching inference|coaching inference|my inference|not from the retrieved evidence|retrieved evidence does not establish|retrieved evidence doesn.?t establish|retrieved evidence does not (?:provide|support)|i(?:'| a)m inferring)\b/i;

const UNCERTAINTY_RE =
  /\b(retrieved evidence|retrieved passages|database evidence|not enough evidence|insufficient evidence|cannot determine|can't determine|unclear|limited|source-specific|as a coaching inference|coaching inference)\b/i;

const FACT_SIGNAL_RE =
  /\b(\d+(?:\.\d+)?\s?(?:g|mg|kg|lb|lbs|%|minutes?|hours?|days?|weeks?|sets?|reps?|rpe|rm|kcal|calories?)|increase|decrease|improve|reduce|raise|lower|cause|causes|associated|effective|ineffective|benefit|risk|dose|dosage|hypertrophy|strength|endurance|protein|creatine|caffeine|sleep|training|volume|intensity)\b/i;

const CITATION_MARKER_RE = /\[(\d{1,2})\]/g;

const STOPWORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between",
  "could", "does", "doesn", "during", "each", "from", "have", "into",
  "more", "most", "only", "over", "retrieved", "should", "some", "than",
  "that", "their", "there", "these", "this", "those", "through", "under",
  "using", "very", "were", "when", "where", "which", "while", "with",
  "without", "would", "your",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.%/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function uniqueTokens(value) {
  return Array.from(new Set(tokenize(value)));
}

function evidenceText(item) {
  return [
    item?.title,
    item?.excerpt,
    item?.summary,
    item?.chunk_text,
    item?.journal,
    item?.publication_type,
    item?.evidence_level,
  ].filter(Boolean).join(" ");
}

function splitSentences(answerText) {
  return String(answerText || "")
    .replace(/\s+/g, " ")
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isFactualClaim(sentence) {
  if (!sentence || GENERIC_SENTENCE_RE.test(sentence)) return false;
  return FACT_SIGNAL_RE.test(sentence);
}

function extractMarkers(sentence) {
  const out = [];
  const re = new RegExp(CITATION_MARKER_RE);
  let match;
  while ((match = re.exec(sentence)) !== null) {
    out.push(Number(match[1]));
  }
  return out;
}

function supportScore(claimTokens, sourceTokens) {
  if (!claimTokens.length || !sourceTokens.length) return 0;
  const sourceSet = new Set(sourceTokens);
  const hits = claimTokens.filter((token) => sourceSet.has(token)).length;
  return hits / claimTokens.length;
}

function findBestSupport(sentence, evidenceItems) {
  const claimTokens = uniqueTokens(sentence);
  let best = {
    sourceIndex: -1,
    score: 0,
    matchedTokens: [],
  };

  evidenceItems.forEach((item, index) => {
    const sourceTokens = uniqueTokens(evidenceText(item));
    const sourceSet = new Set(sourceTokens);
    const score = supportScore(claimTokens, sourceTokens);
    if (score > best.score) {
      best = {
        sourceIndex: index,
        score,
        matchedTokens: claimTokens.filter((token) => sourceSet.has(token)),
      };
    }
  });

  return best;
}

export function verifyAnswerGrounding({
  answerText,
  evidenceItems = [],
  minSupportScore = 0.35,
  mode = "legacy",
} = {}) {
  if (mode === "citation") {
    return verifyCitationGrounding({ answerText, evidenceItems });
  }
  return verifyLegacyGrounding({ answerText, evidenceItems, minSupportScore });
}

function verifyCitationGrounding({ answerText, evidenceItems }) {
  const sentences = splitSentences(answerText);
  const validIds = new Set(evidenceItems.map((_item, i) => i + 1));

  let factualSentences = 0;
  let citedSentences = 0;
  const uncitedClaims = [];
  const invalidMarkerHits = [];
  const allMarkers = [];
  const labeledInferences = [];

  for (const sentence of sentences) {
    const markers = extractMarkers(sentence);
    markers.forEach((id) => {
      allMarkers.push(id);
      if (!validIds.has(id)) {
        invalidMarkerHits.push({ sentence, marker: id });
      }
    });

    if (isFactualClaim(sentence)) {
      factualSentences += 1;
      if (markers.length > 0) {
        citedSentences += 1;
      } else if (INFERENCE_LABEL_RE.test(sentence)) {
        labeledInferences.push(sentence);
      } else {
        uncitedClaims.push(sentence);
      }
    }
  }

  const citedFraction =
    factualSentences === 0 ? 1 : citedSentences / factualSentences;

  let status;
  if (factualSentences === 0) {
    status = "no_claims";
  } else if (uncitedClaims.length === 0 && invalidMarkerHits.length === 0) {
    status = "grounded";
  } else if (citedFraction >= 0.5 && invalidMarkerHits.length === 0) {
    status = "partial";
  } else {
    status = "ungrounded";
  }

  return {
    mode: "citation",
    status,
    grounded: status === "grounded",
    factual_sentences: factualSentences,
    cited_sentences: citedSentences,
    cited_fraction: Number(citedFraction.toFixed(3)),
    uncited_claims: uncitedClaims,
    labeled_inferences: labeledInferences,
    invalid_markers: invalidMarkerHits,
    all_markers: allMarkers,
    unique_markers: Array.from(new Set(allMarkers)).sort((a, b) => a - b),
  };
}

function verifyLegacyGrounding({ answerText, evidenceItems, minSupportScore }) {
  const claims = splitSentences(answerText).filter((s) => {
    if (!s || GENERIC_SENTENCE_RE.test(s)) return false;
    if (UNCERTAINTY_RE.test(s)) return false;
    return FACT_SIGNAL_RE.test(s);
  });
  const unsupportedClaims = [];

  for (const claim of claims) {
    const support = findBestSupport(claim, evidenceItems);
    if (support.score < minSupportScore) {
      unsupportedClaims.push({
        claim,
        best_source_index: support.sourceIndex,
        support_score: Number(support.score.toFixed(3)),
        matched_tokens: support.matchedTokens,
      });
    }
  }

  return {
    mode: "legacy",
    grounded: unsupportedClaims.length === 0,
    checked_claims: claims.length,
    unsupported_claims: unsupportedClaims,
  };
}

export const __testables = {
  splitSentences,
  isFactualClaim,
  uniqueTokens,
  findBestSupport,
  extractMarkers,
  verifyCitationGrounding,
  verifyLegacyGrounding,
};
