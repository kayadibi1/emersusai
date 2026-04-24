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
const OAUTH_DEBOUNCE_MS = 2000;

function normalizeAuthMessage(message = "") {
  return String(message || "").toLowerCase();
}

function markFieldInvalid(field) {
  if (!(field instanceof HTMLElement)) return;
  field.setAttribute("aria-invalid", "true");
  if (field.dataset.ariaInvalidBound === "1") return;
  field.dataset.ariaInvalidBound = "1";
  const clear = () => field.removeAttribute("aria-invalid");
  field.addEventListener("input", clear);
  field.addEventListener("change", clear);
}

function focusInvalid(field, status) {
  const target = field instanceof HTMLElement ? field : status;
  if (!(target instanceof HTMLElement)) return;
  try {
    target.focus({ preventScroll: false });
  } catch (_err) {
    target.focus();
  }
}

const NOTIFY_SIGNUP_FLAG_PREFIX = "emersus:signup-notified:";

/**
 * Fire a non-blocking POST to /api/notify-signup so the operator gets an
 * email alert for each new account. Server-side validates by checking
 * Supabase auth.users for a recently-created match — the client is not
 * trusted. Failures are silently swallowed (logged server-side).
 */
function notifyAdminOfSignup({ email, full_name, provider }) {
  if (!email) return;
  try {
    // Debounce: don't ping twice for the same email within a session.
    const key = NOTIFY_SIGNUP_FLAG_PREFIX + email.toLowerCase();
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch (_err) {
    // sessionStorage unavailable (private mode etc.) — proceed anyway
  }
  // Fire and forget — don't await, don't block
  fetch("/api/notify-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.toLowerCase(),
      full_name: full_name || null,
      provider: provider || "email",
    }),
    keepalive: true,
  }).catch(() => {
    // Suppress — server logs failures
  });
}

/**
 * After an OAuth redirect lands on /auth/callback/ or wherever the
 * user ends up, check whether this session's user is brand new (created
 * within the last 5 minutes). If so, fire the signup notification once.
 * Idempotent per email via sessionStorage.
 */
