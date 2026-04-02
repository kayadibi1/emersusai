import {
  getProfile,
  getSupabase,
  requireAuth,
  setStatus,
  upsertProfile,
} from "/shared/supabase.js";

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
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-profile-status]");
  const hydrated = await hydrateUserSummary();
  if (!hydrated) {
    return;
  }

  const { session, profile } = hydrated;

  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      const field = form.elements.namedItem(key);
      if (field && typeof value === "string") {
        field.value = value;
      }
    }
  }

  if (!form.elements.namedItem("email").value) {
    form.elements.namedItem("email").value = session.user.email || "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
    setStatus(status, "", "");

    try {
      await upsertProfile(session.user.id, {
        email: String(formData.get("email") || session.user.email || "").trim().toLowerCase(),
        full_name: String(formData.get("full_name") || "").trim() || null,
        goal: String(formData.get("goal") || "").trim() || null,
        experience_level: String(formData.get("experience_level") || "").trim() || null,
        dietary_preferences:
          String(formData.get("dietary_preferences") || "").trim() || null,
        injuries_limitations:
          String(formData.get("injuries_limitations") || "").trim() || null,
        onboarding_completed: true,
      });

      setStatus(status, "success", "Profile saved.");
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to save your profile.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Save Profile";
    }
  });
}

async function hydrateDashboard() {
  const dashboardNode = document.querySelector("[data-dashboard]");
  if (!dashboardNode) {
    return;
  }

  await hydrateUserSummary();
}

Promise.resolve()
  .then(bindLogout)
  .then(bindProfileForm)
  .then(hydrateDashboard)
  .catch((error) => {
    const status = document.querySelector("[data-profile-status]");
    setStatus(status, "error", error.message || "Unable to load account.");
  });
