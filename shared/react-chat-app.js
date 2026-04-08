import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
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
} from "https://esm.sh/lucide-react@0.468.0?deps=react@18.2.0";
import {
  applyWorkoutPlanUpdate,
  getSession,
  listChatThreads,
  requireAuth,
  saveNewWorkoutPlan,
  setStatus,
  upsertChatThread,
} from "/shared/supabase.js";
import { createThinkingGlyph } from "/shared/thinking-glyph.js";
import {
  WidgetFrame,
  hasWidgetFences,
  parseLLMOutput,
  stripWidgetFencesForStreaming,
} from "/shared/emersus-renderer.js";
import {
  DAY_LABELS,
  summarizePlan,
} from "/shared/workout-plan-schema.js";
import { downloadPlanIcs } from "/shared/workout-plan-ics.js";
import { summarizePlanDiff } from "/shared/workout-plan-diff.js";

const h = React.createElement;
const MAX_HISTORY_ITEMS = 24;

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
  };
}

function questionLooksLikeFollowUp(question) {
  return /^(yes|yeah|yep|sure|please|do that|that one|sounds good|ok|okay|what about|how about|and for|compare that|compare it|does that|would that|what if|and if|for women|for men|for older adults|for beginners|for me)\b/i.test(
    String(question || "").trim()
  );
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
      text: normalizeText(message?.plainText || message?.text || "", 320),
    }))
    .filter((message) => message.role && message.text);
}

function buildAssistantBlocks(data) {
  // Preserve newlines so widget fences and paragraph boundaries survive into
  // parseLLMOutput / renderProseChunks. normalizeText collapses \s+ to single
  // spaces, which would flatten multi-paragraph prose and remove the newlines
  // that separate widget fences from surrounding prose.
  //
  // DO NOT slice this text. A typical comparison-widget answer is ~4–7k chars
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
  const source = sanitizeHistoryText(firstUserMessage?.text || firstUserMessage?.plainText || "", 80);
  if (!source) return "New chat";
  return source.length > 42 ? `${source.slice(0, 41).trim()}...` : source;
}

function deriveThreadPreview(threadData) {
  const latestAssistant = [...(threadData?.messages || [])].reverse().find((message) => message.role === "assistant");
  const fallback = (threadData?.messages || []).find((message) => message.role === "user");
  const source = sanitizeHistoryText(
    latestAssistant?.plainText || latestAssistant?.text || fallback?.text || "",
    80
  );
  if (!source) return "No messages yet";
  return source.length > 52 ? `${source.slice(0, 51).trim()}...` : source;
}

function mapSavedThread(row) {
  const normalizedThreadState = mergeThreadState(row.thread_state);
  const usage = normalizeTokenUsage(normalizedThreadState?.token_usage);
  return {
    id: row.id,
    title: row.title || "New chat",
    preview: row.preview || "No messages yet",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    rail: {
      ...(row.rail && typeof row.rail === "object" ? row.rail : {}),
      tokenUsage: usage,
      totalTokens: usage.total_tokens,
      requestCount: usage.requests,
    },
    threadState: normalizedThreadState,
  };
}

function railFromData(data = {}) {
  const confidenceScore = Number(data.confidence?.score || 0);
  const confidenceLabel = String(data.confidence?.label || "idle");
  const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
  const synthesisMode = data.debug?.synthesis_mode || (data.summary ? "synthesized" : "idle");
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
    setVisible("");
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(fullText.length, i + charsPerTick);
      setVisible(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(id);
    }, intervalMs);
    return () => clearInterval(id);
  }, [fullText, enabled, charsPerTick, intervalMs]);
  return visible;
}

// Tokenize an inline chunk into an array of React children, honoring basic
// markdown: **bold**, *italic* / _italic_, `inline code`. We do NOT run a full
// markdown pass — no links, no headings, no block quotes — because the model
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
// iframe sendPrompt bridge — avoids drilling an onSave prop through
// Message → MessageBlocks → TextBlock → WorkoutPlanCard.
const workoutPlanActionRef = { current: null };

