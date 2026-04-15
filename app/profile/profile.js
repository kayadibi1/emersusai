// app/profile/profile.js — Phase 6 Profile v2 page entry.
//
// Single React app rendering 5 tabs (Goals · Equipment · Injuries · Integrations · Billing).
// Reads / writes via /api/profile and /api/integrations/waitlist.
//
// Lightweight inline component (no separate per-tab modules) — keeps the
// bundle small and the code easy to scan during the redesign sprint.

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { getSession, requireAuth } from "/shared/supabase.js";

const h = React.createElement;

const TABS = [
  { id: "goals",        label: "Goals" },
  { id: "equipment",    label: "Equipment" },
  { id: "injuries",     label: "Injuries" },
  { id: "integrations", label: "Integrations", soon: true },
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
    return h("div", { className: "pf-shell pf-loading" }, "Loading profile…");
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
    tab === "billing"      ? h(BillingTab,      null) : null,
  );
}

const root = document.getElementById("profile-v2-root");
if (root) createRoot(root).render(h(ProfileApp));
