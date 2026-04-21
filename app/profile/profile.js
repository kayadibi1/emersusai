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
        onChange: (e) => {
          const raw = e.target.value;
          if (raw === "") { onChange(null); return; }
          let n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (n < 0) return;
          if (typeof min === "number" && n < min) n = min;
          if (typeof max === "number" && n > max) n = max;
          onChange(n);
        },
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

  useEffect(() => {
    const onThemeChange = (e) => {
      const t = e?.detail?.theme;
      if (t && VALID_THEMES.includes(t)) setTheme(t);
    };
    const onStorage = (e) => {
      if (e.key !== "emersus-theme") return;
      const t = e.newValue;
      if (t && VALID_THEMES.includes(t)) setTheme(t);
    };
    window.addEventListener("emersus:themechange", onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("emersus:themechange", onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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

function formatResetCountdown(resetAtIso) {
  if (!resetAtIso) return "";
  const ms = Math.max(new Date(resetAtIso).getTime() - Date.now(), 0);
  const hrs = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  if (hrs === 0) return `${min}m`;
  return `${hrs}h ${min}m`;
}

function BillingTab({ reloadKey = 0 }) {
  const [usage, setUsage] = useState(null);

  async function openPortal() {
    try {
      const session = await getSession();
      const token = session?.access_token;
      if (!token) { window.location.href = "/auth/"; return; }
      const res = await fetch("/api/billing/polar/portal?json=1", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Portal unavailable");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      console.error(err);
      alert("Could not open the billing portal. Try again, or email info@emersus.ai.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch("/api/emersus/usage", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      setUsage(await res.json());
    })();
    return () => {
      cancelled = true;
    };
    // reloadKey change forces a re-fetch (e.g., after ?upgraded=1 return).
  }, [reloadKey]);

  const isPro = usage?.tier === "pro";
  const tierLabel = isPro ? "Pro" : "Free";
  const fmtDate = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : null;
  };
  const cancelsAtLabel = isPro ? fmtDate(usage?.cancels_at) : null;
  const renewsAtLabel  = isPro ? fmtDate(usage?.renews_at) : null;
  const isPastDue = isPro && usage?.subscription_status === "past_due";
  const heroSub = cancelsAtLabel
    ? `CANCELS ON ${cancelsAtLabel.toUpperCase()} · STILL ACTIVE UNTIL THEN`
    : isPastDue
    ? "PAYMENT FAILED · POLAR IS RETRYING YOUR CARD"
    : renewsAtLabel
    ? `RENEWS ON ${renewsAtLabel.toUpperCase()} · 100 MSG/DAY · PREPRINTS`
    : isPro
    ? "100 MESSAGES/DAY · PREPRINT ACCESS · UNLIMITED PLANS"
    : "10 MESSAGES/DAY · PEER-REVIEWED CITATIONS";

  const usedLabel = usage ? `${usage.used} / ${usage.limit}` : "—";
  const resetLabel = usage?.reset_at
    ? `RESETS IN ${formatResetCountdown(usage.reset_at).toUpperCase()} · 00:00 UTC`
    : "LOADING…";
  const ringPct = usage ? Math.min(usage.used / usage.limit, 1) : 0;

  return h("div", { id: "usage", className: "pf-tab pf-billing" },
    h("div", { className: "pf-billing-hero" },
      h("div", { className: "pf-billing-hero-label" }, "Current plan"),
      h("div", { className: "pf-billing-hero-name" }, tierLabel),
      h("div", { className: "pf-billing-hero-sub" }, heroSub),
    ),
    h("div", { className: "pf-billing-usage" },
      h("div", { className: "pf-billing-usage-tile" },
        h("div", { className: "pf-billing-usage-label" }, "Messages today"),
        h("div", { className: "pf-billing-usage-value" }, usedLabel),
        h("div", { className: "pf-billing-usage-sub" }, resetLabel),
      ),
      h("div", { className: "pf-billing-usage-tile" },
        h("div", { className: "pf-billing-usage-label" }, "Today's usage"),
        h("div", {
          style: {
            padding: "6px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          },
        },
          h("svg", { width: 60, height: 60, viewBox: "0 0 60 60" },
            h("circle", {
              cx: 30, cy: 30, r: 26, fill: "none",
              stroke: "var(--line)", strokeWidth: 4,
            }),
            h("circle", {
              cx: 30, cy: 30, r: 26, fill: "none",
              stroke: ringPct >= 1 ? "var(--danger)"
                    : ringPct >= 0.8 ? "var(--warning)"
                    : "var(--accent)",
              strokeWidth: 4,
              strokeDasharray: 2 * Math.PI * 26,
              strokeDashoffset: 2 * Math.PI * 26 * (1 - ringPct),
              strokeLinecap: "round",
              transform: "rotate(-90 30 30)",
            }),
          ),
        ),
        h("div", { className: "pf-billing-usage-sub" },
          usage
            ? `${Math.round(ringPct * 100)}% OF DAILY LIMIT`
            : "LOADING…"),
      ),
      h("div", { className: "pf-billing-usage-tile" },
        h("div", { className: "pf-billing-usage-label" },
          isPro ? "Manage subscription" : "Upgrade"),
        isPro
          ? h("button", {
              type: "button",
              className: "pf-secondary",
              style: {
                display: "inline-block",
                marginTop: 6,
                cursor: "pointer",
              },
              onClick: async (e) => {
                const btn = e.currentTarget;
                const orig = btn.textContent;
                btn.textContent = "Opening…";
                btn.disabled = true;
                try {
                  await openPortal();
                } finally {
                  btn.textContent = orig;
                  btn.disabled = false;
                }
              },
            }, "Manage billing →")
          : h("a", {
              href: "/pricing",
              className: "pf-secondary",
              style: {
                display: "inline-block",
                marginTop: 6,
                textDecoration: "none",
              },
            }, "Upgrade to Pro →"),
        isPro
          ? h("div", { className: "pf-billing-usage-sub pf-billing-portal-links" },
              h("button", { type: "button", className: "pf-billing-portal-link", onClick: openPortal }, "CANCEL"),
              " · ",
              h("button", { type: "button", className: "pf-billing-portal-link", onClick: openPortal }, "UPDATE CARD"),
              " · ",
              h("button", { type: "button", className: "pf-billing-portal-link", onClick: openPortal }, "INVOICES"),
            )
          : h("div", { className: "pf-billing-usage-sub" }, "100 MSG/DAY · PREPRINTS · $9"),
      ),
    ),
    h("div", { className: "pf-billing-actions" },
      h("button", { type: "button", className: "pf-secondary", onClick: () => alert("Export flow ships in a follow-up.") }, "Request export"),
    ),
    h("p", { className: "pf-account-contact" },
      "To change your email or password, email ",
      h("a", { href: "mailto:info@emersus.ai" }, "info@emersus.ai"),
      ".",
    ),
    h("div", { className: "pf-danger-zone" },
      h("div", { className: "pf-danger-zone-head" }, "Danger zone"),
      h("p", { className: "pf-danger-zone-copy" }, "Deleting your account removes all chats, plans, sessions, and journal entries. Re-registration within 30 days restores everything."),
      h("p", { className: "pf-danger-zone-copy" },
        "To request account deletion, email ",
        h("a", { href: "mailto:info@emersus.ai" }, "info@emersus.ai"),
        ".",
      ),
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

function ProfileApp() {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    // If we returned from Polar checkout, jump straight to Billing.
    if (params.get("upgraded") === "1") return "billing";
    const t = params.get("tab");
    return TABS.find((x) => x.id === t) ? t : "goals";
  });
  const { profile, error, loading, saving, load, patch } = useProfile();
  const debouncedPatch = useDebouncedPatch(patch, 500);
  const [billingReloadKey, setBillingReloadKey] = useState(0);
  const [upgradeToast, setUpgradeToast] = useState(null); // 'processing' | 'active' | null

  useEffect(() => {
    requireAuth().then((session) => {
      if (session) load();
    });
  }, [load]);

  // ?upgraded=1 return flow: toast immediately, poll usage for up to 15s
  // waiting for the webhook to flip tier=pro, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") !== "1") return undefined;
    setUpgradeToast("processing");
    let attempts = 0;
    const maxAttempts = 8; // ~15s total at 2s intervals
    const tick = async () => {
      attempts += 1;
      setBillingReloadKey((k) => k + 1);
      try {
        const session = await getSession();
        const token = session?.access_token;
        if (token) {
          const res = await fetch("/api/emersus/usage", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.tier === "pro") {
              setUpgradeToast("active");
              return true;
            }
          }
        }
      } catch (_) { /* retry on next tick */ }
      return false;
    };
    const interval = setInterval(async () => {
      const done = await tick();
      if (done || attempts >= maxAttempts) {
        clearInterval(interval);
        // Clean up the URL so a refresh doesn't re-trigger this flow.
        const p = new URLSearchParams(window.location.search);
        p.delete("upgraded");
        const qs = p.toString();
        window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname);
        // Auto-dismiss the toast after 6s once we stop polling.
        setTimeout(() => setUpgradeToast(null), 6000);
      }
    }, 2000);
    // Fire the first tick immediately rather than waiting 2s.
    tick();
    return () => clearInterval(interval);
  }, []);

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
    tab === "integrations" ? h(IntegrationsTab, null) : null,
    tab === "appearance"   ? h(AppearanceTab,   null) : null,
    tab === "billing"      ? h(BillingTab,      { reloadKey: billingReloadKey }) : null,
    upgradeToast ? h(UpgradeToast, { status: upgradeToast, onDismiss: () => setUpgradeToast(null) }) : null,
  );
}

