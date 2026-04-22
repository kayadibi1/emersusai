// shared/train/lift-active.js — Phase 3 Train · Lift / Active panel.
//
// Renders the in-progress lift session: exercise cards, set rows
// (done / current / empty), Log set button, +Add exercise stub.
// Persists via POST /api/sets and PATCH /api/workout-sessions/:id.

import React from "react";
import { clampNumericChange, LIMITS } from "/shared/train/input-helpers.js";

const { useCallback, useEffect, useMemo, useRef, useState } = React;
const h = React.createElement;

const RPE_OPTIONS = [6, 7, 8, 9, 10];
const DEFAULT_REST_SECONDS = 120;

function pickPlannedSets(exerciseEntry) {
  return Math.max(1, Math.min(Number(exerciseEntry?.planned_sets) || 3, 12));
}

export function LiftActive({
  session,
  setsBySession,           // map sessionId -> [{ exercise_id, set_number, reps, load_kg, rpe, ... }]
  exerciseLookup,          // map exercise_id -> { name, muscle_groups, equipment, ... }
  accessToken,
  onSetLogged,             // (newRow, totals) => void
  onAddExercise,
  onRestStart,             // (endsAtIso) => void
}) {
  const sets = setsBySession?.[session?.id] || [];
  const exercises = Array.isArray(session?.exercises) ? session.exercises : [];

  const setsByExercise = useMemo(() => {
    const map = {};
    for (const s of sets) {
      const arr = map[s.exercise_id] || [];
      arr.push(s);
      map[s.exercise_id] = arr;
    }
    return map;
  }, [sets]);

  if (!exercises.length) {
    return h("div", { className: "tr-lift-empty" },
      h("p", null, "No exercises yet."),
      h("button", { type: "button", className: "tr-add-btn", onClick: onAddExercise }, "+ Add exercise"),
    );
  }

  return h("div", { className: "tr-lift-active" },
    session?.source_thread_id
      ? h("div", { className: "tr-plan-banner" },
          h("span", null, "Started from a chat plan."),
          h("a", { href: `/app/?thread=${encodeURIComponent(session.source_thread_id)}`, target: "_blank", rel: "noopener" }, "Open original thread →"),
        )
      : null,
    exercises.map((entry, i) =>
      h(ExerciseCard, {
        key: entry.exercise_id || `e-${i}`,
        entry,
        plannedSets: pickPlannedSets(entry),
        loggedSets: setsByExercise[entry.exercise_id] || [],
        exerciseInfo: exerciseLookup?.[entry.exercise_id],
        sessionId: session?.id,
        accessToken,
        onSetLogged,
        onRestStart,
      }),
    ),
    h("button", { type: "button", className: "tr-add-btn", onClick: onAddExercise }, "+ Add exercise"),
  );
}

