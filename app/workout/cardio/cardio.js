import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getPublicConfig,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { startGpsTracker, rollingPaceSecPerKm, formatPace } from "/shared/gps-tracker.js";
import { formatDistance, formatPaceUnit, resolveDistanceUnit } from "/shared/unit-conversion.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildCardioCardData } from "/shared/share-card.js";

const h = React.createElement;

// Inject share modal CSS once
if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

// â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function readQuery() {
  const p = new URLSearchParams(window.location.search);
  return { planId: p.get("plan") || "", sessionId: p.get("session") || "" };
}

function formatTimer(seconds) {
  if (seconds == null) seconds = 0;
  const h2 = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h2 > 0) return `${h2}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ACTIVITY_CHIPS = [
  { id: "running", label: "Running" },
  { id: "cycling", label: "Cycling" },
  { id: "walking", label: "Walking" },
  { id: "hiking", label: "Hiking" },
];

// â”€â”€ Pre-start screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PreStart({ session, activityType, setActivityType, titleValue, setTitleValue, onStart }) {
  const prescribed =
    session?.blocks?.[0]?.load ||
    session?.blocks?.[0]?.notes ||
    `${session?.duration_minutes || "?"} min`;

  return h(
    React.Fragment,
    null,
    h("div", { className: "cardio-topbar" },
      h("a", { href: "/app/workout/" }, "â† Back"),
      h("span", null, "")
    ),
    h("div", { className: "title-field" },
      h("div", { className: "label" }, "SESSION"),
      h("input", {
        type: "text",
        value: titleValue,
        onChange: (e) => setTitleValue(e.target.value),
        placeholder: "Session title",
      })
    ),
    h("div", { className: "chip-row" },
      ACTIVITY_CHIPS.map((c) =>
        h("button", {
          key: c.id,
          className: `chip${activityType === c.id ? " active" : ""}`,
          onClick: () => setActivityType(c.id),
        }, c.label)
      )
    ),
    h("div", { className: "prescribed" },
      h("div", { className: "label" }, "PRESCRIBED"),
      h("div", { className: "target" }, prescribed)
    ),
    h("button", { className: "big-btn", onClick: onStart }, "Start")
  );
}

// â”€â”€ Live screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LiveScreen({
  elapsedS, pathLength, totalDistanceM, currentPaceSec, avgPaceSec,
  distanceUnit, gpsState, paused, onPause, onResume, onFinish, gpsDenied,
}) {
  const gpsClass =
    gpsState === "locked" ? "" :
    gpsState === "warn" ? "warn" :
    gpsState === "error" ? "error" : "warn";

  const gpsLabel =
    gpsDenied ? "GPS unavailable" :
    gpsState === "locked" ? `GPS locked Â· ${pathLength} pts` :
    gpsState === "warn" ? "GPS weak" :
    "GPS searching...";

  return h(
    React.Fragment,
    null,
    h("div", { className: "cardio-topbar" },
      h("span", null, paused ? h("span", { style: { color: "var(--danger)" } }, "Paused") : ""),
      h("span", { className: `gps-pill ${gpsClass}` },
        h("span", { className: "gps-dot" }),
        gpsLabel
      )
    ),
    gpsDenied &&
      h("div", { className: "banner" }, "GPS permission denied â€” tracking time only. Switch to the planner to retry with GPS."),
    h("div", { className: "live-timer", style: paused ? { color: "var(--muted)" } : null },
      formatTimer(elapsedS)
    ),
    h("div", { className: "live-timer-label" }, paused ? "Paused" : "Duration"),
    h("div", { className: "live-stat-row" },
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          gpsDenied || totalDistanceM === 0 ? "--" : formatDistance(totalDistanceM, distanceUnit, { decimals: 2 })
        ),
        h("div", { className: "live-stat-label" }, distanceUnit)
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          paused || gpsDenied ? "--" : formatPace(currentPaceSec)
        ),
        h("div", { className: "live-stat-label" }, `/${distanceUnit}`)
      ),
      h("div", { className: "live-stat" },
        h("div", { className: "live-stat-val" },
          gpsDenied ? "--" : formatPace(avgPaceSec)
        ),
        h("div", { className: "live-stat-label" }, "Avg")
      )
    ),
    h("div", { className: "live-btn-row" },
      paused
        ? h("button", { className: "big-btn", style: { margin: 0 }, onClick: onResume }, "Resume")
        : h("button", { className: "secondary-btn", onClick: onPause }, "Pause"),
      h("button", { className: "danger-btn", onClick: onFinish }, paused ? "Finish & share" : "Finish")
    )
  );
}

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CardioSessionView({ session: authSession, planRow, sessionIndex, profile, config }) {
  const planRef = useRef(planRow);
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart"); // prestart | live | finishing
  const [titleValue, setTitleValue] = useState(targetSession.title || "Cardio");
  const [activityType, setActivityType] = useState(
    targetSession.blocks?.[0]?.activity_type || "running"
  );

  // Live state
  const [startedAt, setStartedAt] = useState(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const [pauseStart, setPauseStart] = useState(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [gpsPath, setGpsPath] = useState([]);
  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(null);
  const [gpsState, setGpsState] = useState("searching");
  const [gpsDenied, setGpsDenied] = useState(false);
  const [paused, setPaused] = useState(false);

  const trackerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Share modal state
  const [shareCardData, setShareCardData] = useState(null);
  const [shareCardOpts, setShareCardOpts] = useState(null);

  const distanceUnit = useMemo(
    () => resolveDistanceUnit(profile?.distance_unit),
    [profile]
  );

  // Timer tick
  useEffect(() => {
    if (phase !== "live" || paused || !startedAt) return;
    const id = setInterval(() => {
      const now = Date.now();
      const total = (now - startedAt - pausedSeconds * 1000) / 1000;
      setElapsedS(Math.max(0, total));

      // Rolling pace
      const rp = rollingPaceSecPerKm(gpsPath, 30);
      setCurrentPaceSec(rp);
    }, 1000);
    return () => clearInterval(id);
  }, [phase, paused, startedAt, pausedSeconds, gpsPath]);

  // Avg pace
  const avgPaceSec = useMemo(() => {
    if (!totalDistanceM || totalDistanceM < 5 || !elapsedS) return null;
    return Math.round(elapsedS / (totalDistanceM / 1000));
  }, [totalDistanceM, elapsedS]);

  // Cleanup on unmount: release GPS watcher and wake lock.
  // Covers the "user navigates back / closes tab / reloads mid-session" cases.
  useEffect(() => {
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  const startTracking = useCallback(async () => {
    // Request wake lock
    if ("wakeLock" in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch (_e) {}
    }

    // Start GPS tracker
    trackerRef.current = startGpsTracker({
      onPoint: (point) => {
        setGpsPath((p) => [...p, point]);
        setGpsState("locked");
        setTotalDistanceM(trackerRef.current?.getTotalDistanceM() || 0);
      },
      onError: (err) => {
        if (err?.code === 1) {
          setGpsDenied(true);
          setGpsState("error");
        } else {
          setGpsState("warn");
        }
      },
    });

    setStartedAt(Date.now());
    setPhase("live");
  }, []);

  const onPause = useCallback(() => {
    setPaused(true);
    setPauseStart(Date.now());
    trackerRef.current?.pause();
  }, []);

  const onResume = useCallback(() => {
    if (pauseStart) {
      setPausedSeconds((p) => p + Math.round((Date.now() - pauseStart) / 1000));
    }
    setPauseStart(null);
    setPaused(false);
    trackerRef.current?.resume();
  }, [pauseStart]);

  const onFinish = useCallback(async () => {
    trackerRef.current?.stop();
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch (_e) {}
      wakeLockRef.current = null;
    }

    const durationSec = Math.round(
      (Date.now() - startedAt - pausedSeconds * 1000) / 1000
    );

    // Build completed block
    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      activity_type: activityType,
      gps_path: gpsPath,
      total_distance_m: Math.round(totalDistanceM * 100) / 100,
      duration_seconds: durationSec,
      paused_seconds: pausedSeconds,
      avg_pace_sec_per_km: totalDistanceM > 5 ? Math.round(durationSec / (totalDistanceM / 1000)) : null,
      logged_at: new Date().toISOString(),
      session_notes: "",
    };

    // Update plan
    const nextPlan = {
      ...plan,
      sessions: plan.sessions.map((s, idx) => {
        if (idx !== sessionIndex) return s;
        return {
          ...s,
          title: titleValue,
          completion_status: "completed",
          completed_blocks: [completedBlock],
        };
      }),
    };

    await applyManualWorkoutPlanEdit(authSession.user.id, planRow.id, nextPlan);
    upsertWorkoutLogs(authSession.user.id, planRow.id, nextPlan, targetSession.id).catch((e) =>
      console.error("[cardio] log sync", e)
    );

    // Build share card data
    const cardData = buildCardioCardData(
      { title: titleValue },
      completedBlock,
      profile,
      { mapboxToken: config?.mapboxPublicToken }
    );
    setShareCardData(cardData);
    setShareCardOpts({ mapboxToken: config?.mapboxPublicToken });
  }, [
    startedAt, pausedSeconds, gpsPath, totalDistanceM, activityType, titleValue,
    plan, sessionIndex, firstBlockId, planRow.id, targetSession.id, authSession.user.id, profile, config,
  ]);

  const onShareClose = useCallback(() => {
    window.location.href = "/app/workout/";
  }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(PreStart, {
      session: targetSession,
      activityType,
      setActivityType,
      titleValue,
      setTitleValue,
      onStart: startTracking,
    }),
    phase === "live" && h(LiveScreen, {
      elapsedS,
      pathLength: gpsPath.length,
      totalDistanceM,
      currentPaceSec,
      avgPaceSec,
      distanceUnit,
      gpsState,
      paused,
      gpsDenied,
      onPause,
      onResume,
      onFinish,
    }),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: shareCardOpts,
      onClose: onShareClose,
    })
  );
}

// â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function boot() {
  const rootEl = document.getElementById("cardio-root");
  if (!rootEl) return;

  const { planId, sessionId } = readQuery();
  if (!planId || !sessionId) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Missing plan/session. <a href="/app/workout/">Back</a></div>';
    return;
  }

  const session = await requireAuth();
  if (!session) return;

  const planRow = await getWorkoutPlan(planId);
  if (!planRow) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Plan not found.</div>';
    return;
  }
  if (planRow.user_id !== session.user.id) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Not your plan.</div>';
    return;
  }

  const sessionIndex = (planRow.plan.sessions || []).findIndex((s) => s && s.id === sessionId);
  if (sessionIndex < 0) {
    rootEl.innerHTML = '<div style="padding:20px;color:#a7adb4">Session not found in plan.</div>';
    return;
  }

  const profile = await getProfile(session.user.id);
  let config = null;
  try {
    config = await getPublicConfig();
  } catch (_e) {}

  const root = createRoot(rootEl);
  root.render(h(CardioSessionView, { session, planRow, sessionIndex, profile, config }));
}

boot().catch((err) => {
  console.error("[cardio] boot failed:", err);
  const el = document.getElementById("cardio-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed to load session.</div>';
});
