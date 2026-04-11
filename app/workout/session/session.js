// Mobile session view — Phase 1.5 of the workout planner.
//
// Reads ?plan=<planId>&session=<sessionId> from the URL, loads the
// plan, finds the requested session, and renders one block at a time
// with set logging inputs, a rest timer, and a session-level finish
// button. Writes the user's logged actuals back into Supabase via the
// existing applyManualWorkoutPlanEdit helper, debounced.
//
// Design notes:
//   - One block on screen at a time. Prev/Next nav between blocks.
//     Warmup blocks come first, then working blocks. Within a block
//     the user logs every set.
//   - Rest timer: starts on Done, counts down from prescribed
//     rest_seconds (default 90). Beeps at 0 via Web Audio. Float pill
//     at the bottom. Tap to skip. Timer state is browser-memory only.
//   - Autosave: 800ms debounced. Manual "Save & close" button bypasses
//     the debounce. We also flush on unmount.
//   - Block IDs: pre-1.5 plans don't have them. ensureBlockIds runs
//     on every load (free, idempotent) so the saved plan auto-heals
//     the first time anything is logged.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import {
  resolveWeightUnit,
  fromKg,
  toKg,
  displayLoadString,
} from "/shared/unit-conversion.js";
import {
  COMPLETED_BLOCK_SCHEMA_VERSION,
  createEmptyActualSet,
  ensureBlockIds,
} from "/shared/workout-plan-schema.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildGymCardData } from "/shared/share-card.js";

if (!document.getElementById("share-modal-css")) {
  const style = document.createElement("style");
  style.id = "share-modal-css";
  style.textContent = SHARE_MODAL_CSS;
  document.head.appendChild(style);
}

const h = React.createElement;

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function readQueryParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      planId: params.get("plan") || "",
      sessionId: params.get("session") || "",
    };
  } catch (_err) {
    return { planId: "", sessionId: "" };
  }
}

// ---------------------------------------------------------------------------
// Web Audio beep (no file dependency)
// ---------------------------------------------------------------------------

