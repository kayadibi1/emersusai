# Cross-Thread Memory — Phase 4a Implementation Plan (Memory tab + CRUD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the user-visible control surface for cross-thread memory. After this plan, a signed-in user at `/app/profile/` → Memory sees every saved memory grouped by tier, can edit the fact text, mark rows resolved or archived, delete single rows, export the full set as JSON, or hard-delete everything (re-auth gated). Opens the trust infrastructure that Phase 5 (auto-extractor) needs before it can safely start capturing facts silently.

**Scope explicitly split:** Phase 4a is the half of spec §7 that's useful *before* auto-extraction ships. The autosave master toggle, the pending-review confirmation chip, and the `FROM DELETED THREAD` orphan badge are deferred to Phase 4b (rolled into Phase 5) because they're all reactive to pending/orphaned rows the extractor produces — dead UI without that data source.

**Architecture:** Pure frontend + direct-Supabase with RLS. Zero new server endpoints. The client uses the authenticated JWT so:
- List / edit / archive / resolve / per-row delete → Supabase `from('user_memories')` with RLS auto-scoping
- Delete-all → client-side re-auth via `signInWithPassword`, then `rpc('delete_all_my_memories')` (the SECURITY DEFINER fn from Phase 0)
- Export → `select * from user_memories` + client-side JSON download

**Tech stack:** React 18 via esm.sh · existing `@supabase/supabase-js` client · existing `getSupabase()` helper · existing `requireAuth()` from `/shared/auth-client.js`.

**Spec reference:** `docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md` §7.3 (Profile › Memory tab), §7.4 (first-mention banner), §9.4 (hard-delete with re-auth + audit).

**Prior phases:** all shipped 2026-04-16/17. `MEMORY_REMEMBER_FACT_ENABLED=true`, `MEMORY_RECALL_ENABLED=true`, `MEMORY_EXTRACTOR_ENABLED=false`.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `app/profile/profile.js` | Modify | Add `memory` to TABS array between `injuries` and `appearance`; add `MemoryTab` + `MemoryDeleteAllModal` components; wire tab panel render |
| `shared/profile.css` | Modify | `.pf-memory-*` classes for list, sections, row, action menu, danger zone |
| `shared/memory/first-mention-banner.js` | Create | Small helper that checks `localStorage.emersus-memory-educated` + renders a dismissible banner above the chat thread |
| `shared/react-chat-app.js` | Modify | Import + render `FirstMentionBanner` at the top of the main chat view when the flag is unset AND the user has ≥1 confirmed memory |

Zero migration, zero server endpoints, zero pipeline changes.

---

## Task 1 — Add `memory` tab slot + empty panel

**Files:**
- Modify: `app/profile/profile.js`

- [ ] **Step 1: Add `memory` to TABS array between injuries and appearance**

Find the `TABS` const in `app/profile/profile.js` and update:

```javascript
const TABS = [
  { id: "goals",        label: "Goals" },
  { id: "equipment",    label: "Equipment" },
  { id: "injuries",     label: "Injuries" },
  { id: "memory",       label: "Memory" },       // ← NEW
  { id: "appearance",   label: "Appearance" },
  { id: "billing",      label: "Billing" },
];
```

- [ ] **Step 2: Stub the MemoryTab component and wire the render**

Below the existing tab components, add:

```javascript
function MemoryTab() {
  return h("div", { className: "pf-memory" },
    h("h2", { className: "pf-section-title" }, "Memory"),
    h("p", { className: "pf-helper" }, "Loading…"),
  );
}
```

Wire it next to the other tab renders (find the line like `tab === "injuries" ? h(InjuriesTab, null) : null`):

```javascript
tab === "memory" ? h(MemoryTab, null) : null,
```

- [ ] **Step 3: Deploy preview locally**

```bash
cd /c/Users/Sidar/Desktop/emersus
npm run build 2>&1 | tail -5
```

Expected: build succeeds. No functional verification yet — stub tab exists.

- [ ] **Step 4: Commit**

```bash
git add app/profile/profile.js
git commit -m "feat(memory): Phase 4a — Memory tab slot in Profile

Empty tab between Injuries and Appearance. Next task fills the panel
with the list + actions."
```

