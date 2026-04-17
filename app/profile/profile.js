// app/profile/profile.js — Phase 6 Profile v2 page entry.
//
// Single React app rendering 5 tabs (Goals · Equipment · Injuries · Integrations · Billing).
// Reads / writes via /api/profile and /api/integrations/waitlist.
//
// Lightweight inline component (no separate per-tab modules) — keeps the
// bundle small and the code easy to scan during the redesign sprint.

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { getSession, requireAuth, getSupabase } from "/shared/supabase.js";
import { applyTheme, readSavedTheme, VALID_THEMES } from "/shared/theme.js";

const h = React.createElement;

// SOON-tabbed entries are hidden from the tab bar until the feature ships
// (Miller/Hick — don't spend attention on unshipped surface). Re-add when
// the backing endpoints and panels are ready.
const TABS = [
  { id: "goals",        label: "Goals" },
  { id: "equipment",    label: "Equipment" },
  { id: "injuries",     label: "Injuries" },
  { id: "memory",       label: "Memory" },
  { id: "appearance",   label: "Appearance" },
  { id: "billing",      label: "Billing" },
];

const GOAL_OPTIONS = [
  { id: "hypertrophy", label: "Hypertrophy" },
  { id: "strength",    label: "Strength" },
  { id: "endurance",   label: "Endurance" },
  { id: "general",     label: "General" },
  { id: "hybrid",      label: "Hybrid" },
];

const EXPERIENCE_OPTIONS = [
  { id: "beginner",     label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced",     label: "Advanced" },
];

const TRAINING_ENV_OPTIONS = [
  { id: "home",       label: "Home" },
  { id: "commercial", label: "Commercial gym" },
  { id: "outdoor",    label: "Outdoor" },
  { id: "mixed",      label: "Mixed" },
];

const EQUIPMENT_OPTIONS = [
  { id: "barbell",       label: "Olympic barbell",  sub: "20 KG STANDARD" },
  { id: "rack",          label: "Power rack",       sub: "WITH SAFETY ARMS" },
  { id: "bench_flat",    label: "Flat bench",       sub: "ADJUSTABLE PREFERRED" },
  { id: "bench_incline", label: "Incline bench",    sub: "30°-45°" },
  { id: "dumbbells",     label: "Dumbbells",        sub: "5-50 KG TYPICAL" },
  { id: "kettlebells",   label: "Kettlebells",      sub: "8-32 KG TYPICAL RANGE" },
  { id: "cables",        label: "Cable machine",    sub: "DUAL TOWER PREFERRED" },
  { id: "pullup_bar",    label: "Pull-up bar",      sub: "MULTI-GRIP" },
  { id: "rower",         label: "Rower",            sub: "C2 / WATERROWER" },
  { id: "treadmill",     label: "Treadmill",        sub: "INDOOR CARDIO" },
  { id: "bike",          label: "Stationary bike",  sub: "OR INDOOR TRAINER" },
  { id: "ghd",           label: "GHD",              sub: "GLUTE-HAM DEVELOPER" },
  { id: "leg_press",     label: "Leg press",        sub: "MACHINE" },
  { id: "lat_pulldown",  label: "Lat pulldown",     sub: "MACHINE" },
  { id: "bands",         label: "Resistance bands", sub: "ASSORTED LEVELS" },
  { id: "trx",           label: "Suspension trainer", sub: "TRX OR EQUIVALENT" },
  { id: "ab_wheel",      label: "Ab wheel",         sub: "CORE WORK" },
  { id: "foam_roller",   label: "Foam roller",      sub: "RECOVERY" },
  { id: "jump_rope",     label: "Jump rope",        sub: "CONDITIONING" },
  { id: "medicine_ball", label: "Medicine ball",    sub: "5-10 KG" },
];

const INTEGRATION_TILES = [
  { key: "smartwatch_sync",  label: "Smartwatch sync",     sub: "STEPS · HR · WORKOUTS" },
  { key: "hr_chest_strap",   label: "HR chest strap",      sub: "REAL-TIME ZONES" },
  { key: "running_watch",    label: "Running watch",       sub: "GPS · CADENCE · PACE" },
  { key: "activity_platform",label: "Activity platforms",  sub: "STRAVA / MFP / GARMIN-CONNECT" },
  { key: "scale_metrics",    label: "Scale & body metrics",sub: "WEIGHT · BODY-COMP" },
  { key: "cycling_computer", label: "Cycling computers",   sub: "POWER · CADENCE · ROUTES" },
];

function useProfile() {
  const [profile, setProfile] = useState(null);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const tokenRef = useRef("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await getSession();
      if (!session?.access_token) throw new Error("Sign in required.");
      tokenRef.current = session.access_token;
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setProfile(await res.json());
    } catch (err) {
      setError(err.message || "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  const patch = useCallback(async (body) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setProfile(await res.json());
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }, []);

  return { profile, error, loading, saving, load, patch };
}

function useDebouncedPatch(patch, ms = 500) {
  const timer = useRef(null);
  const next = useRef({});
  return useCallback((delta) => {
    next.current = { ...next.current, ...delta };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const payload = next.current;
      next.current = {};
      patch(payload);
    }, ms);
  }, [patch, ms]);
}

