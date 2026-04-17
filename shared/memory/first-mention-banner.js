// shared/memory/first-mention-banner.js — Phase 4a
//
// One-time educational banner. Shown when:
//   - localStorage.emersus-memory-educated is unset
//   - The current user has at least one confirmed memory
// Dismissal is permanent for that browser profile.
//
// See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §7.4.

import React from "react";
import { getSupabase } from "/shared/supabase.js";

const { useState, useEffect } = React;
const h = React.createElement;

const STORAGE_KEY = "emersus-memory-educated";

export function FirstMentionBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch { /* ignore — private mode, etc. */ }

    let cancelled = false;
    (async () => {
      try {
        const sb = await getSupabase();
        const { count, error } = await sb
          .from("user_memories")
          .select("id", { count: "exact", head: true })
          .eq("status", "confirmed");
        if (error || cancelled) return;
        if ((count || 0) > 0) setShow(true);
      } catch { /* swallow — banner just stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return h("div", {
      className: "memory-intro-banner",
      role: "status",
      "aria-live": "polite",
    },
    h("span", { className: "memory-intro-banner-text" },
      "I'm now remembering facts about you across chats. You're in control — manage or delete anything in ",
      h("a", { href: "/app/profile/?tab=memory" }, "Profile › Memory"),
      ".",
    ),
    h("button", {
      type: "button",
      className: "memory-intro-banner-dismiss",
      onClick: dismiss,
      "aria-label": "Dismiss",
    }, "×"),
  );
}

export default FirstMentionBanner;