function WorkoutPlanCard({ segment, threadId }) {
  const parseResult = segment && segment.content;
  const plan = parseResult && parseResult.ok ? parseResult.plan : null;

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  // Once the user clicks "Save plan" / "Apply update" / "Discard", we hide
  // the primary CTAs so the card doesn't offer a stale action. Download
  // stays available — the user might want the .ics after saving too.
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
            background: "var(--color-background-warning, #fff3d0)",
            border: "0.5px solid var(--color-border-tertiary, rgba(15,15,14,0.10))",
            borderRadius: "var(--border-radius-lg, 14px)",
            padding: 16,
            margin: "10px 0",
            color: "var(--color-text-warning, #6b4a00)",
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
        { style: { color: "var(--color-text-danger, #7a3300)" } },
        `Workout plan could not be parsed: ${parseResult.error || "invalid JSON"}`
      ),
      h(
        "pre",
        {
          style: {
            whiteSpace: "pre-wrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            color: "var(--color-text-tertiary, #8b8778)",
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
      setToast("ICS download started — works with Google, Apple, and Outlook.");
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
      background: "var(--color-background-secondary, #ffffff)",
      border: "0.5px solid var(--color-border-tertiary, rgba(15,15,14,0.10))",
      borderRadius: "var(--border-radius-lg, 14px)",
      padding: 18,
      margin: "10px 0",
    },
    header: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 },
    title: { fontSize: 15, fontWeight: 500, color: "var(--color-text-primary, #0f0f0e)" },
    subtitle: { fontSize: 12, color: "var(--color-text-secondary, #555248)" },
    chip: {
      display: "inline-block",
      fontSize: 11,
      fontWeight: 500,
      padding: "3px 8px",
      borderRadius: "var(--border-radius-sm, 4px)",
      background: isUpdate
        ? "var(--color-background-info, #dfeaf9)"
        : "var(--color-background-success, #e7f4d8)",
      color: isUpdate
        ? "var(--color-text-info, #1e3f72)"
        : "var(--color-text-success, #2f5a13)",
      marginTop: 4,
      width: "fit-content",
    },
    meta: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #8b8778)",
      marginTop: 2,
    },
    sessionsWrap: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      margin: "12px 0 14px",
      paddingTop: 10,
      borderTop: "0.5px solid var(--color-border-tertiary, rgba(15,15,14,0.10))",
    },
    sessionRow: {
      display: "grid",
      gridTemplateColumns: "52px 1fr auto",
      gap: 10,
      fontSize: 12,
      alignItems: "baseline",
      color: "var(--color-text-primary, #0f0f0e)",
    },
    sessionDay: {
      fontSize: 11,
      color: "var(--color-text-secondary, #555248)",
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
    sessionDuration: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #8b8778)",
    },
    moreHint: {
      fontSize: 11,
      color: "var(--color-text-tertiary, #8b8778)",
      marginTop: 2,
    },
    diffWrap: {
      fontSize: 11,
      color: "var(--color-text-secondary, #555248)",
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
      border: "0.5px solid var(--color-border-tertiary, rgba(15,15,14,0.10))",
      borderRadius: "var(--border-radius-md, 8px)",
      background: "var(--color-background-primary, #fafaf9)",
      color: "var(--color-text-primary, #0f0f0e)",
      fontSize: 12,
      fontWeight: 500,
      cursor: busy ? "wait" : "pointer",
      opacity: busy ? 0.6 : 1,
    },
    buttonPrimary: {
      background: "var(--color-text-primary, #0f0f0e)",
      color: "var(--color-background-primary, #fafaf9)",
      borderColor: "var(--color-text-primary, #0f0f0e)",
    },
    buttonDisabled: { opacity: 0.4, cursor: "not-allowed" },
    toast: {
      fontSize: 11,
      color: "var(--color-text-success, #2f5a13)",
      marginTop: 8,
    },
    error: {
      fontSize: 11,
      color: "var(--color-text-danger, #7a3300)",
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
      meta.length ? h("div", { style: style.meta }, meta.join(" · ")) : null,
      h("span", { style: style.chip }, isUpdate ? "Plan update" : "New plan")
    ),
    isUpdate && diffLines.length
      ? h(
          "div",
          { style: style.diffWrap },
          diffLines.join(" · ")
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
                      { style: { fontSize: 11, color: "var(--color-text-tertiary, #8b8778)" } },
                      session.summary
                    )
                  : null
              ),
              h(
                "div",
                { style: style.sessionDuration },
                session.start_time ? `${session.start_time} · ${session.duration_minutes || 60}m` : ""
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
              style: { color: "var(--color-text-primary, #0f0f0e)", textDecoration: "underline" },
            },
            "Open workout planner →"
          )
        )
      : null
  );
}