function PillRow({ label, options, value, onChange, disabled }) {
  return h("div", { className: "pf-pill-row" },
    h("div", { className: "pf-pill-row-label" }, label),
    h("div", { className: "pf-pill-row-pills" },
      options.map((opt) =>
        h("button", {
          key: opt.id,
          type: "button",
          className: `pf-pill${value === opt.id ? " is-active" : ""}`,
          disabled,
          onClick: () => onChange(opt.id),
        }, opt.label),
      ),
    ),
  );
}

function NumberField({ label, suffix, value, onChange, min, max, step, disabled }) {
  return h("label", { className: "pf-number-field" },
    h("span", { className: "pf-field-label" }, label),
    h("span", { className: "pf-number-field-input" },
      h("input", {
        type: "number",
        value: value ?? "",
        min, max, step,
        disabled,
        onChange: (e) => onChange(e.target.value ? Number(e.target.value) : null),
      }),
      suffix ? h("span", { className: "pf-number-suffix" }, suffix) : null,
    ),
  );
}

function GoalsTab({ profile, debouncedPatch, patch, saving }) {
  const macros = profile.macros || {};
  const overridden = Boolean(profile.macros_overridden_at);

  return h("div", { className: "pf-tab pf-goals" },
    h(PillRow, {
      label: "Training focus",
      options: GOAL_OPTIONS,
      value: profile.goal,
      onChange: (id) => patch({ goal: id }),
      disabled: saving,
    }),
    h("p", { className: "pf-hint" },
      h("span", { className: "pf-hint-key" }, "ADJUSTS · "),
      "rep ranges · weekly volume · rest periods · progression rules · recommended deload cadence"),
    h(PillRow, {
      label: "Experience",
      options: EXPERIENCE_OPTIONS,
      value: profile.experience_level,
      onChange: (id) => patch({ experience_level: id }),
      disabled: saving,
    }),
    h("div", { className: "pf-section-head" }, "Body"),
    h("div", { className: "pf-grid-3" },
      h(NumberField, { label: "Weight",        suffix: "kg", value: profile.body_weight_kg,   onChange: (v) => debouncedPatch({ body_weight_kg: v }),   min: 30,  max: 300, step: 0.1 }),
      h(NumberField, { label: "Target weight", suffix: "kg", value: profile.target_weight_kg, onChange: (v) => debouncedPatch({ target_weight_kg: v }), min: 30,  max: 300, step: 0.1 }),
      h(NumberField, { label: "Height",        suffix: "cm", value: profile.height_cm,        onChange: (v) => debouncedPatch({ height_cm: v }),        min: 100, max: 250, step: 0.5 }),
    ),
    h("div", { className: "pf-section-head" },
      "Nutrition targets",
      overridden ? h("button", {
        type: "button",
        className: "pf-link-btn",
        onClick: () => patch({ macros: null }),
      }, "Reset to default ✕") : null,
    ),
    h("div", { className: "pf-grid-4 pf-macro-pills" },
      ["kcal","protein_g","carbs_g","fat_g"].map((key) => {
        const lbl = key === "kcal" ? "kcal" : key.replace("_g","").toUpperCase();
        return h("label", { key, className: "pf-macro-pill" },
          h("span", null, lbl),
          h("input", {
            type: "number",
            value: macros[key] ?? "",
            min: 0, max: 9999,
            disabled: saving,
            onChange: (e) => {
              const next = { ...macros, [key]: Number(e.target.value) || 0 };
              debouncedPatch({ macros: next });
            },
          }),
        );
      }),
    ),
    h("p", { className: "pf-helper" },
      overridden
        ? `OVERRIDDEN ${profile.macros_overridden_at?.slice(0,10) ?? ""} · CLICK RESET TO RECOMPUTE FROM BODY WEIGHT`
        : "AUTO-COMPUTED FROM BODY WEIGHT × 1.8 G/KG · EDITS SYNC TO NUTRITION"),
  );
}

