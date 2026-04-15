// shared/train/climb-active.js — Phase 3 Climb Active panel.
// Route list with grade chip + status (flash/send/working/project).

import React from "react";

const { useCallback, useState } = React;
const h = React.createElement;

const STATUSES = ["flash", "send", "working", "project"];

export function ClimbActive({ session, sets, accessToken, onLogged }) {
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("send");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const log = useCallback(async () => {
    if (submitting || !session?.id) return;
    if (!grade.trim()) { setError("Grade is required."); return; }
    setSubmitting(true); setError("");
    try {
      const lookup = await fetch(`/api/exercises?category=climbing&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const { items } = await lookup.json();
      const exerciseId = items?.[0]?.id;
      if (!exerciseId) throw new Error("No climbing exercise in catalog. Seed one.");
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          session_id: session.id,
          exercise_id: exerciseId,
          notes: `${grade} · ${status}`,
          detail: { grade: grade.trim(), status, problem_number: (sets || []).length + 1 },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const { row } = await res.json();
      onLogged?.(row); setGrade(""); setStatus("send");
    } catch (err) {
      setError(err.message || "Could not log problem.");
    } finally { setSubmitting(false); }
  }, [submitting, session, accessToken, grade, status, sets, onLogged]);

  return h("div", { className: "tr-climb" },
    h("ul", { className: "tr-climb-list" },
      (sets || []).map((s, i) => h("li", { key: s.id || i, className: `tr-climb-row tr-climb-${s.detail?.status || "send"}` },
        h("span", { className: "tr-climb-grade" }, s.detail?.grade || "—"),
        h("span", { className: "tr-climb-status" }, (s.detail?.status || "send").toUpperCase()),
      )),
    ),
    h("div", { className: "tr-cardio-form" },
      h("h3", null, "+ Add problem"),
      h("div", { className: "tr-cardio-inputs" },
        h("label", { className: "tr-labeled-input" },
          h("span", null, "Grade"),
          h("input", { type: "text", value: grade, placeholder: "V4 / 6c+", onChange: (e) => setGrade(e.target.value) }),
        ),
        h("label", { className: "tr-labeled-input" },
          h("span", null, "Status"),
          h("select", { value: status, onChange: (e) => setStatus(e.target.value) },
            STATUSES.map((s) => h("option", { key: s, value: s }, s.toUpperCase())),
          ),
        ),
      ),
      h("button", { type: "button", className: "tr-log-btn", disabled: submitting, onClick: log }, submitting ? "Saving…" : "+ Add problem"),
      error ? h("p", { className: "tr-set-error" }, error) : null,
    ),
  );
}

export default ClimbActive;