---

## Task 2 — Fetch + render memory list grouped by tier

**Files:**
- Modify: `app/profile/profile.js`

- [ ] **Step 1: Replace the stub with the data-fetch + grouped render**

Replace the stub `MemoryTab` with:

```javascript
const TIER_ORDER = [
  { tier: "A", label: "Medical" },
  { tier: "D", label: "Active now" },
  { tier: "B", label: "Training" },
  { tier: "C", label: "Milestones" },
  { tier: "E", label: "Preferences" },
  { tier: "X", label: "Custom" },
];

const STATUS_LIVE = new Set(["confirmed"]);

function formatCategory(cat) {
  return String(cat || "").replace(/_/g, " ").toLowerCase();
}

function MemoryTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const reload = useCallback(async () => {
    setError("");
    try {
      const sb = await getSupabase();
      const { data, error: err } = await sb
        .from("user_memories")
        .select("id, category, tier, fact, metadata, status, created_at, confirmed_at, resolved_at, last_mentioned_at, expires_at, source_thread_id")
        .order("tier", { ascending: true })
        .order("created_at", { ascending: false });
      if (err) throw err;
      setRows(data || []);
    } catch (err) {
      setError(err?.message || "Could not load memory.");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (rows === null && !error) {
    return h("div", { className: "pf-memory" },
      h("h2", { className: "pf-section-title" }, "Memory"),
      h("p", { className: "pf-helper" }, "Loading…"));
  }
  if (error) {
    return h("div", { className: "pf-memory" },
      h("h2", { className: "pf-section-title" }, "Memory"),
      h("p", { className: "pf-error" }, error));
  }

  const live = rows.filter((r) => STATUS_LIVE.has(r.status));
  const archived = rows.filter((r) => r.status === "archived" || r.status === "resolved");
  const grouped = TIER_ORDER.map((g) => ({
    ...g,
    rows: live.filter((r) => r.tier === g.tier),
  })).filter((g) => g.rows.length > 0);

  const lastSaved = live.length
    ? new Date(live.reduce((max, r) =>
        new Date(r.confirmed_at || r.created_at) > max ? new Date(r.confirmed_at || r.created_at) : max,
        new Date(0)))
    : null;

  return h("div", { className: "pf-memory" },
    h("header", { className: "pf-memory-head" },
      h("h2", { className: "pf-section-title" }, "Memory"),
      h("p", { className: "pf-memory-summary" },
        `${live.length} saved${lastSaved ? ` · last saved ${lastSaved.toISOString().slice(0, 10)}` : ""}`),
    ),

    grouped.length === 0
      ? h("p", { className: "pf-helper" },
          "Nothing saved yet. Ask me to remember something across chats and it'll appear here.")
      : grouped.map((g) =>
          h("section", { key: g.tier, className: "pf-memory-group" },
            h("h3", { className: "pf-memory-group-title" }, `${g.label.toUpperCase()} (${g.rows.length})`),
            h("ul", { className: "pf-memory-list" },
              g.rows.map((r) => h(MemoryRow, { key: r.id, row: r, onMutate: reload })),
            ),
          )),

    archived.length > 0
      ? h("section", { className: "pf-memory-archive" },
          h("button", {
            type: "button",
            className: "pf-memory-archive-toggle",
            onClick: () => setShowArchive((v) => !v),
          }, `${showArchive ? "▾" : "▸"} Archive (${archived.length})`),
          showArchive ? h("ul", { className: "pf-memory-list pf-memory-list-muted" },
            archived.map((r) => h(MemoryRow, { key: r.id, row: r, onMutate: reload })),
          ) : null,
        )
      : null,

    h(MemoryDangerZone, { onMutate: reload }),
  );
}

function MemoryRow({ row, onMutate }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftFact, setDraftFact] = useState(row.fact);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const patch = useCallback(async (body) => {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories").update(body).eq("id", row.id);
      if (err) throw err;
      await onMutate();
    } catch (err) {
      setError(err?.message || "Update failed.");
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }, [row.id, onMutate]);

  const hardDelete = useCallback(async () => {
    if (!window.confirm(`Delete "${String(row.fact).slice(0, 60)}${row.fact.length > 60 ? "…" : ""}" permanently?`)) return;
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories").delete().eq("id", row.id);
      if (err) throw err;
      await onMutate();
    } catch (err) {
      setError(err?.message || "Delete failed.");
    } finally { setBusy(false); setMenuOpen(false); }
  }, [row.id, row.fact, onMutate]);

  const saveEdit = useCallback(async () => {
    const text = draftFact.trim();
    if (text.length < 1 || text.length > 500) {
      setError("Fact must be 1-500 characters."); return;
    }
    await patch({ fact: text });
    setEditing(false);
  }, [draftFact, patch]);

  const isLive = row.status === "confirmed";
  const categoryLabel = formatCategory(row.category);

  return h("li", { className: `pf-memory-row${isLive ? "" : " is-muted"}`, "data-status": row.status },
    h("div", { className: "pf-memory-row-head" },
      h("span", { className: "pf-memory-category" }, categoryLabel),
      !editing
        ? h("span", { className: "pf-memory-fact" }, row.fact)
        : h("textarea", {
            className: "pf-memory-fact-edit",
            rows: 2,
            value: draftFact,
            onChange: (e) => setDraftFact(e.target.value),
            maxLength: 500,
          }),
      h("div", { className: "pf-memory-row-actions" },
        editing
          ? [
              h("button", { key: "save", type: "button", className: "pf-memory-btn-primary", disabled: busy, onClick: saveEdit }, busy ? "…" : "Save"),
              h("button", { key: "cancel", type: "button", className: "pf-memory-btn-secondary", disabled: busy, onClick: () => { setEditing(false); setDraftFact(row.fact); setError(""); } }, "Cancel"),
            ]
          : h("div", { className: "pf-memory-menu-wrap", onMouseDown: (e) => e.stopPropagation() },
              h("button", {
                type: "button",
                className: "pf-memory-menu-btn",
                "aria-label": "More actions",
                disabled: busy,
                onClick: () => setMenuOpen((v) => !v),
              }, "⋯"),
              menuOpen
                ? h("ul", { className: "pf-memory-menu" },
                    isLive ? h("li", null, h("button", {
                      type: "button",
                      onClick: () => { setMenuOpen(false); setEditing(true); },
                    }, "Edit fact")) : null,
                    isLive ? h("li", null, h("button", {
                      type: "button",
                      onClick: () => patch({ status: "resolved", resolved_at: new Date().toISOString() }),
                    }, "Mark resolved")) : null,
                    isLive ? h("li", null, h("button", {
                      type: "button",
                      onClick: () => patch({ status: "archived" }),
                    }, "Archive")) : null,
                    h("li", null, h("button", {
                      type: "button",
                      className: "pf-memory-menu-danger",
                      onClick: hardDelete,
                    }, "Delete permanently")),
                  )
                : null,
            ),
      ),
    ),
    error ? h("div", { className: "pf-memory-row-error" }, error) : null,
  );
}
```

