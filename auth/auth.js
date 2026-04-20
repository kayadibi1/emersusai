// auth/auth.js — Phase 7 split-screen auth shell.
//
// Single page that renders 3 state-switched panels (login, signup, forgot).
// Reuses the existing /shared/auth-pages.js DOM-attribute wiring so
// Supabase login/forgot/signup logic stays unchanged — we just relocate the
// markup and add `data-auth-page` attribute on the panel root so auth-pages.js
// finds it.

import { parseAuthUrl, buildAuthUrl, PANELS } from "/shared/auth/url-state.js";

const root = document.getElementById("auth-root");
const state = { panel: parseAuthUrl(window.location.search).panel };

function googleSvg() {
  return `<svg class="oauth-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#EA4335" d="M9 3.48c1.69 0 2.85.73 3.5 1.34l2.54-2.48C13.46 1 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"/>
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.58 2.68-3.91 2.68-6.63z"/>
    <path fill="#FBBC05" d="M3.88 10.78A5.4 5.4 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.87.86-3.04.86-2.38 0-4.4-1.57-5.13-3.74L.96 13.04A9 9 0 0 0 9 18z"/>
  </svg>`;
}

function brandPane() {
  return `
    <aside class="auth-brand">
      <div class="auth-brand-grid" aria-hidden="true"></div>
      <div class="auth-brand-glow" aria-hidden="true"></div>
      <div class="auth-brand-inner">
        <a href="/" class="auth-brand-mark">EMERSUS</a>
        <h1 class="auth-brand-headline">Trained on the literature.</h1>
        <p class="auth-brand-sub">Over a million peer-reviewed papers. Every recommendation traced back to the study that justifies it. No hype, no marketing fluff — just evidence.</p>
        <div class="auth-brand-stats">
          <div class="auth-stat"><span class="auth-stat-num" data-stat="papers">—</span><span class="auth-stat-lbl">Papers indexed</span></div>
          <div class="auth-stat"><span class="auth-stat-num" data-stat="topics">302</span><span class="auth-stat-lbl">Topics covered</span></div>
          <div class="auth-stat"><span class="auth-stat-num">100%</span><span class="auth-stat-lbl">Verifiable claims</span></div>
        </div>
      </div>
    </aside>`;
}

function loginPanel() {
  return `
    <section class="auth-panel" data-auth-page="login">
      <header class="auth-panel-head">
        <h2>Log in</h2>
        <p>Continue to Emersus.</p>
      </header>

      <button class="oauth-btn" type="button" data-auth-oauth="google">
        ${googleSvg()}
        <span>Continue with Google</span>
      </button>
      <p class="auth-status" data-auth-oauth-status></p>

      <div class="oauth-divider"><span>or</span></div>

      <form class="auth-form" data-auth-login>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" inputmode="email" spellcheck="false" autocapitalize="off" required />
        </label>
        <label class="auth-field">
          <span class="auth-field-label-row">
            <span>Password</span>
            <button class="auth-show-toggle" type="button" data-toggle-pw>SHOW</button>
          </span>
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <label class="auth-remember">
          <input type="checkbox" name="remember" />
          <span>Remember for 30 days</span>
        </label>
        <button class="auth-primary" type="submit">Sign in →</button>
        <p class="auth-status" data-auth-status></p>
        <button class="auth-link" type="button" data-auth-resend hidden>Resend confirmation email</button>
      </form>

      <div class="auth-panel-foot">
        <a href="?panel=forgot" data-panel-link="forgot">Forgot password?</a>
        <p>Don't have an account? <a href="?panel=signup" data-panel-link="signup">Sign up →</a></p>
      </div>
    </section>`;
}

function signupPanel() {
  return `
    <section class="auth-panel" data-auth-page="signup">
      <header class="auth-panel-head">
        <h2>Get started with Emersus</h2>
        <p>Sign up to get started.</p>
      </header>

      <button class="oauth-btn" type="button" data-auth-oauth="google" data-auth-mode="signup">
        ${googleSvg()}
        <span>Continue with Google</span>
      </button>
      <p class="auth-status" data-auth-oauth-status></p>

      <div class="oauth-divider"><span>or</span></div>

      <form class="auth-form" data-auth-signup>
        <label class="auth-field">
          <span>Full name</span>
          <input type="text" name="full_name" autocomplete="name" />
        </label>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" inputmode="email" spellcheck="false" autocapitalize="off" required />
        </label>
        <label class="auth-field">
          <span class="auth-field-label-row">
            <span>Password</span>
            <button class="auth-show-toggle" type="button" data-toggle-pw>SHOW</button>
          </span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8" />
        </label>
        <button class="auth-primary" type="submit">Create Account</button>
        <p class="auth-status" data-auth-status></p>
        <button class="auth-link" type="button" data-auth-resend hidden>Resend confirmation email</button>
      </form>

      <p class="auth-tos">By signing up you agree to our <a href="/terms/">Terms</a> and <a href="/privacy/">Privacy Policy</a>.</p>

      <div class="auth-panel-foot">
        <p>Already have an account? <a href="?panel=login" data-panel-link="login">Log in →</a></p>
      </div>
    </section>`;
}

