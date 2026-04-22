// app/train/train.js — Phase 3 Train SPA entry.
//
// Modality tabs (Lift / Cardio / Swim / Climb) + sub-tabs (Active / History).
// Mounts the Active panel (lift only for Tasks 2-8; cardio/swim/climb get
// scaffolded placeholders to land in a follow-up).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSession, requireAuth, getProfile } from "/shared/supabase.js";
import { resolveWeightUnit, fromKg } from "/shared/unit-conversion.js";
import { parseTrainUrl, buildTrainUrl, MODALITIES, TABS } from "/shared/chat/url-state.js";
import { SessionHeader } from "/shared/train/session-header.js";
import { LiftActive } from "/shared/train/lift-active.js";
import { RestTimer } from "/shared/train/rest-timer.js";
import { CardioActive } from "/shared/train/cardio-active.js";
import { SwimActive } from "/shared/train/swim-active.js";
import { ClimbActive } from "/shared/train/climb-active.js";
import { ModalityEmptyState } from "/shared/train/modality-empty-state.js";

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

function rpeLevel(rpe) {
  if (rpe == null || rpe === "") return "none";
  const n = parseFloat(rpe);
  if (isNaN(n)) return "none";
  if (n <= 6) return "low";
  if (n <= 7.5) return "med";
  return "high";
}

function groupSetsByExercise(sets) {
  const groups = [];
  const seen = new Map();
  for (const s of sets) {
    const eid = s.exercise_id;
    if (!eid) continue;
    if (seen.has(eid)) {
      seen.get(eid).push(s);
    } else {
      const arr = [s];
      seen.set(eid, arr);
      groups.push({ exerciseId: eid, sets: arr });
    }
  }
  return groups;
}

