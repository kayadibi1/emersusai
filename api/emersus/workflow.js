import { retrieveDatabaseEvidence as retrieveVectorDatabaseEvidence } from "./retrieveDatabaseEvidence.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const MAX_QUESTION_LENGTH = 3000;
const VECTOR_LIMIT = 6;
const VECTOR_MATCH_THRESHOLD = 0.4;
const VECTOR_MATCH_COUNT = 10;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(value, maxItems = 8, maxLength = 240) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
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

function parseJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_error) {
      const error = new Error("Request body must be valid JSON.");
      error.statusCode = 400;
      throw error;
    }
  }

  return req.body;
}

function parseUserId(rawUserId) {
  const userId = normalizeText(rawUserId, 160);

  if (!userId) {
    return { stableUserId: "", supabaseUserId: "" };
  }

  if (userId.startsWith("supabase:")) {
    return {
      stableUserId: userId,
      supabaseUserId: userId.slice("supabase:".length),
    };
  }

  return {
    stableUserId: userId,
    supabaseUserId: "",
  };
}

function inferTopic(question) {
  const text = question.toLowerCase();

  if (/run|cardio|zone 2|vo2|max|cycling|endurance|interval/.test(text)) {
    return "cardio";
  }

  if (/protein|calorie|diet|nutrition|supplement|macro|meal|cut|bulk/.test(text)) {
    return "nutrition";
  }

  if (/focus|sleep|stress|mental|cognitive|motivation|discipline/.test(text)) {
    return "mental_performance";
  }

  return "strength";
}

function buildPlan(question, profile) {
  const topic = inferTopic(question);
  const lowerQuestion = question.toLowerCase();
  const riskLevel =
    /injur|pain|depress|anx|panic|eating disorder|blood pressure|diabetes|medication|pregnan/.test(
      lowerQuestion
    ) || normalizeText(profile.injuries_limitations, 600)
      ? "medium"
      : "low";

  return {
    topic,
    riskLevel,
  };
}

