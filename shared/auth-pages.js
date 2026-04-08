import {
  getAuthCallbackUrl,
  getSupabase,
  readAuthFlowFromUrl,
  redirectIfAuthenticated,
  resolveNextPath,
  setStatus,
} from "/shared/supabase.js";
import { isAllowedEmailDomain } from "/shared/auth-email-allowlist.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_PROVIDER_MESSAGE =
  "That email provider isn't supported yet. Please use a mainstream provider like Gmail, Outlook, iCloud, or your ISP's address.";

function normalizeAuthMessage(message = "") {
  return String(message || "").toLowerCase();
}

function updateResendButton(form, email = "", visible = false) {
  const resendButton = form?.querySelector("[data-auth-resend]");
  if (!(resendButton instanceof HTMLButtonElement)) {
    return;
  }

  resendButton.hidden = !visible;
  resendButton.dataset.email = email;
}

function bindResendConfirmation(form, status) {
  const resendButton = form?.querySelector("[data-auth-resend]");
  const emailInput = form?.querySelector('input[name="email"]');

  if (!(resendButton instanceof HTMLButtonElement) || !(emailInput instanceof HTMLInputElement)) {
    return;
  }

  emailInput.addEventListener("input", () => {
    if (resendButton.hidden) {
      return;
    }

    resendButton.dataset.email = emailInput.value.trim().toLowerCase();
  });

  resendButton.addEventListener("click", async () => {
    const email = (resendButton.dataset.email || emailInput.value || "").trim().toLowerCase();

    setStatus(status, "", "");

    if (!emailPattern.test(email)) {
      setStatus(status, "error", "Enter your email first so we know where to resend the confirmation.");
      return;
    }

    resendButton.disabled = true;
    const previousText = resendButton.textContent;
    resendButton.textContent = "Resending...";

    try {
      const supabase = await getSupabase();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
        },
      });

      if (error) {
        throw error;
      }

      setStatus(status, "success", "Confirmation email sent. Check your inbox for a fresh link.");
    } catch (error) {
      setStatus(status, "error", error.message || "Unable to resend confirmation email.");
    } finally {
      resendButton.disabled = false;
      resendButton.textContent = previousText;
    }
  });
}

function bindOAuthButtons() {
  const buttons = document.querySelectorAll("[data-auth-oauth]");
  if (!buttons.length) {
    return;
  }

  const status = document.querySelector("[data-auth-oauth-status]");

  buttons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.addEventListener("click", async () => {
      const provider = button.dataset.authOauth;
      if (!provider) {
        return;
      }

      setStatus(status, "", "");
      const previousText = button.querySelector("span")?.textContent;
      const labelSpan = button.querySelector("span");
      button.disabled = true;
      if (labelSpan) {
        labelSpan.textContent = "Redirecting...";
      }

      try {
        const supabase = await getSupabase();
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: getAuthCallbackUrl(),
          },
        });

        if (error) {
          throw error;
        }
        // On success the browser is redirected to Google — no further work.
      } catch (error) {
        setStatus(
          status,
          "error",
          error.message || `Unable to continue with ${provider}.`
        );
        button.disabled = false;
        if (labelSpan && previousText) {
          labelSpan.textContent = previousText;
        }
      }
    });
  });
}

function bindSignupForm() {
  const form = document.querySelector("[data-auth-signup]");
  if (!form) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");
  bindResendConfirmation(form, status);

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

    if (!isAllowedEmailDomain(email)) {
      setStatus(status, "error", BLOCKED_PROVIDER_MESSAGE);
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
      updateResendButton(form, email, true);
      setStatus(
        status,
        "success",
        "Check your inbox to confirm your email and finish setting up your account. If it does not arrive, use Resend Confirmation Email."
      );
    } catch (error) {
      const message = error.message || "Unable to create your account.";
      const normalized = normalizeAuthMessage(message);
      updateResendButton(form, email, normalized.includes("confirm") || normalized.includes("already") || normalized.includes("exists"));
      setStatus(status, "error", message);
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
  bindResendConfirmation(form, status);

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
      const message = error.message || "Unable to sign you in.";
      const normalized = normalizeAuthMessage(message);
      updateResendButton(
        form,
        email,
        normalized.includes("confirm") || normalized.includes("not confirmed")
      );
      setStatus(status, "error", message);
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

function readOAuthErrorFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const error =
    searchParams.get("error") ||
    searchParams.get("error_code") ||
    hashParams.get("error") ||
    hashParams.get("error_code");
  const description =
    searchParams.get("error_description") || hashParams.get("error_description");
  if (!error && !description) return null;
  return {
    code: error || "",
    description: description ? decodeURIComponent(description).replace(/\+/g, " ") : "",
  };
}

async function handleCallbackPage() {
  const callbackNode = document.querySelector("[data-auth-callback]");
  if (!callbackNode) {
    return;
  }

  const status = document.querySelector("[data-auth-status]");

  // Supabase redirects here with error params in the URL when an OAuth
  // signup is blocked by a server-side trigger (e.g. the email-provider
  // allowlist). Catch those before attempting the code exchange so the
  // user sees a useful message instead of getting stuck.
  const oauthError = readOAuthErrorFromUrl();
  if (oauthError) {
    const desc = oauthError.description.toLowerCase();
    const looksLikeAllowlistRejection =
      desc.includes("database error saving new user") ||
      desc.includes("email provider") ||
      desc.includes("not supported for signups");
    const message = looksLikeAllowlistRejection
      ? "That email provider isn't supported for signups yet. Please use a mainstream provider like Gmail, Outlook, iCloud, or your ISP's address."
      : oauthError.description || "We couldn't finish signing you in. Please try again.";
    setStatus(status, "error", message);
    window.setTimeout(() => {
      window.location.replace("/auth/login/");
    }, 4500);
    return;
  }

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

  bindOAuthButtons();
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
