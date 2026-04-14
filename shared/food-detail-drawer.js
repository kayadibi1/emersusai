// shared/food-detail-drawer.js
//
// Slide-over drawer on the right side of /app/nutrition/. Triggered by
// setting the ?food=<uuid> query param. Shows a nutrition-facts panel
// for foods and a supplement-facts panel for supplements, plus a "Log this"
// button and a mini history sparkline.
//
// Used by: all four nutrition tabs (Today, Plan, Journal, Supplements).

import React from "react";
import { localDateOffset } from "./date-utils.js";
import { createClient } from "@supabase/supabase-js";
import {
  NutritionFactsPanel,
  SupplementFactsPanel,
  Sparkline,
  TOKENS,
} from "./nutrition-charts.js";

const { useEffect, useState } = React;
const h = React.createElement;

// Reads the Supabase client setup that shared/supabase.js (if present) exposes,
// or constructs one from window.EMERSUS_SUPABASE_URL / window.EMERSUS_ANON_KEY
// injected by app/nutrition/index.html.
function getSupabase() {
  if (typeof window !== "undefined" && window.EMERSUS_SUPABASE) {
    return window.EMERSUS_SUPABASE;
  }
  const url = window.EMERSUS_SUPABASE_URL;
  const key = window.EMERSUS_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase client not initialized in window.EMERSUS_*");
  }
  const sb = createClient(url, key);
  window.EMERSUS_SUPABASE = sb;
  return sb;
}

export default function FoodDetailDrawer({ foodId, onClose, onLog }) {
  const [food, setFood] = useState(null);
  const [nutrients, setNutrients] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!foodId) {
      setFood(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sb = getSupabase();
        const { data: f } = await sb
          .from("foods")
          .select("id, description, brand_name, kind, form, source, base_unit, base_amount, common_unit, common_unit_grams")
          .eq("id", foodId)
          .maybeSingle();
        if (cancelled) return;
        setFood(f);

        if (f) {
          const { data: nutData } = await sb
            .from("food_nutrients")
            .select("amount_per_base, nutrients:nutrients!inner(slug, name, unit, category, default_dri_male, default_dri_female, display_order)")
            .eq("food_id", foodId)
            .order("nutrients(display_order)");
          if (cancelled) return;
          // Normalize: scale per-100g to per-serving if the UI is showing serving
          setNutrients((nutData ?? []).map(row => ({
            slug: row.nutrients.slug,
            name: row.nutrients.name,
            unit: row.nutrients.unit,
            category: row.nutrients.category,
            amount: row.amount_per_base * (f.common_unit_grams ?? f.base_amount) / f.base_amount,
            dri: row.nutrients.default_dri_male,  // v1 assumes male defaults; v2 reads profile
          })));

          // Mini history: entries over last 30 days for this food
          const since = localDateOffset(-30);
          const { data: histData } = await sb
            .from("meal_journal_entries")
            .select("logged_date")
            .eq("food_id", foodId)
            .gte("logged_date", since);
          if (cancelled) return;
          // Bucket by day
          const counts = {};
          for (const r of histData ?? []) {
            counts[r.logged_date] = (counts[r.logged_date] ?? 0) + 1;
          }
          const days = [];
          for (let i = 29; i >= 0; i--) {
            const d = localDateOffset(-i);
            days.push(counts[d] ?? 0);
          }
          setHistory(days);
        }
      } catch (err) {
        console.error("[food-detail-drawer] load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [foodId]);

  if (!foodId) return null;

  return h("aside", { className: "food-detail-drawer" }, [
    h("button", { key: "close", className: "close-btn", onClick: onClose }, "x"),
    loading && h("div", { key: "l", className: "loading" }, "Loading..."),
    !loading && !food && h("div", { key: "err", className: "error" }, "Food not found"),
    !loading && food && h("div", { key: "body", className: "body" }, [
      h("h2", { key: "desc", className: "food-desc" }, food.description),
      food.brand_name && h("div", { key: "brand", className: "brand" }, food.brand_name),
      h("div", { key: "src", className: "source" }, `Source: ${food.source.replace("_", " ")}`),
      food.common_unit && h("div", { key: "cu", className: "common-unit" },
        `1 ${food.common_unit} ~= ${food.common_unit_grams ?? "-"} g`),
      food.kind === "supplement"
        ? h(SupplementFactsPanel, { key: "facts", nutrients, form: food.form })
        : h(NutritionFactsPanel, { key: "facts", nutrients, servingGrams: food.common_unit_grams ?? 100 }),
      h("div", { key: "hist", className: "history" }, [
        h("div", { key: "lbl", className: "label" }, "Last 30 days"),
        h(Sparkline, { key: "sp", values: history, color: TOKENS.primary }),
      ]),
      h("button", {
        key: "log",
        className: "primary log-btn",
        onClick: () => onLog?.(food),
      }, `Log this ${food.kind}`),
    ]),
  ]);
}