function EquipmentTab({ profile, patch, saving }) {
  const env = profile.training_env;
  const equipment = Array.isArray(profile.equipment) ? profile.equipment : [];
  const eqSet = new Set(equipment);

  return h("div", { className: "pf-tab pf-equipment" },
    h(PillRow, {
      label: "Where do you train?",
      options: TRAINING_ENV_OPTIONS,
      value: env,
      onChange: (id) => patch({ training_env: id }),
      disabled: saving,
    }),
    h("div", { className: "pf-section-head" }, "Available equipment"),
    h("div", { className: "pf-equipment-grid" },
      EQUIPMENT_OPTIONS.map((opt) => {
        const checked = eqSet.has(opt.id);
        return h("label", { key: opt.id, className: `pf-eq-row${checked ? " is-active" : ""}` },
          h("input", {
            type: "checkbox",
            checked,
            disabled: saving,
            onChange: (e) => {
              const next = e.target.checked
                ? [...eqSet, opt.id]
                : equipment.filter((x) => x !== opt.id);
              patch({ equipment: next });
            },
          }),
          h("span", { className: "pf-eq-label" }, opt.label),
          h("span", { className: "pf-eq-sub" }, opt.sub),
        );
      }),
    ),
  );
}

function InjuriesTab({ profile, debouncedPatch }) {
  return h("div", { className: "pf-tab pf-injuries" },
    h("div", { className: "pf-section-head" }, "Active injuries / limitations"),
    h("p", { className: "pf-helper" },
      "FREE-TEXT FOR NOW · STRUCTURED INJURY ROWS WITH CITATION-BACKED ALTERNATIVES SHIP IN A FOLLOW-UP."),
    h("textarea", {
      className: "pf-textarea",
      rows: 6,
      defaultValue: profile.injuries_limitations || "",
      placeholder: "e.g. Lower-back strain (avoid conventional deadlift; trap-bar OK) · Right shoulder impingement (avoid behind-the-neck press)",
      onChange: (e) => debouncedPatch({ injuries_limitations: e.target.value }),
    }),
  );
}

