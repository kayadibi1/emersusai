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
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
} from "https://esm.sh/lucide-react@0.468.0?deps=react@18.2.0";
import {
  listChatThreads,
  requireAuth,
  setStatus,
  upsertChatThread,
} from "/shared/supabase.js";

const h = React.createElement;
const MAX_HISTORY_ITEMS = 24;

function normalizeText(value, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trimSnippet(value, maxLength = 180) {
  const text = normalizeText(value, maxLength + 1);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    updated_at: "",
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

function inferPrimaryTopic(question, previousTopic = "") {
  const text = String(question || "").toLowerCase();
  const topicMatchers = [
    [/creatine/, "creatine"],
    [/beta[-\s]?alanine/, "beta-alanine"],
    [/protein|whey|casein|amino acid|bcaa|eaa/, "protein"],
    [/caffeine/, "caffeine"],
    [/sleep|circadian/, "sleep"],
    [/zone 2|endurance|running|cardio|interval|hiit|vo2/, "endurance"],
    [/hypertrophy|muscle gain|build muscle/, "hypertrophy"],
    [/fat loss|cutting|weight loss|caloric deficit/, "fat loss"],
  ];
  for (const [pattern, topic] of topicMatchers) {
    if (pattern.test(text)) return topic;
  }
  return previousTopic || "";
}

function inferGoalContext(question, previousGoal = "") {
  const text = String(question || "").toLowerCase();
  if (/hypertrophy|muscle gain|build muscle|lean mass/.test(text)) return "hypertrophy";
  if (/fat loss|cutting|lose fat|weight loss|deficit/.test(text)) return "fat_loss";
  if (/vo2|endurance|running|cardio|zone 2|aerobic/.test(text)) return "endurance";
  if (/recovery|soreness|sleep|stress/.test(text)) return "recovery";
  return previousGoal || "";
}

function inferQuestionMode(question) {
  const text = String(question || "").toLowerCase();
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
  const primaryTopic = inferPrimaryTopic(question, previous.primary_topic);
  const comparisonTarget = extractComparisonTarget(question) || "";
  const populationContext = extractPopulationContext(question);
  const questionMode = inferQuestionMode(question);
  const nextState = mergeThreadState({
    ...previous,
    primary_topic: primaryTopic,
    secondary_topics: normalizeCompactList([
      ...previous.secondary_topics,
      previous.goal_context ? previous.goal_context.replace(/_/g, " ") : "",
      comparisonTarget,
      ...populationContext,
    ], 4, 60),
    goal_context: inferGoalContext(question, previous.goal_context),
    question_mode: questionMode,
    recent_entities: normalizeCompactList([primaryTopic, comparisonTarget, ...populationContext], 8, 60),
    comparison_target: questionMode === "comparison" ? comparisonTarget || previous.comparison_target : "",
    population_context: populationContext.length > 0 ? populationContext : previous.population_context,
    last_user_intent: questionMode === "comparison" ? `asking for a comparison related to ${primaryTopic || "the current topic"}` : `asking about ${normalizeText(question, 150)}`,
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
  const blocks = [{ type: "text", text: data.answer_text || data.summary || "" }];
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
  const source = normalizeText(firstUserMessage?.text || firstUserMessage?.plainText || "", 80);
  if (!source) return "New chat";
  return source.length > 42 ? `${source.slice(0, 41).trim()}...` : source;
}

function deriveThreadPreview(threadData) {
  const latestAssistant = [...(threadData?.messages || [])].reverse().find((message) => message.role === "assistant");
  const fallback = (threadData?.messages || []).find((message) => message.role === "user");
  const source = normalizeText(latestAssistant?.plainText || latestAssistant?.text || fallback?.text || "", 80);
  if (!source) return "No messages yet";
  return source.length > 52 ? `${source.slice(0, 51).trim()}...` : source;
}

function mapSavedThread(row) {
  return {
    id: row.id,
    title: row.title || "New chat",
    preview: row.preview || "No messages yet",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    rail: row.rail && typeof row.rail === "object" ? row.rail : {},
    threadState: mergeThreadState(row.thread_state),
  };
}

function railFromData(data = {}) {
  const confidenceScore = Number(data.confidence?.score || 0);
  const confidenceLabel = String(data.confidence?.label || "idle");
  const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
  const synthesisMode = data.debug?.synthesis_mode || (data.summary ? "synthesized" : "idle");
  const confidencePercent = Math.round(Math.max(0, Math.min(confidenceScore, 1)) * 100);
  return { confidenceScore, confidencePercent, confidenceLabel, sourceCount, synthesisMode };
}

function StatusBadge({ status = "Done", isError = false, isRunning = false }) {
  const Icon = isRunning ? LoaderCircle : isError ? CircleAlert : CheckCircle2;
  const label = isRunning ? "Running" : isError ? "Error" : normalizeText(status || "Done", 18);
  return h(
    "span",
    { className: `chat-tool-status ${toneClass(isError ? "error" : status)}`.trim() },
    h(Icon, { className: `chat-tool-status-icon${isRunning ? " is-spinning" : ""}`, size: 15, "aria-hidden": true }),
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
          h("span", { className: "chat-tool-subtitle" }, subtitle || (tool === "sources_card" ? "Sources" : "Generated visual"))
        )
      ),
      h(StatusBadge, { status })
    ),
    expanded ? h("div", { className: `chat-card-body chat-tool-body${bodyClass ? ` ${bodyClass}` : ""}` }, children) : null
  );
}

function TextBlock({ text, role = "assistant" }) {
  const chunks = String(text || "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return h(
    "div",
    { className: `chat-bubble chat-bubble-${role} chat-text-block` },
    chunks.map((chunk, chunkIndex) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const bulletLines = lines.filter((line) => /^(?:[-*]|\u2022)\s+/.test(line));
      const proseLines = lines.filter((line) => !/^(?:[-*]|\u2022)\s+/.test(line));
      return h(
        React.Fragment,
        { key: chunkIndex },
        proseLines.length ? h("p", null, proseLines.join(" ")) : null,
        bulletLines.length
          ? h("ul", null, bulletLines.map((line, lineIndex) => h("li", { key: lineIndex }, line.replace(/^(?:[-*]|\u2022)\s+/, ""))))
          : null
      );
    })
  );
}

