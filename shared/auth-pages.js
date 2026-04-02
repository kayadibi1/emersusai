import {
  getAuthCallbackUrl,
  getSupabase,
  readAuthFlowFromUrl,
  redirectIfAuthenticated,
  resolveNextPath,
  setStatus,
} from "/shared/supabase.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bindSignupForm() {
  const form = document.querySelector("[data-auth-signup]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("full_name") || "").trim();
    const submitButton = form.querySelector('button[type="submit"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email)) {
      setStatus(status, "error", "Enter a valid email address.");
      return;
    }

    if (password.length < 8) {
      setStatus(status, "error", "Use at least 8 characters for your password.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Creating Account...";

    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
          data: {
            full_name: fullName || null,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        window.location.replace(resolveNextPath("/app/"));
        return;
      }

      form.reset();
      setStatus(
        status,
        "success",
        "Check your inbox to confirm your email and finish setting up your account."
      );
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to create your account.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Create Account";
    }
  });
}

function bindLoginForm() {
  const form = document.querySelector("[data-auth-login]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const submitButton = form.querySelector('button[type="submit"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email) || !password) {
      setStatus(status, "error", "Enter your email and password to continue.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Signing In...";

    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      window.location.replace(resolveNextPath("/app/"));
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to sign you in.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Log In";
    }
  });
}

function bindForgotPasswordForm() {
  const form = document.querySelector("[data-auth-forgot]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const submitButton = form.querySelector('button[type="submit"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email)) {
      setStatus(status, "error", "Enter a valid email address.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Sending...";

    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getAuthCallbackUrl(),
      });

      if (error) {
        throw error;
      }

      form.reset();
      setStatus(
        status,
        "success",
        "Password reset link sent. Check your inbox for the next step."
      );
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to send reset email.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Send Reset Link";
    }
  });
}

function bindResetPasswordForm() {
  const form = document.querySelector("[data-auth-reset]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    const submitButton = form.querySelector('button[type="submit"]');

    setStatus(status, "", "");

    if (password.length < 8) {
      setStatus(status, "error", "Use at least 8 characters for your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus(status, "error", "Your passwords do not match.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Updating...";

    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      form.reset();
      setStatus(status, "success", "Password updated. Redirecting to your app...");
      window.setTimeout(() => {
        window.location.replace("/app/");
      }, 900);
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to update your password.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Update Password";
    }
  });
}

async function handleCallbackPage() {
  const callbackNode = document.querySelector("[data-auth-callback]");
  if (!callbackNode) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  try {
    const supabase = await getSupabase();
    const flow = readAuthFlowFromUrl();

    if (flow.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(flow.code);
      if (error) {
        throw error;
      }
    }

    if (flow.accessToken && flow.refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: flow.accessToken,
        refresh_token: flow.refreshToken,
      });

      if (error) {
        throw error;
      }
    }

    if (flow.type === "recovery") {
      setStatus(status, "success", "Recovery confirmed. Redirecting to reset password...");
      window.location.replace("/auth/reset-password/");
      return;
    }

    setStatus(status, "success", "Authentication confirmed. Redirecting...");
    window.location.replace(resolveNextPath("/app/"));
  } catch (error) {
    setStatus(status, "error", error.message || "Unable to finish authentication.");
  }
}

async function boot() {
  const page = document.body.dataset.page;
  if (page === "login" || page === "signup" || page === "forgot-password") {
    await redirectIfAuthenticated("/app/");
  }

  if (page === "reset-password") {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus(
        document.querySelector("[data-auth-status]"),
        "error",
        "Use the password reset link from your email to open this page."
      );
    }
  }

  bindSignupForm();
  bindLoginForm();
  bindForgotPasswordForm();
  bindResetPasswordForm();
  await handleCallbackPage();
}

boot().catch((error) => {
  const status = document.querySelector("[data-auth-status]");
  setStatus(status, "error", error.message || "Authentication setup failed.");
});
