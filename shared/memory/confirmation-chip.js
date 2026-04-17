// shared/memory/confirmation-chip.js — Phase 5
//
// Inline confirmation chip rendered under each assistant message whose
// extractor run produced a pending memory row. Keep / Edit / Not this
// flow updates the row status via direct-Supabase (RLS enforces per-user).

import React from "react";
import { getSupabase } from "/shared/supabase.js";
import { ConflictChip } from "/shared/memory/conflict-chip.js";

const { useState } = React;
const h = React.createElement;

function formatCategory(cat) {
  return String(cat || "").replace(/_/g, " ").toLowerCase();
}

export function ConfirmationChip({ row, onResolved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(row.fact);
  const [error, setError] = useState("");

  if (row.supersedes_id) {
    return h(ConflictChip, { row, onResolved });
  }

  async function act(update) {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories").update(update).eq("id", row.id);
      if (err) throw err;
      onResolved?.();
    } catch (err) {
      setError(err?.message || "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  const keep = () => act({ status: "confirmed", confirmed_at: new Date().toISOString() });
  const reject = () => act({ status: "rejected",  resolved_at:  new Date().toISOString() });
  const saveEdit = async () => {
    const t = String(draft || "").trim();
    if (t.length < 1 || t.length > 500) {
      setError("Fact must be 1–500 characters.");
      return;
    }
    await act({ status: "confirmed", confirmed_at: new Date().toISOString(), fact: t });
    setEditing(false);
  };

  return h("div", { className: "memory-chip", role: "group", "aria-label": "Memory confirmation" },
    h("div", { className: "memory-chip-eyebrow" }, "◆ NOTED FROM YOUR LAST MESSAGE"),
    h("div", { className: "memory-chip-body" },
      h("span", { className: "memory-chip-category" }, formatCategory(row.category)),
      !editing
        ? h("span", { className: "memory-chip-fact" }, row.fact)
        : h("textarea", {
            className: "memory-chip-fact-edit",
            rows: 2,
            maxLength: 500,
            value: draft,
            onChange: (e) => setDraft(e.target.value),
          }),
    ),
    h("div", { className: "memory-chip-actions" },
      ...(editing
        ? [
            h("button", {
              key: "save", type: "button",
              className: "memory-chip-btn-primary",
              disabled: busy, onClick: saveEdit,
            }, busy ? "…" : "Save"),
            h("button", {
              key: "cancel", type: "button",
              className: "memory-chip-btn-secondary",
              disabled: busy,
              onClick: () => { setEditing(false); setDraft(row.fact); setError(""); },
            }, "Cancel"),
          ]
        : [
            h("button", {
              key: "keep", type: "button",
              className: "memory-chip-btn-primary",
              disabled: busy, onClick: keep,
            }, "✓ Keep"),
            h("button", {
              key: "edit", type: "button",
              className: "memory-chip-btn-secondary",
              disabled: busy, onClick: () => setEditing(true),
            }, "✎ Edit"),
            h("button", {
              key: "nope", type: "button",
              className: "memory-chip-btn-secondary",
              disabled: busy, onClick: reject,
            }, "✗ Not this"),
          ]),
    ),
    error ? h("div", { className: "memory-chip-error" }, error) : null,
  );
}

export default ConfirmationChip;
