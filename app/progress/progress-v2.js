// app/progress/progress-v2.js — Phase 5 Progress v2 SPA entry.
//
// Modality filter (All/Lift/Cardio/Swim/Climb/Nutrition) + period pills
// (Week/Month/3M/Year). Renders 4 sections + 4 coming-soon placeholders.

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { requireAuth, getProfile } from "/shared/supabase.js";
import { resolveWeightUnit } from "/shared/unit-conversion.js";
import { momentumSparkline, beeswarmPlot, zoneRiver, controlChart } from "/shared/progress-charts.js";

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

function MomentumCard({ item, weightUnit = "kg" }) {
  if (!item || !item.current_e1rm_kg) {
    return h("article", { className: "pg-momentum-card" },
      h("div", { className: "pg-momentum-label" }, `${item?.name || "—"} · ${item?.period_weeks || 12} wk`),
      h("div", { className: "pg-momentum-empty" }, `No ${item?.name?.toLowerCase() || "data"} logged yet.`),
    );
  }

  const unit = weightUnit === "lbs" ? "LB" : "KG";
  const displayVal = weightUnit === "lbs"
    ? Math.round(item.current_e1rm_kg * 2.20462)
    : Math.round(item.current_e1rm_kg);

  const badgeClass = `pg-momentum-badge ${item.momentum_label || "flat"}`;
  const momSign = item.momentum_kg > 0 ? "+" : "";
  const momArrow = item.momentum_label === "up" ? "↑"
    : item.momentum_label === "down" ? "↓"
    : "→";
  const momDisplay = weightUnit === "lbs"
    ? Math.round(item.momentum_kg * 2.20462)
    : Math.round(item.momentum_kg * 10) / 10;

  const lastSet = item.last_set;
  const lastSetStr = lastSet
    ? `est. 1RM · last set ${weightUnit === "lbs" ? Math.round(lastSet.load_kg * 2.20462) : Math.round(lastSet.load_kg)}×${lastSet.reps}${lastSet.rpe != null ? ` @${lastSet.rpe}` : ""}`
    : "";

  let benchBlock = null;
  if (item.benchmark && item.benchmark.high_kg > 0) {
    const scaleMax = Math.max(item.benchmark.high_kg * 1.15, item.current_e1rm_kg * 1.05);
    const lowPct = (item.benchmark.low_kg / scaleMax) * 100;
    const highPct = (item.benchmark.high_kg / scaleMax) * 100;
    const dotPct = Math.min(100, (item.current_e1rm_kg / scaleMax) * 100);
    benchBlock = h("div", { className: "pg-momentum-bench" },
      h("div", { className: "pg-momentum-bench-bar" },
        h("div", { className: "pg-momentum-bench-range", style: { left: `${lowPct}%`, width: `${highPct - lowPct}%` } }),
        h("div", { className: "pg-momentum-bench-dot", style: { left: `${dotPct}%` } }),
      ),
      h("span", { className: "pg-momentum-bench-text" }, (item.benchmark.level || "intermediate").toUpperCase()),
    );
  }

  return h("article", { className: "pg-momentum-card" },
    h("div", { className: "pg-momentum-label" }, `${item.name} · ${item.period_weeks} wk`),
    h("div", { className: "pg-momentum-hero" },
      h("span", { className: "pg-momentum-num" }, displayVal),
      h("span", { className: "pg-momentum-unit" }, unit),
    ),
    lastSetStr ? h("div", { className: "pg-momentum-sub" }, lastSetStr) : null,
    h("div", {
      style: { position: "absolute", bottom: 0, left: 0, right: 0, height: "70%", opacity: 0.20, zIndex: 1, pointerEvents: "none" },
      dangerouslySetInnerHTML: { __html: momentumSparkline(item.sparkline || [], item.pr_weeks || []) },
    }),
    h("div", { className: badgeClass }, `${momSign}${momDisplay} ${unit} ${momArrow} ${item.period_weeks} WK`),
    benchBlock,
  );
}

function MomentumCards({ data, weightUnit = "kg" }) {
  const items = data?.momentum_cards?.items || [];
  if (!items.length) return null;
  return h("section", { className: "pg-section" },
    h("h2", null, "Strength trajectory"),
    h("div", { className: "pg-momentum-grid" },
      items.map((it) => h(MomentumCard, { key: it.slug, item: it, weightUnit })),
    ),
  );
}