function ExerciseCard({ entry, plannedSets, loggedSets, exerciseInfo, sessionId, accessToken, onSetLogged, onRestStart }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentSetNumber = loggedSets.length + 1;
  const isDone = loggedSets.length >= plannedSets;

  // Form state for the current set.
  // Pre-fill from the last logged set in this exercise when one exists (the
  // Strong/Hevy convention — "next set starts at your previous weight/reps").
  // Falls back to the plan target, then empty.
  const lastLogged = loggedSets[loggedSets.length - 1];
  const initialWeight = lastLogged?.load_kg ?? entry?.target_weight_kg ?? "";
  const initialReps = lastLogged?.reps ?? entry?.target_reps ?? "";
  const [weight, setWeight] = useState(initialWeight);
  const [reps, setReps] = useState(initialReps);
  const [rpe, setRpe] = useState(null);

  // When a set is logged (loggedSets grows), reseed the inputs with the
  // values the user just logged so set N+1 starts where set N finished.
  // Guarded on length so mid-entry edits aren't clobbered.
  const prevLoggedCount = useRef(loggedSets.length);
  useEffect(() => {
    if (loggedSets.length > prevLoggedCount.current) {
      const just = loggedSets[loggedSets.length - 1];
      if (just) {
        if (just.load_kg != null) setWeight(just.load_kg);
        if (just.reps != null) setReps(just.reps);
      }
    }
    prevLoggedCount.current = loggedSets.length;
  }, [loggedSets.length]);

  const submit = useCallback(async () => {
    if (busy) return;
    if (!sessionId || !entry?.exercise_id) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          session_id: sessionId,
          exercise_id: entry.exercise_id,
          set_number: currentSetNumber,
          weight_kg: weight === "" ? null : Number(weight),
          reps: reps === "" ? null : Number(reps),
          rpe,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const { row, totals } = await res.json();
      onSetLogged?.(row, totals);
      setRpe(null);
      // Start the rest timer. Use entry.rest_seconds or default.
      const restSeconds = Number(entry?.rest_seconds) || DEFAULT_REST_SECONDS;
      const endsAt = new Date(Date.now() + restSeconds * 1000).toISOString();
      onRestStart?.(endsAt);
    } catch (err) {
      setError(err.message || "Could not log set.");
    } finally {
      setBusy(false);
    }
  }, [busy, sessionId, entry, currentSetNumber, weight, reps, rpe, accessToken, onSetLogged, onRestStart]);

  const name = exerciseInfo?.name || entry?.name || "Exercise";
  const meta = [exerciseInfo?.movement_type, (exerciseInfo?.muscle_groups || []).join(", ")]
    .filter(Boolean).join(" · ");

  return h("article", { className: "tr-exercise-card" },
    h("header", { className: "tr-exercise-head" },
      h("div", { className: "tr-exercise-name" }, name),
      meta ? h("div", { className: "tr-exercise-meta" }, meta) : null,
    ),
    h("ul", { className: "tr-set-rows" },
      Array.from({ length: plannedSets }, (_, i) => {
        const setNum = i + 1;
        const logged = loggedSets[i];
        if (logged) {
          return h("li", { key: setNum, className: "tr-set-row tr-set-done" },
            h("span", { className: "tr-set-num" }, setNum),
            h("span", { className: "tr-set-load" }, logged.load_kg ?? "—", " kg × ", logged.reps ?? "—"),
            logged.rpe ? h("span", { className: "tr-set-rpe" }, "RPE ", logged.rpe) : null,
            h("span", { className: "tr-set-check" }, "✓"),
          );
        }
        if (setNum === currentSetNumber && !isDone) {
          return h("li", { key: setNum, className: "tr-set-row tr-set-current" },
            h("span", { className: "tr-set-num" }, setNum),
            h("input", {
              type: "number",
              min: LIMITS.lift.loadKg.min,
              max: LIMITS.lift.loadKg.max,
              step: 0.5,
              inputMode: "decimal",
              "aria-label": "Weight in kg",
              value: weight,
              onChange: clampNumericChange(setWeight, LIMITS.lift.loadKg),
              placeholder: "kg", className: "tr-set-weight-input",
            }),
            h("span", { className: "tr-set-times" }, "×"),
            h("input", {
              type: "number",
              min: LIMITS.lift.reps.min,
              max: LIMITS.lift.reps.max,
              step: 1,
              inputMode: "numeric",
              "aria-label": "Reps",
              value: reps,
              onChange: clampNumericChange(setReps, LIMITS.lift.reps),
              placeholder: "reps", className: "tr-set-reps-input",
            }),
            h("div", { className: "tr-rpe-chips", role: "group", "aria-label": "Rate of Perceived Exertion (RPE)" },
              h("span", { className: "tr-rpe-label" }, "RPE"),
              RPE_OPTIONS.map((value) =>
                h("button", {
                  key: value,
                  type: "button",
                  "aria-label": `RPE ${value}`,
                  className: `tr-rpe-chip${rpe === value ? " is-active" : ""}`,
                  onClick: () => setRpe(value),
                }, value),
              ),
            ),
            h("button", {
              type: "button",
              className: "tr-log-btn",
              disabled: busy,
              onClick: submit,
            }, busy ? "Saving…" : "Log set"),
            error ? h("span", { className: "tr-set-error" }, error) : null,
          );
        }
        const targetText = entry?.target_weight_kg && entry?.target_reps
          ? `target ${entry.target_weight_kg} kg × ${entry.target_reps}`
          : "—";
        return h("li", { key: setNum, className: "tr-set-row tr-set-empty" },
          h("span", { className: "tr-set-num" }, setNum),
          h("span", { className: "tr-set-target" }, targetText),
        );
      }),
    ),
  );
}

export default LiftActive;
