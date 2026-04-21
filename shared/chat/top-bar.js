// shared/chat/top-bar.js — ChatTopBar for the chat_v2 redesign.
//
// Layout (left → right):
//   - Editable thread title (click to edit, Enter commits, Esc cancels)
//   - Emersus model pill → dropdown (Emersus · Fast · Deep)
//   - N SOURCES CITED non-interactive pill
//   - Share button
//   - ⋯ overflow menu (Rename · Archive · Delete)
//
// Pure helpers (normalizeThreadTitle, resolveTitleKeyAction, MODEL_OPTIONS,
// isKnownModel) are unit-tested. The React component is the thin shell.

import React from "react";
import { CaretDoubleRight as PanelLeftOpen } from "@phosphor-icons/react";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

const TITLE_MAX_LENGTH = 120;

export const MODEL_OPTIONS = [
  { id: "emersus", label: "Emersus", tier: "balanced" },
  { id: "emersus-fast", label: "Emersus · Fast", tier: "fast" },
  { id: "emersus-deep", label: "Emersus · Deep", tier: "deep" },
];

const MODEL_IDS = new Set(MODEL_OPTIONS.map((m) => m.id));

export function isKnownModel(id) {
  return typeof id === "string" && MODEL_IDS.has(id);
}

export function normalizeThreadTitle(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).replace(/\s+/g, " ").trim();
  if (!str) return null;
  return str.slice(0, TITLE_MAX_LENGTH);
}

/**
 * Decide what the editable title should do on a given key event.
 * @param {string} key
 * @param {{ shiftKey?: boolean }} modifiers
 * @param {{ draft: string, original: string }} ctx
 * @returns {'commit' | 'cancel' | null}
 */
export function resolveTitleKeyAction(key, modifiers, ctx) {
  if (key === "Escape") return "cancel";
  if (key === "Enter") {
    if (modifiers?.shiftKey) return null;
    const normalized = normalizeThreadTitle(ctx.draft);
    if (!normalized || normalized === ctx.original) return "cancel";
    return "commit";
  }
  return null;
}

function findModelOption(id) {
  return MODEL_OPTIONS.find((m) => m.id === id) || MODEL_OPTIONS[0];
}

/**
 * Standalone model picker pill. Extracted from ChatTopBar so it can be
 * rendered outside the top bar (e.g. below the composer).
 */
