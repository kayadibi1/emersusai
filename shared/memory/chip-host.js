// shared/memory/chip-host.js — Phase 5
//
// Fetches pending memory rows for the active thread and keys them by
// source_turn_ref so consumers (react-chat-app.js) can inject chips
// under the assistant message that triggered them.
//
// Auto-polls on a visibility-change event so chips appear soon after the
// extractor writes them (fire-and-forget; no push signal from server).

import React from "react";
import { getSupabase } from "/shared/supabase.js";

const { useState, useEffect, useCallback } = React;

export function usePendingChips(threadId) {
  const [byTurnRef, setByTurnRef] = useState({});
  const [refreshTick, setRefreshTick] = useState(0);

  const reload = useCallback(() => setRefreshTick((n) => n + 1), []);

  useEffect(() => {
    if (!threadId) { setByTurnRef({}); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const sb = await getSupabase();
        const { data, error } = await sb
          .from("user_memories")
          .select(
            "id, category, tier, fact, metadata, status, source_turn_ref, supersedes_id, confidence, created_at",
          )
          .eq("source_thread_id", threadId)
          .eq("status", "pending")
          .order("created_at", { ascending: true });
        if (error || cancelled) return;
        const map = {};
        for (const r of data || []) {
          const k = r.source_turn_ref || "__unbound__";
          (map[k] = map[k] || []).push(r);
        }
        if (!cancelled) setByTurnRef(map);
      } catch { /* ignore */ }
    };

    load();

    // Refresh when the tab gains focus — cheap signal that the user just
    // returned to the chat (e.g. after triaging in Profile).
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);

    // Poll a few seconds after mount to catch the extractor's fire-and-forget
    // write. One-shot; not a recurring interval.
    const warmTimer = setTimeout(() => { if (!cancelled) load(); }, 3500);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(warmTimer);
    };
  }, [threadId, refreshTick]);

  return { byTurnRef, reload };
}