- [ ] **Step 2: Add required imports at the top of profile.js**

Grep for the existing imports and extend if missing:

```bash
grep -nE "^import" app/profile/profile.js | head -8
```

Ensure these exist (add if missing):

```javascript
import { getSupabase } from "/shared/supabase.js";
import { useState, useEffect, useCallback } from "react";  // or however profile.js already imports
```

Check existing profile.js hooks usage to match its style (`React.useState` vs destructured).

- [ ] **Step 3: Rebuild + eyeball locally**

```bash
npm run build 2>&1 | tail -3
```

Manual check: open `/app/profile/` in a dev environment if available. Confirm the Memory tab renders the single Phase 1 injury row.

- [ ] **Step 4: Commit**

```bash
git add app/profile/profile.js
git commit -m "feat(memory): Phase 4a — MemoryTab list + row actions

Fetches via direct-Supabase (RLS auto-scopes). Groups by tier (Medical /
Active now / Training / Milestones / Preferences / Custom). Per-row
actions: Edit, Mark resolved, Archive, Delete permanently. Archive
section collapses by default."
```

---

## Task 3 — Danger zone: Export JSON + Delete all with re-auth

**Files:**
- Modify: `app/profile/profile.js`

- [ ] **Step 1: Add the danger-zone component**

Append below `MemoryRow`:

