const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5";
const DEFAULT_DB_TABLE =
  process.env.EMERSUS_EVIDENCE_TABLE || "knowledge_documents";
const DEFAULT_DB_RPC = process.env.EMERSUS_EVIDENCE_RPC || "match_knowledge_documents";
const DEFAULT_DB_LIMIT = Number(process.env.EMERSUS_EVIDENCE_LIMIT || 6);
const DEFAULT_WEB_CONTEXT =
  process.env.OPENAI_EMERSUS_WEB_CONTEXT || "medium";
const MAX_QUESTION_LENGTH = 3000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(value, maxItems = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 240))
    .filter(Boolean)
    .slice(0, maxItems);
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

function buildPlan(question, profile, hasDatabase) {
  const topic = inferTopic(question);
  const lowerQuestion = question.toLowerCase();
  const needsRecency =
    /latest|recent|new|today|this year|study|studies|evidence|research|update/.test(
      lowerQuestion
    ) || topic !== "strength";
  const riskLevel =
    /injur|pain|depress|anx|panic|eating disorder|blood pressure|diabetes|medication|pregnan/.test(
      lowerQuestion
    ) || normalizeText(profile.injuries_limitations, 600)
      ? "medium"
      : "low";

  return {
    topic,
    hasDatabase,
    needsDatabase: hasDatabase,
    needsWeb: needsRecency || !hasDatabase,
    needsRecency,
    riskLevel,
    dbQuery: [
      question,
      normalizeText(profile.goal, 200),
      normalizeText(profile.experience_level, 120),
      normalizeText(profile.dietary_preferences, 200),
      normalizeText(profile.injuries_limitations, 200),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 700),
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

function buildSearchTerms(question, plan, profile) {
  const text = [
    question,
    plan.topic,
    profile.goal,
    profile.experience_level,
    profile.dietary_preferences,
    profile.injuries_limitations,
  ]
    .join(" ")
    .toLowerCase();

  const terms = Array.from(
    new Set(
      text
        .split(/[^a-z0-9+]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
    )
  );

  return terms.slice(0, 12);
}

function normalizeDatabaseRow(row) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};

  return {
    id: row.id || row.document_id || null,
    title: normalizeText(
      row.title || metadata.title || row.name || row.document_title,
      240
    ),
    url: normalizeText(row.url || metadata.url || row.source_url, 500),
    source_type: normalizeText(
      row.source_type || metadata.source_type || row.publisher || "database",
      80
    ),
    topic: normalizeText(row.topic || metadata.topic, 80),
    published_at: normalizeText(
      row.published_at || metadata.published_at || row.publication_date,
      80
    ),
    evidence_level: normalizeText(
      row.evidence_level || metadata.evidence_level || "",
      120
    ),
    summary: normalizeText(
      row.summary || row.snippet || row.abstract || metadata.summary,
      600
    ),
    database_score: Number(row.database_score || row.similarity || row.score || 0) || 0,
  };
}

function encodeOrFilter(searchTerms, columns) {
  if (!searchTerms.length || !columns.length) {
    return "";
  }

  const fragments = [];

  for (const term of searchTerms.slice(0, 4)) {
    for (const column of columns) {
      fragments.push(`${column}.ilike.*${term.replace(/\*/g, "")}*`);
    }
  }

  return fragments.join(",");
}

async function retrieveViaRpc({ supabaseUrl, serviceRoleKey, plan, profile }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${DEFAULT_DB_RPC}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_text: plan.dbQuery,
      match_count: DEFAULT_DB_LIMIT,
      requested_topic: plan.topic,
      user_goal: profile.goal || null,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "RPC retrieval failed.");
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows.map(normalizeDatabaseRow) : [];
}

