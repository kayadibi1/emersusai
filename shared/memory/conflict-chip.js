// shared/memory/conflict-chip.js — Phase 5
//
// Variant of the confirmation chip for rows where supersedes_id is set.
// Shows "Update your X? Was Y, now Z" with three actions:
//   Update  — confirm the new row, archive the old
//   Keep both — confirm the new row, leave the old alone
//   Ignore  — reject the new row, leave the old alone

import React from "react";
import { getSupabase } from "/shared/supabase.js";

const { useState, useEffect } = React;
const h = React.createElement;

function formatCategory(cat) {
  return String(cat || "").replace(/_/g, " ").toLowerCase();
}

export function ConflictChip({ row, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [oldFact, setOldFact] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!row.supersedes_id) return;
    (async () => {
      try {
        const sb = await getSupabase();
        const { data, error: err } = await sb
          .from("user_memories")
          .select("id, fact, category")
          .eq("id", row.supersedes_id)
          .maybeSingle();
        if (err || cancelled) return;
        if (!cancelled) setOldFact(data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [row.supersedes_id]);

  async function update() {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const now = new Date().toISOString();
      const { error: newErr } = await sb.from("user_memories")
        .update({ status: "confirmed", confirmed_at: now })
        .eq("id", row.id);
      if (newErr) throw newErr;
      const { error: oldErr } = await sb.from("user_memories")
        .update({ status: "archived", resolved_at: now })
        .eq("id", row.supersedes_id);
      if (oldErr) throw oldErr;
      onResolved?.();
    } catch (err) {
      setError(err?.message || "Update failed.");
    } finally { setBusy(false); }
  }

  async function keepBoth() {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString(), supersedes_id: null })
        .eq("id", row.id);
      if (err) throw err;
      onResolved?.();
    } catch (err) {
      setError(err?.message || "Update failed.");
    } finally { setBusy(false); }
  }

  async function ignore() {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", row.id);
      if (err) throw err;
      onResolved?.();
    } catch (err) {
      setError(err?.message || "Update failed.");
    } finally { setBusy(false); }
  }

  return h("div", { className: "memory-chip memory-chip-conflict", role: "group", "aria-label": "Memory update" },
    h("div", { className: "memory-chip-eyebrow" }, "◆ UPDATE YOUR MEMORY?"),
    h("div", { className: "memory-chip-body" },
      h("span", { className: "memory-chip-category" }, formatCategory(row.category)),
      h("div", { className: "memory-chip-conflict-lines" },
        oldFact
          ? h("div", { className: "memory-chip-conflict-old" },
              h("span", { className: "memory-chip-conflict-label" }, "was "),
              h("span", null, oldFact.fact))
          : null,
        h("div", { className: "memory-chip-conflict-new" },
          h("span", { className: "memory-chip-conflict-label" }, "now "),
          h("span", null, row.fact)),
      ),
    ),
    h("div", { className: "memory-chip-actions" },
      h("button", {
        key: "update", type: "button",
        className: "memory-chip-btn-primary",
        disabled: busy, onClick: update,
      }, busy ? "…" : "✓ Update"),
      h("button", {
        key: "both", type: "button",
        className: "memory-chip-btn-secondary",
        disabled: busy, onClick: keepBoth,
      }, "Keep both"),
      h("button", {
        key: "ignore", type: "button",
        className: "memory-chip-btn-secondary",
        disabled: busy, onClick: ignore,
      }, "Ignore"),
    ),
    error ? h("div", { className: "memory-chip-error" }, error) : null,
  );
}

export default ConflictChip;