function IntegrationsTab() {
  const [joined, setJoined] = useState(new Set());
  const [toast, setToast]   = useState("");

  async function joinWaitlist(key) {
    if (joined.has(key)) return;
    try {
      const session = await getSession();
      const res = await fetch("/api/integrations/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ integration_key: key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setJoined(new Set([...joined, key]));
      setToast("ADDED · WE'LL EMAIL YOU");
      setTimeout(() => setToast(""), 2000);
    } catch {
      setToast("ADD FAILED");
      setTimeout(() => setToast(""), 2000);
    }
  }

  return h("div", { className: "pf-tab pf-integrations" },
    h("p", { className: "pf-helper" }, "ALL INTEGRATIONS ARE COMING SOON · JOIN WAITLISTS BELOW TO BE EMAILED FIRST"),
    h("div", { className: "pf-integration-grid" },
      INTEGRATION_TILES.map((tile) =>
        h("div", { key: tile.key, className: "pf-int-tile" },
          h("div", { className: "pf-int-label" }, tile.label),
          h("div", { className: "pf-int-sub" }, tile.sub),
          h("button", {
            type: "button",
            className: `pf-int-cta${joined.has(tile.key) ? " is-joined" : ""}`,
            onClick: () => joinWaitlist(tile.key),
          }, joined.has(tile.key) ? "✓ JOINED" : "Join waitlist →"),
        ),
      ),
    ),
    toast ? h("div", { className: "pf-toast", role: "status" }, toast) : null,
  );
}

function AppearanceTab() {
  // Initialize from DOM (data-theme attr set by the pre-paint boot script)
  // rather than localStorage so the visible UI matches what's rendered even
  // if another tab in the same browser just toggled the theme.
  const [theme, setTheme] = useState(() => {
    const attr = typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme")
      : null;
    if (attr === "mint" || attr === "paper") return attr;
    const saved = readSavedTheme();
    return VALID_THEMES.includes(saved) ? saved : "paper";
  });

  const pick = (next) => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
  };

  const OPTIONS = [
    { id: "paper", label: "Light", sub: "Paper · Royal", swatch: "paper" },
    { id: "mint",  label: "Dark",  sub: "Graphite · Jade", swatch: "mint" },
  ];

  return h("div", { className: "pf-tab pf-appearance" },
    h("div", { className: "pf-section-head" }, "Theme"),
    h("div", { className: "pf-appearance-options", role: "radiogroup", "aria-label": "Theme" },
      OPTIONS.map((opt) =>
        h("button", {
          key: opt.id,
          type: "button",
          role: "radio",
          "aria-checked": theme === opt.id,
          className: `pf-appearance-option${theme === opt.id ? " is-active" : ""}`,
          onClick: () => pick(opt.id),
        },
          h("span", { className: `pf-appearance-swatch pf-appearance-swatch-${opt.swatch}`, "aria-hidden": true }),
          h("span", { className: "pf-appearance-meta" },
            h("span", { className: "pf-appearance-label" }, opt.label),
            h("span", { className: "pf-appearance-sub" }, opt.sub),
          ),
          theme === opt.id
            ? h("span", { className: "pf-appearance-check", "aria-hidden": true }, "✓")
            : null,
        ),
      ),
    ),
    h("p", { className: "pf-appearance-note" },
      "Your choice is saved to this browser. It applies across the whole app — chat, training, nutrition, progress, and this settings page.",
    ),
  );
}

function BillingTab() {
  return h("div", { className: "pf-tab pf-billing" },
    h("div", { className: "pf-billing-hero" },
      h("div", { className: "pf-billing-hero-label" }, "Current plan"),
      h("div", { className: "pf-billing-hero-name" }, "Private beta"),
      h("div", { className: "pf-billing-hero-sub" }, "BILLING PAUSED · ALL FEATURES UNLOCKED"),
    ),
    h("div", { className: "pf-billing-usage" },
      ["Chats this month","Plans saved","Sessions logged"].map((label) =>
        h("div", { key: label, className: "pf-billing-usage-tile" },
          h("div", { className: "pf-billing-usage-label" }, label),
          h("div", { className: "pf-billing-usage-value" }, "—"),
          h("div", { className: "pf-billing-usage-sub" }, "UNLIMITED DURING BETA"),
        ),
      ),
    ),
    h("div", { className: "pf-billing-actions" },
      h("button", { type: "button", className: "pf-secondary", onClick: () => alert("Email change flow ships in a follow-up.") }, "Change email"),
      h("button", { type: "button", className: "pf-secondary", onClick: () => alert("Password change flow ships in a follow-up.") }, "Change password"),
      h("button", { type: "button", className: "pf-secondary", onClick: () => alert("Export flow ships in a follow-up.") }, "Request export"),
    ),
    h("div", { className: "pf-danger-zone" },
      h("div", { className: "pf-danger-zone-head" }, "Danger zone"),
      h("p", { className: "pf-danger-zone-copy" }, "Deleting your account removes all chats, plans, sessions, and journal entries. Re-registration within 30 days restores everything."),
      h("button", {
        type: "button",
        className: "pf-danger-btn",
        onClick: () => alert("Delete-account flow ships in a follow-up. For now, contact info@emersus.ai."),
      }, "Delete account"),
    ),
  );
}