function BeeswarmPlot({ data, weightUnit = "kg" }) {
  const bee = data?.beeswarm;
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  React.useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 600); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!bee || !bee.sets || bee.sets.length < 5) {
    return null;
  }

  const svg = beeswarmPlot(bee, { weightUnit, mobile: isMobile });
  const unit = weightUnit === "lbs" ? "LOAD (LB)" : "LOAD (KG)";

  return h("section", { className: "pg-section" },
    h("h2", null, "Working weight distribution"),
    h("div", { className: "pg-beeswarm-card" },
      h("div", { className: "pg-beeswarm-head" },
        h("div", null,
          h("div", { className: "pg-beeswarm-title" }, `${bee.exercise_name} · every set logged`),
          h("div", { className: "pg-beeswarm-sub" }, `${bee.weeks} WEEKS · ${bee.total_sets} SETS · ${unit}`),
        ),
      ),
      h("div", { dangerouslySetInnerHTML: { __html: svg } }),
      h("div", { className: "pg-beeswarm-note" },
        h("span", { className: "pg-beeswarm-note-dot" }),
        h("span", null, "Loads drifting up-and-right = progressive overload working"),
      ),
    ),
  );
}

function ZoneRiver({ data }) {
  const zr = data?.zone_river;
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  React.useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 600); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!zr || !zr.weeks || zr.weeks.length === 0) return null;

  const svg = zoneRiver(zr, { mobile: isMobile });

  return h("section", { className: "pg-section" },
    h("h2", null, "Heart rate zones"),
    h("div", { className: "pg-zone-river-card" },
      h("div", { className: "pg-zone-river-head" },
        h("div", null,
          h("div", { className: "pg-zone-river-title" }, "Zone distribution"),
          h("div", { className: "pg-zone-river-sub" }, `${zr.weeks.length} WEEKS · TIME IN ZONE`),
        ),
        h("span", { className: "pg-zone-pattern" }, zr.pattern_label),
      ),
      h("div", { dangerouslySetInnerHTML: { __html: svg } }),
      h("div", { className: "pg-zone-legend" },
        h("div", { className: "pg-zone-legend-item" }, h("span", { className: "pg-zone-legend-swatch", style: { background: "var(--z1)" } }), "Z1 · Recovery"),
        h("div", { className: "pg-zone-legend-item" }, h("span", { className: "pg-zone-legend-swatch", style: { background: "var(--z2)" } }), "Z2 · Endurance"),
        h("div", { className: "pg-zone-legend-item" }, h("span", { className: "pg-zone-legend-swatch", style: { background: "var(--z3)" } }), "Z3 · Tempo"),
        h("div", { className: "pg-zone-legend-item" }, h("span", { className: "pg-zone-legend-swatch", style: { background: "var(--z4)" } }), "Z4 · Threshold"),
        h("div", { className: "pg-zone-legend-item" }, h("span", { className: "pg-zone-legend-swatch", style: { background: "var(--z5)" } }), "Z5 · VO2"),
      ),
      zr.hr_estimate_note ? h("div", { className: "pg-zone-estimate-note" }, zr.hr_estimate_note) : null,
    ),
  );
}