async function maybeNotifyFreshOAuthUser() {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return;
    const user = data.user;
    if (!user.email) return;

    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    const ageMs = Date.now() - createdAt;
    // Only notify for users created in the last 5 minutes — matches the
    // server-side recency window in api/notify-signup.js.
    if (!createdAt || ageMs > 5 * 60 * 1000) return;

    const provider =
      user.app_metadata?.provider ||
      user.identities?.[0]?.provider ||
      "oauth";
    notifyAdminOfSignup({
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      provider,
    });
  } catch (_err) {
    // Non-fatal
  }
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
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";

    button.addEventListener("click", async () => {
      const provider = button.dataset.authOauth;
      if (!provider) {
        return;
      }

      const now = Date.now();
      const lastClickAt = Number(button.dataset.lastClickAt || 0);
      if (lastClickAt && now - lastClickAt < OAUTH_DEBOUNCE_MS) {
        return;
      }
      button.dataset.lastClickAt = String(now);

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
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const status = document.querySelector("[data-auth-status]");
  bindResendConfirmation(form, status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("full_name") || "").trim();
    const submitButton = form.querySelector('button[type="submit"]');
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email)) {
      markFieldInvalid(emailInput);
      setStatus(status, "error", "Enter a valid email address.");
      focusInvalid(emailInput, status);
      return;
    }

    if (!(await isAllowedEmailDomain(email))) {
      markFieldInvalid(emailInput);
      setStatus(status, "error", BLOCKED_PROVIDER_MESSAGE);
      focusInvalid(emailInput, status);
      return;
    }

    if (password.length < 8) {
      markFieldInvalid(passwordInput);
      setStatus(status, "error", "Use at least 8 characters for your password.");
      focusInvalid(passwordInput, status);
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

      // Detect "user already registered" — Supabase returns 200 with a
      // user object whose `identities` array is empty (vs a non-empty
      // array for real new signups). This is Supabase's enumeration-
      // resistant response shape. Treating it as "check your inbox"
      // strands the user in a dead state waiting for an email that will
      // never arrive. Instead: send them a password-reset link via our
      // branded template so they can actually recover the account.
      const identities = data?.user?.identities;
      const isRepeatSignup =
        !!data?.user && !data.session && Array.isArray(identities) && identities.length === 0;

      if (isRepeatSignup) {
        try {
          await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: getAuthCallbackUrl(),
          });
        } catch (_resetErr) {
          // Non-fatal — still show the user a useful message
        }
        form.reset();
        updateResendButton(form, email, false);
        setStatus(
          status,
          "success",
          "This email is already registered. We've sent a password-reset link so you can sign in — check your inbox."
        );
        return;
      }

      // Fire-and-forget admin notification. We don't await it, don't
      // handle errors, don't block the signup UX — notify-signup is
      // server-validated and failures are logged server-side.
      notifyAdminOfSignup({ email, full_name: fullName, provider: "email" });

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
      focusInvalid(null, status);
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
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const status = document.querySelector("[data-auth-status]");
  bindResendConfirmation(form, status);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const submitButton = form.querySelector('button[type="submit"]');
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email) || !password) {
      const firstInvalid = !emailPattern.test(email) ? emailInput : passwordInput;
      if (!emailPattern.test(email)) markFieldInvalid(emailInput);
      if (!password) markFieldInvalid(passwordInput);
      setStatus(status, "error", "Enter your email and password to continue.");
      focusInvalid(firstInvalid, status);
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
      focusInvalid(null, status);
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
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const submitButton = form.querySelector('button[type="submit"]');
    const emailInput = form.querySelector('input[name="email"]');

    setStatus(status, "", "");

    if (!emailPattern.test(email)) {
      markFieldInvalid(emailInput);
      setStatus(status, "error", "Enter a valid email address.");
      focusInvalid(emailInput, status);
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
      focusInvalid(null, status);
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
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const status = document.querySelector("[data-auth-status]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    const submitButton = form.querySelector('button[type="submit"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const confirmInput = form.querySelector('input[name="confirm_password"]');

    setStatus(status, "", "");

    if (password.length < 8) {
      markFieldInvalid(passwordInput);
      setStatus(status, "error", "Use at least 8 characters for your new password.");
      focusInvalid(passwordInput, status);
      return;
    }

    if (password !== confirmPassword) {
      markFieldInvalid(confirmInput);
      setStatus(status, "error", "Your passwords do not match.");
      focusInvalid(confirmInput, status);
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
      focusInvalid(null, status);
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
  let cleaned = "";
  if (description) {
    const decoded = decodeURIComponent(description).replace(/\+/g, " ");
    cleaned = decoded.replace(/[^\w\s.,!'?:;()\-—]/g, "").slice(0, 200);
  }
  return {
    code: (error || "").replace(/[^\w\-]/g, "").slice(0, 64),
    description: cleaned,
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

  async function resolveAuthDestination(session, flowType) {
    const defaultDest = resolveNextPath("/app/");
    const accessToken = session?.access_token;
    const createdAtIso = session?.user?.created_at;
    if (!accessToken || !createdAtIso) return defaultDest;

    const createdMs = new Date(createdAtIso).getTime();
    // isRecent covers OAuth new-signups (the whole dance takes <10s).
    // isSignupConfirmation covers email-verification new-signups: the user
    // waits for the email, opens it, and clicks — easily >60s after creation.
    const isRecent = Number.isFinite(createdMs) && Date.now() - createdMs < 60_000;
    const isSignupConfirmation = flowType === "signup";
    if (!isRecent && !isSignupConfirmation) return defaultDest;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch("/api/profile/", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return defaultDest;
      const profile = await response.json();
      if (profile && profile.onboarding_completed === false) {
        return resolveNextPath("/app/?onboarding=1");
      }
    } catch (err) {
      // Network blip, abort, etc. — fall back to default so returning users don't get stuck.
      console.warn("resolveAuthDestination: profile fetch failed, defaulting", err);
    }
    return defaultDest;
  }

  try {
    const supabase = await getSupabase();
    const flow = readAuthFlowFromUrl();

    let session = null;

    if (flow.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(flow.code);
      if (error) {
        throw error;
      }
      session = data?.session ?? null;
    }

    if (flow.accessToken && flow.refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: flow.accessToken,
        refresh_token: flow.refreshToken,
      });

      if (error) {
        throw error;
      }
      session = data?.session ?? session;
    }

    if (flow.type === "recovery") {
      setStatus(status, "success", "Recovery confirmed. Redirecting to reset password...");
      window.location.replace("/auth/reset-password/");
      return;
    }

    // If this OAuth round-trip produced a brand-new user, fire the
    // admin signup notification. Non-blocking and idempotent per email
    // via sessionStorage, so replayed callbacks don't double-send.
    maybeNotifyFreshOAuthUser();

    setStatus(status, "success", "Authentication confirmed. Redirecting...");
    const destination = await resolveAuthDestination(session, flow.type);
    window.location.replace(destination);
  } catch (error) {
    setStatus(status, "error", error.message || "Unable to finish authentication.");
  }
}

function markAuthReady() {
  document.body.setAttribute("data-auth-ready", "true");
}

async function boot() {
  const page = document.body.dataset.page;

  bindOAuthButtons();
  bindSignupForm();
  bindLoginForm();
  bindForgotPasswordForm();
  bindResetPasswordForm();

  // login/signup/forgot-password pages ship with .auth-main hidden via
  // CSS (site.css — "Auth redirect flicker guard") so a signed-in user
  // visiting /auth/login/ doesn't see the form paint before being
  // bounced to /app/. If the async session check says "not signed in"
  // we reveal the form. If it says "signed in" redirectIfAuthenticated
  // does window.location.replace and this function unwinds without
  // ever setting data-auth-ready — the hidden form stays hidden until
  // the page unloads.
  if (page === "login" || page === "signup" || page === "forgot-password") {
    // If the session probe stalls, reveal the form anyway so the page
    // never gets stuck showing only the header/banner.
    const revealTimer = window.setTimeout(() => {
      markAuthReady();
    }, 1200);
    const redirected = await redirectIfAuthenticated("/app/");
    window.clearTimeout(revealTimer);
    if (redirected) {
      return;
    }
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

  markAuthReady();
  await handleCallbackPage();
}

boot().catch((error) => {
  // Safety net: if boot() threw before reaching the data-auth-ready
  // assignment, reveal the form anyway so the user isn't stuck staring
  // at a blank page. The error (if any) will still surface via the
  // auth-status line below.
  markAuthReady();
  const status = document.querySelector("[data-auth-status]");
  setStatus(status, "error", error.message || "Authentication setup failed.");
});

// Re-bindable entry for SPA-style panel switching (auth/auth.js mounts
// a different form per panel). Each bind* function is idempotent via a
// `data-bound="1"` attribute on the form/button so calling this on every
// render won't double-attach listeners.
export function bindAuthForms() {
  bindOAuthButtons();
  bindSignupForm();
  bindLoginForm();
  bindForgotPasswordForm();
}