function Header({ profile, saving }) {
  const initials = (profile.full_name || profile.email || "?")
    .split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0,2).join("").toUpperCase();
  const memberSince = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
  return h("header", { className: "pf-header" },
    h("div", { className: "pf-header-avatar" }, initials),
    h("div", { className: "pf-header-meta" },
      h("div", { className: "pf-header-name" }, profile.full_name || profile.email || "Your profile"),
      h("div", { className: "pf-header-sub" },
        profile.email ? h("span", null, profile.email) : null,
        h("span", { className: "pf-pill-mini pf-pill-beta" }, "PRIVATE BETA"),
        h("span", { className: "pf-pill-mini" }, `MEMBER SINCE ${memberSince.toUpperCase()}`),
      ),
    ),
    saving
      ? h("span", { className: "pf-saving" }, "● AUTO-SAVING")
      : h("span", { className: "pf-saving pf-saving-idle" }, "● SAVED"),
  );
}

function ProfileSkeleton() {
  return h("div", { className: "pf-shell", "aria-busy": "true", "aria-label": "Loading profile" },
    // Header: avatar + name + meta pills
    h("header", { className: "pf-header" },
      h("div", { className: "skel skel-circle lg" }),
      h("div", { className: "pf-header-meta skel-stack" },
        h("div", { className: "skel skel-line xl w-40" }),
        h("div", { className: "skel-row gap-6" },
          h("div", { className: "skel skel-pill sm" }),
          h("div", { className: "skel skel-pill" }),
          h("div", { className: "skel skel-pill lg" }),
        ),
      ),
    ),
    // Tab bar
    h("nav", { className: "pf-tabs" },
      Array.from({ length: 6 }).map((_, i) =>
        h("span", { key: i, className: "skel skel-pill lg", style: { marginRight: 12 } }),
      ),
    ),
    // Three form sections: label + 2-3 input rows each
    h("div", { className: "pf-tab" },
      Array.from({ length: 3 }).map((_, s) =>
        h("div", { key: s, className: "pf-section skel-stack gap-14", style: { marginBottom: 24 } },
          h("div", { className: "skel skel-line lg w-30" }),
          h("div", { className: "skel skel-block h-60" }),
          h("div", { className: "skel skel-block h-60" }),
        ),
      ),
    ),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Memory tab (Phase 4a) — lives between Injuries and Appearance. Lists
// confirmed memories grouped by tier, supports per-row CRUD, export JSON,
// and delete-all with password re-auth. See spec §7.3 + §9.4.
// ──────────────────────────────────────────────────────────────────────────

const MEMORY_TIER_ORDER = [
  { tier: "A", label: "Medical" },
  { tier: "D", label: "Active now" },
  { tier: "B", label: "Training" },
  { tier: "C", label: "Milestones" },
  { tier: "E", label: "Preferences" },
  { tier: "X", label: "Custom" },
];

function formatMemoryCategory(cat) {
  return String(cat || "").replace(/_/g, " ").toLowerCase();
}

function MemoryTab() {
  const [rows, setRows] = useState(null);
  const [threadIds, setThreadIds] = useState(null);
  const [autosave, setAutosave] = useState(null);
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const reload = useCallback(async () => {
    setError("");
    try {
      const sb = await getSupabase();
      const [memResp, threadResp, prefResp] = await Promise.all([
        sb.from("user_memories")
          .select("id, category, tier, fact, metadata, status, supersedes_id, source, confidence, created_at, confirmed_at, resolved_at, last_mentioned_at, expires_at, source_thread_id")
          .order("tier", { ascending: true })
          .order("created_at", { ascending: false }),
        sb.from("chat_threads").select("id"),
        sb.auth.getUser().then(({ data }) => {
          const uid = data?.user?.id;
          if (!uid) return { data: [] };
          return sb.from("profiles").select("preferences").eq("id", uid).maybeSingle();
        }),
      ]);
      if (memResp.error) throw memResp.error;
      setRows(memResp.data || []);
      setThreadIds(new Set((threadResp.data || []).map((t) => t.id)));
      const prefs = prefResp?.data?.preferences;
      if (prefs && typeof prefs === "object" && "memory_autosave" in prefs) {
        setAutosave(!!prefs.memory_autosave);
      } else {
        setAutosave(true); // default opt-in
      }
    } catch (err) {
      setError(err?.message || "Could not load memory.");
    }
  }, []);

  const toggleAutosave = useCallback(async (next) => {
    setAutosave(next);
    try {
      const sb = await getSupabase();
      const { data: userData } = await sb.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Not signed in.");
      const { data: current } = await sb.from("profiles").select("preferences").eq("id", uid).maybeSingle();
      const nextPrefs = { ...(current?.preferences || {}), memory_autosave: next };
      const { error: err } = await sb.from("profiles")
        .update({ preferences: nextPrefs, updated_at: new Date().toISOString() })
        .eq("id", uid);
      if (err) throw err;
    } catch (err) {
      // Revert optimistic toggle on failure.
      setAutosave(!next);
      setError(err?.message || "Could not save autosave preference.");
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (rows === null && !error) {
    return h("div", { className: "pf-tab pf-memory" },
      h("h2", { className: "pf-section-title" }, "Memory"),
      h("p", { className: "pf-helper" }, "Loading…"));
  }
  if (error) {
    return h("div", { className: "pf-tab pf-memory" },
      h("h2", { className: "pf-section-title" }, "Memory"),
      h("p", { className: "pf-error" }, error));
  }

  const pending = rows.filter((r) => r.status === "pending");
  const live = rows.filter((r) => r.status === "confirmed");
  const archived = rows.filter((r) => r.status === "archived" || r.status === "resolved");
  const grouped = MEMORY_TIER_ORDER
    .map((g) => ({ ...g, rows: live.filter((r) => r.tier === g.tier) }))
    .filter((g) => g.rows.length > 0);

  const isOrphan = (row) =>
    row.source_thread_id && threadIds && !threadIds.has(row.source_thread_id);

  let lastSaved = null;
  if (live.length) {
    const latestTs = live.reduce((max, r) => {
      const ts = new Date(r.confirmed_at || r.created_at).getTime();
      return ts > max ? ts : max;
    }, 0);
    if (latestTs) lastSaved = new Date(latestTs).toISOString().slice(0, 10);
  }

  return h("div", { className: "pf-tab pf-memory" },
    h("header", { className: "pf-memory-head" },
      h("div", { className: "pf-memory-head-row" },
        h("h2", { className: "pf-section-title" }, "Memory"),
        h("label", { className: "pf-memory-autosave" },
          h("input", {
            type: "checkbox",
            checked: autosave === true,
            onChange: (e) => toggleAutosave(e.target.checked),
          }),
          h("span", null, "Auto-save facts from chat"),
        ),
      ),
      h("p", { className: "pf-memory-summary" },
        `${live.length} saved${pending.length ? ` · ${pending.length} pending review` : ""}${lastSaved ? ` · last saved ${lastSaved}` : ""}`),
    ),

    pending.length > 0
      ? h("section", { className: "pf-memory-pending" },
          h("h3", { className: "pf-memory-group-title" }, `PENDING REVIEW (${pending.length})`),
          h("ul", { className: "pf-memory-list" },
            pending.map((r) => h(MemoryRow, { key: r.id, row: r, onMutate: reload, orphan: isOrphan(r) })),
          ),
        )
      : null,

    grouped.length === 0 && pending.length === 0
      ? h("p", { className: "pf-helper" },
          "Nothing saved yet. Ask me to remember something across chats and it'll appear here.")
      : grouped.map((g) =>
          h("section", { key: g.tier, className: "pf-memory-group" },
            h("h3", { className: "pf-memory-group-title" }, `${g.label.toUpperCase()} (${g.rows.length})`),
            h("ul", { className: "pf-memory-list" },
              g.rows.map((r) => h(MemoryRow, { key: r.id, row: r, onMutate: reload, orphan: isOrphan(r) })),
            ),
          )),

    archived.length > 0
      ? h("section", { className: "pf-memory-archive" },
          h("button", {
            type: "button",
            className: "pf-memory-archive-toggle",
            onClick: () => setShowArchive((v) => !v),
          }, `${showArchive ? "▾" : "▸"} Archive (${archived.length})`),
          showArchive
            ? h("ul", { className: "pf-memory-list pf-memory-list-muted" },
                archived.map((r) => h(MemoryRow, { key: r.id, row: r, onMutate: reload, orphan: isOrphan(r) })),
              )
            : null,
        )
      : null,

    h(MemoryDangerZone, { onMutate: reload }),
  );
}

function MemoryRow({ row, onMutate, orphan = false }) {
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

  const patchRow = useCallback(async (body) => {
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
    const preview = String(row.fact).slice(0, 60) + (row.fact.length > 60 ? "…" : "");
    if (!window.confirm(`Delete "${preview}" permanently?`)) return;
    setBusy(true); setError("");
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.from("user_memories").delete().eq("id", row.id);
      if (err) throw err;
      await onMutate();
    } catch (err) {
      setError(err?.message || "Delete failed.");
    } finally {
      setBusy(false); setMenuOpen(false);
    }
  }, [row.id, row.fact, onMutate]);

  const saveEdit = useCallback(async () => {
    const text = String(draftFact || "").trim();
    if (text.length < 1 || text.length > 500) {
      setError("Fact must be 1–500 characters."); return;
    }
    await patchRow({ fact: text });
    setEditing(false);
  }, [draftFact, patchRow]);

  const isLive = row.status === "confirmed";
  const isPending = row.status === "pending";
  const categoryLabel = formatMemoryCategory(row.category);

  const confirmPending = () =>
    patchRow({ status: "confirmed", confirmed_at: new Date().toISOString() });
  const rejectPending = () =>
    patchRow({ status: "rejected", resolved_at: new Date().toISOString() });

  return h("li", {
      className: `pf-memory-row${isLive ? "" : " is-muted"}${isPending ? " is-pending" : ""}`,
      "data-status": row.status,
    },
    h("div", { className: "pf-memory-row-head" },
      h("span", { className: "pf-memory-category" }, categoryLabel),
      orphan
        ? h("span", { className: "pf-memory-orphan-badge", title: "The chat that produced this memory was deleted." },
            "FROM DELETED THREAD")
        : null,
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
              h("button", {
                key: "save", type: "button",
                className: "pf-memory-btn-primary",
                disabled: busy, onClick: saveEdit,
              }, busy ? "…" : "Save"),
              h("button", {
                key: "cancel", type: "button",
                className: "pf-memory-btn-secondary",
                disabled: busy,
                onClick: () => { setEditing(false); setDraftFact(row.fact); setError(""); },
              }, "Cancel"),
            ]
          : isPending
            ? [
                h("button", {
                  key: "keep", type: "button",
                  className: "pf-memory-btn-primary",
                  disabled: busy, onClick: confirmPending,
                }, "✓ Keep"),
                h("button", {
                  key: "edit", type: "button",
                  className: "pf-memory-btn-secondary",
                  disabled: busy, onClick: () => setEditing(true),
                }, "✎ Edit"),
                h("button", {
                  key: "nope", type: "button",
                  className: "pf-memory-btn-secondary",
                  disabled: busy, onClick: rejectPending,
                }, "✗ Reject"),
              ]
            : h("div", {
                className: "pf-memory-menu-wrap",
                onMouseDown: (e) => e.stopPropagation(),
              },
              h("button", {
                type: "button",
                className: "pf-memory-menu-btn",
                "aria-label": "More actions",
                disabled: busy,
                onClick: () => setMenuOpen((v) => !v),
              }, "⋯"),
              menuOpen
                ? h("ul", { className: "pf-memory-menu" },
                    isLive
                      ? h("li", null, h("button", {
                          type: "button",
                          onClick: () => { setMenuOpen(false); setEditing(true); },
                        }, "Edit fact"))
                      : null,
                    isLive
                      ? h("li", null, h("button", {
                          type: "button",
                          onClick: () => patchRow({ status: "resolved", resolved_at: new Date().toISOString() }),
                        }, "Mark resolved"))
                      : null,
                    isLive
                      ? h("li", null, h("button", {
                          type: "button",
                          onClick: () => patchRow({ status: "archived" }),
                        }, "Archive"))
                      : null,
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

function MemoryDangerZone({ onMutate }) {
  const [showDelete, setShowDelete] = useState(false);

  const exportJson = useCallback(async () => {
    try {
      const sb = await getSupabase();
      const { data, error: err } = await sb.from("user_memories").select("*");
      if (err) throw err;
      const payload = { memories: data || [], exported_at: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
      h("button", {
        type: "button",
        className: "pf-memory-btn-secondary",
        onClick: exportJson,
      }, "Export my memory as JSON"),
      h("button", {
        type: "button",
        className: "pf-memory-btn-danger",
        onClick: () => setShowDelete(true),
      }, "Delete all memory…"),
    ),
    showDelete
      ? h(MemoryDeleteAllModal, {
          onClose: () => setShowDelete(false),
          onDone: () => { setShowDelete(false); void onMutate(); },
        })
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
      const userRes = await sb.auth.getUser();
      if (userRes.error || !userRes.data?.user?.email) {
        throw new Error("Could not identify current user.");
      }
      const email = userRes.data.user.email;
      const auth = await sb.auth.signInWithPassword({ email, password });
      if (auth.error) throw new Error("Password incorrect.");
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
        h("label", { className: "pf-memory-modal-label" }, "Type ", h("code", null, "delete"), " to confirm:"),
        h("input", {
          className: "pf-memory-input",
          type: "text",
          value: typed,
          onChange: (e) => setTyped(e.target.value),
          placeholder: "delete",
        }),
        h("label", { className: "pf-memory-modal-label" }, "Re-enter your password:"),
        h("input", {
          className: "pf-memory-input",
          type: "password",
          value: password,
          onChange: (e) => setPassword(e.target.value),
          autoComplete: "current-password",
        }),
        error ? h("p", { className: "pf-error" }, error) : null,
      ),
      h("footer", { className: "pf-modal-foot" },
        h("button", {
          type: "button",
          className: "pf-memory-btn-secondary",
          disabled: busy, onClick: onClose,
        }, "Cancel"),
        h("button", {
          type: "button",
          className: "pf-memory-btn-danger",
          disabled: !ready || busy,
          onClick: confirm,
        }, busy ? "Deleting…" : "Delete everything"),
      ),
    ),
  );
}

function ProfileApp() {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    return TABS.find((x) => x.id === t) ? t : "goals";
  });
  const { profile, error, loading, saving, load, patch } = useProfile();
  const debouncedPatch = useDebouncedPatch(patch, 500);

  useEffect(() => {
    requireAuth().then((session) => {
      if (session) load();
    });
  }, [load]);

  function setTabAndUrl(next) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "goals") params.delete("tab"); else params.set("tab", next);
    const qs = params.toString();
    window.history.pushState({}, "", qs ? `?${qs}` : window.location.pathname);
  }

  if (loading) {
    return h(ProfileSkeleton);
  }
  if (error || !profile) {
    return h("div", { className: "pf-shell pf-error" },
      h("p", null, error || "No profile."),
      h("button", { type: "button", className: "pf-primary", onClick: load }, "Retry"),
    );
  }

  return h("div", { className: "pf-shell" },
    h(Header, { profile, saving }),
    h("nav", { className: "pf-tabs", role: "tablist" },
      TABS.map((t) =>
        h("button", {
          key: t.id,
          type: "button",
          role: "tab",
          "aria-selected": tab === t.id,
          className: `pf-tab-btn${tab === t.id ? " is-active" : ""}${t.soon ? " is-soon" : ""}`,
          onClick: () => setTabAndUrl(t.id),
        }, t.label,
          t.soon ? h("span", { className: "pf-soon-badge" }, "SOON") : null,
        ),
      ),
    ),
    tab === "goals"        ? h(GoalsTab,        { profile, patch, debouncedPatch, saving }) : null,
    tab === "equipment"    ? h(EquipmentTab,    { profile, patch, saving }) : null,
    tab === "injuries"     ? h(InjuriesTab,     { profile, debouncedPatch }) : null,
    tab === "integrations" ? h(IntegrationsTab, null) : null,
    tab === "memory"       ? h(MemoryTab,       null) : null,
    tab === "appearance"   ? h(AppearanceTab,   null) : null,
    tab === "billing"      ? h(BillingTab,      null) : null,
  );
}

const root = document.getElementById("profile-v2-root");
if (root) createRoot(root).render(h(ProfileApp));