export function ModelPill({ modelId, onModelChange, className = "" }) {
  const resolvedId = isKnownModel(modelId) ? modelId : MODEL_OPTIONS[0].id;
  const activeModel = findModelOption(resolvedId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handle(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [open]);

  const handleSelect = (id) => {
    setOpen(false);
    if (!isKnownModel(id) || id === resolvedId) return;
    if (typeof onModelChange === "function") onModelChange(id);
  };

  return h(
    "div",
    { className: `model-pill-wrap ${className}`.trim(), onMouseDown: (e) => e.stopPropagation() },
    h(
      "button",
      {
        type: "button",
        className: "pill model",
        title: "Change model for this thread",
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        onClick: () => setOpen((v) => !v),
      },
      h("span", { className: "model-pill-label" }, activeModel.label.toUpperCase()),
      " ",
      h("span", { className: "chev" }, "▾"),
    ),
    open
      ? h(
          "ul",
          { className: "model-pill-menu", role: "listbox" },
          MODEL_OPTIONS.map((option) =>
            h(
              "li",
              { key: option.id, role: "presentation" },
              h(
                "button",
                {
                  type: "button",
                  role: "option",
                  "aria-selected": option.id === resolvedId,
                  className: `model-pill-option${option.id === resolvedId ? " is-active" : ""}`,
                  onClick: () => handleSelect(option.id),
                },
                option.label,
              ),
            ),
          ),
        )
      : null,
  );
}

export function ChatTopBar({
  thread,
  onRename,
  onShare,
  onArchive,
  onDelete,
  sourceCount = 0,
  onOpenSidebar,
}) {
  const title = thread?.title || "New thread";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [menuOpen, setMenuOpen] = useState(false);

  const inputRef = useRef(null);
  const menuBtnRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync draft when thread switches.
  useEffect(() => {
    setDraft(title);
    setEditing(false);
  }, [thread?.id, title]);

  // Close dropdowns on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function handle(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [menuOpen]);

  const commit = useCallback(() => {
    const next = normalizeThreadTitle(draft);
    if (!next || next === title) {
      setDraft(title);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (typeof onRename === "function") onRename(next);
  }, [draft, title, onRename]);

  const cancel = useCallback(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

  const handleKeyDown = useCallback(
    (event) => {
      const action = resolveTitleKeyAction(event.key, { shiftKey: event.shiftKey }, { draft, original: title });
      if (action === "commit") {
        event.preventDefault();
        commit();
      } else if (action === "cancel") {
        event.preventDefault();
        cancel();
      }
    },
    [draft, title, commit, cancel],
  );

  const handleMenuAction = (action) => {
    setMenuOpen(false);
    if (action === "rename") {
      setEditing(true);
      return;
    }
    if (action === "archive" && typeof onArchive === "function") onArchive();
    if (action === "delete" && typeof onDelete === "function") onDelete();
  };

  // `.top-bar` is defined in chrome.css; `.chat-top` adds chat-specific tweaks
  // in chat.css (Task 12). Both classes stay on the element.
  return h(
    "header",
    { className: "top-bar chat-top", "data-chat-top-bar": "v2" },
    h(
      "div",
      { className: "top-left" },
      onOpenSidebar
        ? h("button", {
            type: "button",
            className: "chat-nav-toggle",
            "aria-label": "Open conversation list",
            onClick: onOpenSidebar,
          }, h(PanelLeftOpen, { size: 18, "aria-hidden": true }))
        : null,
      editing
        ? h("input", {
            ref: inputRef,
            className: "thread-heading thread-heading-input",
            value: draft,
            maxLength: TITLE_MAX_LENGTH,
            "aria-label": "Thread title",
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: handleKeyDown,
            onBlur: commit,
          })
        : h(
            "button",
            {
              type: "button",
              className: "thread-heading thread-heading-button",
              title: "Rename thread",
              onClick: () => setEditing(true),
            },
            title,
          ),
      h(
        "div",
        { className: "top-badges" },
        h(
          "span",
          {
            className: "pill pill-sources",
            title: "Papers cited so far in this thread",
            "data-sources": String(sourceCount),
          },
          h("span", { className: "pill-sources-count" }, String(sourceCount)),
          h("span", { className: "pill-sources-label" }, ` SOURCE${sourceCount === 1 ? "" : "S"} CITED`),
        ),
      ),
    ),
    h(
      "div",
      { className: "top-actions" },
      h(
        "button",
        {
          type: "button",
          className: "icon-btn share-btn",
          onClick: () => {
            if (typeof onShare === "function") onShare();
          },
        },
        h("span", { className: "share-btn-label" }, "Share"),
      ),
      h(
        "div",
        { className: "menu-wrap", onMouseDown: (e) => e.stopPropagation() },
        h(
          "button",
          {
            ref: menuBtnRef,
            type: "button",
            className: "icon-btn icon-btn-menu",
            "aria-haspopup": "menu",
            "aria-expanded": menuOpen,
            title: "Thread actions",
            onClick: () => setMenuOpen((v) => !v),
          },
          "⋯",
        ),
        menuOpen
          ? h(
              "ul",
              { className: "menu-pop", role: "menu" },
              h(
                "li",
                { role: "presentation" },
                h(
                  "button",
                  { type: "button", role: "menuitem", onClick: () => handleMenuAction("rename") },
                  "Rename",
                ),
              ),
              h(
                "li",
                { role: "presentation" },
                h(
                  "button",
                  { type: "button", role: "menuitem", onClick: () => handleMenuAction("archive") },
                  "Archive",
                ),
              ),
              h(
                "li",
                { role: "presentation" },
                h(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    className: "menu-pop-danger",
                    onClick: () => handleMenuAction("delete"),
                  },
                  "Delete",
                ),
              ),
            )
          : null,
      ),
    ),
  );
}

export default ChatTopBar;
