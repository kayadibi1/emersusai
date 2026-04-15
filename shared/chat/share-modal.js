// shared/chat/share-modal.js — ChatThreadShareModal for the chat_v2 redesign.
//
// Three actions: Copy link (hits POST /api/threads/:id/share, 30-day default),
// Copy as Markdown (serializes client-side), Export as PDF (stub — opens
// /api/threads/:id/export.pdf which currently returns plain text until a
// real PDF renderer lands).
//
// Named export `ShareModal` deliberately re-uses the generic name under a
// deeper path; it's separate from /shared/share-modal.js which handles
// workout/nutrition session share cards.

import React from "react";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function stripWidgetFences(text) {
  return String(text || "")
    .replace(/```(?:workout-plan|meal-plan|widget|html|nutrition-log-confirm)[^\n]*\n[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatAuthors(authors) {
  const list = Array.isArray(authors) ? authors.filter(Boolean).map(String) : [];
  if (!list.length) return "Unknown";
  if (list.length > 4) return `${list.slice(0, 4).join(", ")}, et al.`;
  return list.join(", ");
}

export function serializeThreadAsMarkdown(thread) {
  if (!thread || typeof thread !== "object") return "";
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  if (!messages.length) return "";

  const title = String(thread.title || "").trim() || "Conversation";
  const lines = [`# ${title}`, ""];

  let lastAssistant = null;
  for (const message of messages) {
    const role = message?.role === "user" ? "You" : "Emersus";
    if (message?.role === "assistant") lastAssistant = message;
    const raw = String(message?.text || message?.plainText || "");
    const body = message?.role === "assistant" ? stripWidgetFences(raw) : raw.trim();
    if (!body) continue;
    lines.push(`**${role}**:`);
    lines.push("");
    lines.push(body);
    lines.push("");
  }

  const sources = Array.isArray(lastAssistant?.sources) ? lastAssistant.sources : [];
  if (sources.length) {
    lines.push("## Sources");
    lines.push("");
    sources.forEach((source, index) => {
      const authors = formatAuthors(source?.authors);
      const year = String(source?.year || source?.publication_year || "n.d.").slice(0, 4);
      const paperTitle = String(source?.title || "Untitled source").trim();
      const journal = source?.journal ? ` ${source.journal}.` : "";
      lines.push(`${index + 1}. ${authors} (${year}). ${paperTitle}.${journal}`);
    });
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function buildShareUrl(origin, token) {
  if (!token) return "";
  const cleanOrigin = String(origin || "").replace(/\/+$/, "");
  return `${cleanOrigin}/share/t/${token}`;
}

export function formatExpiryLabel(expiresAt, now = new Date()) {
  if (!expiresAt) return "";
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return "";
  const delta = expires.getTime() - now.getTime();
  if (delta <= 0) return "expired";
  if (delta >= DAY_MS) {
    const days = Math.round(delta / DAY_MS);
    return `expires in ${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.max(1, Math.round(delta / HOUR_MS));
  return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

async function fetchShareUrl({ threadId, accessToken }) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/share`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expires_days: 30 }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not create share link.");
  }
  return response.json();
}

export function ShareModal({ open, thread, accessToken, onClose }) {
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [shareUrl, setShareUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setShareUrl("");
      setExpiresAt("");
      setError("");
      setToast("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const flashToast = useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!thread?.id) return;
    setStatus("loading");
    setError("");
    try {
      const { url, expires_at } = await fetchShareUrl({ threadId: thread.id, accessToken });
      const absolute = url?.startsWith("http") ? url : buildShareUrl(window.location.origin, url?.split("/").pop());
      setShareUrl(absolute);
      setExpiresAt(expires_at || "");
      setStatus("ready");
      const copied = await copyToClipboard(absolute);
      flashToast(copied ? "LINK COPIED" : "COPY FAILED");
    } catch (err) {
      setStatus("error");
      setError(err?.message || "Could not create share link.");
    }
  }, [thread, accessToken, flashToast]);

  const handleCopyMarkdown = useCallback(async () => {
    const md = serializeThreadAsMarkdown(thread);
    if (!md) {
      flashToast("NOTHING TO COPY");
      return;
    }
    const ok = await copyToClipboard(md);
    flashToast(ok ? "MARKDOWN COPIED" : "COPY FAILED");
  }, [thread, flashToast]);

  const handleExportPdf = useCallback(() => {
    if (!thread?.id) return;
    // Stub until a real PDF renderer lands — the server returns text/plain.
    window.open(`/api/threads/${encodeURIComponent(thread.id)}/export.pdf`, "_blank", "noopener");
  }, [thread]);

  if (!open) return null;

  const expiryLine = expiresAt ? formatExpiryLabel(expiresAt) : "";

  return h(
    "div",
    { className: "share-modal-backdrop", role: "dialog", "aria-modal": "true", onClick: onClose },
    h(
      "div",
      {
        className: "share-modal",
        onClick: (event) => event.stopPropagation(),
      },
      h("header", { className: "share-modal-head" },
        h("h2", null, "Share thread"),
        h("button", { type: "button", className: "share-modal-close", onClick: onClose, "aria-label": "Close" }, "×"),
      ),
      h("div", { className: "share-modal-body" },
        h("button", {
          type: "button",
          className: "share-modal-action",
          disabled: status === "loading",
          onClick: handleCopyLink,
        },
          h("span", { className: "share-modal-action-title" }, "Copy link"),
          h("span", { className: "share-modal-action-sub" }, "Read-only URL · 30-day expiry"),
        ),
        h("button", {
          type: "button",
          className: "share-modal-action",
          onClick: handleCopyMarkdown,
        },
          h("span", { className: "share-modal-action-title" }, "Copy as Markdown"),
          h("span", { className: "share-modal-action-sub" }, "Plain-text transcript with sources"),
        ),
        h("button", {
          type: "button",
          className: "share-modal-action",
          onClick: handleExportPdf,
        },
          h("span", { className: "share-modal-action-title" }, "Export as PDF"),
          h("span", { className: "share-modal-action-sub" }, "Downloadable transcript (plain text until PDF renderer ships)"),
        ),
        shareUrl
          ? h("div", { className: "share-modal-url" },
              h("code", null, shareUrl),
              expiryLine ? h("span", { className: "share-modal-expiry" }, expiryLine) : null,
            )
          : null,
        error ? h("p", { className: "share-modal-error" }, error) : null,
        toast ? h("p", { className: "share-modal-toast", role: "status" }, toast) : null,
      ),
    ),
  );
}

export default ShareModal;
