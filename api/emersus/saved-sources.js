// api/emersus/saved-sources.js
//
// Per-user "Library" endpoints.
//
// GET    /api/emersus/saved-sources              → list user's saves (newest first)
// POST   /api/emersus/saved-sources              → save one source
// DELETE /api/emersus/saved-sources/:id          → unsave
//
// All endpoints sit behind requireAuth (mounted in server.js). We do NOT
// wrap in userRateLimit() — that would burn a daily-chat-message token on
// every bookmark toggle. The POST path enforces a 20-source cap for Free
// tier via resolveTier() → readTier(); Pro is uncapped. On over-cap we
// return 402 Payment Required with a `library_full` error code so the
// client can show the upsell toast.
//
// Writes go through supabaseAdmin (service role) — we trust the JWT
// auth middleware has already validated req.verifiedUserId and we want
// to bypass RLS while keeping the user_id pinned to the caller.
//
// See supabase/20260423_user_saved_sources.sql and
//     docs/superpowers/specs/2026-04-23-save-to-library-design.md

import { supabaseAdmin } from "../lib/clients.js";
import { readTier } from "./user-rate-limit.js";

const FREE_TIER_CAP = 20;
const NOTE_MAX_CHARS = 500;
const SOURCE_ID_MAX_CHARS = 400;

function normalizeSourceId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SOURCE_ID_MAX_CHARS) return null;
  return trimmed;
}

function normalizeMetaSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (typeof value.title === "string") out.title = value.title.slice(0, 400);
  if (Array.isArray(value.authors)) {
    out.authors = value.authors
      .map((a) => {
        if (typeof a === "string") return a.slice(0, 160);
        if (a && typeof a === "object") {
          if (typeof a.name === "string") return a.name.slice(0, 160);
          const first = typeof a.first === "string" ? a.first.slice(0, 80) : "";
          const last = typeof a.last === "string" ? a.last.slice(0, 80) : "";
          return [first, last].filter(Boolean).join(" ");
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof value.journal === "string") out.journal = value.journal.slice(0, 200);
  if (typeof value.year === "string" || typeof value.year === "number") {
    out.year = String(value.year).slice(0, 8);
  }
  if (typeof value.doi === "string") out.doi = value.doi.slice(0, 200);
  if (value.pmid !== undefined && value.pmid !== null) {
    const n = Number(value.pmid);
    if (Number.isFinite(n)) out.pmid = n;
  }
  if (typeof value.source === "string") out.source = value.source.slice(0, 40);
  if (typeof value.url === "string") out.url = value.url.slice(0, 600);
  if (typeof value.publication_type === "string") {
    out.publication_type = value.publication_type.slice(0, 120);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeSavedFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (typeof value.thread_id === "string") out.thread_id = value.thread_id.slice(0, 80);
  if (typeof value.message_id === "string") out.message_id = value.message_id.slice(0, 80);
  if (typeof value.thread_title === "string") out.thread_title = value.thread_title.slice(0, 200);
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeNote(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NOTE_MAX_CHARS);
}

async function readCount(userId) {
  const { count, error } = await supabaseAdmin
    .from("user_saved_sources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count || 0;
}

// Library endpoints mount with just `requireAuth`, not `userRateLimit()`
// (which would burn a chat-message token on every bookmark toggle). We
// read the tier directly from profiles via the same cached helper the
// chat path uses, so the check is cheap.
async function resolveTier(req) {
  const userId = req.verifiedUserId;
  if (!userId) return "free";
  try {
    const tier = await readTier(userId);
    return tier === "pro" ? "pro" : "free";
  } catch (err) {
    // Fail closed: treat as free so we never accidentally lift the cap
    // because of a lookup blip.
    console.error("saved-sources readTier failed:", err);
    return "free";
  }
}

// GET /api/emersus/saved-sources
// Optional query: ?ids_only=true → returns { ids: [...], count, cap }
// Used by the chat client to hydrate the bookmark icon state without
// paying for a full metadata round-trip.
async function handleList(req, res) {
  const userId = req.verifiedUserId;
  const tier = await resolveTier(req);
  const cap = tier === "pro" ? null : FREE_TIER_CAP;

  if (req.query?.ids_only === "true") {
    const { data, error } = await supabaseAdmin
      .from("user_saved_sources")
      .select("source_id")
      .eq("user_id", userId);
    if (error) {
      console.error("saved-sources list (ids_only) failed:", error);
      return res.status(500).json({ error: "internal_error" });
    }
    return res.status(200).json({
      ids: (data || []).map((r) => r.source_id),
      count: data?.length || 0,
      cap,
      tier,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("user_saved_sources")
    .select("id, source_id, saved_at, saved_from, note, meta_snapshot")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });
  if (error) {
    console.error("saved-sources list failed:", error);
    return res.status(500).json({ error: "internal_error" });
  }

  return res.status(200).json({
    items: data || [],
    count: data?.length || 0,
    cap,
    tier,
  });
}

async function handleCreate(req, res) {
  const userId = req.verifiedUserId;
  const tier = await resolveTier(req);
  const body = req.body || {};

  const sourceId = normalizeSourceId(body.source_id);
  if (!sourceId) {
    return res.status(400).json({ error: "source_id is required" });
  }
  const metaSnapshot = normalizeMetaSnapshot(body.meta_snapshot);
  if (!metaSnapshot) {
    return res
      .status(400)
      .json({ error: "meta_snapshot is required and must be an object with at least a title" });
  }
  const savedFrom = normalizeSavedFrom(body.saved_from);
  const note = normalizeNote(body.note);

  if (tier === "free") {
    const current = await readCount(userId);
    if (current >= FREE_TIER_CAP) {
      return res.status(402).json({
        error: "library_full",
        cap: FREE_TIER_CAP,
        tier,
        count: current,
        message:
          "Your Free library holds up to 20 sources. Upgrade to Pro for unlimited saves.",
      });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("user_saved_sources")
    .insert({
      user_id: userId,
      source_id: sourceId,
      saved_from: savedFrom,
      note,
      meta_snapshot: metaSnapshot,
    })
    .select("id, source_id, saved_at, saved_from, note, meta_snapshot")
    .single();

  if (error) {
    // unique_violation on (user_id, source_id) → already saved; treat
    // as idempotent 200 rather than 500 so optimistic client toggles
    // don't have to special-case double-click races.
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("user_saved_sources")
        .select("id, source_id, saved_at, saved_from, note, meta_snapshot")
        .eq("user_id", userId)
        .eq("source_id", sourceId)
        .maybeSingle();
      const count = await readCount(userId);
      return res.status(200).json({ item: existing, count, already_saved: true });
    }
    console.error("saved-sources insert failed:", error);
    return res.status(500).json({ error: "internal_error" });
  }

  const count = await readCount(userId);
  return res.status(201).json({ item: data, count });
}

async function handleDelete(req, res) {
  const userId = req.verifiedUserId;
  const id = String(req.params?.id || "").trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  // Match on both id and user_id so an authenticated user can never
  // delete someone else's row even if the id leaks.
  const { error } = await supabaseAdmin
    .from("user_saved_sources")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    console.error("saved-sources delete failed:", error);
    return res.status(500).json({ error: "internal_error" });
  }

  const count = await readCount(userId);
  return res.status(200).json({ ok: true, count });
}

// DELETE /api/emersus/saved-sources/by-source-id/:source_id
// Convenience for the chat-side bookmark toggle, which knows the
// source_id (DOI / pmid:N) but not the row uuid. The row uuid isn't
// exposed in the chat surface — only in the Library page.
async function handleDeleteBySourceId(req, res) {
  const userId = req.verifiedUserId;
  const sourceId = normalizeSourceId(
    decodeURIComponent(String(req.params?.source_id || ""))
  );
  if (!sourceId) return res.status(400).json({ error: "source_id is required" });

  const { error } = await supabaseAdmin
    .from("user_saved_sources")
    .delete()
    .eq("user_id", userId)
    .eq("source_id", sourceId);
  if (error) {
    console.error("saved-sources delete-by-source-id failed:", error);
    return res.status(500).json({ error: "internal_error" });
  }

  const count = await readCount(userId);
  return res.status(200).json({ ok: true, count });
}

export default async function savedSourcesHandler(req, res) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "POST") return await handleCreate(req, res);
    if (req.method === "DELETE") {
      if (req.params?.source_id) return await handleDeleteBySourceId(req, res);
      return await handleDelete(req, res);
    }
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("saved-sources handler error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
