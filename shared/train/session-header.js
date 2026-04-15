// shared/train/session-header.js — Phase 3 Train session header.
//
// Editable title + live elapsed time + auto-saving indicator + ⋯ menu.

import React from "react";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

export function formatElapsed(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const seconds = Math.floor(total) % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function normalizeSessionTitle(raw, max = 200) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).replace(/\s+/g, " ").trim();
  if (!str) return null;
  return str.slice(0, max);
}

export function SessionHeader({
  session,
  onRename,
  onChangeModality,
  onEndSession,
  onCancelSession,
  autoSaving = false,
}) {
  const startedAt = session?.started_at ? new Date(session.started_at).getTime() : Date.now();
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session?.title || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (session?.ended_at) return undefined;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [session?.ended_at]);

  useEffect(() => {
    setDraft(session?.title || "");
    setEditing(false);
  }, [session?.id, session?.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const commit = useCallback(() => {
    const next = normalizeSessionTitle(draft);
    setEditing(false);
    if (!next || next === (session?.title || "")) {
      setDraft(session?.title || "");
      return;
    }
    onRename?.(next);
  }, [draft, session, onRename]);

  const elapsedMs = (session?.ended_at ? new Date(session.ended_at).getTime() : now) - startedAt;
  const dotState = session?.ended_at ? "ended" : "live";

  return h("header", { className: "tr-session-header" },
    h("div", { className: "tr-session-title-wrap" },
      editing
        ? h("input", {
            ref: inputRef,
            className: "tr-session-title-input",
            value: draft,
            maxLength: 200,
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(session?.title || ""); }
            },
            onBlur: commit,
          })
        : h("button", {
            type: "button",
            className: "tr-session-title",
            title: "Rename session",
            onClick: () => setEditing(true),
          }, session?.title || "Untitled session"),
      h("div", { className: "tr-session-meta" },
        h("span", { className: `tr-session-dot tr-session-dot-${dotState}` }),
        h("span", null, session?.ended_at ? "FINISHED" : "IN PROGRESS"),
        h("span", null, "·"),
        h("span", null, formatElapsed(elapsedMs)),
        h("span", null, "·"),
        h("span", null, (session?.modality || "").toUpperCase() || "—"),
      ),
    ),
    h("div", { className: "tr-session-actions" },
      h("span", { className: `tr-session-saving${autoSaving ? "" : " is-idle"}` },
        autoSaving ? "● AUTO-SAVING" : "● SAVED",
      ),
      h("div", { className: "tr-session-menu-wrap", onMouseDown: (e) => e.stopPropagation() },
        h("button", {
          type: "button",
          className: "tr-session-menu-btn",
          onClick: () => setMenuOpen((v) => !v),
          "aria-haspopup": "menu",
          "aria-expanded": menuOpen,
        }, "⋯"),
        menuOpen ? h("ul", { className: "tr-session-menu" },
          h("li", null, h("button", { type: "button", onClick: () => { setMenuOpen(false); setEditing(true); } }, "Rename")),
          onChangeModality
            ? h("li", null, h("button", { type: "button", onClick: () => { setMenuOpen(false); onChangeModality(); } }, "Change modality"))
            : null,
          h("li", null, h("button", { type: "button", className: "tr-menu-danger", onClick: () => { setMenuOpen(false); onCancelSession?.(); } }, "Cancel session")),
          h("li", null, h("button", { type: "button", onClick: () => { setMenuOpen(false); onEndSession?.(); } }, "End session")),
        ) : null,
      ),
    ),
  );
}

export default SessionHeader;