async function fetchSupabaseProfile(supabaseUrl, serviceRoleKey, supabaseUserId) {
  if (!supabaseUrl || !serviceRoleKey || !supabaseUserId) {
    return null;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=goal,experience_level,dietary_preferences,injuries_limitations,full_name,email&id=eq.${encodeURIComponent(
      supabaseUserId
    )}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Supabase profile fetch failed:", errorText);
    return null;
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function mergeProfile(profile, storedProfile) {
  return {
    goal: normalizeText(profile?.goal || storedProfile?.goal, 300),
    experience_level: normalizeText(
      profile?.experience_level || storedProfile?.experience_level,
      120
    ),
    dietary_preferences: normalizeText(
      profile?.dietary_preferences || storedProfile?.dietary_preferences,
      300
    ),
    injuries_limitations: normalizeText(
      profile?.injuries_limitations || storedProfile?.injuries_limitations,
      300
    ),
    equipment_access: normalizeText(profile?.equipment_access, 200),
    available_days_per_week: normalizeText(profile?.available_days_per_week, 80),
    available_minutes_per_session: normalizeText(
      profile?.available_minutes_per_session,
      80
    ),
    sleep_stress_context: normalizeText(profile?.sleep_stress_context, 200),
    medical_disclaimer_acknowledged:
      profile?.medical_disclaimer_acknowledged === true,
  };
}

function normalizeVectorEvidenceRow(row) {
  const publicationTypes = parsePublicationTypes(row.publication_types);
  const publicationYear = normalizeText(row.publication_year, 8);
  const publicationDate = normalizeText(row.publication_date, 40);
  const pmid = normalizeText(row.pmid, 32);
  const doi = normalizeText(row.doi, 160);

  return {
    source_id: pmid ? `pmid:${pmid}` : null,
    pmid,
    doi,
    pmcid: normalizeText(row.pmcid, 40),
    title: normalizeText(row.title, 240),
    journal: normalizeText(row.journal, 160),
    publication_year: publicationYear,
    publication_date: publicationDate,
    publication_types: publicationTypes,
    publication_type: publicationTypes.join(", "),
    chunk_type: normalizeText(row.chunk_type, 40),
    chunk_text: normalizeText(row.chunk_text, 1200),
    excerpt: normalizeText(row.chunk_text, 420),
    summary: normalizeText(row.chunk_text, 600),
    similarity: clamp(Number(row.similarity || 0), 0, 1),
    database_score: clamp(Number(row.similarity || 0), 0, 1),
    source_type: "pubmed_vector",
    evidence_level: publicationTypes.join(", "),
    published_at: publicationDate || publicationYear,
    url: doi
      ? `https://doi.org/${doi}`
      : pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : "",
    why_it_matters: normalizeText(
      row.chunk_text || `Matched a PubMed evidence chunk with similarity ${Number(row.similarity || 0).toFixed(2)}.`,
      240
    ),
    mesh_terms: Array.isArray(row.mesh_terms) ? row.mesh_terms.slice(0, 8) : [],
  };
}

function scoreEvidenceFreshness(publishedAt) {
  if (!publishedAt) {
    return 0.45;
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return 0.45;
  }

  const daysOld = (Date.now() - publishedTime) / (1000 * 60 * 60 * 24);

  if (daysOld <= 180) {
    return 1;
  }

  if (daysOld <= 365 * 2) {
    return 0.82;
  }

  if (daysOld <= 365 * 5) {
    return 0.66;
  }

  return 0.5;
}

function scoreEvidenceQuality(evidenceLevel, sourceType) {
  const text = `${evidenceLevel} ${sourceType}`.toLowerCase();

  if (/meta|systematic|guideline|consensus|review/.test(text)) {
    return 1;
  }

  if (/trial|rct|peer|journal|database/.test(text)) {
    return 0.84;
  }

  return 0.68;
}

function rankDatabaseEvidence(evidence) {
  return [...evidence]
    .map((item) => {
      const freshnessScore = scoreEvidenceFreshness(item.published_at);
      const qualityScore = scoreEvidenceQuality(
        item.evidence_level,
        item.source_type
      );
      const databaseScore = clamp(Number(item.database_score || 0), 0, 1);
      const weightedScore =
        freshnessScore * 0.35 + qualityScore * 0.35 + databaseScore * 0.3;

      return {
        ...item,
        freshness_score: Number(freshnessScore.toFixed(2)),
        quality_score: Number(qualityScore.toFixed(2)),
        ranking_score: Number(weightedScore.toFixed(2)),
      };
    })
    .sort((left, right) => right.ranking_score - left.ranking_score);
}

function dedupeEvidence(evidence) {
  const byId = new Map();

  for (const item of evidence) {
    const key =
      item.source_id ||
      item.pmid ||
      item.doi ||
      item.url ||
      `${item.title}:${item.excerpt}`;

    const existing = byId.get(key);

    if (!existing || Number(item.ranking_score || 0) > Number(existing.ranking_score || 0)) {
      byId.set(key, item);
    }
  }

  return [...byId.values()];
}

async function retrieveVectorEvidence(question) {
  try {
    const matches = await retrieveVectorDatabaseEvidence({
      prompt: question,
      limit: VECTOR_LIMIT,
      matchThreshold: VECTOR_MATCH_THRESHOLD,
      matchCount: VECTOR_MATCH_COUNT,
    });

    return {
      available: matches.length > 0,
      method: "vector",
      evidence: rankDatabaseEvidence(
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

function formatEvidenceForModel(evidence) {
  if (!evidence.length) {
    return "No database evidence retrieved.";
  }

  return evidence
    .slice(0, 5)
    .map((item, index) =>
      [
        `[${index + 1}] ${item.title || "Untitled evidence"}`,
        item.pmid ? `PMID: ${item.pmid}` : null,
        item.journal ? `Journal: ${item.journal}` : null,
        item.publication_year
          ? `Year: ${item.publication_year}`
          : item.published_at
            ? `Year: ${item.published_at}`
            : null,
        item.publication_type || item.evidence_level
          ? `Publication type: ${item.publication_type || item.evidence_level}`
          : null,
        item.excerpt ? `Excerpt: ${item.excerpt}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function buildSynthesisInput({ question, profile, plan, evidenceForModel, today }) {
  return [
    {
      role: "system",
      content:
        [
          "You are Emersus AI, a science-aware performance assistant for strength training, cardio, nutrition, and mental performance.",
          "Use the provided evidence first. Keep claims tethered to the evidence. Be practical, specific, and concise.",
          "Do not invent sources. Do not return JSON.",
          "Return plain text in exactly this format:",
          "SUMMARY: <one paragraph>",
          "TRAINING:",
          "- <bullet>",
          "NUTRITION:",
          "- <bullet>",
          "MENTAL PERFORMANCE:",
          "- <bullet>",
          "LIMITATIONS:",
          "- <bullet>",
        ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          today,
          question,
          topic: plan.topic,
          risk_level: plan.riskLevel,
          user_profile: profile,
          retrieved_evidence: evidenceForModel,
          instructions: [
            "Answer the user's question directly.",
            "Use the retrieved evidence as the main basis for the answer.",
            "Make the recommendations specific and useful.",
            "If the evidence is limited or mixed, say so in limitations.",
            "Do not include citations inline; the server will attach sources.",
          ],
        },
        null,
        2
      ),
    },
  ];
}

function extractStructuredOutput(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.output_parsed && typeof payload.output_parsed === "object") {
    return payload.output_parsed;
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.parsed && typeof item.parsed === "object") {
        return item.parsed;
      }

      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content?.parsed && typeof content.parsed === "object") {
            return content.parsed;
          }

          if (content?.json && typeof content.json === "object") {
            return content.json;
          }
        }
      }
    }
  }

  return null;
}

function extractTextFromResponse(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (typeof item.text === "string" && item.text.trim()) {
        return item.text;
      }

      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string" && content.text.trim()) {
            return content.text;
          }
        }
      }
    }
  }

  return "";
}

async function callOpenAISynthesis({
  question,
  profile,
  plan,
  evidenceForModel,
  today,
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_output_tokens: 1100,
      input: buildSynthesisInput({
        question,
        profile,
        plan,
        evidenceForModel,
        today,
      }),
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error?.message || "The OpenAI recommendation request failed."
    );
  }

  return payload;
}

function extractSectionBlock(text, label, nextLabels) {
  const normalized = String(text || "");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedNext = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?:^|\\n)(?:#+\\s*)?${escapedLabel}:?\\s*([\\s\\S]*?)(?=\\n(?:#+\\s*)?(?:${escapedNext.join("|")}):?|$)`,
    "i"
  );
  const match = normalized.match(pattern);
  return match ? match[1].trim() : "";
}

function parseBulletSection(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function sentenceSplit(text, maxItems = 4) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSynthesisPayload(text) {
  const summary = extractSectionBlock(text, "SUMMARY", [
    "TRAINING",
    "NUTRITION",
    "MENTAL PERFORMANCE",
    "LIMITATIONS",
  ]);
  const training = parseBulletSection(
    extractSectionBlock(text, "TRAINING", [
      "NUTRITION",
      "MENTAL PERFORMANCE",
      "LIMITATIONS",
    ])
  );
  const nutrition = parseBulletSection(
    extractSectionBlock(text, "NUTRITION", [
      "MENTAL PERFORMANCE",
      "LIMITATIONS",
    ])
  );
  const mentalPerformance = parseBulletSection(
    extractSectionBlock(text, "MENTAL PERFORMANCE", ["LIMITATIONS"])
  );
  const limitations = parseBulletSection(
    extractSectionBlock(text, "LIMITATIONS", [])
  );

  const normalizedText = normalizeText(text, 2400);
  const fallbackSummary = summary || normalizedText;
  const fallbackBullets = sentenceSplit(normalizedText, 3);

  if (!fallbackSummary) {
    throw new Error("The model response was empty.");
  }

  return {
    summary: normalizeText(fallbackSummary, 1600),
    recommendations: {
      training: normalizeList(
        training.length ? training : fallbackBullets.slice(0, 1),
        8
      ),
      nutrition: normalizeList(
        nutrition.length ? nutrition : fallbackBullets.slice(1, 2),
        8
      ),
      mental_performance: normalizeList(
        mentalPerformance.length
          ? mentalPerformance
          : fallbackBullets.slice(2, 3),
        8
      ),
    },
    limitations: normalizeList(limitations, 6),
  };
}

function computeConfidence({ plan, evidence }) {
  const sources = evidence.slice(0, 5);
  const totalSources = sources.length;
  const recentSourceCount = sources.filter(
    (source) => scoreEvidenceFreshness(source.published_at) >= 0.82
  ).length;
  const highQualitySourceCount = sources.filter(
    (source) =>
      scoreEvidenceQuality(source.evidence_level, source.source_type) >= 0.84
  ).length;
  const recencySupport = totalSources ? recentSourceCount / totalSources : 0;
  const qualitySupport = totalSources ? highQualitySourceCount / totalSources : 0;
  const coverageSupport = Math.min(totalSources / 4, 1);
  const riskPenalty = plan.riskLevel === "medium" ? 0.08 : 0;

  const score = clamp(
    0.2 + recencySupport * 0.35 + qualitySupport * 0.3 + coverageSupport * 0.2 - riskPenalty,
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

function buildFallbackRecommendation({ question, evidence }) {
  const topEvidence = evidence.slice(0, 2);
  const titles = topEvidence.map((item) => item.title).filter(Boolean);

  return {
    summary: titles.length
      ? `I couldn't complete the normal synthesis step, but the strongest retrieved evidence included ${titles.join(" and ")}.`
      : "I couldn't complete the normal synthesis step, so this answer is based only on the retrieved evidence.",
    recommendations: {
      training: topEvidence[0]?.title
        ? [`Use the evidence around "${topEvidence[0].title}" as the main anchor for your next decision.`]
        : ["Ask a more specific follow-up so I can give a tighter evidence-backed answer."],
      nutrition: [
        "Use the retrieved studies as your main reference and treat this fallback as a lighter summary.",
      ],
      mental_performance: [
        "Mental-performance guidance is limited unless the retrieved evidence directly addressed that topic.",
      ],
    },
    limitations: [
      "This fallback is less polished than the normal model-generated answer.",
    ],
  };
}

function normalizeSources(evidence) {
  return evidence.slice(0, 6).map((source) => ({
    title: source.title,
    url: source.url || "",
    source_type: source.source_type || "pubmed_vector",
    published_at: source.published_at || "",
    evidence_level: source.evidence_level || "",
    why_it_matters:
      source.why_it_matters || source.summary || "Retrieved from the Emersus PubMed evidence index.",
    journal: source.journal || "",
    year: source.publication_year || source.year || source.published_at || "",
    doi: source.doi || "",
    pmid: source.pmid || "",
    excerpt: source.excerpt || source.chunk_text || source.summary || "",
    publication_type:
      source.publication_type ||
      (Array.isArray(source.publication_types)
        ? source.publication_types.join(", ")
        : source.evidence_level || ""),
    freshness_score:
      source.freshness_score ?? scoreEvidenceFreshness(source.published_at),
    quality_score:
      source.quality_score ??
      scoreEvidenceQuality(
        source.publication_type || source.evidence_level,
        source.source_type
      ),
  }));
}

async function generateRecommendation({ question, profile, userId, includeDebug }) {
  const { stableUserId, supabaseUserId } = parseUserId(userId);
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const storedProfile = await fetchSupabaseProfile(
    supabaseUrl,
    serviceRoleKey,
    supabaseUserId
  );
  const mergedProfile = mergeProfile(profile, storedProfile || {});
  const plan = buildPlan(question, mergedProfile);
  const vectorDatabase = await retrieveVectorEvidence(question);
  const databaseEvidence = vectorDatabase.evidence.slice(0, VECTOR_LIMIT);
  const evidenceForModel = formatEvidenceForModel(databaseEvidence);
  const today = new Date().toISOString().slice(0, 10);
  let openAIResponse = null;
  let synthesis = null;

  try {
    openAIResponse = await callOpenAISynthesis({
      question,
      profile: mergedProfile,
      plan,
      evidenceForModel,
      today,
    });

    const structuredOutput = extractStructuredOutput(openAIResponse);
    if (structuredOutput) {
      synthesis = normalizeSynthesisPayload(JSON.stringify(structuredOutput));
    } else {
      const extractedText = extractTextFromResponse(openAIResponse);
      if (extractedText) {
        synthesis = normalizeSynthesisPayload(extractedText);
      }
    }
  } catch (error) {
    console.error("OpenAI recommendation generation failed:", error);
  }

  if (!synthesis) {
    synthesis = buildFallbackRecommendation({
      question,
      evidence: databaseEvidence,
    });
  }

  const sources = normalizeSources(databaseEvidence);
  const confidence = computeConfidence({
    plan,
    evidence: databaseEvidence,
  });

  return {
    user: {
      id: stableUserId || null,
      profile_used: mergedProfile,
    },
    plan,
    summary: synthesis.summary,
    recommendations: synthesis.recommendations,
    confidence,
    limitations: synthesis.limitations,
    sources,
    debug: includeDebug
      ? {
          vector_database: vectorDatabase,
          evidence_for_model: evidenceForModel,
          openai_response_id: openAIResponse?.id || null,
          raw_output_text: extractTextFromResponse(openAIResponse) || "",
        }
      : undefined,
  };
}

function validateRequest(body) {
  const question = normalizeText(body?.question, MAX_QUESTION_LENGTH);

  if (!question) {
    const error = new Error("A non-empty question is required.");
    error.statusCode = 400;
    throw error;
  }

  return {
    question,
    userId: normalizeText(body?.userId, 160),
    profile: {
      goal: body?.profile?.goal,
      experience_level: body?.profile?.experience_level,
      dietary_preferences: body?.profile?.dietary_preferences,
      injuries_limitations: body?.profile?.injuries_limitations,
      equipment_access: body?.profile?.equipment_access,
      available_days_per_week: body?.profile?.available_days_per_week,
      available_minutes_per_session: body?.profile?.available_minutes_per_session,
      sleep_stress_context: body?.profile?.sleep_stress_context,
      medical_disclaimer_acknowledged:
        body?.profile?.medical_disclaimer_acknowledged === true,
    },
    includeDebug: body?.includeDebug === true,
  };
}

export {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
};
