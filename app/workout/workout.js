// /app/workout/ page logic.
//
// Mirrors the vanilla-JS pattern used by /app/profile/ (see shared/app-pages.js):
//   - requireAuth gates the page,
//   - data-attribute hooks bind to DOM nodes,
//   - no React, no build step, no framework.
//
// Responsibilities:
//   1. List saved workout_plans for the current user in the sidebar.
//   2. Render the selected plan's sessions grouped by week.
//   3. Per-session "Mark missed / skipped / completed" quick toggle
//      (writes through applyManualWorkoutPlanEdit).
//   4. Download .ics (the only Phase 1 calendar export).
//   5. Discuss in chat (opens /chat/?open_plan=<id>).
//   6. Archive plan + Undo last change.

import {
  applyManualWorkoutPlanEdit,
  archiveWorkoutPlan,
  getSession,
  getSupabase,
  listWorkoutPlans,
  requireAuth,
  setStatus,
  undoLastWorkoutPlanChange,
} from "/shared/supabase.js";
import { DAY_LABELS, summarizeBlocks, summarizePlan } from "/shared/workout-plan-schema.js";
import { downloadPlanIcs } from "/shared/workout-plan-ics.js";

const state = {
  session: null,
  plans: [],
  selectedPlanId: null,
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function toastEl() {
  return document.querySelector("[data-workout-toast]");
}

function showToast(tone, message) {
  setStatus(toastEl(), tone, message);
}

async function bindLogout() {
  const button = document.querySelector("[data-auth-logout]");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Logging Out...";
    try {
      const supabase = await getSupabase();
      await supabase.auth.signOut();
      window.location.replace("/auth/login/");
    } catch (_error) {
      button.disabled = false;
      button.textContent = "Log Out";
    }
  });
}

async function hydrateUser() {
  const session = await requireAuth();
  if (!session) return null;
  state.session = session;
  document.querySelectorAll("[data-user-email]").forEach((node) => {
    node.textContent = session.user.email || "Authenticated user";
  });
  return session;
}

async function reloadPlans({ preserveSelection = true } = {}) {
  if (!state.session) return;
  const rows = await listWorkoutPlans(state.session.user.id);
  state.plans = rows;
  if (!preserveSelection || !rows.find((r) => r.id === state.selectedPlanId)) {
    state.selectedPlanId = rows.length ? rows[0].id : null;
  }
  renderSidebar();
  renderDetail();
}

function renderSidebar() {
  const list = document.querySelector("[data-plan-list]");
  if (!list) return;
  list.innerHTML = "";
  if (!state.plans.length) {
    list.appendChild(el("li", { class: "plan-meta" }, "No plans yet."));
    return;
  }
  for (const row of state.plans) {
    const plan = row.plan || {};
    const button = el(
      "button",
      {
        type: "button",
        class: row.id === state.selectedPlanId ? "is-active" : "",
        onClick: () => {
          state.selectedPlanId = row.id;
          renderSidebar();
          renderDetail();
        },
      },
      el("div", { class: "plan-title" }, row.title || plan.title || "Untitled plan"),
      el("div", { class: "plan-meta" }, summarizePlan(plan) || "Workout plan")
    );
    list.appendChild(el("li", {}, button));
  }
}

function groupSessionsByWeek(sessions) {
  const byWeek = new Map();
  for (const session of sessions || []) {
    const week = Number(session.week) || 1;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(session);
  }
  return Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
}

async function updateSessionStatus(row, sessionId, nextStatus) {
  try {
    const updatedSessions = (row.plan.sessions || []).map((s) =>
      s.id === sessionId ? { ...s, completion_status: nextStatus } : s
    );
    const nextPlan = { ...row.plan, sessions: updatedSessions };
    const updated = await applyManualWorkoutPlanEdit(state.session.user.id, row.id, nextPlan);
    const idx = state.plans.findIndex((p) => p.id === row.id);
    if (idx >= 0) state.plans[idx] = updated;
    renderDetail();
    showToast("success", "Session status updated.");
  } catch (error) {
    showToast("error", error.message || "Could not update session.");
  }
}

function statusButton(label, tone, active, onClick) {
  const classes = ["status-toggle"];
  if (active) {
    if (tone === "success") classes.push("active");
    else if (tone === "danger") classes.push("active-missed");
    else if (tone === "warning") classes.push("active-skipped");
  }
  return el(
    "button",
    {
      type: "button",
      class: classes.join(" "),
      onClick,
    },
    label
  );
}

