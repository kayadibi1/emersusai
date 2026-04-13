// app/nutrition/nutrition.js
//
// Single-page composition for /app/nutrition/. URL hash drives tab
// selection. React tab state is preserved across switches (no full
// page navigation). The food detail drawer mounts globally and reads
// its state from the ?food= query param.

import React from "react";
import { createRoot } from "react-dom/client";

import NutritionTodayPanel from "/shared/nutrition-today-panel.js";
import NutritionPlanPanel from "/shared/nutrition-plan-panel.js";
import NutritionJournalPanel from "/shared/nutrition-journal-panel.js";
import NutritionSupplementsPanel from "/shared/nutrition-supplements-panel.js";
import FoodDetailDrawer from "/shared/food-detail-drawer.js";

const { useEffect, useState } = React;
const h = React.createElement;

const TABS = [
  { id: "today",       label: "Today" },
  { id: "plan",        label: "Plan" },
  { id: "journal",     label: "Journal" },
  { id: "supplements", label: "Supplements" },
];

function parseHash() {
  const h = window.location.hash.replace("#", "");
  return TABS.find(t => t.id === h)?.id ?? "today";
}

function parseFoodParam() {
  const u = new URL(window.location.href);
  return u.searchParams.get("food");
}

function App() {
  const [activeTab, setActiveTab] = useState(parseHash());
  const [foodId, setFoodId] = useState(parseFoodParam());

  useEffect(() => {
    function onHashChange() {
      setActiveTab(parseHash());
      setFoodId(parseFoodParam());
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

  function navigate(tab) {
    setActiveTab(tab);
    window.location.hash = tab;
  }

  function openFood(id) {
    const u = new URL(window.location.href);
    u.searchParams.set("food", id);
    window.history.pushState({}, "", u.toString());
    setFoodId(id);
  }

  function closeFood() {
    const u = new URL(window.location.href);
    u.searchParams.delete("food");
    window.history.pushState({}, "", u.toString());
    setFoodId(null);
  }

  return h("div", { className: "nutrition-shell" }, [
    h("header", { key: "h", className: "nut-header" }, [
      h("h1", { key: "t" }, "Nutrition"),
      h("a", { key: "p", href: "/app/progress/#nutrition", className: "progress-link" }, "View progress â†’"),
    ]),
    h("nav", { key: "nav", className: "nut-tabs" },
      TABS.map(t =>
        h("button", {
          key: t.id,
          className: t.id === activeTab ? "tab active" : "tab",
          onClick: () => navigate(t.id),
        }, t.label)
      )
    ),
    h("main", { key: "m" }, [
      activeTab === "today"       && h(NutritionTodayPanel, {
        key: "today",
        onOpenFoodDetail: openFood,
        onOpenLogModal: () => navigate("journal"),
        onNavigateJournal: () => navigate("journal"),
        onNavigatePlan: () => navigate("plan"),
      }),
      activeTab === "plan"        && h(NutritionPlanPanel, {
        key: "plan",
        onRegenerateViaChat: () => { window.location.href = "/chat/?prompt=regenerate%20my%20meal%20plan"; },
      }),
      activeTab === "journal"     && h(NutritionJournalPanel, {
        key: "journal",
        onOpenFoodDetail: openFood,
      }),
      activeTab === "supplements" && h(NutritionSupplementsPanel, {
        key: "supplements",
        onOpenFoodDetail: openFood,
      }),
    ]),
    foodId && h(FoodDetailDrawer, {
      key: "drawer",
      foodId,
      onClose: closeFood,
      onLog: (food) => {
        closeFood();
        navigate("journal");
      },
    }),
  ]);
}

const root = createRoot(document.getElementById("root"));
root.render(h(App));