```javascript
function MemoryDangerZone({ onMutate }) {
  const [modal, setModal] = useState(null); // null | "export" | "delete"

  const exportJson = useCallback(async () => {
    try {
      const sb = await getSupabase();
      const { data, error: err } = await sb.from("user_memories").select("*");
      if (err) throw err;
      const blob = new Blob([JSON.stringify({ memories: data || [], exported_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `emersus-memory-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(`Export failed: ${err?.message || err}`);
    }
  }, []);

  return h("section", { className: "pf-memory-danger" },
    h("h3", { className: "pf-memory-danger-title" }, "DANGER ZONE"),
    h("div", { className: "pf-memory-danger-row" },
      h("button", { type: "button", className: "pf-memory-btn-secondary", onClick: exportJson }, "Export my memory as JSON"),
      h("button", { type: "button", className: "pf-memory-btn-danger", onClick: () => setModal("delete") }, "Delete all memory…"),
    ),
    modal === "delete"
      ? h(MemoryDeleteAllModal, { onClose: () => setModal(null), onDone: () => { setModal(null); void onMutate(); } })
      : null,
  );
}

function MemoryDeleteAllModal({ onClose, onDone }) {
  const [typed, setTyped]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");

  const ready = typed.trim().toLowerCase() === "delete" && password.length >= 1;

  const confirm = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      // Re-auth with the current session's email + typed password.
      const userRes = await sb.auth.getUser();
      if (userRes.error || !userRes.data?.user?.email) {
        throw new Error("Could not identify current user.");
      }
      const email = userRes.data.user.email;
      const auth = await sb.auth.signInWithPassword({ email, password });
      if (auth.error) throw new Error("Password incorrect.");
      // Call the audit-logged SECURITY DEFINER function.
      const { data, error: rpcErr } = await sb.rpc("delete_all_my_memories");
      if (rpcErr) throw rpcErr;
      window.alert(`Deleted ${data} memor${data === 1 ? "y" : "ies"}.`);
      onDone?.();
    } catch (err) {
      setError(err?.message || "Delete failed.");
    } finally {
      setBusy(false);
    }
  }, [password, onDone]);

  return h("div", { className: "pf-modal-backdrop", onMouseDown: onClose },
    h("div", { className: "pf-modal", onMouseDown: (e) => e.stopPropagation() },
      h("header", { className: "pf-modal-head" }, h("h3", null, "Delete all memory")),
      h("div", { className: "pf-modal-body" },
        h("p", null, "This permanently removes every fact I've saved about you. This can't be undone."),
        h("ol", null,
          h("li", null, "Type ", h("code", null, "delete"), " to confirm:"),
          h("li", null, h("input", {
            className: "pf-memory-input",
            type: "text",
            value: typed,
            onChange: (e) => setTyped(e.target.value),
            placeholder: "delete",
          })),
          h("li", null, "Re-enter your password:"),
          h("li", null, h("input", {
            className: "pf-memory-input",
            type: "password",
            value: password,
            onChange: (e) => setPassword(e.target.value),
            autoComplete: "current-password",
          })),
        ),
        error ? h("p", { className: "pf-error" }, error) : null,
      ),
      h("footer", { className: "pf-modal-foot" },
        h("button", { type: "button", className: "pf-memory-btn-secondary", disabled: busy, onClick: onClose }, "Cancel"),
        h("button", { type: "button", className: "pf-memory-btn-danger", disabled: !ready || busy, onClick: confirm }, busy ? "Deleting…" : "Delete everything"),
      ),
    ),
  );
}
```

- [ ] **Step 2: Rebuild + commit**

```bash
npm run build 2>&1 | tail -3
git add app/profile/profile.js
git commit -m "feat(memory): Phase 4a — danger zone export + delete-all