function TextBlock({ text, role = "assistant", typewrite = false, typingActive = false, threadId = null }) {
  const fullText = String(text || "");
  const visible = useTypewriter(fullText, typewrite);
  const isTyping = typingActive || (typewrite && visible.length < fullText.length);
  const display = typewrite ? visible : fullText;

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
    return `<section class="art-stage"><svg viewBox="0 0 900 420" role="img" aria-label="${escapeHtml(card?.title || "Illustration")}"><rect width="900" height="420" fill="#0b1726"/><circle cx="740" cy="86" r="58" fill="#d8cf7a"/><circle cx="705" cy="68" r="58" fill="#0b1726"/><polygon points="0,320 150,150 310,300 500,120 720,285 900,135 900,420 0,420" fill="#18365f"/><polygon points="0,350 210,245 430,350 590,225 760,330 900,260 900,420 0,420" fill="#25486f"/><polygon points="0,365 900,365 900,420 0,420" fill="#0a1b2b"/><g fill="#d8cf7a">${Array.from({ length: 18 }, (_, index) => `<circle cx="${50 + index * 46}" cy="${30 + (index % 5) * 28}" r="2"/>`).join("")}</g></svg></section>`;
  }
  return `<section class="art-stage"><svg viewBox="0 0 900 420" role="img" aria-label="${escapeHtml(card?.title || "Illustration")}"><rect width="900" height="420" fill="#11110f"/><g fill="none" stroke="#d8b46a" stroke-width="2" opacity=".7">${Array.from({ length: 8 }, (_, index) => `<circle cx="${160 + index * 80}" cy="210" r="${36 + index * 12}"/>`).join("")}</g><path d="M80 300 C220 120, 340 350, 500 180 S740 110, 820 290" stroke="#85adff" stroke-width="18" fill="none" opacity=".55"/><g fill="#9ffb00" opacity=".65">${Array.from({ length: 28 }, (_, index) => `<circle cx="${60 + (index * 67) % 820}" cy="${55 + (index * 41) % 310}" r="${2 + (index % 4)}"/>`).join("")}</g></svg></section>`;
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
    :root { color-scheme: dark; --bg:#11110f; --panel:#191917; --ink:#f4f1e8; --muted:#aaa59a; --line:#3a3833; --accent:#d8b46a; --green:#9ffb00; --blue:#85adff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 12% 0%, rgba(216,180,106,.16), transparent 32%), linear-gradient(135deg,#11110f,#171613); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .vis-container { padding: 18px; min-height: 100%; }
    .section-label { margin: 0 0 10px; color: var(--muted); font-size: 12px; letter-spacing: .02em; }
    .hero { display: grid; gap: 10px; padding: 18px; border-radius: 18px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
    h1 { margin: 0; max-width: 760px; color: var(--ink); font-size: clamp(22px, 3.3vw, 38px); line-height: 1.02; letter-spacing: -.045em; }
    .body { margin: 0; max-width: 760px; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; margin-top: 14px; }
    .metric { min-height: 112px; display: grid; align-content: end; gap: 5px; padding: 14px; border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.075); position: relative; overflow: hidden; }
    .metric::before { content:""; position:absolute; inset:auto 12px 12px auto; width:48px; height:48px; border-radius:50%; background: rgba(216,180,106,.16); filter: blur(4px); }
    .metric.is-good::before { background: rgba(159,251,0,.18); }
    .metric.is-medium::before { background: rgba(133,173,255,.18); }
    .metric.is-caution::before { background: rgba(255,191,84,.18); }
    .metric-val { position: relative; font-size: 25px; font-weight: 760; letter-spacing: -.04em; }
    .metric-lbl { position: relative; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .11em; }
    .metric-sub { position: relative; color: rgba(244,241,232,.62); font-size: 12px; min-height: 1em; }
    .panel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .signal-panel { min-height: 110px; display: grid; align-content: start; gap: 8px; padding: 14px; border-radius: 16px; background: rgba(0,0,0,.18); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
    .signal-panel p { margin: 0; color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .11em; }
    .signal-panel strong { color: rgba(244,241,232,.9); font-size: 14px; line-height: 1.45; font-weight: 650; }
    .signal-panel.is-caution p { color: #ffbf54; }
    .signal-panel.is-good p { color: var(--green); }
    .signal-panel.is-medium p { color: var(--blue); }
    .source-panel { display: grid; gap: 8px; margin-top: 12px; }
    .source-row { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 10px; align-items: start; padding: 10px 12px; border-radius: 14px; background: rgba(0,0,0,.18); }
    .source-index { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; background: rgba(216,180,106,.16); color: var(--accent); font-weight: 800; font-size: 12px; }
    .source-row strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .source-row p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .diagram-stage, .chart-stage, .art-stage, .interactive-stage, .mockup-phone { margin-top: 12px; border-radius: 18px; background: rgba(0,0,0,.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,.075); overflow: hidden; }
    .diagram-stage svg, .art-stage svg { display:block; width:100%; height:auto; min-height:340px; }
    .diagram-node rect { fill: #134e7a; stroke: rgba(133,173,255,.9); }
    .diagram-node.green rect { fill:#075b48; stroke:#43d0a5; }
    .diagram-node.amber rect { fill:#704100; stroke:#d8b46a; }
    .node-copy { width:100%; height:100%; display:grid; align-content:center; gap:7px; text-align:center; overflow:hidden; color:var(--ink); font-family:inherit; }
    .node-copy strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--ink); font-size:18px; line-height:1.12; font-weight:850; letter-spacing:-.025em; word-break:break-word; overflow-wrap:anywhere; }
    .node-copy span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:rgba(244,241,232,.68); font-size:13px; line-height:1.25; font-weight:650; word-break:break-word; overflow-wrap:anywhere; }
    .edge, .arrow { stroke: rgba(244,241,232,.52); stroke-width: 2; fill: none; }
    .hint { margin: 12px 2px 0; color: var(--muted); font-size: 13px; }
    .chart-stage { min-height: 310px; padding: 18px 14px 12px; }
    .chart-bars { min-height: 270px; display:flex; align-items:end; justify-content:space-around; gap:10px; border-bottom:1px solid rgba(255,255,255,.12); background: repeating-linear-gradient(to top, transparent 0 49px, rgba(255,255,255,.055) 50px); }
    .bar-wrap { flex:1; min-width:0; display:grid; justify-items:center; align-items:end; gap:7px; color: var(--muted); font-size:12px; }
    .bar { width:min(48px, 70%); border-radius: 8px 8px 0 0; background:#1f6db3; }
    .bar.mint { background:#9bdcc7; }
    .bar-wrap strong { color:var(--ink); font-size:14px; }
    .bar-wrap span { max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .line-chart, .scatter-chart { width:100%; height:auto; min-height:290px; }
    .grid-line { stroke:rgba(255,255,255,.12); stroke-width:1; fill:none; }
    .line-path { stroke:#1f6db3; stroke-width:5; fill:none; filter:drop-shadow(0 0 10px rgba(31,109,179,.4)); }
    .line-chart circle, .scatter-chart circle { fill:#9bdcc7; stroke:#11110f; stroke-width:3; }
    .line-chart text, .scatter-chart text { fill:var(--muted); font-size:12px; font-weight:750; }
    .proportion-stage { min-height:120px; display:flex; align-items:center; padding:26px; }
    .stack-segment { min-height:72px; display:grid; place-items:center; background:#1f6db3; color:var(--ink); font-weight:850; }
    .stack-segment:first-child { border-radius:18px 0 0 18px; }
    .stack-segment:last-child { border-radius:0 18px 18px 0; }
    .stack-segment.mint { background:#9bdcc7; color:#11231f; }
    .proportion-labels { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; color:var(--muted); font-size:12px; }
    .range-stage { min-height:220px; display:grid; align-content:center; gap:16px; padding:24px; }
    .range-stage label { display:grid; grid-template-columns:130px minmax(0,1fr) 70px; gap:12px; align-items:center; color:var(--muted); font-size:12px; font-weight:800; }
    .range-stage i { height:10px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
    .range-stage b { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#1f6db3,#9bdcc7); }
    .range-stage strong { color:var(--ink); text-align:right; }
    .mockup-phone { max-width:560px; margin:14px auto 0; padding:16px; background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); }
    .mock-header { display:flex; gap:6px; margin-bottom:14px; }
    .mock-header span { width:10px; height:10px; border-radius:99px; background:rgba(255,255,255,.18); }
    .mock-grid { display:grid; gap:10px; }
    .mock-panel { display:grid; gap:8px; padding:14px; border-radius:16px; background:rgba(0,0,0,.22); box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
    .mock-panel.featured { background:linear-gradient(135deg, rgba(216,180,106,.18), rgba(0,0,0,.2)); }
    .mock-panel p { margin:0; color:var(--accent); font-size:12px; text-transform:uppercase; letter-spacing:.1em; font-weight:800; }
    .mock-panel strong { font-size:15px; line-height:1.4; }
    .mock-panel button { justify-self:start; border:1px solid rgba(255,255,255,.18); border-radius:999px; background:transparent; color:var(--ink); padding:7px 12px; font-weight:750; }
    .interactive-stage { display:grid; gap:18px; padding:18px; }
    .interactive-results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .interactive-results article { padding:14px; border-radius:16px; background:rgba(255,255,255,.045); }
    .interactive-results p { margin:0 0 6px; color:var(--muted); font-size:12px; font-weight:800; }
    .interactive-results strong { font-size:30px; color:var(--green); letter-spacing:-.04em; }
    .static-control-list { display:grid; gap:12px; }
    .static-control-list label { display:grid; grid-template-columns:120px minmax(0,1fr) 80px; gap:12px; align-items:center; color:var(--muted); font-weight:750; }
    .static-control-list i { height:10px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
    .static-control-list b { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#1f6db3,#9bdcc7); }
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
        // Still typing prose — render the partial prose substring only, with
        // the typing cursor. The widget is NOT in this text, so TextBlock's
        // pure-prose branch handles it.
        return h(TextBlock, { key: index, text: visibleProse, role: block.role || "assistant", typingActive: true, threadId });
      }
      // Prose done (or no typewriter) — hand TextBlock the full text so it
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

function Message({ message, typewrite = false, threadId = null }) {
  return h(
    "article",
    { className: `message ${message.role}` },
    h("div", { className: "message-content" },
      Array.isArray(message.blocks)
        ? h(MessageBlocks, { blocks: message.blocks, typewrite, threadId })
        : message.html
          ? h("div", { className: "message-html", dangerouslySetInnerHTML: { __html: message.html } })
          : h(TextBlock, { text: message.text || message.plainText || "", role: message.role, typewrite, threadId }))
  );
}

// Right-rail sources card. Displays up to 4 attached sources for the
// currently active assistant message. Intentionally thin — title, one-line
// meta (journal / year / pub type), short excerpt, and a "Read" link
// when we have a URL. The model is instructed to NEVER inline citations
// in the chat prose (see instructions in api/emersus/workflow.js), so
// this panel is the single place sources appear.
function SourcesRailCard({ sources }) {
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
    h("h3", { className: "rail-title" }, `Sources · ${items.length}`),
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
        const meta = metaParts.join(" · ");
        const snippet = normalizeText(
          source?.why_it_matters || source?.excerpt || source?.summary || "",
          240
        );
        const href = source?.url || (source?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/` : "");
        return h(
          "li",
          { key: `${source?.pmid || source?.doi || index}`, className: "source-item" },
          h("strong", null, title),
          meta ? h("div", { className: "source-meta" }, meta) : null,
          snippet ? h("div", { className: "source-snippet" }, snippet) : null,
          href
            ? h(
                "div",
                { className: "source-links" },
                h(
                  "a",
                  { href, target: "_blank", rel: "noopener noreferrer" },
                  "Read source ↗"
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

function ChatApp() {
  const [session, setSession] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [historyHidden, setHistoryHidden] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("");
  const [question, setQuestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [glyphState, setGlyphState] = useState("idle");
  const [streamingMessageKey, setStreamingMessageKey] = useState("");
  const statusRef = useRef(null);
  const canvasRef = useRef(null);
  const submitQuestionRef = useRef(null);

  const activeThread = useMemo(() => chatHistory.find((threadData) => threadData.id === activeThreadId) || null, [activeThreadId, chatHistory]);

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
  // effect only fires on manual thread switches and "new chat" actions —
  // never mid-submit.
  const previousThreadIdRef = useRef(activeThreadId);
  useEffect(() => {
    if (previousThreadIdRef.current !== activeThreadId) {
      previousThreadIdRef.current = activeThreadId;
      setStreamingMessageKey("");
    }
  }, [activeThreadId]);

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
      const rows = await listChatThreads(authSession.user.id);
      if (cancelled) return;
      const loaded = rows.map(mapSavedThread);
      if (loaded.length) {
        setChatHistory(loaded);
        setActiveThreadId(loaded[0].id);
      } else {
        const firstThread = createEmptyThread();
        setChatHistory([firstThread]);
        setActiveThreadId(firstThread.id);
        await upsertChatThread(authSession.user.id, firstThread);
      }

      // Deep link from /app/workout/<id>: open a fresh chat thread already
      // "attached" to a saved workout plan so the user can type natural
      // adjustment requests ("I missed Friday") and the backend loads the
      // plan into current_workout_plan automatically. We always open a new
      // thread rather than mutating the most recent one — the user's
      // latest chat might be about something unrelated.
      try {
        const url = new URL(window.location.href);
        const openPlanId = url.searchParams.get("open_plan");
        if (openPlanId) {
          const attachedThread = createEmptyThread();
          attachedThread.threadState = {
            ...attachedThread.threadState,
            active_workout_plan_id: openPlanId,
          };
          attachedThread.title = "Adjust plan";
          if (!cancelled) {
            setChatHistory((history) => [attachedThread, ...history].slice(0, MAX_HISTORY_ITEMS));
            setActiveThreadId(attachedThread.id);
            await upsertChatThread(authSession.user.id, attachedThread);
          }
          // Clean the URL so a page reload doesn't keep spawning threads.
          url.searchParams.delete("open_plan");
          window.history.replaceState({}, "", url.toString());
        }
      } catch (error) {
        console.error("open_plan deep-link failed:", error);
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
    const savedThread = {
      ...nextThread,
      title: deriveThreadTitle(nextThread),
      preview: deriveThreadPreview(nextThread),
      updatedAt: new Date().toISOString(),
    };
    setChatHistory((history) => [savedThread, ...history.filter((item) => item.id !== savedThread.id)].slice(0, MAX_HISTORY_ITEMS));
    if (session?.user?.id) {
      const saved = await upsertChatThread(session.user.id, savedThread);
      const mapped = mapSavedThread(saved);
      setChatHistory((history) => [mapped, ...history.filter((item) => item.id !== mapped.id)].slice(0, MAX_HISTORY_ITEMS));
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

    const baseThread = activeThread || createEmptyThread();
    const userMessage = { role: "user", text: trimmed, plainText: trimmed, createdAt: new Date().toISOString() };
    const threadWithUser = {
      ...baseThread,
      messages: [...(baseThread.messages || []), userMessage],
      threadState: deriveThreadState(baseThread, trimmed, ""),
    };

    setQuestion("");
    setIsSubmitting(true);
    setGlyphState("thinking");
    setStreamingMessageKey("");
    setActiveThreadId(threadWithUser.id);
    setChatHistory((history) => [threadWithUser, ...history.filter((item) => item.id !== threadWithUser.id)]);
    let persistedThread = await persistThread(threadWithUser);

    try {
      const response = await fetch("/api/emersus/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          threadId: persistedThread.id,
          userId: session?.user?.id ? `supabase:${session.user.id}` : "",
          threadState: persistedThread.threadState,
          recentMessages: buildRecentMessages(persistedThread.messages),
          includeDebug: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to generate a recommendation.");
      setGlyphState("responding");
      const assistantRaw = String(data.answer_text || data.summary || "");
      // If the answer contains a widget fence, route through the segment-aware
      // TextBlock + WidgetFrame pipeline. The legacy structured-HTML dump path
      // would otherwise hijack any answer containing <div> (i.e. every widget)
      // and render the fence markers as literal prose.
      const hasFences = hasWidgetFences(assistantRaw);
      const structuredHtml = !hasFences && looksLikeStructuredHtml(assistantRaw)
        ? sanitizeAssistantHtml(assistantRaw)
        : "";
      const assistantPlainText = structuredHtml
        ? stripHtmlToPlainText(structuredHtml, 4000)
        : assistantRaw;
      const assistantMessage = {
        role: "assistant",
        ...(structuredHtml ? { html: structuredHtml } : { blocks: buildAssistantBlocks(data) }),
        plainText: assistantPlainText || normalizeText(assistantRaw, 4000),
        text: assistantPlainText || normalizeText(assistantRaw, 4000),
        createdAt: new Date().toISOString(),
      };
      const nextThread = {
        ...persistedThread,
        messages: [...(persistedThread.messages || []), assistantMessage],
        threadState: (() => {
          const baseState = deriveThreadState(
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
        sources: Array.isArray(data.sources) ? data.sources : [],
      };
      // Mark the message as streaming BEFORE persist runs setChatHistory.
      // Both updates batch into a single render, so the message renders with
      // typewrite=true on its very first frame — no flash of full text.
      setStreamingMessageKey(assistantMessage.createdAt);
      persistedThread = await persistThread(nextThread);
      setActiveThreadId(persistedThread.id);
    } catch (error) {
      const errorMessage = error.message || "Request failed.";
      await persistThread({
        ...persistedThread,
        messages: [...(persistedThread.messages || []), { role: "assistant", text: errorMessage, plainText: errorMessage, createdAt: new Date().toISOString() }],
        threadState: deriveThreadState(persistedThread, trimmed, errorMessage),
        rail: { ...(persistedThread.rail || {}), synthesisMode: "error" },
      });
      setStatusTone("error");
      setStatusMessage(errorMessage);
    } finally {
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
  const rail = activeThread?.rail || {};
  const confidencePercent = typeof rail.confidencePercent === "number" ? rail.confidencePercent : Math.round(Math.max(0, Math.min(Number(rail.confidenceScore || 0), 1)) * 100);
  const sourceCount = Number(rail.sourceCount || activeThread?.sources?.length || 0);

  return h("div", { className: `chat-app-shell${historyHidden ? " history-hidden" : ""}` },
    h("aside", { className: "chat-nav" },
      h("div", { className: "chat-brand" },
        h("div", { className: "chat-brand-head" },
          // Clickable brand — takes you back to the public landing page.
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
            h("h1", { className: "chat-brand-mark" }, "EMERSUS"),
            h("p", { className: "chat-brand-subtitle" }, "Evidence Layer Active")
          ),
          h("button", { className: "inline-button", type: "button", "aria-expanded": !historyHidden, "aria-label": "Toggle conversation history", onClick: () => setHistoryHidden((value) => !value) },
            historyHidden ? h(PanelLeftOpen, { size: 18 }) : h(PanelLeftClose, { size: 18 })))),
      h("div", { className: "chat-nav-list", "aria-label": "Chat history" },
        chatHistory.map((threadData) =>
          h("button", { key: threadData.id, type: "button", className: `chat-nav-link${threadData.id === activeThreadId ? " is-active" : ""}`, onClick: () => setActiveThreadId(threadData.id) },
            h(History, { size: 17, "aria-hidden": true }),
            h("span", null,
              h("span", { className: "chat-nav-label" }, threadData.title || "New chat"),
              h("span", { className: "chat-nav-meta" }, `${formatHistoryTime(threadData.updatedAt)} - ${threadData.preview || "No messages yet"}`))))),
      // Cross-page nav row. The chat page was a dead-end before — no way to
      // get back to the dashboard, the workout planner, or anywhere else —
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
        h("button", { className: "inline-button", type: "button", onClick: startNewChat }, h(Plus, { size: 18 }), h("span", null, "New chat")))),
    historyHidden
      ? h("button", { className: "history-restore-button", type: "button", "aria-expanded": false, "aria-label": "Show conversation history", onClick: () => setHistoryHidden(false) },
          h(PanelLeftOpen, { size: 18 }))
      : null,
    h("main", { className: "chat-main" },
      h("div", { className: "chat-main-body" },
        h("section", { className: "conversation-canvas", ref: canvasRef },
          h("div", { className: `chat-thread${!activeThread?.messages?.length ? " is-empty" : ""}` },
            activeThread?.messages?.length
              ? [
                  ...activeThread.messages.map((message, index) => h(Message, {
                    key: `${message.createdAt || ""}-${index}`,
                    message,
                    typewrite: message.role === "assistant" && message.createdAt === streamingMessageKey,
                    threadId: activeThread?.id || null,
                  })),
                  isSubmitting && activeThread.messages[activeThread.messages.length - 1]?.role === "user"
                    ? h("article", { key: "pending-glyph", className: "message assistant message-pending" },
                        h("div", { className: "message-content" },
                          h(ThinkingGlyph, { state: glyphState, size: 56, color: "#534AB7" })))
                    : null,
                ]
              : h("section", { className: "thread-welcome" },
                  h("p", { className: "thread-welcome-eyebrow" }, "Emersus"),
                  h("h2", { className: "thread-welcome-title" }, `Welcome, ${displayName}`),
                  h("p", { className: "thread-welcome-copy" }, "Ask about training, nutrition, supplements, recovery, cardiovascular fitness, or metabolic health and I'll keep the answer evidence-aware."))))),
      h("div", { className: "chat-composer-shell" },
        h("form", { className: "composer", onSubmit: submitQuestion },
          h("div", { className: "composer-row" },
            h("label", { className: "sr-only", htmlFor: "chat-question" }, "Question"),
            h("textarea", {
              id: "chat-question",
              name: "question",
              placeholder: "Ask me anything about training, nutrition, recovery, or performance.",
              value: question,
              onChange: (event) => setQuestion(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isSubmitting) submitQuestion(event);
                }
              },
            }),
            h("div", { className: "composer-actions" },
              h("button", { className: "submit-orb", type: "submit", disabled: isSubmitting, "aria-label": "Send question" }, h(ArrowUp, { size: 21 })))),
          h("div", { className: "composer-utility-row" }, h("div", { className: "composer-buttons" }), h("p", { className: "status-text", ref: statusRef }))))),
    h("aside", { className: "chat-rail" },
      h("section", { className: "rail-card" },
        h("h3", { className: "rail-title" }, "System status"),
        h("div", { className: "rail-metric-stack" },
          h(RailMetric, { label: "Confidence", value: `${confidencePercent}%`, note: rail.confidenceLabel || "Idle", width: `${Math.max(0, Math.min(Number(rail.confidenceScore || 0) * 100, 100))}%` }),
          h(RailMetric, { label: "Source count", value: String(sourceCount), note: "Attached", width: `${Math.max(10, Math.min(sourceCount * 16, 100))}%`, tone: "tone-medium" }))),
      h(SourcesRailCard, { sources: activeThread?.sources || [] }),
      h("div", { className: "rail-foot" },
        h("div", { className: "rail-foot-line" }, h("span", null, "Pipeline"), h("span", null, "PubMed + PMC")),
        h("div", { className: "rail-foot-line" }, h("span", null, "Interface"), h("span", null, "React + Lucide")))));
}

const root = createRoot(document.getElementById("chat-root"));
root.render(h(ChatApp));
