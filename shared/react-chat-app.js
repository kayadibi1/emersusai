import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  History,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
} from "lucide-react";
import {
  applyWorkoutPlanUpdate,
  getChatThread,
  getProfile,
  getSession,
  listChatThreadSummaries,
  requireAuth,
  saveNewWorkoutPlan,
  setStatus,
  upsertChatThread,
} from "/shared/supabase.js";
import { createThinkingGlyph } from "/shared/thinking-glyph.js";
import { localDateStr } from "/shared/date-utils.js";
import {
  WidgetFrame,
  hasWidgetFences,
  parseLLMOutput,
  stripWidgetFencesForStreaming,
} from "/shared/emersus-renderer.js?v=2026-04-09-liquid-glass";
import {
  DAY_LABELS,
  summarizePlan,
} from "/shared/workout-plan-schema.js";
import {
  MealCard,
  SupplementStack,
  TargetCard,
  SLOT_ORDER,
} from "/shared/meal-plan-widget.js";
import {
  MEAL_SLOT_LABELS,
  ResolvedRow,
  UnresolvedRow,
} from "/shared/nutrition-log-confirm-widget.js";
import { downloadPlanIcs } from "/shared/workout-plan-ics.js";
import { summarizePlanDiff } from "/shared/workout-plan-diff.js";
import {
  formatCitationLabel,
  formatCitationUrl,
} from "/shared/citation-format.js";
import { resolveFlag } from "/shared/feature-flags.js";
import { ChatTopBar } from "/shared/chat/top-bar.js";
import { MessageActions } from "/shared/chat/message-actions.js";
import { ShareModal as ChatShareModal } from "/shared/chat/share-modal.js";
import { buildFollowUpPrompt, citationLinks } from "/shared/chat/widget-footers.js";
import { EmptyPrompts } from "/shared/chat/empty-prompts.js";
import { groupThreadsByDate, filterThreadsBySearch, GROUP_ORDER } from "/shared/chat/sidebar-helpers.js";
import { bindSwitcher } from "/shared/theme.js";

const h = React.createElement;
const MAX_HISTORY_ITEMS = 24;
const DEFAULT_VISIBLE_MESSAGE_COUNT = 40;
const VISIBLE_MESSAGE_COUNT_STEP = 40;

