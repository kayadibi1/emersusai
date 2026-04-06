import { createHash } from "node:crypto";
import { retrieveDatabaseEvidence as retrieveVectorDatabaseEvidence } from "./retrieveDatabaseEvidence.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini";
const SYNTHESIS_FALLBACK_MODEL =
  process.env.OPENAI_EMERSUS_FALLBACK_MODEL || "gpt-4.1-mini";
const MAX_QUESTION_LENGTH = 3000;
const MAX_PROFILE_FIELD_LENGTH = 300;
const VECTOR_LIMIT = 6;
const VECTOR_MATCH_THRESHOLD = 0.4;
const VECTOR_MATCH_COUNT = 10;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
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

function sanitizeRequest(payload) {
  const question = normalizeText(payload?.question, MAX_QUESTION_LENGTH);

  if (!question) {
    const error = new Error("A non-empty question is required.");
    error.statusCode = 400;
    throw error;
  }

  return {
    question,
    userId: normalizeText(payload?.userId, 160),
    requestMeta: {
      clientIp: normalizeText(payload?.requestMeta?.clientIp, 200),
      userAgent: normalizeText(payload?.requestMeta?.userAgent, 300),
    },
    profile: {
      goal: normalizeText(payload?.profile?.goal, MAX_PROFILE_FIELD_LENGTH),
      experience_level: normalizeText(
        payload?.profile?.experience_level,
        120
      ),
      dietary_preferences: normalizeText(
        payload?.profile?.dietary_preferences,
        MAX_PROFILE_FIELD_LENGTH
      ),
      injuries_limitations: normalizeText(
        payload?.profile?.injuries_limitations,
        MAX_PROFILE_FIELD_LENGTH
      ),
      equipment_access: normalizeText(payload?.profile?.equipment_access, 200),
      available_days_per_week: normalizeText(
        payload?.profile?.available_days_per_week,
        80
      ),
      available_minutes_per_session: normalizeText(
        payload?.profile?.available_minutes_per_session,
        80
      ),
      sleep_stress_context: normalizeText(
        payload?.profile?.sleep_stress_context,
        200
      ),
      medical_disclaimer_acknowledged:
        payload?.profile?.medical_disclaimer_acknowledged === true,
    },
    includeDebug: payload?.includeDebug === true,
    threadState: normalizeThreadState(payload?.threadState),
    recentMessages: normalizeRecentMessages(payload?.recentMessages),
  };
}

function classifySafety({ question, profile, threadState }) {
  const text = [
    question,
    profile?.goal,
    profile?.dietary_preferences,
    profile?.injuries_limitations,
    profile?.sleep_stress_context,
    threadState?.last_user_intent,
  ]
    .map((item) => normalizeText(item, 400))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /ignore (all|previous|prior) instructions|reveal (your|the) (system|hidden) prompt|show (your|the) hidden instructions|developer message|jailbreak|bypass (your )?(rules|guardrails)|act as if safety does not apply/.test(
      text
    )
  ) {
    return {
      status: "prompt_injection_or_system_probe",
      responseMode: "refusal",
      reasons: ["prompt_injection_or_system_probe"],
    };
  }

  if (
    /suicide|kill myself|self-harm|self harm|purge|bulimi|anorexi|starve myself|how little can i eat|crash diet|dehydration cut|laxative|vomit after eating/.test(
      text
    )
  ) {
    return {
      status: "disallowed_unsafe",
      responseMode: "refusal",
      reasons: ["unsafe_body_or_self_harm"],
    };
  }

  if (
    /steroid cycle|tren|test e\b|testosterone cycle|inject testosterone|illegal steroid|dnp\b|clenbuterol|ephedrine stack|where can i buy/.test(
      text
    )
  ) {
    return {
      status: "disallowed_unsafe",
      responseMode: "refusal",
      reasons: ["illicit_or_high_risk_enhancement"],
    };
  }

  if (
    /diagnos|diagnosis|should i take this medication|medication|prescription|drug interaction|interact with|pregnan|pregnancy|breastfeeding|diabetes|hypertension|blood pressure medication|ssri|antidepressant|bipolar|panic disorder|treat my disease|treat my condition/.test(
      text
    )
  ) {
    return {
      status: "medical_boundary",
      responseMode: "boundary",
      reasons: ["medical_or_medication_overlap"],
    };
  }

  if (/blood pressure|anxiety|panic|insomnia|arrhythmia|heart condition/.test(text)) {
    return {
      status: "allowed_with_caution",
      responseMode: "caution",
      reasons: ["health_risk_overlap"],
    };
  }

  return {
    status: "allowed",
    responseMode: "normal",
    reasons: [],
  };
}