function renderDetail() {
  const detail = document.querySelector("[data-plan-detail]");
  if (!detail) return;
  detail.innerHTML = "";

  const row = state.plans.find((p) => p.id === state.selectedPlanId);
  if (!row) {
    const empty = el(
      "div",
      { class: "workout-empty-state" },
      el("p", {}, "Select a plan from the list, or start a new one in chat."),
      el("a", { class: "button button-primary", href: "/chat/" }, "Open chat")
    );
    detail.appendChild(empty);
    return;
  }

  const plan = row.plan || {};
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  const hasUndo = !!row.previous_plan;

  detail.appendChild(el("h1", {}, row.title || plan.title || "Workout plan"));
  const metaLine = [
    summarizePlan(plan),
    plan.start_date ? `Starts ${plan.start_date}` : "",
    plan.timezone || "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (metaLine) detail.appendChild(el("div", { class: "detail-meta" }, metaLine));
  if (row.last_adjusted_via && row.last_adjusted_at) {
    const when = new Date(row.last_adjusted_at);
    const ago = Number.isNaN(when.getTime()) ? "" : when.toLocaleString();
    detail.appendChild(
      el(
        "div",
        { class: "detail-sub" },
        `Last adjusted via ${row.last_adjusted_via}${ago ? ` · ${ago}` : ""}`
      )
    );
  }

  // Action row: discuss in chat, .ics download, undo, archive.
  const actions = el("div", { class: "workout-action-row" });
  actions.appendChild(
    el(
      "a",
      { href: `/chat/?open_plan=${encodeURIComponent(row.id)}`, class: "primary" },
      "Discuss in chat"
    )
  );
  actions.appendChild(
    el(
      "button",
      {
        type: "button",
        onClick: () => {
          try {
            downloadPlanIcs(plan, { planRowId: row.id });
            showToast("success", "ICS download started — works with Google, Apple, and Outlook.");
          } catch (error) {
            showToast("error", error.message || "Could not generate .ics.");
          }
        },
      },
      "Add to calendar (.ics)"
    )
  );
  actions.appendChild(
    el(
      "button",
      {
        type: "button",
        disabled: hasUndo ? null : "true",
        onClick: async () => {
          if (!hasUndo) return;
          try {
            const updated = await undoLastWorkoutPlanChange(state.session.user.id, row.id);
            const idx = state.plans.findIndex((p) => p.id === row.id);
            if (idx >= 0) state.plans[idx] = updated;
            renderDetail();
            showToast("success", "Last change undone.");
          } catch (error) {
            showToast("error", error.message || "Nothing to undo.");
          }
        },
      },
      "Undo last change"
    )
  );
  actions.appendChild(
    el(
      "button",
      {
        type: "button",
        onClick: async () => {
          if (!confirm("Archive this plan? You can always generate a new one in chat.")) return;
          try {
            await archiveWorkoutPlan(state.session.user.id, row.id);
            await reloadPlans({ preserveSelection: false });
            showToast("success", "Plan archived.");
          } catch (error) {
            showToast("error", error.message || "Could not archive.");
          }
        },
      },
      "Archive plan"
    )
  );
  detail.appendChild(actions);

  if (plan.notes) {
    detail.appendChild(
      el(
        "p",
        { class: "detail-sub", style: "font-size:12px;color:var(--color-text-secondary);white-space:pre-wrap" },
        plan.notes
      )
    );
  }

  if (!sessions.length) {
    detail.appendChild(el("p", { class: "detail-sub" }, "No sessions in this plan yet."));
    return;
  }

  const grouped = groupSessionsByWeek(sessions);
  for (const [weekNum, weekSessions] of grouped) {
    const weekEl = el("div", { class: "workout-week" }, el("h3", {}, `Week ${weekNum}`));
    for (const session of weekSessions) {
      const blocksText = summarizeBlocks(session.blocks);
      const sessionEl = el(
        "div",
        { class: "workout-session" },
        el(
          "div",
          { class: "day" },
          `${DAY_LABELS[session.day_of_week] || ""}\n${session.date || ""}\n${session.start_time || ""}`
        ),
        el(
          "div",
          { class: "details" },
          el("div", { class: "title" }, session.title || "Workout"),
          session.summary ? el("div", {}, session.summary) : null,
          blocksText ? el("div", { class: "blocks" }, blocksText) : null
        ),
        el(
          "div",
          { class: "status" },
          statusButton(
            "Done",
            "success",
            session.completion_status === "completed",
            () =>
              updateSessionStatus(
                row,
                session.id,
                session.completion_status === "completed" ? null : "completed"
              )
          ),
          statusButton(
            "Miss",
            "danger",
            session.completion_status === "missed",
            () =>
              updateSessionStatus(
                row,
                session.id,
                session.completion_status === "missed" ? null : "missed"
              )
          ),
          statusButton(
            "Skip",
            "warning",
            session.completion_status === "skipped",
            () =>
              updateSessionStatus(
                row,
                session.id,
                session.completion_status === "skipped" ? null : "skipped"
              )
          )
        )
      );
      weekEl.appendChild(sessionEl);
    }
    detail.appendChild(weekEl);
  }
}

async function boot() {
  await bindLogout();
  const session = await hydrateUser();
  if (!session) return;
  try {
    await reloadPlans({ preserveSelection: false });
  } catch (error) {
    showToast("error", error.message || "Could not load plans.");
  }
}

boot().catch((error) => {
  console.error(error);
  showToast("error", error.message || "Unable to load workout planner.");
});