let cachedAudioContext = null;
function getAudioContext() {
  if (cachedAudioContext) return cachedAudioContext;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    cachedAudioContext = new Ctor();
    return cachedAudioContext;
  } catch (_err) {
    return null;
  }
}
function playBeep({ frequency = 880, duration = 220, volume = 0.18 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    // Quick fade so it doesn't click on stop.
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
    osc.stop(ctx.currentTime + duration / 1000 + 0.05);
  } catch (_err) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

// Build a flat ordered list of blocks: warmups first, then working sets.
// Each entry carries a `kind` so the UI can label it accordingly.
function flattenBlocks(session) {
  const out = [];
  const warmups = Array.isArray(session?.warmup_blocks) ? session.warmup_blocks : [];
  for (const b of warmups) {
    if (b && typeof b === "object") out.push({ kind: "warmup", block: b });
  }
  const working = Array.isArray(session?.blocks) ? session.blocks : [];
  for (const b of working) {
    if (b && typeof b === "object") out.push({ kind: "working", block: b });
  }
  return out;
}

// Find the existing logged entry for a block id, or null. Used to
// hydrate the inputs from previously-saved actuals on refresh.
function findCompletedBlock(session, blockId) {
  if (!session || !Array.isArray(session.completed_blocks)) return null;
  return session.completed_blocks.find((entry) => entry && entry.block_id === blockId) || null;
}

// Initialize the local state for a block: either rehydrate from saved
// actuals or create N empty rows from the prescribed sets count.
// Load values are stored in kg canonical; convert to the user's unit for display.
function initActualSets(prescribedBlock, savedEntry, weightUnit = "kg") {
  if (savedEntry && Array.isArray(savedEntry.actual_sets) && savedEntry.actual_sets.length > 0) {
    return savedEntry.actual_sets.map((s) => {
      // Stored load is kg canonical (since weight_unit introduced).
      // Convert to the user's display unit for the input field.
      const loadKgNum = s?.load != null && s.load !== "" ? parseFloat(s.load) : null;
      const loadDisplay = loadKgNum != null && !isNaN(loadKgNum)
        ? String(Math.round(fromKg(loadKgNum, weightUnit) * 10) / 10).replace(/\.0$/, "")
        : "";
      return {
        reps: s?.reps != null ? String(s.reps) : "",
        load: loadDisplay,
        rpe: s?.rpe != null ? String(s.rpe) : "",
        notes: s?.notes ? String(s.notes) : "",
        done: Boolean(s?.done),
      };
    });
  }
  const count = Math.max(1, Math.floor(Number(prescribedBlock?.sets) || 1));
  return Array.from({ length: count }, () => ({
    ...createEmptyActualSet(prescribedBlock),
    rpe: "",
    done: false,
  }));
}

// Convert local state back into the persistable shape used by the
// completed_blocks array. Strips empty trailing rows so we don't
// store noise, but keeps any row the user touched.
// User-typed load values are converted from their unit to kg canonical before storage.
function serializeBlockEntry(blockId, localSets, blockNotes, weightUnit = "kg") {
  const trimmed = localSets.filter((set) => {
    return set.reps !== "" || set.load !== "" || set.rpe !== "" || set.notes !== "" || set.done;
  });
  return {
    block_id: blockId,
    schema_version: COMPLETED_BLOCK_SCHEMA_VERSION,
    actual_sets: trimmed.map((set) => {
      // Canonicalize load to kg before storing
      let loadKg = "";
      if (set.load !== "" && set.load != null) {
        const num = parseFloat(set.load);
        if (!isNaN(num)) {
          const kgValue = toKg(num, weightUnit);
          loadKg = String(Math.round(kgValue * 100) / 100);
        }
      }
      return {
        reps: set.reps,
        load: loadKg,
        rpe: set.rpe === "" ? null : set.rpe,
        notes: set.notes,
        done: Boolean(set.done),
      };
    }),
    session_notes: blockNotes || "",
    logged_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gym summary for share card
// ---------------------------------------------------------------------------

function computeGymSummary(session) {
  const completed = session.completed_blocks || [];
  let totalVolumeKg = 0;
  let setCount = 0;
  const exerciseMap = new Map();

  for (const cb of completed) {
    const block = (session.blocks || []).find((b) => b.id === cb.block_id);
    if (!block) continue;
    const name = block.name || "Exercise";
    let best = { loadKg: 0, reps: 0 };
    for (const set of cb.actual_sets || []) {
      if (!set.done) continue;
      const reps = parseInt(set.reps, 10);
      const load = parseFloat(set.load);
      if (!isNaN(reps) && !isNaN(load)) {
        totalVolumeKg += reps * load;
        setCount += 1;
        if (load > best.loadKg) best = { loadKg: load, reps };
      } else if (!isNaN(reps)) {
        setCount += 1;
      }
    }
    exerciseMap.set(name, best);
  }

  const topExercises = [...exerciseMap.entries()]
    .sort((a, b) => (b[1].loadKg || 0) - (a[1].loadKg || 0))
    .slice(0, 3)
    .map(([name, best]) => ({
      name,
      best_set_display: best.loadKg ? `${best.loadKg}kg × ${best.reps}` : `${best.reps} reps`,
      is_pr: false, // PR detection requires historical lookup; left false for v1
    }));

  return {
    totalVolumeKg,
    setCount,
    exerciseCount: exerciseMap.size,
    durationSeconds: 0, // not tracked for resistance
    topExercises,
  };
}

// ---------------------------------------------------------------------------
// SessionView component
// ---------------------------------------------------------------------------

function SessionView({ session: authSession, planRow, sessionId, profile, weightUnit }) {
  const planRef = useRef(planRow);
  const profileRef = useRef(profile);
  const [plan, setPlan] = useState(() => ensureBlockIds(planRow.plan));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restActive, setRestActive] = useState(false);
  const [toast, setToast] = useState({ message: "", tone: "" });
  const [savingState, setSavingState] = useState("idle"); // idle | saving | error
  const [shareCardData, setShareCardData] = useState(null);
  const restEndRef = useRef(0); // absolute ms timestamp via performance.now()
  const restTickRef = useRef(0);

  // Find the target session inside the plan, by id. If the user
  // somehow lands on this page with a stale session id (e.g. they
  // bookmarked a deleted session), bail to the planner.
  const targetSessionIndex = useMemo(() => {
    return (plan?.sessions || []).findIndex((s) => s && s.id === sessionId);
  }, [plan, sessionId]);

  if (targetSessionIndex < 0) {
    return h(
      "div",
      { className: "session-empty" },
      "Couldn't find that session in this plan. ",
      h("a", { href: `/app/workout/` }, "Back to planner")
    );
  }

  const targetSession = plan.sessions[targetSessionIndex];
  const blockEntries = useMemo(() => flattenBlocks(targetSession), [targetSession]);

  // Local state per block: loaded once when the block index changes,
  // updated on every keystroke / Done tap.
  const currentEntry = blockEntries[currentIndex] || null;
  const currentBlockId = currentEntry?.block?.id || `unknown_${currentIndex}`;
  const savedForBlock = currentEntry ? findCompletedBlock(targetSession, currentBlockId) : null;
  const [localSets, setLocalSets] = useState(() =>
    currentEntry ? initActualSets(currentEntry.block, savedForBlock, weightUnit) : []
  );
  const [blockNotes, setBlockNotes] = useState(() => savedForBlock?.session_notes || "");

  // Re-init local state whenever the user navigates to a different block.
  useEffect(() => {
    if (!currentEntry) return;
    setLocalSets(initActualSets(currentEntry.block, savedForBlock, weightUnit));
    setBlockNotes(savedForBlock?.session_notes || "");
    // Scroll the page back to the top of the new block for muscle memory.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentIndex, currentBlockId]);

  // ---- Persistence ----
  // Debounced save: every keystroke schedules a save 800ms in the
  // future, replacing any pending save. Done taps and Finish bypass
  // the debounce via savePlanChange({ flush: true }).
  const saveTimeoutRef = useRef(null);
  const pendingPlanRef = useRef(null);

  const flushSave = useCallback(async () => {
    const planToSave = pendingPlanRef.current;
    if (!planToSave) return;
    pendingPlanRef.current = null;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setSavingState("saving");
    try {
      const updated = await applyManualWorkoutPlanEdit(
        authSession.user.id,
        planRef.current.id,
        planToSave
      );
      // Sync completed_blocks to workout_logs (fire and forget — don't block the save UX)
      upsertWorkoutLogs(authSession.user.id, planRef.current.id, planToSave, sessionId).catch(err =>
        console.error("[workout-logs sync]", err)
      );
      planRef.current = updated;
      setPlan(ensureBlockIds(updated.plan));
      setSavingState("idle");
    } catch (error) {
      setSavingState("error");
      setToast({ message: error?.message || "Save failed", tone: "error" });
    }
  }, [authSession.user.id]);

  const scheduleSave = useCallback((nextPlan, { flush = false } = {}) => {
    pendingPlanRef.current = nextPlan;
    if (flush) {
      flushSave();
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      flushSave();
    }, 800);
  }, [flushSave]);

  // Build a fresh plan object with the current block's localSets baked
  // into completed_blocks, then schedule it. Pure function — never
  // mutates `plan`. Called from any input change or Done tap.
  const persistCurrentBlock = useCallback((sets, notes, options = {}) => {
    if (!currentEntry) return;
    const entry = serializeBlockEntry(currentBlockId, sets, notes, weightUnit);
    const nextSessions = plan.sessions.map((s, idx) => {
      if (idx !== targetSessionIndex) return s;
      const existing = Array.isArray(s.completed_blocks) ? s.completed_blocks : [];
      const filtered = existing.filter((e) => e && e.block_id !== currentBlockId);
      return {
        ...s,
        completed_blocks: [...filtered, entry],
      };
    });
    const nextPlan = { ...plan, sessions: nextSessions };
    scheduleSave(nextPlan, options);
  }, [currentEntry, currentBlockId, plan, targetSessionIndex, scheduleSave]);

  // Flush any pending saves when the user navigates away.
  useEffect(() => {
    function onBeforeUnload() {
      if (pendingPlanRef.current) {
        // Fire-and-forget; the browser may not let the request finish
        // but the debounced save will have caught most of the data
        // already.
        flushSave();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Also flush on component unmount (SPA-style nav).
      if (pendingPlanRef.current) flushSave();
    };
  }, [flushSave]);

  // ---- Rest timer ----
  useEffect(() => {
    if (!restActive) return;
    function tick() {
      const remainingMs = Math.max(0, restEndRef.current - performance.now());
      const remainingSec = Math.ceil(remainingMs / 1000);
      setRestRemaining(remainingSec);
      if (remainingMs <= 0) {
        playBeep();
        // Show "rest done" pulse for ~6 seconds, then auto-hide.
        setTimeout(() => setRestActive(false), 6000);
        return;
      }
      restTickRef.current = window.requestAnimationFrame(tick);
    }
    restTickRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (restTickRef.current) window.cancelAnimationFrame(restTickRef.current);
    };
  }, [restActive]);

  function startRestTimer(seconds) {
    if (!seconds || seconds < 1) return;
    restEndRef.current = performance.now() + seconds * 1000;
    setRestRemaining(seconds);
    setRestActive(true);
  }

  function skipRestTimer() {
    setRestActive(false);
    setRestRemaining(0);
  }

  // ---- Set interactions ----
  function updateSet(setIndex, field, value) {
    setLocalSets((prev) => {
      const next = prev.map((set, i) => (i === setIndex ? { ...set, [field]: value } : set));
      persistCurrentBlock(next, blockNotes);
      return next;
    });
  }

  function toggleSetDone(setIndex) {
    setLocalSets((prev) => {
      const next = prev.map((set, i) => (i === setIndex ? { ...set, done: !set.done } : set));
      // If we just marked done (true), start the rest timer.
      const nowDone = next[setIndex].done;
      const restSeconds = Number(currentEntry?.block?.rest_seconds) || 90;
      if (nowDone) startRestTimer(restSeconds);
      // Auto-advance to the next block when ALL sets in the current
      // block are done. 400ms delay so the user sees the visual
      // confirmation before the page swaps.
      const allDone = next.every((s) => s.done);
      persistCurrentBlock(next, blockNotes, { flush: nowDone });
      if (allDone && currentIndex < blockEntries.length - 1) {
        setTimeout(() => setCurrentIndex((idx) => idx + 1), 600);
      }
      return next;
    });
  }

  function updateBlockNotes(value) {
    setBlockNotes(value);
    persistCurrentBlock(localSets, value);
  }

  // ---- Block navigation ----
  function goPrev() {
    if (pendingPlanRef.current) flushSave();
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  }
  function goNext() {
    if (pendingPlanRef.current) flushSave();
    setCurrentIndex((idx) => Math.min(blockEntries.length - 1, idx + 1));
  }

  // ---- Finish session ----
  async function finishSession({ share = false } = {}) {
    if (pendingPlanRef.current) flushSave();
    const nextSessions = plan.sessions.map((s, idx) => {
      if (idx !== targetSessionIndex) return s;
      return { ...s, completion_status: "completed" };
    });
    const nextPlan = { ...plan, sessions: nextSessions };
    pendingPlanRef.current = nextPlan;
    await flushSave();

    if (share) {
      // Compute summary stats for the gym card
      const savedSession = nextPlan.sessions[targetSessionIndex];
      const summary = computeGymSummary(savedSession);
      const profile = profileRef.current || {};
      const cardData = buildGymCardData(
        { title: savedSession.title },
        profile,
        summary
      );
      setShareCardData(cardData);
      return;
    }

    setToast({ message: "Session logged. Nice work.", tone: "success" });
    setTimeout(() => { window.location.href = `/app/workout/`; }, 900);
  }

  // ---- Toast auto-dismiss ----
  useEffect(() => {
    if (!toast.message) return;
    const t = setTimeout(() => setToast({ message: "", tone: "" }), 2400);
    return () => clearTimeout(t);
  }, [toast.message]);

  // ---- Rendering ----
  if (!currentEntry) {
    return h(
      "div",
      { className: "session-empty" },
      "This session has no logged blocks yet. ",
      h("a", { href: `/app/workout/` }, "Back to planner")
    );
  }

  const block = currentEntry.block;
  const totalBlocks = blockEntries.length;
  const isLastBlock = currentIndex === totalBlocks - 1;
  const allSetsDone = localSets.length > 0 && localSets.every((s) => s.done);
  const restSeconds = Number(block.rest_seconds) || 90;

  return h(
    React.Fragment,
    null,
    // Top bar
    h(
      "header",
      { className: "session-topbar" },
      h(
        "a",
        { className: "session-back", href: `/app/workout/` },
        "← Back"
      ),
      h(
        "span",
        { className: "session-progress" },
        `${currentIndex + 1} / ${totalBlocks}`
      )
    ),

    // Session crumbs
    h("div", { className: "session-crumb" }, `Week ${targetSession.week} · ${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][targetSession.day_of_week]} · ${targetSession.date || ""}`),
    h("h1", { className: "session-title" }, targetSession.title || "Workout"),
    targetSession.summary
      ? h("p", { className: "session-summary" }, targetSession.summary)
      : null,

    // Phase / kind band
    h(
      "span",
      { className: `phase-band ${currentEntry.kind === "warmup" ? "warmup" : ""}` },
      currentEntry.kind === "warmup"
        ? `Warm-up ${currentIndex + 1} / ${blockEntries.filter((b) => b.kind === "warmup").length}`
        : `Working set · ${block.name || "Exercise"}`
    ),

    // Block card
    h(
      "section",
      { className: "block-card" },
      h("h2", { className: "block-name" }, block.name || "Exercise"),
      h(
        "div",
        { className: "block-prescription" },
        [
          block.sets ? `${block.sets} sets` : "",
          block.reps ? `× ${block.reps}` : "",
          block.load ? `@ ${displayLoadString(block.load, weightUnit)}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      ),
      h(
        "div",
        { className: "block-meta" },
        [
          block.rpe ? `RPE ${block.rpe}` : "",
          restSeconds ? `Rest ${restSeconds}s` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      ),
      block.notes ? h("div", { className: "block-notes" }, block.notes) : null,

      h(
        "div",
        { className: "set-headers" },
        h("span", null, "#"),
        h("span", null, "Reps"),
        h("span", null, `Load (${weightUnit})`),
        h("span", null, "RPE"),
        h("span", { className: "header-done" }, "Done")
      ),

      localSets.map((set, setIndex) =>
        h(
          "div",
          { key: setIndex, className: "set-row" },
          h("div", { className: "set-label" }, setIndex + 1),
          h("input", {
            type: "text",
            inputMode: "numeric",
            placeholder: block.reps || "reps",
            value: set.reps,
            onChange: (e) => updateSet(setIndex, "reps", e.target.value),
            "aria-label": `Set ${setIndex + 1} reps`,
          }),
          h("input", {
            type: "text",
            inputMode: "decimal",
            placeholder: block.load || "load",
            value: set.load,
            onChange: (e) => updateSet(setIndex, "load", e.target.value),
            "aria-label": `Set ${setIndex + 1} load`,
          }),
          h("input", {
            type: "text",
            inputMode: "decimal",
            placeholder: "RPE",
            value: set.rpe,
            onChange: (e) => updateSet(setIndex, "rpe", e.target.value),
            "aria-label": `Set ${setIndex + 1} RPE`,
          }),
          h(
            "button",
            {
              type: "button",
              className: `set-done${set.done ? " is-done" : ""}`,
              onClick: () => toggleSetDone(setIndex),
              "aria-label": set.done ? "Unmark set" : "Mark set done",
            },
            set.done ? "✓" : "Done"
          )
        )
      ),

      h(
        "textarea",
        {
          className: "set-notes",
          placeholder: "Notes for this exercise (optional)",
          value: blockNotes,
          onChange: (e) => updateBlockNotes(e.target.value),
        }
      )
    ),

    // Block nav
    h(
      "div",
      { className: "block-nav" },
      h(
        "button",
        { type: "button", onClick: goPrev, disabled: currentIndex === 0 },
        "← Previous"
      ),
      h(
        "button",
        {
          type: "button",
          onClick: goNext,
          disabled: isLastBlock,
          className: allSetsDone && !isLastBlock ? "primary" : "",
        },
        "Next →"
      )
    ),

    // Finish session button
    isLastBlock
      ? h(
          "div",
          { className: "finish-row" },
          h("button", {
            type: "button",
            className: "finish-btn",
            onClick: () => finishSession({ share: false }),
          }, "Finish session"),
          h("button", {
            type: "button",
            className: "finish-share-btn",
            onClick: () => finishSession({ share: true }),
          }, "Finish & share")
        )
      : null,

    // Share modal
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: {},
      onClose: () => { window.location.href = "/app/workout/"; },
    }),

    // Rest timer pill
    restActive
      ? h(
          "div",
          {
            className: `rest-timer${restRemaining <= 0 ? " is-done" : ""}`,
            onClick: skipRestTimer,
            role: "button",
            "aria-label": "Skip rest timer",
          },
          h(
            "span",
            { className: "rest-mmss" },
            restRemaining > 0
              ? `${Math.floor(restRemaining / 60)}:${String(restRemaining % 60).padStart(2, "0")}`
              : "REST DONE"
          ),
          h("span", { className: "rest-skip" }, "Skip")
        )
      : null,

    // Toast
    toast.message
      ? h(
          "div",
          {
            className: `session-toast is-visible${toast.tone === "error" ? " is-error" : ""}`,
          },
          toast.message
        )
      : null,

    // Saving status (subtle)
    savingState === "saving"
      ? h(
          "div",
          {
            style: {
              position: "fixed",
              top: 14,
              right: 14,
              fontSize: 10,
              color: "var(--muted)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            },
          },
          "Saving..."
        )
      : null
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const rootEl = document.getElementById("session-root");
  if (!rootEl) return;

  const { planId, sessionId } = readQueryParams();
  if (!planId || !sessionId) {
    rootEl.innerHTML = `<div class="session-empty">Missing plan or session id. <a href="/app/workout/">Back to planner</a></div>`;
    return;
  }

  const session = await requireAuth();
  if (!session) return;

  let planRow;
  try {
    planRow = await getWorkoutPlan(planId);
  } catch (error) {
    rootEl.innerHTML = `<div class="session-empty">Could not load plan: ${String(error?.message || error).replace(/</g, "&lt;")}</div>`;
    return;
  }
  if (!planRow) {
    rootEl.innerHTML = `<div class="session-empty">Plan not found. <a href="/app/workout/">Back to planner</a></div>`;
    return;
  }
  if (planRow.user_id !== session.user.id) {
    rootEl.innerHTML = `<div class="session-empty">Not your plan.</div>`;
    return;
  }

  // Resolve weight unit preference and fetch profile (for share card)
  let weightUnit = "kg";
  let profile = null;
  try {
    profile = await getProfile(session.user.id);
    weightUnit = resolveWeightUnit(profile?.weight_unit);
  } catch (_err) {
    weightUnit = resolveWeightUnit(null);
  }

  const root = createRoot(rootEl);
  root.render(h(SessionView, { session, planRow, sessionId, profile, weightUnit }));
}

boot().catch((error) => {
  console.error("Session view boot failed:", error);
  const rootEl = document.getElementById("session-root");
  if (rootEl) {
    rootEl.innerHTML = `<div class="session-empty">Failed to load: ${String(error?.message || error).replace(/</g, "&lt;")}</div>`;
  }
});