async function retrieveViaTable({ supabaseUrl, serviceRoleKey, plan, profile }) {
  const searchTerms = buildSearchTerms(plan.dbQuery, plan, profile);
  const columns = ["title", "summary", "topic", "evidence_level"];
  const params = new URLSearchParams({
    select:
      "id,title,url,source_type,topic,published_at,evidence_level,summary,metadata",
    limit: String(DEFAULT_DB_LIMIT),
    order: "published_at.desc.nullslast",
  });

  if (plan.topic) {
    params.set("topic", `eq.${plan.topic}`);
  }

  const orFilter = encodeOrFilter(searchTerms, columns);
  if (orFilter) {
    params.set("or", `(${orFilter})`);
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/${DEFAULT_DB_TABLE}?${params.toString()}`,
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
    throw new Error(errorText || "Table retrieval failed.");
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows.map(normalizeDatabaseRow) : [];
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

  if (/expert|news|blog/.test(text)) {
    return 0.58;
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

async function retrieveDatabaseEvidence(plan, profile) {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!plan.needsDatabase || !supabaseUrl || !serviceRoleKey) {
    return {
      available: false,
      method: null,
      evidence: [],
      error: null,
    };
  }

  try {
    const rpcEvidence = await retrieveViaRpc({
      supabaseUrl,
      serviceRoleKey,
      plan,
      profile,
    });

    return {
      available: true,
      method: "rpc",
      evidence: rankDatabaseEvidence(rpcEvidence).slice(0, DEFAULT_DB_LIMIT),
      error: null,
    };
  } catch (rpcError) {
    try {
      const tableEvidence = await retrieveViaTable({
        supabaseUrl,
        serviceRoleKey,
        plan,
        profile,
      });

      return {
        available: true,
        method: "table",
        evidence: rankDatabaseEvidence(tableEvidence).slice(0, DEFAULT_DB_LIMIT),
        error: rpcError.message || "RPC retrieval failed.",
      };
    } catch (tableError) {
      console.error("Database retrieval failed:", rpcError, tableError);
      return {
        available: false,
        method: null,
        evidence: [],
        error: tableError.message || rpcError.message || "Database retrieval failed.",
      };
    }
  }
}

function buildOpenAIInput({ question, plan, profile, databaseEvidence, today }) {
  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are Emersus AI, a performance optimizer focused on strength training, cardio, nutrition, and mental performance. Provide evidence-aware recommendations without overstating certainty. Prioritize provided database evidence when it is relevant and usable. Use web search when the request needs fresher evidence, the database is sparse, or a claim needs external verification. Always prefer more recent and higher-quality sources. If the user asks for medical care, diagnosis, or crisis support, keep the advice cautious and recommend an appropriate professional when needed. Return JSON only.",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(
            {
              today,
              request: {
                question,
                topic: plan.topic,
                risk_level: plan.riskLevel,
                needs_recent_sources: plan.needsRecency,
              },
              user_profile: profile,
              database_evidence: databaseEvidence,
              output_requirements: {
                include_sections: [
                  "summary",
                  "recommendations",
                  "confidence",
                  "sources",
                  "limitations",
                ],
                recommendation_shape: {
                  training: "array of specific actions",
                  nutrition: "array of specific actions",
                  mental_performance: "array of specific actions",
                },
                confidence_shape: {
                  score: "0.0 to 1.0",
                  label: "low | moderate | high",
                  rationale: "short explanation",
                },
                source_rules: [
                  "Each source must include title, url, source_type, published_at, and why_it_matters.",
                  "Use source_type values of database or web.",
                  "Cite the most recent and relevant sources first.",
                ],
              },
            },
            null,
            2
          ),
        },
      ],
    },
  ];
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("The model response was not valid JSON.");
    }

    return JSON.parse(match[0]);
  }
}

function normalizeRecommendationPayload(payload) {
  const recommendations = payload?.recommendations || {};
  const confidence = payload?.confidence || {};
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];

  return {
    summary: normalizeText(payload?.summary, 1600),
    recommendations: {
      training: normalizeList(recommendations.training, 8),
      nutrition: normalizeList(recommendations.nutrition, 8),
      mental_performance: normalizeList(recommendations.mental_performance, 8),
    },
    confidence: {
      score: clamp(Number(confidence.score || 0), 0, 1),
      label: normalizeText(confidence.label, 32) || "moderate",
      rationale: normalizeText(confidence.rationale, 280),
    },
    sources: sources
      .map((source) => ({
        title: normalizeText(source?.title, 240),
        url: normalizeText(source?.url, 500),
        source_type: normalizeText(source?.source_type, 32) || "web",
        published_at: normalizeText(source?.published_at, 80),
        why_it_matters: normalizeText(source?.why_it_matters, 240),
      }))
      .filter((source) => source.title || source.url),
    limitations: normalizeList(payload?.limitations, 6),
  };
}

function computeConfidence({ plan, databaseEvidence, sources, modelConfidence }) {
  const totalSources = sources.length;
  const recentSourceCount = sources.filter(
    (source) => scoreEvidenceFreshness(source.published_at) >= 0.82
  ).length;
  const highQualitySourceCount = sources.filter(
    (source) =>
      scoreEvidenceQuality(source.evidence_level, source.source_type) >= 0.84
  ).length;
  const dbSupport = Math.min(databaseEvidence.length / 4, 1);
  const recencySupport = totalSources ? recentSourceCount / totalSources : 0;
  const qualitySupport = totalSources ? highQualitySourceCount / totalSources : 0.55;
  const riskPenalty = plan.riskLevel === "medium" ? 0.08 : 0;

  const computedScore = clamp(
    dbSupport * 0.2 + recencySupport * 0.35 + qualitySupport * 0.35 + 0.18 - riskPenalty,
    0.15,
    0.96
  );
  const finalScore = modelConfidence
    ? clamp(modelConfidence * 0.6 + computedScore * 0.4, 0.1, 0.97)
    : computedScore;

  return {
    score: Number(finalScore.toFixed(2)),
    label:
      finalScore >= 0.75 ? "high" : finalScore >= 0.5 ? "moderate" : "low",
    rationale:
      finalScore >= 0.75
        ? "Multiple relevant sources align, with good recency and support."
        : finalScore >= 0.5
          ? "The recommendation has useful support, but evidence quality, recency, or personalization is mixed."
          : "Support is limited, older, or only partially matched to the request.",
  };
}

async function callOpenAI({ question, plan, profile, databaseEvidence, today }) {
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
      tool_choice: "auto",
      tools: [
        {
          type: "web_search",
          search_context_size: DEFAULT_WEB_CONTEXT,
          user_location: {
            type: "approximate",
            country: "US",
          },
        },
      ],
      input: buildOpenAIInput({
        question,
        plan,
        profile,
        databaseEvidence,
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
  const plan = buildPlan(question, mergedProfile, Boolean(supabaseUrl && serviceRoleKey));
  const database = await retrieveDatabaseEvidence(plan, mergedProfile);
  const today = new Date().toISOString().slice(0, 10);
  const openAIResponse = await callOpenAI({
    question,
    plan,
    profile: mergedProfile,
    databaseEvidence: database.evidence,
    today,
  });
  const modelPayload = normalizeRecommendationPayload(
    extractJsonObject(openAIResponse.output_text)
  );
  const combinedSources = rankDatabaseEvidence(
    [...database.evidence, ...modelPayload.sources].map((source) => ({
      ...source,
      database_score: source.database_score || 0,
    }))
  ).slice(0, 8);
  const confidence = computeConfidence({
    plan,
    databaseEvidence: database.evidence,
    sources: combinedSources,
    modelConfidence: modelPayload.confidence.score,
  });

  return {
    user: {
      id: stableUserId || null,
      profile_used: mergedProfile,
    },
    plan,
    summary: modelPayload.summary,
    recommendations: modelPayload.recommendations,
    confidence,
    limitations: modelPayload.limitations,
    sources: combinedSources.map((source) => ({
      title: source.title,
      url: source.url,
      source_type: source.source_type || "database",
      published_at: source.published_at,
      evidence_level: source.evidence_level || "",
      why_it_matters:
        source.why_it_matters ||
        (source.source_type === "database"
          ? "Retrieved from the Emersus knowledge database."
          : "Referenced in the model-generated recommendation."),
      freshness_score:
        source.freshness_score ?? scoreEvidenceFreshness(source.published_at),
      quality_score:
        source.quality_score ??
        scoreEvidenceQuality(source.evidence_level, source.source_type),
    })),
    debug: includeDebug
      ? {
          database,
          openai_response_id: openAIResponse.id || null,
          raw_output_text: openAIResponse.output_text || "",
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

module.exports = {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
};
