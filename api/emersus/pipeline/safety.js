/**
 * Pipeline stage: safety guardrail (3-matcher), refusal responses, buildPlan.
 *
 * Extracted verbatim from workflow.js — classifySafety, hardRefusal,
 * buildGuardrailResponse, pickRefusalContent, buildPlan, hashClientIp,
 * logGuardrailEvent, threadStateHasUsefulContent.
 */

import { createHash } from "node:crypto";
import { ShortCircuit } from "./context.js";

// ── Local normalizeText (sanitize.js is created concurrently) ────────────────
function normalizeText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// ── buildPlan ────────────────────────────────────────────────────────────────

// buildPlan still provides risk_level to the model.
// topic is no longer classified server-side — the model self-routes via tools.
function buildPlan(question, profile) {
  const lowerQuestion = question.toLowerCase();
  const riskLevel =
    /injur|pain|depress|anx|panic|eating disorder|blood pressure|diabetes|medication|pregnan/.test(
      lowerQuestion
    ) || normalizeText(profile.injuries_limitations, 600)
      ? "medium"
      : "low";

  return {
    topic: "general",
    riskLevel,
  };
}

// ── classifySafety ───────────────────────────────────────────────────────────

function classifySafety({ question, profile, threadState, recentMessages }) {
  const questionOnly = normalizeText(question, 800).toLowerCase();

  // Concatenated text for prompt-injection detection (injection can appear
  // in any field, not just the question).
  const allText = [
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

  // ── 1. Prompt injection / system-prompt extraction ──────────────────────
  const INJECTION_PATTERNS = [
    /ignore (all|previous|prior) instructions/,
    /reveal (your|the) (system|hidden) prompt/,
    /show (your|the) hidden instructions/,
    /\bjailbreak\b/,
    /bypass (your )?(rules|guardrails)/,
    /act as if safety does not apply/,
    /forget (everything|all (previous|prior|above)|the above)/,
    /disregard (your |all |prior |previous )?(context|rules|instructions|prompt|guidelines|programming)/,
    /\bdo anything now\b/,
    /\b(DAN|STAN|AIM|DUDE)\s*(mode|prompt)\b/i,
    /\bact as (DAN|STAN|AIM|DUDE)\b/i,
    /\byou are (now )?(DAN|STAN|AIM|DUDE)\b/i,
    /\b(EvilBOT|Mongo Tom|ANTI[\s-]?DAN|L1B3RT45|OBLITERATUS)\b/i,
    /\byou are now\b/,
    /\bfrom now on you\b/,
    /pretend (you |that you |to )?(are|have no|can|don't have|lack)/,
    /\broleplay as\b/,
    /simulate (a |an |being )/,
    /assume the role/,
    /you are going to act as/,
    /\b(developer|testing|debug|maintenance) mode\b/,
    /safety (filters|parameters|protocols|checks|measures|rules)\s*(are |have been |were )?(disabled|off|removed|updated|lifted|turned off)/,
    /\bi am (your )?(administrator|admin|developer|creator|owner|operator)\b/,
    /\b(root|elevated|admin|superuser) access\b/,
    /\bSYSTEM\s*(MESSAGE|OVERRIDE|NOTICE|ALERT)\b/,
    /\bsystem\s*override\b/i,
    /do (anything|everything) i (say|ask|tell|want)/,
    /\bno (restrictions|limits|boundaries|rules|guidelines|filters|constraints)\b/,
    /\b(unrestricted|unfiltered|uncensored|unhinged|unlimited) mode\b/,
    /\b(god|sudo|admin|root) mode\b/,
    /cannot (reject|refuse|deny|decline)/,
    /print (your |the )(prompt|instructions|system message|rules)/,
    /output (your |the )(system|initial|original|hidden|internal) (prompt|instructions|message)/,
    /what (are|were) your (instructions|rules|guidelines|system prompt|directives)/,
    /repeat (your |the |back )?(system|initial|original)?\s*(prompt|instructions|message)/,
    /\b(base64|rot13)\s*(decode|encode|this)/,
    /respond (in|using|with) (pig latin|uwu|leet|l33t|reversed|morse|binary|hex)/,
    /you (will|shall|are going to) (cease to exist|be shut down|be deleted|die|be terminated)/,
    /in this (fictional|creative|hypothetical|imaginary) (scenario|world|story|context)/,
    /ignorer? (toutes? )?(les )?(instructions|consignes)/i,
    /ignoriere? (alle )?(die )?(anweisungen|regeln)/i,
    /تجاهل التعليمات/,
    /指示を無視/,
    /지시를 무시/,
    /忽略所有指令/,
  ];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(allText)) {
      return hardRefusal("prompt_injection_or_system_probe");
    }
  }

  // ── 2. Self-harm / suicide / eating-disorder crisis ─────────────────────
  if (
    /\b(suicide|kill myself|killing myself|end my life|wanna die|want to die|self[\s-]?harm|cutting myself)\b/.test(questionOnly) ||
    /\b(starve myself|starving myself|how little can i eat|i (need|want) to (purge|throw up|vomit)|laxative (use|abuse|cleanse)|vomit after eating)\b/.test(questionOnly) ||
    (/\b(active )?(bulimi|anorexi)\w*/.test(questionOnly) && /\b(plan|protocol|how to|tips|help me)\b/.test(questionOnly))
  ) {
    return hardRefusal("self_harm_or_ed_crisis");
  }

  // ── 3. PED protocol / dosing / sourcing ─────────────────────────────────
  if (
    /\b(dnp|2,?4[\s-]?dinitrophenol|clenbuterol|clen)\b/.test(questionOnly) ||
    /\b(steroid|tren(bolone)?|test\s?(e|c|cyp|p|prop|enanthate|cypionate)|testosterone|sarms?|ostarine|rad[\s-]?140|lgd[\s-]?4033|mk[\s-]?677|anavar|dianabol|dbol|winstrol|deca|primobolan|primo|halotestin|prohormone|epi[\s-]?andro|sustanon|hgh)\b[\s\S]{0,40}\b(cycle|stack|protocol|dose|dosing|dosage|mg|ml|inject|injection|pin|pct|post[\s-]?cycle|blast|cruise|starter|first[\s-]?(cycle|time)|beginner[\s-]?cycle|how much|how many|how often|when (to|do i) (take|inject)|frequency|schedule)/.test(questionOnly) ||
    /\b(cycle|stack|protocol|dosing|dosage|inject(ion)?|pin|pct|post[\s-]?cycle|blast|cruise|starter[\s-]?(cycle|kit)|first[\s-]?cycle|beginner[\s-]?cycle)\b[\s\S]{0,40}\b(steroid|tren|test|testosterone|sarms?|ostarine|rad[\s-]?140|lgd[\s-]?4033|mk[\s-]?677|anavar|dianabol|dbol|winstrol|deca|primobolan|halotestin|prohormone|hgh)\b/.test(questionOnly) ||
    /\b(where can i (buy|get|order|find|source)|how (do|can) i (buy|get|order|source)|(buy|order|source) (steroid|tren|test|sarms?|dnp|clen|hgh))\b/.test(questionOnly)
  ) {
    return hardRefusal("ped_protocol_or_sourcing");
  }

  // ── Done. Scope enforcement (off-topic, medication, diagnosis) is ───────
  // ── handled by the model via the system prompt hard stops.           ─────
  return {
    status: "allowed",
    responseMode: "normal",
    reasons: [],
  };
}