Export uses direct-Supabase select + client-side JSON download.
Delete-all flow: type 'delete' + re-enter password (client-side
signInWithPassword as the re-auth gate), then call the
delete_all_my_memories() SECURITY DEFINER RPC which audits to
guardrail_events before deleting."
```

---

## Task 4 — Styling

**Files:**
- Modify: `shared/profile.css`

- [ ] **Step 1: Append Memory tab styles**

At the bottom of `shared/profile.css`:

```css
/* ========================================================================== */
/* Profile › Memory tab (Phase 4a)                                            */
/* ========================================================================== */

.pf-memory { display: flex; flex-direction: column; gap: 24px; }
.pf-memory-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.pf-memory-summary {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--dim); margin: 0;
}

.pf-memory-group { display: flex; flex-direction: column; gap: 10px; }
.pf-memory-group-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; letter-spacing: 0.22em; color: var(--muted);
  margin: 0 0 4px; font-weight: 500; text-transform: uppercase;
}

.pf-memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pf-memory-list-muted .pf-memory-row { opacity: 0.7; }

.pf-memory-row {
  background: var(--surface-faint);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 6px;
  transition: border-color 0.14s;
}
.pf-memory-row.is-muted { border-style: dashed; }
.pf-memory-row:hover { border-color: var(--line-strong); }

.pf-memory-row-head { display: flex; align-items: flex-start; gap: 12px; }
.pf-memory-category {
  flex: 0 0 auto;
  min-width: 120px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--accent); padding-top: 2px;
}
.pf-memory-fact { flex: 1 1 auto; font-size: 14px; line-height: 1.5; color: var(--ink); }
.pf-memory-fact-edit {
  flex: 1 1 auto; font: inherit;
  background: var(--composer-bg); color: var(--ink);
  border: 1px solid var(--accent-line);
  border-radius: 6px; padding: 6px 8px; resize: vertical;
}
.pf-memory-row-actions { flex: 0 0 auto; display: flex; gap: 6px; }
.pf-memory-row-error { color: var(--danger); font-size: 12px; margin-left: 132px; }

.pf-memory-menu-wrap { position: relative; }
.pf-memory-menu-btn {
  background: transparent; border: 1px solid transparent;
  color: var(--muted); cursor: pointer; padding: 4px 10px; border-radius: 6px;
  font-size: 16px; line-height: 1; min-height: 32px;
}
.pf-memory-menu-btn:hover { color: var(--ink); border-color: var(--line); }
.pf-memory-menu {
  position: absolute; top: calc(100% + 4px); right: 0;
  list-style: none; margin: 0; padding: 6px; min-width: 200px;
  background: var(--surface, var(--bg));
  border: 1px solid var(--line-strong);
  border-radius: 8px; z-index: 20;
  box-shadow: 0 10px 32px rgba(0,0,0,0.22);
}
.pf-memory-menu li { list-style: none; }
.pf-memory-menu button {
  width: 100%; text-align: left;
  background: transparent; border: 0;
  padding: 8px 10px; border-radius: 6px;
  font: inherit; color: var(--ink); cursor: pointer;
}
.pf-memory-menu button:hover { background: var(--surface-faint); }
.pf-memory-menu-danger { color: var(--danger) !important; }

.pf-memory-btn-primary {
  background: var(--accent); color: var(--accent-text);
  border: 0; padding: 6px 12px; border-radius: 6px; font-weight: 600;
  font: inherit; cursor: pointer;
}
.pf-memory-btn-secondary {
  background: transparent; color: var(--ink);
  border: 1px solid var(--line); padding: 6px 12px; border-radius: 6px;
  font: inherit; cursor: pointer;
}
.pf-memory-btn-secondary:hover { border-color: var(--line-strong); }
.pf-memory-btn-danger {
  background: var(--danger); color: var(--accent-text);
  border: 0; padding: 6px 12px; border-radius: 6px; font-weight: 600;
  font: inherit; cursor: pointer;
}
.pf-memory-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

.pf-memory-archive { margin-top: 16px; }
.pf-memory-archive-toggle {
  background: transparent; border: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; letter-spacing: 0.22em; color: var(--dim);
  cursor: pointer; padding: 8px 0;
  text-transform: uppercase;
}
.pf-memory-archive-toggle:hover { color: var(--ink); }

