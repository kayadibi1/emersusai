// app/nutrition/nutrition.js — Phase 4 Nutrition v2 SPA entry.
//
// Top tabs (Today / Plans / Log / Recipes [SOON] / Allergens [SOON]).
// Today tab is the showcase: time-aware fuel gauge + water/supps strip
// + meals list + bottom Quick-log dropdown.

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { requireAuth } from "/shared/supabase.js";
import { FuelGauge } from "/shared/nutrition/fuel-gauge.js";
import { localDateStr } from "/shared/date-utils.js";

const h = React.createElement;

// Simple class-based boundary — functional equivalents don't exist yet in
// React 18. Any thrown render error in a child falls back to a plain
// retry screen instead of blanking the page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("nutrition boundary:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return h("div", {
      className: "nu-shell",
      role: "alert",
      style: { padding: "60px 24px", textAlign: "center" },
    },
      h("p", { style: { fontSize: 16, color: "var(--ink)", margin: "0 0 14px" } },
        "Something went wrong loading this view."),
      h("button", {
        type: "button",
        className: "nu-primary",
        onClick: () => window.location.reload(),
      }, "Reload"),
    );
  }
}

// SOON-tabbed entries are hidden from the tab bar until their feature ships
// (Miller/Hick — don't spend attention on unshipped surface). Re-add when
// the backing endpoints and panels are ready.
const TABS = [
  { id: "today",     label: "Today" },
  { id: "plans",     label: "Plans" },
  { id: "log",       label: "Log" },
].filter(Boolean);

const QUICK_LOG_ITEMS = [
  { id: "water_250",  label: "Water +250ml", hint: "+ 250 ML" },
  { id: "water_500",  label: "Water +500ml", hint: "+ 500 ML" },
  { id: "supplement", label: "Supplement",   hint: "QUICK" },
];

const MEAL_SLOT_LABELS = {
  breakfast: "Breakfast", mid_morning: "Mid morning", lunch: "Lunch",
  afternoon: "Afternoon", dinner: "Dinner", evening: "Evening",
  pre_workout: "Pre-workout", post_workout: "Post-workout",
  supplements_am: "Supplements AM", supplements_pm: "Supplements PM",
};
const MEAL_SLOTS = Object.keys(MEAL_SLOT_LABELS);
const MEAL_SLOT_GROUPS = [
  { label: "Meals", slots: ["breakfast", "lunch", "dinner"] },
  { label: "Snacks", slots: ["mid_morning", "afternoon", "evening"] },
  { label: "Training", slots: ["pre_workout", "post_workout"] },
  { label: "Supplements", slots: ["supplements_am", "supplements_pm"] },
];

// Intentionally browser-local: this only seeds the default slot in the
// log-food UI and never touches the server, so there's no TZ contract
// to worry about. Wall-clock is what the user expects here.
function guessMealSlot() {
  const hour = new Date().getHours();
  const min = new Date().getMinutes();
  const t = hour + min / 60;
  if (t < 10) return "breakfast";
  if (t < 11.5) return "mid_morning";
  if (t < 14) return "lunch";
  if (t < 16.5) return "afternoon";
  if (t < 20) return "dinner";
  return "evening";
}

function smartDefaultAmount(food) {
  if (food.common_unit && food.common_unit_grams) return food.common_unit_grams;
  return food.base_amount || (food.base_unit === "serving" ? 1 : 100);
}

function smartDefaultUnit(food) {
  return food.base_unit === "serving" ? "serving" : "g";
}

function todayIso() { return localDateStr(); }

// Full-page skeleton (shown before session resolves).
function NutritionSkeleton() {
  return h("div", { className: "nu-shell", "aria-busy": "true", "aria-label": "Loading nutrition" },
    h("nav", { className: "nu-tabs skel-row wrap" },
      Array.from({ length: 5 }).map((_, i) =>
        h("span", { key: i, className: "skel skel-pill lg" }))),
    h(NutritionTodaySkeleton),
  );
}