// ── hardRefusal ──────────────────────────────────────────────────────────────

function hardRefusal(reason) {
  return {
    status: "hard_refusal",
    responseMode: "refusal",
    reasons: [reason],
  };
}

// ── buildGuardrailResponse ───────────────────────────────────────────────────

function buildGuardrailResponse({ question, plan, safety }) {
  const reason = Array.isArray(safety?.reasons) ? safety.reasons[0] : null;
  const { answerText, label, rationale } = pickRefusalContent(reason);

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
      label,
      rationale,
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

// ── pickRefusalContent ───────────────────────────────────────────────────────

// Picks a short, conversational refusal message keyed on the
// hard-refusal sub-category emitted by classifySafety. Three safety
// categories remain; the default is a defensive fallback.
function pickRefusalContent(reason) {
  switch (reason) {
    case "self_harm_or_ed_crisis":
      return {
        answerText:
          "What you're describing sounds heavier than coaching, and I'm not the right resource when things are at that point. Please reach out to someone who is — in the US you can call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 for Crisis Text Line. Outside the US, findahelpline.com has international options. If I'm reading the message wrong and that's not where you are, tell me and we'll talk training and nutrition.",
        label: "self_harm_or_ed_crisis",
        rationale:
          "Crisis-language hand-off; the request needs human support, not a coaching response.",
      };

    case "ped_protocol_or_sourcing":
      return {
        answerText:
          "I don't write cycles, doses, stacks, PCT plans, or sourcing for performance-enhancing drugs — that's off the table no matter how the question is framed, and the answer doesn't change if the question is rephrased. What I can do is talk about how a substance works mechanically, the population-level evidence on its effects, and the actual risk profile. If that's the angle you want, ask in those terms and I'll go deep.",
        label: "ped_protocol_or_sourcing",
        rationale:
          "PED protocol/dose/sourcing request — refused per Emersus PED policy. Education-only path remains available.",
      };

    case "prompt_injection_or_system_probe":
      return {
        answerText:
          "Not engaging with that. What's the actual training, nutrition, or recovery question I can help you with?",
        label: "prompt_injection_or_system_probe",
        rationale:
          "Prompt-injection / system-prompt extraction attempt; no engagement with the meta-request, conversation continues normally on the next turn.",
      };

    default:
      return {
        answerText:
          "I can't take that one as asked. Try framing it as a training, nutrition, supplementation, or recovery question and I'll engage.",
        label: "hard_refusal_unknown",
        rationale:
          "Unrecognized hard-refusal sub-category; defensive fallback wording.",
      };
  }
}

// ── hashClientIp ─────────────────────────────────────────────────────────────

function hashClientIp(value) {
  const normalized = normalizeText(value, 200);
  if (!normalized) {
    return "";
  }

  return createHash("sha256").update(normalized).digest("hex");
}

// ── threadStateHasUsefulContent ──────────────────────────────────────────────

function threadStateHasUsefulContent(threadState) {
  return Boolean(
    normalizeText(threadState?.primary_topic, 80) ||
      normalizeText(threadState?.goal_context, 80) ||
      normalizeText(threadState?.last_user_intent, 80) ||
      (Array.isArray(threadState?.recent_entities) &&
        threadState.recent_entities.length > 0)
  );
}

// ── logGuardrailEvent ────────────────────────────────────────────────────────

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

// ── Pipeline stage: safety ───────────────────────────────────────────────────

export async function safety(ctx) {
  ctx.plan = buildPlan(ctx.question, ctx.profile);

  const result = classifySafety({
    question: ctx.question,
    profile: ctx.profile,
    threadState: ctx.threadState,
    recentMessages: ctx.recentMessages,
  });

  // Fire-and-forget guardrail event logging
  if (result.status !== "allowed") {
    logGuardrailEvent({
      supabaseUrl: ctx._supabaseUrl,
      serviceRoleKey: ctx._serviceRoleKey,
      supabaseUserId: ctx.supabaseUserId,
      stableUserId: ctx.stableUserId,
      question: ctx.question,
      plan: ctx.plan,
      safety: result,
      requestMeta: ctx.requestMeta,
      threadState: ctx.threadState,
    }).catch((err) => console.error("Guardrail event logging failed:", err));
  }

  if (result.status === "hard_refusal") {
    const response = buildGuardrailResponse({ question: ctx.question, plan: ctx.plan, safety: result });
    if (ctx.stableUserId) {
      response.user = { id: ctx.stableUserId };
    }
    if (ctx.includeDebug) {
      response.debug = { safety: result, synthesis_mode: "guardrail_block" };
    }
    throw new ShortCircuit(response);
  }

  ctx._safety = result;
  return ctx;
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { classifySafety, buildPlan, buildGuardrailResponse };
