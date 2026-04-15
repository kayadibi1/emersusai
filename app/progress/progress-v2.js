// app/progress/progress-v2.js — Phase 5 Progress v2 SPA entry.
//
// Modality filter (All/Lift/Cardio/Swim/Climb/Nutrition) + period pills
// (Week/Month/3M/Year). Renders 4 sections + 4 coming-soon placeholders.

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { requireAuth } from "/shared/supabase.js";

const h = React.createElement;

const MODALITIES = ["all", "lift", "cardio", "swim", "climb", "nutrition"];
const PERIODS = ["week", "month", "3m", "year"];
const MODALITY_LABELS = { all: "All", lift: "Lift", cardio: "Cardio", swim: "Swim", climb: "Climb", nutrition: "Nutrition" };
const MODALITY_COLORS = { lift: "var(--accent)", cardio: "#fbbf24", swim: "#60a5fa", climb: "#a78bfa", nutrition: "#f472b6" };

function parseUrl(search) {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const m = p.get("modality"); const per = p.get("period");
  return {
    modality: MODALITIES.includes(m) ? m : "all",
    period: PERIODS.includes(per) ? per : "month",
  };
}
function buildUrl({ modality, period }) {
  const p = new URLSearchParams();
  if (modality !== "all") p.set("modality", modality);
  if (period !== "month") p.set("period", period);
  const q = p.toString();
  return q ? `?${q}` : "";
}

function PrCard({ pr }) {
  const delta = pr?.delta ?? pr?.delta_kg ?? null;
  return h("article", { className: "pg-pr-card" },
    h("div", { className: "pg-pr-tag" }, pr?.is_first ? "FIRST" : (delta && delta > 0 ? "NEW PR" : "PR")),
    h("div", { className: "pg-pr-name" }, pr?.exercise_name || pr?.exercise || "—"),
    h("div", { className: "pg-pr-value" }, `${pr?.weight_kg ?? pr?.value ?? "—"} kg`),
    delta ? h("div", { className: "pg-pr-delta" }, `${delta > 0 ? "+" : ""}${delta} kg`) : null,
  );
}

function StreakTracker({ streak }) {
  if (!streak) return null;
  const days = Number(streak.current) || 0;
  return h("section", { className: "pg-streak" },
    h("div", { className: "pg-streak-head" },
      h("span", { className: "pg-streak-num" }, days),
      h("span", { className: `pg-streak-flame${days > 0 ? " is-on" : ""}`, "aria-hidden": true }, "◆"),
    ),
    h("div", { className: "pg-streak-row" },
      Array.from({ length: 14 }, (_, i) => h("span", {
        key: i,
        className: `pg-streak-dot${i < days ? " is-active" : ""}`,
      })),
    ),
    h("div", { className: "pg-streak-stats" },
      h("div", null,
        h("span", { className: "pg-stat-label" }, "LONGEST EVER"),
        h("span", { className: "pg-stat-value" }, `${streak.longest_all_time?.days || 0} days`),
      ),
      h("div", null,
        h("span", { className: "pg-stat-label" }, "ACTIVE THIS YEAR"),
        h("span", { className: "pg-stat-value" }, streak.total_active_2026 || 0),
      ),
      h("div", null,
        h("span", { className: "pg-stat-label" }, "THIS MONTH"),
        h("span", { className: "pg-stat-value" }, `${streak.this_month?.pct || 0}%`),
      ),
    ),
    days === 0
      ? h("a", { className: "pg-streak-cta", href: "/app/train/" }, "Start a streak today →")
      : null,
  );
}

