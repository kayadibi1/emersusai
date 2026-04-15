// app/train/train.js — Phase 3 Train SPA entry.
//
// Modality tabs (Lift / Cardio / Swim / Climb) + sub-tabs (Active / History).
// Mounts the Active panel (lift only for Tasks 2-8; cardio/swim/climb get
// scaffolded placeholders to land in a follow-up).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSession, requireAuth } from "/shared/supabase.js";
import { parseTrainUrl, buildTrainUrl, MODALITIES, TABS } from "/shared/chat/url-state.js";
import { SessionHeader } from "/shared/train/session-header.js";
import { LiftActive } from "/shared/train/lift-active.js";
import { RestTimer } from "/shared/train/rest-timer.js";

const h = React.createElement;
const MODALITY_LABELS = { lift: "Lift", cardio: "Cardio", swim: "Swim", climb: "Climb" };

function useAuthSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    requireAuth().then((s) => { setSession(s); setReady(true); });
  }, []);
  return { session, ready };
}

async function api(path, { method = "GET", body, accessToken } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function TrainApp() {
  const [state, setState] = useState(() => parseTrainUrl(window.location.search));
  const { session, ready } = useAuthSession();
  const accessToken = session?.access_token || "";

  const [activeSession, setActiveSession] = useState(null);
  const [activeSets, setActiveSets] = useState([]);
  const [history, setHistory] = useState({ items: [], loading: false });
  const [exerciseLookup, setExerciseLookup] = useState({});
  const [restEndsAt, setRestEndsAt] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState("");

  const updateUrl = useCallback((next) => {
    const url = buildTrainUrl(next);
    const target = url || window.location.pathname;
    window.history.pushState({}, "", target);
  }, []);

  const setModality = useCallback((modality) => {
    if (!MODALITIES.includes(modality)) return;
    const next = { ...state, modality, sessionId: "" };
    setState(next); updateUrl(next);
    setActiveSession(null); setActiveSets([]);
  }, [state, updateUrl]);

  const setTab = useCallback((tab) => {
    if (!TABS.includes(tab)) return;
    const next = { ...state, tab };
    setState(next); updateUrl(next);
  }, [state, updateUrl]);

  // Load the most-recent in-progress session for the modality whenever
  // modality changes or on first ready.
  useEffect(() => {
    if (!ready || !accessToken || state.tab !== "active") return;
    (async () => {
      try {
        const list = await api(`/api/workout-sessions?modality=${state.modality}&limit=10`, { accessToken });
        const live = (list.items || []).find((s) => !s.ended_at);
        if (live) {
          const detail = await api(`/api/workout-sessions/${live.id}`, { accessToken });
          setActiveSession(detail);
          setActiveSets(detail.sets || []);
          await hydrateExerciseLookup(detail.exercises || [], accessToken);
        } else {
          setActiveSession(null);
          setActiveSets([]);
        }
      } catch (err) {
        setError(err.message || "Could not load active session.");
      }
    })();
  }, [ready, accessToken, state.modality, state.tab]);

  // Load history list on tab=history.
  useEffect(() => {
    if (!ready || !accessToken || state.tab !== "history") return;
    (async () => {
      setHistory({ items: [], loading: true });
      try {
        const list = await api(`/api/workout-sessions?modality=${state.modality}&limit=50`, { accessToken });
        setHistory({ items: list.items || [], loading: false });
      } catch (err) {
        setHistory({ items: [], loading: false });
        setError(err.message || "Could not load history.");
      }
    })();
  }, [ready, accessToken, state.modality, state.tab]);

  async function hydrateExerciseLookup(entries, token) {
    const ids = (entries || []).map((e) => e.exercise_id).filter(Boolean);
    if (!ids.length) return;
    try {
      const list = await api(`/api/exercises?recent=true&limit=${Math.min(ids.length + 10, 50)}`, { accessToken: token });
      const map = {};
      for (const ex of (list.items || [])) map[ex.id] = ex;
      setExerciseLookup((prev) => ({ ...prev, ...map }));
    } catch { /* non-fatal */ }
  }

  const startNewSession = useCallback(async () => {
    if (!accessToken) return;
    setAutoSaving(true);
    try {
      const session = await api("/api/workout-sessions", {
        method: "POST", accessToken,
        body: { modality: state.modality, exercises: [] },
      });
      setActiveSession({ ...session, sets: [] });
      setActiveSets([]);
      updateUrl({ ...state, sessionId: session.id, tab: "active" });
    } catch (err) {
      setError(err.message || "Could not start session.");
    } finally {
      setAutoSaving(false);
    }
  }, [accessToken, state, updateUrl]);

  const patchActive = useCallback(async (patch) => {
    if (!activeSession?.id || !accessToken) return;
    setAutoSaving(true);
    try {
      const next = await api(`/api/workout-sessions/${activeSession.id}`, {
        method: "PATCH", accessToken, body: patch,
      });
      setActiveSession((cur) => ({ ...cur, ...next }));
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setAutoSaving(false);
    }
  }, [activeSession, accessToken]);

  const onSetLogged = useCallback((row) => {
    setActiveSets((cur) => [...cur, row]);
  }, []);

  const onAddExercise = useCallback(async () => {
    if (!activeSession) {
      // No session yet — start one then prompt.
      await startNewSession();
      return;
    }
    const slug = window.prompt("Exercise slug or name:", "back-squat");
    if (!slug) return;
    try {
      const list = await api(`/api/exercises?q=${encodeURIComponent(slug)}&limit=5`, { accessToken });
      const ex = (list.items || [])[0];
      if (!ex) {
        setError("No matching exercise.");
        return;
      }
      const nextExercises = [...(activeSession.exercises || []), { exercise_id: ex.id, planned_sets: 3 }];
      await patchActive({ exercises: nextExercises });
      setExerciseLookup((cur) => ({ ...cur, [ex.id]: ex }));
    } catch (err) {
      setError(err.message || "Could not add exercise.");
    }
  }, [activeSession, accessToken, patchActive, startNewSession]);

  const finishSession = useCallback(async () => {
    if (!activeSession) return;
    const note = window.prompt("Optional finish note:", "") || "";
    await patchActive({ ended_at: new Date().toISOString(), note });
    setRestEndsAt(null);
    setActiveSession(null);
    setActiveSets([]);
    setTab("history");
  }, [activeSession, patchActive, setTab]);

  const cancelSession = useCallback(async () => {
    if (!activeSession) return;
    if (!window.confirm("Cancel this session? Logged sets will remain in your history but the session marks as canceled.")) return;
    await patchActive({ ended_at: new Date().toISOString(), note: "[canceled]" });
    setActiveSession(null); setActiveSets([]);
  }, [activeSession, patchActive]);

  if (!ready) return h("div", { className: "tr-loading" }, "Loading…");
  if (!session) return h("div", { className: "tr-loading" }, "Sign in required.");

  const setsBySession = activeSession ? { [activeSession.id]: activeSets } : {};

  return h("div", { className: "tr-shell" },
    h("nav", { className: "tr-modality-tabs", "aria-label": "Modality" },
      MODALITIES.map((m) => h("button", {
        key: m, type: "button",
        className: `tr-modality-tab${state.modality === m ? " is-active" : ""}`,
        onClick: () => setModality(m),
      }, MODALITY_LABELS[m])),
    ),

    activeSession
      ? h(SessionHeader, {
          session: activeSession,
          autoSaving,
          onRename: (title) => patchActive({ title }),
          onEndSession: finishSession,
          onCancelSession: cancelSession,
        })
      : null,

    h("nav", { className: "tr-subtabs", "aria-label": "Section" },
      TABS.map((t) => h("button", {
        key: t, type: "button",
        className: `tr-subtab${state.tab === t ? " is-active" : ""}`,
        onClick: () => setTab(t),
      }, t === "active" ? "Active" : "History")),
    ),

    state.tab === "active"
      ? h("div", { className: "tr-tab-body" },
          activeSession ? null : h("div", { className: "tr-empty-state" },
            h("p", null, `No active ${MODALITY_LABELS[state.modality].toLowerCase()} session.`),
            h("button", { type: "button", className: "tr-primary", onClick: startNewSession }, `Start a ${MODALITY_LABELS[state.modality].toLowerCase()} session`),
          ),
          activeSession && state.modality === "lift"
            ? h(LiftActive, {
                session: activeSession,
                setsBySession,
                exerciseLookup,
                accessToken,
                onSetLogged,
                onAddExercise,
                onRestStart: setRestEndsAt,
              })
            : null,
          activeSession && state.modality !== "lift"
            ? h("div", { className: "tr-modality-placeholder" },
                h("p", null, `${MODALITY_LABELS[state.modality]} active panel — coming in a follow-up.`),
                h("p", null, "For now, log sets via the API or via the legacy /app/workout pages."),
              )
            : null,
        )
      : h("div", { className: "tr-tab-body" },
          history.loading
            ? h("p", { className: "tr-loading" }, "Loading…")
            : history.items.length
              ? h("ul", { className: "tr-history-list" },
                  history.items.map((s) => h("li", { key: s.id, className: "tr-history-row" },
                    h("div", { className: "tr-history-title" }, s.title || "Untitled session"),
                    h("div", { className: "tr-history-meta" },
                      new Date(s.started_at).toLocaleString(),
                      " · ",
                      s.ended_at ? "FINISHED" : "IN PROGRESS",
                    ),
                  )))
              : h("p", { className: "tr-empty-state" }, "No history yet."),
        ),

    h("footer", { className: "tr-bottom-bar" },
      restEndsAt
        ? h(RestTimer, {
            endsAt: restEndsAt,
            onSkip: () => setRestEndsAt(null),
            onAdjust: ({ deltaSeconds }) => {
              const cur = new Date(restEndsAt).getTime();
              const next = cur + deltaSeconds * 1000;
              if (next <= Date.now()) setRestEndsAt(null);
              else setRestEndsAt(new Date(next).toISOString());
            },
          })
        : h("span", { className: "tr-bottom-idle" },
            activeSession ? `READY FOR SET ${activeSets.length + 1}` : "NO ACTIVE SESSION"),
      h("div", { className: "tr-bottom-actions" },
        activeSession
          ? h("button", { type: "button", className: "tr-primary", onClick: finishSession }, "Finish session")
          : null,
      ),
    ),

    error ? h("div", { className: "tr-error", role: "alert" }, error, " ", h("button", { onClick: () => setError("") }, "✕")) : null,
  );
}

window.addEventListener("popstate", () => {
  // Soft refresh on browser nav.
  // The component reads URL on mount; for popstate just reload to keep code simple.
  window.location.reload();
});

const root = document.getElementById("train-v2-root");
if (root) createRoot(root).render(h(TrainApp));
