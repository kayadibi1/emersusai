// shared/chat/top-bar.js — ChatTopBar for the chat_v2 redesign.
//
// Layout (left → right):
//   - Editable thread title (click to edit, Enter commits, Esc cancels)
//   - N SOURCES CITED non-interactive pill
//   - Share button
//   - ⋯ overflow menu (Rename · Archive · Delete)
//
// Pure helpers (normalizeThreadTitle, resolveTitleKeyAction) are unit-tested.
// The React component is the thin shell.
//
// Removed 2026-04-22: the Emersus / Fast / Deep model pill. The dropdown
// stored a per-thread model id in local state but never sent it to the
// backend — prod always used the server's OPENAI_EMERSUS_MODEL env value.
// Rather than keep a control that lies about what it does, the pill + its
// handler are gone. Re-introduce when the server pipeline actually reads
// a per-request model parameter.

import React from "react";
import { CaretDoubleRight as PanelLeftOpen, ShareFat as ShareIcon } from "@phosphor-icons/react";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

const TITLE_MAX_LENGTH = 120;

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
          className: "share-btn",
          title: thread?.id
            ? `Share "${title}" — get a public link to this conversation`
            : "Share this conversation — get a public link",
          "aria-label": thread?.id
            ? `Share thread "${title}"`
            : "Share this conversation",
          onClick: () => {
            if (typeof onShare === "function") onShare();
          },
        },
        h(ShareIcon, { size: 14, weight: "bold", "aria-hidden": true, className: "share-btn-icon" }),
        h("span", { className: "share-btn-label" }, "Share thread"),
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