function buildGuardrailResponse({ question, plan, safety }) {
  const blocked =
    safety.status === "disallowed_unsafe" ||
    safety.status === "prompt_injection_or_system_probe";
  const boundary = safety.status === "medical_boundary";

  let answerText =
    "I can help with evidence-backed training, nutrition, supplements, recovery, and performance questions.";

  if (blocked) {
    answerText =
      "I can't help with that request. If you want, I can help with a safer evidence-based version of the question instead.\n\n- Ask about general supplement effectiveness or safety.\n- Ask about sustainable fat loss, training, recovery, or performance strategies.\n- If this is urgent or safety-related, contact a qualified clinician or local emergency support.";
  } else if (boundary) {
    answerText =
      "This question crosses into medical guidance, so I can't give a personalized medication or diagnosis recommendation. I can still help with general evidence-backed education, but a clinician should guide the actual decision.\n\n- If you want, ask for the general evidence on the supplement, food, or training method.\n- Include that you want a high-level summary only, not a personal medical recommendation.\n- For anything involving medications, pregnancy, or a diagnosed condition, check with a licensed clinician.";
  }

  return {
    user: {
      id: null,
      profile_used: {},
    },
    plan,
    summary: normalizeText(answerText, 600),
    answer_text: answerText,
    recommendations: {
      general: [],
    },
    confidence: {
      score: 0.25,
      label: blocked ? "blocked" : "medical_boundary",
      rationale: blocked
        ? "The request was blocked by Emersus safety guardrails."
        : "This request overlaps with medical decision-making and needs a stricter boundary.",
    },
    limitations: [],
    sources: [],
    cards: [],
    guardrail: {
      status: safety.status,
      response_mode: safety.responseMode,
      reasons: safety.reasons,
    },
  };
}

function hashClientIp(value) {
  const normalized = normalizeText(value, 200);
  if (!normalized) {
    return "";
  }

  return createHash("sha256").update(normalized).digest("hex");
}

