// auth/auth.js — Phase 7 split-screen auth shell.
//
// Single page that renders 4 state-switched panels (login, request, forgot,
// invite). Reuses the existing /shared/auth-pages.js DOM-attribute wiring so
// Supabase login/forgot/signup logic stays unchanged — we just relocate the
// markup and add `data-auth-page` attribute on the panel root so auth-pages.js
// finds it.

import { parseAuthUrl, buildAuthUrl, PANELS } from "/shared/auth/url-state.js?v=redesign-7";

const root = document.getElementById("auth-v2-root");
const state = { panel: parseAuthUrl(window.location.search).panel, token: parseAuthUrl(window.location.search).token };

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
        <a href="/" class="auth-brand-mark"><img src="/emersus-logo.png" alt="Emersus" /></a>
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
          <input type="email" name="email" autocomplete="email" required />
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
        <p>Don't have access? <a href="?panel=request" data-panel-link="request">Request private beta →</a></p>
        <p class="auth-foot-muted">Just got an invite? <a href="?panel=invite" data-panel-link="invite">Set up account →</a></p>
      </div>
    </section>`;
}

function requestPanel() {
  return `
    <section class="auth-panel" data-auth-page="request">
      <header class="auth-panel-head">
        <h2>Request access</h2>
        <p>Emersus is in private beta.</p>
      </header>

      <button class="oauth-btn" type="button" data-auth-oauth="google" data-auth-mode="request">
        ${googleSvg()}
        <span>Request access with Google</span>
      </button>

      <div class="oauth-divider"><span>or</span></div>

      <form class="auth-form" data-auth-request>
        <label class="auth-field">
          <span>Full name</span>
          <input type="text" name="name" autocomplete="name" required />
        </label>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" required />
        </label>
        <label class="auth-field">
          <span>Invite code <span class="auth-field-hint">(optional)</span></span>
          <input type="text" name="invite_code" placeholder="EM-8X4K-9PQR" autocomplete="off" />
        </label>
        <p class="auth-helper">WE'LL EMAIL YOU TO SET YOUR PASSWORD ONCE ACCESS IS APPROVED.</p>
        <button class="auth-primary" type="submit">Request access →</button>
        <p class="auth-status" data-auth-status></p>
      </form>

      <div class="auth-callout">
        <strong>Beta perks include:</strong> wearable sync, recipe library, and exercise videos as they ship.
      </div>

      <p class="auth-tos">By requesting access you agree to our <a href="/terms/">Terms</a> and <a href="/privacy/">Privacy Policy</a>.</p>

      <div class="auth-panel-foot">
        <p>Already have access? <a href="?panel=login" data-panel-link="login">Log in →</a></p>
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
          <input type="email" name="email" autocomplete="email" required />
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

function invitePanel(token) {
  const tokenAttr = token ? ` data-token="${token.replace(/"/g, '&quot;')}"` : "";
  return `
    <section class="auth-panel" data-auth-page="invite"${tokenAttr}>
      <header class="auth-panel-head">
        <h2>Set up account</h2>
        <p>Welcome — let's finish setting up.</p>
      </header>

      <div class="auth-invite-status" data-invite-status>Validating your invite…</div>

      <button class="oauth-btn" type="button" data-auth-oauth="google" data-auth-mode="invite" hidden>
        ${googleSvg()}
        <span>Continue with Google</span>
      </button>

      <div class="oauth-divider" hidden><span>or</span></div>

      <form class="auth-form" data-auth-invite hidden>
        <label class="auth-field">
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" disabled />
        </label>
        <label class="auth-field">
          <span class="auth-field-label-row">
            <span>Password</span>
            <button class="auth-show-toggle" type="button" data-toggle-pw>SHOW</button>
          </span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8" />
        </label>
        <button class="auth-primary" type="submit">Complete setup →</button>
        <p class="auth-status" data-auth-status></p>
      </form>
    </section>`;
}

function panelFor(name, token) {
  switch (name) {
    case "login":   return loginPanel();
    case "request": return requestPanel();
    case "forgot":  return forgotPanel();
    case "invite":  return invitePanel(token);
    default:        return loginPanel();
  }
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <div class="auth-shell">
      ${brandPane()}
      <main class="auth-stage">
        <div class="auth-stage-inner" data-panel-stage>
          ${panelFor(state.panel, state.token)}
        </div>
      </main>
    </div>`;
  wireEvents();
  void hydrateStats();
  if (state.panel === "invite") void wireInvite();
  if (state.panel === "request") wireRequest();
  if (state.panel === "forgot") wireForgot();
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

  // Hand the login panel off to the existing /shared/auth-pages.js wiring on
  // first render. The module reads `data-auth-login`, `data-auth-oauth`, etc.
  // and is idempotent across re-imports.
  if (state.panel === "login" && !window.__emersusAuthPagesLoaded) {
    window.__emersusAuthPagesLoaded = true;
    import("/shared/auth-pages.js").catch((err) => console.error("auth-pages load failed", err));
  }
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

async function wireInvite() {
  const panel = root.querySelector('[data-auth-page="invite"]');
  if (!panel) return;
  const token = panel.getAttribute("data-token") || state.token;
  const status = panel.querySelector("[data-invite-status]");
  const oauth = panel.querySelector('[data-auth-oauth]');
  const divider = panel.querySelector(".oauth-divider");
  const form = panel.querySelector('[data-auth-invite]');

  if (!token) {
    status.textContent = "Missing invite token. Use the link from your invitation email.";
    status.classList.add("is-error");
    return;
  }

  try {
    const res = await fetch(`/api/auth/validate-invite?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      status.textContent = body.error || "This invite link is invalid or expired.";
      status.classList.add("is-error");
      return;
    }
    const { email } = await res.json();
    status.hidden = true;
    oauth.hidden = false;
    divider.hidden = false;
    form.hidden = false;
    form.querySelector('input[name="email"]').value = email;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = form.querySelector('input[name="password"]').value;
      const submitBtn = form.querySelector('button[type="submit"]');
      const fStatus = form.querySelector("[data-auth-status]");
      submitBtn.disabled = true;
      fStatus.textContent = "Setting up…";
      fStatus.classList.remove("is-error");
      try {
        const acceptRes = await fetch("/api/auth/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        if (!acceptRes.ok) {
          const body = await acceptRes.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${acceptRes.status}`);
        }
        window.location.href = "/app/?onboarding=1";
      } catch (err) {
        fStatus.textContent = err.message || "Could not complete setup.";
        fStatus.classList.add("is-error");
        submitBtn.disabled = false;
      }
    });
  } catch (err) {
    status.textContent = "Could not reach the server.";
    status.classList.add("is-error");
  }
}

function wireRequest() {
  const form = root.querySelector('[data-auth-request]');
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const status = form.querySelector("[data-auth-status]");
    submitBtn.disabled = true;
    status.textContent = "Submitting…";
    status.classList.remove("is-error");

    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch("/api/auth/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (body.status === "invited" && body.next) {
        window.location.href = body.next;
        return;
      }
      const position = body.position ? `· POSITION #${body.position}` : "";
      form.innerHTML = `<div class="auth-success">YOU'RE ON THE WAITLIST ${position}<br/><span class="auth-success-sub">We'll email you when a spot opens.</span></div>`;
    } catch (err) {
      status.textContent = err.message || "Could not submit your request.";
      status.classList.add("is-error");
      submitBtn.disabled = false;
    }
  });
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
  state.token = next.token;
  render();
});

render();