function forgotPanel() {
  return `
    <section class="auth-panel" data-auth-page="forgot">
      <header class="auth-panel-head">
        <h2>Forgot password</h2>
        <p>We'll email a reset link.</p>
      </header>

      <form class="auth-form" data-auth-forgot>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" inputmode="email" spellcheck="false" autocapitalize="off" required />
        </label>
        <p class="auth-helper">LINK EXPIRES AFTER 30 MINUTES FOR SECURITY.</p>
        <button class="auth-primary" type="submit">Send reset link →</button>
        <p class="auth-status" data-auth-status></p>
      </form>

      <div class="auth-panel-foot">
        <p><a href="?panel=login" data-panel-link="login">← Back to log in</a></p>
      </div>
    </section>`;
}

function panelFor(name) {
  switch (name) {
    case "login":  return loginPanel();
    case "signup": return signupPanel();
    case "forgot": return forgotPanel();
    default:       return loginPanel();
  }
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <div class="auth-shell">
      ${brandPane()}
      <main class="auth-stage">
        <div class="auth-stage-inner" data-panel-stage>
          ${panelFor(state.panel)}
        </div>
      </main>
    </div>`;
  wireEvents();
  void hydrateStats();
  if (state.panel === "forgot") wireForgot();
  ensureAuthPagesLoaded();
}

function wireEvents() {
  root.querySelectorAll("[data-panel-link]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      const next = el.getAttribute("data-panel-link");
      if (!PANELS.includes(next)) return;
      state.panel = next;
      window.history.pushState({}, "", buildAuthUrl(state) || window.location.pathname);
      render();
    });
  });

  root.querySelectorAll("[data-toggle-pw]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".auth-field")?.querySelector('input[type="password"], input[type="text"]');
      if (!input) return;
      const showing = input.getAttribute("type") === "text";
      input.setAttribute("type", showing ? "password" : "text");
      btn.textContent = showing ? "SHOW" : "HIDE";
    });
  });
}

// Hand login + signup + forgot panels to the shared auth-pages.js wiring.
// The module reads `data-auth-login`, `data-auth-signup`, `data-auth-oauth`,
// etc. and is idempotent across re-imports — we trigger it on first render
// and again on every panel switch so newly-mounted forms get bound.
function ensureAuthPagesLoaded() {
  import("/shared/auth-pages.js")
    .then((mod) => {
      if (typeof mod?.bindAuthForms === "function") mod.bindAuthForms();
    })
    .catch((err) => console.error("auth-pages load failed", err));
}

async function hydrateStats() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const config = await res.json();
    const papers = root.querySelector('[data-stat="papers"]');
    if (papers && config.corpus_papers) {
      papers.textContent = formatLargeNumber(config.corpus_papers);
    }
  } catch { /* ignore */ }
}

function formatLargeNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K+`;
  return String(n);
}

function wireForgot() {
  const form = root.querySelector('[data-auth-forgot]');
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const status = form.querySelector("[data-auth-status]");
    submitBtn.disabled = true;
    status.textContent = "Sending…";
    status.classList.remove("is-error");

    const email = form.querySelector('input[name="email"]').value;
    try {
      const { getSupabase } = await import("/shared/supabase.js");
      const supabase = await getSupabase();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password/`,
      });
      // Always success — never leak whether the email exists.
      form.innerHTML = `<div class="auth-success">CHECK YOUR INBOX<br/><span class="auth-success-sub">Link valid for 30 minutes.</span></div>`;
    } catch (err) {
      // Even on error, show success per security policy.
      form.innerHTML = `<div class="auth-success">CHECK YOUR INBOX<br/><span class="auth-success-sub">Link valid for 30 minutes.</span></div>`;
    }
  });
}

window.addEventListener("popstate", () => {
  const next = parseAuthUrl(window.location.search);
  state.panel = next.panel;
  render();
});

render();
