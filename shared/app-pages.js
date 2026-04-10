import {
  getProfile,
  getSupabase,
  listWorkoutPlans,
  requireAuth,
  setStatus,
  upsertProfile,
} from "/shared/supabase.js";
import {
  findTodaysSession,
  formatTodaysSessionCopy,
  sessionHasLoggedActuals,
} from "/shared/workout-plan-selectors.js";
import { resolveWeightUnit } from "/shared/unit-conversion.js";

async function hydrateUserSummary() {
  const session = await requireAuth();
  if (!session) {
    return null;
  }

  const profile = await getProfile(session.user.id);
  const fallbackName =
    profile?.full_name ||
    session.user.user_metadata?.full_name ||
    session.user.email ||
    "Member";

  document.querySelectorAll("[data-user-email]").forEach((node) => {
    node.textContent = session.user.email || "Authenticated user";
  });

  document.querySelectorAll("[data-user-name]").forEach((node) => {
    node.textContent = fallbackName;
  });

  document.querySelectorAll("[data-profile-state]").forEach((node) => {
    node.textContent = profile?.onboarding_completed ? "Profile complete" : "Profile incomplete";
  });

  return {
    session,
    profile,
  };
}

async function bindLogout() {
  const button = document.querySelector("[data-auth-logout]");
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Logging Out...";

    try {
      const supabase = await getSupabase();
      await supabase.auth.signOut();
      window.location.replace("/auth/login/");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Log Out";
    }
  });
}

async function bindProfileForm() {
  const form = document.querySelector("[data-profile-form]");
  if (!form) return;

  const hydrated = await hydrateUserSummary();
  if (!hydrated) return;

  const { session, profile } = hydrated;

  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      const field = form.elements.namedItem(key);
      if (field && typeof value === "string") {
        field.value = value;
      }
    }

    // Compose training schedule from days + minutes for display.
    const days = profile.available_days_per_week;
    const mins = profile.available_minutes_per_session;
    const scheduleField = form.elements.namedItem("training_schedule");
    if (scheduleField && (days || mins)) {
      const parts = [];
      if (days) parts.push(`${days} days/week`);
      if (mins) parts.push(`${mins} min/session`);
      scheduleField.value = parts.join(", ");
    }
  }

  if (!form.elements.namedItem("email").value) {
    form.elements.namedItem("email").value = session.user.email || "";
  }

  // Weight unit: editable select that saves on change.
  const weightSelect = form.querySelector("[data-weight-unit-select]");
  if (weightSelect) {
    // Initialize: explicit profile value wins, else locale default
    weightSelect.value = resolveWeightUnit(profile?.weight_unit);
    weightSelect.addEventListener("change", async () => {
      const newValue = weightSelect.value;
      const statusEl = document.querySelector("[data-profile-status]");
      try {
        await upsertProfile(session.user.id, { weight_unit: newValue });
        setStatus(statusEl, "success", `Weight unit set to ${newValue}.`);
      } catch (err) {
        setStatus(statusEl, "error", `Could not save: ${err.message || err}`);
      }
    });
  }

  // No submit handler — the form is read-only. The submit button has been
  // replaced with a link to chat.
}

async function hydrateDashboard() {
  const dashboardNode = document.querySelector("[data-dashboard]");
  if (!dashboardNode) {
    return;
  }

  const summary = await hydrateUserSummary();
  if (!summary) return;

  await hydrateTodaysWorkoutCard(summary.session);
}

