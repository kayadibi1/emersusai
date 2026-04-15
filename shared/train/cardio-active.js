// shared/train/cardio-active.js — Phase 3 Cardio Active panel.
//
// 4 metric tiles (Distance / Pace / HR / Time) + manual entry on Finish.
// Persists each lap/segment via POST /api/sets with detail.activity_type=cardio.

import React from "react";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

function formatPace(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "—";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}
function formatDuration(s) {
  if (!Number.isFinite(s) || s <= 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function CardioActive({ session, sets, accessToken, onLogged }) {
  const [distanceKm, setDistanceKm] = useState("");
  const [duration, setDuration] = useState("");
  const [hr, setHr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const totals = (sets || []).reduce(
    (acc, s) => {
      acc.distance += Number(s.distance_meters) || 0;
      acc.duration += Number(s.duration_seconds) || 0;
      if (s.avg_heart_rate) {
        acc.hrSum += s.avg_heart_rate;
        acc.hrCount += 1;
      }
      return acc;
    },
    { distance: 0, duration: 0, hrSum: 0, hrCount: 0 },
  );
  const avgHr = totals.hrCount ? Math.round(totals.hrSum / totals.hrCount) : null;
  const pace = totals.distance > 0 ? totals.duration / (totals.distance / 1000) : null;

  const log = useCallback(async () => {
    if (submitting) return;
    if (!session?.id) return;
    setSubmitting(true); setError("");
    try {
      // Cardio uses a synthetic exercise stub. Reuse 'cardio_session' slug if it
      // exists, else fall back to the first cardio exercise from the catalog.
      const lookup = await fetch(`/api/exercises?category=cardio&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const { items } = await lookup.json();
      const exerciseId = items?.[0]?.id;
      if (!exerciseId) throw new Error("No cardio exercise in catalog. Seed one or pick from Lift.");

      const km = Number(distanceKm);
      const dur = parseDuration(duration);
      if (!km && !dur) { setError("Enter at least distance or duration."); setSubmitting(false); return; }

      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          session_id: session.id,
          exercise_id: exerciseId,
          distance_meters: Number.isFinite(km) ? km * 1000 : null,
          duration_seconds: dur || null,
          notes: hr ? `HR ${hr}` : null,
          detail: hr ? { avg_heart_rate: Number(hr) } : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const { row } = await res.json();
      onLogged?.(row);
      setDistanceKm(""); setDuration(""); setHr("");
    } catch (err) {
      setError(err.message || "Could not log segment.");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, session, accessToken, distanceKm, duration, hr, onLogged]);

  return h("div", { className: "tr-cardio" },
    h("div", { className: "tr-cardio-tiles" },
      h(MetricTile, { label: "DISTANCE", value: `${(totals.distance / 1000).toFixed(2)} km` }),
      h(MetricTile, { label: "PACE",     value: formatPace(pace) }),
      h(MetricTile, { label: "HR (AVG)", value: avgHr ? `${avgHr} bpm` : "—" }),
      h(MetricTile, { label: "TIME",     value: formatDuration(totals.duration) }),
    ),
    h("div", { className: "tr-cardio-form" },
      h("h3", null, "+ Log segment"),
      h("div", { className: "tr-cardio-inputs" },
        h(LabeledInput, { label: "Distance (km)", value: distanceKm, onChange: setDistanceKm, placeholder: "5.0", type: "number" }),
        h(LabeledInput, { label: "Duration (mm:ss)", value: duration, onChange: setDuration, placeholder: "28:30" }),
        h(LabeledInput, { label: "Avg HR", value: hr, onChange: setHr, placeholder: "145", type: "number" }),
      ),
      h("button", { type: "button", className: "tr-log-btn", disabled: submitting, onClick: log }, submitting ? "Saving…" : "Log segment"),
      error ? h("p", { className: "tr-set-error" }, error) : null,
    ),
  );
}

function MetricTile({ label, value }) {
  return h("div", { className: "tr-metric-tile" },
    h("span", { className: "tr-metric-label" }, label),
    h("span", { className: "tr-metric-value" }, value),
  );
}

function LabeledInput({ label, value, onChange, placeholder, type = "text" }) {
  return h("label", { className: "tr-labeled-input" },
    h("span", null, label),
    h("input", { type, value, placeholder, onChange: (e) => onChange(e.target.value) }),
  );
}

function parseDuration(str) {
  if (!str) return 0;
  const parts = String(str).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 1) return parts[0]; // seconds
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export default CardioActive;