.pf-memory-danger {
  margin-top: 24px; padding: 20px;
  border: 1px solid var(--danger);
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 12px;
}
.pf-memory-danger-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; letter-spacing: 0.22em; color: var(--danger);
  margin: 0; font-weight: 600;
}
.pf-memory-danger-row { display: flex; gap: 12px; flex-wrap: wrap; }

.pf-memory-input {
  width: 100%; font: inherit;
  background: var(--composer-bg); color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: 6px; padding: 7px 10px;
}

.pf-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.48);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; z-index: 1000;
}
.pf-modal {
  background: var(--bg);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 480px; width: 100%;
  display: flex; flex-direction: column; gap: 14px;
}
.pf-modal-head h3 { margin: 0; font-size: 18px; }
.pf-modal-body { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.pf-modal-foot { display: flex; justify-content: flex-end; gap: 10px; }

@media (max-width: 600px) {
  .pf-memory-row-head { flex-direction: column; gap: 8px; }
  .pf-memory-category { min-width: 0; }
  .pf-memory-row-actions { align-self: flex-end; }
  .pf-memory-row-error { margin-left: 0; }
}
```

- [ ] **Step 2: Rebuild + commit**

```bash
npm run build 2>&1 | tail -3
git add shared/profile.css
git commit -m "style(memory): Phase 4a — .pf-memory-* classes for Memory tab"
```

---

## Task 5 — First-mention banner

**Files:**
- Create: `shared/memory/first-mention-banner.js`
- Modify: `shared/react-chat-app.js`

Per spec §7.4: first time a user has ≥1 confirmed memory, show a one-time dismissible banner above the thread explaining that memory is active and pointing to Profile › Memory for control. Stored in `localStorage.emersus-memory-educated = "1"`.

- [ ] **Step 1: Write the banner component**

```javascript
// shared/memory/first-mention-banner.js
// One-time educational banner. Shown when:
//   - localStorage.emersus-memory-educated is unset
//   - The current user has at least one confirmed memory
// Dismissal is permanent for that browser profile.

import React from "react";
import { getSupabase } from "/shared/supabase.js";

const { useState, useEffect } = React;
const h = React.createElement;

const STORAGE_KEY = "emersus-memory-educated";

export function FirstMentionBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY) === "1") return;

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
```

- [ ] **Step 2: Render the banner in the chat shell**

Find where the chat main area renders in `shared/react-chat-app.js` and add:

```javascript
import { FirstMentionBanner } from "/shared/memory/first-mention-banner.js";
// ... inside the main chat layout, above the message list:
h(FirstMentionBanner, null),
```

Grep for the right insertion point:

```bash
grep -nE "chat-main|chat-messages|className.*chat-app" shared/react-chat-app.js | head -10
```

Pick a spot that renders on every main chat view (not inside the per-message render).

- [ ] **Step 3: Styling**

Append to `shared/chat.css`:

```css
.memory-intro-banner {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 16px;
  margin: 8px 16px 0;
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  border-radius: 8px;
  font-size: 13px; color: var(--ink);
}
.memory-intro-banner a { color: var(--accent); font-weight: 600; }
.memory-intro-banner-dismiss {
  background: transparent; border: 0;
  color: var(--muted); cursor: pointer;
  font-size: 18px; line-height: 1;
  padding: 4px 8px;
  min-height: 32px; min-width: 32px;
}
.memory-intro-banner-dismiss:hover { color: var(--ink); }
```

- [ ] **Step 4: Rebuild + commit**

```bash
npm run build 2>&1 | tail -3
git add shared/memory/first-mention-banner.js shared/react-chat-app.js shared/chat.css
git commit -m "feat(memory): Phase 4a — first-mention education banner