function normalizeText(value, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trimSnippet(value, maxLength = 180) {
  const text = normalizeText(value, maxLength + 1);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function titleCase(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unwrapHtmlFence(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:html)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : text;
}

// ---------------------------------------------------------------------------
// SSE stream reader
// ---------------------------------------------------------------------------
// Reads an SSE (text/event-stream) response body and fires `onEvent` for each
// parsed `data: {...}` line. Handles buffering across chunk boundaries and
// ignores malformed frames. Used by submitQuestion when the backend streams
// prose + tool results instead of returning a single JSON blob.
async function readSSEStream(response, { onEvent, signal }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;
        try { onEvent(JSON.parse(payload)); } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function looksLikeStructuredHtml(value) {
  const text = unwrapHtmlFence(value);
  if (!text) return false;
  if (/<style[\s>]/i.test(text)) return true;
  return /<(section|article|main|header|footer|div|table|h1|h2|h3|h4|p|ul|ol)\b/i.test(text);
}

function sanitizeAssistantHtml(value) {
  const raw = unwrapHtmlFence(value);
  if (!raw) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");

  doc
    .querySelectorAll("script, iframe, object, embed, form, meta[http-equiv='refresh']")
    .forEach((node) => node.remove());

  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const attributeValue = String(attribute.value || "");
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(attributeValue)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        name === "style" &&
        /(expression\s*\(|url\s*\(\s*['"]?\s*javascript:)/i.test(attributeValue)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return (doc.body?.innerHTML || "").trim();
}

function stripHtmlToPlainText(value, maxLength = 4000) {
  const html = String(value || "");
  if (!html.trim()) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,noscript,template").forEach((node) => node.remove());
  return normalizeText(doc.body?.textContent || "", maxLength);
}

function sanitizeHistoryText(value, maxLength = 120) {
  const text = normalizeText(value, maxLength * 3)
    .replace(/[.#][a-zA-Z0-9_-]+\s*\{[^}]*\}/g, " ")
    .replace(/\b[a-z-]+\s*:\s*[^;]+;/gi, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeText(text, maxLength);
}

function normalizeCompactList(values, maxItems = 6, maxLength = 80) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value, maxLength))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, maxItems);
}

function toneClass(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong", "success", "done"].includes(normalized)) return "is-good";
  if (["medium", "moderate", "running"].includes(normalized)) return "is-medium";
  if (["caution", "low", "weak", "error"].includes(normalized)) return "is-caution";
  return "";
}

function toneWeight(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong", "success", "done"].includes(normalized)) return 0.88;
  if (["medium", "moderate", "running"].includes(normalized)) return 0.66;
  if (["caution", "low", "weak", "error"].includes(normalized)) return 0.42;
  return 0.56;
}

function getDisplayName(session) {
  return (
    session?.user?.user_metadata?.display_name ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split("@")[0] ||
    "there"
  );
}

function createThreadId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function createEmptyThreadState() {
  return {
    version: 1,
    primary_topic: "",
    secondary_topics: [],
    goal_context: "",
    question_mode: "",
    recent_entities: [],
    comparison_target: "",
    population_context: [],
    constraints: {
      dietary: [],
      injury: [],
      equipment: [],
      schedule: [],
      sleep_stress: [],
      medical_caution: [],
    },
    last_user_intent: "",
    last_answer_summary: "",
    thread_summary: "",
    // When set, generateRecommendation loads the plan from Supabase and
    // feeds it to the model as current_workout_plan so Emersus can reason
    // about adjustments like "I missed Friday". Stamped when the user
    // clicks Save on a WorkoutPlanCard, or when the chat page is opened
    // from /app/workout/ with ?open_plan=<id>.
    active_workout_plan_id: "",
    token_usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      requests: 0,
      last_updated_at: "",
    },
    updated_at: "",
  };
}

function normalizeTokenUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  const promptTokens = Math.max(0, Number(usage.prompt_tokens || 0));
  const completionTokens = Math.max(0, Number(usage.completion_tokens || 0));
  const totalTokensRaw = Number(usage.total_tokens || promptTokens + completionTokens);
  const totalTokens = Math.max(0, Number.isFinite(totalTokensRaw) ? totalTokensRaw : promptTokens + completionTokens);
  const requests = Math.max(0, Number(usage.requests || 0));
  return {
    prompt_tokens: Math.round(promptTokens),
    completion_tokens: Math.round(completionTokens),
    total_tokens: Math.round(totalTokens),
    requests: Math.round(requests),
    last_updated_at: normalizeText(usage.last_updated_at || "", 60),
  };
}

function mergeTokenUsage(baseValue, nextValue) {
  const base = normalizeTokenUsage(baseValue);
  const next = normalizeTokenUsage(nextValue);
  return {
    prompt_tokens: base.prompt_tokens + next.prompt_tokens,
    completion_tokens: base.completion_tokens + next.completion_tokens,
    total_tokens: base.total_tokens + next.total_tokens,
    requests: base.requests + (next.total_tokens > 0 ? 1 : 0),
    last_updated_at: new Date().toISOString(),
  };
}

function mergeThreadState(rawState) {
  const base = createEmptyThreadState();
  const incoming = rawState && typeof rawState === "object" ? rawState : {};
  return {
    ...base,
    ...incoming,
    secondary_topics: normalizeCompactList(incoming.secondary_topics, 4),
    recent_entities: normalizeCompactList(incoming.recent_entities, 8),
    population_context: normalizeCompactList(incoming.population_context, 4),
    constraints: {
      ...base.constraints,
      ...(incoming.constraints && typeof incoming.constraints === "object" ? incoming.constraints : {}),
      dietary: normalizeCompactList(incoming?.constraints?.dietary, 4),
      injury: normalizeCompactList(incoming?.constraints?.injury, 4),
      equipment: normalizeCompactList(incoming?.constraints?.equipment, 4),
      schedule: normalizeCompactList(incoming?.constraints?.schedule, 4),
      sleep_stress: normalizeCompactList(incoming?.constraints?.sleep_stress, 4),
      medical_caution: normalizeCompactList(incoming?.constraints?.medical_caution, 4),
    },
    token_usage: normalizeTokenUsage(incoming?.token_usage),
  };
}

function createEmptyThread() {
  return {
    id: createThreadId(),
    title: "New chat",
    preview: "No messages yet",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    sources: [],
    rail: {},
    threadState: createEmptyThreadState(),
    isHydrated: true,
    isHydrating: false,
  };
}

function questionLooksLikeFollowUp(question) {
  const q = String(question || "").trim();
  // Explicit follow-up phrases
  if (/^(yes|yeah|yep|sure|please|do that|that one|sounds good|ok|okay|what about|how about|and for|compare that|compare it|does that|would that|what if|and if|for women|for men|for older adults|for beginners|for me)\b/i.test(q)) return true;
  // Short messages that are mostly numbers + body-metric terms (responding to a profile gate)
  if (/\d/.test(q) && q.split(/\s+/).length <= 10 && /\b(kg|lbs?|cm|ft|male|female|sedentary|light|moderate|active|low)\b/i.test(q)) return true;
  return false;
}

function questionLooksLikeAffirmation(question) {
  return /^(yes|yeah|yep|sure|please|do that|that one|sounds good|ok|okay)\b/i.test(
    String(question || "").trim()
  );
}

function matchPrimaryTopic(text) {
  const topicMatchers = [
    [/bpc[-\s]?157|body protection compound/, "BPC-157"],
    [/thymosin beta[-\s]?4|tb[-\s]?500|tb500/, "thymosin beta-4"],
    [/collagen peptide|hydrolyzed collagen|gelatin/, "collagen peptides"],
    [/bioactive peptide/, "bioactive peptides"],
    [/glp[-\s]?1|semaglutide|liraglutide|tirzepatide/, "GLP-1 peptides"],
    [/growth hormone releasing|ghrp|cjc[-\s]?1295|ipamorelin|tesamorelin|ghrelin|secretagogue/, "growth hormone peptides"],
    [/\bpeptide\b|\bpeptides\b/, "peptides"],
    [/creatine/, "creatine"],
    [/beta[-\s]?alanine/, "beta-alanine"],
    [/protein|whey|casein|amino acid|bcaa|eaa/, "protein"],
    [/caffeine/, "caffeine"],
    [/study|studying|learn|learning|exam|homework|memorization|flashcard|test prep|school/, "studying"],
    [/sleep|circadian/, "sleep"],
    [/zone 2|endurance|running|cardio|interval|hiit|vo2/, "endurance"],
    [/hypertrophy|muscle gain|build muscle/, "hypertrophy"],
    [/fat loss|cutting|weight loss|caloric deficit/, "fat loss"],
    [/safe|safety|risk|harm|side effect|contraindication|adverse/, "safety"],
    [/dose|dosage|duration|protocol|loading phase|maintenance/, "protocol"],
    [/recovery|soreness|rehab|tendon|joint|injury/, "recovery"],
    [/meal[\s-]?plan|diet[\s-]?plan|nutrition[\s-]?plan|eating[\s-]?plan|macros for|what should i eat|tdee|bmr|mifflin/, "meal_plan"],
    [/\b(diet|nutrition|calori|meal prep|bulk|cut|recomp|deficit|surplus)\b/, "nutrition"],
  ];
  for (const [pattern, topic] of topicMatchers) {
    if (pattern.test(text)) return topic;
  }
  return "";
}

function inferPrimaryTopic(question, previousTopic = "") {
  const text = String(question || "").toLowerCase();
  if (!text) return previousTopic || "";
  if (questionLooksLikeAffirmation(question)) return "";

  const explicitTopic = matchPrimaryTopic(text);
  if (explicitTopic) return explicitTopic;

  if (questionLooksLikeFollowUp(question) && previousTopic) {
    return previousTopic;
  }

  return "";
}

function inferGoalContext(question, previousGoal = "") {
  const text = String(question || "").toLowerCase();
  if (/hypertrophy|muscle gain|build muscle|lean mass/.test(text)) return "hypertrophy";
  if (/fat loss|cutting|lose fat|weight loss|deficit/.test(text)) return "fat_loss";
  if (/vo2|endurance|running|cardio|zone 2|aerobic/.test(text)) return "endurance";
  if (/recovery|soreness|sleep|stress/.test(text)) return "recovery";
  if (/safe|safety|risk|harm|side effect|contraindication|adverse/.test(text)) return "safety";
  if (/dose|dosage|duration|protocol|loading phase|maintenance/.test(text)) return "protocol";
  if (questionLooksLikeAffirmation(question)) return "";
  return questionLooksLikeFollowUp(question) ? previousGoal || "" : "";
}

function inferQuestionMode(question) {
  const text = String(question || "").toLowerCase();
  if (questionLooksLikeAffirmation(question)) return "confirmation";
  if (/\bcompare\b|\bversus\b|\bvs\b/.test(text)) return "comparison";
  if (/what should i do|how should i|plan|schedule|dose|dosage|program/.test(text)) return "action_plan";
  if (/for women|for men|for me|if i'm|if i am|what about/.test(text)) return "personalization";
  if (/safe|safety|risk|harm|side effect|contraindication/.test(text)) return "safety";
  return "evidence";
}

function extractComparisonTarget(question) {
  const text = String(question || "");
  const match =
    text.match(/\b(?:compare|versus|vs\.?)\s+([a-z0-9][a-z0-9\s-]{1,50})/i) ||
    text.match(/\bhow does .* compare to\s+([a-z0-9][a-z0-9\s-]{1,50})/i);
  return normalizeText(match?.[1] || "", 60).replace(/[?.!,;:]+$/, "");
}

function extractPopulationContext(question) {
  const text = String(question || "").toLowerCase();
  const populations = [];
  if (/\bwomen\b|\bfemale\b/.test(text)) populations.push("women");
  if (/\bmen\b|\bmale\b/.test(text)) populations.push("men");
  if (/older adults|elderly|aging/.test(text)) populations.push("older adults");
  if (/beginner|novice/.test(text)) populations.push("beginners");
  if (/athlete|trained|resistance-trained/.test(text)) populations.push("trained adults");
  return normalizeCompactList(populations, 3, 50);
}

function deriveThreadState(threadData, question = "", answerSummary = "") {
  const previous = mergeThreadState(threadData?.threadState);
  const isAffirmation = questionLooksLikeAffirmation(question);
  const isFollowUp = questionLooksLikeFollowUp(question) && !isAffirmation;
  const primaryTopic = inferPrimaryTopic(question, previous.primary_topic);
  const comparisonTarget = extractComparisonTarget(question) || "";
  const populationContext = extractPopulationContext(question);
  const questionMode = inferQuestionMode(question);
  const nextState = mergeThreadState({
    ...previous,
    primary_topic: primaryTopic,
    secondary_topics: normalizeCompactList([
      ...(isFollowUp ? previous.secondary_topics : []),
      isFollowUp && previous.goal_context ? previous.goal_context.replace(/_/g, " ") : "",
      comparisonTarget,
      ...populationContext,
    ], 4, 60),
    goal_context: inferGoalContext(question, previous.goal_context),
    question_mode: questionMode,
    recent_entities: normalizeCompactList([primaryTopic, comparisonTarget, ...populationContext], 8, 60),
    comparison_target: questionMode === "comparison" ? comparisonTarget || previous.comparison_target : "",
    population_context: populationContext.length > 0 ? populationContext : isFollowUp ? previous.population_context : [],
    last_user_intent:
      questionMode === "confirmation"
        ? "confirming the immediately previous assistant offer"
        : questionMode === "comparison"
          ? `asking for a comparison related to ${primaryTopic || "the current topic"}`
          : `asking about ${normalizeText(question, 150)}`,
    last_answer_summary: normalizeText(answerSummary, 220) || previous.last_answer_summary,
    updated_at: new Date().toISOString(),
  });
  const summaryParts = [];
  if (nextState.primary_topic) summaryParts.push(`This thread is about ${nextState.primary_topic}`);
  if (nextState.goal_context) summaryParts.push(`with a ${nextState.goal_context.replace(/_/g, " ")} goal`);
  if (nextState.population_context.length) summaryParts.push(`focused on ${nextState.population_context.join(", ")}`);
  nextState.thread_summary = summaryParts.length ? `${summaryParts.join(" ")}.` : "";
  return nextState;
}

function buildRecentMessages(messages, maxItems = 6) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-maxItems)
    .map((message) => ({
      role: normalizeText(message?.role, 24),
      text: normalizeText(readMessageText(message), 320),
    }))
    .filter((message) => message.role && message.text);
}

function buildAssistantBlocks(data) {
  // Preserve newlines so widget fences and paragraph boundaries survive into
  // parseLLMOutput / renderProseChunks. normalizeText collapses \s+ to single
  // spaces, which would flatten multi-paragraph prose and remove the newlines
  // that separate widget fences from surrounding prose.
  //
  // DO NOT slice this text. A typical comparison-widget answer is ~4â€“7k chars
  // (prose + an HTML widget body with inline styles). The previous .slice(0,
  // 4000) was lopping the closing ``` off the widget fence, which made
  // hasWidgetFences() return false on the rendering side and caused the raw
  // ```widget <div...> markup to be displayed as literal prose. The model's
  // max_output_tokens is 2800 (~11k chars worst case), so we cap at a value
  // that comfortably accommodates the largest possible model output instead.
  const primaryText = String(
    data.answer_text || data.summary || "Here is the plain-language answer before the visual."
  )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 32000);
  const blocks = [{ type: "text", text: primaryText }];
  (Array.isArray(data.cards) ? data.cards : []).forEach((card) => {
    if (card && typeof card === "object") {
      blocks.push({ type: "tool_result", tool: "insight_card", data: card });
    }
  });
  return blocks;
}

function formatHistoryTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function deriveThreadTitle(threadData) {
  const firstUserMessage = (threadData?.messages || []).find((message) => message.role === "user");
  const source = sanitizeHistoryText(readMessageText(firstUserMessage), 80);
  if (!source) return "New chat";
  return source.length > 42 ? `${source.slice(0, 41).trim()}...` : source;
}

function deriveThreadPreview(threadData) {
  const latestAssistant = [...(threadData?.messages || [])].reverse().find((message) => message.role === "assistant");
  const fallback = (threadData?.messages || []).find((message) => message.role === "user");
  const source = sanitizeHistoryText(
    readMessageText(latestAssistant) || readMessageText(fallback),
    80
  );
  if (!source) return "No messages yet";
  return source.length > 52 ? `${source.slice(0, 51).trim()}...` : source;
}

function readMessageText(message) {
  return String(message?.text || message?.plainText || "");
}

function normalizeMessageRecord(message) {
  if (!message || typeof message !== "object") return message;
  const text = typeof message.text === "string" ? message.text : "";
  const plainText = typeof message.plainText === "string" ? message.plainText : "";
  if (!plainText) {
    if (!("plainText" in message)) return message;
    const nextMessage = { ...message };
    delete nextMessage.plainText;
    return nextMessage;
  }
  const nextMessage = { ...message };
  if (!text) {
    nextMessage.text = plainText;
  }
  if (nextMessage.text === plainText) {
    delete nextMessage.plainText;
  }
  return nextMessage;
}

function normalizeMessageRecords(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let changed = false;
  const nextMessages = list.map((message) => {
    const normalized = normalizeMessageRecord(message);
    if (normalized !== message) changed = true;
    return normalized;
  });
  return changed ? nextMessages : list;
}

function dehydrateThreadForHistory(thread) {
  if (!thread || typeof thread !== "object" || thread.isHydrated === false) {
    return thread;
  }
  return {
    id: thread.id,
    title: thread.title || "New chat",
    preview: thread.preview || deriveThreadPreview(thread),
    createdAt: thread.createdAt || new Date().toISOString(),
    updatedAt: thread.updatedAt || thread.createdAt || new Date().toISOString(),
    messages: [],
    sources: [],
    rail: {},
    threadState: createEmptyThreadState(),
    isHydrated: false,
    isHydrating: false,
  };
}

function mapSavedThread(row) {
  const hasMessages = Array.isArray(row.messages);
  const normalizedThreadState = mergeThreadState(row.thread_state);
  const usage = normalizeTokenUsage(normalizedThreadState?.token_usage);
  const normalizedMessages = hasMessages ? normalizeMessageRecords(row.messages) : [];
  return {
    id: row.id,
    title: row.title || "New chat",
    preview: row.preview || "No messages yet",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: normalizedMessages,
    sources: Array.isArray(row.sources) ? row.sources : [],
    rail: {
      ...(row.rail && typeof row.rail === "object" ? row.rail : {}),
      tokenUsage: usage,
      totalTokens: usage.total_tokens,
      requestCount: usage.requests,
    },
    threadState: normalizedThreadState,
    isHydrated: hasMessages,
    isHydrating: false,
  };
}

function mergeThreadIntoHistory(history, nextThread, { promote = false } = {}) {
  const list = Array.isArray(history) ? history : [];
  const existingIndex = list.findIndex((thread) => thread.id === nextThread.id);
  if (promote) {
    return [nextThread, ...list.filter((thread) => thread.id !== nextThread.id)].slice(0, MAX_HISTORY_ITEMS);
  }
  if (existingIndex === -1) {
    return [nextThread, ...list].slice(0, MAX_HISTORY_ITEMS);
  }
  const nextHistory = [...list];
  nextHistory[existingIndex] = nextThread;
  return nextHistory;
}

function patchThreadInHistory(history, threadId, updater) {
  return (Array.isArray(history) ? history : []).map((thread) => {
    if (thread.id !== threadId) return thread;
    return updater(thread);
  });
}

function updateStreamingAssistantText(history, threadId, createdAt, nextText) {
  return patchThreadInHistory(history, threadId, (thread) => {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const lastIdx = messages.length - 1;
    if (lastIdx < 0) return thread;
    const lastMessage = messages[lastIdx];
    if (lastMessage.role !== "assistant" || lastMessage.createdAt !== createdAt) {
      return thread;
    }
    if (readMessageText(lastMessage) === nextText) {
      return thread;
    }
    const nextMessages = [...messages];
    nextMessages[lastIdx] = normalizeMessageRecord({
      ...lastMessage,
      text: nextText,
      plainText: nextText,
    });
    return { ...thread, messages: nextMessages };
  });
}

function normalizeConfidence(confidence) {
  if (typeof confidence === "number") {
    const score = Math.max(0, Math.min(confidence, 1));
    return {
      score,
      label: score >= 0.75 ? "high" : score >= 0.5 ? "moderate" : score > 0 ? "low" : "idle",
    };
  }

  if (confidence && typeof confidence === "object") {
    const rawScore = Number(confidence.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(rawScore, 1)) : 0;
    const rawLabel = normalizeText(confidence.label || "", 24).toLowerCase();
    return {
      score,
      label: rawLabel || (score >= 0.75 ? "high" : score >= 0.5 ? "moderate" : score > 0 ? "low" : "idle"),
    };
  }

  return { score: 0, label: "idle" };
}

function railFromData(data = {}) {
  const normalizedConfidence = normalizeConfidence(data.confidence);
  const confidenceScore = normalizedConfidence.score;
  const confidenceLabel = normalizedConfidence.label;
  const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
  const synthesisMode = data.summary ? "synthesized" : "idle";
  const confidencePercent = Math.round(Math.max(0, Math.min(confidenceScore, 1)) * 100);
  const tokenUsage = normalizeTokenUsage(data.token_usage);
  return {
    confidenceScore,
    confidencePercent,
    confidenceLabel,
    sourceCount,
    synthesisMode,
    tokenUsage,
    totalTokens: tokenUsage.total_tokens,
    requestCount: tokenUsage.total_tokens > 0 ? 1 : 0,
  };
}

function StatusBadge({ status = "Done", isError = false, isRunning = false }) {
  const Icon = isError ? CircleAlert : CheckCircle2;
  const label = isRunning ? "Running" : isError ? "Error" : normalizeText(status || "Done", 18);
  return h(
    "span",
    { className: `chat-tool-status ${toneClass(isError ? "error" : status)}`.trim() },
    h(Icon, { className: "chat-tool-status-icon", size: 15, "aria-hidden": true }),
    h("span", { className: "chat-tool-status-label" }, label)
  );
}

function ToolCard({ tool = "insight_card", title = "", subtitle = "", status = "Done", children, bodyClass = "" }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = tool === "sources_card" ? Library : tool === "search" ? Search : tool === "metrics_card" ? Activity : FlaskConical;
  return h(
    "section",
    { className: `chat-card chat-tool-card${expanded ? "" : " is-collapsed"}` },
    h(
      "div",
      {
        className: "chat-tool-header",
        role: "button",
        tabIndex: 0,
        onClick: () => setExpanded((value) => !value),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        },
      },
      h(
        "div",
        { className: "chat-tool-header-left" },
        h("button", {
          type: "button",
          className: "chat-tool-toggle",
          "aria-expanded": expanded,
          "aria-label": expanded ? "Collapse card" : "Expand card",
          onClick: (event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          },
        }, expanded ? h(ChevronDown, { size: 18 }) : h(ChevronRight, { size: 18 })),
        h(Icon, { className: "chat-tool-icon", size: 17, "aria-hidden": true }),
        h(
          "div",
          { className: "chat-tool-title-group" },
          h("strong", { className: "chat-tool-title" }, normalizeText(title || "Evidence card", 60)),
          subtitle || tool === "sources_card"
            ? h(
                "span",
                { className: "chat-tool-subtitle" },
                subtitle || (tool === "sources_card" ? "Sources" : ""),
              )
            : null,
        )
      ),
      h(StatusBadge, { status })
    ),
    expanded ? h("div", { className: `chat-card-body chat-tool-body${bodyClass ? ` ${bodyClass}` : ""}` }, children) : null
  );
}

function useTypewriter(fullText, enabled, charsPerTick = 3, intervalMs = 18) {
  const [visible, setVisible] = useState(enabled ? "" : fullText);
  useEffect(() => {
    if (!enabled) {
      setVisible(fullText);
      return undefined;
    }
    // Background-tab fix: Chromium throttles setInterval to 1Hz (or
    // stops it entirely after ~5 min of aggressive throttling) in
    // background tabs, which means a normal-length response would take
    // 5+ minutes to "type out" once the user came back â€” or appear to
    // never load at all if the throttling escalated. The typewriter is
    // purely cosmetic; there's no reason to animate text the user can't
    // see. When the tab is hidden, skip the animation entirely and
    // render the full text immediately. If the tab becomes hidden
    // mid-animation, flush to full text so the user returns to a
    // completed message instead of a half-typed one.
    if (typeof document !== "undefined" && document.hidden) {
      setVisible(fullText);
      return undefined;
    }
    setVisible("");
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(fullText.length, i + charsPerTick);
      setVisible(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(id);
    }, intervalMs);
    function onVisibilityChange() {
      if (typeof document !== "undefined" && document.hidden) {
        clearInterval(id);
        setVisible(fullText);
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [fullText, enabled, charsPerTick, intervalMs]);
  return visible;
}

// Tokenize an inline chunk into an array of React children, honoring basic
// markdown: **bold**, *italic* / _italic_, `inline code`. We do NOT run a full
// markdown pass â€” no links, no headings, no block quotes â€” because the model
// rarely produces them in prose and full parsing opens us up to edge cases.
// The tokenizer walks left-to-right and treats the earliest matching delimiter
// as the real one, so nested runs fall back to whichever pattern hit first.
function renderInlineMarkdown(source) {
  const text = String(source || "");
  if (!text) return [];
  // Order matters: ** before *, ` stays separate.
  const patterns = [
    { re: /\*\*([^*]+?)\*\*/, tag: "strong" },
    { re: /__([^_]+?)__/, tag: "strong" },
    { re: /(?<![A-Za-z0-9*])\*([^*\n]+?)\*(?![A-Za-z0-9*])/, tag: "em" },
    { re: /(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/, tag: "em" },
    { re: /`([^`]+?)`/, tag: "code" },
  ];
  const out = [];
  let rest = text;
  let key = 0;
  // Hard cap to avoid any accidental infinite loop if a pattern ever matches
  // a zero-width slice.
  for (let guard = 0; guard < 1000 && rest.length; guard += 1) {
    let best = null;
    for (const pat of patterns) {
      const m = rest.match(pat.re);
      if (m && (!best || m.index < best.m.index)) {
        best = { pat, m };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) {
      out.push(rest.slice(0, best.m.index));
    }
    out.push(h(best.pat.tag, { key: `im-${key++}` }, best.m[1]));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// Render the inner prose chunks (paragraphs + bullet lists) of one text
// segment. Used both by the streaming path (single bubble around the visible
// substring) and the segment path (one bubble per text segment between
// inline widgets).
function renderProseChunks(text) {
  const chunks = String(text || "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk, chunkIndex) => {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^(?:[-*]|\u2022)\s+/.test(line));
    const proseLines = lines.filter((line) => !/^(?:[-*]|\u2022)\s+/.test(line));
    return h(
      React.Fragment,
      { key: chunkIndex },
      proseLines.length ? h("p", null, ...renderInlineMarkdown(proseLines.join(" "))) : null,
      bulletLines.length
        ? h("ul", null, bulletLines.map((line, lineIndex) => h(
            "li",
            { key: lineIndex },
            ...renderInlineMarkdown(line.replace(/^(?:[-*]|\u2022)\s+/, "")),
          )))
        : null
    );
  });
}

// Window-level ref set by ChatApp so WorkoutPlanCard can tell the chat
// "a plan was saved, stamp active_workout_plan_id on the current thread".
// Follows the same ref-passthrough pattern submitQuestionRef uses for the
// iframe sendPrompt bridge â€” avoids drilling an onSave prop through
// Message â†’ MessageBlocks â†’ TextBlock â†’ WorkoutPlanCard.
const workoutPlanActionRef = { current: null };

function WorkoutPlanCard({ segment, threadId }) {
  const parseResult = segment && segment.content;
  const plan = parseResult && parseResult.ok ? parseResult.plan : null;

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  // Once the user clicks "Save plan" / "Apply update" / "Discard", we hide
  // the primary CTAs so the card doesn't offer a stale action. Download
  // stays available â€” the user might want the .ics after saving too.
  const [resolved, setResolved] = useState("");

  if (!parseResult) {
    return h(
      "div",
      { className: "chat-bubble chat-bubble-assistant chat-text-block" },
      "Workout plan missing."
    );
  }
  if (!parseResult.ok) {
    // Truncation is its own case: the model hit max_output_tokens before
    // it could close the fence. Show a "retry" affordance instead of the
    // raw parse error + JSON dump, which is useless to the user.
    if (parseResult.truncated) {
      return h(
        "div",
        {
          style: {
            background: "var(--color-background-warning, rgba(255,196,102,0.10))",
            border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
            borderRadius: "var(--border-radius-lg, 14px)",
            padding: 16,
            margin: "10px 0",
            color: "var(--color-text-warning, #ffd57a)",
          },
        },
        h(
          "div",
          { style: { fontWeight: 500, fontSize: 13, marginBottom: 6 } },
          "Plan was cut off before finishing."
        ),
        h(
          "div",
          { style: { fontSize: 12, lineHeight: 1.5 } },
          "The model hit its output limit while writing your plan. Ask again, or ask for a shorter plan (e.g. \"4 weeks instead of 8\") to stay under the budget."
        )
      );
    }
    return h(
      "div",
      { className: "chat-bubble chat-bubble-assistant chat-text-block" },
      h(
        "div",
        { style: { color: "var(--color-text-danger, #ff6b6b)" } },
        `Workout plan could not be parsed: ${parseResult.error || "invalid JSON"}`
      ),
      h(
        "pre",
        {
          style: {
            whiteSpace: "pre-wrap",
            fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            color: "var(--color-text-tertiary, #3a3a3a)",
            marginTop: 8,
            maxHeight: 120,
            overflow: "auto",
          },
        },
        String(parseResult.raw || "").slice(0, 800)
      )
    );
  }

  const isUpdate = Boolean(plan.updates_plan_id);
  const summary = summarizePlan(plan);
  // Week-1 sessions become the card preview. If the plan only has 1 week
  // we show all of it; otherwise week 1 is enough to signal the structure.
  const previewSessions = (plan.sessions || [])
    .filter((s) => Number(s.week) === 1)
    .slice(0, 7);

  async function handleSave() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const session = await getSession();
      if (!session?.user?.id) {
        throw new Error("Sign in to save this plan.");
      }
      const saved = await saveNewWorkoutPlan(session.user.id, plan, {
        sourceThreadId: threadId || null,
      });
      if (workoutPlanActionRef.current) {
        workoutPlanActionRef.current({ type: "saved", planId: saved.id });
      }
      setToast("Plan saved. Open it in the workout planner anytime.");
      setResolved("saved");
    } catch (err) {
      setError(String(err?.message || err) || "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyUpdate() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const session = await getSession();
      if (!session?.user?.id) {
        throw new Error("Sign in to apply this update.");
      }
      await applyWorkoutPlanUpdate(session.user.id, plan.updates_plan_id, plan);
      if (workoutPlanActionRef.current) {
        workoutPlanActionRef.current({ type: "updated", planId: plan.updates_plan_id });
      }
      setToast("Plan updated.");
      setResolved("updated");
    } catch (err) {
      setError(String(err?.message || err) || "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleDiscard() {
    setResolved("discarded");
    setToast("Update discarded.");
  }

  function handleDownload() {
    try {
      downloadPlanIcs(plan);
      setToast("ICS download started â€” works with Google, Apple, and Outlook.");
    } catch (err) {
      setError(String(err?.message || err) || "Could not generate .ics.");
    }
  }

  // Diff preview for update cards: we don't have the previous plan state
  // directly in the chat message, but the card still shows a sensible
  // count based on the sessions the model is sending. For a richer diff
  // the user clicks through to /app/workout/<id> where the server has
  // both old and new.
  let diffLines = [];
  if (isUpdate) {
    // We rely on segment.previousPlanHint being set by TextBlock; if we
    // don't have it, show a generic label.
    const prev = segment.previousPlanHint;
    if (prev) {
      diffLines = summarizePlanDiff(plan, prev);
    }
  }

  const style = {
    card: {
      background: "var(--color-background-secondary, rgba(255,255,255,0.03))",
      border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
      borderRadius: "var(--border-radius-lg, 14px)",
      padding: 18,
      margin: "10px 0",
    },
    header: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 },
    title: { fontSize: 15, fontWeight: 500, color: "var(--color-text-primary, #e8e8e8)" },
    subtitle: { fontSize: 12, color: "var(--color-text-secondary, #666)" },
    chip: {
      display: "inline-block",
      fontSize: 11,
      fontWeight: 500,
      padding: "3px 8px",
      borderRadius: "var(--border-radius-sm, 4px)",
      background: isUpdate
        ? "var(--color-background-info, rgba(120,220,20,0.08))"
        : "var(--color-background-success, rgba(120,220,20,0.10))",
      color: isUpdate
        ? "var(--color-text-info, #78dc14)"
        : "var(--color-text-success, #78dc14)",
      marginTop: 4,
      width: "fit-content",
    },
    meta: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #3a3a3a)",
      marginTop: 2,
    },
    sessionsWrap: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      margin: "12px 0 14px",
      paddingTop: 10,
      borderTop: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
    },
    sessionRow: {
      display: "grid",
      gridTemplateColumns: "52px 1fr auto",
      gap: 10,
      fontSize: 12,
      alignItems: "baseline",
      color: "var(--color-text-primary, #e8e8e8)",
    },
    sessionDay: {
      fontSize: 11,
      color: "var(--color-text-secondary, #666)",
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
    sessionDuration: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #3a3a3a)",
    },
    moreHint: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #3a3a3a)",
      marginTop: 2,
    },
    diffWrap: {
      fontSize: 11,
      color: "var(--color-text-secondary, #666)",
      marginBottom: 10,
      padding: "8px 10px",
      background: "var(--color-background-tertiary, #f4f3f0)",
      borderRadius: "var(--border-radius-md, 8px)",
    },
    buttonRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    button: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 14px",
      border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
      borderRadius: "var(--border-radius-md, 8px)",
      background: "var(--color-background-primary, #08080a)",
      color: "var(--color-text-primary, #e8e8e8)",
      fontSize: 12,
      fontWeight: 500,
      cursor: busy ? "wait" : "pointer",
      opacity: busy ? 0.6 : 1,
    },
    buttonPrimary: {
      background: "var(--color-text-primary, #e8e8e8)",
      color: "var(--color-background-primary, #08080a)",
      borderColor: "var(--color-text-primary, #e8e8e8)",
    },
    buttonDisabled: { opacity: 0.4, cursor: "not-allowed" },
    toast: {
      fontSize: 11,
      color: "var(--color-text-success, #78dc14)",
      marginTop: 8,
    },
    error: {
      fontSize: 11,
      color: "var(--color-text-danger, #ff6b6b)",
      marginTop: 8,
    },
  };

  const meta = [];
  if (plan.start_date) meta.push(`Starts ${plan.start_date}`);
  if (plan.timezone) meta.push(plan.timezone);

  return h(
    "div",
    { style: style.card, className: "chat-workout-plan-card" },
    h(
      "div",
      { style: style.header },
      h("div", { style: style.title }, plan.title || "Workout plan"),
      summary ? h("div", { style: style.subtitle }, summary) : null,
      meta.length ? h("div", { style: style.meta }, meta.join(" Â· ")) : null,
      h("span", { style: style.chip }, isUpdate ? "Plan update" : "New plan")
    ),
    isUpdate && diffLines.length
      ? h(
          "div",
          { style: style.diffWrap },
          diffLines.join(" Â· ")
        )
      : null,
    previewSessions.length
      ? h(
          "div",
          { style: style.sessionsWrap },
          previewSessions.map((session, index) =>
            h(
              "div",
              { key: session.id || index, style: style.sessionRow },
              h("div", { style: style.sessionDay }, DAY_LABELS[session.day_of_week] || ""),
              h(
                "div",
                null,
                h("div", null, session.title || "Workout"),
                session.summary
                  ? h(
                      "div",
                      { style: { fontSize: 11, color: "var(--color-text-tertiary, #3a3a3a)" } },
                      session.summary
                    )
                  : null
              ),
              h(
                "div",
                { style: style.sessionDuration },
                session.start_time ? `${session.start_time} Â· ${session.duration_minutes || 60}m` : ""
              )
            )
          ),
          (plan.sessions || []).length > previewSessions.length
            ? h(
                "div",
                { style: style.moreHint },
                `+ ${(plan.sessions || []).length - previewSessions.length} more sessions across ${plan.weeks || "upcoming"} weeks`
              )
            : null
        )
      : null,
    h(
      "div",
      { style: style.buttonRow },
      isUpdate && !resolved
        ? h(
            "button",
            {
              type: "button",
              onClick: handleApplyUpdate,
              disabled: busy,
              style: { ...style.button, ...style.buttonPrimary },
            },
            busy ? "Applying..." : "Apply update"
          )
        : null,
      isUpdate && !resolved
        ? h(
            "button",
            {
              type: "button",
              onClick: handleDiscard,
              disabled: busy,
              style: style.button,
            },
            "Discard"
          )
        : null,
      !isUpdate && !resolved
        ? h(
            "button",
            {
              type: "button",
              onClick: handleSave,
              disabled: busy,
              style: { ...style.button, ...style.buttonPrimary },
            },
            busy ? "Saving..." : "Save plan"
          )
        : null,
      h(
        "button",
        {
          type: "button",
          onClick: handleDownload,
          disabled: busy,
          style: style.button,
        },
        "Add to calendar (.ics)"
      )
    ),
    toast ? h("div", { style: style.toast }, toast) : null,
    error ? h("div", { style: style.error }, error) : null,
    resolved === "saved"
      ? h(
          "div",
          { style: { ...style.meta, marginTop: 6 } },
          h(
            "a",
            {
              href: "/app/workout/",
              style: { color: "var(--color-text-primary, #e8e8e8)", textDecoration: "underline" },
            },
            "Open workout planner â†’"
          )
        )
      : null
  );
}

// â”€â”€â”€ MealPlanCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Inline renderer for `meal-plan` chat fences. Mirrors WorkoutPlanCard: parses
// segment.content (raw JSON string per widget-fence-parser), renders the plan
// with day-type tabs / target card / meal cards / supplement stack, and
// exposes a Save button that POSTs to /api/emersus/meal-plans with a Bearer
// token from the current supabase session.
//
// The iframe-hosted shared/meal-plan-widget.js remains as the presentational
// component library â€” its sub-components (MealCard, SupplementStack,
// TargetCard) are re-exported and reused here so there's exactly one
// implementation of each piece of plan UI.
//
function MealPlanCard({ segment, threadId }) {
  const [parseError, setParseError] = useState("");
  const [plan, setPlan] = useState(null);
  // chat_v2 swaps the "Save plan" label to "Save to Nutrition →" and adds an
  // "Adjust meals" button that dispatches `emersus:seed-prompt`. The host
  // ChatApp listens for that event and seeds the composer.
  const chatV2On = useMemo(() => {
    try { return resolveFlag("chat_v2"); } catch { return false; }
  }, []);

  // Parse once per unique segment. segment.content is the raw JSON string
  // the model emitted inside the ```meal-plan fence. Invalid JSON renders
  // an inline error card, matching WorkoutPlanCard's parse-failure branch.
  useEffect(() => {
    if (!segment?.content) {
      setParseError("Meal plan missing.");
      setPlan(null);
      return;
    }
    try {
      const parsed = JSON.parse(segment.content);
      setPlan(parsed);
      setParseError("");
    } catch (err) {
      setParseError(`Meal plan could not be parsed: ${err?.message || "invalid JSON"}`);
      setPlan(null);
    }
  }, [segment?.content]);

  const [activeSlug, setActiveSlug] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState(""); // "saved" once save succeeds
  const [planTitle, setPlanTitle] = useState("");

  // Once plan arrives, pick the first day-type as the default active tab
  useEffect(() => {
    if (plan?.day_types?.length && !activeSlug) {
      setActiveSlug(plan.day_types[0].slug);
    }
  }, [plan, activeSlug]);

  if (parseError) {
    return h(
      "div",
      { className: "chat-bubble chat-bubble-assistant chat-text-block" },
      h("div", { style: { color: "var(--color-text-danger, #ff6b6b)" } }, parseError),
      segment?.content
        ? h(
            "pre",
            {
              style: {
                whiteSpace: "pre-wrap",
                fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "var(--color-text-tertiary, #3a3a3a)",
                marginTop: 8,
                maxHeight: 120,
                overflow: "auto",
              },
            },
            String(segment.content).slice(0, 800)
          )
        : null
    );
  }

  if (!plan) return null; // transient â€” waiting for the parse effect

  const dayTypes = Array.isArray(plan.day_types) ? plan.day_types : [];
  const activeDayType = dayTypes.find((dt) => dt.slug === activeSlug) || null;
  const activeTargets = plan.targets?.[activeSlug] || null;

  const sortedMeals = (activeDayType?.meals ?? [])
    .slice()
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  async function handleSave() {
    if (busy || resolved === "saved") return;
    setError("");
    setBusy(true);
    try {
      const session = await getSession();
      if (!session?.user?.id || !session?.access_token) {
        throw new Error("Sign in to save this plan.");
      }
      const title =
        planTitle.trim() ||
        `${plan.provenance?.profile_snapshot?.goal ?? "Meal"} plan`;
      const res = await fetch("/api/emersus/meal-plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title,
          plan,
          source_thread_id: threadId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (HTTP ${res.status}).`);
      }
      setToast("Meal plan saved. Open it in the nutrition panel anytime.");
      setResolved("saved");
    } catch (err) {
      setError(String(err?.message || err) || "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return h(
    "div",
    { className: "chat-meal-plan-card" },
    h(
      "div",
      {
        style: {
          background: "var(--color-background-secondary, rgba(255,255,255,0.03))",
          border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
          borderRadius: "var(--border-radius-lg, 14px)",
          padding: 16,
          margin: "10px 0",
        },
      },
      // Day-type tabs
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap",
          },
        },
        dayTypes.map((dt) =>
          h(
            "button",
            {
              key: dt.slug,
              onClick: () => setActiveSlug(dt.slug),
              style: {
                background:
                  dt.slug === activeSlug
                    ? "var(--color-accent-primary, #78dc14)"
                    : "transparent",
                color:
                  dt.slug === activeSlug
                    ? "var(--color-text-inverse, #08080a)"
                    : "var(--color-text-primary, #e8e8e8)",
                border:
                  "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
                borderRadius: 999,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              },
            },
            dt.name || dt.slug
          )
        )
      ),
      // Target card â€” inline styled (not from shared module, which has cross-module caching issues)
      activeTargets
        ? h("div", { style: { background: "var(--color-background-tertiary, rgba(255,255,255,0.03))", borderRadius: 10, padding: "12px 16px", marginBottom: 12 } },
            activeDayType?.name ? h("div", { style: { fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #e8e8e8)", marginBottom: 10 } }, activeDayType.name) : null,
            h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
              [["kcal", activeTargets.kcal], ["protein", `${activeTargets.protein_g}g`], ["carbs", `${activeTargets.carbs_g}g`], ["fat", `${activeTargets.fat_g}g`], ["fiber", `${activeTargets.fiber_g}g`]].map(([label, val]) =>
                h("div", { key: label, style: { flex: 1, minWidth: 56, textAlign: "center" } },
                  h("div", { style: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, #666)" } }, label),
                  h("div", { style: { fontSize: 18, fontWeight: 500, color: "var(--color-text-primary, #e8e8e8)" } }, val),
                )
              )
            ),
          )
        : null,
      // Meals â€” inline styled
      h("div", { style: { marginTop: 12 } },
        sortedMeals.map((m, i) =>
          h("div", { key: `m-${i}`, style: { marginBottom: 12, padding: "10px 12px", background: "var(--color-background-tertiary, rgba(255,255,255,0.03))", borderRadius: 10 } },
            h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 } },
              h("span", { style: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, #666)" } }, (m.slot || "").replace(/_/g, " ")),
              h("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #e8e8e8)" } }, m.name),
            ),
            h("ul", { style: { margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary, #666)", lineHeight: 1.6 } },
              (m.foods || []).map((f, j) => h("li", { key: j }, `${f.description} â€” ${f.grams} g`))
            ),
          )
        )
      ),
      // Supplement stack â€” inline styled
      activeDayType?.supplements?.length
        ? h("div", { style: { marginTop: 12, padding: "10px 12px", background: "var(--color-background-tertiary, rgba(255,255,255,0.03))", borderRadius: 10 } },
            h("div", { style: { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, #666)", marginBottom: 6 } }, "Supplements"),
            h("ul", { style: { margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary, #666)", lineHeight: 1.6 } },
              activeDayType.supplements.map((s, i) =>
                h("li", { key: i }, `${s.description} â€” ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " Â· " + s.timing.replace(/_/g, " ") : ""}`)
              )
            ),
          )
        : null,
      // Save row
      h(
        "div",
        {
          style: {
            display: "flex",
            gap: 8,
            marginTop: 16,
            alignItems: "center",
          },
        },
        h("input", {
          type: "text",
          value: planTitle,
          onChange: (e) => setPlanTitle(e.target.value),
          placeholder: "Plan title (optional)",
          disabled: busy || resolved === "saved",
          style: {
            flex: 1,
            background: "var(--color-background-primary, #08080a)",
            color: "var(--color-text-primary, #e8e8e8)",
            border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
          },
        }),
        chatV2On
          ? h(
              "button",
              {
                type: "button",
                onClick: () => {
                  const dayName = activeDayType?.name || "the plan";
                  const prompt = `Adjust ${dayName} above. Swap one meal but keep the daily targets.`;
                  window.dispatchEvent(new CustomEvent("emersus:seed-prompt", { detail: { prompt } }));
                },
                style: {
                  background: "transparent",
                  color: "var(--color-text-primary, #e8e8e8)",
                  border: "0.5px solid var(--color-border-primary, rgba(255,255,255,0.18))",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                },
              },
              "Adjust meals",
            )
          : null,
        h(
          "button",
          {
            onClick: handleSave,
            disabled: busy || resolved === "saved",
            style: {
              background: "var(--color-accent-primary, #78dc14)",
              color: "var(--color-text-inverse, #08080a)",
              border: "none",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: busy || resolved === "saved" ? "default" : "pointer",
              opacity: busy || resolved === "saved" ? 0.6 : 1,
            },
          },
          busy
            ? "Saving..."
            : resolved === "saved"
            ? "\u2713 Saved"
            : chatV2On
              ? "Save to Nutrition →"
              : "Save plan"
        )
      ),
      // Toast / error
      toast
        ? h(
            "div",
            {
              style: {
                marginTop: 8,
                fontSize: 12,
                color: "var(--color-text-secondary, #a8a8b2)",
              },
            },
            toast
          )
        : null,
      error
        ? h(
            "div",
            {
              style: {
                marginTop: 8,
                fontSize: 12,
                color: "var(--color-text-danger, #ff6b6b)",
              },
            },
            error
          )
        : null
    )
  );
}

// â”€â”€â”€ NutritionLogConfirmCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Inline renderer for `nutrition-log-confirm` chat fences. Mirrors MealPlanCard
// (per Amendment A8): parses segment.content (raw JSON string from
// widget-fence-parser), renders per-row amount + meal_slot editors for
// resolved items, read-only unresolved rows, and a "Confirm log (N)" button
// that POSTs to /api/emersus/meal-journal/entries with a Bearer token from
// getSession(). This is the production code path â€” the iframe-hosted
// shared/nutrition-log-confirm-widget.js is for the theoretical iframe path.
//
// Sub-components (ResolvedRow, UnresolvedRow, MEAL_SLOT_LABELS) are imported
// from the widget file to avoid duplication.
function NutritionLogConfirmCard({ segment, threadId }) {
  // â”€â”€ Parse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // All hooks before any early returns (rules of hooks).
  const [parseError, setParseError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!segment?.content) {
      setParseError("Food log missing.");
      setPayload(null);
      return;
    }
    try {
      const parsed = JSON.parse(segment.content);
      // Server fast-path computes logged_date in UTC â€” override with
      // the client's local calendar date so the entry lands on the
      // correct day for western-hemisphere users.
      parsed.logged_date = localDateStr();
      setPayload(parsed);
      setParseError("");
    } catch (err) {
      setParseError(`Food log could not be parsed: ${err?.message || "invalid JSON"}`);
      setPayload(null);
    }
  }, [segment?.content]);

  // â”€â”€ Editable state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [items, setItems] = useState([]);
  const [submitState, setSubmitState] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");

  // Initialise editable items once the payload is available.
  useEffect(() => {
    if (!payload) return;
    const resolved = Array.isArray(payload.resolved_items) ? payload.resolved_items : [];
    setItems(
      resolved.map((it) => ({
        ...it,
        meal_slot: it.meal_slot || payload.meal_slot_default || "lunch",
      }))
    );
  }, [payload]);

  // â”€â”€ Callbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function handleUpdate(index, field, value) {
    setItems((prev) => {
      const next = prev.slice();
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleRemove(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleConfirm() {
    if (submitState === "saving" || submitState === "saved") return;
    if (items.length === 0) return;
    setSubmitState("saving");
    setError("");
    try {
      const session = await getSession();
      if (!session?.user?.id || !session?.access_token) {
        throw new Error("Sign in to log food.");
      }
      // Resolve food_ids for items missing them (LLM tool path gives
      // descriptions but not USDA FDC IDs). Single batch request instead
      // of N individual searches â€” one HTTP round trip, parallel on server.
      const needsLookup = items.filter((it) => !it.food_id && it.food_name);
      let foodIdMap = {};
      if (needsLookup.length > 0) {
        try {
          const batchRes = await fetch("/api/emersus/foods/search-batch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ queries: needsLookup.map((it) => it.food_name), limit: 1 }),
          });
          if (batchRes.ok) {
            const batchData = await batchRes.json();
            foodIdMap = batchData.results || {};
          }
        } catch { /* proceed without food_ids â€” will fail at insert */ }
      }
      const allEntries = items.map((it) => ({
        food_id: it.food_id || foodIdMap[it.food_name]?.id || null,
        food_name: it.food_name,
        logged_date: payload.logged_date,
        meal_slot: it.meal_slot,
        amount: it.amount,
        amount_unit: it.amount_unit || "g",
        source: "chat_parser",
        confidence: it.confidence ?? 0.7,
      }));
      // Filter out items with no food_id (no USDA match found).
      const entries = allEntries.filter((e) => e.food_id);
      const skipped = allEntries.filter((e) => !e.food_id);
      if (entries.length === 0) {
        throw new Error(
          `Could not match any foods in the catalog: ${skipped.map((s) => s.food_name).join(", ")}. Try logging manually.`
        );
      }
      const res = await fetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Log failed (HTTP ${res.status}).`);
      }
      setSubmitState("saved");
      if (skipped.length > 0) {
        setError(`Logged ${entries.length} item(s). Could not match: ${skipped.map((s) => s.food_name).join(", ")}`);
      }
    } catch (err) {
      setError(String(err?.message || err) || "Log failed.");
      setSubmitState("error");
    }
  }

  // â”€â”€ Early returns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (parseError) {
    return h(
      "div",
      { className: "chat-bubble chat-bubble-assistant chat-text-block" },
      h("div", { style: { color: "var(--color-text-danger, #ff6b6b)" } }, parseError),
      segment?.content
        ? h(
            "pre",
            {
              style: {
                whiteSpace: "pre-wrap",
                fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "var(--color-text-tertiary, #3a3a3a)",
                marginTop: 8,
                maxHeight: 120,
                overflow: "auto",
              },
            },
            String(segment.content).slice(0, 800)
          )
        : null
    );
  }

  if (!payload) return null; // transient â€” waiting for the parse effect

  // â”€â”€ Success state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (submitState === "saved") {
    return h(
      "div",
      { className: "chat-nutrition-log-card" },
      h(
        "div",
        {
          style: {
            padding: "10px 14px",
            background: "var(--color-background-success, rgba(120,220,20,0.10))",
            border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
            borderRadius: "var(--border-radius-md, 12px)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--color-text-success, #78dc14)",
            fontWeight: 500,
          },
        },
        "\u2713 Logged ",
        items.length,
        " item",
        items.length !== 1 ? "s" : ""
      )
    );
  }

  const unresolved = Array.isArray(payload.unresolved) ? payload.unresolved : [];

  // â”€â”€ Main render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return h(
    "div",
    { className: "chat-nutrition-log-card" },
    h(
      "div",
      {
        style: {
          background: "var(--color-background-secondary, rgba(255,255,255,0.03))",
          border: "0.5px solid var(--color-border-tertiary, rgba(255,255,255,0.06))",
          borderRadius: "var(--border-radius-lg, 14px)",
          padding: 16,
          margin: "10px 0",
        },
      },
      // Header row
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          },
        },
        h(
          "div",
          {
            style: {
              fontSize: 12,
              fontWeight: 600,
              color: "var(--color-text-primary, #e8e8e8)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              flex: 1,
            },
          },
          "Confirm food log"
        ),
        payload.logged_date
          ? h(
              "span",
              { style: { fontSize: 11, color: "var(--color-text-tertiary, #3a3a3a)" } },
              payload.logged_date
            )
          : null
      ),
      // Parse-error banner
      payload.parse_error
        ? h(
            "div",
            {
              style: {
                padding: "6px 10px",
                background: "var(--color-background-warning, rgba(255,196,102,0.12))",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--color-text-warning, #ffd57a)",
                marginBottom: 10,
              },
            },
            "\u26a0 Some items could not be parsed: ",
            payload.parse_error
          )
        : null,
      // Resolved items
      items.length > 0
        ? h(
            "div",
            { style: { marginBottom: 8 } },
            items.map((item, i) =>
              h(ResolvedRow, {
                key: item.food_id ? `r-${item.food_id}-${i}` : `r-${i}`,
                item,
                index: i,
                onUpdate: handleUpdate,
                onRemove: handleRemove,
              })
            )
          )
        : h(
            "div",
            {
              style: {
                fontSize: 12,
                color: "var(--color-text-tertiary, #3a3a3a)",
                padding: "6px 0",
                fontStyle: "italic",
              },
            },
            "No items to log \u2014 all items removed."
          ),
      // Unresolved items
      unresolved.length > 0
        ? h(
            "div",
            { style: { marginTop: 8 } },
            h(
              "div",
              {
                style: {
                  fontSize: 11,
                  color: "var(--color-text-tertiary, #3a3a3a)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                },
              },
              "Couldn't find in database"
            ),
            unresolved.map((item, i) =>
              h(UnresolvedRow, { key: `u-${i}`, item, index: i })
            )
          )
        : null,
      // Confirm button + error
      h(
        "div",
        { style: { marginTop: 14, display: "flex", flexDirection: "column", gap: 6 } },
        h(
          "button",
          {
            onClick: handleConfirm,
            disabled: submitState === "saving" || submitState === "saved" || items.length === 0,
            style: {
              alignSelf: "flex-start",
              padding: "7px 16px",
              background:
                items.length === 0
                  ? "rgba(255,255,255,0.03)"
                  : "var(--color-accent-primary, #78dc14)",
              color:
                items.length === 0
                  ? "var(--color-text-tertiary, #3a3a3a)"
                  : "var(--color-text-inverse, #08080a)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: submitState === "saving" || items.length === 0 ? "default" : "pointer",
              opacity: submitState === "saving" ? 0.7 : 1,
            },
          },
          submitState === "saving"
            ? "Logging\u2026"
            : `Confirm log (${items.length})`
        ),
        error
          ? h(
              "div",
              { style: { fontSize: 12, color: "var(--color-text-danger, #ff6b6b)" } },
              error
            )
          : null
      )
    )
  );
}

