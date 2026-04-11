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
  getProfile,
  getSession,
  getSupabase,
  listWorkoutPlans,
  requireAuth,
  setStatus,
  undoLastWorkoutPlanChange,
} from "/shared/supabase.js";
import { DAY_LABELS, summarizeBlocks, summarizePlan } from "/shared/workout-plan-schema.js";
import { downloadPlanIcs } from "/shared/workout-plan-ics.js";
import { fetchDashboard, dateRange } from "/shared/progress-helpers.js";
import { formatVolume } from "/shared/progress-charts.js";
import { resolveWeightUnit } from "/shared/unit-conversion.js";

// ---------------------------------------------------------------------------
// Session view routing helpers
// ---------------------------------------------------------------------------

// Map session category → session view URL
function sessionViewUrl(plan, session) {
  const firstBlock = session.blocks?.[0];
  const category =
    session.category ||
    firstBlock?.category ||
    inferCategoryFromName(firstBlock?.name || "") ||
    "resistance";

  const params = `?plan=${encodeURIComponent(plan.id)}&session=${encodeURIComponent(session.id)}`;

  switch (category) {
    case "cardio":   return `/app/workout/cardio/${params}`;
    case "swimming": return `/app/workout/swim/${params}`;
    case "climbing": return `/app/workout/climb/${params}`;
    default:         return `/app/workout/session/${params}`;
  }
}

function inferCategoryFromName(name) {
  const n = (name || "").toLowerCase();
  if (!n) return null;
  if (/run|jog|cycl|bike|walk|hike|elliptic|row|stair|treadmill/.test(n)) return "cardio";
  if (/swim|freestyle|backstroke|breaststroke|butterfly|medley/.test(n)) return "swimming";
  if (/climb|boulder|sport.+route|trad|top.?rope/.test(n)) return "climbing";
  return null;
}

const state = {
  session: null,
  plans: [],
  selectedPlanId: null,
  weightUnit: "kg",
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

  // Stats strip — async, updates text once data arrives.
  const statsText = el("span", { class: "plan-stats-text", id: "plan-stats-text" }, "Loading stats…");
  const statsStrip = el(
    "div",
    { class: "plan-stats-strip" },
    statsText,
    el("a", { href: "/app/progress/", class: "plan-stats-link" }, "View progress")
  );
  detail.appendChild(statsStrip);
  const { start, end } = dateRange(52);
  fetchDashboard(state.session.user.id, start, end)
    .then((d) => {
      if (d) {
        statsText.textContent = `${d.sessions_completed || 0} sessions · ${formatVolume(d.total_volume_kg || 0, state.weightUnit)} volume`;
      } else {
        statsText.textContent = "";
      }
    })
    .catch(() => {
      statsText.textContent = "";
    });

  // Action row: discuss in chat, .ics download, undo, archive.
  const actions = el("div", { class: "workout-action-row" });
  actions.appendChild(
    el(
      "a",
      { href: `/chat/?open_plan=${encodeURIComponent(row.id)}`, class: "primary" },
      "Discuss in chat"
    )
  );
  // Phase 1.5: Open in mobile view → /app/workout/session/?plan=...&session=...
  // Picks the next un-logged session as the deep-link target so the user can
  // jump straight into their next workout. Falls back to the first session
  // if everything's already logged.
  const nextUnlogged =
    sessions.find(
      (s) => !Array.isArray(s.completed_blocks) || s.completed_blocks.length === 0
    ) || sessions[0];
  if (nextUnlogged) {
    actions.appendChild(
      el(
        "a",
        {
          href: sessionViewUrl(row, nextUnlogged),
        },
        "Open mobile session view"
      )
    );
  }
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
        {
          class: "detail-sub plan-notes",
          style:
            "font-size:13px;color:var(--ink);line-height:1.55;white-space:pre-wrap;background:var(--surface-soft);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 18px",
        },
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
      const warmupsText =
        Array.isArray(session.warmup_blocks) && session.warmup_blocks.length > 0
          ? summarizeBlocks(session.warmup_blocks)
          : "";
      const hasLoggedActuals =
        Array.isArray(session.completed_blocks) && session.completed_blocks.length > 0;
      const sessionDeepLink = sessionViewUrl(row, session);
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
          el(
            "div",
            { class: "title" },
            // Click the title to open this session in the mobile view.
            el(
              "a",
              {
                href: sessionDeepLink,
                style: "color:var(--ink);text-decoration:none",
                title: "Open in mobile session view",
              },
              session.title || "Workout"
            )
          ),
          session.summary ? el("div", {}, session.summary) : null,
          warmupsText
            ? el(
                "div",
                {
                  class: "blocks",
                  style: "margin-top:6px;color:var(--muted);font-size:11px",
                },
                "Warm-up:\n" + warmupsText
              )
            : null,
          blocksText
            ? el(
                "div",
                {
                  class: "blocks",
                  style: warmupsText ? "margin-top:6px" : "",
                },
                (warmupsText ? "Working sets:\n" : "") + blocksText
              )
            : null,
          hasLoggedActuals
            ? el(
                "div",
                {
                  class: "blocks",
                  style: "margin-top:8px;color:var(--secondary);font-size:11px;font-weight:500",
                },
                `\u2713 ${session.completed_blocks.length} block${session.completed_blocks.length === 1 ? "" : "s"} logged`
              )
            : null
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
  // Resolve weight unit from profile (or locale fallback)
  try {
    const profile = await getProfile(session.user.id);
    state.weightUnit = resolveWeightUnit(profile?.weight_unit);
  } catch (_err) {
    state.weightUnit = resolveWeightUnit(null);
  }
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
