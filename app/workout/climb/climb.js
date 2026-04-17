import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyManualWorkoutPlanEdit,
  getProfile,
  getWorkoutPlan,
  requireAuth,
  upsertWorkoutLogs,
} from "/shared/supabase.js";
import { GRADE_SYSTEMS, defaultSystemForStyle } from "/shared/climbing-grades.js";
import { reconcileSendTypeForAttempts } from "/shared/climbing-send-type.js";
import { ShareModal, SHARE_MODAL_CSS } from "/shared/share-modal.js";
import { buildClimbCardData } from "/shared/share-card.js";

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

const STYLE_CHIPS = [
  { id: "bouldering", label: "Bouldering" },
  { id: "sport_climbing", label: "Sport" },
  { id: "top_rope_climbing", label: "Top-rope" },
  { id: "trad_climbing", label: "Trad" },
];

// â”€â”€ Add route modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AddRouteModal({ initial, gradeSystem, onSave, onCancel }) {
  const [grade, setGrade] = useState(initial?.grade || null);
  const [attempts, setAttempts] = useState(initial?.attempts || 1);
  const [sendType, setSendType] = useState(initial?.send_type || "flash");
  const [routeName, setRouteName] = useState(initial?.name || "");

  const grades = GRADE_SYSTEMS[gradeSystem]?.grades || [];

  const chooseSendType = (type) => {
    setSendType(type);
    if (type === "flash" && attempts !== 1) setAttempts(1);
  };

  const changeAttempts = (delta) => {
    const next = Math.max(1, attempts + delta);
    if (next === attempts) return;
    setAttempts(next);
    const reconciled = reconcileSendTypeForAttempts(sendType, next);
    if (reconciled !== sendType) setSendType(reconciled);
  };

  const canSave = !!grade;

  return h(
    "div",
    { className: "modal-backdrop", onClick: onCancel },
    h(
      "div",
      { className: "modal-sheet", onClick: (e) => e.stopPropagation() },
      h("div", { className: "modal-title" }, initial ? "Edit route" : "Add route"),
      h("div", { className: "modal-sub" }, `Grade (${gradeSystem})`),
      h("div", { className: "grade-grid" },
        grades.slice(0, 18).map((g) =>
          h("button", {
            key: g,
            className: `grade-cell${grade === g ? " selected" : ""}`,
            onClick: () => setGrade(g),
          }, g)
        )
      ),
      h("div", { className: "counter-row" },
        h("span", null, "Attempts"),
        h("div", { className: "counter-controls" },
          h("button", { className: "counter-btn", onClick: () => changeAttempts(-1) }, "âˆ’"),
          h("span", { style: { fontSize: "1.05rem", fontWeight: 800, minWidth: 24, textAlign: "center" } }, attempts),
          h("button", { className: "counter-btn", onClick: () => changeAttempts(1) }, "+"),
        )
      ),
      h("div", { className: "toggle-row" },
        h("button", {
          className: `toggle-cell flash${sendType === "flash" ? " selected" : ""}`,
          onClick: () => chooseSendType("flash"),
        }, "Flash"),
        h("button", {
          className: `toggle-cell send${sendType === "send" ? " selected" : ""}`,
          onClick: () => chooseSendType("send"),
        }, "Send"),
        h("button", {
          className: `toggle-cell project${sendType === "project" ? " selected" : ""}`,
          onClick: () => chooseSendType("project"),
        }, "Project"),
      ),
      h("input", {
        type: "text",
        className: "name-input",
        placeholder: "Route name (optional)",
        value: routeName,
        onChange: (e) => setRouteName(e.target.value),
      }),
      h("button", {
        className: "big-btn",
        style: { marginTop: 0, opacity: canSave ? 1 : 0.4, padding: 14 },
        disabled: !canSave,
        onClick: () => onSave({
          grade,
          grade_system: gradeSystem,
          attempts,
          send_type: reconcileSendTypeForAttempts(sendType, attempts),
          name: routeName.trim() || null,
        }),
      }, "Log route"),
      h("button", {
        style: { background: "none", border: "none", color: "var(--muted)", marginTop: 8, width: "100%", padding: 6, cursor: "pointer" },
        onClick: onCancel,
      }, "Cancel"),
    )
  );
}

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ClimbSessionView({ session: authSession, planRow, sessionIndex, profile }) {
  const [plan, setPlan] = useState(planRow.plan);
  const targetSession = plan.sessions[sessionIndex];
  const firstBlockId = targetSession?.blocks?.[0]?.id || "unknown";

  const [phase, setPhase] = useState("prestart");
  const [titleValue, setTitleValue] = useState(targetSession.title || "Climb Session");
  const [style, setStyle] = useState("bouldering");
  const [gradeSystem, setGradeSystem] = useState(() =>
    profile?.default_grade_system || defaultSystemForStyle("bouldering")
  );

  const [startedAt, setStartedAt] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);

  const [shareCardData, setShareCardData] = useState(null);

  const changeStyle = (s) => {
    setStyle(s);
    if (!profile?.default_grade_system) {
      setGradeSystem(defaultSystemForStyle(s));
    }
  };

  const startSession = () => {
    setStartedAt(Date.now());
    setPhase("live");
  };

  const addRoute = (route) => {
    if (editingIdx != null) {
      setRoutes((rs) => rs.map((r, i) => (i === editingIdx ? route : r)));
    } else {
      setRoutes((rs) => [route, ...rs]);
    }
    setModalOpen(false);
    setEditingIdx(null);
  };

  const editRoute = (idx) => {
    setEditingIdx(idx);
    setModalOpen(true);
  };

  const onFinish = useCallback(async () => {
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    const completedBlock = {
      block_id: firstBlockId,
      schema_version: 1,
      style,
      routes,
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
      console.error("[climb] log sync", e)
    );
    const cardData = buildClimbCardData({ title: titleValue }, completedBlock, profile);
    setShareCardData(cardData);
  }, [
    startedAt, firstBlockId, style, routes, plan, sessionIndex, titleValue,
    planRow.id, targetSession.id, authSession.user.id, profile,
  ]);

  const onShareClose = useCallback(() => { window.location.href = "/app/workout/"; }, []);

  return h(
    React.Fragment,
    null,
    phase === "prestart" && h(
      React.Fragment,
      null,
      h("div", { className: "climb-topbar" },
        h("a", { href: "/app/workout/" }, "â† Back"),
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
        STYLE_CHIPS.map((c) =>
          h("button", {
            key: c.id,
            className: `chip${style === c.id ? " active" : ""}`,
            onClick: () => changeStyle(c.id),
          }, c.label)
        )
      ),
      h("button", { className: "big-btn", onClick: startSession }, "Start")
    ),
    phase === "live" && h(
      React.Fragment,
      null,
      h("div", { className: "climb-topbar" },
        h("a", { href: "/app/workout/" }, "â† Back"),
        h("span", null, startedAt ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "")
      ),
      h("div", { className: "title-field" },
        h("div", { className: "label" }, "SESSION"),
        h("div", { style: { fontSize: "1.02rem", fontWeight: 700, marginTop: 2 } }, titleValue)
      ),
      h("button", { className: "climb-add-btn", onClick: () => setModalOpen(true) }, "+ Add route"),
      h("div", { className: "route-list" },
        routes.map((r, idx) =>
          h("div", {
            key: idx,
            className: "route-item",
            onClick: () => editRoute(idx),
          },
            h("div", null,
              h("div", { className: "route-grade" }, r.grade),
              r.name && h("div", { className: "route-name" }, r.name),
            ),
            h("span", { className: `send-badge ${r.send_type}` },
              r.send_type === "send" && r.attempts > 1 ? `SEND \u00b7 ${r.attempts} tries` : r.send_type.toUpperCase()
            )
          )
        )
      ),
      h("button", { className: "danger-btn", onClick: onFinish, disabled: routes.length === 0 },
        "Finish & share"
      ),
      modalOpen && h(AddRouteModal, {
        initial: editingIdx != null ? routes[editingIdx] : null,
        gradeSystem,
        onSave: addRoute,
        onCancel: () => { setModalOpen(false); setEditingIdx(null); },
      })
    ),
    shareCardData && h(ShareModal, {
      cardData: shareCardData,
      cardOpts: {},
      onClose: onShareClose,
    })
  );
}

async function boot() {
  const rootEl = document.getElementById("climb-root");
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
  root.render(h(ClimbSessionView, { session, planRow, sessionIndex, profile }));
}

boot().catch((err) => {
  console.error("[climb] boot failed:", err);
  const el = document.getElementById("climb-root");
  if (el) el.innerHTML = '<div style="padding:20px;color:#ff8f9d">Failed.</div>';
});