function ControlChart({ data }) {
  const cc = data?.control_chart;
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  React.useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 600); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!cc) {
    return h("section", { className: "pg-section" },
      h("h2", null, "Training load"),
      h("div", { className: "pg-control-card" },
        h("div", { className: "pg-control-placeholder" },
          "Need 4+ weeks of training to compute your training load. ",
          h("a", { href: "/app/train/" }, "Log a session →"),
        ),
      ),
    );
  }

  const svg = controlChart(cc, { mobile: isMobile });
  const statusColor = cc.status === "out_of_control" ? "var(--danger)"
    : cc.status === "elevated" ? "var(--warning)"
    : "var(--success, #15803d)";
  const statusLabel = cc.status === "out_of_control" ? "Out of control"
    : cc.status === "elevated" ? "Elevated"
    : "In control";

  return h("section", { className: "pg-section" },
    h("h2", null, "Training load"),
    h("div", { className: "pg-control-card" },
      h("div", { className: "pg-control-head" },
        h("div", null,
          h("div", { className: "pg-control-title" }, "Acute:chronic workload ratio"),
          h("div", { className: "pg-control-sub" }, `${cc.weeks.length} WEEKS · WITH CONTROL LIMITS`),
        ),
      ),
      h("div", { dangerouslySetInnerHTML: { __html: svg } }),
      h("div", { className: "pg-control-stats" },
        h("div", null,
          h("div", { className: "pg-control-stat-label" }, "Current"),
          h("div", { className: "pg-control-stat-value" }, cc.current_acwr != null ? cc.current_acwr.toFixed(2) : "—"),
        ),
        h("div", null,
          h("div", { className: "pg-control-stat-label" }, `${cc.weeks.length} wk mean`),
          h("div", { className: "pg-control-stat-value" }, cc.mean_acwr != null ? cc.mean_acwr.toFixed(2) : "—"),
        ),
        h("div", null,
          h("div", { className: "pg-control-stat-label" }, "Excursions"),
          h("div", { className: "pg-control-stat-value", style: { color: cc.excursions > 0 ? "var(--danger)" : "var(--ink)" } }, cc.excursions),
        ),
        h("div", null,
          h("div", { className: "pg-control-stat-label" }, "Status"),
          h("div", { className: "pg-control-stat-value status", style: { color: statusColor } }, statusLabel),
        ),
      ),
      h("div", { className: "pg-control-citation" }, "GABBETT · BR J SPORTS MED · 2016"),
    ),
  );
}

function ComingSoon({ title, hint }) {
  return h("section", { className: "pg-soon" },
    h("h3", null, title),
    h("p", null, hint || "Shipping in a follow-up."),
  );
}

// Skeleton shown before auth session is ready.
function ProgressSkeleton() {
  return h("div", { className: "pg-shell", "aria-busy": "true", "aria-label": "Loading progress" },
    h("header", { className: "pg-page-head skel-stack gap-6" },
      h("div", { className: "skel skel-line xl w-40" }),
      h("div", { className: "skel skel-line w-55" }),
    ),
    h("nav", { className: "pg-modality-tabs skel-row wrap" },
      Array.from({ length: 4 }).map((_, i) =>
        h("span", { key: i, className: "skel skel-pill lg" }))),
    h("nav", { className: "pg-period-pills skel-row wrap" },
      Array.from({ length: 4 }).map((_, i) =>
        h("span", { key: i, className: "skel skel-pill" }))),
    h(ProgressBodySkeleton),
  );
}

// Body-only skeleton (when the period/modality tabs are real but data is fetching).
function ProgressBodySkeleton() {
  return h("div", { className: "pg-body-skeleton skel-stack gap-20", "aria-busy": "true" },
    // Personal records: 4 cards
    h("section", { className: "pg-section skel-stack gap-14" },
      h("div", { className: "skel skel-line lg w-25" }),
      h("div", { className: "pg-pr-grid skel-row wrap" },
        Array.from({ length: 4 }).map((_, i) =>
          h("div", { key: i, className: "skel skel-block h-120", style: { flex: "1 1 180px", minWidth: 180 } }))),
    ),
    // Streak + fuel gauge row
    h("section", { className: "pg-section skel-stack gap-14" },
      h("div", { className: "skel skel-line lg w-20" }),
      h("div", { className: "skel skel-block h-160" }),
    ),
    // Recent sessions
    h("section", { className: "pg-section skel-stack gap-14" },
      h("div", { className: "skel skel-line lg w-30" }),
      Array.from({ length: 3 }).map((_, i) =>
        h("div", { key: i, className: "skel skel-block h-60" })),
    ),
  );
}

function ProgressApp() {
  const [filters, setFilters] = useState(() => parseUrl(window.location.search));
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState({ open: false, kind: null, id: null });
  const [weightUnit, setWeightUnit] = useState("kg");
  const accessToken = session?.access_token || "";

  useEffect(() => { requireAuth().then(setSession); }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    getProfile(session.user.id).then((p) => {
      if (p?.weight_unit) setWeightUnit(resolveWeightUnit(p.weight_unit));
    }).catch(() => {});
  }, [session?.user?.id]);

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

  if (!session) return h(ProgressSkeleton);

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
    loading ? h(ProgressBodySkeleton) : null,

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

      // Momentum cards (replaces the 1RM ComingSoon)
      h(MomentumCards, { data, weightUnit }),
      h(BeeswarmPlot, { data, weightUnit }),
      h(ZoneRiver, { data }),
      h(ControlChart, { data }),

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
