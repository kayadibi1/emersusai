# Frontend Redesign · Phase 7 · Auth (`/auth/**`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** Single split-screen shell with 4 state-switched panels (Log in · Request access · Forgot password · Set up account). Wire Google OAuth + email/password. Invite-landing flow leads into conversational onboarding.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "7. Auth" + "Behaviors · 6. Auth".
**Mockup:** `.superpowers/brainstorm/linear-landing/auth.html`.
**Feature flag:** `auth_v2`.

## File structure (proposed)

- **Modify:** `auth/login/index.html`, `auth/signup/index.html`, `auth/forgot-password/index.html`, `auth/reset-password/index.html` — each becomes a thin shell that mounts the same `<AuthShell panel="login|request|forgot|invite">` component
- **New:** `auth/auth-shell.js` — 55/45 split-screen layout with animated panel swap
- **New:** `auth/hero-pane.js` — left pane (brand, headline, stat tiles, grid bg + radial glow)
- **New:** `auth/panels/login.js`, `panels/request.js`, `panels/forgot.js`, `panels/invite.js`
- **New:** `auth/invite-landing/index.html` — URL `/auth/invite?token=...`
- **New:** `shared/auth-v2.css`
- **New:** `api/auth-request-access.js` — POST with optional invite code
- **New:** `api/auth-validate-invite.js` — GET `/api/auth/validate-invite?token=...`
- **New:** `api/auth-accept-invite.js` — POST `/api/auth/accept-invite { token, password }`

## Task outline (~16 tasks)

1. `auth_v2` flag + share the AuthShell across all auth routes
2. Hero pane — brand + "Trained on the literature." hero + 3 stat tiles
3. Panel swap animation — keyframe fade + 6px slide-up
4. Log in panel — Continue with Google + OR divider + email/password + Remember 30d + Forgot link
5. Log in panel — wire `POST /auth/v1/token?grant_type=password`
6. Log in panel — Google OAuth redirect to Supabase + callback
7. Request access panel — Continue with Google (waitlist vs login distinction) + manual form
8. Request access — backend: valid invite → redirect to `/auth/invite?token=...`; else waitlist position
9. Forgot password panel — send reset link (response always success)
10. Forgot password — `Resend in 60s ↻` cooldown
11. Set up account panel — token validation + pre-filled disabled email + password + accept-invite flow
12. Set up account — redirect to conversational onboarding (phase 9) on success
13. ToS/Privacy links where signing up
14. SHOW/HIDE mono buttons for password reveal
15. Error surfaces — inline field errors + top-right toast for transient issues
16. Flip flag default + tag

## Acceptance criteria

- Google OAuth works on both Log in and Request access.
- Invite token validation gates the Set up account form.
- Reset link email response is identical regardless of whether the email is registered (no leak).
- Remember-for-30-days toggle controls refresh-token TTL correctly.
- Both themes.
- Responsive: split-screen collapses to single-column below 900px.

## Open questions

- 2FA setup flow — spec flags this as "worth adding for health-data product", not mocked. → Defer to a separate phase 7b.
- Should the hero pane be statically rendered or fully themed? → Both palettes per spec.
