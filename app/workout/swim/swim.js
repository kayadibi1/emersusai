import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildSwimCardData } from "/shared/share-card.js";

const h = React.createElement;

if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

function readQuery() {
  const p = new URLSearchParams(window.location.search);
  return { planId: p.get("plan") || "", sessionId: p.get("session") || "" };
}

function formatTimer(seconds) {
  if (!seconds) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STROKE_CHIPS = [
  { id: "freestyle", label: "Freestyle" },
  { id: "backstroke", label: "Back" },
  { id: "breaststroke", label: "Breast" },
  { id: "butterfly", label: "Fly" },
  { id: "im", label: "IM" },
];

const POOL_CHIPS = [
  { id: 25, label: "25m" },
  { id: 50, label: "50m" },
  { id: 22.86, label: "25yd" },
  { id: 30.48, label: "33⅓yd" },
];

// ── Pre-start ─────────────────────────────────────────────────────

function PreStart({ titleValue, setTitleValue, stroke, setStroke, poolLen, setPoolLen, prescribed, onStart }) {
  return h(
    React.Fragment,
    null,
    h("div", { className: "swim-topbar" },
      h("a", { href: "/app/workout/" }, "← Back"),
      h("span", null, "")
    ),
    h("div", { className: "title-field" },
      h("div", { className: "label" }, "SESSION"),
      h("input", {
        type: "text",
        value: titleValue,
        onChange: (e) => setTitleValue(e.target.value),
      })
    ),
    h("div", { className: "chip-row" },
      STROKE_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${stroke === c.id ? " active" : ""}`,
          onClick: () => setStroke(c.id),
        }, c.label)
      )
    ),
    h("div", { className: "chip-row" },
      POOL_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${poolLen === c.id ? " active" : ""}`,
          onClick: () => setPoolLen(c.id),
        }, c.label)
      )
    ),
    prescribed && h("div", { className: "prescribed" },
      h("div", { className: "label" }, "TARGET"),
      h("div", { className: "target" }, prescribed)
    ),
    h("button", { className: "big-btn", onClick: onStart }, "Start")
  );
}

// ── Live ──────────────────────────────────────────────────────────

function LiveScreen({
  elapsedS, lapCount, poolLen, stroke, splits, paused,
  onTapLap, onUndoLap, onPause, onResume, onFinish,
}) {
  const lastLap = splits.length > 0 ? splits[splits.length - 1] : null;
  const fastestLap = splits.length > 0 ? Math.min(...splits) : null;
  const totalDistance = Math.round(lapCount * poolLen);
  const paceSec100m = totalDistance > 0 ? Math.round((elapsedS * 100) / totalDistance) : null;

  return h(
    React.Fragment,
    null,
    h("div", { className: "swim-topbar-live" },
      h("span", null, formatTimer(elapsedS), " elapsed"),
      h("span", null, `${poolLen}m pool · ${stroke}`)
    ),
    h("div", { className: "lap-big" }, lapCount),
    h("div", { className: "lap-label" }, `LAPS · ${totalDistance}m`),
    h("button", { className: "lap-tap-btn", onClick: onTapLap, disabled: paused }, "TAP FOR LAP"),
    lapCount > 0 && h("button", { className: "lap-undo", onClick: onUndoLap }, "Undo last lap"),
    h("div", { className: "stat-row-swim" },
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, paceSec100m ? formatTimer(paceSec100m) : "--"),
        h("div", { className: "live-stat-label" }, "/100m")
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, lastLap ? `${lastLap}s` : "--"),
        h("div", { className: "live-stat-label" }, "Last lap")
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" }, fastestLap ? `${fastestLap}s` : "--"),
        h("div", { className: "live-stat-label" }, "Fastest")
      )
    ),
    h("div", { className: "swim-btn-row" },
      paused
        ? h("button", { className: "big-btn", style: { margin: 0 }, onClick: onResume }, "Resume")
        : h("button", { className: "secondary-btn", onClick: onPause }, "Pause"),
      h("button", { className: "danger-btn", onClick: onFinish }, "Finish & share")
    )
  );
}

// ── Main component ────────────────────────────────────────────────

const LAP_CAP = 500;