function RecentSessionRow({ s, onPick }) {
  const color = MODALITY_COLORS[s.modality] || "var(--muted)";
  const date = s.started_at ? new Date(s.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  return h("li", { className: "pg-recent-row", onClick: () => onPick?.(s) },
    h("span", { className: "pg-recent-pill", style: { background: color } }, (s.modality || "—").toUpperCase()),
    h("div", { className: "pg-recent-body" },
      h("div", { className: "pg-recent-title" }, s.title || "Untitled session"),
      h("div", { className: "pg-recent-meta" }, `${date} · ${s.ended_at ? "FINISHED" : "IN PROGRESS"}`),
    ),
    h("span", { className: "pg-recent-chev" }, "›"),
  );
}

function DrillDownPanel({ open, kind, id, accessToken, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !id) return undefined;
    setLoading(true); setData(null);
    fetch(`/api/workout-sessions/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, [open, id, accessToken]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return h("div", { className: "pg-drill-backdrop", onClick: onClose },
    h("aside", { className: "pg-drill-panel", onClick: (e) => e.stopPropagation() },
      h("header", { className: "pg-drill-head" },
        h("h2", null, data?.title || "Session detail"),
        h("button", { type: "button", className: "pg-drill-close", onClick: onClose, "aria-label": "Close" }, "×"),
      ),
      loading ? h("p", null, "Loading…")
        : !data ? h("p", null, "Could not load.")
          : h("div", { className: "pg-drill-body" },
              h("p", { className: "pg-drill-meta" }, `${data.modality?.toUpperCase()} · ${new Date(data.started_at).toLocaleString()}`),
              h("p", null, data.note || ""),
              h("h3", null, `Sets · ${(data.sets || []).length}`),
              h("ul", { className: "pg-drill-sets" },
                (data.sets || []).map((s, i) => h("li", { key: s.id || i },
                  `Set ${s.set_number || i + 1}: ${s.load_kg || 0} kg × ${s.reps || 0}${s.rpe ? ` · RPE ${s.rpe}` : ""}`,
                ))),
              h("a", {
                className: "pg-drill-ask",
                href: `/app/?prompt=${encodeURIComponent(`Review my ${data.modality} session from ${new Date(data.started_at).toLocaleDateString()}`)}`,
              }, "Ask Emersus →"),
            ),
    ),
  );
}

function ComingSoon({ title, hint }) {
  return h("section", { className: "pg-soon" },
    h("h3", null, title),
    h("p", null, hint || "Shipping in a follow-up."),
  );
}

function ProgressApp() {
  const [filters, setFilters] = useState(() => parseUrl(window.location.search));
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState({ open: false, kind: null, id: null });
  const accessToken = session?.access_token || "";

  useEffect(() => { requireAuth().then(setSession); }, []);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (filters.modality) params.set("modality", filters.modality);
      if (filters.period) params.set("period", filters.period);
      const res = await fetch(`/api/progress?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message || "Could not load progress.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, filters]);

  useEffect(() => { if (accessToken) load(); }, [accessToken, load]);

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    const url = buildUrl(next);
    window.history.pushState({}, "", url || window.location.pathname);
  };

  if (!session) return h("div", { className: "pg-loading" }, "Loading…");

  return h("div", { className: "pg-shell" },
    h("header", { className: "pg-page-head" },
      h("h1", null, new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })),
      h("p", null, "Your progress at a glance."),
    ),

    h("nav", { className: "pg-modality-tabs" },
      MODALITIES.map((m) => h("button", {
        key: m, type: "button",
        className: `pg-modality-tab${filters.modality === m ? " is-active" : ""}`,
        onClick: () => updateFilter("modality", m),
      }, MODALITY_LABELS[m])),
    ),

    h("nav", { className: "pg-period-pills" },
      PERIODS.map((p) => h("button", {
        key: p, type: "button",
        className: `pg-period-pill${filters.period === p ? " is-active" : ""}`,
        onClick: () => updateFilter("period", p),
      }, p === "3m" ? "3M" : p.charAt(0).toUpperCase() + p.slice(1))),
    ),

    error ? h("p", { className: "pg-error" }, error) : null,
    loading ? h("p", { className: "pg-loading" }, "Loading…") : null,

    !loading && data ? h(React.Fragment, null,
      // Personal records
      data.personal_records && data.personal_records.length
        ? h("section", { className: "pg-section" },
            h("h2", null, "Personal records"),
            h("div", { className: "pg-pr-grid" },
              data.personal_records.map((pr, i) => h(PrCard, { key: pr.id || i, pr })),
            ),
          )
        : null,

      // Streak tracker
      h("section", { className: "pg-section" },
        h("h2", null, "Consistency"),
        h(StreakTracker, { streak: data.streak }),
      ),

      // Coming-soon visualizations
      h("section", { className: "pg-section pg-section-soon-grid" },
        h(ComingSoon, { title: "Lift 1RM progression", hint: "Small multiples for Bench / Squat / Deadlift" }),
        h(ComingSoon, { title: "Working weight range", hint: "8-week vertical bars · current week highlighted" }),
        h(ComingSoon, { title: "Cardio HR zones", hint: "Z1–Z5 stacked bars" }),
        h(ComingSoon, { title: "Training load (acute:chronic)", hint: "Safe-zone band 0.8–1.3 · Gabbett 2016" }),
      ),

      // Recent sessions
      data.recent_sessions && data.recent_sessions.length
        ? h("section", { className: "pg-section" },
            h("h2", null, "Recent sessions"),
            h("ul", { className: "pg-recent-list" },
              data.recent_sessions.map((s) => h(RecentSessionRow, {
                key: s.id, s, onPick: () => setDrill({ open: true, kind: "session", id: s.id }),
              })),
            ),
          )
        : null,

      // Benchmarks (only if any rows seeded)
      data.benchmarks && data.benchmarks.length
        ? h("section", { className: "pg-section" },
            h("h2", null, "Benchmarks"),
            h("ul", { className: "pg-bench-list" },
              data.benchmarks.map((b, i) => h("li", { key: i, className: "pg-bench-row" },
                h("span", { className: "pg-bench-metric" }, b.metric),
                h("span", { className: "pg-bench-range" }, `${b.label} · ${b.low}–${b.high}`),
                h("span", { className: "pg-bench-cite" }, b.source_citation),
              )),
            ),
          )
        : null,
    ) : null,

    h(DrillDownPanel, {
      open: drill.open, kind: drill.kind, id: drill.id,
      accessToken,
      onClose: () => setDrill({ open: false, kind: null, id: null }),
    }),
  );
}

const root = document.getElementById("progress-v2-root");
if (root) createRoot(root).render(h(ProgressApp));
