// api/emersus/threads-share.js
//
// Thread-sharing endpoints for chat_v2:
//   POST   /api/threads/:id/share       → create or rotate a share token
//   GET    /api/threads/:id/export.pdf  → transcript download (stub: text/plain)
//   GET    /share/t/:token              → public read-only HTML (mounted at root)
//
// Requires migration supabase/20260415_threads_model_share.sql to be applied
// so that chat_threads has `shared_token` + `shared_expires_at` columns.

import express from "express";
import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/clients.js";
import { requireAuth } from "./auth-middleware.js";

const TOKEN_BYTES = 18; // 18 random bytes → 24 base64url chars; we trim to 22.
const TOKEN_LENGTH = 22;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;
const TABLE = "chat_threads";

export function generateShareToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url").slice(0, TOKEN_LENGTH);
}

export function resolveExpiryDate(inputDays, now = new Date()) {
  const raw = Number(inputDays);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_EXPIRY_DAYS) : DEFAULT_EXPIRY_DAYS;
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

function serializeThreadPlain(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const lines = [thread?.title ? `# ${thread.title}` : "# Conversation", ""];
  for (const message of messages) {
    const role = message?.role === "user" ? "You" : "Emersus";
    const text = String(message?.text || message?.plainText || "").trim();
    if (!text) continue;
    lines.push(`${role}:`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPublicShareHtml(thread) {
  const title = escapeHtml(thread?.title || "Conversation");
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const bodyParts = [];
  for (const message of messages) {
    const role = message?.role === "user" ? "You" : "Emersus";
    const text = String(message?.text || message?.plainText || "").trim();
    if (!text) continue;
    bodyParts.push(`<article class="msg ${message?.role || "assistant"}">`);
    bodyParts.push(`<h3>${escapeHtml(role)}</h3>`);
    bodyParts.push(`<pre>${escapeHtml(text)}</pre>`);
    bodyParts.push("</article>");
  }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${title} — Emersus AI</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 48px 24px; line-height: 1.6; }
    h1 { font-size: 22px; margin-bottom: 32px; }
    article.msg { margin-bottom: 28px; }
    article.msg h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6b6b; }
    article.msg pre { white-space: pre-wrap; font-family: inherit; font-size: 15px; margin: 0; }
    footer { margin-top: 48px; font-size: 12px; color: #6b6b6b; }
    footer a { color: inherit; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${bodyParts.join("\n")}
  <footer>
    Shared from <a href="https://emersus.ai/">Emersus AI</a> — evidence-based fitness &amp; nutrition chat.
  </footer>
</body>
</html>`;
}

async function loadOwnedThread(threadId, userId) {
  if (!supabaseAdmin) throw new Error("Supabase admin client unavailable.");
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id,user_id,title,messages,shared_token,shared_expires_at")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadSharedThread(token) {
  if (!supabaseAdmin) throw new Error("Supabase admin client unavailable.");
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id,title,messages,shared_token,shared_expires_at")
    .eq("shared_token", token)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function threadsShareApiRouter() {
  const router = express.Router();

  router.post("/:id/share", requireAuth, async (req, res) => {
    try {
      const threadId = req.params.id;
      const userId = req.verifiedUserId;
      const thread = await loadOwnedThread(threadId, userId);
      if (!thread) return res.status(404).json({ error: "Thread not found." });

      const expiryDays = Number(req.body?.expires_days);
      const expiresAt = resolveExpiryDate(expiryDays);
      const token = generateShareToken();

      const { error: updateError } = await supabaseAdmin
        .from(TABLE)
        .update({ shared_token: token, shared_expires_at: expiresAt.toISOString() })
        .eq("id", threadId)
        .eq("user_id", userId);
      if (updateError) throw updateError;

      res.json({ url: `/share/t/${token}`, expires_at: expiresAt.toISOString() });
    } catch (err) {
      console.error("thread share error", err);
      res.status(500).json({ error: "Could not create share link." });
    }
  });

  router.get("/:id/export.pdf", requireAuth, async (req, res) => {
    try {
      const thread = await loadOwnedThread(req.params.id, req.verifiedUserId);
      if (!thread) return res.status(404).json({ error: "Thread not found." });
      // Stub: real PDF renderer lands in a follow-up. For now, serve a plain
      // UTF-8 transcript with the same filename as the eventual PDF so the
      // download UX is predictable for users.
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="emersus-thread-${req.params.id}.txt"`);
      res.send(serializeThreadPlain(thread));
    } catch (err) {
      console.error("thread export error", err);
      res.status(500).json({ error: "Could not export thread." });
    }
  });

  return router;
}

export function publicShareRouter() {
  const router = express.Router();

  router.get("/share/t/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "");
      if (!token || token.length > 64) return res.status(404).send("Not found.");

      const thread = await loadSharedThread(token);
      if (!thread || !thread.shared_token) return res.status(404).send("Not found.");
      const expiresAt = thread.shared_expires_at ? new Date(thread.shared_expires_at) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        return res.status(410).send("Share link expired.");
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "private, max-age=30");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.send(renderPublicShareHtml(thread));
    } catch (err) {
      console.error("public share render error", err);
      res.status(500).send("Internal error.");
    }
  });

  return router;
}

export default threadsShareApiRouter;