function SwimSessionView({ session: authSession, planRow, sessionIndex, profile }) {
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart");
  const [titleValue, setTitleValue] = useState(targetSession.title || "Swim");
  const [stroke, setStroke] = useState("freestyle");
  const [poolLen, setPoolLen] = useState(profile?.default_pool_length_m || 25);

  const [startedAt, setStartedAt] = useState(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [pauseStart, setPauseStart] = useState(null);
  const [paused, setPaused] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);

  const [lapCount, setLapCount] = useState(0);
  const [lapTimestamps, setLapTimestamps] = useState([]); // ms timestamps of each tap

  const [shareCardData, setShareCardData] = useState(null);

  // Timer
  useEffect(() => {
    if (phase !== "live" || paused || !startedAt) return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsedS(Math.max(0, (now - startedAt - pausedSeconds * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, paused, startedAt, pausedSeconds]);

  // Lap splits derived from timestamps
  const splits = useMemo(() => {
    if (lapTimestamps.length === 0) return [];
    const out = [];
    let prev = startedAt;
    for (const t of lapTimestamps) {
      out.push(Math.round((t - prev) / 1000));
      prev = t;
    }
    return out;
  }, [lapTimestamps, startedAt]);

  const startTracking = useCallback(() => {
    setStartedAt(Date.now());
    setPhase("live");
  }, []);

  const onTapLap = useCallback(() => {
    if (lapCount >= LAP_CAP) return;
    setLapCount((c) => c + 1);
    setLapTimestamps((arr) => [...arr, Date.now()]);
  }, [lapCount]);

  const onUndoLap = useCallback(() => {
    if (lapCount === 0) return;
    setLapCount((c) => c - 1);
    setLapTimestamps((arr) => arr.slice(0, -1));
  }, [lapCount]);

  const onPause = useCallback(() => { setPaused(true); setPauseStart(Date.now()); }, []);
  const onResume = useCallback(() => {
    if (pauseStart) setPausedSeconds((p) => p + Math.round((Date.now() - pauseStart) / 1000));
    setPauseStart(null);
    setPaused(false);
  }, [pauseStart]);

  const onFinish = useCallback(async () => {
    const durationSec = Math.round((Date.now() - startedAt - pausedSeconds * 1000) / 1000);
    const totalDistance = Math.round(lapCount * poolLen);

    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      pool_length_m: poolLen,
      stroke_type: stroke,
      lap_count: lapCount,
      lap_splits: splits,
      total_distance_m: totalDistance,
      duration_seconds: durationSec,
      logged_at: new Date().toISOString(),
      session_notes: "",
    };

    const nextPlan = {
      ...plan,
      sessions: plan.sessions.map((s, idx) => {
        if (idx !== sessionIndex) return s;
        return { ...s, title: titleValue, completion_status: "completed", completed_blocks: [completedBlock] };
      }),
    };

    await applyManualWorkoutPlanEdit(authSession.user.id, planRow.id, nextPlan);
    upsertWorkoutLogs(authSession.user.id, planRow.id, nextPlan, targetSession.id).catch((e) =>
      console.error("[swim] log sync", e)
    );

    const cardData = buildSwimCardData({ title: titleValue }, completedBlock, profile);
    setShareCardData(cardData);
  }, [
    startedAt, pausedSeconds, lapCount, poolLen, stroke, splits, firstBlockId,
    plan, sessionIndex, titleValue, planRow.id, targetSession.id, authSession.user.id, profile,
  ]);

  const onShareClose = useCallback(() => { window.location.href = "/app/workout/"; }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(PreStart, {
      titleValue, setTitleValue, stroke, setStroke, poolLen, setPoolLen,
      prescribed: targetSession.blocks?.[0]?.load || targetSession.blocks?.[0]?.notes || null,
      onStart: startTracking,
    }),
    phase === "live" && h(LiveScreen, {
      elapsedS, lapCount, poolLen, stroke, splits, paused,
      onTapLap, onUndoLap, onPause, onResume, onFinish,
    }),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: {},
      onClose: onShareClose,
    })
  );
}

async function boot() {
  const rootEl = document.getElementById("swim-root");
  if (!rootEl) return;
  const { planId, sessionId } = readQuery();
  if (!planId || !sessionId) { rootEl.innerHTML = '<div style="padding:20px">Missing plan/session.</div>'; return; }
  const session = await requireAuth();
  if (!session) return;
  const planRow = await getWorkoutPlan(planId);
  if (!planRow || planRow.user_id !== session.user.id) { rootEl.innerHTML = '<div style="padding:20px">Not found.</div>'; return; }
  const sessionIndex = (planRow.plan.sessions || []).findIndex((s) => s && s.id === sessionId);
  if (sessionIndex < 0) { rootEl.innerHTML = '<div style="padding:20px">Session not in plan.</div>'; return; }
  const profile = await getProfile(session.user.id);
  const root = createRoot(rootEl);
  root.render(h(SwimSessionView, { session, planRow, sessionIndex, profile }));
}

boot().catch((err) => {
  console.error("[swim] boot failed:", err);
  const el = document.getElementById("swim-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed.</div>';
});