// "Today" tab skeleton: fuel gauge + next-up card + water/supps strip + three meal slots.
function NutritionTodaySkeleton() {
  return h("div", { className: "nu-today-skeleton skel-stack gap-20", "aria-busy": "true" },
    // Fuel gauge: big number + 3 macro rings
    h("section", { className: "skel-stack gap-14" },
      h("div", { className: "skel skel-line xl w-40" }),
      h("div", { className: "skel-row gap-20" },
        h("div", { className: "skel skel-circle ring" }),
        h("div", { className: "skel skel-circle ring" }),
        h("div", { className: "skel skel-circle ring" }),
      ),
    ),
    // Next-up card
    h("div", { className: "skel skel-block h-120" }),
    // Water + supplements row
    h("div", { className: "skel-row gap-12" },
      h("div", { className: "skel skel-block h-60", style: { flex: 1 } }),
      h("div", { className: "skel skel-block h-60", style: { flex: 1 } }),
    ),
    // Three meal rows
    h("div", { className: "skel-stack gap-14" },
      h("div", { className: "skel skel-line lg w-25" }),
      Array.from({ length: 3 }).map((_, i) =>
        h("div", { key: i, className: "skel skel-block h-60" })),
    ),
  );
}

function useNutritionDay(accessToken) {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (target = date) => {
    if (!accessToken) return;
    setLoading(true); setError("");
    try {
      // `date` is a local YYYY-MM-DD (from localDateStr). `tz` is the JS
      // `getTimezoneOffset()` value in minutes — positive for zones west of
      // UTC (e.g. +240 for EDT). `api/emersus/nutrition-day.js` adds this
      // offset to the UTC day start to build the correct local-day window
      // for water/supplement rows, so the sign MUST stay as the platform
      // returns it — do not negate.
      const res = await fetch(`/api/nutrition/day?date=${target}&tz=${new Date().getTimezoneOffset()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Could not load nutrition.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, date]);

  useEffect(() => { if (accessToken) load(); }, [accessToken, load]);
  return { date, setDate, data, loading, error, reload: load };
}

function DateNavigator({ date, setDate }) {
  const isToday = date === todayIso();
  const offset = (delta) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDate(localDateStr(d));
  };
  const display = new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
  return h("div", { className: "nu-date-nav" },
    h("button", { type: "button", className: "nu-date-arrow", onClick: () => offset(-1) }, "‹"),
    h("div", { className: "nu-date-label" },
      h("span", { className: "nu-date-text" }, display),
      isToday ? h("span", { className: "nu-date-pill" }, "TODAY") : null,
    ),
    h("button", { type: "button", className: "nu-date-arrow", onClick: () => offset(1), disabled: isToday }, "›"),
  );
}

function NextUpCard({ data }) {
  const planned = (data?.meals || []).filter((m) => !m.eaten_at && m.planned_at);
  const next = planned[0];
  if (!next) return null;
  const remainingKcal = (data?.target?.kcal || 0) - (data?.consumed?.kcal || 0);
  const overagePct = remainingKcal > 0 ? (next.kcal - remainingKcal) / remainingKcal : 0;
  const isOver = overagePct > 0.15;
  return h("div", { className: "nu-next-up" },
    h("div", { className: "nu-next-up-head" },
      h("span", { className: "nu-next-up-eyebrow" }, "NEXT UP"),
      h("span", { className: "nu-next-up-when" }, (next.planned_at || "").slice(11, 16)),
    ),
    h("div", { className: "nu-next-up-name" }, next.name || next.type),
    h("div", { className: "nu-next-up-macros" },
      `${next.kcal} kcal · ${next.protein_g}g P · ${next.carbs_g}g C · ${next.fat_g}g F`),
    isOver
      ? h("div", { className: "nu-next-up-warn" },
          `⚠ PLANNED ${next.type.toUpperCase()} IS ${Math.round(next.kcal - remainingKcal)} KCAL OVER REMAINING`,
        )
      : null,
    isOver
      ? h("a", {
          className: "nu-next-up-cta",
          href: `/chat/?prompt=${encodeURIComponent(`Suggest a lighter ${next.type} — under ${remainingKcal} kcal with at least ${next.protein_g}g protein.`)}`,
        }, "Suggest lighter option →")
      : null,
  );
}

const SUPPLEMENT_PRESETS = ["Creatine", "Whey", "Multivitamin", "Omega-3", "Vitamin D", "Magnesium"];

function WaterSupplementsStrip({ data, accessToken, onChange, onToast }) {
  const consumedMl = data?.consumed?.water_ml || 0;
  const targetMl = data?.target?.water_ml || 3000;
  const waterPct = targetMl > 0 ? Math.min(100, (consumedMl / targetMl) * 100) : 0;
  const supplements = data?.consumed?.supplements || [];
  const [suppOpen, setSuppOpen] = useState(false);
  const [suppName, setSuppName] = useState("");

  const logWater = async (ml) => {
    try {
      const res = await fetch("/api/nutrition/water", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ml }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange?.();
    } catch (err) {
      console.error(err);
      onToast?.("LOGGED • WATER FAILED");
    }
  };

  const submitSupplement = async (rawName) => {
    const name = (rawName || "").trim();
    if (!name) return;
    try {
      const res = await fetch("/api/nutrition/supplements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ items: [{ name }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuppName("");
      setSuppOpen(false);
      onChange?.();
    } catch (err) {
      console.error(err);
      onToast?.("LOGGED • SUPPLEMENT FAILED");
    }
  };

  return h("div", { className: "nu-strip" },
    h("div", { className: "nu-strip-card" },
      h("div", { className: "nu-strip-head" },
        h("span", { className: "nu-strip-eyebrow" }, "Water"),
        h("span", { className: "nu-strip-value" }, `${(consumedMl/1000).toFixed(1)}L / ${(targetMl/1000).toFixed(0)}L`),
      ),
      h("div", { className: "nu-water-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(waterPct) },
        h("div", { className: "nu-water-bar-fill", style: { width: `${waterPct}%` } }),
      ),
      h("div", { className: "nu-strip-actions" },
        h("button", { type: "button", className: "nu-strip-btn", onClick: () => logWater(250) }, "+ 250ml"),
        h("button", { type: "button", className: "nu-strip-btn", onClick: () => logWater(500) }, "+ 500ml"),
      ),
    ),
    h("div", { className: "nu-strip-card" },
      h("div", { className: "nu-strip-head" },
        h("span", { className: "nu-strip-eyebrow" }, "Supplements"),
        h("span", { className: "nu-strip-value" }, `${supplements.length} logged today`),
      ),
      !suppOpen
        ? h("div", { className: "nu-strip-actions" },
            h("button", { type: "button", className: "nu-strip-btn", onClick: () => setSuppOpen(true) }, "+ Log supplement"),
          )
        : h("form", {
            className: "nu-supp-form",
            onSubmit: (e) => { e.preventDefault(); submitSupplement(suppName); },
          },
            h("input", {
              className: "nu-supp-input",
              type: "text",
              value: suppName,
              onChange: (e) => setSuppName(e.target.value),
              placeholder: "Supplement name",
              "aria-label": "Supplement name",
              autoFocus: true,
              maxLength: 80,
            }),
            h("div", { className: "nu-supp-presets" },
              SUPPLEMENT_PRESETS.map((name) =>
                h("button", {
                  key: name,
                  type: "button",
                  className: "nu-supp-chip",
                  onClick: () => submitSupplement(name),
                }, name),
              ),
            ),
            h("div", { className: "nu-strip-actions" },
              h("button", { type: "submit", className: "nu-strip-btn nu-strip-btn-primary", disabled: !suppName.trim() }, "Log"),
              h("button", {
                type: "button",
                className: "nu-strip-btn",
                onClick: () => { setSuppName(""); setSuppOpen(false); },
              }, "Cancel"),
            ),
          ),
    ),
  );
}

function MealsList({ data, onOpenSlot }) {
  const meals = data?.meals || [];
  if (!meals.length) {
    return h("div", { className: "nu-meals-empty" },
      h("p", null, "No meals logged or planned for this day."),
      h("a", { className: "nu-meals-cta", href: "/app/?prompt=Build me a meal plan" }, "Ask Emersus to plan a day \u2192"),
    );
  }

  const consumed = meals.filter((m) => m.eaten_at);
  const planned = meals.filter((m) => !m.eaten_at);
  const groups = new Map();
  for (const m of consumed) {
    const slot = m.type || "other";
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(m);
  }

  const groupedRows = [...groups.entries()].map(([slot, items]) => {
    const totalKcal = items.reduce((s, m) => s + (m.kcal || 0), 0);
    const totalP = items.reduce((s, m) => s + (m.protein_g || 0), 0);
    const totalC = items.reduce((s, m) => s + (m.carbs_g || 0), 0);
    const totalF = items.reduce((s, m) => s + (m.fat_g || 0), 0);
    const earliest = items.reduce((t, m) => {
      const mt = (m.eaten_at || "").slice(11, 16);
      return !t || mt < t ? mt : t;
    }, "");
    return { slot, items, totalKcal, totalP, totalC, totalF, time: earliest || "\u2014" };
  }).sort((a, b) => a.time.localeCompare(b.time));

  return h("div", { className: "nu-meals-list" },
    groupedRows.map((g) => h("article", {
      key: g.slot,
      className: "nu-meal-row is-clickable",
      onClick: () => onOpenSlot?.(g.slot),
    },
      h("div", { className: "nu-meal-time" }, g.time),
      h("div", { className: "nu-meal-body" },
        h("div", { className: "nu-meal-head" },
          h("span", { className: "nu-meal-name" }, MEAL_SLOT_LABELS[g.slot] || g.slot),
          h("span", { className: "nu-meal-pill" }, "LOGGED"),
        ),
        h("div", { className: "nu-meal-macros" },
          `${g.totalKcal} kcal \u00b7 ${g.totalP}g P \u00b7 ${g.totalC}g C \u00b7 ${g.totalF}g F`,
        ),
      ),
      h("span", { className: "nu-meal-count" }, `${g.items.length} item${g.items.length !== 1 ? "s" : ""}`),
      h("span", { className: "nu-meal-chevron" }, ">"),
    )),
    planned.map((m) => h("article", {
      key: m.id,
      className: "nu-meal-row is-planned",
    },
      h("div", { className: "nu-meal-time" }, (m.planned_at || "").slice(11, 16) || "\u2014"),
      h("div", { className: "nu-meal-body" },
        h("div", { className: "nu-meal-head" },
          h("span", { className: "nu-meal-name" }, m.name || m.type),
          h("span", { className: "nu-meal-pill" }, "PLANNED"),
        ),
        h("div", { className: "nu-meal-macros" },
          `${m.kcal} kcal \u00b7 ${m.protein_g}g P \u00b7 ${m.carbs_g}g C \u00b7 ${m.fat_g}g F`,
        ),
      ),
    )),
  );
}

function ComingSoonCard({ label }) {
  return h("div", { className: "nu-soon-card" },
    h("p", { className: "nu-soon-eyebrow" }, "SHIPPING Q3 2026"),
    h("h3", null, label),
    h("p", { className: "nu-soon-copy" }, "We're working on this. Check back soon."),
  );
}

function QuickLogDropdown({ accessToken, onLog, onToast }) {
  const [open, setOpen] = useState(false);
  const [suppMode, setSuppMode] = useState(false);
  const [suppName, setSuppName] = useState("");
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (!open) { setSuppMode(false); setSuppName(""); }
  }, [open]);

  const submitSupp = async (rawName) => {
    const name = (rawName || "").trim();
    if (!name) return;
    setOpen(false);
    try {
      const res = await fetch("/api/nutrition/supplements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ items: [{ name }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onToast?.(`LOGGED • ${name.toUpperCase()}`);
      onLog?.();
    } catch (err) {
      console.error(err);
      onToast?.("LOGGED • SUPPLEMENT FAILED");
    }
  };

  const handlePick = async (id) => {
    if (id === "supplement") {
      setSuppMode(true);
      setSuppName("");
      return;
    }
    setOpen(false);
    if (id === "water_250" || id === "water_500") {
      const ml = id === "water_250" ? 250 : 500;
      try {
        const res = await fetch("/api/nutrition/water", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ml }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onToast?.(`LOGGED • WATER +${ml} ML`);
        onLog?.();
      } catch (err) {
        console.error(err);
        onToast?.("LOGGED • WATER FAILED");
      }
    }
  };

  return h("div", { className: "nu-quick-wrap", onMouseDown: (e) => e.stopPropagation() },
    h("button", { type: "button", className: "nu-quick-btn", onClick: () => setOpen((v) => !v) },
      "+ Quick log \u25be"),
    open ? h("ul", { className: `nu-quick-menu${suppMode ? " is-supp" : ""}` },
      suppMode
        ? h("li", { className: "nu-quick-supp-form" },
            h("form", {
              onSubmit: (e) => { e.preventDefault(); submitSupp(suppName); },
            },
              h("input", {
                className: "nu-supp-input",
                type: "text",
                value: suppName,
                onChange: (e) => setSuppName(e.target.value),
                placeholder: "Supplement name",
                autoFocus: true,
                maxLength: 80,
              }),
              h("div", { className: "nu-supp-presets" },
                SUPPLEMENT_PRESETS.map((name) =>
                  h("button", {
                    key: name,
                    type: "button",
                    className: "nu-supp-chip",
                    onClick: () => submitSupp(name),
                  }, name),
                ),
              ),
              h("div", { className: "nu-strip-actions", style: { marginTop: 4 } },
                h("button", { type: "submit", className: "nu-strip-btn nu-strip-btn-primary", disabled: !suppName.trim() }, "Log"),
                h("button", {
                  type: "button",
                  className: "nu-strip-btn",
                  onClick: () => setSuppMode(false),
                }, "Cancel"),
              ),
            ),
          )
        : QUICK_LOG_ITEMS.map((it) => h("li", { key: it.id },
            h("button", { type: "button", onClick: () => handlePick(it.id) },
              h("span", null, it.label),
              h("span", { className: "nu-quick-hint" }, it.hint),
            ),
          )),
    ) : null,
  );
}

function MealEditModal({ open, mealSlot, date, accessToken, onClose, onMutate, onToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();

  const title = mealSlot ? (MEAL_SLOT_LABELS[mealSlot] || mealSlot) : "Log food";

  useEffect(() => {
    if (!open || !accessToken) return;
    setError(""); setSearchQuery(""); setSearchResults([]);
    setDeleteTarget(null);
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/emersus/meal-journal/day?date=${date}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("fetch_failed");
        const body = await res.json();
        const all = body.entries || [];
        if (mealSlot) {
          setEntries(all.filter((e) => e.meal_slot === mealSlot));
        } else {
          setEntries([]);
        }
      } catch (err) {
        setError(err.message || "Could not load meal details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, date, mealSlot, accessToken]);

  // a11y modal plumbing: Escape closes, Tab wraps within modal, focus jumps
  // to first focusable on open, returns to the originating trigger on close.
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusablesOf = () => {
      const root = modalRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    };
    // Defer one frame so children have mounted before we grab focus.
    const raf = requestAnimationFrame(() => {
      const [first] = focusablesOf();
      if (first) first.focus();
    });
    const handleKey = (e) => {
      if (e.key === "Escape") { onClose?.(); return; }
      if (e.key !== "Tab") return;
      const list = focusablesOf();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKey);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/emersus/foods/search?q=${encodeURIComponent(searchQuery)}&kind=food&limit=8`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const body = await res.json();
        setSearchResults(body.results || []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, accessToken]);

  const patchEntry = useCallback(async (entryId, patch) => {
    try {
      const res = await fetch(`/api/emersus/meal-journal/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("update_failed");
      const body = await res.json();
      if (patch.meal_slot && patch.meal_slot !== mealSlot && mealSlot) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
      } else if (body.entry) {
        setEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, ...body.entry } : e));
      }
      onMutate?.();
    } catch (err) {
      setError("Save failed. Try again.");
    }
  }, [accessToken, mealSlot, onMutate]);

  const handleAmountBlur = useCallback((entryId, newAmount) => {
    const num = parseFloat(newAmount);
    if (isNaN(num) || num <= 0) return;
    patchEntry(entryId, { amount: num });
  }, [patchEntry]);

  const handleSlotChange = useCallback((entryId, newSlot) => {
    patchEntry(entryId, { meal_slot: newSlot });
  }, [patchEntry]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget;
    try {
      const res = await fetch(`/api/emersus/meal-journal/entries/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("delete_failed");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      onMutate?.();
    } catch {
      setError("Delete failed.");
    } finally {
      // Always dismiss the confirm bar so the user can re-attempt or exit.
      setDeleteTarget(null);
    }
  }, [deleteTarget, accessToken, onMutate]);

  const addFood = useCallback(async (food) => {
    const slot = mealSlot || guessMealSlot();
    const amount = smartDefaultAmount(food);
    const amountUnit = smartDefaultUnit(food);
    try {
      const res = await fetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          entries: [{
            food_id: food.id,
            logged_date: date,
            meal_slot: slot,
            amount,
            amount_unit: amountUnit,
            source: "manual_search",
          }],
        }),
      });
      if (!res.ok) throw new Error("add_failed");
      const body = await res.json();
      const added = (body.entries || [])[0];
      if (added) {
        setEntries((prev) => [...prev, { ...added, food }]);
      }
      setSearchQuery("");
      setSearchResults([]);
      onMutate?.();
      const kcal = Math.round(Number(added?.kcal_snapshot) || 0);
      const foodName = (food?.name || "Food").toUpperCase();
      onToast?.(kcal > 0 ? `LOGGED • ${foodName} · ${kcal} KCAL` : `LOGGED • ${foodName}`);
    } catch {
      setError("Could not add food.");
    }
  }, [accessToken, date, mealSlot, onMutate, onToast]);

  if (!open) return null;

  const totalKcal = entries.reduce((s, e) => s + (Number(e.kcal_snapshot) || 0), 0);
  const totalP = entries.reduce((s, e) => s + (Number(e.protein_g_snapshot) || 0), 0);
  const totalC = entries.reduce((s, e) => s + (Number(e.carbs_g_snapshot) || 0), 0);
  const totalF = entries.reduce((s, e) => s + (Number(e.fat_g_snapshot) || 0), 0);
  const dateDisplay = new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return h("div", { className: "nu-modal-backdrop", onClick: onClose },
    h("div", {
      className: "nu-modal",
      onClick: (e) => e.stopPropagation(),
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      ref: modalRef,
    },

      h("div", { className: "nu-modal-head" },
        h("div", null,
          h("h3", { id: titleId }, title),
          h("div", { className: "nu-modal-subtitle" },
            `${dateDisplay} \u00b7 ${entries.length} item${entries.length !== 1 ? "s" : ""} logged`,
          ),
        ),
        h("button", { className: "nu-modal-close", onClick: onClose, "aria-label": "Close" }, "\u00d7"),
      ),

      h("div", { className: "nu-modal-body" },
        loading
          ? h("div", { className: "nu-modal-empty" }, "Loading\u2026")
          : error && !entries.length
            ? h("div", { className: "nu-modal-error" },
                error,
                h("button", { onClick: () => setError("") }, "\u2715"),
              )
            : entries.length
              ? h("ul", { className: "nu-food-list" },
                  entries.map((e) => {
                    const foodName = e.food?.description || "Unknown food";
                    const kcal = Math.round(Number(e.kcal_snapshot) || 0);
                    const prot = Math.round(Number(e.protein_g_snapshot) || 0);
                    const carb = Math.round(Number(e.carbs_g_snapshot) || 0);
                    const fat = Math.round(Number(e.fat_g_snapshot) || 0);
                    const unit = e.amount_unit === "serving" ? "srv" : "g";
                    const isDeleting = deleteTarget === e.id;

                    return h("li", {
                      key: e.id,
                      className: `nu-food-item${isDeleting ? " is-deleting" : ""}`,
                    },
                      h("div", { className: "nu-food-info" },
                        h("div", { className: "nu-food-name" }, foodName),
                        h("div", { className: "nu-food-meta-row" },
                          h("select", {
                            className: "nu-food-slot-select",
                            value: e.meal_slot,
                            "aria-label": "Meal slot",
                            onChange: (ev) => handleSlotChange(e.id, ev.target.value),
                            onClick: (ev) => ev.stopPropagation(),
                          },
                            MEAL_SLOT_GROUPS.map((g) =>
                              h("optgroup", { key: g.label, label: g.label },
                                g.slots.map((s) =>
                                  h("option", { key: s, value: s }, MEAL_SLOT_LABELS[s]),
                                ),
                              ),
                            ),
                          ),
                          h("div", { className: "nu-food-macros" },
                            h("span", { className: "nu-food-macro-p" }, `${prot}g P`),
                            h("span", { className: "nu-food-macro-c" }, `${carb}g C`),
                            h("span", { className: "nu-food-macro-f" }, `${fat}g F`),
                          ),
                        ),
                      ),
                      h("div", { className: "nu-food-amount-wrap" },
                        h("input", {
                          className: "nu-food-amount-input",
                          type: "number",
                          // Keep the real amount so fractional servings (e.g. 1.5)
                          // survive round-trips; rounding only happens at render.
                          defaultValue: Number(e.amount) || 0,
                          step: unit === "srv" ? "any" : 1,
                          min: 0,
                          onBlur: (ev) => handleAmountBlur(e.id, ev.target.value),
                          onKeyDown: (ev) => { if (ev.key === "Enter") ev.target.blur(); },
                        }),
                        h("span", { className: "nu-food-amount-unit" }, unit),
                      ),
                      h("span", { className: "nu-food-kcal" }, kcal),
                      h("button", {
                        className: "nu-food-delete",
                        onClick: () => setDeleteTarget(e.id),
                        title: "Delete",
                      }, "\u00d7"),
                    );
                  }),
                )
              : h("div", { className: "nu-modal-empty" }, "No items logged yet."),
      ),

      deleteTarget ? h("div", { className: "nu-delete-confirm" },
        h("span", null, `Remove \u201c${(entries.find((e) => e.id === deleteTarget)?.food?.description) || "item"}\u201d?`),
        h("button", { className: "nu-delete-confirm-yes", onClick: confirmDelete }, "Remove"),
        h("button", { className: "nu-delete-confirm-no", onClick: () => setDeleteTarget(null) }, "Cancel"),
      ) : null,

      entries.length > 0 ? h("div", { className: "nu-meal-summary" },
        h("div", null,
          h("div", { className: "nu-meal-summary-label" }, "MEAL TOTAL"),
          h("div", { className: "nu-meal-summary-value" }, `${Math.round(totalKcal)} kcal`),
        ),
        h("div", { className: "nu-meal-summary-macros" },
          h("span", { className: "nu-food-macro-p" }, `${Math.round(totalP)}g P`),
          h("span", { className: "nu-food-macro-c" }, `${Math.round(totalC)}g C`),
          h("span", { className: "nu-food-macro-f" }, `${Math.round(totalF)}g F`),
        ),
      ) : null,

      h("div", { className: "nu-add-food-row" },
        h("input", {
          className: "nu-add-food-input",
          type: "search",
          placeholder: "Search to add a food\u2026",
          "aria-label": "Search to add a food",
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
        }),
      ),
      searchResults.length > 0 ? h("ul", { className: "nu-search-results" },
        searchResults.map((f) => h("li", {
          key: f.id,
          className: "nu-search-result",
          onClick: () => addFood(f),
        },
          h("span", { className: "nu-search-result-name" }, f.description),
          h("span", { className: "nu-search-result-meta" },
            f.brand_name ? `${f.brand_name}` : (f.source || "").replace(/_/g, " "),
          ),
        )),
      ) : null,
    ),
  );
}