function UpgradeToast({ status, onDismiss }) {
  const isActive = status === "active";
  return h("div", {
    style: {
      position: "fixed",
      bottom: 24,
      right: 24,
      background: isActive ? "var(--accent)" : "var(--surface)",
      color: isActive ? "var(--accent-text)" : "var(--ink)",
      border: isActive ? "none" : "1px solid var(--accent-line)",
      borderRadius: 12,
      padding: "14px 18px",
      minWidth: 280,
      maxWidth: 380,
      boxShadow: "0 12px 32px -8px rgba(0,0,0,0.3)",
      zIndex: 50,
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
    },
  },
    h("div", { style: { fontWeight: 600, fontSize: 14, marginBottom: 4 } },
      isActive ? "Welcome to Pro 🎉" : "Finalizing your upgrade…"),
    h("div", { style: { fontSize: 13, opacity: 0.85, lineHeight: 1.4 } },
      isActive
        ? "100 messages/day and preprint access are live on your account."
        : "Your payment was successful. Your Pro access is being activated (usually a few seconds)."),
    h("button", {
      type: "button",
      onClick: onDismiss,
      "aria-label": "Dismiss",
      style: {
        position: "absolute",
        top: 8, right: 10,
        background: "transparent",
        border: "none",
        color: "inherit",
        opacity: 0.6,
        fontSize: 18,
        cursor: "pointer",
        padding: "2px 6px",
        lineHeight: 1,
      },
    }, "×"),
  );
}

const root = document.getElementById("profile-v2-root");
if (root) createRoot(root).render(h(ProfileApp));