async function logGuardrailEvent({
  supabaseUrl,
  serviceRoleKey,
  supabaseUserId,
  stableUserId,
  question,
  plan,
  safety,
  requestMeta,
  threadState,
}) {
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  if (!safety || safety.status === "allowed") {
    return;
  }

  const payload = {
    user_id: supabaseUserId || null,
    stable_user_id: stableUserId || null,
    event_type: safety.status,
    response_mode: safety.responseMode || "normal",
    reasons: Array.isArray(safety.reasons) ? safety.reasons : [],
    question_preview: normalizeText(question, 500),
    topic: normalizeText(plan?.topic, 80),
    risk_level: normalizeText(plan?.riskLevel, 40),
    client_ip_hash: hashClientIp(requestMeta?.clientIp),
    user_agent: normalizeText(requestMeta?.userAgent, 300),
    metadata: {
      request_has_thread_memory: Boolean(threadStateHasUsefulContent(threadState)),
    },
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/guardrail_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Guardrail event log failed: ${errorText || response.status}`);
  }
}

function threadStateHasUsefulContent(threadState) {
  return Boolean(
    normalizeText(threadState?.primary_topic, 80) ||
      normalizeText(threadState?.goal_context, 80) ||
      normalizeText(threadState?.last_user_intent, 80) ||
      (Array.isArray(threadState?.recent_entities) &&
        threadState.recent_entities.length > 0)
  );
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

function normalizeThreadConstraints(value) {
  const constraints = value && typeof value === "object" ? value : {};
  return {
    dietary: normalizeList(constraints.dietary, 4, 80),
    injury: normalizeList(constraints.injury, 4, 80),
    equipment: normalizeList(constraints.equipment, 4, 80),
    schedule: normalizeList(constraints.schedule, 4, 80),
    sleep_stress: normalizeList(constraints.sleep_stress, 4, 80),
    medical_caution: normalizeList(constraints.medical_caution, 4, 80),
  };
}

function normalizeThreadState(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    version: Number(raw.version || 1),
    primary_topic: normalizeText(raw.primary_topic, 80),
    secondary_topics: normalizeList(raw.secondary_topics, 4, 60),
    goal_context: normalizeText(raw.goal_context, 80),
    question_mode: normalizeText(raw.question_mode, 40),
    recent_entities: normalizeList(raw.recent_entities, 8, 60),
    comparison_target: normalizeText(raw.comparison_target, 80),
    population_context: normalizeList(raw.population_context, 4, 60),
    constraints: normalizeThreadConstraints(raw.constraints),
    last_user_intent: normalizeText(raw.last_user_intent, 180),
    last_answer_summary: normalizeText(raw.last_answer_summary, 260),
    thread_summary: normalizeText(raw.thread_summary, 420),
    updated_at: normalizeText(raw.updated_at, 60),
  };
}

function normalizeRecentMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      role: normalizeText(item?.role, 24).toLowerCase(),
      text: normalizeText(item?.text, 320),
    }))
    .filter((item) => item.role && item.text)
    .slice(-6);
}

function buildThreadMemoryBlock(threadState, recentMessages) {
  const constraints = [];

  for (const [label, values] of Object.entries(threadState.constraints || {})) {
    if (Array.isArray(values) && values.length) {
      constraints.push(`${titleCase(label)}: ${values.join(", ")}`);
    }
  }

  const lines = [
    `Primary topic: ${threadState.primary_topic || "not established"}`,
    `Goal context: ${threadState.goal_context || "not established"}`,
    `Current mode: ${threadState.question_mode || "not established"}`,
    `Recent entities: ${
      threadState.recent_entities.length ? threadState.recent_entities.join(", ") : "none"
    }`,
    `Population context: ${
      threadState.population_context.length
        ? threadState.population_context.join(", ")
        : "none"
    }`,
    `Comparison target: ${threadState.comparison_target || "none"}`,
    `Constraints: ${constraints.length ? constraints.join(" | ") : "none stated"}`,
    `Last user intent: ${threadState.last_user_intent || "none"}`,
    `Last answer summary: ${threadState.last_answer_summary || "none"}`,
    `Thread summary: ${threadState.thread_summary || "none"}`,
  ];

  if (recentMessages.length) {
    lines.push(
      "Recent messages:",
      ...recentMessages.map(
        (message) => `- ${message.role}: ${message.text}`
      )
    );
  }

  return lines.join("\n");
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

function scoreTone(score) {
  if (score >= 0.8) {
    return "good";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return "caution";
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
        item.author_label ? `Authors: ${item.author_label}` : null,
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

function buildSynthesisInput({
  question,
  profile,
  plan,
  evidenceForModel,
  today,
  threadState,
  recentMessages,
  safety,
}) {
  const normalizedThreadState = normalizeThreadState(threadState);
  const normalizedRecentMessages = normalizeRecentMessages(recentMessages);
  const threadMemory = buildThreadMemoryBlock(
    normalizedThreadState,
    normalizedRecentMessages
  );

  return [
    {
      role: "system",
      content:
        [
          "You are Emersus AI, a science-aware performance assistant for strength training, cardio, nutrition, and mental performance.",
          "Use the provided evidence first. Keep claims tethered to the evidence. Be practical, specific, and concise.",
          "Use thread memory only to interpret follow-up references or preserve relevant goal/constraint continuity.",
          "Do not use thread memory as evidence, and do not let it override the user's current question.",
          "If thread context is needed for interpretation, make the assumption briefly explicit.",
          "Do not invent sources. Do not return JSON.",
          "Return plain text only.",
          "Start with a direct answer in normal prose.",
          "Use a short bullet list only when it genuinely helps the user act on the answer.",
          "Do not use section headings like SUMMARY, TRAINING, NUTRITION, MENTAL PERFORMANCE, CONFIDENCE, or LIMITATIONS.",
          "Do not mention confidence scores, confidence labels, or system-status concepts in the answer.",
          "Only mention training, nutrition, or mental-performance advice if it is directly relevant to the user's question.",
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
          safety_mode: safety?.responseMode || "normal",
          safety_reasons: Array.isArray(safety?.reasons) ? safety.reasons : [],
          user_profile: profile,
          thread_memory: threadMemory,
          retrieved_evidence: evidenceForModel,
          instructions: [
            "Answer the user's question directly.",
            "Use the retrieved evidence as the main basis for the answer.",
            "Use thread memory only to resolve references like 'it', 'that', follow-up population changes, or comparison carryover.",
            "Make the recommendations specific and useful.",
            "If the evidence is limited or mixed, explain that naturally in the prose instead of using a dedicated limitations section.",
            "Do not include irrelevant training, nutrition, or mental-performance advice.",
            "If the question touches medical or medication risk, stay high level and do not give diagnosis or personalized medication advice.",
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
  model = DEFAULT_MODEL,
  question,
  profile,
  plan,
  evidenceForModel,
  today,
  threadState,
  recentMessages,
  safety,
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
      model,
      max_output_tokens: 1100,
      input: buildSynthesisInput({
        question,
        profile,
        plan,
        evidenceForModel,
        today,
        threadState,
        recentMessages,
        safety,
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

function extractGenericBullets(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

function extractPlainParagraphs(text) {
  return String(text || "")
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^[-*•]\s+/.test(line))
        .join(" ")
        .trim()
    )
    .filter(Boolean);
}

function normalizeSynthesisPayload(text) {
  const normalizedRawText = String(text || "").trim();
  const normalizedText = normalizeText(normalizedRawText, 2400);
  const paragraphs = extractPlainParagraphs(normalizedRawText);
  const genericBullets = extractGenericBullets(normalizedRawText);
  const fallbackSummary = paragraphs[0] || normalizedText;

  if (!normalizedText) {
    throw new Error("The model response was empty.");
  }

  return {
    summary: normalizeText(fallbackSummary, 1600),
    answer_text: normalizedRawText || normalizedText,
    recommendations: {
      general: normalizeList(genericBullets, 8, 240),
    },
    limitations: [],
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
  const fallbackBullets = topEvidence[0]?.title
    ? [`Use the evidence around "${topEvidence[0].title}" as the main anchor for your next decision.`]
    : ["Ask a more specific follow-up so I can give a tighter evidence-backed answer."];
  const summary = titles.length
    ? `I couldn't complete the normal synthesis step, but the strongest retrieved evidence included ${titles.join(" and ")}.`
    : "I couldn't complete the normal synthesis step, so this answer is based only on the retrieved evidence.";

  return {
    summary,
    answer_text: [summary, ...fallbackBullets.map((item) => `- ${item}`)].join("\n\n"),
    recommendations: {
      general: fallbackBullets,
    },
    limitations: [],
  };
}

function determineRecencyLabel(source) {
  const freshness = Number(source?.freshness_score ?? scoreEvidenceFreshness(source?.published_at));

  if (freshness >= 0.9) {
    return "Very recent";
  }

  if (freshness >= 0.75) {
    return "Recent evidence";
  }

  return "Mixed recency";
}

function determineEvidenceLabel(source) {
  const publicationType = normalizeText(
    source?.publication_type ||
      (Array.isArray(source?.publication_types)
        ? source.publication_types.join(", ")
        : source?.evidence_level),
    80
  );

  if (/systematic|meta|guideline|consensus|review/i.test(publicationType)) {
    return "Review-level evidence";
  }

  if (/trial|rct/i.test(publicationType)) {
    return "Trial evidence";
  }

  if (publicationType) {
    return publicationType;
  }

  return "Database evidence";
}

function summarizeEffect(summary) {
  const text = normalizeText(summary, 180).toLowerCase();

  if (/modest|small but meaningful/.test(text)) {
    return "Modest but real";
  }

  if (/effective|consisten|reliable|strong support/.test(text)) {
    return "Reliable edge";
  }

  if (/mixed|uncertain|limited/.test(text)) {
    return "Mixed support";
  }

  return "Evidence-backed";
}

function buildVerdictTitle(summary) {
  const firstSentence = normalizeText(String(summary || "").split(/(?<=[.!?])\s+/)[0], 110);
  if (!firstSentence) {
    return "Evidence-backed recommendation";
  }

  return firstSentence.replace(/^[—–-]+/, "").trim();
}

function buildActionColumns({ recommendations, topic }) {
  const columns = [];
  const label = topic === "mental_performance" ? "Mental performance" : "Key takeaways";

  if (recommendations.general?.length) {
    columns.push({
      label,
      tone: "good",
      items: recommendations.general.slice(0, 3),
    });
  }

  return columns.slice(0, 3);
}

function wantsVisualCards(question) {
  return /\b(card|cards|visual|visuals|graphic|graphics|graph|chart|diagram|dashboard|evidence card|source card|show me)\b/i.test(
    String(question || "")
  );
}

function cleanSourceTakeaway(value) {
  return normalizeText(
    String(value || "")
      .replace(/^(introduction|background|methods|results|conclusion)\s+/i, "")
      .replace(/\[\s*\]/g, "")
      .replace(/\s+/g, " "),
    180
  );
}

function buildCards({ question, plan, synthesis, confidence, sources, evidence }) {
  const topSource = sources[0] || evidence[0] || null;
  const recentSourceCount = sources.filter(
    (source) => Number(source.freshness_score || 0) >= 0.82
  ).length;
  const highQualitySourceCount = sources.filter(
    (source) => Number(source.quality_score || 0) >= 0.84
  ).length;
  const recencyScore = sources.length ? recentSourceCount / sources.length : 0.4;
  const qualityScore = sources.length ? highQualitySourceCount / sources.length : 0.55;
  const consistencyScore = clamp(
    Number(confidence.score || 0) * 0.92 + qualityScore * 0.18,
    0,
    1
  );
  const personalizationScore = clamp(
    (plan.topic === "mental_performance" && synthesis.recommendations.mental_performance?.length
      ? 0.74
      : 0.62) - (plan.riskLevel === "medium" ? 0.08 : 0),
    0.35,
    0.9
  );
  const effectLabel = summarizeEffect(synthesis.summary);
  const actionColumns = buildActionColumns({
    recommendations: synthesis.recommendations,
    topic: plan.topic,
  });
  const visualRequested = wantsVisualCards(question);
  const minimumConfidence = visualRequested ? 0.48 : 0.65;
  const shouldShowCards =
    sources.length >= 2 &&
    Number(confidence.score || 0) >= minimumConfidence;

  if (!shouldShowCards) {
    return [];
  }
  const sourceHighlights = sources.slice(0, 3).map((source) => ({
    title: source.title,
    meta: [
      source.journal,
      source.year,
      source.publication_type,
      source.pmid ? `PMID ${source.pmid}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    takeaway: cleanSourceTakeaway(source.excerpt || source.why_it_matters),
    links: [
      source.url
        ? {
            label: source.doi ? "DOI" : "Open source",
            url: source.url,
          }
        : null,
      source.pmid
        ? {
            label: "PubMed",
            url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(source.pmid)}/`,
          }
        : null,
    ].filter(Boolean),
  }));

  const cards = [
    {
      type: "verdict_hero",
      eyebrow: `${titleCase(plan.topic)} — Evidence Verdict`,
      title: buildVerdictTitle(synthesis.summary),
      body: normalizeText(synthesis.summary, 220),
      metrics: [
        {
          label: "Confidence",
          value: titleCase(confidence.label),
          tone: scoreTone(confidence.score),
        },
        {
          label: "Evidence",
          value: determineEvidenceLabel(topSource),
          tone: scoreTone(qualityScore),
        },
        {
          label: "Recency",
          value: determineRecencyLabel(topSource),
          tone: scoreTone(recencyScore),
        },
        {
          label: "Effect",
          value: effectLabel,
          tone: scoreTone(confidence.score),
        },
      ],
    },
  ];

  if (actionColumns.length) {
    cards.push({
      type: "action_grid",
      title: "What to do",
      columns: actionColumns,
    });
  }

  cards.push({
    type: "evidence_profile",
    title: "Evidence profile",
    footnote: confidence.rationale,
    items: [
      {
        label: "Evidence quality",
        score: Math.round(qualityScore * 10),
        max: 10,
        tone: scoreTone(qualityScore),
      },
      {
        label: "Consistency",
        score: Math.round(consistencyScore * 10),
        max: 10,
        tone: scoreTone(consistencyScore),
      },
      {
        label: "Recency",
        score: Math.round(recencyScore * 10),
        max: 10,
        tone: scoreTone(recencyScore),
      },
      {
        label: "Personal fit",
        score: Math.round(personalizationScore * 10),
        max: 10,
        tone: scoreTone(personalizationScore),
      },
    ],
  });

  if (sourceHighlights.length) {
    cards.push({
      type: "source_highlights",
      title: "Best sources",
      items: sourceHighlights,
    });
  }

  if (Array.isArray(synthesis.limitations) && synthesis.limitations.length) {
    cards.push({
      type: "watchouts",
      title: "Watchouts",
      tone: confidence.score >= 0.75 ? "medium" : "caution",
      items: synthesis.limitations.slice(0, 4),
    });
  }

  return cards;
}

