import React, { useCallback, useEffect, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth, getProfile } from "/shared/supabase.js";
import { fetchExerciseBySlug, fetchExerciseHistory } from "/shared/progress-helpers.js";
import { progressionLineChart, formatVolume, formatLoad, formatE1rm } from "/shared/progress-charts.js";
import { ICONS, ICON_COLORS } from "/shared/exercise-icons.js";
import { resolveWeightUnit, fromKg } from "/shared/unit-conversion.js";

const h = React.createElement;

function ExerciseDetail({ session, weightUnit }) {
  const userId = session.user.id;
  const slug = new URLSearchParams(window.location.search).get("slug");
  const [exercise, setExercise] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      try {
        const ex = await fetchExerciseBySlug(slug);
        if (!ex) { setLoading(false); return; }
        setExercise(ex);
        const hist = await fetchExerciseHistory(userId, ex.id, 20);
        setHistory(hist || []);
      } catch (err) {
        console.error("[exercise-detail]", err);
      }
      setLoading(false);
    })();
  }, [slug, userId]);

  if (loading) return h("div", { className: "progress-loading" }, "Loading...");
  if (!exercise) return h("div", { className: "progress-loading" }, "Exercise not found.");

  const isCardio = exercise.category === "cardio";
  const chartData = history.slice().reverse().map(r => ({
    performed_at: r.performed_at,
    value: isCardio
      ? (r.total_duration_seconds || 0) / 60  // minutes for cardio
      : (r.e1rm_kg || 0),
  })).filter(d => d.value > 0);

  const bestE1rm = !isCardio ? Math.max(...history.map(r => r.e1rm_kg || 0)) : null;
  const bestLoad = !isCardio ? Math.max(...history.map(r => r.max_load_kg || 0)) : null;
  const totalVol = !isCardio ? history.reduce((s, r) => s + (r.volume_kg || 0), 0) : null;
  const totalDur = isCardio ? history.reduce((s, r) => s + (r.total_duration_seconds || 0), 0) : null;

  const bestEntry = !isCardio ? history.find(r => r.e1rm_kg === bestE1rm) : null;
  const prDate = bestEntry?.performed_at || null;

  const colors = ICON_COLORS[exercise.category] || ICON_COLORS.resistance;
  const icon = ICONS[exercise.category] || ICONS.resistance;

  return h(React.Fragment, null,
    h("a", { className: "back", href: "/app/progress/" }, "\u2190 Back to Progress"),

    // Header
    h("div", { className: "exercise-header" },
      h("div", { className: "icon-type", style: { background: colors.bg, color: colors.color },
        dangerouslySetInnerHTML: { __html: icon } }),
      h("div", null,
        h("div", { className: "page-title" }, exercise.name),
        h("div", { className: "exercise-subtitle" },
          [exercise.movement_type, exercise.muscle_groups.join(", ")].filter(Boolean).join(" \u00b7 ")
        ),
      ),
    ),
    h("div", { className: "page-subtitle" }, `${history.length} sessions logged`),

    // Mini stats
    h("div", { className: "stat-row" },
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Best e1RM"),
        h("div", { className: "mini-stat-value" }, bestE1rm ? formatLoad(bestE1rm, weightUnit) : "-"),
        prDate && h("div", { className: "mini-stat-sub" }, prDate),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Heaviest Set"),
        h("div", { className: "mini-stat-value" }, bestLoad ? formatLoad(bestLoad, weightUnit) : "-"),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Total Volume"),
        h("div", { className: "mini-stat-value" }, totalVol ? formatVolume(totalVol, weightUnit) : "-"),
      ),
      isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Total Time"),
        h("div", { className: "mini-stat-value" }, totalDur ? `${Math.round(totalDur / 60)}min` : "-"),
      ),
    ),

    // Progression chart
    chartData.length >= 2 && h("div", { className: "card" },
      h("div", { className: "card-title" },
        isCardio ? "Duration Over Time" : "Weight Progression (e1RM)"),
      h("div", { className: "chart-area", dangerouslySetInnerHTML: {
        __html: progressionLineChart(chartData, {
          color: "#78dc14",
          prDate,
        }),
      }}),
    ),

    // Session history table
    h("div", { className: "section-label" }, "Session History"),
    h("div", { className: "card" },
      h("table", { className: "set-table" },
        h("thead", null,
          h("tr", null,
            h("th", null, "Date"),
            h("th", null, "Sets"),
            !isCardio && h("th", null, "Best Set"),
            !isCardio && h("th", null, "Volume"),
            !isCardio && h("th", null, "e1RM"),
            isCardio && h("th", null, "Duration"),
            isCardio && h("th", null, "Distance"),
          ),
        ),
        h("tbody", null,
          ...history.map((row, i) =>
            h("tr", { key: i },
              h("td", null, row.performed_at),
              h("td", null, row.set_count),
              !isCardio && h("td", null,
                row.max_load_kg ? `${formatLoad(row.max_load_kg, weightUnit)} x ${row.max_reps}` : "-",
                row.e1rm_kg === bestE1rm && bestE1rm > 0
                  ? h("span", { className: "pr-flag" }, "PR") : null,
              ),
              !isCardio && h("td", null, row.volume_kg ? formatVolume(row.volume_kg, weightUnit) : "-"),
              !isCardio && h("td", null, row.e1rm_kg ? formatLoad(row.e1rm_kg, weightUnit) : "-"),
              isCardio && h("td", null, row.total_duration_seconds
                ? `${Math.round(row.total_duration_seconds / 60)}min` : "-"),
              isCardio && h("td", null, row.total_distance_meters
                ? `${(row.total_distance_meters / 1000).toFixed(1)}km` : "-"),
            )
          ),
        ),
      ),
    ),
  );
}

async function boot() {
  const rootEl = document.getElementById("exercise-root");
  if (!rootEl) return;
  const session = await requireAuth();
  if (!session) return;

  let weightUnit = "kg";
  try {
    const profile = await getProfile(session.user.id);
    weightUnit = resolveWeightUnit(profile?.weight_unit);
  } catch (err) {
    weightUnit = resolveWeightUnit(null);
  }

  const root = createRoot(rootEl);
  root.render(h(ExerciseDetail, { session, weightUnit }));
}

boot().catch(err => {
  console.error("[exercise-detail] Boot failed:", err);
  const el = document.getElementById("exercise-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load.</div>';
});
