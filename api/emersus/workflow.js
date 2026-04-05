import { retrieveDatabaseEvidence as retrieveVectorDatabaseEvidence } from "./retrieveDatabaseEvidence.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";
const DEFAULT_DB_TABLE =
  process.env.EMERSUS_EVIDENCE_TABLE || "knowledge_documents";
const DEFAULT_DB_RPC = process.env.EMERSUS_EVIDENCE_RPC || "match_knowledge_documents";
const DEFAULT_DB_LIMIT = Number(process.env.EMERSUS_EVIDENCE_LIMIT || 6);
const DEFAULT_WEB_CONTEXT =
  process.env.OPENAI_EMERSUS_WEB_CONTEXT || "medium";
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

function normalizeList(value, maxItems = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 240))
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
    source_id: row.id || row.document_id || null,
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
    excerpt: normalizeText(
      row.summary || row.snippet || row.abstract || metadata.summary,
      420
    ),
    database_score: Number(row.database_score || row.similarity || row.score || 0) || 0,
    why_it_matters: normalizeText(
      row.summary || metadata.summary || "Relevant database evidence for this answer.",
      240
    ),
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
    chunk_text: normalizeText(row.chunk_text, 900),
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

function formatEvidenceForModel(evidence) {
  if (!evidence.length) {
    return "No database evidence retrieved.";
  }

  return evidence
    .slice(0, 6)
    .map((item, index) => {
      const publicationTypes = parsePublicationTypes(item.publication_types);
      return [
        `[${index + 1}] ${item.title || "Untitled evidence"}`,
        item.pmid ? `PMID: ${item.pmid}` : null,
        item.journal ? `Journal: ${item.journal}` : null,
        item.publication_year
          ? `Year: ${item.publication_year}`
          : item.published_at
            ? `Year: ${item.published_at}`
            : null,
        publicationTypes.length
          ? `Publication types: ${publicationTypes.join(", ")}`
          : item.publication_type || item.evidence_level
            ? `Publication types: ${item.publication_type || item.evidence_level}`
            : null,
        item.similarity != null
          ? `Similarity: ${Number(item.similarity).toFixed(2)}`
          : item.database_score != null
            ? `Similarity: ${Number(item.database_score).toFixed(2)}`
            : null,
        item.excerpt ? `Relevant excerpt: ${item.excerpt}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

async function retrieveLegacyDatabaseEvidence(plan, profile) {
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
      evidence: rankDatabaseEvidence(matches.map(normalizeVectorEvidenceRow)).slice(
        0,
        VECTOR_LIMIT
      ),
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

function summarizeEvidenceSnapshot(databaseEvidence) {
  const topEvidence = rankDatabaseEvidence(databaseEvidence).slice(0, 3);

  if (!topEvidence.length) {
    return {
      summary:
        "I couldn't get a full model response, so this fallback is limited to the evidence that was already retrieved.",
      training: [
        "Ask a more specific follow-up so I can tailor the recommendation more tightly to your goal and context.",
      ],
      nutrition: [
        "Include your goal, training volume, and any dietary constraints for a more useful answer.",
      ],
      mentalPerformance: [
        "Add sleep, stress, or focus context if you want broader performance recommendations.",
      ],
      limitations: [
        "This fallback is less personalized than the normal model-generated path.",
      ],
      confidenceRationale:
        "Confidence is based on retrieved sources only because the main generation path did not produce a usable answer.",
    };
  }

  const titles = topEvidence
    .map((item) => item.title)
    .filter(Boolean)
    .slice(0, 2);
  const lead = titles.length
    ? `The strongest retrieved evidence included ${titles.join(" and ")}.`
    : "Relevant evidence was retrieved, but the main generation path did not complete.";
  const primary = topEvidence[0];

  return {
    summary: `${lead} This fallback is grounded in the retrieved papers rather than the old canned response path.`,
    training: primary?.title
      ? [`Use the retrieved evidence around "${primary.title}" as the main anchor for your training decision.`]
      : ["Use the retrieved evidence as the main anchor for your training decision."],
    nutrition: [
      "Prioritize the nutrition implications supported by the top retrieved papers before adding broader advice.",
    ],
    mentalPerformance: [
      "Mental-performance guidance is limited here unless the retrieved evidence directly addressed that topic.",
    ],
    limitations: [
      "This fallback did not synthesize the evidence as deeply as the normal model-generated answer.",
      "Retry the question after the model path is healthy if you want a fuller synthesis.",
    ],
    confidenceRationale:
      "Confidence is based on source quality and recency, but the final narrative was not fully model-generated.",
  };
}

function buildOpenAIInput({
  question,
  plan,
  profile,
  databaseEvidence,
  evidenceForModel,
  today,
}) {
  return [
    {
      role: "system",
      content:
        "You are Emersus AI, a performance optimizer focused on strength training, cardio, nutrition, and mental performance. Provide evidence-aware recommendations without overstating certainty. Prioritize provided database evidence when it is relevant and usable. Use web search when the request needs fresher evidence, the database is sparse, or a claim needs external verification. Always prefer more recent and higher-quality sources. If the user asks for medical care, diagnosis, or crisis support, keep the advice cautious and recommend an appropriate professional when needed. Return JSON only.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          today,
          request: {
            question,
            topic: plan.topic,
            risk_level: plan.riskLevel,
            needs_recent_sources: plan.needsRecency,
          },
          user_profile: profile,
          retrieved_evidence_block: evidenceForModel,
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
              "Use retrieved database evidence when relevant before relying on general web search.",
              "Each source must include title, url, source_type, published_at, and why_it_matters.",
              "When PubMed-style evidence is available, preserve pmid, journal, publication year, doi, excerpt, and publication type when possible.",
              "Use source_type values of database or web.",
              "Cite the most recent and relevant sources first.",
            ],
          },
        },
        null,
        2
      ),
    },
  ];
}

function buildResponseSchema() {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      recommendations: {
        type: "object",
        properties: {
          training: {
            type: "array",
            items: { type: "string" },
          },
          nutrition: {
            type: "array",
            items: { type: "string" },
          },
          mental_performance: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["training", "nutrition", "mental_performance"],
        additionalProperties: false,
      },
      confidence: {
        type: "object",
        properties: {
          score: { type: "number" },
          label: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["score", "label", "rationale"],
        additionalProperties: false,
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            source_type: { type: "string" },
            published_at: { type: "string" },
            why_it_matters: { type: "string" },
            journal: { type: "string" },
            year: { type: "string" },
            doi: { type: "string" },
            pmid: { type: "string" },
            excerpt: { type: "string" },
            publication_type: { type: "string" },
          },
          required: [
            "title",
            "url",
            "source_type",
            "published_at",
            "why_it_matters",
          ],
          additionalProperties: false,
        },
      },
      limitations: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "summary",
      "recommendations",
      "confidence",
      "sources",
      "limitations",
    ],
    additionalProperties: false,
  };
}

function extractTextFromResponse(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (typeof payload.output_parsed === "object" && payload.output_parsed) {
    return JSON.stringify(payload.output_parsed);
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

          if (typeof content?.json === "object" && content.json) {
            return JSON.stringify(content.json);
          }
        }
      }
    }
  }

  return "";
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
        journal: normalizeText(source?.journal, 160),
        year: normalizeText(source?.year, 16),
        doi: normalizeText(source?.doi, 160),
        pmid: normalizeText(source?.pmid, 32),
        excerpt: normalizeText(source?.excerpt, 420),
        publication_type: normalizeText(source?.publication_type, 160),
      }))
      .filter((source) => source.title || source.url),
    limitations: normalizeList(payload?.limitations, 6),
  };
}

function buildFallbackRecommendation({ question, databaseEvidence }) {
  const sources = rankDatabaseEvidence(databaseEvidence).slice(0, 5).map((source) => ({
    title: source.title,
    url: source.url,
    source_type: source.source_type || "database",
    published_at: source.published_at,
    why_it_matters:
      source.summary || source.why_it_matters || "Relevant database evidence for this answer.",
    journal: source.journal || "",
    year: source.publication_year || source.published_at || "",
    doi: source.doi || "",
    pmid: source.pmid || "",
    excerpt: source.excerpt || "",
    publication_type:
      source.publication_type ||
      (Array.isArray(source.publication_types)
        ? source.publication_types.join(", ")
        : source.evidence_level || ""),
  }));

  const evidenceSnapshot = summarizeEvidenceSnapshot(databaseEvidence);

  return {
    summary:
      "I couldn’t get a full model response, so this fallback answer is based on the question topic and any evidence already in the database.",
    recommendations: {
      training: [
        "Ask a more specific follow-up so I can tune the plan to your goals, schedule, and recovery.",
      ],
      nutrition: [
        "If this is about supplementation or diet, include your goal, training frequency, and any dietary limits.",
      ],
      mental_performance: [
        "If you want focus or motivation advice, tell me when the problem happens and what your sleep and stress look like.",
      ],
    },
    confidence: {
      score: 0.35,
      label: "low",
      rationale:
        "The model response was unavailable, so this is a conservative fallback rather than a fully generated recommendation.",
    },
    sources,
    limitations: [
      "This fallback is less personalized than the normal model path.",
      "Add a follow-up question for a tighter answer.",
    ],
    summary: evidenceSnapshot.summary,
    recommendations: {
      training: evidenceSnapshot.training,
      nutrition: evidenceSnapshot.nutrition,
      mental_performance: evidenceSnapshot.mentalPerformance,
    },
    confidence: {
      score: sources.length ? 0.5 : 0.35,
      label: "low",
      rationale: evidenceSnapshot.confidenceRationale,
    },
    limitations: evidenceSnapshot.limitations,
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

async function callOpenAI({
  question,
  plan,
  profile,
  databaseEvidence,
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
      tool_choice: plan.needsWeb ? "auto" : "none",
      tools: plan.needsWeb
        ? [
            {
              type: "web_search",
              search_context_size: DEFAULT_WEB_CONTEXT,
              user_location: {
                type: "approximate",
                country: "US",
              },
            },
          ]
        : undefined,
      text: {
        format: {
          type: "json_schema",
          name: "emersus_recommendation",
          schema: buildResponseSchema(),
          strict: true,
        },
      },
      max_output_tokens: 1400,
      input: buildOpenAIInput({
        question,
        plan,
        profile,
        databaseEvidence,
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
  const vectorDatabase = await retrieveVectorEvidence(question);
  const shouldUseLegacyDatabase =
    vectorDatabase.evidence.length === 0 ||
    process.env.EMERSUS_ENABLE_LEGACY_DATABASE === "true";
  const legacyDatabase = shouldUseLegacyDatabase
    ? await retrieveLegacyDatabaseEvidence(plan, mergedProfile)
    : {
        available: false,
        method: null,
        evidence: [],
        error: null,
      };
  const databaseEvidence = rankDatabaseEvidence(
    dedupeEvidence([...vectorDatabase.evidence, ...legacyDatabase.evidence])
  ).slice(0, 8);
  const evidenceForModel = formatEvidenceForModel(databaseEvidence);
  const today = new Date().toISOString().slice(0, 10);
  let openAIResponse = null;
  let modelPayload = null;

  try {
    openAIResponse = await callOpenAI({
      question,
      plan,
      profile: mergedProfile,
      databaseEvidence,
      evidenceForModel,
      today,
    });

    const extractedText = extractTextFromResponse(openAIResponse);
    if (extractedText) {
      modelPayload = normalizeRecommendationPayload(
        extractJsonObject(extractedText)
      );
    }
  } catch (error) {
    console.error("OpenAI recommendation generation failed:", error);
  }

  if (!modelPayload) {
    modelPayload = buildFallbackRecommendation({
      question,
      databaseEvidence,
    });
  }
  const combinedSources = rankDatabaseEvidence(
    [...databaseEvidence, ...modelPayload.sources].map((source) => ({
      ...source,
      database_score:
        source.database_score ?? source.similarity ?? source.freshness_score ?? 0,
    }))
  ).slice(0, 8);
  const confidence = computeConfidence({
    plan,
    databaseEvidence,
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
      url: source.url || "",
      source_type: source.source_type || "database",
      published_at: source.published_at || "",
      evidence_level: source.evidence_level || "",
      why_it_matters:
        source.why_it_matters ||
        (source.source_type === "pubmed_vector"
          ? "Retrieved from the Emersus PubMed evidence index."
          : source.source_type === "database"
          ? "Retrieved from the Emersus knowledge database."
          : "Referenced in the model-generated recommendation."),
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
    })),
    debug: includeDebug
      ? {
          vector_database: vectorDatabase,
          legacy_database: legacyDatabase,
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