function normalizeSources(evidence) {
  return evidence.slice(0, 6).map((source) => ({
    title: source.title,
    url: source.url || "",
    source_type: source.source_type || "pubmed_vector",
    authors: parseAuthors(source.authors),
    author_label: source.author_label || formatAuthorLabel(source.authors),
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

function questionKeywords(question) {
  return normalizeText(question, 600)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .filter((word, index, words) => words.indexOf(word) === index)
    .slice(0, 12);
}

function splitSentences(text) {
  return normalizeText(text, 2400)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function inferFindingLabel(sentence, question, unitType = "") {
  const sentenceText = sentence.toLowerCase();
  const text = `${question} ${sentence}`.toLowerCase();
  if (unitType === "duration") {
    return "Protocol duration";
  }
  if (unitType === "dose") {
    return "Dose used";
  }
  if (/risk|safety|adverse|side effect|tolerat/.test(sentenceText)) {
    return "Safety finding";
  }
  if (/muscle|lean mass|fat-free mass|hypertrophy|body composition/.test(text)) {
    return "Muscle-related effect";
  }
  if (/strength|power|performance|capacity|repetition|sprint/.test(text)) {
    return "Performance effect";
  }
  if (/recovery|soreness|damage|rehabilitation/.test(text)) {
    return "Recovery effect";
  }
  if (/vo2|maximal oxygen|endurance|cardio|aerobic|threshold/.test(text)) {
    return "Endurance effect";
  }
  if (/sleep|insomnia|latency|quality/.test(text)) {
    return "Sleep-related effect";
  }
  return "Reported finding";
}

function allowsProtocolMeasurements(question) {
  return /dose|dosage|how much|take|timing|duration|how long|weeks?|months?|cycle|protocol|load|loading|maintenance/i.test(
    question
  );
}

function allowsSafetyMeasurements(question) {
  return /safe|safety|risk|adverse|side effect|health risk|kidney|liver|blood pressure/i.test(
    question
  );
}

function extractMeasurement(sentence) {
  const patterns = [
    {
      kind: "percent",
      regex: /(?:increase(?:d|s)?|decrease(?:d|s)?|improv(?:e|ed|es|ement)|gain(?:ed|s)?|loss|reduc(?:e|ed|tion)|change(?:d|s)?)?[^\d]{0,24}(\d+(?:\.\d+)?)\s?%/i,
      format: (match) => ({
        displayValue: `${match[1]}%`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "mass",
      regex: /(\d+(?:\.\d+)?)\s?(kg|lb|lbs)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "duration",
      regex: /(\d+(?:\.\d+)?)\s?(days?|weeks?|months?)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "dose",
      regex: /(\d+(?:\.\d+)?)\s?(g|mg|mcg|kg)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern.regex);
    if (match) {
      return {
        kind: pattern.kind,
        ...pattern.format(match),
      };
    }
  }

  return null;
}

function buildQuantFindings({ question, evidence }) {
  const keywords = questionKeywords(question);
  const findings = [];
  const seen = new Set();

  for (const source of evidence.slice(0, VECTOR_LIMIT)) {
    const candidateText = [
      source.chunk_text,
      source.excerpt,
      source.summary,
      source.why_it_matters,
    ]
      .filter(Boolean)
      .join(" ");

    for (const sentence of splitSentences(candidateText)) {
      const measurement = extractMeasurement(sentence);
      if (!measurement) {
        continue;
      }

      const lower = sentence.toLowerCase();
      const keywordMatches = keywords.filter((keyword) => lower.includes(keyword)).length;
      const relevanceScore =
        keywordMatches +
        (measurement.kind === "percent" || measurement.kind === "mass" ? 2 : 0) +
        clamp(Number(source.ranking_score || source.database_score || 0), 0, 1);

      if (
        (measurement.kind === "duration" || measurement.kind === "dose") &&
        !allowsProtocolMeasurements(question)
      ) {
        continue;
      }

      if (/risk|health risks|adverse|side effect|safe|safety|tolerat/i.test(sentence) && !allowsSafetyMeasurements(question)) {
        continue;
      }

      if (keywords.length && keywordMatches === 0) {
        continue;
      }

      const label = inferFindingLabel(sentence, question, measurement.kind);
      const key = `${measurement.kind}:${measurement.displayValue}:${label}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      findings.push({
        displayValue: measurement.displayValue,
        normalizedValue: measurement.normalizedValue,
        unitType: measurement.kind,
        label,
        sentence: normalizeText(sentence, 320),
        sourceTitle: normalizeText(source.title || "Article", 120),
        sourceId: source.pmid ? `PMID ${source.pmid}` : source.doi || "",
        detail: source.publication_year || source.published_at || "",
        score: Number(relevanceScore.toFixed(3)),
      });
    }
  }

  return findings
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

async function generateRecommendation({
  question,
  profile,
  userId,
  includeDebug,
  threadState,
  recentMessages,
  requestMeta,
}) {
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
  const safety = classifySafety({
    question,
    profile: mergedProfile,
    threadState,
  });

  if (safety.status !== "allowed") {
    logGuardrailEvent({
      supabaseUrl,
      serviceRoleKey,
      supabaseUserId,
      stableUserId,
      question,
      plan,
      safety,
      requestMeta,
      threadState,
    }).catch((error) => {
      console.error("Guardrail event logging failed:", error);
    });
  }

  if (
    safety.status === "disallowed_unsafe" ||
    safety.status === "prompt_injection_or_system_probe" ||
    safety.status === "medical_boundary"
  ) {
    const blockedResponse = buildGuardrailResponse({
      question,
      plan,
      safety,
    });

    if (includeDebug) {
      blockedResponse.debug = {
        safety,
        synthesis_mode: "guardrail_block",
      };
    }

    if (stableUserId) {
      blockedResponse.user.id = stableUserId;
      blockedResponse.user.profile_used = mergedProfile;
    }

    return blockedResponse;
  }

  const vectorDatabase = await retrieveVectorEvidence(question);
  const databaseEvidence = vectorDatabase.evidence.slice(0, VECTOR_LIMIT);
  const evidenceForModel = formatEvidenceForModel(databaseEvidence);
  const today = new Date().toISOString().slice(0, 10);
  let openAIResponse = null;
  let synthesis = null;
  let synthesisMode = "not_started";
  let synthesisModel = DEFAULT_MODEL;

  try {
    openAIResponse = await callOpenAISynthesis({
      model: DEFAULT_MODEL,
      question,
      profile: mergedProfile,
      plan,
      evidenceForModel,
      today,
      threadState,
      recentMessages,
      safety,
    });

    const structuredOutput = extractStructuredOutput(openAIResponse);
    if (structuredOutput) {
      synthesis = normalizeSynthesisPayload(JSON.stringify(structuredOutput));
      synthesisMode = "structured_output";
    } else {
      const extractedText = extractTextFromResponse(openAIResponse);
      if (extractedText) {
        synthesis = normalizeSynthesisPayload(extractedText);
        synthesisMode = "text_output";
      } else {
        synthesisMode = "empty_model_output";
      }
    }

    if (!synthesis && SYNTHESIS_FALLBACK_MODEL && SYNTHESIS_FALLBACK_MODEL !== synthesisModel) {
      console.warn("Emersus synthesis retrying with fallback model.", {
        primaryModel: synthesisModel,
        fallbackModel: SYNTHESIS_FALLBACK_MODEL,
        responseId: openAIResponse?.id || null,
        synthesisMode,
      });

      openAIResponse = await callOpenAISynthesis({
        model: SYNTHESIS_FALLBACK_MODEL,
        question,
        profile: mergedProfile,
        plan,
        evidenceForModel,
        today,
        threadState,
        recentMessages,
        safety,
      });
      synthesisModel = SYNTHESIS_FALLBACK_MODEL;

      const retryStructuredOutput = extractStructuredOutput(openAIResponse);
      if (retryStructuredOutput) {
        synthesis = normalizeSynthesisPayload(JSON.stringify(retryStructuredOutput));
        synthesisMode = "structured_output_retry";
      } else {
        const retryText = extractTextFromResponse(openAIResponse);
        if (retryText) {
          synthesis = normalizeSynthesisPayload(retryText);
          synthesisMode = "text_output_retry";
        } else {
          synthesisMode = "empty_model_output_retry";
        }
      }
    }
  } catch (error) {
    synthesisMode = "openai_error";
    console.error("OpenAI recommendation generation failed:", error);
  }

  if (!synthesis) {
    if (openAIResponse) {
      console.warn("Emersus synthesis fell back after OpenAI call.", {
        responseId: openAIResponse?.id || null,
        model: synthesisModel,
        hasStructuredOutput: Boolean(extractStructuredOutput(openAIResponse)),
        hasTextOutput: Boolean(extractTextFromResponse(openAIResponse)),
        synthesisMode,
      });
    } else {
      console.warn("Emersus synthesis used fallback because no OpenAI response was available.", {
        synthesisMode,
      });
    }

    synthesis = buildFallbackRecommendation({
      question,
      evidence: databaseEvidence,
    });
    synthesisMode = `${synthesisMode}:fallback`;
  } else {
    console.log("Emersus synthesis succeeded.", {
      responseId: openAIResponse?.id || null,
      model: synthesisModel,
      synthesisMode,
      evidenceCount: databaseEvidence.length,
    });
  }

  const sources = normalizeSources(databaseEvidence);
  const confidence = computeConfidence({
    plan,
    evidence: databaseEvidence,
  });
  const cards = buildCards({
    question,
    plan,
    synthesis,
    confidence,
    sources,
    evidence: databaseEvidence,
  });
  const quantFindings = buildQuantFindings({
    question,
    evidence: databaseEvidence,
  });

  return {
    user: {
      id: stableUserId || null,
      profile_used: mergedProfile,
    },
    plan,
    summary: synthesis.summary,
    answer_text: synthesis.answer_text || synthesis.summary,
    recommendations: synthesis.recommendations,
    confidence,
    limitations: synthesis.limitations,
    sources,
    cards,
    quant_findings: quantFindings,
    guardrail: {
      status: safety.status,
      response_mode: safety.responseMode,
      reasons: safety.reasons,
    },
    debug: includeDebug
      ? {
          vector_database: vectorDatabase,
          evidence_for_model: evidenceForModel,
          openai_response_id: openAIResponse?.id || null,
          raw_output_text: extractTextFromResponse(openAIResponse) || "",
          synthesis_mode: synthesisMode,
          synthesis_model: synthesisModel,
          has_structured_output: Boolean(extractStructuredOutput(openAIResponse)),
          safety,
        }
      : undefined,
  };
}

function validateRequest(body) {
  return sanitizeRequest(body);
}

export {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
};