function TextBlock({ text, role = "assistant", typewrite = false, typingActive = false, threadId = null, toolResults = null }) {
  const fullText = String(text || "");
  const visible = useTypewriter(fullText, typewrite);
  const isTyping = typingActive || (typewrite && visible.length < fullText.length);
  const display = typewrite ? visible : fullText;

  // â”€â”€ New SSE path: toolResults present â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // When the message was built from SSE events, tool outputs arrive as
  // structured objects in toolResults rather than fenced code blocks in
  // the prose. Render prose in a bubble, then each tool result as the
  // appropriate card component after it.
  if (role === "assistant" && toolResults && typeof toolResults === "object" && Object.keys(toolResults).length > 0) {
    const children = [];

    // Prose bubble
    if (fullText.trim()) {
      children.push(
        h(
          "div",
          { key: "prose", className: `chat-bubble chat-bubble-${role} chat-text-block` },
          renderProseChunks(fullText),
        ),
      );
    }

    // Tool result cards
    for (const [toolName, toolData] of Object.entries(toolResults)) {
      if (toolName === "emit_widget" && toolData) {
        children.push(
          h(
            "div",
            { key: `tr-widget`, className: "chat-widget-frame-wrap" },
            h(WidgetFrame, { code: toolData.html || "", title: toolData.title }),
          ),
        );
      } else if (toolName === "emit_workout_plan" && toolData) {
        // Wrap in the same shape WorkoutPlanCard expects from a parsed fence
        const segment = { content: { ok: true, plan: toolData } };
        children.push(
          h(
            "div",
            { key: `tr-workout`, className: "chat-workout-plan-wrap" },
            h(WorkoutPlanCard, { segment, threadId }),
          ),
        );
      } else if (toolName === "emit_meal_plan" && toolData) {
        // MealPlanCard parses JSON from segment.content â€” pass pre-stringified
        const segment = { content: JSON.stringify(toolData) };
        children.push(
          h(
            "div",
            { key: `tr-meal`, className: "chat-meal-plan-wrap" },
            h(MealPlanCard, { segment, threadId }),
          ),
        );
      } else if (toolName === "log_food" && toolData) {
        // Transform log_food tool shape { foods, meal_slot } into the
        // resolved_items shape NutritionLogConfirmCard/ResolvedRow expects.
        // ResolvedRow reads: food_name, amount, amount_unit, meal_slot.
        const confirmPayload = {
          resolved_items: (toolData.foods || []).map((f) => ({
            food_name: f.description,
            amount: f.amount ?? f.grams,
            amount_unit: f.amount_unit || "g",
            kcal: f.kcal,
            protein_g: f.protein_g,
            carbs_g: f.carbs_g,
            fat_g: f.fat_g,
            meal_slot: toolData.meal_slot || "lunch",
            kind: "food",
          })),
          unresolved: [],
          meal_slot_default: toolData.meal_slot || "lunch",
          logged_date: localDateStr(),
        };
        const segment = { content: JSON.stringify(confirmPayload) };
        children.push(
          h(
            "div",
            { key: `tr-logfood`, className: "chat-nutrition-log-wrap" },
            h(NutritionLogConfirmCard, { segment, threadId }),
          ),
        );
      }
    }

    return h(
      "div",
      { className: `chat-text-block-wrap chat-text-block-${role}` },
      children,
    );
  }

  // â”€â”€ Legacy paths (fence-based + pure prose) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Pure-prose answers (no widget fences) take the original single-bubble path.
  // This is also the path the user-message bubble always takes.
  if (role !== "assistant" || !hasWidgetFences(fullText)) {
    return h(
      "div",
      { className: `chat-bubble chat-bubble-${role} chat-text-block${isTyping ? " is-typing" : ""}` },
      renderProseChunks(display),
    );
  }

  // While the typewriter is still streaming, hide widgets and any partial
  // trailing fence so the reader never sees half-written "```widget\n<div".
  // Once the prose is complete, switch to the segment-aware layout below.
  if (isTyping) {
    const proseOnly = stripWidgetFencesForStreaming(display);
    return h(
      "div",
      { className: `chat-bubble chat-bubble-${role} chat-text-block is-typing` },
      renderProseChunks(proseOnly),
    );
  }

  // Segment-aware layout: render each text segment in its own bubble, each
  // widget segment as a sibling iframe, and each workout-plan segment as a
  // WorkoutPlanCard. Widgets and plan cards sit between bubbles instead of
  // inside them so they get full-width.
  const segments = parseLLMOutput(fullText);
  return h(
    "div",
    { className: `chat-text-block-wrap chat-text-block-${role}` },
    segments.map((segment, index) => {
      if (segment.type === "widget") {
        return h(
          "div",
          { key: `w-${index}`, className: "chat-widget-frame-wrap" },
          h(WidgetFrame, { code: segment.content }),
        );
      }
      if (segment.type === "workout-plan") {
        return h(
          "div",
          { key: `wp-${index}`, className: "chat-workout-plan-wrap" },
          h(WorkoutPlanCard, { segment, threadId }),
        );
      }
      if (segment.type === "meal-plan") {
        return h(
          "div",
          { key: `mp-${index}`, className: "chat-meal-plan-wrap" },
          h(MealPlanCard, { segment, threadId }),
        );
      }
      if (segment.type === "nutrition-log-confirm") {
        return h(
          "div",
          { key: `nlc-${index}`, className: "chat-nutrition-log-wrap" },
          h(NutritionLogConfirmCard, { segment, threadId }),
        );
      }
      return h(
        "div",
        {
          key: `t-${index}`,
          className: `chat-bubble chat-bubble-${role} chat-text-block`,
        },
        renderProseChunks(segment.content),
      );
    }),
  );
}

