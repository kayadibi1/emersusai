import React, { useCallback, useEffect, useMemo, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth } from "/shared/supabase.js";
import {
  fetchDashboard,
  fetchWeeklyActivity,
  fetchMuscleVolume,
  fetchRecentSessions,
  fetchTopExercises,
  fetchPersonalRecords,
  dateRange,
} from "/shared/progress-helpers.js";
import { weeklyActivityChart, muscleBar, formatVolume, formatDuration } from "/shared/progress-charts.js";
import { ICONS, ICON_COLORS, DOT_COLORS } from "/shared/exercise-icons.js";

const h = React.createElement;

const RANGES = [
  { label: "4W", weeks: 4 },
  { label: "8W", weeks: 8 },
  { label: "12W", weeks: 12 },
  { label: "All", weeks: 520 },
];

function ProgressDashboard({ session }) {
  const userId = session.user.id;
  const [rangeIdx, setRangeIdx] = useState(1); // default 8W
  const [dashboard, setDashboard] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [muscles, setMuscles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => dateRange(RANGES[rangeIdx].weeks), [rangeIdx]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, w, m, s, e, p] = await Promise.all([
        fetchDashboard(userId, range.start, range.end),
        fetchWeeklyActivity(userId, range.start, range.end),
        fetchMuscleVolume(userId, range.start, range.end),
        fetchRecentSessions(userId, 5),
        fetchTopExercises(userId, range.start, range.end, 6),
        fetchPersonalRecords(userId, range.start, range.end),
      ]);
      setDashboard(d);
      setWeekly(w);
      setMuscles(m);
      setSessions(s);
      setExercises(e);
      setPrs(p);
    } catch (err) {
      console.error("[progress] Load failed:", err);
    }
    setLoading(false);
  }, [userId, range]);

  useEffect(() => { load(); }, [load]);

  if (loading && !dashboard) {
    return h("div", { className: "progress-loading" }, "Loading...");
  }

  const maxMuscleVol = muscles.length > 0 ? muscles[0].volume_kg : 1;

  return h(React.Fragment, null,
    // Page header
    h("div", { className: "page-header" },
      h("h1", null, "Progress"),
      h("p", null, "Your training history and analytics"),
    ),

    // Time range pills
    h("div", { className: "time-range" },
      RANGES.map((r, i) =>
        h("button", {
          key: r.label,
          className: `time-pill${i === rangeIdx ? " active" : ""}`,
          onClick: () => setRangeIdx(i),
        }, r.label)
      )
    ),

    // Stat cards
    dashboard && h("div", { className: "stats-grid" },
      statCard("Sessions", dashboard.sessions_completed || 0, null, "neutral"),
      statCard("Volume", formatVolume(dashboard.total_volume_kg || 0), null, "positive"),
      statCard("Cardio", formatDuration(dashboard.total_cardio_seconds || 0),
        `${dashboard.cardio_session_count || 0} sessions`, "neutral"),
      statCard("PRs", String(prs.length), "this period", "neutral",
        prs.length > 0 ? "var(--gold)" : null),
    ),

    // Two-col: weekly chart + muscle volume
    h("div", { className: "two-col" },
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Weekly Activity"),
          h("div", { className: "chart-meta" }, "volume + duration"),
        ),
        h("div", { dangerouslySetInnerHTML: { __html: weeklyActivityChart(weekly) } }),
        h("div", { className: "chart-legend" },
          h("div", { className: "legend-item" },
            h("div", { className: "legend-dot resistance" }), "Resistance"),
          h("div", { className: "legend-item" },
            h("div", { className: "legend-dot cardio" }), "Cardio"),
        ),
      ),

      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Muscle Volume"),
        ),
        ...muscles.map(m =>
          h("div", { key: m.muscle_group, className: "muscle-row" },
            h("div", { className: "muscle-meta" },
              h("span", { className: "muscle-name" }, formatMuscleName(m.muscle_group)),
              h("span", { className: "muscle-vol" }, formatVolume(m.volume_kg)),
            ),
            h("div", { dangerouslySetInnerHTML: {
              __html: muscleBar((m.volume_kg / maxMuscleVol) * 100)
            }}),
          )
        ),
      ),
    ),

    // Two-col: recent sessions + top exercises
    h("div", { className: "two-col" },
      // Recent sessions
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Recent Sessions"),
        ),
        ...sessions.map(s =>
          h("a", {
            key: `${s.plan_id}-${s.session_id}`,
            className: "session-item",
            href: `/app/progress/session/?plan=${s.plan_id}&s=${s.session_id}`,
          },
            h("div", { className: "session-top" },
              h("div", { className: "session-name-row" },
                h("div", {
                  className: "type-dot",
                  style: { background: DOT_COLORS[s.category] || DOT_COLORS.resistance },
                }),
                h("span", { className: "session-name" }, s.session_title || s.session_id),
              ),
              h("span", { className: "session-status done" }, "completed"),
            ),
            h("div", { className: "session-detail" },
              `${s.performed_at} \u00b7 ${s.exercise_count} exercises \u00b7 ${formatVolume(s.volume_kg)}`
            ),
          )
        ),
      ),

      // Top exercises
      h("div", { className: "card" },
        h("div", { className: "card-header" },
          h("div", { className: "card-title" }, "Top Exercises"),
        ),
        ...exercises.map(ex =>
          h("a", {
            key: ex.slug,
            className: "exercise-row",
            href: `/app/progress/exercise/?slug=${ex.slug}`,
          },
            h("div", {
              className: "icon-type",
              style: {
                background: (ICON_COLORS[ex.category] || ICON_COLORS.resistance).bg,
                color: (ICON_COLORS[ex.category] || ICON_COLORS.resistance).color,
              },
              dangerouslySetInnerHTML: { __html: ICONS[ex.category] || ICONS.resistance },
            }),
            h("div", { className: "exercise-info" },
              h("div", { className: "exercise-name" }, ex.name),
              h("div", { className: "exercise-meta" },
                `${ex.session_count} sessions` + (ex.movement_type ? ` \u00b7 ${ex.movement_type}` : "")),
            ),
            h("div", { className: "exercise-stat" },
              ex.category !== "cardio"
                ? h(React.Fragment, null,
                    h("div", { className: "exercise-primary" }, ex.best_load_kg ? `${ex.best_load_kg}kg` : "-"),
                    h("div", { className: "exercise-secondary" }, ex.best_e1rm_kg ? `e1RM ${ex.best_e1rm_kg}kg` : ""),
                  )
                : h(React.Fragment, null,
                    h("div", { className: "exercise-primary" }, formatDuration(ex.total_duration_seconds)),
                    h("div", { className: "exercise-secondary" },
                      ex.total_distance_meters ? `${(ex.total_distance_meters / 1000).toFixed(1)}km` : ""),
                  ),
            ),
          )
        ),
      ),
    ),

    // PR banner
    prs.length > 0 && h("div", { className: "pr-banner" },
      h("div", { className: "pr-title" },
        h("span", { dangerouslySetInnerHTML: { __html: ICONS.trophy } }),
        " Recent PRs",
      ),
      h("div", { className: "pr-list" },
        ...prs.slice(0, 5).map((pr, i) =>
          h("div", { key: i, className: "pr-item" },
            h("span", { className: "pr-exercise" }, pr.exercise_name),
            h("span", { className: "pr-value" }, `e1RM ${pr.value}kg`),
            h("span", { className: "pr-date" }, pr.achieved_at),
          )
        ),
      ),
    ),
  );
}

// -- Helpers ------------------------------------------------------------------

function statCard(label, value, sub, subClass, valueColor) {
  return h("div", { className: "stat-card" },
    h("div", { className: "stat-label" }, label),
    h("div", { className: "stat-value", style: valueColor ? { color: valueColor } : null }, value),
    sub && h("div", { className: `stat-sub ${subClass}` }, sub),
  );
}

function formatMuscleName(slug) {
  return slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// -- Boot ---------------------------------------------------------------------

async function boot() {
  const rootEl = document.getElementById("progress-root");
  if (!rootEl) return;

  const session = await requireAuth();
  if (!session) return;

  const root = createRoot(rootEl);
  root.render(h(ProgressDashboard, { session }));
}

boot().catch(err => {
  console.error("[progress] Boot failed:", err);
  const el = document.getElementById("progress-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load progress data.</div>';
});
