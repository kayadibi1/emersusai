# Frontend Redesign · Phase 7 · Auth (`/auth/**`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Goal:** Replace the 4 separate auth pages (`/auth/login`, `/auth/signup`, `/auth/reset-password`, `/auth/forgot-password`, `/auth/callback`) with a **single split-screen shell** that switches panels client-side: **Log in · Request access · Forgot password · Set up account**. Wire Google OAuth (already configured) + email/password. Invite-landing flow goes straight into conversational onboarding.

**Scope rule:** Reskin auth flow only. Don't touch Supabase auth backend. Existing `auth-email-allowlist.js` + check-email handler stay.

**Spec:** § "7. Auth" + "Behaviors · 6. Auth".
**Mockup:** `.superpowers/brainstorm/linear-landing/auth.html`.
**Prerequisite:** Phases 2+3 shipped.

**Branch strategy:** `auth_v2` flag. Old auth pages keep working until Task 8.

---

## File structure

- **New:** `auth/index-v2.html` — single shell loaded for all auth state
- **New:** `auth/auth.js` — panel-state machine
- **New:** `shared/auth/login-panel.js`
- **New:** `shared/auth/request-access-panel.js`
- **New:** `shared/auth/forgot-panel.js`
- **New:** `shared/auth/invite-panel.js`
- **New:** `shared/auth/brand-pane.js` — left 55% pane (wordmark + headline + 3 stat tiles)
- **New:** `shared/auth-v2.css`
- **New:** `api/auth/request-access.js` — `POST /api/auth/request-access { name, email, invite_code? }`
- **New:** `api/auth/validate-invite.js` — `GET /api/auth/validate-invite?token=...`
- **New:** `api/auth/accept-invite.js` — `POST /api/auth/accept-invite { token, password }`
- **Modify:** `server.js`, `vite.config.js`
- **Modify:** old auth/{login,signup,forgot-password,reset-password,callback}/index.html — when `auth_v2` on, redirect to `/auth/` with `?panel=` hint

---

## Task 1: Page shell + panel state machine

- [ ] **Step 1:** `auth/index-v2.html` mounts `<AuthApp/>`. Reads `?panel=login|request|forgot|invite&token=...` from URL.
- [ ] **Step 2:** `<AuthApp/>` renders `<BrandPane/>` (left 55%) + state-switched right panel (45%, max-width 400px). Panel switch via `setPanel(name)` + `pushState`. Animation: 240ms fade+slide keyframe.
- [ ] **Step 3: Commit** `feat(auth-v2): page shell + panel state machine`

---

## Task 2: Brand pane

- [ ] **Step 1:** `<BrandPane/>` — wordmark + hero "Trained on the literature." + subhead + 3 stat tiles (papers / topics / verifiable %). Subtle grid background + radial accent glow.
- [ ] **Step 2:** Stat tile values from `/api/config` (already an endpoint).
- [ ] **Step 3: Commit** `feat(auth-v2): brand pane`

---

## Task 3: Login panel

- [ ] **Step 1:** `<LoginPanel/>`:
  - `Continue with Google` → existing OAuth redirect.
  - OR divider.
  - Email + password (with `SHOW`/`HIDE` mono toggles).
  - `Remember for 30 days` checkbox (defaults off).
  - `Forgot password?` → switch panel to forgot.
  - `Sign in →` → existing `POST /auth/v1/token` flow.
  - On error: inline `INCORRECT EMAIL OR PASSWORD` + field highlight (don't say which one).
  - Footer: `Don't have access? Request private beta →` + muted `Just got an invite? Set up account →`.
- [ ] **Step 2: Commit** `feat(auth-v2): login panel`

---

## Task 4: Request access panel + endpoint

- [ ] **Step 1:** Server: `POST /api/auth/request-access { name, email, invite_code? }`. If `invite_code` matches a row in `invites` table, returns `{ status: 'invited', next: '/auth/?panel=invite&token=...' }`. Else appends to waitlist + returns `{ status: 'waitlist', position: N }`.
- [ ] **Step 2:** UI: `Continue with Google` (creates a waitlist entry, doesn't log in) + manual form (name + email + optional invite code) + helper `WE'LL EMAIL YOU TO SET YOUR PASSWORD ONCE ACCESS IS APPROVED` + ToS/Privacy links + beta notice callout.
- [ ] **Step 3: Commit** `feat(auth-v2): request access panel`

---

## Task 5: Forgot password panel

- [ ] **Step 1:** `<ForgotPanel/>` — email field + `Send reset link →` → `POST /auth/v1/recover` (existing). Always success state (don't leak email existence): `CHECK YOUR INBOX · LINK VALID FOR 30 MINUTES`. `Resend in 60s ↻` button after 60s grace.
- [ ] **Step 2: Commit** `feat(auth-v2): forgot password panel`

---

## Task 6: Invite landing + endpoints

- [ ] **Step 1:** Server: `GET /api/auth/validate-invite?token=...` returns `{ email, expires_at }` or 401. `POST /api/auth/accept-invite { token, password }` creates account + signs in + returns session.
- [ ] **Step 2:** UI: `<InvitePanel/>` — pre-filled disabled email + password (`SHOW`/`HIDE`) + `Continue with Google` (token-bound OAuth) + `Complete setup →`. On success → redirect to `/app/?onboarding=1`.
- [ ] **Step 3: Commit** `feat(auth-v2): invite landing panel`

---

## Task 7: auth-v2.css

- [ ] **Step 1:** Port auth.html mockup CSS, scoped `[data-auth-v2="1"]`.
- [ ] **Step 2:** Audit. Commit.

---

## Task 8: Old-auth-page redirects + flip default + tag

- [ ] **Step 1:** Each old auth/{login,signup,forgot-password,reset-password}/index.html: if `resolveFlag('auth_v2')` is on, redirect to `/auth/?panel=<inferred>` with same query string preserved.
- [ ] **Step 2:** Flip `DEFAULT_FLAGS.auth_v2 = true`. Update flag tests.
- [ ] **Step 3:** Tag `redesign-phase-7-auth`.
- [ ] **Step 4: Commit** `feat(auth-v2): default to true + redirects`

---

## Acceptance criteria

1. `/auth/` renders the login panel by default.
2. Panel switch animation (240ms fade+slide) plays.
3. Google OAuth still redirects to `/app` after success.
4. Email/password sign-in works with the existing endpoint.
5. Forgot-password always returns the same success message.
6. Invite token validation rejects expired/bad tokens.
7. Accepting invite redirects to `/app/?onboarding=1`.
8. `auth_v2=0` falls back to the old per-page routes.