function findTopSetIndex(sets) {
  let bestIdx = -1;
  let bestLoad = -1;
  let bestReps = -1;
  for (let i = 0; i < sets.length; i++) {
    const load = parseFloat(sets[i].load_kg) || 0;
    const reps = parseInt(sets[i].reps, 10) || 0;
    if (load > bestLoad || (load === bestLoad && reps > bestReps)) {
      bestLoad = load;
      bestReps = reps;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(iso) {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${month} ${day} · ${h12}:${mins} ${ampm}`;
}

function ExercisePickerModal({ open, accessToken, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setQ(""); setItems([]);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = q.trim()
          ? `/api/exercises?q=${encodeURIComponent(q.trim())}&limit=20`
          : `/api/exercises?recent=true&limit=20`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const body = await res.json();
        setItems(body.items || []);
      } catch { setItems([]); }
      finally { setLoading(false); }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, q, accessToken]);
  if (!open) return null;
  return h("div", { className: "tr-modal-backdrop", onClick: onClose },
    h("div", { className: "tr-modal", onClick: (e) => e.stopPropagation() },
      h("header", { className: "tr-modal-head" },
        h("h3", null, "Add exercise"),
        h("button", { type: "button", className: "tr-modal-close", onClick: onClose, "aria-label": "Close" }, "×"),
      ),
      h("input", {
        className: "tr-modal-search",
        type: "search",
        value: q,
        placeholder: "Search exercises…",
        autoFocus: true,
        onChange: (e) => setQ(e.target.value),
      }),
      h("ul", { className: "tr-modal-list" },
        loading ? h("li", { className: "tr-modal-empty" }, "Loading…")
          : items.length ? items.map((ex) => h("li", { key: ex.id },
              h("button", { type: "button", className: "tr-modal-item", onClick: () => onPick(ex) },
                h("span", { className: "tr-modal-item-name" }, ex.name),
                h("span", { className: "tr-modal-item-meta" },
                  [ex.equipment, (ex.muscle_groups || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")),
              )))
            : h("li", { className: "tr-modal-empty" }, q ? "No matches." : "No recent exercises."),
      ),
    ),
  );
}

function FinishSessionSheet({ open, totals, onConfirm, onCancel }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);
  if (!open) return null;
  return h("div", { className: "tr-modal-backdrop", onClick: onCancel },
    h("div", { className: "tr-modal tr-finish-sheet", onClick: (e) => e.stopPropagation() },
      h("header", { className: "tr-modal-head" }, h("h3", null, "Finish session")),
      h("div", { className: "tr-finish-summary" },
        h("div", null, h("span", { className: "tr-metric-label" }, "SETS"), h("span", { className: "tr-metric-value" }, totals?.sets || 0)),
        h("div", null, h("span", { className: "tr-metric-label" }, "VOLUME"), h("span", { className: "tr-metric-value" }, `${Math.round(totals?.volume_kg || 0)} kg`)),
        h("div", null, h("span", { className: "tr-metric-label" }, "DURATION"), h("span", { className: "tr-metric-value" }, totals?.duration || "—")),
      ),
      h("label", { className: "tr-labeled-input" },
        h("span", null, "Note (optional)"),
        h("textarea", { rows: 3, value: note, onChange: (e) => setNote(e.target.value), placeholder: "How did it feel?" }),
      ),
      h("div", { className: "tr-finish-actions" },
        h("button", { type: "button", className: "tr-secondary", disabled: busy, onClick: onCancel }, "Keep editing"),
        h("button", {
          type: "button", className: "tr-primary", disabled: busy,
          onClick: async () => { setBusy(true); await onConfirm(note); setBusy(false); },
        }, busy ? "Saving…" : "Save & finish"),
      ),
    ),
  );
}

// Full-page skeleton while session + modality state boot.
function TrainSkeleton() {
  return h("div", { className: "tr-shell", "aria-busy": "true", "aria-label": "Loading training" },
    h("nav", { className: "tr-modality-tabs skel-row" },
      Array.from({ length: 4 }).map((_, i) =>
        h("span", { key: i, className: "skel skel-pill lg" }))),
    h("nav", { className: "tr-subtabs skel-row" },
      h("span", { className: "skel skel-pill" }),
      h("span", { className: "skel skel-pill" })),
    h("div", { className: "tr-tab-body skel-stack gap-14" },
      h("div", { className: "skel skel-block h-120" }),
      h("div", { className: "skel skel-block h-160" }),
      h("div", { className: "skel skel-block h-120" }),
    ),
  );
}

// History-tab skeleton: three session rows.
function TrainHistorySkeleton() {
  return h("ul", { className: "tr-history-list", "aria-busy": "true", "aria-label": "Loading history" },
    Array.from({ length: 3 }).map((_, i) =>
      h("li", { key: i, className: "tr-history-row" },
        h("div", { className: "skel-stack gap-6", style: { flex: 1 } },
          h("div", { className: "skel skel-line lg w-40" }),
          h("div", { className: "skel skel-line w-60" })),
        h("div", { className: "skel skel-pill lg" }),
      )),
  );
}

function HistoryExpandSkeleton() {
  return h("div", { className: "tr-history-expand-skel" },
    Array.from({ length: 3 }).map((_, i) =>
      h("div", { key: i, className: "tr-history-expand-skel-block" },
        h("div", { className: "skel skel-line lg w-40" }),
        h("div", { className: "skel skel-block h-80" }),
      )),
  );
}

function TrainApp() {
  const [state, setState] = useState(() => parseTrainUrl(window.location.search));
  const { session, ready } = useAuthSession();
  const accessToken = session?.access_token || "";

  useEffect(() => {
    if (!session?.user?.id) return;
    getProfile(session.user.id).then((p) => {
      if (p?.weight_unit) setWeightUnit(resolveWeightUnit(p.weight_unit));
    }).catch(() => {});
  }, [session?.user?.id]);

  const [activeSession, setActiveSession] = useState(null);
  const [activeSets, setActiveSets] = useState([]);
  const [history, setHistory] = useState({ items: [], loading: false });
  const [exerciseLookup, setExerciseLookup] = useState({});
  const [restEndsAt, setRestEndsAt] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDetailCache, setSessionDetailCache] = useState({});
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");

  useEffect(() => {
    const handlePop = () => {
      setState(parseTrainUrl(window.location.search));
      setExpandedSessionId(null);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

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
    setExpandedSessionId(null);
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
    if (!activeSession) { await startNewSession(); return; }
    setPickerOpen(true);
  }, [activeSession, startNewSession]);

  const onPickExercise = useCallback(async (ex) => {
    setPickerOpen(false);
    if (!activeSession || !ex) return;
    const nextExercises = [...(activeSession.exercises || []), { exercise_id: ex.id, planned_sets: 3 }];
    await patchActive({ exercises: nextExercises });
    setExerciseLookup((cur) => ({ ...cur, [ex.id]: ex }));
  }, [activeSession, patchActive]);

  const finishSession = useCallback(() => {
    if (!activeSession) return;
    setFinishOpen(true);
  }, [activeSession]);

  const confirmFinish = useCallback(async (note) => {
    if (!activeSession) return;
    await patchActive({ ended_at: new Date().toISOString(), note: note || null });
    setFinishOpen(false);
    setRestEndsAt(null);
    setActiveSession(null);
    setActiveSets([]);
    setTab("history");
  }, [activeSession, patchActive, setTab]);

  const cancelSession = useCallback(async () => {
    if (!activeSession) return;
    if (!window.confirm("Cancel this session? Logged sets stay in your history but the session marks as canceled.")) return;
    await patchActive({ ended_at: new Date().toISOString(), note: "[canceled]" });
    setActiveSession(null); setActiveSets([]);
  }, [activeSession, patchActive]);

  const expandSession = useCallback(async (sessionId) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(sessionId);
    setExpandError("");
    if (sessionDetailCache[sessionId]) return;
    setExpandLoading(true);
    try {
      const detail = await api(`/api/workout-sessions/${sessionId}`, { accessToken });
      setSessionDetailCache((prev) => ({ ...prev, [sessionId]: detail }));
      const sets = detail.sets || [];
      const exerciseIds = [...new Set(sets.map((s) => s.exercise_id).filter(Boolean))];
      const missing = exerciseIds.filter((id) => !exerciseLookup[id]);
      if (missing.length) {
        try {
          const list = await api(`/api/exercises?recent=true&limit=100`, { accessToken });
          const map = {};
          for (const ex of (list.items || [])) map[ex.id] = ex;
          setExerciseLookup((prev) => ({ ...prev, ...map }));
        } catch {}
      }
    } catch (err) {
      setExpandError(err.message || "Could not load session details.");
    } finally {
      setExpandLoading(false);
    }
  }, [expandedSessionId, sessionDetailCache, accessToken, exerciseLookup]);

  const finishTotals = useMemo(() => {
    const sets = activeSets.length;
    const volume_kg = activeSets.reduce((acc, s) => {
      const reps = Number(s.reps);
      const load = Number(s.load_kg);
      if (!Number.isFinite(load) || Number.isNaN(load)) {
        console.warn("[volume] skipping non-numeric load_kg", s);
        return acc;
      }
      if (!Number.isFinite(reps) || Number.isNaN(reps)) return acc;
      return acc + reps * load;
    }, 0);
    const startedAt = activeSession?.started_at ? new Date(activeSession.started_at).getTime() : Date.now();
    const totalSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const m = Math.floor(totalSec / 60); const s = totalSec % 60;
    return { sets, volume_kg, duration: `${m}m ${s}s` };
  }, [activeSession, activeSets]);

  if (!ready) return h(TrainSkeleton);
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
          activeSession ? null : h(ModalityEmptyState, {
            modality: state.modality,
            onStart: startNewSession,
          }),
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
          activeSession && state.modality === "cardio"
            ? h(CardioActive, { session: activeSession, sets: activeSets, accessToken, onLogged: onSetLogged })
            : null,
          activeSession && state.modality === "swim"
            ? h(SwimActive, { session: activeSession, sets: activeSets, accessToken, onLogged: onSetLogged })
            : null,
          activeSession && state.modality === "climb"
            ? h(ClimbActive, { session: activeSession, sets: activeSets, accessToken, onLogged: onSetLogged })
            : null,
        )
      : h("div", { className: "tr-tab-body" },
          history.loading
            ? h(TrainHistorySkeleton)
            : history.items.length
              ? h("ul", { className: "tr-history-list" },
                  history.items.map((s) => {
                    const isExpanded = expandedSessionId === s.id;
                    const detail = sessionDetailCache[s.id];
                    const sets = detail?.sets || [];
                    const groups = isExpanded && detail ? groupSetsByExercise(sets) : [];
                    const totalSets = sets.length;
                    const totalVolume = sets.reduce((acc, set) => acc + ((parseFloat(set.load_kg) || 0) * (parseInt(set.reps, 10) || 0)), 0);
                    const displayVolume = weightUnit === "lbs" ? Math.round(fromKg(totalVolume, "lbs")) : Math.round(totalVolume);
                    const volLabel = weightUnit === "lbs" ? "lb" : "kg";
                    const duration = formatDuration(s.started_at, s.ended_at);
                    const dateStr = formatDate(s.started_at);
                    const status = s.ended_at ? "" : " · IN PROGRESS";

                    return h("li", {
                      key: s.id,
                      className: `tr-history-row${isExpanded ? " is-expanded" : ""}`,
                      onClick: () => expandSession(s.id),
                    },
                      h("div", { className: "tr-history-header" },
                        h("div", { className: "tr-history-left" },
                          h("div", { className: "tr-history-title" }, s.title || "Untitled session"),
                          h("div", { className: "tr-history-meta-row" },
                            h("span", { className: "tr-history-date" }, `${dateStr}${duration ? ` · ${duration}` : ""}${status}`),
                            (s.exercises || []).length > 0 ? h("span", { className: "tr-history-dot" }, "·") : null,
                            (s.exercises || []).length > 0
                              ? h("span", { className: "tr-history-chip" }, `${(s.exercises || []).length} exercises`)
                              : null,
                            detail && totalSets > 0
                              ? h("span", { className: "tr-history-chip" }, `${totalSets} sets`)
                              : null,
                            detail && totalVolume > 0
                              ? h("span", { className: `tr-history-chip tr-history-chip-vol` }, `${displayVolume.toLocaleString()} ${volLabel}`)
                              : null,
                          ),
                        ),
                        h("span", { className: "tr-history-chevron" }, "›"),
                      ),

                      h("div", { className: "tr-history-body" },
                        h("div", { className: "tr-history-body-inner" },
                        isExpanded && expandLoading && !detail
                          ? h(HistoryExpandSkeleton)
                          : isExpanded && expandError && !detail
                            ? h("div", { className: "tr-history-expand-error", role: "alert" },
                                expandError,
                                h("button", { onClick: (e) => { e.stopPropagation(); setExpandError(""); } }, "✕"),
                              )
                            : isExpanded && detail
                              ? h("div", { className: "tr-history-exercises" },
                                  groups.map((g, gi) => {
                                    const ex = exerciseLookup[g.exerciseId];
                                    const exName = ex?.name || "Unknown exercise";
                                    const topIdx = findTopSetIndex(g.sets);
                                    const topSet = topIdx >= 0 ? g.sets[topIdx] : null;
                                    const topLoad = topSet ? (weightUnit === "lbs" ? Math.round(fromKg(parseFloat(topSet.load_kg) || 0, "lbs")) : Math.round(parseFloat(topSet.load_kg) || 0)) : null;
                                    const topReps = topSet ? (parseInt(topSet.reps, 10) || 0) : 0;
                                    const topSummary = topLoad != null && topLoad > 0
                                      ? `top: ${topLoad} ${volLabel} × ${topReps}`
                                      : topReps > 0 ? `top: ${topReps} reps` : "";

                                    return h(React.Fragment, { key: g.exerciseId },
                                      gi > 0 ? h("hr", { className: "tr-history-ex-divider" }) : null,
                                      h("div", null,
                                        h("div", { className: "tr-history-ex-head" },
                                          h("span", { className: "tr-history-ex-name" }, exName),
                                          topSummary ? h("span", { className: "tr-history-ex-summary" }, topSummary) : null,
                                        ),
                                        g.sets.length === 0
                                          ? h("div", { className: "tr-history-ex-empty" }, "No sets logged")
                                          : h("div", { className: "tr-history-tiles" },
                                              g.sets.map((set, si) => {
                                                const loadKg = parseFloat(set.load_kg) || 0;
                                                const displayLoad = loadKg > 0 ? (weightUnit === "lbs" ? Math.round(fromKg(loadKg, "lbs")) : Math.round(loadKg)) : null;
                                                const reps = parseInt(set.reps, 10) || 0;
                                                const rpe = set.rpe != null && set.rpe !== "" ? parseFloat(set.rpe) : null;
                                                const level = rpeLevel(rpe);
                                                const isTop = si === topIdx;

                                                return h("div", {
                                                  key: set.id || si,
                                                  className: `tr-history-tile${isTop ? " is-top" : ""}`,
                                                  onClick: (e) => e.stopPropagation(),
                                                },
                                                  h("span", { className: "tr-history-tile-num" }, si + 1),
                                                  displayLoad != null
                                                    ? h("div", { className: "tr-history-tile-load" }, displayLoad)
                                                    : (reps > 0 ? h("div", { className: "tr-history-tile-load" }, reps) : null),
                                                  displayLoad != null
                                                    ? h("div", { className: "tr-history-tile-unit" }, volLabel.toUpperCase())
                                                    : (reps > 0 ? h("div", { className: "tr-history-tile-unit" }, "REPS") : null),
                                                  h("div", { className: "tr-history-tile-bottom" },
                                                    displayLoad != null && reps > 0
                                                      ? h("span", { className: "tr-history-tile-reps" }, `× ${reps}`)
                                                      : null,
                                                    rpe != null
                                                      ? h("span", { className: `tr-history-tile-rpe tr-history-tile-rpe-${level}` }, `@${rpe}`)
                                                      : null,
                                                  ),
                                                  h("div", { className: `tr-history-tile-stripe tr-history-tile-stripe-${level}` }),
                                                );
                                              }),
                                            ),
                                      ),
                                    );
                                  }),
                                  detail.note
                                    ? h("div", { className: "tr-history-note" }, `"${detail.note}"`)
                                    : null,
                                )
                              : null,
                        ),
                      ),
                    );
                  }))
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

    h(ExercisePickerModal, {
      open: pickerOpen,
      accessToken,
      onPick: onPickExercise,
      onClose: () => setPickerOpen(false),
    }),
    h(FinishSessionSheet, {
      open: finishOpen,
      totals: finishTotals,
      onConfirm: confirmFinish,
      onCancel: () => setFinishOpen(false),
    }),
  );
}

const root = document.getElementById("train-v2-root");
if (root) createRoot(root).render(h(TrainApp));