One-time banner above the chat thread explaining memory is active +
pointing to Profile › Memory. Shows only when a user has ≥1 confirmed
memory AND hasn't dismissed it. localStorage-persisted."
```

---

## Task 6 — Deploy + smoke

**Files:** none (ops-only)

- [ ] **Step 1: Push**

```bash
git push origin main
```

Webhook auto-builds + restarts emersus-api.

- [ ] **Step 2: Verify deploy**

```bash
ssh hetzner "pm2 logs webhook --lines 15 --nostream 2>&1 | tail -10"
```

Expected: ✓ built + deploy complete.

- [ ] **Step 3: Manual smoke**

Sign in at `https://emersus.ai/app/profile/?tab=memory`:

1. **List render:** the Phase 1 torn-ACL row should appear under the "Medical" group with category pill `injury`. Summary text reads something like "1 saved · last saved 2026-04-16".
2. **Edit flow:** click `⋯` → Edit fact → change text (e.g., add " (grade 2)") → Save. Row updates in place.
3. **Resolve flow:** click `⋯` → Mark resolved. Row moves out of Medical, appears under Archive when expanded. (Undo by editing status back to confirmed via SQL if needed — but probably don't, leave it for testing archive visibility.)
4. **Delete single:** click `⋯` → Delete permanently → confirm browser prompt. Row disappears.
5. **Export:** click Export my memory as JSON → browser downloads `emersus-memory-2026-04-17.json`. Inspect — should contain all rows including resolved/archived/deleted states (if applicable).
6. **First-mention banner:** after re-creating a confirmed memory (e.g., ask chat to "remember that I always train fasted"), clear `localStorage.emersus-memory-educated` in DevTools, refresh `/app/`. Banner should appear once; dismiss it; refresh — should not re-appear.
7. **Delete all:** reserved for last. Type `delete` + password → confirm. All rows removed. Then re-save the knee fact via chat ("Remember that my left knee is the bad one — torn ACL from 2022") so Phase 5 planning has the test fixture back.

- [ ] **Step 4: Append changelog entry (local-only)**

```
- 2026-04-17 — Cross-thread memory Phase 4a LIVE — Profile › Memory tab with grouped list (by tier), per-row CRUD (edit, mark resolved, archive, delete permanently), archive section, export JSON, delete-all with re-auth + audit via delete_all_my_memories() SECURITY DEFINER RPC, first-mention banner above chat. Zero new server endpoints — all direct-Supabase with RLS. — app/profile/profile.js, shared/profile.css, shared/memory/first-mention-banner.js, shared/react-chat-app.js, shared/chat.css
```

---

## Self-review checklist

- [ ] **Spec coverage.** §7.3 (tab layout, per-row menu, archive section, danger zone) — covered. §7.4 (first-mention banner, localStorage.emersus-memory-educated) — covered. §9.4 (hard-delete re-auth + audit) — covered via client-side `signInWithPassword` + `delete_all_my_memories()` RPC. Pending chip / autosave toggle / orphan badge — explicitly deferred to Phase 4b (rolled into Phase 5).
- [ ] **Placeholder scan.** No TBD. Each React component's code is fully specified inline.
- [ ] **Type consistency.** Column names (category, tier, fact, metadata, status, etc.) match the Phase 0 schema exactly. `delete_all_my_memories()` RPC name matches the migration. `getSupabase` import path matches existing Profile tab usage.
- [ ] **Rollback.** Nothing destructive shipped to prod schema-wise. If the UI breaks: revert the commits, push, auto-deploy rolls back. Client-side-only feature.
- [ ] **Test coverage.** No frontend component tests — matches existing codebase convention (no React tests in repo). Backend is untouched; all 508 unit tests stay green by virtue of not changing anything they cover. Manual smoke in Task 6 Step 3 is the verification.

---

## Out of scope for Phase 4a (→ Phase 4b / Phase 5)

- `memory_autosave` master toggle — lights up Phase 5's auto-extractor; meaningless UI until Phase 5 ships.
- Confirmation chip for pending rows — no pending rows until Phase 5's extractor writes them.
- `FROM DELETED THREAD` orphan badge — pending-orphan case is only reachable via Phase 5 writes to deleted threads.
- `Pending review` section at top of the Memory tab — same reason.
- Category-scoped bulk actions — power-user feature; revisit after real usage data.
- Search/filter within the tab — same.

These all ship in the Phase 5 plan alongside the auto-extractor itself.
