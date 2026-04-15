// shared/train/swim-active.js — Phase 3 Swim Active panel.
// Lap counter + grid, + Log lap with optional time and stroke.

import React from "react";

const { useCallback, useState } = React;
const h = React.createElement;

const STROKES = ["freestyle", "backstroke", "breaststroke", "butterfly"];

export function SwimActive({ session, sets, accessToken, onLogged }) {
  const [stroke, setStroke] = useState("freestyle");
  const [lapTime, setLapTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const log = useCallback(async () => {
    if (submitting || !session?.id) return;
    setSubmitting(true); setError("");
    try {
      const lookup = await fetch(`/api/exercises?category=swimming&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const { items } = await lookup.json();
      const exerciseId = items?.[0]?.id;
      if (!exerciseId) throw new Error("No swimming exercise in catalog. Seed one.");
      const seconds = parseTime(lapTime);
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          session_id: session.id,
          exercise_id: exerciseId,
          duration_seconds: seconds || null,
          distance_meters: 50,
          notes: stroke,
          detail: { stroke, lap_number: (sets || []).length + 1 },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const { row } = await res.json();
      onLogged?.(row); setLapTime("");
    } catch (err) {
      setError(err.message || "Could not log lap.");
    } finally { setSubmitting(false); }
  }, [submitting, session, accessToken, stroke, lapTime, sets, onLogged]);

  const lapCount = (sets || []).length;
  return h("div", { className: "tr-swim" },
    h("div", { className: "tr-metric-tile tr-metric-tile-wide" },
      h("span", { className: "tr-metric-label" }, "LAPS"),
      h("span", { className: "tr-metric-value" }, `${lapCount}`),
    ),
    h("div", { className: "tr-swim-grid" },
      Array.from({ length: 40 }, (_, i) => h("span", {
        key: i,
        className: `tr-swim-cell${i < lapCount ? " is-done" : ""}${i === lapCount ? " is-current" : ""}`,
      })),
    ),
    h("div", { className: "tr-cardio-form" },
      h("h3", null, "+ Log lap"),
      h("div", { className: "tr-cardio-inputs" },
        h("label", { className: "tr-labeled-input" },
          h("span", null, "Stroke"),
          h("select", { value: stroke, onChange: (e) => setStroke(e.target.value) },
            STROKES.map((s) => h("option", { key: s, value: s }, s.charAt(0).toUpperCase() + s.slice(1))),
          ),
        ),
        h("label", { className: "tr-labeled-input" },
          h("span", null, "Time (mm:ss)"),
          h("input", { type: "text", value: lapTime, placeholder: "0:42", onChange: (e) => setLapTime(e.target.value) }),
        ),
      ),
      h("button", { type: "button", className: "tr-log-btn", disabled: submitting, onClick: log }, submitting ? "Saving…" : "+ Log lap"),
      error ? h("p", { className: "tr-set-error" }, error) : null,
    ),
  );
}

function parseTime(str) {
  if (!str) return 0;
  const parts = String(str).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export default SwimActive;
