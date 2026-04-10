import React, { useEffect, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { requireAuth, getProfile } from "/shared/supabase.js";
import { fetchSessionDetail } from "/shared/progress-helpers.js";
import { formatVolume, formatLoad, formatDuration } from "/shared/progress-charts.js";
import { DOT_COLORS } from "/shared/exercise-icons.js";
import { resolveWeightUnit } from "/shared/unit-conversion.js";

const h = React.createElement;

function SessionDetail({ session, weightUnit }) {
  const userId = session.user.id;
  const params = new URLSearchParams(window.location.search);
  const planId = params.get("plan");
  const sessionId = params.get("s");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!planId || !sessionId) return;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchSessionDetail(userId, planId, sessionId);
        setRows(data || []);
      } catch (err) {
        console.error("[session-detail]", err);
      }
      setLoading(false);
    })();
  }, [userId, planId, sessionId]);

  if (loading) return h("div", { className: "progress-loading" }, "Loading...");
  if (rows.length === 0) return h("div", { className: "progress-loading" }, "No data for this session.");

  // Group rows by exercise
  const exerciseMap = new Map();
  for (const row of rows) {
    const key = row.exercise_name;
    if (!exerciseMap.has(key)) {
      exerciseMap.set(key, { ...row, sets: [] });
    }
    exerciseMap.get(key).sets.push(row);
  }
  const exercises = [...exerciseMap.values()];

  const performedAt = rows[0]?.performed_at || "";
  const isCardio = exercises.every(e => e.category === "cardio");
  const isMixed = exercises.some(e => e.category === "cardio") && exercises.some(e => e.category !== "cardio");
  const category = isCardio ? "cardio" : isMixed ? "mixed" : "resistance";

  const totalVolume = rows.reduce((s, r) =>
    s + ((r.reps || 0) * (r.load_kg || 0)), 0);
  const totalCardioSec = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);
  const exerciseCount = exercises.length;

  return h(React.Fragment, null,
    h("a", { className: "back", href: "/app/progress/" }, "\u2190 Back to Progress"),

    // Header
    h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" } },
      h("div", { className: "type-dot", style: { background: DOT_COLORS[category] } }),
      h("div", { className: "page-title" }, sessionId),
    ),
    h("div", { className: "page-subtitle" }, performedAt),

    // Stats
    h("div", { className: "stat-row" },
      h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Exercises"),
        h("div", { className: "mini-stat-value" }, String(exerciseCount)),
      ),
      !isCardio && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Volume"),
        h("div", { className: "mini-stat-value" }, formatVolume(totalVolume, weightUnit)),
      ),
      totalCardioSec > 0 && h("div", { className: "mini-stat" },
        h("div", { className: "mini-stat-label" }, "Cardio"),
        h("div", { className: "mini-stat-value" }, formatDuration(totalCardioSec)),
      ),
    ),

    // Exercise blocks
    h("div", { className: "section-label" }, "Exercises"),

    ...exercises.map((ex) =>
      ex.category === "cardio"
        // Cardio block
        ? h("div", { key: ex.exercise_name, className: "cardio-block" },
            h("div", { className: "exercise-block-name" }, ex.exercise_name),
            h("div", { className: "cardio-stat-grid" },
              ex.duration_seconds && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, formatDuration(ex.duration_seconds)),
                h("div", { className: "cardio-stat-label" }, "Duration"),
              ),
              ex.distance_meters && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, `${(ex.distance_meters / 1000).toFixed(1)}km`),
                h("div", { className: "cardio-stat-label" }, "Distance"),
              ),
              ex.avg_heart_rate && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, String(ex.avg_heart_rate)),
                h("div", { className: "cardio-stat-label" }, "Avg HR"),
              ),
              ex.calories && h("div", { className: "cardio-stat" },
                h("div", { className: "cardio-stat-val" }, String(ex.calories)),
                h("div", { className: "cardio-stat-label" }, "Calories"),
              ),
            ),
          )
        // Resistance / bodyweight block
        : h("div", { key: ex.exercise_name, className: "exercise-block" },
            h("div", { className: "exercise-block-header" },
              h("span", { className: "exercise-block-name" }, ex.exercise_name),
              h("span", { className: "exercise-block-vol" },
                formatVolume(ex.sets.reduce((s, r) => s + ((r.reps || 0) * (r.load_kg || 0)), 0), weightUnit) + " vol"),
            ),
            ...ex.sets.map((set, i) =>
              h("div", { key: i, className: "set-row" },
                h("span", { className: "set-label" }, `Set ${set.set_number || i + 1}`),
                h("span", { className: "set-data" },
                  set.load_kg ? `${formatLoad(set.load_kg, weightUnit)} x ${set.reps}` : `${set.reps} reps`),
                set.rpe && h("span", { className: "set-rpe" }, `RPE ${set.rpe}`),
              )
            ),
          )
    ),
  );
}

async function boot() {
  const rootEl = document.getElementById("session-detail-root");
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
  root.render(h(SessionDetail, { session, weightUnit }));
}

boot().catch(err => {
  console.error("[session-detail] Boot failed:", err);
  const el = document.getElementById("session-detail-root");
  if (el) el.innerHTML = '<div class="progress-loading">Failed to load.</div>';
});