// Phase 1.5 dashboard "Today's workout" card. Reads the user's saved
// plans, picks the most relevant session via findTodaysSession(), and
// renders into the data-today-card slot. Four states:
//   - no plans:        empty state, link to chat
//   - today + logged:  success chip, link to /app/workout/ detail
//   - today + open:    big primary CTA into the mobile session view
//   - upcoming only:   "Next up" copy with date + link to mobile view
async function hydrateTodaysWorkoutCard(session) {
  const card = document.querySelector("[data-today-card]");
  if (!card) return;
  const labelEl = card.querySelector("[data-today-label]");
  const titleEl = card.querySelector("[data-today-title]");
  const metaEl = card.querySelector("[data-today-meta]");
  const actionsEl = card.querySelector("[data-today-actions]");
  if (!titleEl || !metaEl || !actionsEl) return;

  function setEmpty() {
    if (labelEl) labelEl.textContent = "Workout planner";
    titleEl.textContent = "No plans yet";
    metaEl.textContent = "Generate your first workout plan in chat. Emersus will build it around your goal, experience, and available days.";
    actionsEl.innerHTML = "";
    const cta = document.createElement("a");
    cta.className = "button button-primary";
    cta.href = "/chat/";
    cta.textContent = "Generate a plan";
    actionsEl.appendChild(cta);
  }

  function setError(message) {
    if (labelEl) labelEl.textContent = "Today's workout";
    titleEl.textContent = "Couldn't load your plans";
    metaEl.textContent = message || "Try refreshing in a moment.";
    actionsEl.innerHTML = "";
  }

  let plans = [];
  try {
    plans = await listWorkoutPlans(session.user.id);
  } catch (error) {
    setError(error?.message || "Could not reach Supabase.");
    return;
  }

  if (!plans.length) {
    setEmpty();
    return;
  }

  const result = findTodaysSession(plans);
  if (!result) {
    // User has plans but every session is in the past. Treat as "all caught up".
    if (labelEl) labelEl.textContent = "Workout planner";
    titleEl.textContent = "All caught up";
    metaEl.textContent = "No upcoming sessions in your saved plans. Generate a fresh block in chat when you're ready.";
    actionsEl.innerHTML = "";
    const link = document.createElement("a");
    link.className = "button button-secondary";
    link.href = "/app/workout/";
    link.textContent = "Open planner";
    actionsEl.appendChild(link);
    return;
  }

  const { plan: planRow, session: targetSession, status } = result;
  const copy = formatTodaysSessionCopy(result);
  const sessionDeepLink = `/app/workout/session/?plan=${encodeURIComponent(planRow.id)}&session=${encodeURIComponent(targetSession.id)}`;

  const isLogged = sessionHasLoggedActuals(targetSession) || targetSession.completion_status === "completed";

  if (labelEl) labelEl.textContent = status === "today" ? "Today's workout" : "Up next";
  titleEl.textContent = copy.title;
  metaEl.textContent = copy.meta || (planRow.title || "");

  actionsEl.innerHTML = "";

  if (isLogged) {
    // Already done — render a calmer card with a check label.
    if (labelEl) labelEl.textContent = "Today · Completed";
    metaEl.textContent = `${targetSession.title || "Workout"} is in the bag. Open the planner to review your sets.`;
    const link = document.createElement("a");
    link.className = "button button-secondary";
    link.href = "/app/workout/";
    link.textContent = "View session";
    actionsEl.appendChild(link);
    return;
  }

  // Big primary CTA into the mobile session view.
  const startBtn = document.createElement("a");
  startBtn.className = "button button-primary";
  startBtn.href = sessionDeepLink;
  startBtn.textContent = status === "today" ? "Start session" : "Open session";
  actionsEl.appendChild(startBtn);

  // Secondary "open planner" link, in case the user wants the calendar view.
  const plannerLink = document.createElement("a");
  plannerLink.className = "button button-secondary";
  plannerLink.href = "/app/workout/";
  plannerLink.textContent = "Open planner";
  actionsEl.appendChild(plannerLink);
}

Promise.resolve()
  .then(bindLogout)
  .then(bindProfileForm)
  .then(hydrateDashboard)
  .catch((error) => {
    const status = document.querySelector("[data-profile-status]");
    setStatus(status, "error", error.message || "Unable to load account.");
  });