function NutritionApp() {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    return TABS.find((x) => x.id === t) ? t : "today";
  });
  const [session, setSession] = useState(null);
  const accessToken = session?.access_token || "";
  const [toast, setToast] = useState("");

  useEffect(() => { requireAuth().then(setSession); }, []);

  // Peak-End: confirm every log action with a brief toast so the gesture
  // ends on a visible success beat. Auto-clears after 2.2 s.
  const flashToast = useCallback((text) => {
    if (!text) return;
    setToast(String(text));
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const day = useNutritionDay(accessToken);

  const [modalSlot, setModalSlot] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openMealModal = useCallback((slot) => {
    setModalSlot(slot);
    setModalOpen(true);
  }, []);

  const openLogFood = useCallback(() => {
    setModalSlot(null);
    setModalOpen(true);
  }, []);

  const closeMealModal = useCallback(() => {
    setModalOpen(false);
    setModalSlot(null);
    day.reload();
  }, [day]);

  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => { setClearConfirm(false); }, [day.date]);

  const clearDay = useCallback(async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/emersus/meal-journal/clear-day", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        // See useNutritionDay.load for the tz sign contract.
        body: JSON.stringify({ date: day.date, tz: new Date().getTimezoneOffset() }),
      });
      if (!res.ok) throw new Error("clear_failed");
      setClearConfirm(false);
      flashToast("Day cleared");
      day.reload();
    } catch (err) {
      console.error(err);
      flashToast("Failed to clear");
    } finally {
      setClearing(false);
    }
  }, [accessToken, day, flashToast]);

  function setTabAndUrl(next) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "today") params.delete("tab"); else params.set("tab", next);
    const qs = params.toString();
    window.history.pushState({}, "", qs ? `?${qs}` : window.location.pathname);
  }

  if (!session) return h(NutritionSkeleton);

  return h("div", { className: "nu-shell" },
    h("nav", { className: "nu-tabs", role: "tablist" },
      TABS.map((t) =>
        h("button", {
          key: t.id, type: "button", role: "tab",
          "aria-selected": tab === t.id,
          className: `nu-tab${tab === t.id ? " is-active" : ""}${t.soon ? " is-soon" : ""}`,
          onClick: () => setTabAndUrl(t.id),
          title: t.soon ? "SHIPPING Q3 2026" : "",
        }, t.label, t.soon ? h("span", { className: "nu-soon-badge" }, "SOON") : null),
      ),
    ),

    tab === "today" ? h("div", { className: "nu-tab-body" },
      h(DateNavigator, { date: day.date, setDate: day.setDate }),
      day.loading
        ? h(NutritionTodaySkeleton)
        : day.error
          ? h("p", { className: "nu-error" }, day.error)
          : h(React.Fragment, null,
              h(FuelGauge, { data: day.data }),
              h(NextUpCard, { data: day.data }),
              h(WaterSupplementsStrip, { data: day.data, accessToken, onChange: day.reload, onToast: flashToast }),
              h(MealsList, { data: day.data, onOpenSlot: openMealModal }),
              h("button", {
                type: "button",
                className: "nu-log-food-btn",
                onClick: openLogFood,
              }, "+ Log food"),
              ((day.data?.consumed?.kcal || 0) > 0 || (day.data?.consumed?.water_ml || 0) > 0 || (day.data?.consumed?.supplements?.length || 0) > 0)
                ? clearConfirm
                  ? h("div", { className: "nu-clear-day-confirm" },
                      h("span", null, "Clear all entries for this day?"),
                      h("button", {
                        type: "button",
                        className: "nu-clear-day-yes",
                        onClick: clearDay,
                        disabled: clearing,
                      }, clearing ? "Clearing…" : "Clear"),
                      h("button", {
                        type: "button",
                        className: "nu-clear-day-no",
                        onClick: () => setClearConfirm(false),
                      }, "Cancel"),
                    )
                  : h("button", {
                      type: "button",
                      className: "nu-clear-day-btn",
                      onClick: () => setClearConfirm(true),
                    }, "Clear day")
                : null,
            ),
    ) : null,

    tab === "plans" ? h("div", { className: "nu-tab-body" },
      h("div", { className: "nu-meals-empty" },
        h("p", { style: { fontWeight: 500, color: "var(--ink)", margin: "0 0 6px" } }, "Meal plans are built in chat"),
        h("p", { style: { margin: "0 0 14px" } }, "Ask Emersus to create a plan tailored to your goals \u2014 it\u2019ll save here automatically."),
        h("a", { className: "nu-primary", href: "/app/?prompt=Build me a meal plan for today" }, "Create a meal plan \u2192"),
      ),
    ) : null,

    tab === "log" ? h("div", { className: "nu-tab-body" },
      h("div", { className: "nu-meals-empty" },
        h("p", { style: { fontWeight: 500, color: "var(--ink)", margin: "0 0 6px" } }, "Browse by date"),
        h("p", { style: { margin: 0 } }, "Switch to the Today tab and use the date arrows to view any day\u2019s meals and macros."),
      ),
    ) : null,

    tab === "recipes"   ? h("div", { className: "nu-tab-body" }, h(ComingSoonCard, { label: "Recipes library" })) : null,
    tab === "allergens" ? h("div", { className: "nu-tab-body" }, h(ComingSoonCard, { label: "Allergen tracking" })) : null,

    h("footer", { className: "nu-bottom-bar" },
      h(QuickLogDropdown, { accessToken, onLog: day.reload, onToast: flashToast }),
      h("a", { className: "nu-bottom-cta", href: "/app/?prompt=I want to log a meal" }, "Ask Emersus →"),
    ),
    h(MealEditModal, {
      open: modalOpen,
      mealSlot: modalSlot,
      date: day.date,
      accessToken,
      onClose: closeMealModal,
      onMutate: day.reload,
      onToast: flashToast,
    }),
    toast ? h("div", { className: "nu-toast", role: "status", "aria-live": "polite" }, toast) : null,
  );
}

const root = document.getElementById("nutrition-v2-root");
if (root) createRoot(root).render(h(ErrorBoundary, null, h(NutritionApp)));
