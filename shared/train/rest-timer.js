// shared/train/rest-timer.js — Phase 3 Train rest timer.
//
// Pure helpers tickRestTimer / formatRestRemaining + a thin React component.

import React from "react";

const { useEffect, useState } = React;
const h = React.createElement;

export function formatRestRemaining(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function computeRemainingSeconds(endsAt, now = Date.now()) {
  if (!endsAt) return 0;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - now) / 1000));
}

export function RestTimer({ endsAt, onSkip, onAdjust }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = computeRemainingSeconds(endsAt, now);

  useEffect(() => {
    if (!endsAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;

  return h("div", { className: "tr-rest-timer", role: "status" },
    h("span", { className: "tr-rest-label" }, "RESTING"),
    h("span", { className: "tr-rest-time" }, formatRestRemaining(remaining)),
    h("button", { type: "button", className: "tr-rest-btn", onClick: () => onAdjust?.({ deltaSeconds: -30 }) }, "−30s"),
    h("button", { type: "button", className: "tr-rest-btn", onClick: () => onAdjust?.({ deltaSeconds: 30 }) }, "+30s"),
    h("button", { type: "button", className: "tr-rest-skip", onClick: onSkip }, "Skip"),
  );
}

export default RestTimer;
