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

// ── Display cache ─────────────────────────────────────────────────────
//
// The /app/ pages need the user's name + email + profile-state in the
// welcome hero / "Signed in as" chip. The source of truth is a network
// fetch (supabase.auth.getSession → getProfile RPC), which on a cold
// cache takes 300–800ms. That produced a flash where the HTML shipped
// "Welcome back, Member." / "Loading..." / "Checking profile..." for
// most of a second before the real data arrived.
//
// Fix: cache the display fields in localStorage and paint them
// synchronously at module load, *before* the async hydrate runs. For
// returning users this eliminates the flash entirely. For first-time
// users on a cleared browser we additionally fast-path via
// session.user.user_metadata (available right after getSession, which
// reads from localStorage) so the name appears as soon as auth resolves
// — no waiting for the profile RPC, which only matters for the
// "Profile complete" state.
const DISPLAY_CACHE_KEY = "emersus:display-cache";

function readDisplayCache() {
  try {
    const raw = localStorage.getItem(DISPLAY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function writeDisplayCache(data) {
  try {
    localStorage.setItem(DISPLAY_CACHE_KEY, JSON.stringify(data));
  } catch (_err) {
    // localStorage may be disabled in private mode — just skip.
  }
}

// Paint any display fields that are present on the page. Safe to call
// multiple times with different/updated values. Also unhides any parent
// marked [data-reveal-on-hydrate] so the HTML can ship with the name
// wrap / chip hidden (no "Welcome back, ." comma dangle on first paint).
//
// Two reveal scopes:
//   [data-reveal-on-hydrate]          → base, revealed on any paint
//   [data-reveal-when-profile-known]  → narrow, revealed only when a
//     non-empty profileState is supplied. Prevents the dashboard meta
//     row from showing "email · " with a dangling bullet on first-time
//     cold-cache loads while the getProfile() RPC is still in flight.
function paintDisplay({ name, email, profileState }) {
  if (typeof name === "string") {
    document.querySelectorAll("[data-user-name]").forEach((node) => {
      node.textContent = name;
    });
  }

  if (typeof email === "string") {
    document.querySelectorAll("[data-user-email]").forEach((node) => {
      node.textContent = email;
    });
  }

  if (typeof profileState === "string") {
    document.querySelectorAll("[data-profile-state]").forEach((node) => {
      node.textContent = profileState;
    });
  }

  document.querySelectorAll("[data-reveal-on-hydrate]").forEach((node) => {
    node.removeAttribute("hidden");
  });

  if (typeof profileState === "string" && profileState.length > 0) {
    document
      .querySelectorAll("[data-reveal-when-profile-known]")
      .forEach((node) => {
        node.removeAttribute("hidden");
      });
  }
}

function clearDisplayCache() {
  try {
    localStorage.removeItem(DISPLAY_CACHE_KEY);
  } catch (_err) {
    // noop
  }
}

// Module-load synchronous paint. ES modules run after DOMContentLoaded
// so the DOM is already parsed — this runs before the first awaited
// call below and before the user can visually perceive the placeholder.
// Cache is keyed by userId in the value so we can reject it post-hydrate
// if the signed-in user changed (e.g. user B logs in after user A on
// the same browser). The first paint still uses whatever's cached — we
// can't know the current userId synchronously — but the async hydrate
// below overwrites it as soon as requireAuth returns.
const cachedDisplay = readDisplayCache();
if (cachedDisplay) {
  paintDisplay(cachedDisplay);
}

async function hydrateUserSummary() {
  const session = await requireAuth();
  if (!session) {
    return null;
  }

  // Fast path: session.user.user_metadata is populated by Google OAuth
  // (full_name, name) and is available the moment getSession() returns.
  // Paint it immediately so the welcome hero has the real name without
  // waiting for the profile RPC.
  const metadataName =
    session.user.user_metadata?.full_name ||
    session.user.user_metadata?.name ||
    null;
  const email = session.user.email || "";
  const fastName =
    metadataName || cachedDisplay?.name || email || "";

  paintDisplay({
    name: fastName,
    email,
    // Keep the cached profile-state during the fast-path paint so we
    // don't flicker from "Profile complete" → blank → "Profile complete"
    // while the profile RPC is in flight.
    profileState:
      typeof cachedDisplay?.profileState === "string"
        ? cachedDisplay.profileState
        : "",
  });

  // Cross-user guard: if the cache was written for a different userId
  // (User B logs in on the same browser after User A), the module-load
  // paint above briefly showed stale data. Overwrite immediately with
  // the fast-path values so the flash is capped at a single frame.
  if (cachedDisplay && cachedDisplay.userId && cachedDisplay.userId !== session.user.id) {
    clearDisplayCache();
  }

  // Slow path: fetch profile for the canonical full_name (user may have
  // overridden the Google-provided name) and the onboarding state.
  const profile = await getProfile(session.user.id);
  const finalName = profile?.full_name || fastName;
  const finalProfileState = profile?.onboarding_completed
    ? "Profile complete"
    : "Profile incomplete";

  paintDisplay({
    name: finalName,
    email,
    profileState: finalProfileState,
  });

  writeDisplayCache({
    userId: session.user.id,
    name: finalName,
    email,
    profileState: finalProfileState,
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
      // Drop cached display fields before signOut so the next
      // authenticated session on this browser doesn't briefly paint the
      // previous user's name / email.
      clearDisplayCache();
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

  // Sharing & tracking settings — editable selects that save on change
  const sharingFields = [
    "display_name_public",
    "mapbox_privacy_radius_m",
    "default_pool_length_m",
    "default_grade_system",
    "distance_unit",
  ];

  for (const fieldName of sharingFields) {
    const el = form.elements.namedItem(fieldName);
    if (!el) continue;

    // Initialize from profile
    if (profile && profile[fieldName] != null) {
      el.value = String(profile[fieldName]);
    } else if (fieldName === "distance_unit") {
      // Locale fallback for distance_unit
      const { resolveDistanceUnit } = await import("/shared/unit-conversion.js");
      el.value = resolveDistanceUnit(null);
    }

    el.addEventListener("change", async () => {
      const raw = el.value;
      const statusEl = document.querySelector("[data-profile-status]");
      let value = raw;

      // Cast numbers
      if (fieldName === "mapbox_privacy_radius_m" || fieldName === "default_pool_length_m") {
        value = raw === "" ? null : Number(raw);
      }
      // Empty string → null for optional text fields
      if (raw === "" && fieldName === "display_name_public") value = null;
      if (raw === "" && fieldName === "default_grade_system") value = null;
      if (raw === "" && fieldName === "default_pool_length_m") value = null;

      try {
        await upsertProfile(session.user.id, { [fieldName]: value });
        setStatus(statusEl, "success", "Saved.");
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

// Inject a skip-to-main link + mobile nav hamburger if the page has an
// app shell. Idempotent — safe to run on every module load.
function mountShellAffordances() {
  const appShell = document.querySelector(".app-shell");
  if (!appShell) return;

  // Skip-to-main: prepend as the first focusable element so tabbing from
  // the address bar lands on it first.
  const mainPane = appShell.querySelector(".main") || appShell.querySelector("main");
  if (mainPane) {
    if (!mainPane.id) mainPane.id = "main";
    if (!document.querySelector(".skip-to-main")) {
      const skip = document.createElement("a");
      skip.className = "skip-to-main";
      skip.href = `#${mainPane.id}`;
      skip.textContent = "Skip to main content";
      document.body.insertBefore(skip, document.body.firstChild);
    }
    // Make the main pane programmatically focusable so the skip anchor
    // actually moves focus (anchors to non-focusable elements only scroll).
    if (!mainPane.hasAttribute("tabindex")) mainPane.setAttribute("tabindex", "-1");
  }

  // Mobile drawer hamburger: render once into the top bar. The open/close
  // state is a class on .app-shell; CSS handles the transform + scrim.
  const sidebar = appShell.querySelector(".sidebar");
  const topBar = appShell.querySelector(".top-bar");
  if (sidebar && topBar && !topBar.querySelector(".nav-toggle")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-toggle";
    btn.setAttribute("aria-label", "Open navigation");
    btn.setAttribute("aria-controls", "app-sidebar");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    topBar.insertBefore(btn, topBar.firstChild);

    if (!sidebar.id) sidebar.id = "app-sidebar";
    if (!sidebar.getAttribute("role")) sidebar.setAttribute("role", "navigation");
    if (!sidebar.getAttribute("aria-label")) sidebar.setAttribute("aria-label", "Main");

    // Scrim sits as a sibling to .sidebar; tapping it closes the drawer.
    let scrim = appShell.querySelector(".nav-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "nav-scrim";
      appShell.appendChild(scrim);
    }

    const setOpen = (open) => {
      appShell.classList.toggle("is-nav-open", !!open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    };

    btn.addEventListener("click", () => setOpen(!appShell.classList.contains("is-nav-open")));
    scrim.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && appShell.classList.contains("is-nav-open")) setOpen(false);
    });
    // Close when a nav link is clicked so the user lands on the destination.
    sidebar.addEventListener("click", (e) => {
      const link = e.target.closest("a, .section-item, [data-sidebar-close]");
      if (link) setOpen(false);
    });
  }
}

Promise.resolve()
  .then(mountShellAffordances)
  .then(bindLogout)
  .then(bindProfileForm)
  .then(hydrateDashboard)
  .catch((error) => {
    const status = document.querySelector("[data-profile-status]");
    setStatus(status, "error", error.message || "Unable to load account.");
  });
