// shared/chat/message-actions.js — always-visible per-message action row
// for the chat_v2 redesign.
//
// Visible at 55% opacity by default, hover brightens. Default actions (always
// present on assistant messages): Copy · Cite · Regenerate · Export. Conditional:
// Save plan (when the message carries a workout-plan widget), Swap meal (when
// it carries a meal-plan widget).
//
// Pure helpers (formatSourcesAsAPA, resolveAvailableActions, messageHasWorkoutPlan,
// messageHasMealPlan) are unit-tested. The React component is the thin shell
// that wires them to caller-provided handlers.

import React from "react";
import { formatCitationUrl } from "../citation-format.js";

const { useCallback, useState } = React;
const h = React.createElement;

function readMessageText(message) {
  return String(message?.text || message?.plainText || "");
}

function hasFenceInText(message, info) {
  const text = readMessageText(message);
  if (!text) return false;
  const pattern = new RegExp("```" + info + "\\b", "i");
  return pattern.test(text);
}

export function messageHasWorkoutPlan(message) {
  if (!message || typeof message !== "object") return false;
  if (message.toolResults && message.toolResults.emit_workout_plan) return true;
  return hasFenceInText(message, "workout-plan");
}

export function messageHasMealPlan(message) {
  if (!message || typeof message !== "object") return false;
  if (message.toolResults && message.toolResults.emit_meal_plan) return true;
  return hasFenceInText(message, "meal-plan");
}

function formatAuthorList(raw) {
  const authors = Array.isArray(raw) ? raw.filter(Boolean).map(String) : [];
  if (!authors.length) return "Unknown author";
  if (authors.length > 6) return `${authors.slice(0, 6).join(", ")}, et al.`;
  return authors.join(", ");
}

function formatSingleAPA(source, index) {
  const authors = formatAuthorList(source?.authors);
  const yearRaw = source?.year || source?.publication_year || source?.published_at || "n.d.";
  const year = String(yearRaw).slice(0, 4) || "n.d.";
  const title = String(source?.title || "Untitled source").trim();
  const journal = source?.journal ? ` ${source.journal}.` : "";
  const url = formatCitationUrl(source);
  const tail = url ? ` ${url}` : "";
  return `[${index + 1}] ${authors} (${year}). ${title}.${journal}${tail}`.trim();
}

export function formatSourcesAsAPA(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return "";
  return list.map((source, index) => formatSingleAPA(source, index)).join("\n\n");
}

const BASE_ACTIONS = [
  { id: "copy", label: "Copy" },
  { id: "cite", label: "Cite" },
];

// Primary actions stay visible on mobile; the rest fold into a "⋯" overflow
// menu. Matches the ChatGPT/Claude convention where most users want
// copy one tap away and the niche actions out of sight.
const PRIMARY_ACTION_IDS = new Set(["copy"]);

/**
 * Decide which action buttons to render for a given message.
 * Always includes copy / cite / export on assistant messages.
 * Appends save-plan / swap-meal when the relevant widget is present.
 * User messages get no action row.
 *
 * @param {object|null} message
 * @returns {{ id: string, label: string }[]}
 */
export function resolveAvailableActions(message) {
  if (!message || typeof message !== "object") return [];
  if (message.role !== "assistant") return [];
  const actions = [...BASE_ACTIONS];
  if (messageHasWorkoutPlan(message)) {
    actions.push({ id: "save-plan", label: "Save plan" });
  }
  if (messageHasMealPlan(message)) {
    actions.push({ id: "swap-meal", label: "Swap meal" });
  }
  actions.push({ id: "export", label: "Export" });
  return actions;
}

async function copyTextToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

export function MessageActions({
  message,
  onRegenerate,
  onSavePlan,
  onSwapMeal,
  onExport,
}) {
  const [toast, setToast] = useState("");
  const [overflowOpen, setOverflowOpen] = useState(false);

  const actions = resolveAvailableActions(message);
  if (!actions.length) return null;
  const hasSecondary = actions.some((a) => !PRIMARY_ACTION_IDS.has(a.id));

  const flashToast = useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleAction = useCallback(
    async (id) => {
      if (id === "copy") {
        const ok = await copyTextToClipboard(readMessageText(message));
        flashToast(ok ? "COPIED" : "COPY FAILED");
        return;
      }
      if (id === "cite") {
        const sources = Array.isArray(message?.sources) ? message.sources : [];
        if (!sources.length) {
          flashToast("NO CITATIONS");
          return;
        }
        const apa = formatSourcesAsAPA(sources);
        const ok = await copyTextToClipboard(apa);
        flashToast(ok ? `CITATIONS COPIED · ${sources.length} PAPERS` : "COPY FAILED");
        return;
      }
      if (id === "save-plan" && typeof onSavePlan === "function") {
        onSavePlan(message);
        return;
      }
      if (id === "swap-meal" && typeof onSwapMeal === "function") {
        onSwapMeal(message);
        return;
      }
      if (id === "export" && typeof onExport === "function") {
        onExport(message);
      }
    },
    [message, onRegenerate, onSavePlan, onSwapMeal, onExport, flashToast],
  );

  return h(
    "div",
    {
      className: `msg-actions${overflowOpen ? " msg-actions-expanded" : ""}`,
      role: "toolbar",
      "aria-label": "Message actions",
    },
    actions.map((action) =>
      h(
        "button",
        {
          key: action.id,
          type: "button",
          className: `msg-action${PRIMARY_ACTION_IDS.has(action.id) ? "" : " msg-action-secondary"}`,
          "data-action": action.id,
          onClick: () => handleAction(action.id),
        },
        action.label,
      ),
    ),
    hasSecondary
      ? h(
          "button",
          {
            key: "__more",
            type: "button",
            className: "msg-action msg-action-more",
            "aria-label": overflowOpen ? "Show fewer actions" : "Show more actions",
            "aria-expanded": overflowOpen ? "true" : "false",
            onClick: () => setOverflowOpen((v) => !v),
          },
          "\u22EF",
        )
      : null,
    toast ? h("span", { className: "msg-action-toast", role: "status" }, toast) : null,
  );
}

export default MessageActions;
