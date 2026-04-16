// app/nutrition/nutrition-v2.js — Phase 4 Nutrition v2 SPA entry.
//
// Top tabs (Today / Plans / Log / Recipes [SOON] / Allergens [SOON]).
// Today tab is the showcase: time-aware fuel gauge + water/supps strip
// + meals list + bottom Quick-log dropdown.

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { requireAuth } from "/shared/supabase.js";
import { FuelGauge } from "/shared/nutrition/fuel-gauge.js";

const h = React.createElement;

const TABS = [
  { id: "today",     label: "Today" },
  { id: "plans",     label: "Plans" },
  { id: "log",       label: "Log" },
  { id: "recipes",   label: "Recipes",   soon: true },
  { id: "allergens", label: "Allergens", soon: true },
];

const QUICK_LOG_ITEMS = [
  { id: "water_250",  label: "Water +250ml", hint: "+ 250 ML" },
  { id: "water_500",  label: "Water +500ml", hint: "+ 500 ML" },
  { id: "supplement", label: "Supplement",   hint: "QUICK" },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }

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
      const res = await fetch(`/api/nutrition/day?date=${target}`, {
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
    const d = new Date(date); d.setUTCDate(d.getUTCDate() + delta);
    setDate(d.toISOString().slice(0, 10));
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

function WaterSupplementsStrip({ data, accessToken, onChange }) {
  const consumedMl = data?.consumed?.water_ml || 0;
  const targetMl = data?.target?.water_ml || 3000;
  const waterPct = targetMl > 0 ? Math.min(100, (consumedMl / targetMl) * 100) : 0;
  const supplements = data?.consumed?.supplements || [];
  const [suppOpen, setSuppOpen] = useState(false);
  const [suppName, setSuppName] = useState("");

  const logWater = async (ml) => {
    try {
      await fetch("/api/nutrition/water", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ml }),
      });
      onChange?.();
    } catch (err) { console.error(err); }
  };

  const submitSupplement = async (rawName) => {
    const name = (rawName || "").trim();
    if (!name) return;
    try {
      await fetch("/api/nutrition/supplements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ items: [{ name }] }),
      });
      setSuppName("");
      setSuppOpen(false);
      onChange?.();
    } catch (err) { console.error(err); }
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

function MealsList({ data }) {
  const meals = data?.meals || [];
  if (!meals.length) {
    return h("div", { className: "nu-meals-empty" },
      h("p", null, "No meals logged or planned for this day."),
      h("a", { className: "nu-meals-cta", href: "/app/?prompt=Build me a meal plan" }, "Ask Emersus to plan a day →"),
    );
  }
  return h("div", { className: "nu-meals-list" },
    meals.map((m) => h("article", {
      key: m.id,
      className: `nu-meal-row${m.eaten_at ? "" : " is-planned"}`,
    },
      h("div", { className: "nu-meal-time" }, (m.eaten_at || m.planned_at || "").slice(11, 16) || "—"),
      h("div", { className: "nu-meal-body" },
        h("div", { className: "nu-meal-head" },
          h("span", { className: "nu-meal-name" }, m.name || m.type),
          h("span", { className: "nu-meal-pill" }, m.eaten_at ? "LOGGED" : "PLANNED"),
        ),
        h("div", { className: "nu-meal-macros" },
          `${m.kcal} kcal · ${m.protein_g}g P · ${m.carbs_g}g C · ${m.fat_g}g F`,
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

function QuickLogDropdown({ accessToken, onLog }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const handlePick = async (id) => {
    setOpen(false);
    if (id === "water_250" || id === "water_500") {
      await fetch("/api/nutrition/water", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ml: id === "water_250" ? 250 : 500 }),
      });
    } else if (id === "supplement") {
      const name = window.prompt("Supplement name:", "Creatine");
      if (name) {
        await fetch("/api/nutrition/supplements", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ items: [{ name }] }),
        });
      }
    }
    onLog?.();
  };

  return h("div", { className: "nu-quick-wrap", onMouseDown: (e) => e.stopPropagation() },
    h("button", { type: "button", className: "nu-quick-btn", onClick: () => setOpen((v) => !v) },
      "+ Quick log ▾"),
    open ? h("ul", { className: "nu-quick-menu" },
      QUICK_LOG_ITEMS.map((it) => h("li", { key: it.id },
        h("button", { type: "button", onClick: () => handlePick(it.id) },
          h("span", null, it.label),
          h("span", { className: "nu-quick-hint" }, it.hint),
        ),
      )),
    ) : null,
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

  useEffect(() => { requireAuth().then(setSession); }, []);

  const day = useNutritionDay(accessToken);

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
              h(WaterSupplementsStrip, { data: day.data, accessToken, onChange: day.reload }),
              h(MealsList, { data: day.data }),
              h("a", {
                className: "nu-meals-cta nu-meals-cta-bottom",
                href: "/app/?prompt=Log a meal",
              }, "+ Log a meal via chat"),
            ),
    ) : null,

    tab === "plans" ? h("div", { className: "nu-tab-body" },
      h("p", { className: "nu-helper" }, "MEAL PLANS LIVE IN /CHAT — saved plans appear here automatically."),
      h("a", { className: "nu-primary", href: "/app/?prompt=Build me a meal plan for today" }, "Build a plan in chat →"),
    ) : null,

    tab === "log" ? h("div", { className: "nu-tab-body" },
      h("p", { className: "nu-helper" }, "PAGINATED RECENT-DAYS LIST SHIPS IN A FOLLOW-UP. For now, navigate via the date arrows above."),
    ) : null,

    tab === "recipes"   ? h("div", { className: "nu-tab-body" }, h(ComingSoonCard, { label: "Recipes library" })) : null,
    tab === "allergens" ? h("div", { className: "nu-tab-body" }, h(ComingSoonCard, { label: "Allergen tracking" })) : null,

    h("footer", { className: "nu-bottom-bar" },
      h(QuickLogDropdown, { accessToken, onLog: day.reload }),
      h("a", { className: "nu-bottom-cta", href: "/app/?prompt=I want to log a meal" }, "Ask Emersus →"),
    ),
  );
}

const root = document.getElementById("nutrition-v2-root");
if (root) createRoot(root).render(h(NutritionApp));
