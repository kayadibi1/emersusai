# Email templates — design

Date: 2026-04-24
Status: Draft (awaiting user review)

## Summary

Build a branded email system that matches the current landing (Graphite·Jade dark, Space Grotesk + JetBrains Mono, eyebrow/title/body structure, single jade CTA). Ship 12 templates covering auth, billing, legal, data export, and one research alert. All templates render inline as JS functions, composed from a shared shell + a small helper kit. Every send is logged; Resend webhook events are captured; outbound CTAs are tracked via HMAC-signed redirects with UTM tags. Marketing emails get List-Unsubscribe + a suppression list.

## Goals

- One coherent visual language across every transactional email, matching the landing.
- 12 real, sendable templates wired into their actual call-sites (Supabase Auth, Polar webhooks, signup hook, legal batch script, export job handler, daily research-alert cron).
- Per-send logging + Resend delivery/complaint webhook → deliverability you can actually reason about.
- Click tracking + UTM attribution so PostHog can tie email opens to app activity.
- Replace `createEmailShell()` inlined in `api/notify-signup.js` (predates landing redesign).

## Non-goals

- Multiple palettes (dark only, fixed; no `prefers-color-scheme` adaptive version).
- Open-pixel tracking (Apple Mail Privacy Protection has made open rates ~meaningless).
- Full admin engagement dashboard (Resend's dashboard + raw `email_events` is enough for v1).
- Marketing campaign scheduling, drip sequences, A/B testing (out of scope).
- The long-tail emails from the catalogue (re-engagement, milestones, workout reminders, etc.) — covered by the shell but not implemented as senders in v1.

## File layout

```
api/lib/email/
  shell.js           renderEmail({ preheader, eyebrow, title, body, cta?, footer })
  tokens.js          frozen color/type constants (dark palette only)
  components.js      renderButton, renderCallout, renderStatRow, renderSourceRow,
                     renderDivider, renderCodeBlock, esc
  tracking.js        buildTrackedUrl({ sendId, target, utmCampaign })
  senders.js         sendAuthVerify, sendAuthWelcome, ... (12 functions)
  templates/
    auth-verify.js
    auth-reset.js
    auth-welcome.js
    auth-password-changed.js
    billing-receipt.js
    billing-renewal.js
    billing-payment-failed.js
    billing-cancellation.js
    legal-tos-update.js
    legal-privacy-update.js
    data-export-ready.js
    research-new-paper.js

api/email/
  webhook-resend.js       POST /api/email/webhook/resend
  track-click.js          GET  /api/email/track/click
  unsubscribe.js          GET  /api/email/unsubscribe

scripts/
  preview-emails.mjs      local preview → .email-preview/
  email-fixtures.js       shared fixture data for preview + tests
  test/email-templates.test.mjs
  test/send-test-email.mjs
  test/simulate-resend-webhook.mjs
  upload-resend-templates.mjs    push auth-verify + auth-reset to Resend

supabase/migrations/
  <timestamp>_email_tracking.sql   email_sends, email_events, email_unsubscribes

.email-preview/          gitignored
```

`api/notify-signup.js` ports to new shell (its local `createEmailShell` is deleted). `api/lib/resend-mail.js` is untouched.

## Design system

### Tokens (`api/lib/email/tokens.js`)

Frozen constants — inlined into every style attribute, since most clients don't honor CSS variables. Values mirror Graphite·Jade from `shared/design-tokens.css`.

```js
export const T = {
  bg:         '#0a0a0b',
  surface:    '#131315',
  surfaceAlt: '#18181b',
  ink:        '#ededee',
  muted:      '#c0c0c4',
  dim:        '#8a8a8f',
  line:       'rgba(255,255,255,0.10)',
  lineStrong: 'rgba(255,255,255,0.16)',
  accent:     '#34d399',
  accentInk:  '#04221a',
  accentLine: 'rgba(52,211,153,0.34)',
  danger:     '#f87171',
  warning:    '#fbbf24',
  stack: {
    sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  },
};
```

### Shell (`api/lib/email/shell.js`)

Signature: `renderEmail({ preheader, eyebrow, title, body, cta?, footer }) → string`

The produced HTML document contains, top to bottom:

1. `<!DOCTYPE html>` + `<html lang="en">`.
2. `<meta name="color-scheme" content="dark">` + `<meta name="supported-color-schemes" content="dark">` — asks clients not to auto-invert.
3. Minimal `<style>` block containing only: (a) a dark-mode body selector for clients that read it, (b) an `@media (max-width: 480px)` block that tightens horizontal padding. Everything else is inline.
4. Hidden preheader (`<div style="display:none; overflow:hidden; line-height:1; max-height:0; max-width:0; opacity:0;">…</div>`) padded with zero-width spaces (`​‌‍﻿`) to ~100 chars so Gmail doesn't pull body copy into the preview line.
5. Table-based 600px centered container (`<table role="presentation">` with `cellpadding/cellspacing="0"`) — the only cross-client-reliable layout model.
6. `T.bg` outer fill, `T.surface` inner card, 1px `T.accentLine` hairline on top.
7. Brand mark row: `em<b>∴</b>rsus` with `∴` in `T.accent`. Literal Unicode, no image.
8. Eyebrow row: 6px jade dot + uppercased eyebrow text, `T.stack.mono` 11px letter-spacing 0.18em, `T.accent` color.
9. `<h1>` title, `T.stack.sans` 28/1.15, tracking -0.02em, `T.ink`.
10. Body slot (raw HTML — templates compose from components).
11. Optional CTA via `renderButton()`.
12. Hairline, then footer row: "Sent to <email>" line + legal links, `T.stack.mono` 10px 0.12em small-caps, `T.dim`. Marketing footer adds unsubscribe link.

### Component helpers (`api/lib/email/components.js`)

All return HTML strings. All caller-supplied strings pass through `esc()`.

- `esc(str)` — HTML-entity escape (`&`, `<`, `>`, `"`, `'`).
- `renderButton({ label, href })` — table-wrapped "bulletproof" button, `T.accent` bg / `T.accentInk` text, 2px border-radius, 13/22 padding. Uses the `<table><tr><td>` wrapper pattern so Outlook honors it.
- `renderStatRow({ label, value })` — small-caps label above value, 16/18 padding, `T.surfaceAlt` fill + 1px `T.line` border. Multiple instances `.join('')`'d by caller.
- `renderSourceRow({ index, title, meta, href })` — mirrors landing "Card 1" source rows. Number + title + journal-year-kind + "Read →" link.
- `renderCallout({ tone, title?, body })` — `tone: 'info' | 'warning' | 'danger'`. Colored left border, tinted bg.
- `renderDivider()` — 1px `T.line` row with 24px vertical padding.
- `renderCodeBlock({ code })` — `T.stack.mono` 12px, `T.surfaceAlt` bg + 1px `T.line`, `word-break: break-all` for long tokens/URLs.

## Template inventory

Each is a file `api/lib/email/templates/<name>.js` exporting `render<Name>({...vars})` that returns the full HTML document via `renderEmail({...})`. Vars are plain inputs (strings, numbers, arrays of objects); no DB lookups inside render functions.

| # | Template | Subject (interpolated) | Eyebrow | Title | Body composition | CTA label | Class |
|---|---|---|---|---|---|---|---|
| 1 | `auth-verify` | Confirm your email | Account | Confirm your email. | paragraph + codeBlock fallback URL | Confirm email → | trans |
| 2 | `auth-reset` | Reset your Emersus password | Account | Reset your password. | paragraph + codeBlock fallback + warning callout ("ignore if you didn't request") | Reset password → | trans |
| 3 | `auth-welcome` | Welcome to Emersus | Account | You're in. | 3 statRows (Ask anything · Every answer cited · Start with…) + optional sample-prompts list | Open Emersus → | trans |
| 4 | `auth-password-changed` | Your password was changed | Account | Password changed. | statRows (when, device, location, IP) + danger callout ("didn't do this?") | I didn't do this → | trans |
| 5 | `billing-receipt` | Receipt from Emersus — $9.00 | Billing | Receipt. | statRows (plan, period, amount, card last-4) + invoice link + support line | View invoice → | trans |
| 6 | `billing-renewal` | Your Emersus subscription renews [date] | Billing | Renewal in 7 days. | statRows (plan, next charge, amount) + manage link + "cancel anytime" | Manage subscription → | trans |
| 7 | `billing-payment-failed` | We couldn't charge your card | Billing | Payment didn't go through. | warning callout + statRows (card last-4, reason) + retry window + dunning schedule | Update payment → | trans |
| 8 | `billing-cancellation` | Your subscription is cancelled | Billing | Cancellation confirmed. | statRows (access through [date], refund status) + "here's what you keep" list + win-back hint | Reactivate → | trans |
| 9 | `legal-tos-update` | Updated Terms of Service · effective [date] | Legal | We're updating our terms. | info callout (one-line summary) + bullet list of changes + effective date | Read the updated terms → | trans |
| 10 | `legal-privacy-update` | Updated Privacy Policy · effective [date] | Legal | Privacy policy update. | same shape as #9, privacy-scoped | Read the updated policy → | trans |
| 11 | `data-export-ready` | Your data export is ready | Data | Your export is ready. | statRows (size, rows, format) + warning callout (link expires in 7 days) + codeBlock checksum | Download export → | trans |
| 12 | `research-new-paper` | New paper on [topic]: [short title] | Research | New paper in your follow list. | one sourceRow (title, journal, year, grade) + 2-line abstract excerpt + "why this surfaced" line | Read on Emersus → | **marketing** |

Marketing-class templates get the `List-Unsubscribe` header + suppression check; transactional-class templates do not.

## Tracking infrastructure

### Tables (new migration)

```sql
-- Send log: one row per actual send
create table email_sends (
  id            uuid primary key default gen_random_uuid(),
  resend_id     text unique,               -- Resend API response id
  template      text not null,             -- 'auth-verify', etc.
  user_id       uuid references auth.users(id) on delete cascade,
  to_email      text not null,             -- denormalized; user may change email
  subject       text not null,
  tags          jsonb default '{}',
  sent_at       timestamptz not null default now()
);
create index on email_sends (user_id, sent_at desc);
create index on email_sends (template, sent_at desc);

-- Delivery/engagement events from Resend webhook
create table email_events (
  id            uuid primary key default gen_random_uuid(),
  send_id       uuid references email_sends(id) on delete cascade,
  resend_id     text not null,
  kind          text not null,             -- 'delivered'|'bounced'|'complained'|'opened'|'clicked'
  payload       jsonb not null,
  occurred_at   timestamptz not null
);
create index on email_events (send_id, occurred_at desc);
create index on email_events (kind, occurred_at desc);

-- Marketing suppression list (transactional ignores this)
create table email_unsubscribes (
  user_id         uuid references auth.users(id) on delete cascade,
  bucket          text not null,           -- 'research_alerts'|'engagement'|'all_marketing'
  source          text not null,           -- 'one_click'|'profile'|'complaint'
  unsubscribed_at timestamptz not null default now(),
  primary key (user_id, bucket)
);
```

RLS: tables are written server-side only (service role). Users can read their own `email_sends` + `email_unsubscribes` via authenticated SELECT policies; `email_events` is admin-only.

### Routes

- `POST /api/email/webhook/resend`
  - Verifies Svix signature (`webhook-id`, `webhook-timestamp`, `webhook-signature` headers) against `RESEND_WEBHOOK_SECRET`.
  - Parses `{ type, data: { email_id, created_at, ... } }`.
  - Finds `email_sends` by `resend_id = data.email_id`.
  - INSERTs `email_events` (send_id, kind derived from `type`, occurred_at, raw payload).
  - Idempotent on `(resend_id, kind, occurred_at)`.
  - On `email.complained` → upsert into `email_unsubscribes` (bucket='all_marketing', source='complaint').
  - Returns `202 Accepted` on success; throws on unexpected DB error so Resend retries (per `feedback_polar_webhook_id_header` — same Standard Webhooks retry semantics).

- `GET /api/email/track/click?m=<send_id>&to=<b64url-target>&k=<hmac>&utm_campaign=<tpl>`
  - HMAC-SHA256 over `send_id|to_raw` with `EMAIL_CLICK_SECRET`.
  - `crypto.timingSafeEqual` for comparison.
  - Invalid HMAC → 400 (prevents open-redirect abuse).
  - Valid → INSERT `email_events` (send_id, kind='clicked', payload={url: to_raw}) → 302 `Location: <decoded to with utm params preserved>`.

- `GET /api/email/unsubscribe?m=<send_id>&b=<bucket>&k=<hmac>`
  - Same HMAC scheme over `send_id|bucket`.
  - Idempotent upsert into `email_unsubscribes` (bucket, source='one_click').
  - Returns a minimal HTML "you're unsubscribed" page in brand style.
  - Also accepts `POST` with empty body to satisfy `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

Marketing-class sends attach two headers:

```
List-Unsubscribe: <https://emersus.ai/api/email/unsubscribe?m=…&b=…&k=…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

URL form only — no `mailto:` form, since we have one contact address and don't want to invent `unsub@`. Gmail/Yahoo bulk-sender rules accept the URL form on its own.

### Senders contract

```js
// api/lib/email/senders.js
async function sendEmail({
  template,          // 'auth-verify'
  userId,            // for suppression check + join
  to,                // target email
  subject,
  renderFn,          // () => html
  marketing = false,
  marketingBucket,   // 'research_alerts' | 'engagement' | null — required if marketing
  idempotencyKey,    // optional; skip send if key already in email_sends.tags
});
```

Flow: suppression check (marketing only) → idempotency check → `INSERT email_sends` → `sendResendEmail({ tags: [{name:'template'}, {name:'send_id'}, {name:'user_id'}] })` → `UPDATE email_sends SET resend_id`. Returns `{ sendId, resendId, skipped? }`.

Each of the 12 templates exports a sender: `sendAuthVerify(...)`, `sendBillingReceipt(...)`, etc. These are thin wrappers that lookup fixtures, call the render function, and pass the lot to `sendEmail`.

### Click URL builder

```js
// api/lib/email/tracking.js
buildTrackedUrl({ sendId, target, utmCampaign }) → string
```

Appends `?utm_source=email&utm_medium=transactional&utm_campaign=<tpl>&u=<user-id>` (or `utm_medium=marketing` for marketing class) to `target`, then wraps it in the tracked redirect URL with HMAC.

## Data flow

### Outbound

```
caller
  └─► senders.sendBillingReceipt({ userId, ... })
        1. lookup user + email
        2. suppression check (marketing only)
        3. renderBillingReceipt() → html
        4. INSERT email_sends → send_id
        5. build tracked CTA URLs (send_id + hmac + utm)
        6. sendResendEmail({ from, to, subject, html,
                             tags: [ template, send_id, user_id ] })
        7. UPDATE email_sends SET resend_id
```

### Inbound (Resend webhook)

```
Resend ──webhook──► POST /api/email/webhook/resend
                      1. verify svix signature
                      2. find email_sends by resend_id
                      3. INSERT email_events
                      4. on 'complained' → INSERT email_unsubscribes
                      5. return 202
```

### Click redirect

```
recipient click ──► GET /api/email/track/click?m=…&to=…&k=…
                      1. verify hmac
                      2. INSERT email_events (kind='clicked')
                      3. 302 Location: target (utm preserved)
```

## Integration points

| Template | Called from |
|---|---|
| `auth-verify`, `auth-reset` | Supabase Auth (exception — see below) |
| `auth-welcome` | `api/notify-signup.js` (existing) |
| `auth-password-changed` | New `api/auth/webhook.js` listening to Supabase Auth `user.updated` events with `password_updated_at` change |
| `billing-receipt` | `api/billing/webhook.js` on Polar `order.paid` event |
| `billing-renewal` | New cron in emersus-worker: queries `user_subscriptions` for renewals 7 days out; once per subscription-renewal-cycle (idempotency key = `renewal:<sub_id>:<cycle_end>`) |
| `billing-payment-failed` | `api/billing/webhook.js` on Polar `subscription.updated` when status flips to past_due |
| `billing-cancellation` | `api/billing/webhook.js` on Polar `subscription.canceled` |
| `legal-tos-update`, `legal-privacy-update` | Operator-triggered: `node scripts/send-legal-update.mjs --template tos-update --date 2026-05-15 --summary "..."` batches over all users |
| `data-export-ready` | New job handler `jobs/export-user-data.js` on completion (job itself out of scope here; template assumes it exists) |
| `research-new-paper` | New daily cron `research-alerts.js` in emersus-worker: matches new `research_articles` against `user_topic_follows`, one email per match, suppression-checked |

### Supabase Auth exception

Verify + reset *must* be uploaded to Resend as hosted templates — Supabase renders them itself via SMTP, so we can't intercept the outbound. Resolution:

1. Render `auth-verify` and `auth-reset` locally with a template-variable placeholder syntax Resend understands (e.g., `{{ .ConfirmationURL }}`).
2. `scripts/upload-resend-templates.mjs` posts the rendered HTML to Resend's Templates API, writes the returned IDs to `.env.resend-templates` (gitignored) + copies to the Supabase dashboard's Auth email-template settings (manual one-time step).
3. Local preview + tests still use the same source file; the upload script is the only difference from the other 10 templates.

Because Supabase sends these directly, `email_sends` rows are NOT created for them — we cannot track the `user_id`/`send_id` pair. These two templates are the only ones without full tracking coverage. Accepted trade-off.

## Testing & preview

### Local preview

`scripts/preview-emails.mjs`:

```bash
node scripts/preview-emails.mjs            # renders all 12 with fixture data
node scripts/preview-emails.mjs receipt    # substring filter on template name
```

For each matched template, writes `./.email-preview/<template>.html` from a fixture in `scripts/email-fixtures.js`. Also writes `./.email-preview/index.html` linking to them. `.email-preview/` is gitignored.

### Unit tests (`scripts/test/email-templates.test.mjs`)

For each of the 12 render functions with fixture input:

- Returns non-empty HTML string.
- Contains expected title text.
- CTA `href` present, HTTPS-only, contains `utm_campaign=<template>`.
- Preheader present and non-empty.
- User-supplied string escaping: fixture injects `<script>alert(1)</script>` and `" onclick="x"` into `name`; assert neither appears raw in output.

Plus:

- `esc()` golden tests (canonical inputs/outputs).
- `buildTrackedUrl()` round-trip: sign → verify passes; tamper `to` → verify fails; tamper `sendId` → verify fails.
- Constant-time HMAC compare (asserts `crypto.timingSafeEqual` in use).

### Integration test (manual)

`scripts/test/send-test-email.mjs --template <name> --to <email>` — renders + actually sends via Resend to a real inbox. Used once per template during rollout; not in CI.

### Webhook test

`scripts/test/simulate-resend-webhook.mjs` posts fake `email.delivered` / `.bounced` / `.complained` / `.clicked` payloads with valid Svix signatures → assert `email_events` rows land + `.complained` creates `email_unsubscribes`.

### Real-client QA before shipping

Before cutover, send each template to a test address and eyeball in:

1. Gmail web (dark mode on)
2. Apple Mail macOS (dark mode)
3. iOS Mail (iPhone)
4. Outlook desktop Windows

No automation — 15 min per template. Screenshots stored next to this spec if anything is off.

## Rollout

1. Migration: `email_sends`, `email_events`, `email_unsubscribes` (additive; safe).
2. Ship `api/lib/email/` shell + components + all 12 templates.
3. Ship the three routes: webhook, track-click, unsubscribe.
4. Configure Resend webhook to point at `/api/email/webhook/resend` with shared secret in `.env`.
5. Upload `auth-verify` + `auth-reset` to Resend; swap Supabase Auth email-template settings to use the hosted IDs.
6. Port `api/notify-signup.js` off its local `createEmailShell` onto the new senders (`sendAuthWelcome`).
7. Wire Polar webhooks → billing templates.
8. Wire the password-changed webhook → `sendAuthPasswordChanged`.
9. Add renewal-reminder + research-alert cron jobs to emersus-worker; register with pg-boss.
10. Operator tool `scripts/send-legal-update.mjs` for ad-hoc legal updates.
11. Real-client QA.

## Rollback

- New shell, templates, webhook, routes are additive. No existing sender breaks.
- Individual senders can be flipped back to the old inline `createEmailShell` by comment-toggling the import (only relevant for `notify-signup.js`).
- DB migrations are additive — no reversal needed unless we want to drop `email_sends` later (we won't).
- If Resend webhook misbehaves: disable the webhook in the Resend dashboard; delivery events stop flowing but sending continues.

## Open questions

- **Sender domain.** Send as `noreply@emersus.ai` or `mail@emersus.ai` (more human)? Decide before DNS + DKIM/SPF setup.
- **"Reply-To" policy.** Point replies to `info@emersus.ai` for every template so users can actually talk back? (Leaning yes — consistent with the one-contact-email rule.)
- **Render fixtures.** Where do fixtures come from for the integration test? Propose a seed user `email-test@emersus.ai` with known data.
- **Renewal cadence.** Only 7-day warning, or also 3-day + 1-day? v1 is 7-day only unless called out otherwise.
- **Password-change detection on self-hosted Supabase.** Supabase Auth Hooks (pg-based Send Email hook) may not be available on our self-hosted version. Fallback: a daily diff job comparing `auth.users.encrypted_password` or `updated_at` against a shadow table. Confirm availability during implementation.

## Memory-driven constraints

- Commit prompt is skipped for this spec file — all `.md` files are gitignored by design (memory: `feedback_local_md_docs.md`).
- Webhook signature verification follows Standard Webhooks spec — idempotency key from `webhook-id` header, throw on unexpected DB errors so Resend retries (memory: `feedback_polar_webhook_id_header.md`).
- Only one contact email: `info@emersus.ai` — no `support@`, `billing@`, `privacy@` addresses invented (memory: `reference_contact_email.md`).
- Senders that are *not* chat-tier-related MUST NOT call `userRateLimit()` — use `readTier(userId)` if tier is needed (memory: `feedback_userratelimit_is_chat_only.md`).
- Unsub + click routes MUST NOT call `userRateLimit()` (same rule).
