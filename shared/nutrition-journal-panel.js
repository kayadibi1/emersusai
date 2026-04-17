// shared/nutrition-journal-panel.js
//
// Journal tab composition. Date picker, day totals card, meal sections
// with inline edit/delete, and the search-first "Log food" modal.

import React from "react";
import { localDateStr } from "./date-utils.js";
const { useEffect, useState } = React;
const h = React.createElement;

const MEAL_SLOT_ORDER = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner", "evening",
  "pre_workout", "post_workout", "supplements_am", "supplements_pm",
];

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

function LogFoodModal({ onClose, onLogged, date, kindFilter }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("");
  const [mealSlot, setMealSlot] = useState("lunch");
  const [submitting, setSubmitting] = useState(false);
  const [logError, setLogError] = useState("");

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const kindParam = kindFilter ? `&kind=${kindFilter}` : "&kind=any";
        const res = await authFetch(`/api/emersus/foods/search?q=${encodeURIComponent(query)}${kindParam}&limit=20`, { signal: ctrl.signal });
        if (res.ok) {
          const { results } = await res.json();
          setResults(results ?? []);
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error(err);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, kindFilter]);

  async function log() {
    if (!selected) return;
    setLogError("");
    setSubmitting(true);
    try {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return;
      const res = await authFetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: [{
            food_id: selected.id,
            logged_date: date,
            meal_slot: mealSlot,
            amount: amt,
            amount_unit: selected.base_unit === "100g" ? "g" : "serving",
            source: "manual_search",
          }],
        }),
      });
      if (res.ok) {
        onLogged?.();
        onClose?.();
      } else {
        setLogError("Could not log entry. Please try again.");
      }
    } catch {
      setLogError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return h("div", { className: "log-food-modal-backdrop", onClick: onClose }, [
    h("div", { className: "log-food-modal", onClick: (e) => e.stopPropagation(), key: "m" }, [
      h("h3", { key: "t" }, `Log ${kindFilter ?? "food"}`),
      h("input", {
        key: "q",
        type: "text",
        placeholder: "Search foods...",
        value: query,
        autoFocus: true,
        onChange: (e) => setQuery(e.target.value),
      }),
      h("ul", { className: "results", key: "r" },
        results.map(r =>
          h("li", {
            key: r.id,
            className: selected?.id === r.id ? "selected" : "",
            onClick: () => setSelected(r),
          }, [
            h("span", { className: "desc", key: "d" }, r.description),
            r.brand_name && h("span", { className: "brand", key: "b" }, ` - ${r.brand_name}`),
          ])
        )
      ),
      selected && h("div", { className: "log-form", key: "f" }, [
        h("label", { key: "a" }, [
          "Amount ",
          h("input", {
            key: "ai",
            type: "number",
            min: 0,
            step: "0.1",
            value: amount,
            onChange: (e) => setAmount(e.target.value),
          }),
          " ",
          h("span", { key: "u" }, selected.base_unit === "100g" ? "g" : (selected.common_unit ?? "unit")),
        ]),
        h("label", { key: "s" }, [
          "Meal ",
          h("select", {
            key: "si",
            value: mealSlot,
            onChange: (e) => setMealSlot(e.target.value),
          }, MEAL_SLOT_ORDER.map(s =>
            h("option", { key: s, value: s }, s.replace(/_/g, " "))
          )),
        ]),
        logError && h("div", { key: "err", className: "log-error", style: { color: "var(--danger)", fontSize: "13px", marginTop: "8px" } }, logError),
        h("button", {
          key: "go",
          className: "primary",
          disabled: submitting || !amount,
          onClick: log,
        }, submitting ? "Saving..." : "Log"),
      ]),
      h("button", { key: "c", className: "cancel", onClick: onClose }, "Cancel"),
    ]),
  ]);
}

export default function NutritionJournalPanel({ onOpenFoodDetail }) {
  const [date, setDate] = useState(localDateStr());
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);  // null | "food" | "supplement"

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/emersus/meal-journal/day?date=${date}`);
      if (res.ok) {
        const json = await res.json();
        setDay(json);
      } else {
        setDay({ entries: [] });
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [date]);

  async function del(id) {
    if (!confirm("Delete this entry?")) return;
    const res = await authFetch(`/api/emersus/meal-journal/entries/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function copyDay() {
    const source = prompt("Copy from date (YYYY-MM-DD):", date);
    if (!source) return;
    const res = await authFetch("/api/emersus/meal-journal/copy-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_date: source, target_date: date }),
    });
    if (res.ok) await load();
  }

  const entries = day?.entries ?? [];
  const bySlot = {};
  for (const e of entries) {
    bySlot[e.meal_slot] = bySlot[e.meal_slot] ?? [];
    bySlot[e.meal_slot].push(e);
  }

  return h("div", { className: "journal-panel" }, [
    h("div", { className: "journal-header", key: "h" }, [
      h("input", {
        key: "d",
        type: "date",
        value: date,
        onChange: (e) => setDate(e.target.value),
      }),
      h("button", { key: "l", className: "primary", onClick: () => setModal("food") }, "Log food"),
      h("button", { key: "s", onClick: () => setModal("supplement") }, "Log supplement"),
      h("button", { key: "c", onClick: copyDay }, "Copy day from..."),
    ]),

    loading && h("div", { key: "loading" }, "Loading..."),

    !loading && MEAL_SLOT_ORDER.map(slot => {
      const list = bySlot[slot] ?? [];
      if (list.length === 0) return null;
      const total = list.reduce((acc, e) => ({
        kcal: acc.kcal + (e.kcal_snapshot ?? 0),
        protein: acc.protein + (e.protein_g_snapshot ?? 0),
        carbs: acc.carbs + (e.carbs_g_snapshot ?? 0),
        fat: acc.fat + (e.fat_g_snapshot ?? 0),
        fiber: acc.fiber + (e.fiber_g_snapshot ?? 0),
      }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
      return h("div", { key: slot, className: "journal-slot" }, [
        h("div", { className: "slot-header", key: "h" }, [
          h("span", { className: "name", key: "n" }, slot.replace(/_/g, " ")),
          h("span", { className: "total", key: "t" },
            `${Math.round(total.kcal)} kcal - P${Math.round(total.protein)} - C${Math.round(total.carbs)} - F${Math.round(total.fat)}`
          ),
        ]),
        h("ul", { className: "entries", key: "e" },
          list.map(e =>
            h("li", { key: e.id }, [
              h("span", {
                className: "desc",
                key: "d",
                onClick: () => onOpenFoodDetail?.(e.food?.id),
              }, e.food?.description ?? "(unknown)"),
              h("span", { className: "amt", key: "a" }, `${e.amount} ${e.amount_unit}`),
              h("button", { key: "del", className: "del", onClick: () => del(e.id) }, "x"),
            ])
          )
        ),
      ]);
    }),

    !loading && entries.length === 0 &&
      h("div", { key: "empty", className: "empty" }, "No entries for this day."),

    modal && h(LogFoodModal, {
      key: "modal",
      date,
      kindFilter: modal,
      onClose: () => setModal(null),
      onLogged: load,
    }),
  ]);
}