function buildEvidenceArtifactDoc({ card, title = "Generated dashboard", metrics = [], sources = [], panels = [] }) {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(trimSnippet(card?.body || card?.footnote || "", 260));
  const safeMetrics = metrics.slice(0, 4);
  const safeSources = sources.slice(0, 3);
  const safePanels = panels.slice(0, 4);

  const metricMarkup = safeMetrics
    .map((metric) => {
      const tone = toneClass(metric?.tone) || "is-medium";
      return `
        <div class="metric ${tone}">
          <div class="metric-val">${escapeHtml(metric?.value || "")}</div>
          <div class="metric-lbl">${escapeHtml(metric?.label || "")}</div>
          <div class="metric-sub">${escapeHtml(metric?.detail || "")}</div>
        </div>`;
    })
    .join("");

  const sourceMarkup = safeSources
    .map((source, index) => `
      <article class="source-row">
        <span class="source-index">${index + 1}</span>
        <div>
          <strong>${escapeHtml(source?.title || "Source")}</strong>
          <p>${escapeHtml(source?.meta || source?.takeaway || "")}</p>
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
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
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
    @media (max-width: 640px) { .metric-grid, .panel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .vis-container { padding: 12px; } }
  </style>
</head>
<body>
  <main class="vis-container">
    <p class="section-label">${safeTitle}</p>
    <section class="hero">
      <h1>${escapeHtml(card?.title || "Generated dashboard")}</h1>
      ${safeBody ? `<p class="body">${safeBody}</p>` : ""}
      <div class="metric-grid">${metricMarkup}</div>
      ${panelMarkup ? `<section class="panel-grid">${panelMarkup}</section>` : ""}
      ${sourceMarkup ? `<section class="source-panel">${sourceMarkup}</section>` : ""}
    </section>
  </main>
</body>
</html>`;
}

function EvidenceArtifact({ card, title, metrics = [], sources = [], panels = [] }) {
  const srcDoc = useMemo(
    () => buildEvidenceArtifactDoc({ card, title, metrics, sources, panels }),
    [card, title, metrics, sources, panels]
  );

  return h(
    "div",
    { className: "chat-artifact-container" },
    h("iframe", {
      className: "chat-artifact-frame",
      title,
      sandbox: "allow-scripts allow-same-origin",
      srcDoc,
    })
  );
}

function VerdictHero({ card }) {
  const metrics = Array.isArray(card?.metrics) ? card.metrics.slice(0, 4) : [];
  return h(
    ToolCard,
    { title: card?.eyebrow || "Evidence Verdict", bodyClass: "chat-insight-card" },
    h(EvidenceArtifact, { card, title: card?.eyebrow || "Evidence Verdict", metrics })
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

function EvidenceProfile({ card }) {
  const items = Array.isArray(card?.items) ? card.items.slice(0, 4) : [];
  return h(
    ToolCard,
    { title: card?.title || "Evidence profile", bodyClass: "chat-insight-card" },
    h("div", { className: "chat-score-list" }, items.map((item, index) => {
      const score = Number(item?.score || 0);
      const max = Math.max(1, Number(item?.max || 10));
      const ratio = Math.max(0, Math.min(score / max, 1));
      return h("div", { key: index, className: "chat-score-row" },
        h("div", { className: "chat-score-head" }, h("span", { className: "chat-score-label" }, normalizeText(item?.label || "", 80)), h("span", { className: "chat-score-value" }, `${score}/${max}`)),
        h("div", { className: "chat-score-track" }, h("div", { className: `chat-score-fill ${toneClass(item?.tone)}`.trim(), style: { width: `${Math.round(ratio * 100)}%` } })));
    })),
    card?.footnote ? h("p", { className: "chat-card-footnote" }, trimSnippet(card.footnote, 180)) : null
  );
}

function ActionGrid({ card }) {
  const columns = Array.isArray(card?.columns) ? card.columns.slice(0, 3) : [];
  return h(
    ToolCard,
    { title: card?.title || "Key takeaways", bodyClass: "chat-insight-card" },
    h("div", { className: "chat-action-columns" }, columns.map((column, index) =>
      h("section", { key: index, className: `chat-action-panel ${toneClass(column?.tone)}`.trim() },
        h("h4", { className: "chat-action-heading" }, normalizeText(column?.label || "Actions", 80)),
        h("ul", { className: "chat-action-list" }, (Array.isArray(column?.items) ? column.items.slice(0, 4) : []).map((item, itemIndex) => h("li", { key: itemIndex }, normalizeText(item, 180)))))))
  );
}

function Watchouts({ card }) {
  return h(
    ToolCard,
    { title: card?.title || "Watchouts", status: String(card?.tone || "caution").toUpperCase(), bodyClass: "chat-insight-card" },
    h("ul", { className: "chat-watchout-list" }, (Array.isArray(card?.items) ? card.items.slice(0, 4) : []).map((item, index) => h("li", { key: index }, normalizeText(item, 180))))
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
  if (type === "dashboard_artifact") return h(DashboardArtifact, { card });
  if (type === "verdict_hero") return h(VerdictHero, { card });
  if (type === "evidence_profile") return h(EvidenceProfile, { card });
  if (type === "action_grid") return h(ActionGrid, { card });
  if (type === "watchouts") return h(Watchouts, { card });
  if (type === "source_highlights") return h(SourceHighlights, { card });
  return null;
}

function MessageBlocks({ blocks }) {
  return h(React.Fragment, null, (Array.isArray(blocks) ? blocks : []).map((block, index) => {
    if (!block || typeof block !== "object") return null;
    if (block.type === "text") return h(TextBlock, { key: index, text: block.text, role: block.role || "assistant" });
    if (block.type === "tool_result" || block.type === "tool_use") return h(InsightCard, { key: index, block });
    return null;
  }));
}

function Message({ message }) {
  return h(
    "article",
    { className: `message ${message.role}` },
    h("div", { className: "message-content" },
      Array.isArray(message.blocks)
        ? h(MessageBlocks, { blocks: message.blocks })
        : message.html
          ? h("div", { dangerouslySetInnerHTML: { __html: message.html } })
          : h(TextBlock, { text: message.text || message.plainText || "", role: message.role }))
  );
}

function RailMetric({ label, value, note, width = "0%", tone = "" }) {
  return h("div", { className: "rail-metric" },
    h("div", { className: "rail-metric-head" },
      h("div", null, h("p", { className: "rail-metric-label" }, label), h("p", { className: "rail-metric-value" }, value)),
      h("span", { className: "rail-metric-note" }, note)),
    h("div", { className: `rail-spark ${tone}`.trim(), style: { "--spark-width": width } }));
}

function SourceList({ sources }) {
  return h("ul", { className: "source-list" }, (Array.isArray(sources) ? sources : []).map((source, index) => {
    const meta = [source.author_label || "", source.journal || "", source.year || source.published_at || "", source.publication_type || "", source.pmid ? `PMID ${source.pmid}` : ""].filter(Boolean).join(" - ");
    const snippet = trimSnippet(source.excerpt || source.why_it_matters || "", 320);
    return h("li", { key: index, className: "source-item" },
      h("strong", null, source.title || "Source"),
      meta ? h("div", { className: "source-meta" }, meta) : null,
      snippet ? h("div", { className: "source-snippet" }, snippet) : null,
      h("div", { className: "source-links" },
        source.url ? h("a", { href: source.url, target: "_blank", rel: "noreferrer" }, source.doi ? "DOI" : "Open source") : null,
        source.pmid ? h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(source.pmid)}/`, target: "_blank", rel: "noreferrer" }, "PubMed") : null));
  }));
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
  const statusRef = useRef(null);
  const canvasRef = useRef(null);

  const activeThread = useMemo(() => chatHistory.find((threadData) => threadData.id === activeThreadId) || null, [activeThreadId, chatHistory]);

  useEffect(() => {
    setStatus(statusRef.current, statusTone, statusMessage);
  }, [statusTone, statusMessage]);

  useEffect(() => {
    canvasRef.current?.scrollTo({ top: canvasRef.current.scrollHeight, behavior: "smooth" });
  }, [activeThread?.messages?.length, activeThreadId]);

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

  async function submitQuestion(event) {
    event?.preventDefault();
    const trimmed = String(question || "").trim();
    if (!trimmed) {
      setStatusTone("error");
      setStatusMessage("Type a question first.");
      return;
    }

    const baseThread = activeThread || createEmptyThread();
    const userMessage = { role: "user", text: trimmed, plainText: trimmed, createdAt: new Date().toISOString() };
    const threadWithUser = {
      ...baseThread,
      messages: [...(baseThread.messages || []), userMessage],
      threadState: deriveThreadState(baseThread, trimmed, ""),
    };

    setQuestion("");
    setIsSubmitting(true);
    setActiveThreadId(threadWithUser.id);
    setChatHistory((history) => [threadWithUser, ...history.filter((item) => item.id !== threadWithUser.id)]);
    let persistedThread = await persistThread(threadWithUser);

    try {
      const response = await fetch("/api/emersus/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          userId: session?.user?.id ? `supabase:${session.user.id}` : "",
          threadState: persistedThread.threadState,
          recentMessages: buildRecentMessages(persistedThread.messages),
          includeDebug: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to generate a recommendation.");
      const assistantMessage = {
        role: "assistant",
        blocks: buildAssistantBlocks(data),
        plainText: data.answer_text || data.summary || "",
        text: data.answer_text || data.summary || "",
        createdAt: new Date().toISOString(),
      };
      const nextThread = {
        ...persistedThread,
        messages: [...(persistedThread.messages || []), assistantMessage],
        threadState: deriveThreadState(persistedThread, trimmed, data.summary || data.answer_text || ""),
        rail: railFromData(data),
        sources: Array.isArray(data.sources) ? data.sources : [],
      };
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
    }
  }

  const displayName = getDisplayName(session);
  const rail = activeThread?.rail || {};
  const confidencePercent = typeof rail.confidencePercent === "number" ? rail.confidencePercent : Math.round(Math.max(0, Math.min(Number(rail.confidenceScore || 0), 1)) * 100);
  const sourceCount = Number(rail.sourceCount || activeThread?.sources?.length || 0);
  const synthesisMode = String(rail.synthesisMode || (isSubmitting ? "thinking" : "idle")).replace(/[:_]/g, " ");

  return h("div", { className: `chat-app-shell${historyHidden ? " history-hidden" : ""}` },
    h("aside", { className: "chat-nav" },
      h("div", { className: "chat-brand" },
        h("div", { className: "chat-brand-head" },
          h("div", null, h("h1", { className: "chat-brand-mark" }, "EMERSUS"), h("p", { className: "chat-brand-subtitle" }, "Evidence Layer Active")),
          h("button", { className: "inline-button", type: "button", "aria-expanded": !historyHidden, "aria-label": "Toggle conversation history", onClick: () => setHistoryHidden((value) => !value) },
            historyHidden ? h(PanelLeftOpen, { size: 18 }) : h(PanelLeftClose, { size: 18 })))),
      h("div", { className: "chat-nav-list", "aria-label": "Chat history" },
        chatHistory.map((threadData) =>
          h("button", { key: threadData.id, type: "button", className: `chat-nav-link${threadData.id === activeThreadId ? " is-active" : ""}`, onClick: () => setActiveThreadId(threadData.id) },
            h(History, { size: 17, "aria-hidden": true }),
            h("span", null,
              h("span", { className: "chat-nav-label" }, threadData.title || "New chat"),
              h("span", { className: "chat-nav-meta" }, `${formatHistoryTime(threadData.updatedAt)} - ${threadData.preview || "No messages yet"}`))))),
      h("div", { className: "chat-nav-actions" },
        h("button", { className: "inline-button", type: "button", onClick: startNewChat }, h(Plus, { size: 18 }), h("span", null, "New chat")))),
    h("main", { className: "chat-main" },
      h("div", { className: "chat-main-body" },
        h("section", { className: "conversation-canvas", ref: canvasRef },
          h("div", { className: `chat-thread${!activeThread?.messages?.length ? " is-empty" : ""}` },
            activeThread?.messages?.length
              ? activeThread.messages.map((message, index) => h(Message, { key: `${message.createdAt || ""}-${index}`, message }))
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
          h(RailMetric, { label: "Source count", value: String(sourceCount), note: "Attached", width: `${Math.max(10, Math.min(sourceCount * 16, 100))}%`, tone: "tone-medium" }),
          h(RailMetric, { label: "Model state", value: synthesisMode, note: "Live", width: `${activeThread?.rail?.synthesisMode ? 88 : 68}%`, tone: "tone-caution" }))),
      h("section", { className: "rail-card" }, h("h3", { className: "rail-title" }, "Retrieved sources"), h(SourceList, { sources: activeThread?.sources || [] })),
      h("div", { className: "rail-foot" },
        h("div", { className: "rail-foot-line" }, h("span", null, "Pipeline"), h("span", null, "PubMed + PMC")),
        h("div", { className: "rail-foot-line" }, h("span", null, "Interface"), h("span", null, "React + Lucide")))));
}

const root = createRoot(document.getElementById("chat-root"));
root.render(h(ChatApp));
