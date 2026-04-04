import { getProfile, requireAuth, setStatus } from "/shared/supabase.js";

const form = document.querySelector("[data-emersus-form]");
const status = document.querySelector("[data-emersus-status]");
const output = document.querySelector("[data-emersus-output]");
const profilePreview = document.querySelector("[data-emersus-profile]");
const submitButton = document.querySelector("[data-emersus-submit]");

function renderJson(target, value) {
  if (!target) {
    return;
  }

  target.textContent = JSON.stringify(value, null, 2);
}

async function hydrateProfile() {
  const session = await requireAuth();

  if (!session) {
    return null;
  }

  const profile = await getProfile(session.user.id);
  const preview = {
    goal: profile?.goal || "",
    experience_level: profile?.experience_level || "",
    dietary_preferences: profile?.dietary_preferences || "",
    injuries_limitations: profile?.injuries_limitations || "",
  };

  renderJson(profilePreview, preview);
  return { session, profile: preview };
}

async function submitRequest(event) {
  event.preventDefault();

  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const question = String(formData.get("question") || "").trim();
  const userId = String(formData.get("userId") || "").trim();
  const payload = {
    question,
    userId,
    includeDebug: true,
    profile: {
      goal: String(formData.get("goal") || "").trim(),
      experience_level: String(formData.get("experience_level") || "").trim(),
      dietary_preferences: String(formData.get("dietary_preferences") || "").trim(),
      injuries_limitations: String(formData.get("injuries_limitations") || "").trim(),
      equipment_access: String(formData.get("equipment_access") || "").trim(),
      available_days_per_week: String(formData.get("available_days_per_week") || "").trim(),
      available_minutes_per_session: String(
        formData.get("available_minutes_per_session") || ""
      ).trim(),
      sleep_stress_context: String(formData.get("sleep_stress_context") || "").trim(),
      medical_disclaimer_acknowledged:
        formData.get("medical_disclaimer_acknowledged") === "on",
    },
  };

  if (!question) {
    setStatus(status, "error", "Add a question first.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Running...";
  setStatus(status, "", "");

  try {
    const response = await fetch("/api/emersus/recommendation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Unable to get a recommendation.");
    }

    renderJson(output, data);
    setStatus(status, "success", "Recommendation generated.");
  } catch (error) {
    setStatus(status, "error", error.message || "Request failed.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Run Emersus";
  }
}

Promise.resolve()
  .then(hydrateProfile)
  .then((result) => {
    if (!result) {
      return;
    }

    const { session, profile } = result;
    const userId = `supabase:${session.user.id}`;
    const userIdField = form?.elements.namedItem("userId");
    const goalField = form?.elements.namedItem("goal");
    const experienceField = form?.elements.namedItem("experience_level");
    const dietField = form?.elements.namedItem("dietary_preferences");
    const injuriesField = form?.elements.namedItem("injuries_limitations");

    if (userIdField) {
      userIdField.value = userId;
    }

    if (goalField && profile.goal) {
      goalField.value = profile.goal;
    }

    if (experienceField && profile.experience_level) {
      experienceField.value = profile.experience_level;
    }

    if (dietField && profile.dietary_preferences) {
      dietField.value = profile.dietary_preferences;
    }

    if (injuriesField && profile.injuries_limitations) {
      injuriesField.value = profile.injuries_limitations;
    }
  })
  .catch((error) => {
    setStatus(status, "error", error.message || "Unable to load profile.");
  });

form?.addEventListener("submit", submitRequest);