function safeJson(value) {
  return JSON.stringify(value || {}).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function buildMetricGridMarkup(metrics) {
  return (Array.isArray(metrics) ? metrics : [])
    .slice(0, 6)
    .filter((metric) =>
      normalizeText(metric?.value || metric?.display_value || "", 80) &&
      normalizeText(metric?.label || "", 80)
    )
    .map((metric) => {
      const tone = toneClass(metric?.tone) || "is-medium";
      return `
        <div class="metric ${tone}">
          <div class="metric-val">${escapeHtml(metric?.value || metric?.display_value || "")}</div>
          <div class="metric-lbl">${escapeHtml(metric?.label || "")}</div>
          <div class="metric-sub">${escapeHtml(metric?.detail || metric?.context || "")}</div>
        </div>`;
    })
    .join("");
}

function buildDiagramMarkup(card) {
  const nodes = (Array.isArray(card?.data?.nodes) ? card.data.nodes : []).slice(0, 6);
  const nodeWidth = 520;
  const nodeHeight = 108;
  const nodeX = 130;
  const nodeCenterX = nodeX + nodeWidth / 2;
  const verticalStep = 146;
  const height = Math.max(420, nodes.length * verticalStep + 24);
  const nodeMarkup = nodes
    .map((node, index) => {
      const y = 28 + index * verticalStep;
      const tone = escapeHtml(node?.tone || (index % 2 ? "green" : "blue"));
      const nextY = y + nodeHeight;
      return `
        <g class="diagram-node ${tone}" tabindex="0">
          <rect x="${nodeX}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="16"></rect>
          <foreignObject x="${nodeX + 18}" y="${y + 14}" width="${nodeWidth - 36}" height="${nodeHeight - 24}">
            <div xmlns="http://www.w3.org/1999/xhtml" class="node-copy">
              <strong>${escapeHtml(node?.label || `Step ${index + 1}`)}</strong>
              <span>${escapeHtml(trimSnippet(node?.detail || "", 118))}</span>
            </div>
          </foreignObject>
        </g>
        ${index < nodes.length - 1 ? `<path class="edge" d="M${nodeCenterX} ${nextY + 6} L${nodeCenterX} ${nextY + 32}"></path><path class="arrow" d="M${nodeCenterX - 7} ${nextY + 25} L${nodeCenterX} ${nextY + 35} L${nodeCenterX + 7} ${nextY + 25}"></path>` : ""}`;
    })
    .join("");
  return `<section class="diagram-stage"><svg viewBox="0 0 780 ${height}" role="img" aria-label="${escapeHtml(card?.title || "Diagram")}">${nodeMarkup}</svg></section><p class="hint">Click any node to ask a follow-up about it.</p>`;
}

function buildChartMarkup(card) {
  const facts = (Array.isArray(card?.data?.facts) ? card.data.facts : []).slice(0, 6);
  const chartType = String(card?.data?.chart_type || "metric_grid");
  if (chartType === "metric_grid" || facts.length < 2) {
    return `<section class="metric-grid">${buildMetricGridMarkup(facts)}</section>`;
  }

  const numericFacts = facts.map((fact) => {
    const raw = String(fact?.value || fact?.display_value || "").replace(/[$,%]/g, "");
    return { ...fact, number: Number.parseFloat(raw) || 0 };
  });
  const max = Math.max(...numericFacts.map((fact) => fact.number), 1);
  if (chartType === "timeline") {
    const points = numericFacts.map((fact, index) => {
      const x = 60 + index * (680 / Math.max(1, numericFacts.length - 1));
      const y = 260 - (fact.number / max) * 190;
      return { fact, x, y };
    });
    const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    return `<section class="chart-stage"><svg viewBox="0 0 800 320" class="line-chart" role="img"><path class="grid-line" d="M50 260H760 M50 200H760 M50 140H760 M50 80H760"></path><path class="line-path" d="${path}"></path>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="7"></circle><text x="${point.x}" y="292" text-anchor="middle">${escapeHtml(trimSnippet(point.fact?.label || point.fact?.value || "", 14))}</text>`).join("")}</svg></section>`;
  }
  if (chartType === "proportion") {
    const total = numericFacts.reduce((sum, fact) => sum + Math.max(0, fact.number), 0) || 1;
    return `<section class="chart-stage proportion-stage">${numericFacts.map((fact, index) => {
      const width = Math.max(4, (Math.max(0, fact.number) / total) * 100);
      const segment = `<div class="stack-segment ${index % 2 ? "mint" : "blue"}" style="width:${width}%"><span>${escapeHtml(fact?.display_value || fact?.value || "")}</span></div>`;
      return segment;
    }).join("")}</section><div class="proportion-labels">${numericFacts.map((fact) => `<span>${escapeHtml(trimSnippet(fact?.label || "", 28))}</span>`).join("")}</div>`;
  }
  if (chartType === "range") {
    return `<section class="chart-stage range-stage">${numericFacts.map((fact) => {
      const width = Math.max(8, (fact.number / max) * 100);
      return `<label><span>${escapeHtml(trimSnippet(fact?.label || "", 28))}</span><i><b style="width:${width}%"></b></i><strong>${escapeHtml(fact?.display_value || fact?.value || "")}</strong></label>`;
    }).join("")}</section>`;
  }
  if (chartType === "scatter") {
    return `<section class="chart-stage"><svg viewBox="0 0 800 320" class="scatter-chart" role="img"><path class="grid-line" d="M60 260H750 M60 80V260"></path>${numericFacts.map((fact, index) => {
      const x = 90 + ((index + 1) / (numericFacts.length + 1)) * 620;
      const y = 260 - (fact.number / max) * 185;
      const radius = 8 + (index % 3) * 5;
      return `<circle cx="${x}" cy="${y}" r="${radius}"></circle><text x="${x}" y="${Math.min(300, y + 28)}" text-anchor="middle">${escapeHtml(trimSnippet(fact?.label || "", 14))}</text>`;
    }).join("")}</svg></section>`;
  }
  const bars = numericFacts
    .map((fact, index) => {
      const height = Math.max(10, Math.round((fact.number / max) * 220));
      return `
        <div class="bar-wrap">
          <div class="bar ${index % 2 ? "mint" : "blue"}" style="height:${height}px"></div>
          <strong>${escapeHtml(fact?.display_value || fact?.value || "")}</strong>
          <span>${escapeHtml(trimSnippet(fact?.label || `Value ${index + 1}`, 22))}</span>
        </div>`;
    })
    .join("");
  return `<section class="chart-stage"><div class="chart-bars">${bars}</div></section>`;
}

function buildMockupMarkup(card) {
  const sections = (Array.isArray(card?.data?.sections) ? card.data.sections : []).slice(0, 4);
  const sectionMarkup = sections
    .map((section, index) => `
      <article class="mock-panel ${index === 0 ? "featured" : ""}">
        <p>${escapeHtml(section?.title || `Panel ${index + 1}`)}</p>
        <strong>${escapeHtml(trimSnippet(section?.body || "", 95))}</strong>
        <button type="button">${escapeHtml(section?.action || "Review")}</button>
      </article>`)
    .join("");
  return `<section class="mockup-phone"><div class="mock-header"><span></span><span></span><span></span></div><div class="mock-grid">${sectionMarkup}</div></section>`;
}

function buildInteractiveMarkup(card) {
  const controls = Array.isArray(card?.data?.controls) ? card.data.controls.slice(0, 4) : [];
  const outputs = Array.isArray(card?.data?.outputs) ? card.data.outputs.slice(0, 2) : ["Primary output", "Secondary output"];
  const model = String(card?.data?.model || "");
  const values = Object.fromEntries(controls.map((control) => [control.id, Number(control.value || control.min || 0)]));
  const money = (value) => `$${Math.round(value).toLocaleString()}`;
  let primaryValue = "Scenario";
  let secondaryValue = "Model";

  if (model === "compound_interest") {
    const principal = values.principal || 10000;
    const rate = (values.rate || 7) / 100;
    const years = values.years || 20;
    const final = principal * Math.pow(1 + rate, years);
    primaryValue = money(final);
    secondaryValue = money(final - principal);
  } else {
    const score = Math.round(((values.baseline || 5) * 0.4 + (values.intensity || 7) * 0.9 + (values.duration || 6) * 0.7) * 8);
    primaryValue = `${score}/100`;
    secondaryValue = score > 70 ? "High" : score > 45 ? "Moderate" : "Low";
  }

  const assumptionMarkup = (Array.isArray(card?.data?.assumptions) ? card.data.assumptions : [])
    .slice(0, 4)
    .map((assumption) => `<li>${escapeHtml(assumption)}</li>`)
    .join("");
  const variableMarkup = controls
    .map((control) => {
      const min = Number(control.min ?? 0);
      const max = Number(control.max ?? 100);
      const value = Number(control.value ?? min);
      const percent = Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100));
      return `
        <label>
          <span>${escapeHtml(control.label || "Variable")}</span>
          <i><b style="width:${percent}%"></b></i>
          <strong>${escapeHtml(`${value}${control.unit || ""}`)}</strong>
        </label>`;
    })
    .join("");

  return `
    <section class="interactive-stage">
      <div class="interactive-results">
        <article><p>${escapeHtml(outputs[0] || "Primary output")}</p><strong>${escapeHtml(primaryValue)}</strong></article>
        <article><p>${escapeHtml(outputs[1] || "Secondary output")}</p><strong>${escapeHtml(secondaryValue)}</strong></article>
      </div>
      ${variableMarkup ? `<div class="static-control-list">${variableMarkup}</div>` : ""}
      ${assumptionMarkup ? `<ul class="assumption-list">${assumptionMarkup}</ul>` : ""}
    </section>`;
}

function buildArtMarkup(card) {
  const scene = String(card?.data?.scene || "abstract");
  if (scene === "landscape") {
    return `<section class="art-stage"><svg viewBox="0 0 900 420" role="img" aria-label="${escapeHtml(card?.title || "Illustration")}"><rect width="900" height="420" fill="#08080a"/><circle cx="740" cy="86" r="58" fill="#78dc14" opacity=".3"/><circle cx="705" cy="68" r="58" fill="#08080a"/><polygon points="0,320 150,150 310,300 500,120 720,285 900,135 900,420 0,420" fill="#0f0f12"/><polygon points="0,350 210,245 430,350 590,225 760,330 900,260 900,420 0,420" fill="#141418"/><polygon points="0,365 900,365 900,420 0,420" fill="#0a0a0d"/><g fill="#78dc14" opacity=".4">${Array.from({ length: 18 }, (_, index) => `<circle cx="${50 + index * 46}" cy="${30 + (index % 5) * 28}" r="2"/>`).join("")}</g></svg></section>`;
  }
  return `<section class="art-stage"><svg viewBox="0 0 900 420" role="img" aria-label="${escapeHtml(card?.title || "Illustration")}"><rect width="900" height="420" fill="#08080a"/><g fill="none" stroke="#78dc14" stroke-width="2" opacity=".5">${Array.from({ length: 8 }, (_, index) => `<circle cx="${160 + index * 80}" cy="210" r="${36 + index * 12}"/>`).join("")}</g><path d="M80 300 C220 120, 340 350, 500 180 S740 110, 820 290" stroke="#78dc14" stroke-width="18" fill="none" opacity=".35"/><g fill="#78dc14" opacity=".5">${Array.from({ length: 28 }, (_, index) => `<circle cx="${60 + (index * 67) % 820}" cy="${55 + (index * 41) % 310}" r="${2 + (index % 4)}"/>`).join("")}</g></svg></section>`;
}

function buildVisualArtifactMarkup(card) {
  const type = String(card?.artifact_type || card?.visual_type || "").toLowerCase();
  if (type === "diagram") return buildDiagramMarkup(card);
  if (type === "chart") return buildChartMarkup(card);
  if (type === "mockup") return buildMockupMarkup(card);
  if (type === "interactive_explainer") return buildInteractiveMarkup(card);
  if (type === "art_illustration") return buildArtMarkup(card);
  return "";
}

function buildEvidenceArtifactDoc({ card, title = "Generated dashboard", metrics = [], sources = [], panels = [] }) {
  const isVisualArtifact = card?.type === "visual_artifact";
  const safeTitle = escapeHtml(title);
  const safeBody = isVisualArtifact ? "" : escapeHtml(trimSnippet(card?.body || card?.footnote || "", 260));
  const safeMetrics = metrics.slice(0, 4);
  const safeSources = sources.slice(0, 3);
  const safePanels = panels.slice(0, 4);
  const artifactMarkup = isVisualArtifact ? buildVisualArtifactMarkup(card) : "";
  const metricMarkup = buildMetricGridMarkup(safeMetrics);
  const sourceMarkup = safeSources
    .map((source, index) => `
      <article class="source-row">
        <span class="source-index">${index + 1}</span>
        <div>
          <strong>${escapeHtml(source?.title || "Source")}</strong>
          <p>${escapeHtml(source?.meta || source?.takeaway || source?.id || "")}</p>
        </div>
      </article>`)
    .join("");
  const panelMarkup = safePanels
    .map((panel) => `
      <article class="signal-panel ${toneClass(panel?.tone)}">
        <p>${escapeHtml(panel?.label || "Signal")}</p>
        <strong>${escapeHtml(panel?.body || "")}</strong>
      </article>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: dark; --bg:#08080a; --panel:rgba(255,255,255,0.03); --ink:#e8e8e8; --muted:#666; --line:#3a3a3a; --accent:#78dc14; --green:#78dc14; --blue:#78dc14; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #08080a; color: var(--ink); font-family: system-ui, -apple-system, sans-serif; }
    .vis-container { padding: 18px; min-height: 100%; }
    .section-label { margin: 0 0 10px; color: var(--muted); font-size: 12px; letter-spacing: .02em; font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .hero { display: grid; gap: 10px; padding: 18px; border-radius: 18px; background: rgba(255,255,255,.03); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
    h1 { margin: 0; max-width: 760px; color: var(--ink); font-family: Georgia, serif; font-size: clamp(22px, 3.3vw, 38px); line-height: 1.02; letter-spacing: -.045em; }
    .body { margin: 0; max-width: 760px; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; margin-top: 14px; }
    .metric { min-height: 112px; display: grid; align-content: end; gap: 5px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.03); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); position: relative; overflow: hidden; }
    .metric::before { content:""; position:absolute; inset:auto 12px 12px auto; width:48px; height:48px; border-radius:50%; background: rgba(120,220,20,.12); filter: blur(4px); }
    .metric.is-good::before { background: rgba(120,220,20,.18); }
    .metric.is-medium::before { background: rgba(120,220,20,.10); }
    .metric.is-caution::before { background: rgba(255,191,84,.18); }
    .metric-val { position: relative; font-size: 25px; font-weight: 760; letter-spacing: -.04em; }
    .metric-lbl { position: relative; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .11em; font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .metric-sub { position: relative; color: #3a3a3a; font-size: 12px; min-height: 1em; }
    .panel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .signal-panel { min-height: 110px; display: grid; align-content: start; gap: 8px; padding: 14px; border-radius: 16px; background: rgba(0,0,0,.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
    .signal-panel p { margin: 0; color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .11em; font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .signal-panel strong { color: rgba(232,232,232,.9); font-size: 14px; line-height: 1.45; font-weight: 650; }
    .signal-panel.is-caution p { color: #ffbf54; }
    .signal-panel.is-good p { color: var(--green); }
    .signal-panel.is-medium p { color: var(--accent); }
    .source-panel { display: grid; gap: 8px; margin-top: 12px; }
    .source-row { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 10px; align-items: start; padding: 10px 12px; border-radius: 14px; background: rgba(0,0,0,.18); }
    .source-index { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; background: rgba(120,220,20,.12); color: var(--accent); font-weight: 800; font-size: 12px; }
    .source-row strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .source-row p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .diagram-stage, .chart-stage, .art-stage, .interactive-stage, .mockup-phone { margin-top: 12px; border-radius: 18px; background: rgba(0,0,0,.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); overflow: hidden; }
    .diagram-stage svg, .art-stage svg { display:block; width:100%; height:auto; min-height:340px; }
    .diagram-node rect { fill: #0a2a0a; stroke: rgba(120,220,20,.7); }
    .diagram-node.green rect { fill:#0a2a0a; stroke:#78dc14; }
    .diagram-node.amber rect { fill:#2a1a00; stroke:#ffbf54; }
    .node-copy { width:100%; height:100%; display:grid; align-content:center; gap:7px; text-align:center; overflow:hidden; color:var(--ink); font-family:inherit; }
    .node-copy strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--ink); font-size:18px; line-height:1.12; font-weight:850; letter-spacing:-.025em; word-break:break-word; overflow-wrap:anywhere; }
    .node-copy span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:rgba(232,232,232,.68); font-size:13px; line-height:1.25; font-weight:650; word-break:break-word; overflow-wrap:anywhere; }
    .edge, .arrow { stroke: rgba(232,232,232,.52); stroke-width: 2; fill: none; }
    .hint { margin: 12px 2px 0; color: var(--muted); font-size: 13px; }
    .chart-stage { min-height: 310px; padding: 18px 14px 12px; }
    .chart-bars { min-height: 270px; display:flex; align-items:end; justify-content:space-around; gap:10px; border-bottom:1px solid rgba(255,255,255,.06); background: repeating-linear-gradient(to top, transparent 0 49px, rgba(255,255,255,.03) 50px); }
    .bar-wrap { flex:1; min-width:0; display:grid; justify-items:center; align-items:end; gap:7px; color: var(--muted); font-size:12px; }
    .bar { width:min(48px, 70%); border-radius: 8px 8px 0 0; background:#78dc14; }
    .bar.mint { background:rgba(120,220,20,.5); }
    .bar-wrap strong { color:var(--ink); font-size:14px; }
    .bar-wrap span { max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .line-chart, .scatter-chart { width:100%; height:auto; min-height:290px; }
    .grid-line { stroke:rgba(255,255,255,.06); stroke-width:1; fill:none; }
    .line-path { stroke:#78dc14; stroke-width:5; fill:none; filter:drop-shadow(0 0 10px rgba(120,220,20,.4)); }
    .line-chart circle, .scatter-chart circle { fill:rgba(120,220,20,.5); stroke:#08080a; stroke-width:3; }
    .line-chart text, .scatter-chart text { fill:var(--muted); font-size:12px; font-weight:750; }
    .proportion-stage { min-height:120px; display:flex; align-items:center; padding:26px; }
    .stack-segment { min-height:72px; display:grid; place-items:center; background:#78dc14; color:#08080a; font-weight:850; }
    .stack-segment:first-child { border-radius:18px 0 0 18px; }
    .stack-segment:last-child { border-radius:0 18px 18px 0; }
    .stack-segment.mint { background:rgba(120,220,20,.5); color:#08080a; }
    .proportion-labels { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; color:var(--muted); font-size:12px; }
    .range-stage { min-height:220px; display:grid; align-content:center; gap:16px; padding:24px; }
    .range-stage label { display:grid; grid-template-columns:130px minmax(0,1fr) 70px; gap:12px; align-items:center; color:var(--muted); font-size:12px; font-weight:800; }
    .range-stage i { height:10px; border-radius:999px; background:rgba(255,255,255,.06); overflow:hidden; }
    .range-stage b { display:block; height:100%; border-radius:inherit; background:#78dc14; }
    .range-stage strong { color:var(--ink); text-align:right; }
    .mockup-phone { max-width:560px; margin:14px auto 0; padding:16px; background:rgba(255,255,255,.03); }
    .mock-header { display:flex; gap:6px; margin-bottom:14px; }
    .mock-header span { width:10px; height:10px; border-radius:99px; background:rgba(255,255,255,.12); }
    .mock-grid { display:grid; gap:10px; }
    .mock-panel { display:grid; gap:8px; padding:14px; border-radius:16px; background:rgba(0,0,0,.22); box-shadow:inset 0 0 0 1px rgba(255,255,255,.06); }
    .mock-panel.featured { background:rgba(120,220,20,.06); }
    .mock-panel p { margin:0; color:var(--accent); font-size:12px; text-transform:uppercase; letter-spacing:.1em; font-weight:800; }
    .mock-panel strong { font-size:15px; line-height:1.4; }
    .mock-panel button { justify-self:start; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:transparent; color:var(--ink); padding:7px 12px; font-weight:750; }
    .interactive-stage { display:grid; gap:18px; padding:18px; }
    .interactive-results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .interactive-results article { padding:14px; border-radius:16px; background:rgba(255,255,255,.03); }
    .interactive-results p { margin:0 0 6px; color:var(--muted); font-size:12px; font-weight:800; }
    .interactive-results strong { font-size:30px; color:var(--green); letter-spacing:-.04em; }
    .static-control-list { display:grid; gap:12px; }
    .static-control-list label { display:grid; grid-template-columns:120px minmax(0,1fr) 80px; gap:12px; align-items:center; color:var(--muted); font-weight:750; }
    .static-control-list i { height:10px; border-radius:999px; background:rgba(255,255,255,.06); overflow:hidden; }
    .static-control-list b { display:block; height:100%; border-radius:inherit; background:#78dc14; }
    .static-control-list strong { color:var(--ink); text-align:right; }
    .assumption-list { margin:0; padding-left:18px; color:var(--muted); font-size:13px; line-height:1.55; }
    .art-stage { min-height:320px; }
    @media (max-width: 640px) { .metric-grid, .panel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .vis-container { padding: 12px; } }
  </style>
</head>
<body>
  <main class="vis-container">
    ${isVisualArtifact ? "" : `<p class="section-label">${safeTitle}</p>`}
    <section class="hero">
      ${isVisualArtifact ? "" : `<h1>${escapeHtml(card?.title || "Generated dashboard")}</h1>`}
      ${safeBody ? `<p class="body">${safeBody}</p>` : ""}
      ${artifactMarkup || (metricMarkup ? `<div class="metric-grid">${metricMarkup}</div>` : "")}
      ${panelMarkup ? `<section class="panel-grid">${panelMarkup}</section>` : ""}
      ${sourceMarkup ? `<section class="source-panel">${sourceMarkup}</section>` : ""}
    </section>
  </main>
</body>
</html>`;
}

function EvidenceArtifact({ card, title, metrics = [], sources = [], panels = [] }) {
  const [frameHeight, setFrameHeight] = useState(760);
  const srcDoc = useMemo(
    () => buildEvidenceArtifactDoc({ card, title, metrics, sources, panels }),
    [card, title, metrics, sources, panels]
  );
  const resizeFrame = (event) => {
    const doc = event.currentTarget.contentDocument;
    const height = Math.max(
      520,
      doc?.documentElement?.scrollHeight || 0,
      doc?.body?.scrollHeight || 0
    );
    setFrameHeight(height + 4);
  };

  return h(
    "div",
    { className: "chat-artifact-container" },
    h("iframe", {
      className: "chat-artifact-frame",
      title,
      sandbox: "allow-scripts allow-same-origin",
      srcDoc,
      onLoad: resizeFrame,
      scrolling: "no",
      style: { height: `${frameHeight}px` },
    })
  );
}

function InlineVisualArtifact({ card, title, metrics = [], sources = [], panels = [] }) {
  return h(
    "section",
    { className: "chat-inline-artifact", "aria-label": title || card?.title || "Generated visual" },
    h(EvidenceArtifact, {
      card,
      title: title || card?.title || "Generated visual",
      metrics,
      sources,
      panels,
    })
  );
}

function DashboardArtifact({ card }) {
  const metrics = Array.isArray(card?.metrics) ? card.metrics.slice(0, 4) : [];
  const panels = Array.isArray(card?.panels) ? card.panels.slice(0, 4) : [];
  return h(
    ToolCard,
    { title: card?.eyebrow || "Generated dashboard", subtitle: "Sandboxed visual artifact", bodyClass: "chat-insight-card" },
    h(EvidenceArtifact, {
      card,
      title: card?.eyebrow || "Generated dashboard",
      metrics,
      panels,
    })
  );
}

function VisualArtifact({ card }) {
  if (!card?.artifact_type) return null;
  return h(InlineVisualArtifact, {
    card,
    title: card?.title || "Generated visual",
    metrics: card?.data?.facts || card?.data?.metrics || [],
    sources: card?.sources || [],
    panels: card?.data?.panels || [],
  });
}

function ActionGrid({ card }) {
  const columns = Array.isArray(card?.columns) ? card.columns.slice(0, 3) : [];
  return h(
    ToolCard,
    { title: card?.title || "Key takeaways", bodyClass: "chat-insight-card" },
    h("div", { className: "chat-action-columns" }, columns.map((column, index) =>
      h("section", { key: index, className: `chat-action-panel ${toneClass(column?.tone)}`.trim() },
        h("h4", { className: "chat-action-heading" }, normalizeText(column?.label || "Actions", 80)),
        h("ul", { className: "chat-action-list" }, (Array.isArray(column?.items) ? column.items.slice(0, 4) : []).map((item, itemIndex) => h("li", { key: itemIndex }, ...renderInlineMarkdown(normalizeText(item, 180))))))))
  );
}

function Watchouts({ card }) {
  return h(
    ToolCard,
    { title: card?.title || "Watchouts", status: String(card?.tone || "caution").toUpperCase(), bodyClass: "chat-insight-card" },
    h("ul", { className: "chat-watchout-list" }, (Array.isArray(card?.items) ? card.items.slice(0, 4) : []).map((item, index) => h("li", { key: index }, ...renderInlineMarkdown(normalizeText(item, 180)))))
  );
}

function SourceHighlights({ card }) {
  const items = Array.isArray(card?.items) ? card.items.slice(0, 3) : [];
  if (!items.length) return null;
  const metrics = [
    { label: "Sources", value: String(items.length), tone: "good", detail: "Top retrieved" },
    { label: "Evidence", value: "Ranked", tone: "medium", detail: "By retrieval score" },
    { label: "Links", value: String(items.reduce((count, item) => count + (Array.isArray(item?.links) ? item.links.length : 0), 0)), tone: "medium", detail: "Available" },
    { label: "Use", value: "Context", tone: "good", detail: "Best anchors" },
  ];
  return h(
    ToolCard,
    { tool: "sources_card", title: card?.title || "Best sources", bodyClass: "chat-source-preview" },
    h(EvidenceArtifact, {
      card: { ...card, title: card?.title || "Best sources", body: "Top retrieved evidence anchors for this answer." },
      title: card?.title || "Best sources",
      metrics,
      sources: items,
    })
  );
}

function InsightCard({ block }) {
  const card = block?.data || {};
  const type = String(card?.type || "").toLowerCase();
  if (type === "visual_artifact") return h(VisualArtifact, { card });
  if (type === "dashboard_artifact") return h(DashboardArtifact, { card });
  if (type === "action_grid") return h(ActionGrid, { card });
  if (type === "watchouts") return h(Watchouts, { card });
  return null;
}

function MessageBlocks({ blocks, typewrite = false, threadId = null }) {
  const list = Array.isArray(blocks) ? blocks : [];
  const firstTextBlock = list.find((b) => b && b.type === "text");
  const firstTextFull = String(firstTextBlock?.text || "");
  // Only typewriter the prose BEFORE the first widget fence. If we let the
  // hook walk through the entire firstTextFull, it would silently "type" the
  // ~4k chars of hidden widget HTML after the prose ends, which made the
  // iframe appear a long beat after the last visible word. Cutting the target
  // at the first ``` means isComplete flips as soon as the prose is done, and
  // the segment-aware layout (with the WidgetFrame) renders immediately.
  const firstFenceIndex = firstTextFull.indexOf("```");
  const typeTarget =
    firstFenceIndex >= 0 && hasWidgetFences(firstTextFull)
      ? firstTextFull.slice(0, firstFenceIndex).replace(/\s+$/, "")
      : firstTextFull;
  // Hoist the typewriter to the parent so we know when to reveal cards.
  const visibleProse = useTypewriter(typeTarget, typewrite && !!firstTextBlock);
  const isComplete = !typewrite || !firstTextBlock || visibleProse.length >= typeTarget.length;
  return h(React.Fragment, null, list.map((block, index) => {
    if (!block || typeof block !== "object") return null;
    if (block.type === "text") {
      const isFirstText = block === firstTextBlock;
      if (isFirstText && typewrite && !isComplete) {
        // Still typing prose â€” render the partial prose substring only, with
        // the typing cursor. The widget is NOT in this text, so TextBlock's
        // pure-prose branch handles it.
        return h(TextBlock, { key: index, text: visibleProse, role: block.role || "assistant", typingActive: true, threadId });
      }
      // Prose done (or no typewriter) â€” hand TextBlock the full text so it
      // switches into the segment-aware layout and mounts the WidgetFrame.
      return h(TextBlock, { key: index, text: block.text, role: block.role || "assistant", threadId });
    }
    if (block.type === "tool_result" || block.type === "tool_use") {
      // Hold cards back until the typewriter finishes the prose.
      if (!isComplete) return null;
      return h(InsightCard, { key: index, block });
    }
    return null;
  }));
}

const SOURCES_FOOTER_VISIBLE_BY_DEFAULT = 3;

function SourcesFooter({ sources, onAskFollowUp }) {
  const items = Array.isArray(sources) ? sources : [];
  const [openSet, setOpenSet] = useState(() => new Set());
  const [listOpen, setListOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!items.length) return null;

  const hiddenCount = Math.max(0, items.length - SOURCES_FOOTER_VISIBLE_BY_DEFAULT);
  const allOpen = openSet.size === items.length;

  const toggleRow = (i) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const handleChipClick = (i) => {
    if (i >= SOURCES_FOOTER_VISIBLE_BY_DEFAULT) setListOpen(true);
    toggleRow(i);
  };

  const handleExpandAll = () => {
    if (allOpen) {
      setOpenSet(new Set());
    } else {
      setListOpen(true);
      setOpenSet(new Set(items.map((_, i) => i)));
    }
  };

  const handleCopyAll = async () => {
    const lines = items.map((s, i) => {
      const title = s?.title || "Untitled source";
      const year = s?.year || s?.publication_year || s?.published_at || "";
      const metaParts = [year ? String(year).slice(0, 4) : null, s?.journal || null].filter(Boolean);
      const url = formatCitationUrl(s) || "";
      const suffix = [metaParts.join(" · "), url].filter(Boolean).join(" — ");
      return `[${i + 1}] ${title}${suffix ? " — " + suffix : ""}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {
      /* clipboard API unavailable — silent */
    }
  };

  return h(
    "section",
    { className: "msg-sources", "aria-label": "Sources" },
    h(
      "div",
      { className: "srcs-head" },
      h("span", { className: "srcs-lbl" }, `Sources · ${items.length}`),
      h("span", { className: "srcs-spacer" }),
      h(
        "button",
        { type: "button", className: "srcs-head-btn", onClick: handleExpandAll },
        allOpen ? "Collapse all" : "Expand all"
      ),
      h("span", { className: "srcs-head-sep", "aria-hidden": true }, "·"),
      h(
        "button",
        { type: "button", className: "srcs-head-btn", onClick: handleCopyAll },
        copied ? "Copied ↗" : "Copy all ↗"
      )
    ),
    items.length > 1
      ? h(
          "div",
          { className: "srcs-chips" },
          items.map((_, i) =>
            h(
              "button",
              {
                key: i,
                type: "button",
                className: `srcs-chip${openSet.has(i) ? " is-open" : ""}`,
                onClick: () => handleChipClick(i),
                "aria-label": `Jump to source ${i + 1}`,
              },
              String(i + 1)
            )
          )
        )
      : null,
    h(
      "ul",
      { className: `srcs-rows${listOpen ? "" : " is-collapsed"}` },
      items.map((source, i) => {
        const isOpen = openSet.has(i);
        const isHidden = i >= SOURCES_FOOTER_VISIBLE_BY_DEFAULT;
        const title = source?.title || "Untitled source";
        const year = source?.year || source?.publication_year || source?.published_at || "";
        const metaParts = [];
        if (year) metaParts.push(String(year).slice(0, 4));
        if (source?.journal) metaParts.push(source.journal);
        const meta = metaParts.join(" · ");
        const snippet = source?.why_it_matters || source?.excerpt || source?.summary || "";
        const links = citationLinks(source);
        return h(
          "li",
          {
            key: `${source?.pmid || source?.doi || i}`,
            className: isHidden ? "is-hidden" : "",
          },
          h(
            "div",
            {
              className: `srcs-row${isOpen ? " is-open" : ""}`,
              onClick: () => toggleRow(i),
              role: "button",
              tabIndex: 0,
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleRow(i);
                }
              },
            },
            h("span", { className: "idx" }, `[${i + 1}]`),
            h(
              "span",
              { className: "headline" },
              h("span", { className: "ttl" }, title),
              meta ? h("span", { className: "meta" }, meta) : null
            ),
            h(
              "span",
              { className: "mini-links" },
              links.map((link) =>
                h(
                  "a",
                  {
                    key: link.label,
                    className: "mini-link",
                    href: link.href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    onClick: (e) => e.stopPropagation(),
                  },
                  `${link.label} ↗`
                )
              ),
              h("span", { className: "caret", "aria-hidden": true }, "▸")
            )
          ),
          h(
            "div",
            { className: `srcs-detail${isOpen ? " is-open" : ""}` },
            snippet ? h("p", null, snippet) : null,
            h(
              "div",
              { className: "cite-actions" },
              links.map((link) =>
                h(
                  "a",
                  {
                    key: link.label,
                    className: "cite-action cite-action-link",
                    href: link.href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  `${link.label} ↗`
                )
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "cite-action cite-action-followup",
                  onClick: () => onAskFollowUp?.(source),
                },
                "Ask follow-up"
              )
            )
          )
        );
      })
    ),
    hiddenCount > 0
      ? h(
          "button",
          {
            type: "button",
            className: "srcs-more",
            onClick: () => setListOpen((v) => !v),
          },
          listOpen
            ? "Show fewer sources ↑"
            : h(
                React.Fragment,
                null,
                "Show ",
                h("span", { className: "n" }, String(hiddenCount)),
                " more sources ↓"
              )
        )
      : null
  );
}

const Message = React.memo(function Message({
  message,
  typewrite = false,
  threadId = null,
  chatV2On = false,
  onRegenerate,
  onSavePlan,
  onSwapMeal,
  onExport,
  onAskFollowUp,
}) {
  // Choose rendering strategy:
  // 1. toolResults present â†’ SSE path (prose + structured tool outputs)
  // 2. blocks array â†’ legacy fence-parsed path
  // 3. html â†’ legacy structured-HTML dump
  // 4. plain text fallback
  const hasToolResults = message.toolResults && typeof message.toolResults === "object" && Object.keys(message.toolResults).length > 0;
  const showSourcesFooter =
    chatV2On &&
    message.role === "assistant" &&
    Array.isArray(message.sources) &&
    message.sources.length > 0;
  return h(
    "article",
    { className: `message ${message.role}` },
    h("div", { className: "message-content" },
      hasToolResults
        ? h(TextBlock, { text: readMessageText(message), role: message.role, typewrite, threadId, toolResults: message.toolResults })
        : Array.isArray(message.blocks)
          ? h(MessageBlocks, { blocks: message.blocks, typewrite, threadId })
          : message.html
            ? h("div", { className: "message-html", dangerouslySetInnerHTML: { __html: message.html } })
            : h(TextBlock, { text: readMessageText(message), role: message.role, typewrite, threadId })),
    showSourcesFooter
      ? h(SourcesFooter, { sources: message.sources, onAskFollowUp })
      : null,
    chatV2On && message.role === "assistant"
      ? h(MessageActions, {
          message,
          onRegenerate,
          onSavePlan,
          onSwapMeal,
          onExport,
        })
      : null,
  );
}, (prevProps, nextProps) =>
  prevProps.message === nextProps.message &&
  prevProps.typewrite === nextProps.typewrite &&
  prevProps.threadId === nextProps.threadId &&
  prevProps.chatV2On === nextProps.chatV2On &&
  prevProps.onRegenerate === nextProps.onRegenerate &&
  prevProps.onSavePlan === nextProps.onSavePlan &&
  prevProps.onSwapMeal === nextProps.onSwapMeal &&
  prevProps.onExport === nextProps.onExport &&
  prevProps.onAskFollowUp === nextProps.onAskFollowUp
);

// Right-rail sources card. Displays up to 4 attached sources for the
// currently active assistant message. Intentionally thin â€” title, one-line
// meta (journal / year / pub type), short excerpt, and a "Read" link
// when we have a URL. The model is instructed to NEVER inline citations
// in the chat prose (see instructions in api/emersus/workflow.js), so
// this panel is the single place sources appear.
function SourcesRailCard({ sources, chatV2On = false, onAskFollowUp }) {
  const items = Array.isArray(sources) ? sources.slice(0, 6) : [];
  if (!items.length) {
    return h(
      "section",
      { className: "rail-card" },
      h("h3", { className: "rail-title" }, "Sources"),
      h(
        "p",
        { className: "rail-metric-note", style: { textTransform: "none", letterSpacing: "normal" } },
        "No sources attached to this answer yet."
      )
    );
  }
  return h(
    "section",
    { className: "rail-card" },
    h("h3", { className: "rail-title" }, `Sources Â· ${items.length}`),
    h(
      "ul",
      { className: "source-list" },
      items.map((source, index) => {
        const title = normalizeText(source?.title || "Untitled source", 160);
        const metaParts = [];
        const year = source?.year || source?.publication_year || source?.published_at || "";
        if (year) metaParts.push(String(year).slice(0, 4));
        if (source?.journal) metaParts.push(normalizeText(source.journal, 80));
        const pubType =
          source?.publication_type ||
          source?.evidence_level ||
          (Array.isArray(source?.publication_types) ? source.publication_types.join(", ") : "");
        if (pubType) metaParts.push(normalizeText(pubType, 60));
        const meta = metaParts.join(" Â· ");
        const snippet = normalizeText(
          source?.why_it_matters || source?.excerpt || source?.summary || "",
          240
        );
        const href = formatCitationUrl(source) || "";
        const v2Links = chatV2On ? citationLinks(source) : [];
        return h(
          "li",
          { key: `${source?.pmid || source?.doi || index}`, className: "source-item" },
          h("strong", null, title),
          meta ? h("div", { className: "source-meta" }, meta) : null,
          snippet ? h("div", { className: "source-snippet" }, snippet) : null,
          chatV2On
            ? h(
                "div",
                { className: "cite-actions" },
                v2Links.map((link) =>
                  h(
                    "a",
                    {
                      key: link.label,
                      className: "cite-action cite-action-link",
                      href: link.href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                    `${link.label} ↗`,
                  ),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "cite-action cite-action-followup",
                    onClick: () => onAskFollowUp?.(source),
                  },
                  "ASK FOLLOW-UP",
                ),
              )
            : href
              ? h(
                  "div",
                  { className: "source-links" },
                  h(
                    "a",
                    { href, target: "_blank", rel: "noopener noreferrer" },
                    "Read source â†—"
                  )
                )
              : null
        );
      })
    )
  );
}

function RailMetric({ label, value, note, width = "0%", tone = "" }) {
  return h("div", { className: "rail-metric" },
    h("div", { className: "rail-metric-head" },
      h("div", null, h("p", { className: "rail-metric-label" }, label), h("p", { className: "rail-metric-value" }, value)),
      h("span", { className: "rail-metric-note" }, note)),
    h("div", { className: `rail-spark ${tone}`.trim(), style: { "--spark-width": width } }));
}

function ThinkingGlyph({ state = "idle", size = 64, color = "#534AB7" }) {
  const canvasRef = useRef(null);
  const glyphRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    glyphRef.current = createThinkingGlyph(canvasRef.current, { size, color, state });
    return () => {
      glyphRef.current?.destroy();
      glyphRef.current = null;
    };
  }, [size, color]);

  useEffect(() => {
    glyphRef.current?.setState(state);
  }, [state]);

  const labelText = state === "thinking" ? "Thinking" : state === "responding" ? "Responding" : "";

  return h(
    "div",
    {
      className: "thinking-glyph-mount",
      "data-state": state,
      "aria-hidden": true,
    },
    h("canvas", { ref: canvasRef }),
    h("span", { className: "thinking-glyph-label" }, labelText)
  );
}

// ChatApp powers the main authenticated chat experience.
export function ChatApp() {
  const [session, setSession] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [historyHidden, setHistoryHidden] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("");
  const [question, setQuestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(DEFAULT_VISIBLE_MESSAGE_COUNT);
  const [glyphState, setGlyphState] = useState("idle");
  const [streamingMessageKey, setStreamingMessageKey] = useState("");
  const [onboardingActive, setOnboardingActive] = useState(false);
  const statusRef = useRef(null);
  const canvasRef = useRef(null);
  const submitQuestionRef = useRef(null);
  const activeThreadIdRef = useRef(activeThreadId);
  const chatHistoryRef = useRef(chatHistory);
  const threadLoadPromisesRef = useRef(new Map());
  // Holds the in-flight AbortController so the chat_v2 Stop button can cancel
  // the SSE stream mid-flight. Cleared in submitQuestion's finally block.
  const streamAbortRef = useRef(null);

  const activeThread = useMemo(() => chatHistory.find((threadData) => threadData.id === activeThreadId) || null, [activeThreadId, chatHistory]);
  const activeMessages = Array.isArray(activeThread?.messages) ? activeThread.messages : [];
  const visibleMessageStartIndex = Math.max(0, activeMessages.length - visibleMessageCount);
  const visibleMessages = activeMessages.slice(visibleMessageStartIndex);
  const hiddenMessageCount = visibleMessageStartIndex;
  const activeThreadNeedsHydration = !!activeThread && activeThread.isHydrated === false;

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    setStatus(statusRef.current, statusTone, statusMessage);
  }, [statusTone, statusMessage]);

  useEffect(() => {
    canvasRef.current?.scrollTo({ top: canvasRef.current.scrollHeight, behavior: "smooth" });
  }, [activeThread?.messages?.length, activeThreadId]);

  // When the user navigates to a different thread, clear streamingMessageKey
  // so the previous thread's last assistant message doesn't re-typewriter
  // itself when we navigate back to it. streamingMessageKey is only set
  // during a fresh submit (which happens within the SAME thread), so this
  // effect only fires on manual thread switches and "new chat" actions â€”
  // never mid-submit.
  const previousThreadIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    if (previousThreadIdRef.current !== activeThreadId) {
      previousThreadIdRef.current = activeThreadId;
      setStreamingMessageKey("");
      setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
      setChatHistory((history) =>
        history.map((thread) => {
          if (thread.id === activeThreadId || thread.isHydrated === false) {
            return thread;
          }
          return dehydrateThreadForHistory(thread);
        })
      );
    }
  }, [activeThreadId]);

  async function hydrateThread(threadId) {
    if (!threadId || !session?.user?.id) return null;
    const currentThread = chatHistoryRef.current.find((thread) => thread.id === threadId) || null;
    if (!currentThread || currentThread.isHydrated !== false) {
      return currentThread;
    }
    const existingPromise = threadLoadPromisesRef.current.get(threadId);
    if (existingPromise) {
      return existingPromise;
    }
    setChatHistory((history) =>
      patchThreadInHistory(history, threadId, (thread) =>
        thread.isHydrated === false && !thread.isHydrating ? { ...thread, isHydrating: true } : thread
      )
    );
    const loadPromise = getChatThread(session.user.id, threadId)
      .then((row) => {
        if (!row) {
          const fallbackThread = activeThreadIdRef.current === threadId
            ? {
                ...currentThread,
                isHydrated: true,
                isHydrating: false,
              }
            : dehydrateThreadForHistory(currentThread);
          setChatHistory((history) => mergeThreadIntoHistory(history, fallbackThread));
          return fallbackThread;
        }
        const mapped = mapSavedThread(row);
        const nextThread = activeThreadIdRef.current === threadId
          ? mapped
          : dehydrateThreadForHistory(mapped);
        setChatHistory((history) => mergeThreadIntoHistory(history, nextThread));
        return nextThread;
      })
      .catch((error) => {
        setChatHistory((history) =>
          patchThreadInHistory(history, threadId, (thread) => ({ ...thread, isHydrating: false }))
        );
        throw error;
      })
      .finally(() => {
        threadLoadPromisesRef.current.delete(threadId);
      });
    threadLoadPromisesRef.current.set(threadId, loadPromise);
    return loadPromise;
  }

  // Widget -> parent bridge. Widgets inside sandboxed iframes call
  // window.sendPrompt(text), which posts an "emersus:sendPrompt" message
  // to the parent. We feed that text into submitQuestion the same as if
  // the user typed it. The ref pattern avoids stale closures over
  // submitQuestion / isSubmitting.
  useEffect(() => {
    function handleMessage(event) {
      const data = event && event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "emersus:sendPrompt") return;
      const prompt = String(data.prompt || "").trim();
      if (!prompt) return;
      setQuestion(prompt);
      const submit = submitQuestionRef.current;
      if (typeof submit === "function") {
        submit(null, prompt);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const authSession = await requireAuth();
      if (!authSession || cancelled) return;
      setSession(authSession);
      let openPlanId = "";
      let currentUrl = null;
      try {
        currentUrl = new URL(window.location.href);
        openPlanId = currentUrl.searchParams.get("open_plan") || "";
      } catch (error) {
        console.error("Failed to parse chat URL:", error);
      }
      // Check if user needs onboarding.
      const userProfile = await getProfile(authSession.user.id);
      if (cancelled) return;
      const needsOnboarding = !userProfile || userProfile.onboarding_completed === false;
      setOnboardingActive(needsOnboarding);
      const rows = await listChatThreadSummaries(authSession.user.id);
      if (cancelled) return;
      const loaded = rows.map(mapSavedThread);
      if (loaded.length) {
        if (openPlanId) {
          const attachedThread = createEmptyThread();
          attachedThread.threadState = {
            ...attachedThread.threadState,
            active_workout_plan_id: openPlanId,
          };
          attachedThread.title = "Adjust plan";
          setChatHistory([attachedThread, ...loaded].slice(0, MAX_HISTORY_ITEMS));
          setActiveThreadId(attachedThread.id);
          await upsertChatThread(authSession.user.id, attachedThread);
        } else if (needsOnboarding) {
          setChatHistory(loaded);
          setActiveThreadId(loaded[0].id);
        } else {
          // Returning users should land on a clean composer instead of
          // being dropped into the most recent thread by default.
          const freshThread = createEmptyThread();
          setChatHistory([freshThread, ...loaded].slice(0, MAX_HISTORY_ITEMS));
          setActiveThreadId(freshThread.id);
        }
      } else {
        const firstThread = createEmptyThread();
        if (openPlanId) {
          firstThread.threadState = {
            ...firstThread.threadState,
            active_workout_plan_id: openPlanId,
          };
          firstThread.title = "Adjust plan";
        }
        setChatHistory([firstThread]);
        setActiveThreadId(firstThread.id);
        await upsertChatThread(authSession.user.id, firstThread);
      }

      // Auto-trigger onboarding for new users on their first empty thread.
      if (needsOnboarding) {
        setTimeout(() => {
          const submit = submitQuestionRef.current;
          if (typeof submit === "function") {
            submit(null, "__onboarding_start__");
          }
        }, 300);
      }

      // Deep link from /app/workout/<id>: open a fresh chat thread already
      // "attached" to a saved workout plan so the user can type natural
      // adjustment requests ("I missed Friday") and the backend loads the
      // plan into current_workout_plan automatically. We always open a new
      // thread rather than mutating the most recent one â€” the user's
      // latest chat might be about something unrelated.
      if (openPlanId && currentUrl) {
        // Clean the URL so a page reload doesn't keep spawning threads.
        currentUrl.searchParams.delete("open_plan");
        window.history.replaceState({}, "", currentUrl.toString());
      }
    }
    boot().catch((error) => {
      console.error(error);
      setStatusTone("error");
      setStatusMessage(error.message || "Unable to load chat.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeThreadId || !session?.user?.id || !activeThreadNeedsHydration) {
      return undefined;
    }
    let cancelled = false;
    hydrateThread(activeThreadId).catch((error) => {
      if (cancelled) return;
      console.error("Failed to hydrate chat thread:", error);
      setStatusTone("error");
      setStatusMessage(error.message || "Unable to load conversation.");
    });
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, activeThreadNeedsHydration, session?.user?.id]);

  // Expose a "workout plan action happened" hook to <WorkoutPlanCard> via
  // the module-level ref. The card calls workoutPlanActionRef.current({ type, planId })
  // after a successful save/update so the chat thread can stamp
  // active_workout_plan_id. Without this the next user message ("I missed
  // Friday") would have no active plan to reason about, and Emersus would
  // have to guess from the chat history.
  useEffect(() => {
    workoutPlanActionRef.current = async function handleWorkoutPlanAction(action) {
      if (!action || !action.planId) return;
      const nextPlanId = action.type === "updated" || action.type === "saved" ? action.planId : "";

      setChatHistory((history) => {
        if (!history.length) return history;
        return history.map((thread) => {
          if (thread.id !== activeThreadId) return thread;
          return {
            ...thread,
            threadState: {
              ...(thread.threadState || createEmptyThreadState()),
              active_workout_plan_id: nextPlanId,
            },
            updatedAt: new Date().toISOString(),
          };
        });
      });

      // Persist the change so reloading the chat keeps the active plan.
      // We re-read chatHistory via a functional update above; for persist
      // we need a stable snapshot. Grab it from the latest closure.
      try {
        if (!session?.user?.id) return;
        const target = chatHistory.find((t) => t.id === activeThreadId);
        if (!target) return;
        const stamped = {
          ...target,
          threadState: {
            ...(target.threadState || createEmptyThreadState()),
            active_workout_plan_id: nextPlanId,
          },
          updatedAt: new Date().toISOString(),
        };
        await upsertChatThread(session.user.id, stamped);
      } catch (error) {
        console.error("Failed to persist active_workout_plan_id:", error);
      }
    };
    return () => {
      workoutPlanActionRef.current = null;
    };
  }, [activeThreadId, chatHistory, session]);

  async function persistThread(nextThread) {
    const normalizedMessages = normalizeMessageRecords(nextThread.messages);
    const normalizedThread = {
      ...nextThread,
      messages: normalizedMessages,
    };
    const savedThread = {
      ...normalizedThread,
      title: deriveThreadTitle(normalizedThread),
      preview: deriveThreadPreview(normalizedThread),
      updatedAt: new Date().toISOString(),
      isHydrated: true,
      isHydrating: false,
    };
    setChatHistory((history) => mergeThreadIntoHistory(history, savedThread, { promote: true }));
    if (session?.user?.id) {
      const saved = await upsertChatThread(session.user.id, savedThread);
      const mapped = mapSavedThread(saved);
      setChatHistory((history) =>
        mergeThreadIntoHistory(
          history,
          activeThreadIdRef.current === mapped.id ? mapped : dehydrateThreadForHistory(mapped),
          { promote: true }
        )
      );
      return mapped;
    }
    return savedThread;
  }

  function startNewChat() {
    const threadData = createEmptyThread();
    setActiveThreadId(threadData.id);
    setChatHistory((history) => [threadData, ...history].slice(0, MAX_HISTORY_ITEMS));
    setQuestion("");
    setStatusTone("");
    setStatusMessage("");
  }

  async function submitQuestion(event, promptOverride) {
    event?.preventDefault();
    const source = promptOverride != null ? String(promptOverride) : String(question || "");
    const trimmed = source.trim();
    if (!trimmed) {
      setStatusTone("error");
      setStatusMessage("Type a question first.");
      return;
    }
    if (isSubmitting) return;

    let baseThread = activeThread || createEmptyThread();
    if (baseThread.isHydrated === false) {
      try {
        baseThread = (await hydrateThread(baseThread.id)) || baseThread;
      } catch (error) {
        setStatusTone("error");
        setStatusMessage(error.message || "Unable to load conversation.");
        return;
      }
    }
    if (baseThread.isHydrated === false) {
      setStatusTone("error");
      setStatusMessage("Conversation is still loading. Please try again.");
      return;
    }
    const isOnboardingTrigger = trimmed === "__onboarding_start__";
    // Don't show the onboarding trigger as a visible user message.
    const threadWithUser = isOnboardingTrigger
      ? baseThread
      : (() => {
          const userMessage = normalizeMessageRecord({
            role: "user",
            text: trimmed,
            plainText: trimmed,
            createdAt: new Date().toISOString(),
          });
          return {
            ...baseThread,
            messages: [...(baseThread.messages || []), userMessage],
            threadState: deriveThreadState(baseThread, trimmed, ""),
          };
        })();

    setQuestion("");
    setIsSubmitting(true);
    setGlyphState("thinking");
    setStreamingMessageKey("");
    setActiveThreadId(threadWithUser.id);
    setChatHistory((history) => mergeThreadIntoHistory(history, threadWithUser, { promote: true }));
    let persistedThread = await persistThread(threadWithUser);

    // AbortController wires the chat_v2 Stop button to the SSE fetch. The
    // server's stream.js closes the OpenAI upstream on `res.on("close")`.
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      const requestBody = {
        question: trimmed,
        threadId: persistedThread.id,
        userId: session?.user?.id ? `supabase:${session.user.id}` : "",
        threadState: persistedThread.threadState,
        recentMessages: buildRecentMessages(persistedThread.messages),
      };

      // The backend returns EITHER:
      //   â€¢ application/json â€” ShortCircuit responses (onboarding, guardrail
      //     refusal). Handled exactly like the old single-JSON code path.
      //   â€¢ text/event-stream â€” SSE with prose/tool/tool_error/done events.
      //     Prose is streamed into the chat bubble in real-time; tool results
      //     and sources arrive as discrete events and are attached to the
      //     final message.
      let data;
      const authHeaders = { "Content-Type": "application/json" };
      if (session?.access_token) {
        authHeaders["Authorization"] = `Bearer ${session.access_token}`;
      }
      const response = await fetch("/api/emersus/recommendation", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.message || "Unable to generate a recommendation.");
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();

      if (contentType.includes("text/event-stream")) {
        // Create a placeholder assistant message so prose appears in
        // real-time as delta events arrive.
        const streamCreatedAt = new Date().toISOString();
        let accumulatedProse = "";
        let renderedProse = "";
        let proseFlushTimer = null;
        const toolResults = {};
        const toolErrors = [];
        let sseSources = [];
        let sseUsage = {};
        let sseThreadState = null;
        let sseOnboardingCompleted = false;
        let sseConfidence = null;
        const flushAccumulatedProse = ({ force = false } = {}) => {
          const commit = () => {
            proseFlushTimer = null;
            if (renderedProse === accumulatedProse) return;
            renderedProse = accumulatedProse;
            setChatHistory((prev) =>
              updateStreamingAssistantText(prev, persistedThread.id, streamCreatedAt, renderedProse)
            );
          };
          if (force) {
            if (proseFlushTimer != null) {
              clearTimeout(proseFlushTimer);
              proseFlushTimer = null;
            }
            commit();
            return;
          }
          if (proseFlushTimer != null) return;
          proseFlushTimer = setTimeout(commit, 48);
        };

        // Insert the streaming placeholder into chat history immediately
        // so the user sees the bubble appear as prose arrives.
        const placeholderMessage = normalizeMessageRecord({
          role: "assistant",
          text: "",
          plainText: "",
          toolResults: {},
          sources: [],
          createdAt: streamCreatedAt,
        });
        const threadWithPlaceholder = {
          ...persistedThread,
          messages: [...(persistedThread.messages || []), placeholderMessage],
        };
        // Do NOT set streamingMessageKey here â€” SSE deltas ARE the
        // streaming animation. Setting it would trigger the typewriter
        // hook which fights the real-time delta updates (text flickers).
        setChatHistory((prev) =>
          mergeThreadIntoHistory(prev, threadWithPlaceholder, { promote: true })
        );
        setGlyphState("responding");

        await readSSEStream(response, {
          signal: abortController.signal,
          onEvent(event) {
            if (event.type === "prose") {
              accumulatedProse += event.delta || "";
              // Batch prose updates so tiny token bursts do not rewrite the
              // whole active thread state on every frame.
              flushAccumulatedProse();
            } else if (event.type === "tool") {
              toolResults[event.name] = event.data;
            } else if (event.type === "tool_error") {
              toolErrors.push({ name: event.name, errors: event.errors });
            } else if (event.type === "done") {
              sseSources = Array.isArray(event.sources) ? event.sources : [];
              sseUsage = event.usage || {};
              sseThreadState = event.thread_state || null;
              sseOnboardingCompleted = !!event.onboarding_completed;
              sseConfidence = event.confidence || null;
            }
          },
        });
        flushAccumulatedProse({ force: true });

        // Strip ~~~profile-update fences that may appear in streamed prose
        const cleanedProse = accumulatedProse
          .replace(/\n*~~~profile-update\s*\r?\n?[\s\S]*?(?:~~~|$)/g, "")
          .trim();

        // Synthesise a `data` object that matches the shape the rest of
        // the function expects (thread state, rail, persist, etc.).
        data = {
          answer_text: cleanedProse,
          sources: sseSources,
          token_usage: sseUsage,
          onboarding_completed: sseOnboardingCompleted,
          confidence: sseConfidence,
          // Carry tool results so the message builder below can attach them.
          _toolResults: Object.keys(toolResults).length ? toolResults : undefined,
          _toolErrors: toolErrors.length ? toolErrors : undefined,
          // If the backend sent an updated thread state, forward it.
          _sseThreadState: sseThreadState,
          // Flag so the post-stream code knows to skip the typewriter.
          _sse: true,
        };

        // Clear the streaming key so the placeholder stops being treated
        // as "currently streaming" once we build the final message below.
        setStreamingMessageKey("");
      } else {
        // â”€â”€ JSON path (ShortCircuit: onboarding / guardrail refusal) â”€â”€
        data = await response.json().catch(() => ({}));
      }
      // If the backend signals onboarding is complete, update local state
      // so the placeholder reverts and future messages go through normal flow.
      if (data.onboarding_completed) {
        setOnboardingActive(false);
      }
      setGlyphState("responding");

      const assistantRaw = String(data.answer_text || data.summary || "")
        .replace(/\n*~~~profile-update\s*\r?\n?[\s\S]*?(?:~~~|$)/g, "")
        .trim();

      // If the answer contains a widget fence (legacy path), route through
      // the segment-aware TextBlock + WidgetFrame pipeline. The legacy
      // structured-HTML dump path would otherwise hijack any answer
      // containing <div> (i.e. every widget) and render the fence markers
      // as literal prose.
      const hasFences = hasWidgetFences(assistantRaw);
      const structuredHtml = !hasFences && looksLikeStructuredHtml(assistantRaw)
        ? sanitizeAssistantHtml(assistantRaw)
        : "";
      const assistantPlainText = structuredHtml
        ? stripHtmlToPlainText(structuredHtml, 4000)
        : assistantRaw;

      // Build the assistant message. New SSE responses attach toolResults
      // directly; legacy JSON responses use the blocks/html path.
      const assistantMessage = normalizeMessageRecord({
        role: "assistant",
        ...(data._toolResults
          ? { text: assistantPlainText || normalizeText(assistantRaw, 4000), toolResults: data._toolResults }
          : structuredHtml
            ? { html: structuredHtml }
            : { blocks: buildAssistantBlocks(data) }),
        plainText: assistantPlainText || normalizeText(assistantRaw, 4000),
        text: assistantPlainText || normalizeText(assistantRaw, 4000),
        sources: Array.isArray(data.sources) ? data.sources : [],
        ...(data._toolErrors?.length ? { toolErrors: data._toolErrors } : {}),
        createdAt: new Date().toISOString(),
      });

      const nextThread = {
        ...persistedThread,
        messages: [...(persistedThread.messages || []), assistantMessage],
        threadState: (() => {
          const baseState = data._sseThreadState
            ? mergeThreadState(data._sseThreadState)
            : deriveThreadState(
                persistedThread,
                trimmed,
                assistantPlainText || data.summary || data.answer_text || ""
              );
          return {
            ...baseState,
            token_usage: mergeTokenUsage(
              persistedThread?.threadState?.token_usage,
              data.token_usage
            ),
          };
        })(),
        rail: (() => {
          const nextRail = railFromData(data);
          const mergedUsage = mergeTokenUsage(
            persistedThread?.threadState?.token_usage,
            data.token_usage
          );
          return {
            ...nextRail,
            tokenUsage: mergedUsage,
            totalTokens: mergedUsage.total_tokens,
            requestCount: mergedUsage.requests,
          };
        })(),
      };
      // For non-SSE responses (JSON onboarding/refusal), mark the message
      // as streaming so the typewriter animates. SSE responses already
      // streamed in real-time, so we always skip the typewriter for them.
      // data._sse is set by the SSE path above to distinguish from JSON.
      if (!data._sse) {
        setStreamingMessageKey(assistantMessage.createdAt);
      }
      persistedThread = await persistThread(nextThread);
    } catch (error) {
      // User-initiated aborts (chat_v2 Stop button) are expected, not errors.
      // The placeholder message already holds whatever prose streamed before
      // the abort, so we just flash a tiny status and leave the thread as-is.
      const aborted = error?.name === "AbortError" || abortController.signal.aborted;
      if (aborted) {
        setStatusTone("info");
        setStatusMessage("Generation stopped.");
      } else {
        const errorMessage = error.message || "Request failed.";
        await persistThread({
          ...persistedThread,
          messages: [
            ...(persistedThread.messages || []),
            normalizeMessageRecord({
              role: "assistant",
              text: errorMessage,
              plainText: errorMessage,
              createdAt: new Date().toISOString(),
            }),
          ],
          threadState: deriveThreadState(persistedThread, trimmed, errorMessage),
          rail: { ...(persistedThread.rail || {}), synthesisMode: "error" },
        });
        setStatusTone("error");
        setStatusMessage(errorMessage);
      }
    } finally {
      if (streamAbortRef.current === abortController) streamAbortRef.current = null;
      setIsSubmitting(false);
      setGlyphState("idle");
    }
  }

  // Keep the ref pointed at the latest submitQuestion closure so the
  // iframe-bridge listener in useEffect above can call it without
  // re-subscribing on every render. Safe to write during render: React
  // allows refs to be updated inline as long as the value is deterministic.
  submitQuestionRef.current = submitQuestion;

  const displayName = getDisplayName(session);
  const composerDisabled = isSubmitting || activeThreadNeedsHydration;
  const visibleMessageEntries = visibleMessages.map((message, index) => ({
    message,
    index: visibleMessageStartIndex + index,
  }));
  const rail = activeThread?.rail || {};
  const confidencePercent = typeof rail.confidencePercent === "number" ? rail.confidencePercent : Math.round(Math.max(0, Math.min(Number(rail.confidenceScore || 0), 1)) * 100);
  const latestAssistantSources = useMemo(() => {
    const msgs = activeThread?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && Array.isArray(msgs[i].sources) && msgs[i].sources.length) {
        return msgs[i].sources;
      }
    }
    // Backward compat: fall back to thread-level sources for old threads
    return Array.isArray(activeThread?.sources) ? activeThread.sources : [];
  }, [activeThread]);
  const sourceCount = Number(rail.sourceCount || latestAssistantSources.length || 0);

  // chat_v2 feature flag — resolved once on mount. Drives whether the new
  // ChatTopBar renders and the `.chat-main` uses the v2 chrome classes.
  const [chatV2On] = useState(() => resolveFlag("chat_v2"));
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // chat_v2 sidebar search — debounced 300ms via a separate state pair so the
  // input stays responsive while filtering recomputes only after typing pauses.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    if (!chatV2On) return undefined;
    const handle = window.setTimeout(() => setSearchQuery(searchInput), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, chatV2On]);

  // Listen for `emersus:seed-prompt` events — fired from inline widget
  // footers (e.g. MealPlanCard "Adjust meals") so they can seed the
  // composer without prop-drilling setQuestion through every renderer.
  useEffect(() => {
    function onSeed(event) {
      const prompt = String(event?.detail?.prompt || "").trim();
      if (!prompt) return;
      setQuestion(prompt);
    }
    window.addEventListener("emersus:seed-prompt", onSeed);
    return () => window.removeEventListener("emersus:seed-prompt", onSeed);
  }, []);

  // chat_v2 palette switcher — bind once after the swatches mount so theme.js
  // can wire click handlers + active-state tracking.
  const paletteRef = useRef(null);
  useEffect(() => {
    if (!chatV2On || !paletteRef.current) return undefined;
    bindSwitcher(paletteRef.current);
    return undefined;
  }, [chatV2On]);

  const handleRenameThread = useCallback(async (nextTitle) => {
    if (!activeThreadId || !session?.user?.id) return;
    const current = chatHistoryRef.current.find((t) => t.id === activeThreadId);
    if (!current || current.title === nextTitle) return;
    const nextThread = { ...current, title: nextTitle, updatedAt: new Date().toISOString() };
    setChatHistory((history) => patchThreadInHistory(history, activeThreadId, () => nextThread));
    try {
      await upsertChatThread(session.user.id, nextThread);
    } catch (error) {
      setStatusMessage(`Could not rename thread: ${error?.message || "unknown error"}`);
      setStatusTone("error");
    }
  }, [activeThreadId, session]);

  const handleModelChange = useCallback((modelId) => {
    if (!activeThreadId) return;
    setChatHistory((history) => patchThreadInHistory(history, activeThreadId, (t) => ({ ...t, model: modelId })));
    // Persistence to threads.model lands once the Phase 2 DB migration is applied.
  }, [activeThreadId]);

  const handleShareThread = useCallback(() => {
    if (!activeThreadId) return;
    setShareModalOpen(true);
  }, [activeThreadId]);

  const closeShareModal = useCallback(() => setShareModalOpen(false), []);

  const handleArchiveThread = useCallback(() => {
    setStatusTone("info");
    setStatusMessage("Archive action coming soon.");
  }, []);

  const handleDeleteThread = useCallback(() => {
    setStatusTone("info");
    setStatusMessage("Delete action coming soon.");
  }, []);

  const handleStopStreaming = useCallback(() => {
    const controller = streamAbortRef.current;
    if (!controller) return;
    controller.abort();
    streamAbortRef.current = null;
  }, []);

  // Phase 9: skip the conversational onboarding flow. Calls PATCH /api/profile
  // to set onboarding_completed=true server-side, then clears the local flag.
  const handleSkipOnboarding = useCallback(async () => {
    if (!session?.access_token) return;
    setOnboardingActive(false);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ onboarding_completed: true }),
      });
    } catch (err) {
      // Local state already cleared — server will catch up next reload.
      console.warn("skip-onboarding patch failed:", err);
    }
  }, [session]);

  // Regenerate: find the user message that preceded `message` and re-run
  // inference using its text. Uses submitQuestionRef so this closure stays
  // stable even after submitQuestion re-creates itself on re-renders.
  const handleRegenerateMessage = useCallback((message) => {
    if (isSubmitting) return;
    const thread = chatHistoryRef.current.find((t) => t.id === activeThreadIdRef.current);
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    const index = messages.findIndex((m) => m === message || m.createdAt === message?.createdAt);
    if (index <= 0) return;
    let parent = null;
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") { parent = messages[i]; break; }
    }
    if (!parent) return;
    const prompt = String(parent.text || parent.plainText || "").trim();
    if (!prompt) return;
    submitQuestionRef.current?.({}, prompt);
  }, [isSubmitting]);

  const handleSavePlanFromMessage = useCallback(() => {
    // Workout plans already expose their own Save button via WorkoutPlanCard;
    // this action is a hint for users scrolling the message actions row.
    setStatusTone("info");
    setStatusMessage("Use the Save plan button on the workout card below.");
  }, []);

  const handleSwapMealFromMessage = useCallback((message) => {
    const text = String(message?.text || message?.plainText || "").slice(0, 200);
    const seed = text
      ? `Swap a meal in the plan above. Keep the daily targets and show the updated cards.`
      : "Swap a meal in the plan above.";
    setQuestion(seed);
  }, []);

  const handleExportMessage = useCallback(() => {
    if (!activeThreadId) return;
    setShareModalOpen(true);
  }, [activeThreadId]);

  const handleAskSourceFollowUp = useCallback((source) => {
    const prompt = buildFollowUpPrompt(source);
    if (!prompt) return;
    setQuestion(prompt);
  }, []);

  return h("div", { className: `chat-app-shell${historyHidden ? " history-hidden" : ""}${chatV2On ? " chat-v2" : ""}` },
    h("aside", { className: "chat-nav" },
      h("div", { className: "chat-brand" },
        h("div", { className: "chat-brand-head" },
          // Clickable brand â€” takes you back to the public landing page.
          // Keep the same visual treatment as the old non-interactive <h1>
          // by styling the anchor as-is; site.css / chat/index.html already
          // carries .chat-brand-mark so we just reuse the class on an <a>.
          h(
            "a",
            {
              href: "/",
              className: "chat-brand-link",
              "aria-label": "Emersus AI home",
              style: { textDecoration: "none", color: "inherit", display: "block" },
            },
            h("h1", { className: "chat-brand-mark" },
              h("img", { src: "/emersus-logo.png", alt: "Emersus", style: { height: "38px", width: "auto" } })
            ),
            h("p", { className: "chat-brand-subtitle" }, "Evidence Layer Active")
          ),
          h("button", { className: "inline-button", type: "button", "aria-expanded": !historyHidden, "aria-label": "Toggle conversation history", onClick: () => setHistoryHidden((value) => !value) },
            historyHidden ? h(PanelLeftOpen, { size: 18 }) : h(PanelLeftClose, { size: 18 })))),
      chatV2On
        ? h("div", { className: "side-primary-row" },
            h("button", { className: "side-primary-btn", type: "button", onClick: startNewChat },
              h(Plus, { size: 16, "aria-hidden": true }),
              h("span", null, "New thread")),
            h("div", { className: "side-search" },
              h(Search, { size: 14, "aria-hidden": true, className: "side-search-icon" }),
              h("input", {
                type: "search",
                className: "side-search-input",
                placeholder: "Search emersus…",
                value: searchInput,
                onChange: (e) => setSearchInput(e.target.value),
                "aria-label": "Search threads",
              })))
        : null,
      chatV2On
        ? h("div", { className: "chat-side-sections" },
            h("div", { className: "chat-side-sections-label" }, "Sections"),
            h("a", { className: "chat-side-section is-active", href: "/app/" },
              h("span", { className: "chat-side-section-dot" }), "Chat"),
            h("a", { className: "chat-side-section", href: "/app/train/" },
              h("span", { className: "chat-side-section-dot" }), "Train"),
            h("a", { className: "chat-side-section", href: "/app/nutrition/" },
              h("span", { className: "chat-side-section-dot" }), "Nutrition"),
            h("a", { className: "chat-side-section", href: "/app/progress/" },
              h("span", { className: "chat-side-section-dot" }), "Progress"),
            h("a", { className: "chat-side-section", href: "/app/profile/" },
              h("span", { className: "chat-side-section-dot" }), "Profile"))
        : null,
      chatV2On
        ? (() => {
            const filtered = filterThreadsBySearch(chatHistory, searchQuery);
            const grouped = groupThreadsByDate(filtered);
            return h("div", { className: "chat-nav-list chat-nav-grouped", "aria-label": "Chat history" },
              GROUP_ORDER.map((bucket) => {
                const items = grouped[bucket];
                if (!items.length) return null;
                return h("div", { key: bucket, className: "chat-nav-group" },
                  h("div", { className: "chat-nav-group-label" }, bucket),
                  items.map((threadData) =>
                    h("button", {
                      key: threadData.id,
                      type: "button",
                      className: `chat-nav-link${threadData.id === activeThreadId ? " is-active" : ""}`,
                      onClick: () => setActiveThreadId(threadData.id),
                    },
                      h("span", null,
                        h("span", { className: "chat-nav-label" }, threadData.title || "New thread"),
                        h("span", { className: "chat-nav-meta" }, `${formatHistoryTime(threadData.updatedAt)} - ${threadData.preview || "No messages yet"}`)))),
                );
              }),
              !filtered.length
                ? h("div", { className: "chat-nav-empty" }, searchQuery ? "No matching threads." : "No threads yet.")
                : null,
            );
          })()
        : h("div", { className: "chat-nav-list", "aria-label": "Chat history" },
            chatHistory.map((threadData) =>
              h("button", { key: threadData.id, type: "button", className: `chat-nav-link${threadData.id === activeThreadId ? " is-active" : ""}`, onClick: () => setActiveThreadId(threadData.id) },
                h(History, { size: 17, "aria-hidden": true }),
                h("span", null,
                  h("span", { className: "chat-nav-label" }, threadData.title || "New chat"),
                  h("span", { className: "chat-nav-meta" }, `${formatHistoryTime(threadData.updatedAt)} - ${threadData.preview || "No messages yet"}`))))),
      // Cross-page nav row. The chat page was a dead-end before â€” no way to
      // get back to the dashboard, the workout planner, or anywhere else â€”
      // so these three anchors sit above the "New chat" button in the
      // sidebar footer and use the same .inline-button visual language.
      h("div", { className: "chat-nav-actions" },
        h(
          "a",
          {
            href: "/app/",
            className: "inline-button",
            "aria-label": "Go to dashboard",
            style: { textDecoration: "none", color: "inherit" },
          },
          h(PanelLeftOpen, { size: 16, "aria-hidden": true }),
          h("span", null, "Dashboard")
        ),
        h(
          "a",
          {
            href: "/app/workout/",
            className: "inline-button",
            "aria-label": "Open workout planner",
            style: { textDecoration: "none", color: "inherit" },
          },
          h(Activity, { size: 16, "aria-hidden": true }),
          h("span", null, "Workout planner")
        ),
        h("button", { className: "inline-button", type: "button", onClick: startNewChat }, h(Plus, { size: 18 }), h("span", null, "New chat"))),
      chatV2On
        ? h("div", { className: "chat-side-palette", ref: paletteRef, "aria-label": "Theme" },
            h("span", { className: "chat-side-palette-label" }, "Theme"),
            h("div", { className: "chat-side-palette-swatches" },
              h("button", { type: "button", className: "palette-swatch chat-side-swatch chat-side-swatch-mint", "data-theme-swatch": "mint", "aria-label": "Graphite · Jade (dark)" }),
              h("button", { type: "button", className: "palette-swatch chat-side-swatch chat-side-swatch-paper", "data-theme-swatch": "paper", "aria-label": "Paper · Royal (light)" })))
        : null,
      chatV2On
        ? (() => {
            const fullName = displayName || "—";
            const initials = String(fullName).split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
            return h("a", {
              className: "chat-side-user",
              href: "/app/profile/",
              "aria-label": "Open profile",
            },
              h("span", { className: "chat-side-user-avatar" }, initials),
              h("span", { className: "chat-side-user-meta" },
                h("span", { className: "chat-side-user-name" }, fullName),
                h("span", { className: "chat-side-user-plan" }, "PRIVATE BETA")),
              h("span", { className: "chat-side-user-menu" }, "⋯"));
          })()
        : null),
    historyHidden
      ? h("button", { className: "history-restore-button", type: "button", "aria-expanded": false, "aria-label": "Show conversation history", onClick: () => setHistoryHidden(false) },
          h(PanelLeftOpen, { size: 18 }))
      : null,
    h("main", { className: "chat-main" },
      chatV2On && onboardingActive
        ? h("div", { className: "onboarding-banner", role: "status" },
            h("span", { className: "onboarding-banner-eyebrow" }, "ONBOARDING"),
            h("span", { className: "onboarding-banner-copy" }, "Tell me a bit about yourself so I can personalize future advice."),
            h("button", {
              type: "button",
              className: "onboarding-banner-skip",
              onClick: handleSkipOnboarding,
            }, "Skip setup →"),
          )
        : null,
      chatV2On
        ? h(ChatTopBar, {
            thread: activeThread,
            onRename: handleRenameThread,
            onModelChange: handleModelChange,
            onShare: handleShareThread,
            onArchive: handleArchiveThread,
            onDelete: handleDeleteThread,
            sourceCount,
          })
        : null,
      h("div", { className: "chat-main-body" },
        h("section", { className: "conversation-canvas", ref: canvasRef },
          h("div", { className: `chat-thread${!activeMessages.length ? " is-empty" : ""}` },
            activeThreadNeedsHydration
              ? h("section", { className: "thread-welcome" },
                  h("p", { className: "thread-welcome-eyebrow" }, "Loading"),
                  h("h2", { className: "thread-welcome-title" }, activeThread?.title || "Conversation"),
                  h("p", { className: "thread-welcome-copy" }, "Fetching the full conversation so we can render the chat history without loading every thread up front."))
              : activeMessages.length
              ? [
                  hiddenMessageCount
                    ? h("div", { key: "load-earlier", style: { display: "flex", justifyContent: "center", marginBottom: "12px" } },
                        h("button", {
                          className: "inline-button",
                          type: "button",
                          onClick: () => setVisibleMessageCount((count) => Math.min(activeMessages.length, count + VISIBLE_MESSAGE_COUNT_STEP)),
                        }, `Load ${Math.min(VISIBLE_MESSAGE_COUNT_STEP, hiddenMessageCount)} earlier messages`))
                    : null,
                  ...visibleMessageEntries.map(({ message, index }) => h(Message, {
                    key: `${message.createdAt || ""}-${index}`,
                    message,
                    typewrite: message.role === "assistant" && message.createdAt === streamingMessageKey,
                    threadId: activeThread?.id || null,
                    chatV2On,
                    onRegenerate: handleRegenerateMessage,
                    onSavePlan: handleSavePlanFromMessage,
                    onSwapMeal: handleSwapMealFromMessage,
                    onExport: handleExportMessage,
                    onAskFollowUp: handleAskSourceFollowUp,
                  })),
                  h("article", { key: "persistent-glyph", className: "message assistant message-pending" },
                    h("div", { className: "message-content" },
                      h(ThinkingGlyph, { state: glyphState, size: 56, color: "#534AB7" }))),
                ]
              : h("section", { className: "thread-welcome" },
                  h("p", { className: "thread-welcome-eyebrow" }, "Emersus"),
                  h("h2", { className: "thread-welcome-title" }, `Welcome, ${displayName}`),
                  h("p", { className: "thread-welcome-copy" }, "Ask about training, nutrition, supplements, recovery, cardiovascular fitness, or metabolic health and I'll keep the answer evidence-aware."),
                  chatV2On
                    ? h(EmptyPrompts, {
                        profileId: session?.user?.id || "",
                        accessToken: session?.access_token || "",
                        onPick: (prompt) => setQuestion(prompt),
                      })
                    : null,
                )))),
      h("div", { className: "chat-composer-shell" },
        h("form", { className: "composer", onSubmit: submitQuestion },
          h("div", { className: "composer-row" },
            h("textarea", {
              id: "chat-question",
              name: "question",
              "aria-label": "Ask Emersus",
              placeholder: activeThreadNeedsHydration
                ? "Loading conversation..."
                : onboardingActive
                ? "Tell me about yourself..."
                : "Ask anything — training, nutrition, recovery, citations…",
              disabled: composerDisabled,
              value: question,
              onChange: (event) => setQuestion(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!composerDisabled) submitQuestion(event);
                }
              },
            }),
            h("div", { className: "composer-actions" },
              chatV2On && isSubmitting
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "stop-btn",
                      "aria-label": "Stop generating",
                      onClick: handleStopStreaming,
                    },
                    h("span", { className: "stop-btn-icon", "aria-hidden": true }, "■"),
                    h("span", { className: "stop-btn-label" }, "Stop"),
                  )
                : null,
              h("button", { className: "submit-orb", type: "submit", disabled: composerDisabled, "aria-label": "Send question" }, h(ArrowUp, { size: 21 })))),
          h("div", { className: "composer-utility-row" },
            h("div", { className: "composer-buttons" },
              chatV2On
                ? h("span", { className: "composer-hint" },
                    isSubmitting
                      ? "GENERATING…"
                      : h(React.Fragment, null,
                          h("kbd", null, "⏎"), " SEND · ",
                          h("kbd", null, "⇧⏎"), " NEWLINE"),
                  )
                : null,
            ),
            h("p", { className: "status-text", ref: statusRef }))))),
    h("aside", { className: "chat-rail" },
      h("section", { className: "rail-card" },
        h("h3", { className: "rail-title" }, "System status"),
        h("div", { className: "rail-metric-stack" },
          h(RailMetric, { label: "Confidence", value: `${confidencePercent}%`, note: rail.confidenceLabel || "Idle", width: `${Math.max(0, Math.min(Number(rail.confidenceScore || 0) * 100, 100))}%` }),
          h(RailMetric, { label: "Source count", value: String(sourceCount), note: "Attached", width: `${Math.max(10, Math.min(sourceCount * 16, 100))}%`, tone: "tone-medium" }))),
      h(SourcesRailCard, {
        sources: latestAssistantSources,
        chatV2On,
        onAskFollowUp: (source) => {
          const prompt = buildFollowUpPrompt(source);
          if (!prompt) return;
          setQuestion(prompt);
        },
      }),
      h("div", { className: "rail-foot" },
        h("div", { className: "rail-foot-line" }, h("span", null, "Pipeline"), h("span", null, "PubMed + PMC")),
        h("div", { className: "rail-foot-line" }, h("span", null, "Interface"), h("span", null, "React + Lucide")))),
    chatV2On
      ? h(ChatShareModal, {
          open: shareModalOpen,
          thread: activeThread,
          accessToken: session?.access_token || "",
          onClose: closeShareModal,
        })
      : null,
  );
}

// Default mount: the production /chat/ page has #chat-root in its HTML.
// Other pages can import this module for ChatApp and provide their own
// root, so skip the default render when #chat-root is missing.
const defaultRootEl = document.getElementById("chat-root");
if (defaultRootEl) {
  const root = createRoot(defaultRootEl);
  root.render(h(ChatApp));
}
