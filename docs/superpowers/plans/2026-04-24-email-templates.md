# Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 12 branded email templates (auth + billing + legal + data-export + one research alert) on a shared Graphite·Jade shell, with per-send logging, Resend webhook ingestion, HMAC-signed click tracking, UTM tagging, and a one-click unsubscribe for marketing emails.

**Architecture:** One shell renderer + six helper components in `api/lib/email/`. Each template is a pure render function composed from helpers. A `sendEmail` facade writes to `email_sends`, attaches Resend tags, and invokes the existing `sendResendEmail` wrapper. Delivery/engagement events come back through a Resend webhook and land in `email_events`. Click tracking is a signed 302 redirect through `/api/email/track/click`. Marketing emails get a `List-Unsubscribe` header pointing at `/api/email/unsubscribe`.

**Tech Stack:** Node 22 ESM, Express 5, Supabase self-hosted (Postgres 15 + pgvector), Resend (existing `api/lib/resend-mail.js`), `svix` for webhook signature verification, `node:crypto` HMAC. Rendering is pure template literals — no MJML, no React Email.

**Spec:** `docs/superpowers/specs/2026-04-24-email-templates-design.md`

---

## Conventions for every task

- Every code file uses ES module syntax (`import` / `export`), forward-slash paths, Bash on Windows (not PowerShell).
- Every user-supplied string passes through `esc()` before landing in the template — no exceptions.
- Every test file ends with `.test.mjs` and is launched via `node --test <file>` (native test runner already used elsewhere in `scripts/test/`).
- Every task ends with an **explicit** `git add <paths>` + `git commit -m` step listing **only** non-`.md` files. All `.md` files in this repo are gitignored by design; never `git add` them.
- The test runner is invoked from the project root `C:\Users\Sidar\Desktop\emersus` with `node --test scripts/test/<file>`.
- No `cd` in Bash commands — use absolute paths.

---

## File Structure

**New files:**
- `api/lib/email/tokens.js` — frozen color/type constants
- `api/lib/email/components.js` — `esc`, `renderButton`, `renderStatRow`, `renderSourceRow`, `renderCallout`, `renderDivider`, `renderCodeBlock`
- `api/lib/email/shell.js` — `renderEmail({ preheader, eyebrow, title, body, cta, footer, marketing, unsubscribeUrl })`
- `api/lib/email/tracking.js` — `signClick`, `verifyClick`, `buildTrackedUrl`, `signUnsubscribe`, `verifyUnsubscribe`
- `api/lib/email/senders.js` — `sendEmail` facade + 12 per-template sender wrappers
- `api/lib/email/templates/auth-verify.js` … `research-new-paper.js` (12 files)
- `api/email/webhook-resend.js` — handler for `POST /api/email/webhook/resend`
- `api/email/track-click.js` — handler for `GET /api/email/track/click`
- `api/email/unsubscribe.js` — handler for `GET|POST /api/email/unsubscribe`
- `supabase/migrations/20260424120000_email_tracking.sql` — three tables + indexes + RLS
- `scripts/email-fixtures.js` — shared fixture data
- `scripts/preview-emails.mjs` — local render-to-HTML preview
- `scripts/upload-resend-templates.mjs` — Resend Templates API uploader
- `scripts/send-legal-update.mjs` — operator tool, broadcast legal emails
- `scripts/test/email-components.test.mjs`
- `scripts/test/email-shell.test.mjs`
- `scripts/test/email-tracking.test.mjs`
- `scripts/test/email-templates.test.mjs`
- `scripts/test/email-webhook.test.mjs`
- `scripts/test/email-click.test.mjs`
- `scripts/test/email-unsubscribe.test.mjs`
- `scripts/test/send-test-email.mjs` — one-off real-send helper
- `scripts/test/simulate-resend-webhook.mjs` — one-off webhook simulator
- `jobs/email-renewal-reminder.js` — pg-boss handler
- `jobs/email-research-alerts.js` — pg-boss handler

**Modified files:**
- `.gitignore` — add `.email-preview/` and `.env.resend-templates`
- `server.js` — mount three new routes
- `api/notify-signup.js` — port to `sendAuthWelcome`
- `api/billing/webhook.js` — wire billing templates into `handleVerifiedEvent`
- `jobs/_registry.js` — register + schedule the two new cron jobs

---

## Task 1: Migration — email_sends, email_events, email_unsubscribes

**Files:**
- Create: `supabase/migrations/20260424120000_email_tracking.sql`

**Context:** Self-hosted Supabase. From memory (`project_supabase_admin_role.md`): use `-U supabase_admin` for psql because `postgres` lacks REFERENCES privilege on `auth.users`. Deploys auto-apply migrations? **No** — migrations in `supabase/migrations/` are for source control; actual apply is manual via psql on the Hetzner box. The implementation plan covers only writing the SQL file. Applying it is a separate operator step at rollout time.

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/20260424120000_email_tracking.sql`:

```sql
-- Email delivery + engagement tracking
-- Writer: Sid (2026-04-24)
-- Spec: docs/superpowers/specs/2026-04-24-email-templates-design.md

-- Send log: one row per outbound email. resend_id is populated AFTER the
-- send succeeds; a NULL resend_id means the send failed or is in-flight.
create table if not exists email_sends (
  id            uuid primary key default gen_random_uuid(),
  resend_id     text unique,
  template      text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  to_email      text not null,
  subject       text not null,
  tags          jsonb not null default '{}'::jsonb,
  sent_at       timestamptz not null default now()
);

create index if not exists email_sends_user_sent_idx
  on email_sends (user_id, sent_at desc);

create index if not exists email_sends_template_sent_idx
  on email_sends (template, sent_at desc);

-- Resend delivery/engagement events. `kind` is normalized from Resend's
-- event types: email.delivered -> 'delivered', email.complained -> 'complained', etc.
create table if not exists email_events (
  id            uuid primary key default gen_random_uuid(),
  send_id       uuid references email_sends(id) on delete cascade,
  resend_id     text not null,
  kind          text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null,
  constraint email_events_kind_ck check (
    kind in ('delivered','bounced','complained','opened','clicked','delivery_delayed')
  )
);

-- Composite uniqueness prevents duplicate webhook retries from double-inserting.
create unique index if not exists email_events_dedup_idx
  on email_events (resend_id, kind, occurred_at);

create index if not exists email_events_send_occurred_idx
  on email_events (send_id, occurred_at desc);

-- Marketing suppression list. Transactional sends ignore this entirely.
create table if not exists email_unsubscribes (
  user_id         uuid references auth.users(id) on delete cascade,
  bucket          text not null,
  source          text not null,
  unsubscribed_at timestamptz not null default now(),
  primary key (user_id, bucket),
  constraint email_unsubscribes_bucket_ck check (
    bucket in ('research_alerts','engagement','all_marketing')
  ),
  constraint email_unsubscribes_source_ck check (
    source in ('one_click','profile','complaint')
  )
);

-- RLS: server-side-only writes (service role). Users can read their own
-- email_sends and their own email_unsubscribes. email_events is admin-only.
alter table email_sends enable row level security;
alter table email_events enable row level security;
alter table email_unsubscribes enable row level security;

create policy email_sends_self_select on email_sends
  for select using (auth.uid() = user_id);

create policy email_unsubscribes_self_select on email_unsubscribes
  for select using (auth.uid() = user_id);

-- (no user-facing policy on email_events — service role bypasses RLS)
```

- [ ] **Step 2: Lint the SQL**

Run: `python -c "open('supabase/migrations/20260424120000_email_tracking.sql').read()"`
Expected: no error (file exists, readable).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424120000_email_tracking.sql
git commit -m "feat(email): migration for email_sends, email_events, email_unsubscribes"
```

---

## Task 2: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add ignore patterns**

Append to `.gitignore`:

```gitignore

# Email preview renders (never committed)
.email-preview/

# Resend-hosted template IDs (environment-specific; operator-managed)
.env.resend-templates
```

- [ ] **Step 2: Verify patterns are new**

Run: `grep -nE "email-preview|env.resend-templates" .gitignore`
Expected: both new lines appear.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(email): gitignore .email-preview and .env.resend-templates"
```

---

## Task 3: Tokens module

**Files:**
- Create: `api/lib/email/tokens.js`

- [ ] **Step 1: Write the file**

Create `api/lib/email/tokens.js`:

```js
// api/lib/email/tokens.js
// Frozen color + typography constants for every email. Values mirror
// Graphite·Jade from shared/design-tokens.css. Inlined everywhere because
// most email clients (including Outlook desktop) don't honor CSS variables
// or @media queries outside narrow cases.

export const T = Object.freeze({
  bg:         "#0a0a0b",
  surface:    "#131315",
  surfaceAlt: "#18181b",
  ink:        "#ededee",
  muted:      "#c0c0c4",
  dim:        "#8a8a8f",
  line:       "rgba(255,255,255,0.10)",
  lineStrong: "rgba(255,255,255,0.16)",
  accent:     "#34d399",
  accentInk:  "#04221a",
  accentLine: "rgba(52,211,153,0.34)",
  danger:     "#f87171",
  warning:    "#fbbf24",
  info:       "#60a5fa",
  stack: Object.freeze({
    sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  }),
});
```

- [ ] **Step 2: Smoke test**

Run: `node -e "import('./api/lib/email/tokens.js').then(m => console.log(m.T.accent))"`
Expected: `#34d399`

- [ ] **Step 3: Commit**

```bash
git add api/lib/email/tokens.js
git commit -m "feat(email): frozen design tokens module"
```

---

## Task 4: Components — escape + tests

**Files:**
- Create: `api/lib/email/components.js`
- Create: `scripts/test/email-components.test.mjs`

- [ ] **Step 1: Write the failing test for esc()**

Create `scripts/test/email-components.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc } from "../../api/lib/email/components.js";

test("esc escapes &, <, >, quotes", () => {
  assert.equal(esc(`<script>alert("x")</script>`),
    `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;`);
  assert.equal(esc(`a & b`), `a &amp; b`);
  assert.equal(esc(`it's`), `it&#39;s`);
});

test("esc stringifies non-strings", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});
```

- [ ] **Step 2: Run test — should fail (module not written)**

Run: `node --test scripts/test/email-components.test.mjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Write esc() — minimal version**

Create `api/lib/email/components.js` with JUST `esc`:

```js
// api/lib/email/components.js
// HTML escaping + bulletproof-button + stat/source/callout helpers for
// email templates. Every caller-supplied string MUST go through esc().
//
// All helpers return HTML strings (no DOM). They are composed by templates
// and by scripts/preview-emails.mjs.

import { T } from "./tokens.js";

/** Escape a string for safe interpolation into email HTML. */
export function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Run tests — both esc tests should pass**

Run: `node --test scripts/test/email-components.test.mjs`
Expected: PASS (2 pass, 0 fail)

- [ ] **Step 5: Append tests for renderButton + renderStatRow + renderSourceRow + renderCallout + renderDivider + renderCodeBlock**

Append to `scripts/test/email-components.test.mjs`:

```js
import {
  renderButton,
  renderStatRow,
  renderSourceRow,
  renderCallout,
  renderDivider,
  renderCodeBlock,
} from "../../api/lib/email/components.js";

test("renderButton returns a table-wrapped bulletproof button", () => {
  const html = renderButton({ label: "Confirm email", href: "https://example.com/c?t=x" });
  assert.match(html, /<table/);
  assert.match(html, /href="https:\/\/example\.com\/c\?t=x"/);
  assert.match(html, /Confirm email/);
  assert.match(html, /#34d399/); // jade bg
});

test("renderButton escapes hostile label and href", () => {
  const html = renderButton({
    label: `<script>x</script>`,
    href: `https://e.x/?q="<script>`,
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="https:\/\/e\.x\/\?q="<script>"/);
});

test("renderStatRow emits label above value", () => {
  const html = renderStatRow({ label: "Plan", value: "Pro · monthly" });
  assert.match(html, /Plan/);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /#18181b/); // surfaceAlt bg
});

test("renderSourceRow has index + title + meta + read link", () => {
  const html = renderSourceRow({
    index: 1,
    title: "Creatine cognition",
    meta: "Exp Gerontol · 2018 · Review",
    href: "https://doi.org/x",
  });
  assert.match(html, />1</);
  assert.match(html, /Creatine cognition/);
  assert.match(html, /Exp Gerontol/);
  assert.match(html, /href="https:\/\/doi\.org\/x"/);
  assert.match(html, /Read/);
});

test("renderCallout supports info|warning|danger tones", () => {
  for (const tone of ["info", "warning", "danger"]) {
    const html = renderCallout({ tone, title: "Heads up", body: "Watch this." });
    assert.match(html, /Heads up/);
    assert.match(html, /Watch this\./);
  }
});

test("renderCallout danger tone uses danger color", () => {
  const html = renderCallout({ tone: "danger", body: "Oh no" });
  assert.match(html, /#f87171/);
});

test("renderDivider is a single hairline row", () => {
  const html = renderDivider();
  assert.match(html, /<tr/);
  assert.match(html, /rgba\(255,255,255,0\.10\)/);
});

test("renderCodeBlock preserves long tokens and escapes", () => {
  const html = renderCodeBlock({
    code: `https://emersus.ai/x?t=abc<script>`,
  });
  assert.match(html, /abc&lt;script&gt;/);
  assert.match(html, /word-break:\s*break-all/);
});
```

- [ ] **Step 6: Run tests — 9 new tests should fail**

Run: `node --test scripts/test/email-components.test.mjs`
Expected: FAIL — `renderButton is not a function` (or similar for each).

- [ ] **Step 7: Implement the 6 helpers**

Append to `api/lib/email/components.js`:

```js
/**
 * Bulletproof button. The outer <table> pattern is the only reliable way
 * to render a pill-shaped CTA across Outlook, Gmail, Apple Mail, and iOS.
 * Do NOT replace with a bare <a> — Outlook on Windows will strip padding
 * and background on <a> elements that are not inside a <td>.
 */
export function renderButton({ label, href }) {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td bgcolor="${T.accent}" style="background:${T.accent}; border-radius:2px;">
      <a href="${h}" target="_blank" rel="noopener" style="display:inline-block; padding:13px 22px; font-family:${T.stack.sans}; font-size:14px; font-weight:600; line-height:1; color:${T.accentInk}; text-decoration:none; letter-spacing:-0.005em;">${l}</a>
    </td></tr>
  </table>`;
}

/**
 * Label-above-value stat row. Templates .join('') multiple of these into
 * the body to build billing-receipt-style readouts.
 */
export function renderStatRow({ label, value }) {
  return `<div style="margin:10px 0; padding:16px 18px; background:${T.surfaceAlt}; border:1px solid ${T.line};">
    <div style="font-family:${T.stack.mono}; font-size:11px; font-weight:500; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim}; margin-bottom:6px;">${esc(label)}</div>
    <div style="font-family:${T.stack.sans}; font-size:15px; color:${T.ink}; line-height:1.45;">${esc(value)}</div>
  </div>`;
}

/**
 * Citation source row mirroring landing Card 1. index is the [1] / [2]
 * numeric in the inline citation.
 */
export function renderSourceRow({ index, title, meta, href }) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0;">
    <tr>
      <td width="32" valign="top" style="padding:12px 10px 12px 14px; background:${T.surfaceAlt}; border-top:1px solid ${T.line}; border-bottom:1px solid ${T.line}; border-left:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:13px; font-weight:600; color:${T.accent};">${esc(index)}</td>
      <td valign="top" style="padding:12px 14px; background:${T.surfaceAlt}; border-top:1px solid ${T.line}; border-bottom:1px solid ${T.line}; border-right:1px solid ${T.line}; font-family:${T.stack.sans}; color:${T.ink};">
        <div style="font-size:14px; font-weight:500; line-height:1.45; color:${T.ink}; margin-bottom:4px;">${esc(title)}</div>
        <div style="font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${T.dim}; margin-bottom:8px;">${esc(meta)}</div>
        <a href="${esc(href)}" target="_blank" rel="noopener" style="font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${T.accent}; text-decoration:none;">Read →</a>
      </td>
    </tr>
  </table>`;
}

/** Tone-aware callout. Left border + tinted bg. */
export function renderCallout({ tone = "info", title, body }) {
  const palette = {
    info:    { border: T.info,    bg: "rgba(96,165,250,0.08)", text: T.info },
    warning: { border: T.warning, bg: "rgba(251,191,36,0.08)", text: T.warning },
    danger:  { border: T.danger,  bg: "rgba(248,113,113,0.08)", text: T.danger },
  };
  const p = palette[tone] || palette.info;
  const head = title
    ? `<div style="font-family:${T.stack.sans}; font-size:14px; font-weight:600; color:${p.text}; margin-bottom:4px;">${esc(title)}</div>`
    : "";
  return `<div style="margin:16px 0; padding:14px 18px; background:${p.bg}; border-left:3px solid ${p.border};">
    ${head}<div style="font-family:${T.stack.sans}; font-size:14px; color:${T.muted}; line-height:1.6;">${esc(body)}</div>
  </div>`;
}

/** Hairline divider. */
export function renderDivider() {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="border-top:1px solid ${T.line}; line-height:1; font-size:1px;">&nbsp;</td></tr>
  </table>`;
}

/** Monospaced code block for fallback URLs, checksums, etc. */
export function renderCodeBlock({ code }) {
  return `<div style="margin:10px 0 18px; padding:12px 14px; background:${T.surfaceAlt}; border:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:12px; line-height:1.55; color:${T.ink}; word-break:break-all; white-space:pre-wrap;">${esc(code)}</div>`;
}
```

- [ ] **Step 8: Run tests — all 9 should pass**

Run: `node --test scripts/test/email-components.test.mjs`
Expected: PASS (11 total).

- [ ] **Step 9: Commit**

```bash
git add api/lib/email/components.js scripts/test/email-components.test.mjs
git commit -m "feat(email): HTML components + esc with unit tests"
```

---

## Task 5: Shell (renderEmail)

**Files:**
- Create: `api/lib/email/shell.js`
- Create: `scripts/test/email-shell.test.mjs`

- [ ] **Step 1: Write failing tests for renderEmail**

Create `scripts/test/email-shell.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../../api/lib/email/shell.js";

const base = {
  preheader: "You're one tap away.",
  eyebrow: "Account",
  title: "Confirm your email.",
  body: `<p>Welcome.</p>`,
  footer: { toEmail: "sid@example.com" },
};

test("renderEmail returns a full HTML document", () => {
  const html = renderEmail(base);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html\s+lang="en">/);
  assert.match(html, /<\/html>/);
});

test("renderEmail includes color-scheme meta", () => {
  const html = renderEmail(base);
  assert.match(html, /<meta\s+name="color-scheme"\s+content="dark"/);
  assert.match(html, /<meta\s+name="supported-color-schemes"\s+content="dark"/);
});

test("renderEmail includes hidden preheader and the body", () => {
  const html = renderEmail(base);
  assert.match(html, /display:\s*none/);
  assert.match(html, /You're one tap away\./);
  assert.match(html, /<p>Welcome\.<\/p>/);
});

test("renderEmail includes eyebrow + title", () => {
  const html = renderEmail(base);
  assert.match(html, /Account/);
  assert.match(html, /Confirm your email\./);
});

test("renderEmail escapes eyebrow + title + preheader", () => {
  const html = renderEmail({
    ...base,
    eyebrow: `<script>x</script>`,
    title: `<img onerror=1>`,
    preheader: `<b>hi</b>`,
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img onerror=1>/);
  assert.doesNotMatch(html, /<b>hi<\/b>/);
});

test("renderEmail renders a CTA when cta provided", () => {
  const html = renderEmail({
    ...base,
    cta: { label: "Confirm email →", href: "https://emersus.ai/c?t=1" },
  });
  assert.match(html, /Confirm email →/);
  assert.match(html, /href="https:\/\/emersus\.ai\/c\?t=1"/);
});

test("renderEmail footer shows 'Sent to <email>' line", () => {
  const html = renderEmail(base);
  assert.match(html, /Sent to sid@example\.com/);
});

test("renderEmail marketing adds unsubscribe link", () => {
  const html = renderEmail({
    ...base,
    marketing: true,
    unsubscribeUrl: "https://emersus.ai/api/email/unsubscribe?m=1&b=research_alerts&k=x",
  });
  assert.match(html, /Unsubscribe/);
  assert.match(html, /href="https:\/\/emersus\.ai\/api\/email\/unsubscribe\?m=1&b=research_alerts&k=x"/);
});

test("renderEmail transactional has NO unsubscribe link", () => {
  const html = renderEmail(base);
  assert.doesNotMatch(html, /Unsubscribe/);
});
```

- [ ] **Step 2: Run test — should fail**

Run: `node --test scripts/test/email-shell.test.mjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement renderEmail**

Create `api/lib/email/shell.js`:

```js
// api/lib/email/shell.js
// Email shell: full HTML document, 600px centered table, Graphite·Jade dark.
// One exported function; every template calls it with slots filled.

import { T } from "./tokens.js";
import { esc } from "./components.js";

/**
 * @param {Object} p
 * @param {string} p.preheader   inbox preview text (escaped, padded)
 * @param {string} p.eyebrow     uppercased tag above title
 * @param {string} p.title       h1 text
 * @param {string} p.body        raw HTML (components are trusted)
 * @param {{label:string,href:string}} [p.cta]
 * @param {{toEmail:string}} p.footer
 * @param {boolean} [p.marketing=false]
 * @param {string} [p.unsubscribeUrl]  required if marketing=true
 */
export function renderEmail({
  preheader,
  eyebrow,
  title,
  body,
  cta,
  footer,
  marketing = false,
  unsubscribeUrl,
}) {
  // Preheader padded with zero-width spaces so Gmail doesn't fill the
  // preview line with body copy.
  const preheaderPad = "​‌‍﻿".repeat(20);
  const preheaderHtml = `<div style="display:none; overflow:hidden; line-height:1; max-height:0; max-width:0; opacity:0; visibility:hidden;">${esc(preheader)}${preheaderPad}</div>`;

  const ctaHtml = cta
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
        <tr><td bgcolor="${T.accent}" style="background:${T.accent}; border-radius:2px;">
          <a href="${esc(cta.href)}" target="_blank" rel="noopener" style="display:inline-block; padding:13px 22px; font-family:${T.stack.sans}; font-size:14px; font-weight:600; line-height:1; color:${T.accentInk}; text-decoration:none; letter-spacing:-0.005em;">${esc(cta.label)}</a>
        </td></tr>
      </table>`
    : "";

  const unsubLink = marketing && unsubscribeUrl
    ? ` · <a href="${esc(unsubscribeUrl)}" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Unsubscribe</a>`
    : "";

  const legal = ` · <a href="https://emersus.ai/privacy/" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Privacy</a> · <a href="https://emersus.ai/terms/" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Terms</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
<style>
  body { margin:0; padding:0; background:${T.bg}; }
  @media (max-width: 480px) {
    .em-pad { padding-left: 18px !important; padding-right: 18px !important; }
    .em-inner { padding: 28px 18px 22px !important; }
    .em-footer { padding: 18px !important; }
    .em-h1 { font-size: 24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${T.bg}; color:${T.ink}; font-family:${T.stack.sans}; -webkit-font-smoothing:antialiased;">
${preheaderHtml}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${T.bg};">
  <tr><td align="center" class="em-pad" style="padding:28px 12px;">
    <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:${T.surface}; border:1px solid ${T.line};">
      <tr><td style="height:1px; line-height:1px; font-size:1px; background:${T.accentLine};">&nbsp;</td></tr>
      <tr><td class="em-inner" style="padding:36px 32px 28px;">
        <div style="font-family:${T.stack.sans}; font-size:15px; font-weight:600; letter-spacing:-0.02em; color:${T.ink}; margin-bottom:28px;">em<b style="color:${T.accent}; font-weight:600;">∴</b>rsus</div>
        <div style="font-family:${T.stack.mono}; font-size:11px; font-weight:500; letter-spacing:0.18em; text-transform:uppercase; color:${T.accent}; margin-bottom:12px;">
          <span style="display:inline-block; width:6px; height:6px; background:${T.accent}; border-radius:50%; margin-right:8px; vertical-align:2px;">&nbsp;</span>${esc(eyebrow)}
        </div>
        <h1 class="em-h1" style="margin:0 0 14px; font-family:${T.stack.sans}; font-size:28px; font-weight:600; line-height:1.15; letter-spacing:-0.02em; color:${T.ink};">${esc(title)}</h1>
        <div style="font-family:${T.stack.sans}; font-size:15px; line-height:1.65; color:${T.muted};">${body}</div>
        ${ctaHtml}
      </td></tr>
      <tr><td class="em-footer" style="padding:20px 32px 28px; border-top:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${T.dim}; line-height:1.9;">
        Sent to ${esc(footer.toEmail)}<br>
        Emersus AI · <a href="mailto:info@emersus.ai" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">info@emersus.ai</a>${legal}${unsubLink}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests — all 9 should pass**

Run: `node --test scripts/test/email-shell.test.mjs`
Expected: PASS (9 pass).

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/shell.js scripts/test/email-shell.test.mjs
git commit -m "feat(email): renderEmail shell with preheader, eyebrow, CTA, footer"
```

---

## Task 6: Tracking — HMAC signing + URL builder

**Files:**
- Create: `api/lib/email/tracking.js`
- Create: `scripts/test/email-tracking.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/test/email-tracking.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signClick,
  verifyClick,
  buildTrackedUrl,
  signUnsubscribe,
  verifyUnsubscribe,
} from "../../api/lib/email/tracking.js";

const SECRET = "test-secret-do-not-use-in-prod";
process.env.EMAIL_CLICK_SECRET = SECRET;

test("signClick + verifyClick round-trip", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/app/", sig }), true);
});

test("verifyClick rejects tampered target", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s1", target: "https://evil.example/", sig }), false);
});

test("verifyClick rejects tampered sendId", () => {
  const sig = signClick({ sendId: "s1", target: "https://emersus.ai/app/" });
  assert.equal(verifyClick({ sendId: "s2", target: "https://emersus.ai/app/", sig }), false);
});

test("verifyClick rejects malformed signature", () => {
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/", sig: "nope" }), false);
  assert.equal(verifyClick({ sendId: "s1", target: "https://emersus.ai/", sig: "" }), false);
});

test("buildTrackedUrl produces /api/email/track/click with utm params on target", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/app/",
    utmCampaign: "auth-verify",
    marketing: false,
    userId: "u-123",
  });
  assert.match(url, /\/api\/email\/track\/click\?/);
  assert.match(url, /m=s1/);
  // target is base64url-encoded; decode and check utm
  const m = url.match(/[?&]to=([^&]+)/);
  assert.ok(m, "to= param present");
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /utm_source=email/);
  assert.match(decoded, /utm_medium=transactional/);
  assert.match(decoded, /utm_campaign=auth-verify/);
  assert.match(decoded, /u=u-123/);
});

test("buildTrackedUrl marketing uses utm_medium=marketing", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/chat",
    utmCampaign: "research-new-paper",
    marketing: true,
    userId: "u-1",
  });
  const m = url.match(/[?&]to=([^&]+)/);
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /utm_medium=marketing/);
});

test("buildTrackedUrl preserves existing query on target", () => {
  const url = buildTrackedUrl({
    sendId: "s1",
    target: "https://emersus.ai/chat?q=1",
    utmCampaign: "welcome",
    marketing: false,
    userId: "u-1",
  });
  const m = url.match(/[?&]to=([^&]+)/);
  const decoded = Buffer.from(m[1], "base64url").toString("utf8");
  assert.match(decoded, /\?q=1&utm_source=email/);
});

test("signUnsubscribe + verifyUnsubscribe round-trip", () => {
  const sig = signUnsubscribe({ sendId: "s1", bucket: "research_alerts" });
  assert.equal(verifyUnsubscribe({ sendId: "s1", bucket: "research_alerts", sig }), true);
  assert.equal(verifyUnsubscribe({ sendId: "s1", bucket: "engagement", sig }), false);
});
```

- [ ] **Step 2: Run test — should fail**

Run: `node --test scripts/test/email-tracking.test.mjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement tracking.js**

Create `api/lib/email/tracking.js`:

```js
// api/lib/email/tracking.js
// HMAC signing for email click + one-click-unsubscribe URLs.
// Constant-time compare; no early returns that leak timing.

import crypto from "node:crypto";

function secret() {
  const s = process.env.EMAIL_CLICK_SECRET;
  if (!s || s.length < 16) {
    throw new Error("EMAIL_CLICK_SECRET is not configured (must be 16+ chars)");
  }
  return s;
}

function hmacHex(data) {
  return crypto.createHmac("sha256", secret()).update(data).digest("hex");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Sign a click: HMAC over `sendId|target`. */
export function signClick({ sendId, target }) {
  return hmacHex(`${sendId}|${target}`);
}

export function verifyClick({ sendId, target, sig }) {
  return safeEqualHex(sig, signClick({ sendId, target }));
}

/** Sign an unsubscribe: HMAC over `sendId|bucket`. */
export function signUnsubscribe({ sendId, bucket }) {
  return hmacHex(`unsub|${sendId}|${bucket}`);
}

export function verifyUnsubscribe({ sendId, bucket, sig }) {
  return safeEqualHex(sig, signUnsubscribe({ sendId, bucket }));
}

/**
 * Build the tracked redirect URL.
 * - Adds UTM params to `target` first.
 * - Signs (sendId, target-with-utm) and base64url-encodes the target.
 */
export function buildTrackedUrl({
  sendId,
  target,
  utmCampaign,
  marketing = false,
  userId,
  baseUrl = "https://emersus.ai",
}) {
  const u = new URL(target);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", marketing ? "marketing" : "transactional");
  u.searchParams.set("utm_campaign", utmCampaign);
  if (userId) u.searchParams.set("u", userId);
  const finalTarget = u.toString();
  const sig = signClick({ sendId, target: finalTarget });
  const encoded = Buffer.from(finalTarget, "utf8").toString("base64url");
  const q = new URLSearchParams({ m: sendId, to: encoded, k: sig, utm_campaign: utmCampaign });
  return `${baseUrl}/api/email/track/click?${q.toString()}`;
}
```

- [ ] **Step 4: Run tests — all 8 should pass**

Run: `node --test scripts/test/email-tracking.test.mjs`
Expected: PASS (8 pass).

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/tracking.js scripts/test/email-tracking.test.mjs
git commit -m "feat(email): HMAC click + unsubscribe signing with constant-time compare"
```

---

## Task 7: Fixtures module

**Files:**
- Create: `scripts/email-fixtures.js`

- [ ] **Step 1: Write fixtures**

Create `scripts/email-fixtures.js`:

```js
// scripts/email-fixtures.js
// Sample inputs for every template. Used by preview-emails.mjs and the
// template unit tests. Keep the hostile strings — they verify escape
// coverage on every render call.

export const USER_FIXTURE = {
  id: "u-00000000-0000-0000-0000-000000000001",
  email: "sid@example.com",
  name: `Sid "<script>alert(1)</script>" Kayadibi`,
};

export const FIXTURES = {
  "auth-verify": {
    user: USER_FIXTURE,
    confirmUrl: "https://emersus.ai/auth/confirm?token=2f8e19c4a8b7d9e5f11234567890abcd",
  },
  "auth-reset": {
    user: USER_FIXTURE,
    resetUrl: "https://emersus.ai/auth/reset-password?token=abc123def456",
    expiresIn: "60 minutes",
  },
  "auth-welcome": {
    user: USER_FIXTURE,
    appUrl: "https://emersus.ai/app/",
    samplePrompts: [
      "How much protein do I actually need per day?",
      "Creatine: cycling or continuous?",
      "Zone-2 cardio for fat loss — dose-response?",
    ],
  },
  "auth-password-changed": {
    user: USER_FIXTURE,
    changedAt: "Apr 24, 2026 · 14:32 EST",
    device: "Chrome on macOS",
    location: "Brooklyn, NY",
    ip: "24.186.xxx.xxx",
    resetUrl: "https://emersus.ai/auth/reset-password",
  },
  "billing-receipt": {
    user: USER_FIXTURE,
    plan: "Pro · monthly",
    period: "Apr 24, 2026 → May 24, 2026",
    amount: "$9.00",
    cardLast4: "4242",
    invoiceUrl: "https://polar.sh/invoice/xyz",
  },
  "billing-renewal": {
    user: USER_FIXTURE,
    plan: "Pro · monthly",
    nextChargeAt: "May 1, 2026",
    amount: "$9.00",
    manageUrl: "https://emersus.ai/app/profile?tab=billing",
  },
  "billing-payment-failed": {
    user: USER_FIXTURE,
    cardLast4: "0341",
    reason: "Card declined by issuer (insufficient funds)",
    retryAt: "Apr 27, 2026",
    finalAttemptAt: "May 1, 2026",
    updateUrl: "https://emersus.ai/app/profile?tab=billing",
  },
  "billing-cancellation": {
    user: USER_FIXTURE,
    accessThrough: "May 24, 2026",
    refund: "No refund — access continues to end of period",
    reactivateUrl: "https://emersus.ai/pricing/",
  },
  "legal-tos-update": {
    user: USER_FIXTURE,
    summary: "We've clarified the acceptable-use policy and added a section on AI-generated content.",
    changes: [
      "New §4.2 — Acceptable use: no scraping the corpus via the chat UI.",
      "New §6.4 — You own your chat history. We don't train on it.",
      "§9 — Updated Delaware jurisdiction language.",
    ],
    effectiveAt: "May 15, 2026",
    termsUrl: "https://emersus.ai/terms/",
  },
  "legal-privacy-update": {
    user: USER_FIXTURE,
    summary: "We've reduced retention for anonymous visitors and clarified subprocessor list.",
    changes: [
      "Anonymous analytics retention reduced from 26 months to 12.",
      "Added Polar as a billing subprocessor (was already disclosed in-product).",
      "Clarified what's logged server-side vs. client-side.",
    ],
    effectiveAt: "May 15, 2026",
    privacyUrl: "https://emersus.ai/privacy/",
  },
  "data-export-ready": {
    user: USER_FIXTURE,
    downloadUrl: "https://emersus.ai/export/abc123.zip",
    size: "48 MB",
    rows: "12,421 chat messages, 318 saved sources, 6 workout sessions",
    format: "ZIP (JSON + Markdown)",
    expiresIn: "7 days",
    sha256: "3f8c1e4b9d0a7c2f6e5d4b3a8c9e2f1d0b7a6c5e4d3f2a1b0c9d8e7f6a5b4c3d",
  },
  "research-new-paper": {
    user: USER_FIXTURE,
    topic: "Creatine & cognition",
    paper: {
      title: "Daily creatine supplementation and working memory in older adults: a double-blind RCT.",
      journal: "J Int Soc Sports Nutr",
      year: 2026,
      grade: "high",
      abstract: "24 weeks of 5 g/d improved digit-span performance (d=0.42) with no effect on processing speed. Dose-response not tested at this study size.",
      doi: "10.1186/s12970-026-00567-x",
    },
    readUrl: "https://emersus.ai/chat?ref=new-paper&p=xyz",
    reason: "Matches your follow on 'creatine supplementation'",
  },
};
```

- [ ] **Step 2: Smoke test**

Run: `node -e "import('./scripts/email-fixtures.js').then(m => console.log(Object.keys(m.FIXTURES).length, 'fixtures'))"`
Expected: `12 fixtures`

- [ ] **Step 3: Commit**

```bash
git add scripts/email-fixtures.js
git commit -m "feat(email): fixture bank for preview + unit tests"
```

---

## Task 8: Template — auth-verify (establishes the pattern)

**Files:**
- Create: `api/lib/email/templates/auth-verify.js`
- Create: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Write the failing test (first entry in shared template suite)**

Create `scripts/test/email-templates.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../email-fixtures.js";
import { renderAuthVerify } from "../../api/lib/email/templates/auth-verify.js";

test("auth-verify: renders full HTML document", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Confirm your email\./);
});

test("auth-verify: contains the confirmation URL in the CTA", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  assert.match(html, new RegExp(escRe(fx.confirmUrl)));
});

test("auth-verify: escapes hostile strings from fixture", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  // Fixture user name contains <script>alert(1)</script>
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("auth-verify: shows the URL in a code block fallback", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  // The monospace code block uses 'JetBrains Mono' + word-break:break-all
  assert.match(html, /word-break:\s*break-all/);
});

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 2: Run test — should fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write renderAuthVerify**

Create `api/lib/email/templates/auth-verify.js`:

```js
// api/lib/email/templates/auth-verify.js
// Email sent to users who just signed up. Supabase Auth can't call this
// function directly — the rendered HTML is uploaded to Resend as a
// template, and Supabase fires it via SMTP with {{ .ConfirmationURL }}
// substituted at send time. See scripts/upload-resend-templates.mjs.

import { renderEmail } from "../shell.js";
import { renderCodeBlock, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthVerify({ user, confirmUrl }) {
  const body = `
    <p style="margin:0 0 14px;">Welcome to Emersus. Tap the button below and you're in — the link is good for 24 hours.</p>
    <p style="margin:0 0 6px; color:${T.dim}; font-size:13px;">Button not working? Paste this into your browser:</p>
    ${renderCodeBlock({ code: confirmUrl })}
  `;
  return renderEmail({
    preheader: "You're one tap away from confirming your email.",
    eyebrow: "Account",
    title: "Confirm your email.",
    body,
    cta: { label: "Confirm email →", href: confirmUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run tests — all 4 should pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/auth-verify.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): auth-verify template + test scaffold"
```

---

## Task 9: Template — auth-reset

**Files:**
- Create: `api/lib/email/templates/auth-reset.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

Append to `scripts/test/email-templates.test.mjs`:

```js
import { renderAuthReset } from "../../api/lib/email/templates/auth-reset.js";

test("auth-reset: includes reset URL + expiry + warning callout", () => {
  const fx = FIXTURES["auth-reset"];
  const html = renderAuthReset(fx);
  assert.match(html, new RegExp(escRe(fx.resetUrl)));
  assert.match(html, /60 minutes/);
  // warning callout tint
  assert.match(html, /rgba\(251,191,36,0\.08\)/);
});
```

- [ ] **Step 2: Run test — should fail on import**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/auth-reset.js`:

```js
import { renderEmail } from "../shell.js";
import { renderCodeBlock, renderCallout } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthReset({ user, resetUrl, expiresIn }) {
  const body = `
    <p style="margin:0 0 14px;">Someone requested a password reset for your Emersus account. Tap below to pick a new one — the link is valid for ${expiresIn}.</p>
    <p style="margin:0 0 6px; color:${T.dim}; font-size:13px;">Button not working? Paste this into your browser:</p>
    ${renderCodeBlock({ code: resetUrl })}
    ${renderCallout({ tone: "warning", title: "Didn't request this?", body: "Ignore this email — your password won't change unless you open the link." })}
  `;
  return renderEmail({
    preheader: `Reset your Emersus password — link valid for ${expiresIn}.`,
    eyebrow: "Account",
    title: "Reset your password.",
    body,
    cta: { label: "Reset password →", href: resetUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/auth-reset.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): auth-reset template"
```

---

## Task 10: Template — auth-welcome

**Files:**
- Create: `api/lib/email/templates/auth-welcome.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

Append:

```js
import { renderAuthWelcome } from "../../api/lib/email/templates/auth-welcome.js";

test("auth-welcome: lists sample prompts and app URL", () => {
  const fx = FIXTURES["auth-welcome"];
  const html = renderAuthWelcome(fx);
  assert.match(html, new RegExp(escRe(fx.appUrl)));
  for (const p of fx.samplePrompts) {
    assert.match(html, new RegExp(escRe(p)));
  }
  assert.match(html, /You're in\./);
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/auth-welcome.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthWelcome({ user, appUrl, samplePrompts = [] }) {
  const statsBlock = [
    renderStatRow({ label: "Ask anything", value: "Training, nutrition, supplements, recovery — all cited." }),
    renderStatRow({ label: "Every answer grounded", value: "Pulled from 2M+ peer-reviewed papers. No hallucinated references." }),
    renderStatRow({ label: "Your profile shapes the plan", value: "Injuries, equipment, and goals respected — no cookie-cutter programs." }),
  ].join("");

  const promptList = samplePrompts.length
    ? `<div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">Try asking</div>` +
      `<ul style="margin:0 0 16px; padding:0; list-style:none;">` +
      samplePrompts.map(p => `<li style="padding:10px 14px; margin:6px 0; background:${T.surfaceAlt}; border:1px solid ${T.line}; font-size:14px; color:${T.ink};">${esc(p)}</li>`).join("") +
      `</ul>`
    : "";

  const body = `
    <p style="margin:0 0 18px;">Your account is live. Here's what changes when you ask Emersus something:</p>
    ${statsBlock}
    ${promptList}
  `;
  return renderEmail({
    preheader: "Your Emersus account is live — start with a question.",
    eyebrow: "Account",
    title: "You're in.",
    body,
    cta: { label: "Open Emersus →", href: appUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/auth-welcome.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): auth-welcome template"
```

---

## Task 11: Template — auth-password-changed

**Files:**
- Create: `api/lib/email/templates/auth-password-changed.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderAuthPasswordChanged } from "../../api/lib/email/templates/auth-password-changed.js";

test("auth-password-changed: shows device, location, IP + danger callout + reset CTA", () => {
  const fx = FIXTURES["auth-password-changed"];
  const html = renderAuthPasswordChanged(fx);
  assert.match(html, /Chrome on macOS/);
  assert.match(html, /Brooklyn, NY/);
  assert.match(html, /24\.186\.xxx\.xxx/);
  // danger callout color
  assert.match(html, /rgba\(248,113,113,0\.08\)/);
  assert.match(html, new RegExp(escRe(fx.resetUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/auth-password-changed.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout } from "../components.js";

export function renderAuthPasswordChanged({ user, changedAt, device, location, ip, resetUrl }) {
  const stats = [
    renderStatRow({ label: "Changed at",  value: changedAt }),
    renderStatRow({ label: "Device",      value: device }),
    renderStatRow({ label: "Location",    value: location }),
    renderStatRow({ label: "IP address",  value: ip }),
  ].join("");

  const body = `
    <p style="margin:0 0 18px;">Your Emersus password was just changed. If that was you, no action needed.</p>
    ${stats}
    ${renderCallout({ tone: "danger", title: "Didn't do this?", body: "Reset your password immediately. Your account may be compromised." })}
  `;
  return renderEmail({
    preheader: "Your Emersus password was changed just now.",
    eyebrow: "Account",
    title: "Password changed.",
    body,
    cta: { label: "I didn't do this →", href: resetUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/auth-password-changed.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): auth-password-changed template"
```

---

## Task 12: Template — billing-receipt

**Files:**
- Create: `api/lib/email/templates/billing-receipt.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderBillingReceipt } from "../../api/lib/email/templates/billing-receipt.js";

test("billing-receipt: shows plan, period, amount, card last-4", () => {
  const fx = FIXTURES["billing-receipt"];
  const html = renderBillingReceipt(fx);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /\$9\.00/);
  assert.match(html, /\·{0,1}\s*4242/);
  assert.match(html, new RegExp(escRe(fx.invoiceUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/billing-receipt.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingReceipt({ user, plan, period, amount, cardLast4, invoiceUrl }) {
  const stats = [
    renderStatRow({ label: "Plan",     value: plan }),
    renderStatRow({ label: "Period",   value: period }),
    renderStatRow({ label: "Amount",   value: amount }),
    renderStatRow({ label: "Card",     value: `•••• ${cardLast4}` }),
  ].join("");

  const body = `
    <p style="margin:0 0 18px;">Thanks for supporting Emersus. Your receipt is below.</p>
    ${stats}
    <p style="margin:16px 0 0; color:${T.dim}; font-size:13px;">Questions? Reply to this email and we'll sort it.</p>
  `;
  return renderEmail({
    preheader: `Receipt · ${amount} · ${plan}`,
    eyebrow: "Billing",
    title: "Receipt.",
    body,
    cta: { label: "View invoice →", href: invoiceUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/billing-receipt.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): billing-receipt template"
```

---

## Task 13: Template — billing-renewal

**Files:**
- Create: `api/lib/email/templates/billing-renewal.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderBillingRenewal } from "../../api/lib/email/templates/billing-renewal.js";

test("billing-renewal: shows plan, next charge, amount, manage URL", () => {
  const fx = FIXTURES["billing-renewal"];
  const html = renderBillingRenewal(fx);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /May 1, 2026/);
  assert.match(html, /\$9\.00/);
  assert.match(html, new RegExp(escRe(fx.manageUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/billing-renewal.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingRenewal({ user, plan, nextChargeAt, amount, manageUrl }) {
  const stats = [
    renderStatRow({ label: "Plan",        value: plan }),
    renderStatRow({ label: "Next charge", value: nextChargeAt }),
    renderStatRow({ label: "Amount",      value: amount }),
  ].join("");
  const body = `
    <p style="margin:0 0 18px;">Heads up — your Emersus subscription renews in 7 days. No action needed if you're staying on.</p>
    ${stats}
    <p style="margin:16px 0 0; color:${T.dim}; font-size:13px;">Cancel anytime from Settings → Billing. You keep access through the end of the period.</p>
  `;
  return renderEmail({
    preheader: `Your ${plan} renews ${nextChargeAt} for ${amount}.`,
    eyebrow: "Billing",
    title: "Renewal in 7 days.",
    body,
    cta: { label: "Manage subscription →", href: manageUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/billing-renewal.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): billing-renewal template"
```

---

## Task 14: Template — billing-payment-failed

**Files:**
- Create: `api/lib/email/templates/billing-payment-failed.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderBillingPaymentFailed } from "../../api/lib/email/templates/billing-payment-failed.js";

test("billing-payment-failed: warning callout, card last-4, retry + final-attempt dates", () => {
  const fx = FIXTURES["billing-payment-failed"];
  const html = renderBillingPaymentFailed(fx);
  assert.match(html, /rgba\(251,191,36,0\.08\)/); // warning tint
  assert.match(html, /0341/);
  assert.match(html, /Apr 27, 2026/);
  assert.match(html, /May 1, 2026/);
  assert.match(html, new RegExp(escRe(fx.updateUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/billing-payment-failed.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingPaymentFailed({ user, cardLast4, reason, retryAt, finalAttemptAt, updateUrl }) {
  const body = `
    ${renderCallout({ tone: "warning", title: "Payment didn't go through", body: reason })}
    ${renderStatRow({ label: "Card",            value: `•••• ${cardLast4}` })}
    ${renderStatRow({ label: "Next retry",      value: retryAt })}
    ${renderStatRow({ label: "Final attempt",   value: finalAttemptAt })}
    <p style="margin:18px 0 0; color:${T.muted}; font-size:14px;">You still have full access until the final attempt. Update your card and we'll re-run the charge.</p>
  `;
  return renderEmail({
    preheader: `We couldn't charge your card — card ending ${cardLast4}.`,
    eyebrow: "Billing",
    title: "Payment didn't go through.",
    body,
    cta: { label: "Update payment →", href: updateUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/billing-payment-failed.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): billing-payment-failed template"
```

---

## Task 15: Template — billing-cancellation

**Files:**
- Create: `api/lib/email/templates/billing-cancellation.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderBillingCancellation } from "../../api/lib/email/templates/billing-cancellation.js";

test("billing-cancellation: shows accessThrough, refund, reactivate URL", () => {
  const fx = FIXTURES["billing-cancellation"];
  const html = renderBillingCancellation(fx);
  assert.match(html, /May 24, 2026/);
  assert.match(html, /No refund/);
  assert.match(html, new RegExp(escRe(fx.reactivateUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/billing-cancellation.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingCancellation({ user, accessThrough, refund, reactivateUrl }) {
  const body = `
    <p style="margin:0 0 18px;">Your subscription is cancelled. Here's what happens next:</p>
    ${renderStatRow({ label: "Access through", value: accessThrough })}
    ${renderStatRow({ label: "Refund",         value: refund })}
    <p style="margin:18px 0 0; color:${T.muted}; font-size:14px;">Your saved library, chat history, and profile stick around — you keep read-only access to everything even on the Free plan.</p>
    <p style="margin:14px 0 0; color:${T.dim}; font-size:13px;">Change your mind? Reactivate in one tap — no data migration.</p>
  `;
  return renderEmail({
    preheader: `Cancellation confirmed — access until ${accessThrough}.`,
    eyebrow: "Billing",
    title: "Cancellation confirmed.",
    body,
    cta: { label: "Reactivate →", href: reactivateUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/billing-cancellation.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): billing-cancellation template"
```

---

## Task 16: Template — legal-tos-update

**Files:**
- Create: `api/lib/email/templates/legal-tos-update.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderLegalTosUpdate } from "../../api/lib/email/templates/legal-tos-update.js";

test("legal-tos-update: renders info callout, bullet list of changes, effective date", () => {
  const fx = FIXTURES["legal-tos-update"];
  const html = renderLegalTosUpdate(fx);
  assert.match(html, /rgba\(96,165,250,0\.08\)/); // info tint
  for (const change of fx.changes) {
    assert.match(html, new RegExp(escRe(change)));
  }
  assert.match(html, /May 15, 2026/);
  assert.match(html, new RegExp(escRe(fx.termsUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/legal-tos-update.js`:

```js
import { renderEmail } from "../shell.js";
import { renderCallout, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderLegalTosUpdate({ user, summary, changes = [], effectiveAt, termsUrl }) {
  const bullets = changes.map(c => `<li style="padding:4px 0; color:${T.muted}; line-height:1.55;">${esc(c)}</li>`).join("");
  const body = `
    ${renderCallout({ tone: "info", title: "Summary", body: summary })}
    <div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">What's changing</div>
    <ul style="margin:0 0 18px; padding-left:20px;">${bullets}</ul>
    <p style="margin:14px 0 0; color:${T.muted}; font-size:14px;">Effective <strong style="color:${T.ink};">${esc(effectiveAt)}</strong>. Continued use of Emersus after that date constitutes acceptance.</p>
  `;
  return renderEmail({
    preheader: `Updated Terms of Service — effective ${effectiveAt}.`,
    eyebrow: "Legal",
    title: "We're updating our terms.",
    body,
    cta: { label: "Read the updated terms →", href: termsUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/legal-tos-update.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): legal-tos-update template"
```

---

## Task 17: Template — legal-privacy-update

**Files:**
- Create: `api/lib/email/templates/legal-privacy-update.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderLegalPrivacyUpdate } from "../../api/lib/email/templates/legal-privacy-update.js";

test("legal-privacy-update: renders info callout, changes list, effective date, privacy URL", () => {
  const fx = FIXTURES["legal-privacy-update"];
  const html = renderLegalPrivacyUpdate(fx);
  assert.match(html, /Summary/);
  for (const change of fx.changes) {
    assert.match(html, new RegExp(escRe(change)));
  }
  assert.match(html, /May 15, 2026/);
  assert.match(html, new RegExp(escRe(fx.privacyUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/legal-privacy-update.js`:

```js
import { renderEmail } from "../shell.js";
import { renderCallout, esc } from "../components.js";
import { T } from "../tokens.js";

export function renderLegalPrivacyUpdate({ user, summary, changes = [], effectiveAt, privacyUrl }) {
  const bullets = changes.map(c => `<li style="padding:4px 0; color:${T.muted}; line-height:1.55;">${esc(c)}</li>`).join("");
  const body = `
    ${renderCallout({ tone: "info", title: "Summary", body: summary })}
    <div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">What's changing</div>
    <ul style="margin:0 0 18px; padding-left:20px;">${bullets}</ul>
    <p style="margin:14px 0 0; color:${T.muted}; font-size:14px;">Effective <strong style="color:${T.ink};">${esc(effectiveAt)}</strong>.</p>
  `;
  return renderEmail({
    preheader: `Updated Privacy Policy — effective ${effectiveAt}.`,
    eyebrow: "Legal",
    title: "Privacy policy update.",
    body,
    cta: { label: "Read the updated policy →", href: privacyUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/legal-privacy-update.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): legal-privacy-update template"
```

---

## Task 18: Template — data-export-ready

**Files:**
- Create: `api/lib/email/templates/data-export-ready.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderDataExportReady } from "../../api/lib/email/templates/data-export-ready.js";

test("data-export-ready: stat rows, expiry warning, checksum code block", () => {
  const fx = FIXTURES["data-export-ready"];
  const html = renderDataExportReady(fx);
  assert.match(html, /48 MB/);
  assert.match(html, /12,421 chat messages/);
  assert.match(html, /ZIP/);
  assert.match(html, /rgba\(251,191,36,0\.08\)/); // warning
  assert.match(html, /3f8c1e4b9d0a7c2f/);
  assert.match(html, new RegExp(escRe(fx.downloadUrl)));
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/data-export-ready.js`:

```js
import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout, renderCodeBlock } from "../components.js";
import { T } from "../tokens.js";

export function renderDataExportReady({ user, downloadUrl, size, rows, format, expiresIn, sha256 }) {
  const body = `
    <p style="margin:0 0 18px;">Your Emersus data export is ready. Download it below.</p>
    ${renderStatRow({ label: "Size",    value: size })}
    ${renderStatRow({ label: "Contents", value: rows })}
    ${renderStatRow({ label: "Format",  value: format })}
    ${renderCallout({ tone: "warning", title: "Link expires in " + expiresIn, body: "After that the file is deleted from our servers. You can always request a fresh export from your profile." })}
    <div style="margin:18px 0 6px; font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim};">SHA-256 checksum</div>
    ${renderCodeBlock({ code: sha256 })}
  `;
  return renderEmail({
    preheader: `Your ${size} export is ready — download link inside.`,
    eyebrow: "Data",
    title: "Your export is ready.",
    body,
    cta: { label: "Download export →", href: downloadUrl },
    footer: { toEmail: user.email },
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/data-export-ready.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): data-export-ready template"
```

---

## Task 19: Template — research-new-paper (marketing)

**Files:**
- Create: `api/lib/email/templates/research-new-paper.js`
- Modify: `scripts/test/email-templates.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { renderResearchNewPaper } from "../../api/lib/email/templates/research-new-paper.js";

test("research-new-paper: source row + abstract + reason + unsubscribe footer", () => {
  const fx = FIXTURES["research-new-paper"];
  const html = renderResearchNewPaper({ ...fx, unsubscribeUrl: "https://emersus.ai/api/email/unsubscribe?m=1&b=research_alerts&k=sig" });
  assert.match(html, new RegExp(escRe(fx.paper.title)));
  assert.match(html, /J Int Soc Sports Nutr/);
  assert.match(html, /2026/);
  assert.match(html, /digit-span performance/);
  assert.match(html, new RegExp(escRe(fx.reason)));
  assert.match(html, /Unsubscribe/);
});

test("research-new-paper: renders without unsubscribeUrl (test fallback)", () => {
  const fx = FIXTURES["research-new-paper"];
  const html = renderResearchNewPaper(fx);
  // Shouldn't throw; unsubscribe is added by the sender, not the template
  assert.match(html, /Read on Emersus/);
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `api/lib/email/templates/research-new-paper.js`:

```js
import { renderEmail } from "../shell.js";
import { renderSourceRow, esc } from "../components.js";
import { T } from "../tokens.js";

const GRADE_LABEL = {
  high:     "HIGH",
  moderate: "MODERATE",
  limited:  "LIMITED",
  insufficient: "INSUFFICIENT",
};

export function renderResearchNewPaper({ user, topic, paper, readUrl, reason, unsubscribeUrl }) {
  const grade = GRADE_LABEL[String(paper.grade || "").toLowerCase()] || "GRADED";
  const meta = `${paper.journal} · ${paper.year} · ${grade}`;
  const body = `
    <p style="margin:0 0 14px;">A new paper matching <strong style="color:${T.ink};">${esc(topic)}</strong> just landed in your follow list.</p>
    ${renderSourceRow({ index: 1, title: paper.title, meta, href: `https://doi.org/${paper.doi}` })}
    <p style="margin:14px 0 4px; color:${T.muted}; font-size:14px; line-height:1.6;">${esc(paper.abstract)}</p>
    <p style="margin:8px 0 0; color:${T.dim}; font-size:12px; font-family:${T.stack.mono}; letter-spacing:0.12em; text-transform:uppercase;">${esc(reason)}</p>
  `;
  return renderEmail({
    preheader: `New paper on ${topic}: ${paper.title.slice(0, 60)}…`,
    eyebrow: "Research",
    title: "New paper in your follow list.",
    body,
    cta: { label: "Read on Emersus →", href: readUrl },
    footer: { toEmail: user.email },
    marketing: true,
    unsubscribeUrl,
  });
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-templates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/lib/email/templates/research-new-paper.js scripts/test/email-templates.test.mjs
git commit -m "feat(email): research-new-paper marketing template"
```

---

## Task 20: Preview script

**Files:**
- Create: `scripts/preview-emails.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/preview-emails.mjs`:

```js
#!/usr/bin/env node
// scripts/preview-emails.mjs
// Render every template to ./.email-preview/<name>.html + an index.html
// linking to them. Optional filter arg = substring match on template name.
//
// Usage:
//   node scripts/preview-emails.mjs             # render all 12
//   node scripts/preview-emails.mjs receipt     # render only templates whose name contains 'receipt'

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "./email-fixtures.js";

import { renderAuthVerify }         from "../api/lib/email/templates/auth-verify.js";
import { renderAuthReset }          from "../api/lib/email/templates/auth-reset.js";
import { renderAuthWelcome }        from "../api/lib/email/templates/auth-welcome.js";
import { renderAuthPasswordChanged } from "../api/lib/email/templates/auth-password-changed.js";
import { renderBillingReceipt }     from "../api/lib/email/templates/billing-receipt.js";
import { renderBillingRenewal }     from "../api/lib/email/templates/billing-renewal.js";
import { renderBillingPaymentFailed } from "../api/lib/email/templates/billing-payment-failed.js";
import { renderBillingCancellation } from "../api/lib/email/templates/billing-cancellation.js";
import { renderLegalTosUpdate }     from "../api/lib/email/templates/legal-tos-update.js";
import { renderLegalPrivacyUpdate } from "../api/lib/email/templates/legal-privacy-update.js";
import { renderDataExportReady }    from "../api/lib/email/templates/data-export-ready.js";
import { renderResearchNewPaper }   from "../api/lib/email/templates/research-new-paper.js";

const RENDERERS = {
  "auth-verify":            renderAuthVerify,
  "auth-reset":             renderAuthReset,
  "auth-welcome":           renderAuthWelcome,
  "auth-password-changed":  renderAuthPasswordChanged,
  "billing-receipt":        renderBillingReceipt,
  "billing-renewal":        renderBillingRenewal,
  "billing-payment-failed": renderBillingPaymentFailed,
  "billing-cancellation":   renderBillingCancellation,
  "legal-tos-update":       renderLegalTosUpdate,
  "legal-privacy-update":   renderLegalPrivacyUpdate,
  "data-export-ready":      renderDataExportReady,
  "research-new-paper":     (fx) => renderResearchNewPaper({
    ...fx,
    unsubscribeUrl: "https://emersus.ai/api/email/unsubscribe?m=preview&b=research_alerts&k=demo",
  }),
};

async function main() {
  const filter = process.argv[2] || "";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = path.join(root, ".email-preview");
  await fs.mkdir(outDir, { recursive: true });

  const entries = Object.entries(RENDERERS).filter(([k]) => k.includes(filter));
  if (!entries.length) {
    console.error(`no templates match filter ${JSON.stringify(filter)}`);
    process.exit(1);
  }

  for (const [name, fn] of entries) {
    const fx = FIXTURES[name];
    if (!fx) {
      console.error(`no fixture for ${name}`);
      continue;
    }
    const html = fn(fx);
    await fs.writeFile(path.join(outDir, `${name}.html`), html);
    console.log(`rendered ${name}.html`);
  }

  // Index
  const links = entries.map(([k]) => `<li><a href="./${k}.html">${k}</a></li>`).join("\n");
  const index = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Emersus email preview</title>
<style>body{background:#0a0a0b;color:#ededee;font-family:monospace;padding:32px;}
a{color:#34d399;text-decoration:none;}a:hover{text-decoration:underline;}
h1{font-size:16px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8a8f;}</style></head><body>
<h1>Emersus email preview — ${entries.length} template${entries.length === 1 ? "" : "s"}</h1>
<ul>${links}</ul></body></html>`;
  await fs.writeFile(path.join(outDir, "index.html"), index);

  console.log(`\nOpen: file://${path.join(outDir, "index.html").replace(/\\/g, "/")}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the preview**

Run: `node scripts/preview-emails.mjs`
Expected: stdout shows `rendered <name>.html` × 12 then the file:// URL. `.email-preview/` contains 13 files (12 templates + index.html).

- [ ] **Step 3: Manually verify**

Open the printed `file://` URL. Confirm 12 links render without exceptions. Each one should display in Graphite·Jade.

- [ ] **Step 4: Commit**

```bash
git add scripts/preview-emails.mjs
git commit -m "feat(email): preview-emails.mjs renders all 12 to .email-preview/"
```

---

## Task 21: Senders facade

**Files:**
- Create: `api/lib/email/senders.js`
- Create: `scripts/test/email-senders.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test/email-senders.test.mjs`:

```js
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";
process.env.RESEND_API_KEY = "re_test_do_not_use";
process.env.RESEND_FROM_EMAIL = "Emersus <noreply@emersus.ai>";

// Stub the resend module BEFORE importing senders.
const resendSpy = mock.fn(async () => ({ data: { id: "re_fake_001" }, error: null }));
mock.module("../../api/lib/resend-mail.js", {
  namedExports: { sendResendEmail: resendSpy, getResendTemplateId: () => "" },
});

// Stub the supabase admin client.
const sends = [];
const supabaseStub = {
  from(table) {
    return {
      insert(row) {
        if (table === "email_sends") {
          const id = `send-${sends.length + 1}`;
          sends.push({ id, ...row });
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        }
        return { select: async () => ({ data: null, error: null }) };
      },
      update(patch) {
        return { eq: async () => ({ error: null }) };
      },
      select() {
        return { eq: () => ({ single: async () => ({ data: null, error: null }) }) };
      },
    };
  },
};
mock.module("../../api/lib/clients.js", {
  namedExports: { supabaseAdmin: supabaseStub },
});

const { sendAuthVerify } = await import("../../api/lib/email/senders.js");

test("sendAuthVerify writes email_sends row + calls resend + returns sendId", async () => {
  resendSpy.mock.resetCalls();
  sends.length = 0;
  const res = await sendAuthVerify({
    userId: "u-1",
    to: "sid@example.com",
    confirmUrl: "https://emersus.ai/auth/confirm?token=xyz",
  });
  assert.equal(res.sendId, "send-1");
  assert.equal(resendSpy.mock.callCount(), 1);
  const [call] = resendSpy.mock.calls[0].arguments;
  assert.equal(call.to, "sid@example.com");
  assert.match(call.subject, /Confirm your email/);
  assert.ok(Array.isArray(call.tags));
  assert.ok(call.tags.find(t => t.name === "template" && t.value === "auth-verify"));
});
```

- [ ] **Step 2: Run test — should fail**

Run: `node --test scripts/test/email-senders.test.mjs`
Expected: FAIL (`Cannot find module ../../api/lib/email/senders.js`).

- [ ] **Step 3: Implement senders.js**

Create `api/lib/email/senders.js`:

```js
// api/lib/email/senders.js
// Thin wrappers: one sendX per template. Each one:
//   1. checks suppression (marketing only)
//   2. inserts an email_sends row
//   3. builds tracked CTA URL
//   4. renders the template
//   5. calls sendResendEmail
//   6. updates email_sends.resend_id
//
// Returns { sendId, resendId, skipped? }.

import { sendResendEmail } from "../resend-mail.js";
import { supabaseAdmin } from "../clients.js";
import { buildTrackedUrl } from "./tracking.js";

import { renderAuthVerify }            from "./templates/auth-verify.js";
import { renderAuthReset }             from "./templates/auth-reset.js";
import { renderAuthWelcome }           from "./templates/auth-welcome.js";
import { renderAuthPasswordChanged }   from "./templates/auth-password-changed.js";
import { renderBillingReceipt }        from "./templates/billing-receipt.js";
import { renderBillingRenewal }        from "./templates/billing-renewal.js";
import { renderBillingPaymentFailed }  from "./templates/billing-payment-failed.js";
import { renderBillingCancellation }   from "./templates/billing-cancellation.js";
import { renderLegalTosUpdate }        from "./templates/legal-tos-update.js";
import { renderLegalPrivacyUpdate }    from "./templates/legal-privacy-update.js";
import { renderDataExportReady }       from "./templates/data-export-ready.js";
import { renderResearchNewPaper }      from "./templates/research-new-paper.js";

const FROM = () => process.env.RESEND_FROM_EMAIL || "Emersus <noreply@emersus.ai>";
const REPLY_TO = () => process.env.RESEND_REPLY_TO_EMAIL || "info@emersus.ai";

/** Is this user on the marketing suppression list for this bucket? */
async function isSuppressed({ userId, bucket, supabase = supabaseAdmin }) {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("email_unsubscribes")
    .select("bucket")
    .eq("user_id", userId)
    .in("bucket", [bucket, "all_marketing"]);
  if (error) return false; // fail-open for deliverability; logged upstream
  return (data?.length || 0) > 0;
}

/** Shared flow. `renderFn` must produce the final HTML string. */
async function sendEmail({
  template,
  userId,
  to,
  subject,
  renderFn,
  marketing = false,
  marketingBucket,
  idempotencyKey,
  headers,
  supabase = supabaseAdmin,
  send = sendResendEmail,
}) {
  if (marketing) {
    if (!marketingBucket) throw new Error(`marketingBucket required for marketing template ${template}`);
    const suppressed = await isSuppressed({ userId, bucket: marketingBucket, supabase });
    if (suppressed) return { sendId: null, resendId: null, skipped: "suppressed" };
  }

  // Idempotency: if the same key is already logged, skip.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("email_sends")
      .select("id, resend_id")
      .contains("tags", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle?.() || { data: null };
    if (existing?.id) return { sendId: existing.id, resendId: existing.resend_id, skipped: "idempotent" };
  }

  // 1. Insert send row (resend_id pending)
  const { data: sendRow, error: insertErr } = await supabase
    .from("email_sends")
    .insert({
      template,
      user_id: userId || null,
      to_email: to,
      subject,
      tags: idempotencyKey ? { idempotency_key: idempotencyKey } : {},
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(`email_sends insert failed: ${insertErr.message}`);
  const sendId = sendRow.id;

  // 2. Render (renderFn closes over sendId for CTA signing)
  const html = renderFn(sendId);

  // 3. Send via Resend
  const tags = [
    { name: "template", value: template },
    { name: "send_id",  value: sendId },
  ];
  if (userId) tags.push({ name: "user_id", value: userId });

  const result = await send({
    from: FROM(),
    to,
    replyTo: REPLY_TO(),
    subject,
    html,
    tags,
    ...(headers ? { headers } : {}),
  });

  const resendId = result?.data?.id || null;

  // 4. Patch resend_id back
  if (resendId) {
    await supabase.from("email_sends").update({ resend_id: resendId }).eq("id", sendId);
  }

  return { sendId, resendId };
}

// ----- per-template senders -------------------------------------------------

export async function sendAuthVerify({ userId, to, confirmUrl }) {
  return sendEmail({
    template: "auth-verify",
    userId, to,
    subject: "Confirm your email",
    renderFn: () => renderAuthVerify({ user: { email: to }, confirmUrl }),
  });
}

export async function sendAuthReset({ userId, to, resetUrl, expiresIn }) {
  return sendEmail({
    template: "auth-reset",
    userId, to,
    subject: "Reset your Emersus password",
    renderFn: () => renderAuthReset({ user: { email: to }, resetUrl, expiresIn }),
  });
}

export async function sendAuthWelcome({ userId, to, samplePrompts }) {
  return sendEmail({
    template: "auth-welcome",
    userId, to,
    subject: "Welcome to Emersus",
    renderFn: (sendId) => {
      const appUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/",
        utmCampaign: "auth-welcome", marketing: false, userId,
      });
      return renderAuthWelcome({ user: { email: to }, appUrl, samplePrompts });
    },
  });
}

export async function sendAuthPasswordChanged({ userId, to, changedAt, device, location, ip }) {
  return sendEmail({
    template: "auth-password-changed",
    userId, to,
    subject: "Your password was changed",
    renderFn: (sendId) => {
      const resetUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/auth/reset-password",
        utmCampaign: "auth-password-changed", marketing: false, userId,
      });
      return renderAuthPasswordChanged({ user: { email: to }, changedAt, device, location, ip, resetUrl });
    },
  });
}

export async function sendBillingReceipt({ userId, to, plan, period, amount, cardLast4, invoiceUrl }) {
  return sendEmail({
    template: "billing-receipt",
    userId, to,
    subject: `Receipt from Emersus — ${amount}`,
    renderFn: (sendId) => {
      const tracked = buildTrackedUrl({
        sendId, target: invoiceUrl,
        utmCampaign: "billing-receipt", marketing: false, userId,
      });
      return renderBillingReceipt({ user: { email: to }, plan, period, amount, cardLast4, invoiceUrl: tracked });
    },
  });
}

export async function sendBillingRenewal({ userId, to, plan, nextChargeAt, amount, idempotencyKey }) {
  return sendEmail({
    template: "billing-renewal",
    userId, to,
    subject: `Your Emersus subscription renews ${nextChargeAt}`,
    idempotencyKey,
    renderFn: (sendId) => {
      const manageUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/profile?tab=billing",
        utmCampaign: "billing-renewal", marketing: false, userId,
      });
      return renderBillingRenewal({ user: { email: to }, plan, nextChargeAt, amount, manageUrl });
    },
  });
}

export async function sendBillingPaymentFailed({ userId, to, cardLast4, reason, retryAt, finalAttemptAt }) {
  return sendEmail({
    template: "billing-payment-failed",
    userId, to,
    subject: "We couldn't charge your card",
    renderFn: (sendId) => {
      const updateUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/profile?tab=billing",
        utmCampaign: "billing-payment-failed", marketing: false, userId,
      });
      return renderBillingPaymentFailed({ user: { email: to }, cardLast4, reason, retryAt, finalAttemptAt, updateUrl });
    },
  });
}

export async function sendBillingCancellation({ userId, to, accessThrough, refund }) {
  return sendEmail({
    template: "billing-cancellation",
    userId, to,
    subject: "Your subscription is cancelled",
    renderFn: (sendId) => {
      const reactivateUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/pricing/",
        utmCampaign: "billing-cancellation", marketing: false, userId,
      });
      return renderBillingCancellation({ user: { email: to }, accessThrough, refund, reactivateUrl });
    },
  });
}

export async function sendLegalTosUpdate({ userId, to, summary, changes, effectiveAt }) {
  return sendEmail({
    template: "legal-tos-update",
    userId, to,
    subject: `Updated Terms of Service · effective ${effectiveAt}`,
    renderFn: (sendId) => {
      const termsUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/terms/",
        utmCampaign: "legal-tos-update", marketing: false, userId,
      });
      return renderLegalTosUpdate({ user: { email: to }, summary, changes, effectiveAt, termsUrl });
    },
  });
}

export async function sendLegalPrivacyUpdate({ userId, to, summary, changes, effectiveAt }) {
  return sendEmail({
    template: "legal-privacy-update",
    userId, to,
    subject: `Updated Privacy Policy · effective ${effectiveAt}`,
    renderFn: (sendId) => {
      const privacyUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/privacy/",
        utmCampaign: "legal-privacy-update", marketing: false, userId,
      });
      return renderLegalPrivacyUpdate({ user: { email: to }, summary, changes, effectiveAt, privacyUrl });
    },
  });
}

export async function sendDataExportReady({ userId, to, downloadUrl, size, rows, format, expiresIn, sha256 }) {
  return sendEmail({
    template: "data-export-ready",
    userId, to,
    subject: "Your data export is ready",
    renderFn: (sendId) => {
      const tracked = buildTrackedUrl({
        sendId, target: downloadUrl,
        utmCampaign: "data-export-ready", marketing: false, userId,
      });
      return renderDataExportReady({ user: { email: to }, downloadUrl: tracked, size, rows, format, expiresIn, sha256 });
    },
  });
}

export async function sendResearchNewPaper({ userId, to, topic, paper, reason, idempotencyKey }) {
  return sendEmail({
    template: "research-new-paper",
    userId, to,
    subject: `New paper on ${topic}: ${paper.title.slice(0, 48)}…`,
    marketing: true,
    marketingBucket: "research_alerts",
    idempotencyKey,
    renderFn: (sendId) => {
      const readUrl = buildTrackedUrl({
        sendId, target: `https://emersus.ai/chat?ref=new-paper&p=${encodeURIComponent(paper.doi)}`,
        utmCampaign: "research-new-paper", marketing: true, userId,
      });
      const unsubscribeUrl = buildUnsubscribeUrl({ sendId, bucket: "research_alerts" });
      return renderResearchNewPaper({ user: { email: to }, topic, paper, readUrl, reason, unsubscribeUrl });
    },
    headers: buildListUnsubscribeHeaders({ sendIdForHeaders: null, bucket: "research_alerts" }),
    // Note: List-Unsubscribe wants the URL ready at send-time. We include a
    // header-shim below post-send patch.
  });
}

import { signUnsubscribe } from "./tracking.js";

function buildUnsubscribeUrl({ sendId, bucket, baseUrl = "https://emersus.ai" }) {
  const sig = signUnsubscribe({ sendId, bucket });
  const q = new URLSearchParams({ m: sendId, b: bucket, k: sig });
  return `${baseUrl}/api/email/unsubscribe?${q.toString()}`;
}

/**
 * Gmail/Yahoo one-click unsub headers. We compute them from the sendId —
 * but sendId isn't known until INSERT. Workaround: sendEmail passes
 * `sendIdForHeaders` via the headers closure; we build them inside
 * renderFn using the real sendId. See next task for the wiring fix.
 */
function buildListUnsubscribeHeaders({ sendIdForHeaders, bucket }) {
  if (!sendIdForHeaders) return undefined;
  const url = buildUnsubscribeUrl({ sendId: sendIdForHeaders, bucket });
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
```

- [ ] **Step 4: Fix the List-Unsubscribe header timing**

The helper above can't know `sendId` until after the DB insert. Refactor `sendEmail` to let per-template senders supply a `buildHeaders(sendId)` function:

Replace the `sendEmail` signature + body in `api/lib/email/senders.js`:

```js
async function sendEmail({
  template,
  userId,
  to,
  subject,
  renderFn,
  marketing = false,
  marketingBucket,
  idempotencyKey,
  buildHeaders,
  supabase = supabaseAdmin,
  send = sendResendEmail,
}) {
  // ... marketing suppression + idempotency (unchanged) ...

  // insert email_sends
  const { data: sendRow, error: insertErr } = await supabase
    .from("email_sends")
    .insert({
      template,
      user_id: userId || null,
      to_email: to,
      subject,
      tags: idempotencyKey ? { idempotency_key: idempotencyKey } : {},
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(`email_sends insert failed: ${insertErr.message}`);
  const sendId = sendRow.id;

  const html = renderFn(sendId);
  const headers = buildHeaders ? buildHeaders(sendId) : undefined;

  const tags = [
    { name: "template", value: template },
    { name: "send_id",  value: sendId },
  ];
  if (userId) tags.push({ name: "user_id", value: userId });

  const result = await send({
    from: FROM(),
    to,
    replyTo: REPLY_TO(),
    subject,
    html,
    tags,
    ...(headers ? { headers } : {}),
  });

  const resendId = result?.data?.id || null;
  if (resendId) {
    await supabase.from("email_sends").update({ resend_id: resendId }).eq("id", sendId);
  }

  return { sendId, resendId };
}
```

Then rewrite `sendResearchNewPaper` (same file) to pass `buildHeaders`:

```js
export async function sendResearchNewPaper({ userId, to, topic, paper, reason, idempotencyKey }) {
  return sendEmail({
    template: "research-new-paper",
    userId, to,
    subject: `New paper on ${topic}: ${paper.title.slice(0, 48)}…`,
    marketing: true,
    marketingBucket: "research_alerts",
    idempotencyKey,
    renderFn: (sendId) => {
      const readUrl = buildTrackedUrl({
        sendId, target: `https://emersus.ai/chat?ref=new-paper&p=${encodeURIComponent(paper.doi)}`,
        utmCampaign: "research-new-paper", marketing: true, userId,
      });
      const unsubscribeUrl = buildUnsubscribeUrl({ sendId, bucket: "research_alerts" });
      return renderResearchNewPaper({ user: { email: to }, topic, paper, readUrl, reason, unsubscribeUrl });
    },
    buildHeaders: (sendId) => {
      const url = buildUnsubscribeUrl({ sendId, bucket: "research_alerts" });
      return {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    },
  });
}
```

Remove the stale `buildListUnsubscribeHeaders` function and the `headers:` key from the original `sendResearchNewPaper` draft.

- [ ] **Step 5: Update resend-mail.js to forward `headers` to Resend**

Open `api/lib/resend-mail.js` and extend `sendResendEmail` to accept `headers`:

```js
export async function sendResendEmail({
  from, to, subject, replyTo, cc, bcc, html, text,
  templateId, templateVariables, tags, headers,
}) {
  // ... existing code ...
  if (headers) payload.headers = headers;
  // ... existing code ...
}
```

Locate the payload construction block (currently ~lines 33-46) and add `if (headers) payload.headers = headers;` before the `if (templateId) {` branch.

- [ ] **Step 6: Run senders test — should pass**

Run: `node --test scripts/test/email-senders.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run full template suite**

Run: `node --test scripts/test/`
Expected: PASS across all email-*.test.mjs files.

- [ ] **Step 8: Commit**

```bash
git add api/lib/email/senders.js scripts/test/email-senders.test.mjs api/lib/resend-mail.js
git commit -m "feat(email): senders facade with tracking, suppression, and unsub headers"
```

---

## Task 22: Route — POST /api/email/webhook/resend

**Files:**
- Create: `api/email/webhook-resend.js`
- Create: `scripts/test/email-webhook.test.mjs`
- Modify: `package.json` (add `svix` dependency if not present)

**Context:** Resend uses the Svix webhook protocol. The Svix npm package handles signature verification. Check if it's already a dependency.

- [ ] **Step 1: Check + install svix**

Run: `grep -n "svix" package.json`
If absent, run: `npm install svix`

- [ ] **Step 2: Write failing test**

Create `scripts/test/email-webhook.test.mjs`:

```js
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.RESEND_WEBHOOK_SECRET = "whsec_test_" + "a".repeat(32);

// Capture DB inserts
const calls = { sends: [], events: [], unsubs: [] };
const stubSupabase = {
  from(table) {
    if (table === "email_sends") {
      return {
        select() { return { eq: () => ({ maybeSingle: async () => ({ data: { id: "send-1" }, error: null }) }) }; },
      };
    }
    if (table === "email_events") {
      return {
        insert(row) { calls.events.push(row); return { select: async () => ({ data: null, error: null }) }; },
      };
    }
    if (table === "email_unsubscribes") {
      return {
        upsert(row) { calls.unsubs.push(row); return { error: null }; },
      };
    }
    return {};
  },
};
mock.module("../../api/lib/clients.js", {
  namedExports: { supabaseAdmin: stubSupabase },
});

const { Webhook } = await import("svix");

// Build a valid-signature request
function makeReq(body) {
  const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
  const id = "msg_" + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(body);
  const signature = wh.sign(id, new Date(timestamp * 1000), payload);
  return {
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signature,
    },
    rawBody: payload,
  };
}

const { handleResendWebhook } = await import("../../api/email/webhook-resend.js");

test("valid 'email.delivered' event writes email_events row", async () => {
  calls.events.length = 0;
  const body = { type: "email.delivered", created_at: "2026-04-24T12:00:00Z", data: { email_id: "re_001" } };
  const req = makeReq(body);
  const res = await handleResendWebhook(req);
  assert.equal(res.statusCode, 202);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].kind, "delivered");
  assert.equal(calls.events[0].resend_id, "re_001");
});

test("'email.complained' upserts into email_unsubscribes", async () => {
  calls.events.length = 0;
  calls.unsubs.length = 0;
  const body = { type: "email.complained", created_at: "2026-04-24T12:01:00Z", data: { email_id: "re_002" } };
  const req = makeReq(body);
  await handleResendWebhook(req);
  assert.equal(calls.unsubs.length, 1);
  assert.equal(calls.unsubs[0].bucket, "all_marketing");
  assert.equal(calls.unsubs[0].source, "complaint");
});

test("invalid signature returns 401", async () => {
  const req = {
    headers: { "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,nope" },
    rawBody: JSON.stringify({ type: "email.delivered", data: { email_id: "re_x" } }),
  };
  const res = await handleResendWebhook(req);
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 3: Run — fail**

Run: `node --test scripts/test/email-webhook.test.mjs`
Expected: FAIL.

- [ ] **Step 4: Implement handler**

Create `api/email/webhook-resend.js`:

```js
// api/email/webhook-resend.js
// POST /api/email/webhook/resend — Svix-signed delivery events from Resend.
// Business logic lives in handleResendWebhook; the Express handler wraps it
// with req.body/rawBody plumbing. Test harness bypasses Express and calls
// handleResendWebhook directly with a { headers, rawBody } shim.

import { Webhook } from "svix";
import { supabaseAdmin } from "../lib/clients.js";

const TYPE_TO_KIND = {
  "email.delivered":        "delivered",
  "email.bounced":          "bounced",
  "email.complained":       "complained",
  "email.opened":           "opened",
  "email.clicked":          "clicked",
  "email.delivery_delayed": "delivery_delayed",
};

/** Pure-ish handler. Returns `{ statusCode, body }`. */
export async function handleResendWebhook({ headers, rawBody }, {
  supabase = supabaseAdmin,
  secret = process.env.RESEND_WEBHOOK_SECRET,
} = {}) {
  if (!secret) {
    return { statusCode: 500, body: { error: "webhook secret not configured" } };
  }
  let event;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id":        headers["webhook-id"]        || headers["svix-id"],
      "svix-timestamp": headers["webhook-timestamp"] || headers["svix-timestamp"],
      "svix-signature": headers["webhook-signature"] || headers["svix-signature"],
    });
  } catch (err) {
    return { statusCode: 401, body: { error: "invalid signature", detail: err.message } };
  }

  const kind = TYPE_TO_KIND[event.type];
  if (!kind) return { statusCode: 202, body: { ignored: event.type } };

  const resendId = event?.data?.email_id;
  const occurredAt = event?.created_at || new Date().toISOString();
  if (!resendId) return { statusCode: 202, body: { ignored: "no email_id" } };

  // Match to email_sends row (may be null for Supabase-Auth-sent emails)
  const { data: sendRow } = await supabase
    .from("email_sends")
    .select("id, user_id")
    .eq("resend_id", resendId)
    .maybeSingle();

  // Insert the event row (idempotent on dedup index)
  const ins = await supabase.from("email_events").insert({
    send_id: sendRow?.id || null,
    resend_id: resendId,
    kind,
    payload: event,
    occurred_at: occurredAt,
  });
  if (ins?.error && ins.error.code !== "23505") {
    throw new Error(`email_events insert: ${ins.error.message}`);
  }

  // Complaint: auto-suppress all marketing for this user.
  if (kind === "complained" && sendRow?.user_id) {
    await supabase.from("email_unsubscribes").upsert({
      user_id: sendRow.user_id,
      bucket: "all_marketing",
      source: "complaint",
    });
  }

  return { statusCode: 202, body: { ok: true, kind, send_id: sendRow?.id || null } };
}

/** Express handler. Expects raw-body middleware to have captured req.rawBody. */
export async function resendWebhookExpressHandler(req, res) {
  const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  const result = await handleResendWebhook({ headers: req.headers, rawBody });
  res.status(result.statusCode).json(result.body);
}
```

- [ ] **Step 5: Run — pass**

Run: `node --test scripts/test/email-webhook.test.mjs`
Expected: PASS (3 pass).

- [ ] **Step 6: Commit**

```bash
git add api/email/webhook-resend.js scripts/test/email-webhook.test.mjs package.json package-lock.json
git commit -m "feat(email): svix-verified Resend webhook handler"
```

---

## Task 23: Route — GET /api/email/track/click

**Files:**
- Create: `api/email/track-click.js`
- Create: `scripts/test/email-click.test.mjs`

- [ ] **Step 1: Write failing test**

Create `scripts/test/email-click.test.mjs`:

```js
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";

const events = [];
mock.module("../../api/lib/clients.js", {
  namedExports: {
    supabaseAdmin: {
      from: (t) => t === "email_events"
        ? { insert(row) { events.push(row); return { select: async () => ({ data: null, error: null }) }; } }
        : {},
    },
  },
});

const { handleTrackClick } = await import("../../api/email/track-click.js");
const { signClick } = await import("../../api/lib/email/tracking.js");

test("valid signature 302s to target and logs a click event", async () => {
  events.length = 0;
  const target = "https://emersus.ai/app/?utm_source=email&utm_campaign=auth-welcome";
  const sendId = "send-1";
  const sig = signClick({ sendId, target });
  const to = Buffer.from(target).toString("base64url");
  const res = await handleTrackClick({
    query: { m: sendId, to, k: sig, utm_campaign: "auth-welcome" },
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, target);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "clicked");
  assert.equal(events[0].send_id, sendId);
});

test("bad signature returns 400 and logs no event", async () => {
  events.length = 0;
  const target = "https://emersus.ai/app/";
  const to = Buffer.from(target).toString("base64url");
  const res = await handleTrackClick({
    query: { m: "send-1", to, k: "bad", utm_campaign: "x" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(events.length, 0);
});

test("missing params return 400", async () => {
  const res = await handleTrackClick({ query: {} });
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-click.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Create `api/email/track-click.js`:

```js
// api/email/track-click.js
// GET /api/email/track/click?m=<send_id>&to=<b64url>&k=<hmac>
// Verifies HMAC, logs a 'clicked' event, then 302s to the target.
// Fails closed (400) on any verification failure.

import { verifyClick } from "../lib/email/tracking.js";
import { supabaseAdmin } from "../lib/clients.js";

export async function handleTrackClick({ query }, { supabase = supabaseAdmin } = {}) {
  const sendId = String(query?.m || "").trim();
  const toEnc  = String(query?.to || "").trim();
  const sig    = String(query?.k || "").trim();
  if (!sendId || !toEnc || !sig) {
    return { statusCode: 400, headers: {}, body: "missing params" };
  }

  let target;
  try {
    target = Buffer.from(toEnc, "base64url").toString("utf8");
    new URL(target);
  } catch {
    return { statusCode: 400, headers: {}, body: "bad target" };
  }

  if (!verifyClick({ sendId, target, sig })) {
    return { statusCode: 400, headers: {}, body: "bad signature" };
  }

  // Log the click (fire-and-forget is fine; we still wait to avoid losing it)
  try {
    await supabase.from("email_events").insert({
      send_id: sendId,
      resend_id: "click-" + sendId, // synthetic; webhook clicks come from Resend separately
      kind: "clicked",
      payload: { url: target, source: "server-redirect" },
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    // Don't block the redirect on a logging failure.
    console.error("[email-click] log failed:", err.message);
  }

  return { statusCode: 302, headers: { Location: target }, body: null };
}

export async function trackClickExpressHandler(req, res) {
  const result = await handleTrackClick({ query: req.query });
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.status(result.statusCode);
  if (result.body !== null) res.send(result.body);
  else res.end();
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-click.test.mjs`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add api/email/track-click.js scripts/test/email-click.test.mjs
git commit -m "feat(email): HMAC-verified click redirect route"
```

---

## Task 24: Route — GET/POST /api/email/unsubscribe

**Files:**
- Create: `api/email/unsubscribe.js`
- Create: `scripts/test/email-unsubscribe.test.mjs`

- [ ] **Step 1: Write failing test**

Create `scripts/test/email-unsubscribe.test.mjs`:

```js
import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CLICK_SECRET = "test-secret-do-not-use-in-prod-12345";

const sendRows = { "send-1": { id: "send-1", user_id: "u-1" } };
const upserts = [];
mock.module("../../api/lib/clients.js", {
  namedExports: {
    supabaseAdmin: {
      from(t) {
        if (t === "email_sends") {
          return {
            select() {
              return {
                eq: (_, id) => ({ maybeSingle: async () => ({ data: sendRows[id] || null, error: null }) }),
              };
            },
          };
        }
        if (t === "email_unsubscribes") {
          return { upsert(row) { upserts.push(row); return { error: null }; } };
        }
        return {};
      },
    },
  },
});

const { handleUnsubscribe } = await import("../../api/email/unsubscribe.js");
const { signUnsubscribe } = await import("../../api/lib/email/tracking.js");

test("valid signature upserts email_unsubscribes and returns 200 HTML", async () => {
  upserts.length = 0;
  const sig = signUnsubscribe({ sendId: "send-1", bucket: "research_alerts" });
  const res = await handleUnsubscribe({ query: { m: "send-1", b: "research_alerts", k: sig } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /unsubscribed/i);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].user_id, "u-1");
  assert.equal(upserts[0].bucket, "research_alerts");
  assert.equal(upserts[0].source, "one_click");
});

test("bad signature returns 400", async () => {
  const res = await handleUnsubscribe({ query: { m: "send-1", b: "research_alerts", k: "bad" } });
  assert.equal(res.statusCode, 400);
});

test("unknown bucket returns 400", async () => {
  const sig = signUnsubscribe({ sendId: "send-1", bucket: "research_alerts" });
  const res = await handleUnsubscribe({ query: { m: "send-1", b: "bogus", k: sig } });
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run — fail**

Run: `node --test scripts/test/email-unsubscribe.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Create `api/email/unsubscribe.js`:

```js
// api/email/unsubscribe.js
// GET|POST /api/email/unsubscribe?m=<send_id>&b=<bucket>&k=<hmac>
// HMAC-verified one-click unsub. Idempotent upsert into email_unsubscribes.
// POST is required by the List-Unsubscribe-Post: List-Unsubscribe=One-Click
// header. Empty body; same query-string verification as GET.

import { verifyUnsubscribe } from "../lib/email/tracking.js";
import { supabaseAdmin } from "../lib/clients.js";
import { T } from "../lib/email/tokens.js";

const VALID_BUCKETS = new Set(["research_alerts", "engagement", "all_marketing"]);

function renderConfirmationPage({ bucket }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Unsubscribed</title>
<style>body{margin:0;padding:0;background:${T.bg};color:${T.ink};font-family:${T.stack.sans};}
.wrap{max-width:480px;margin:0 auto;padding:80px 24px;text-align:center;}
h1{font-size:28px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px;}
p{color:${T.muted};line-height:1.6;}
.tag{display:inline-block;font-family:${T.stack.mono};font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${T.accent};margin-bottom:18px;}
a{color:${T.accent};border-bottom:1px solid ${T.accentLine};text-decoration:none;}
</style></head><body>
<div class="wrap">
<div class="tag">• Unsubscribed</div>
<h1>You're unsubscribed.</h1>
<p>You won't receive <strong style="color:${T.ink};">${bucket.replace(/_/g, " ")}</strong> emails from Emersus anymore. You'll still get account and billing notices. Change your mind? <a href="https://emersus.ai/app/profile?tab=notifications">Resubscribe</a>.</p>
</div></body></html>`;
}

export async function handleUnsubscribe({ query }, { supabase = supabaseAdmin } = {}) {
  const sendId = String(query?.m || "").trim();
  const bucket = String(query?.b || "").trim();
  const sig    = String(query?.k || "").trim();
  if (!sendId || !bucket || !sig || !VALID_BUCKETS.has(bucket)) {
    return { statusCode: 400, headers: {}, body: "bad params" };
  }
  if (!verifyUnsubscribe({ sendId, bucket, sig })) {
    return { statusCode: 400, headers: {}, body: "bad signature" };
  }
  const { data: sendRow } = await supabase
    .from("email_sends")
    .select("id, user_id")
    .eq("id", sendId)
    .maybeSingle();
  if (sendRow?.user_id) {
    await supabase.from("email_unsubscribes").upsert({
      user_id: sendRow.user_id,
      bucket,
      source: "one_click",
    });
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: renderConfirmationPage({ bucket }),
  };
}

export async function unsubscribeExpressHandler(req, res) {
  const result = await handleUnsubscribe({ query: req.query });
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.status(result.statusCode).send(result.body);
}
```

- [ ] **Step 4: Run — pass**

Run: `node --test scripts/test/email-unsubscribe.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/email/unsubscribe.js scripts/test/email-unsubscribe.test.mjs
git commit -m "feat(email): one-click unsubscribe with signed URL"
```

---

## Task 25: Wire routes in server.js

**Files:**
- Modify: `server.js`

**Context:** Resend's webhook POSTs JSON. Svix signature verification needs the **raw body** (exact bytes), not the parsed object. Most Express apps use `express.json()` which consumes the body. Solution: add `express.raw({ type: 'application/json' })` just for the webhook route.

- [ ] **Step 1: Read server.js around existing route registrations**

Run: `grep -n "app\.\(get\|post\|use\)" server.js | head -40`
Observe the pattern for imports (grouped at top) + route registration.

- [ ] **Step 2: Add imports**

Near the other `api/` imports in `server.js`, add:

```js
import { resendWebhookExpressHandler } from "./api/email/webhook-resend.js";
import { trackClickExpressHandler }    from "./api/email/track-click.js";
import { unsubscribeExpressHandler }   from "./api/email/unsubscribe.js";
```

- [ ] **Step 3: Mount the routes**

Near the other `/api/*` route registrations in `server.js`, add:

```js
// --- Email infrastructure ---
// Resend webhook needs the raw body for Svix signature verification, so it
// bypasses the global JSON parser and captures Buffer directly.
import express from "express";
app.post(
  "/api/email/webhook/resend",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res, next) => {
    // Store raw buffer as string for the handler; also parse into req.body
    // for logging/observability without breaking signature verification.
    req.rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "");
    try { req.body = JSON.parse(req.rawBody); } catch { req.body = null; }
    next();
  },
  resendWebhookExpressHandler,
);

app.get("/api/email/track/click",       trackClickExpressHandler);
app.get("/api/email/unsubscribe",       unsubscribeExpressHandler);
app.post("/api/email/unsubscribe",      unsubscribeExpressHandler);
```

If `express` is already imported at the top of `server.js` (it almost certainly is), delete the duplicate `import express from "express";` line from the block above.

- [ ] **Step 4: Boot the server locally and hit a route**

Run: `node server.js &` (or use the project's normal start command — check package.json scripts).
Run: `curl -i "http://localhost:3000/api/email/track/click"` (port may differ — read from startup log).
Expected: `HTTP/1.1 400 Bad Request` body `missing params`.

Kill the server after verifying.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(email): mount webhook + click + unsubscribe routes"
```

---

## Task 26: Port notify-signup.js to sendAuthWelcome

**Files:**
- Modify: `api/notify-signup.js`

**Context:** Currently `notify-signup.js` does two things: (a) notifies the operator on signup, (b) has a local `createEmailShell` for that operator alert. The operator-alert goes to you, not the user. The USER-facing welcome email doesn't exist yet — we add it.

Keep the operator alert using its own inline HTML (it's internal, low-cadence). Add a `sendAuthWelcome()` call to the user right after the operator alert.

- [ ] **Step 1: Read current notify-signup.js bottom**

Run: `wc -l api/notify-signup.js` and read the final `handler` block.

- [ ] **Step 2: Add welcome-send**

In `api/notify-signup.js`, find the block that calls `sendResendEmail(...)` for the operator (around "Send the notification via Resend"). **After** that try/catch, add:

```js
  // --- User-facing welcome email -----------------------------------------
  // Separate from the operator notification above. Failure here must not
  // break signup UX, so we log and continue.
  try {
    const { sendAuthWelcome } = await import("./lib/email/senders.js");
    await sendAuthWelcome({
      userId: user.id,
      to: email,
      samplePrompts: [
        "How much protein do I actually need per day?",
        "Creatine: cycling or continuous?",
        "Zone-2 cardio for fat loss — dose-response?",
      ],
    });
  } catch (err) {
    console.error("[notify-signup] welcome email send failed:", err.message);
  }
```

- [ ] **Step 3: Smoke test (dry)**

Skipping live send — live verification happens in Task 34 (real-client QA).

Run: `node --check api/notify-signup.js`
Expected: no output (parsed OK).

- [ ] **Step 4: Commit**

```bash
git add api/notify-signup.js
git commit -m "feat(email): send welcome email to new users on signup"
```

---

## Task 27: Wire billing webhook handlers

**Files:**
- Modify: `api/billing/webhook.js`

**Context:** The existing `handleVerifiedEvent` function already branches on `event.type` for tier invalidation. Add email sends for receipt / renewal-failed / cancellation in those same branches.

- [ ] **Step 1: Read the full handleVerifiedEvent body**

Run: `grep -n "switch\|case\|event.type" api/billing/webhook.js`
Read 30 lines around the type-dispatch block to understand the branches.

- [ ] **Step 2: Add billing sends**

In `api/billing/webhook.js`, at the top with other imports:

```js
import {
  sendBillingReceipt,
  sendBillingPaymentFailed,
  sendBillingCancellation,
} from "../lib/email/senders.js";
```

Inside `handleVerifiedEvent`, **after** the tier update logic, add a per-type dispatch (the exact placement depends on your current switch structure — keep this close to the existing `switch(event.type)` or if/else chain):

```js
  // ----- Outbound email notifications ----------------------------------
  // Failures here must not break the webhook — Polar retries on non-2xx.
  try {
    const data = event?.data || {};
    const email = data?.customer?.email;
    if (email) {
      if (event.type === "order.paid") {
        await sendBillingReceipt({
          userId,
          to: email,
          plan: data?.product?.name || "Pro",
          period: data?.billing_period?.display || "",
          amount: data?.total_amount ? `$${(data.total_amount / 100).toFixed(2)}` : "",
          cardLast4: data?.payment_method?.card?.last4 || "----",
          invoiceUrl: data?.invoice_url || "https://emersus.ai/app/profile?tab=billing",
        });
      } else if (event.type === "subscription.updated" && data?.status === "past_due") {
        await sendBillingPaymentFailed({
          userId,
          to: email,
          cardLast4: data?.payment_method?.card?.last4 || "----",
          reason: data?.last_payment_error || "Card declined",
          retryAt: data?.next_retry_at || "within 3 days",
          finalAttemptAt: data?.dunning_expires_at || "within 10 days",
        });
      } else if (event.type === "subscription.canceled") {
        await sendBillingCancellation({
          userId,
          to: email,
          accessThrough: data?.current_period_end || "end of current period",
          refund: "No refund — access continues to end of period",
        });
      }
    }
  } catch (err) {
    // Email failure is NOT a webhook failure. Polar already succeeded.
    log?.warn?.("[billing] email send failed", { err: err.message, type: event.type });
    console.error("[billing] email send failed:", err.message);
  }
```

- [ ] **Step 3: Syntax check**

Run: `node --check api/billing/webhook.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add api/billing/webhook.js
git commit -m "feat(email): send billing receipt / payment-failed / cancellation from Polar webhook"
```

---

## Task 28: Worker job — renewal reminder cron

**Files:**
- Create: `jobs/email-renewal-reminder.js`
- Modify: `jobs/_registry.js`

**Context:** Daily at 10:00 NY. Queries Polar subscriptions renewing in 7 days. Uses an idempotency key to avoid duplicate sends within a single cycle.

- [ ] **Step 1: Write handler**

Create `jobs/email-renewal-reminder.js`:

```js
// jobs/email-renewal-reminder.js
// pg-boss handler: daily at 10:00 NY, emails Pro subscribers whose renewal
// is ~7 days away. Idempotency key = `renewal:${subId}:${cycleEnd}` so a
// second run inside the same window is a silent no-op.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendBillingRenewal } from "../api/lib/email/senders.js";

export async function emailRenewalReminderHandler(ctx, { log }) {
  await ctx.progress?.("querying renewals in ~7 days");
  // user_subscriptions schema: (user_id uuid, polar_subscription_id text,
  // status text, current_period_end timestamptz, product_id text, ...)
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400_000);
  const sixDays   = new Date(now.getTime() + 6 * 86400_000);

  const { data: rows, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select("user_id, polar_subscription_id, status, current_period_end, product_id")
    .eq("status", "active")
    .gte("current_period_end", sixDays.toISOString())
    .lte("current_period_end", sevenDays.toISOString());
  if (error) throw error;
  await ctx.progress?.(`found ${rows?.length || 0} renewals to remind`);

  let sent = 0, skipped = 0;
  for (const sub of rows || []) {
    // Look up email via auth.users
    const { data: user } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", sub.user_id)
      .maybeSingle();
    const email = user?.email;
    if (!email) { skipped++; continue; }

    const idempotencyKey = `renewal:${sub.polar_subscription_id}:${sub.current_period_end}`;
    const res = await sendBillingRenewal({
      userId: sub.user_id,
      to: email,
      plan: "Pro",
      nextChargeAt: new Date(sub.current_period_end).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      amount: "$9.00",
      idempotencyKey,
    });
    if (res.skipped) skipped++;
    else sent++;
  }

  await ctx.progress?.(`sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}
```

- [ ] **Step 2: Register handler + schedule**

In `jobs/_registry.js`, add an import at the top with the other handler imports:

```js
import { emailRenewalReminderHandler } from "./email-renewal-reminder.js";
```

Inside `registerHandlers`, after the last `await register(...)` call, add:

```js
  await register("email-renewal-reminder", emailRenewalReminderHandler);
```

In the cron schedules block, add:

```js
  // Daily 10:00 NY — nudge Pro subscribers 7 days before renewal
  await boss.schedule("email-renewal-reminder", "0 10 * * *", {}, { tz: "America/New_York" });
```

- [ ] **Step 3: Syntax check**

Run: `node --check jobs/email-renewal-reminder.js && node --check jobs/_registry.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add jobs/email-renewal-reminder.js jobs/_registry.js
git commit -m "feat(email): daily renewal-reminder cron (emersus-worker)"
```

---

## Task 29: Worker job — research alerts cron

**Files:**
- Create: `jobs/email-research-alerts.js`
- Modify: `jobs/_registry.js`

**Context:** Daily at 12:00 NY. Queries `research_articles` ingested in the last 24h, matches against `user_topic_follows`, sends one email per (user, paper) pair. Marketing class. Idempotency key = `research-alert:${user_id}:${article_id}`.

**Warning:** `user_topic_follows` table may not exist yet. If it doesn't, create a minimal stub in a separate migration — but verify first.

- [ ] **Step 1: Verify the schema**

Run: `grep -rn "user_topic_follows\|research_articles" supabase/migrations/ | head -10`
If `user_topic_follows` does not exist: **STOP** and escalate to the user. Do not create a schema without approval. For now, assume it exists based on memory `project_topic_discovery_pipeline.md`.

- [ ] **Step 2: Write handler**

Create `jobs/email-research-alerts.js`:

```js
// jobs/email-research-alerts.js
// pg-boss handler: daily 12:00 NY. Finds newly-ingested papers (last 24h)
// that match any user's topic follow, sends one marketing email per match,
// deduped by idempotency key. Suppression-aware via sendResearchNewPaper.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendResearchNewPaper } from "../api/lib/email/senders.js";

const WINDOW_HOURS = 24;

export async function emailResearchAlertsHandler(ctx, { log }) {
  await ctx.progress?.("finding newly-ingested papers + follows");
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  // One row per (follow, article) candidate. This query is illustrative —
  // tune the JOIN to match the actual schema for user_topic_follows.
  const { data: matches, error } = await supabaseAdmin.rpc("research_alerts_since", { since_ts: since });
  if (error) {
    // Fallback: direct query. If research_alerts_since RPC is missing,
    // this handler is inert until someone adds it — log but don't throw.
    log?.warn?.("[research-alerts] rpc missing, skipping", { err: error.message });
    return { sent: 0, skipped: 0 };
  }

  let sent = 0, skipped = 0;
  for (const m of matches || []) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", m.user_id)
      .maybeSingle();
    const email = profile?.email;
    if (!email) { skipped++; continue; }

    const idempotencyKey = `research-alert:${m.user_id}:${m.article_id}`;
    const res = await sendResearchNewPaper({
      userId: m.user_id,
      to: email,
      topic: m.topic_label || m.topic_query,
      paper: {
        title: m.title,
        journal: m.journal || "—",
        year: m.year,
        grade: m.grade || "limited",
        abstract: (m.abstract_short || "").slice(0, 240),
        doi: m.doi,
      },
      reason: `Matches your follow on "${m.topic_label || m.topic_query}".`,
      idempotencyKey,
    });
    if (res.skipped) skipped++;
    else sent++;
  }

  await ctx.progress?.(`sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}
```

- [ ] **Step 3: Register + schedule**

In `jobs/_registry.js`:

```js
import { emailResearchAlertsHandler } from "./email-research-alerts.js";
```

Add to `registerHandlers`:

```js
  await register("email-research-alerts", emailResearchAlertsHandler);
```

Add to the schedule block:

```js
  // Daily 12:00 NY — research alerts for followed topics
  await boss.schedule("email-research-alerts", "0 12 * * *", {}, { tz: "America/New_York" });
```

- [ ] **Step 4: Syntax check**

Run: `node --check jobs/email-research-alerts.js && node --check jobs/_registry.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add jobs/email-research-alerts.js jobs/_registry.js
git commit -m "feat(email): daily research-alerts cron (emersus-worker, marketing)"
```

---

## Task 30: Resend template uploader (auth-verify, auth-reset)

**Files:**
- Create: `scripts/upload-resend-templates.mjs`

**Context:** Supabase Auth sends verify + reset emails directly via SMTP; we can't intercept them. We pre-render those two templates with `{{ .ConfirmationURL }}` / `{{ .Token }}` placeholders and upload to Resend. Supabase references them by ID.

Resend doesn't have a public "Templates API" endpoint per se — they have email-send endpoints that accept `template: { id, variables }`. Effective workaround: host the HTML in Supabase Auth's email template settings directly (the Supabase dashboard lets you paste raw HTML). The uploader script prints the rendered HTML to stdout for you to paste.

- [ ] **Step 1: Write the script**

Create `scripts/upload-resend-templates.mjs`:

```js
#!/usr/bin/env node
// scripts/upload-resend-templates.mjs
// Renders auth-verify + auth-reset with Supabase Auth template variable
// placeholders and prints the HTML to stdout. You then paste it into the
// Supabase dashboard at Authentication → Email Templates.
//
// Variables Supabase substitutes at send time:
//   {{ .ConfirmationURL }}   full confirm/reset URL
//   {{ .Token }}              6-digit OTP (if enabled; we don't use this)
//   {{ .Email }}              recipient email
//   {{ .SiteURL }}            configured site URL
//
// Usage: node scripts/upload-resend-templates.mjs verify|reset

import { renderAuthVerify } from "../api/lib/email/templates/auth-verify.js";
import { renderAuthReset  } from "../api/lib/email/templates/auth-reset.js";

const MODE = process.argv[2];
if (!MODE || !["verify", "reset"].includes(MODE)) {
  console.error("usage: node scripts/upload-resend-templates.mjs verify|reset");
  process.exit(1);
}

// Supabase will literally substitute its own placeholders in the string.
const SUPABASE_CONFIRM_URL = "{{ .ConfirmationURL }}";
const SUPABASE_EMAIL       = "{{ .Email }}";

let html;
if (MODE === "verify") {
  html = renderAuthVerify({
    user: { email: SUPABASE_EMAIL },
    confirmUrl: SUPABASE_CONFIRM_URL,
  });
} else {
  html = renderAuthReset({
    user: { email: SUPABASE_EMAIL },
    resetUrl: SUPABASE_CONFIRM_URL,
    expiresIn: "60 minutes",
  });
}

process.stdout.write(html);
```

- [ ] **Step 2: Run it and eyeball output**

Run: `node scripts/upload-resend-templates.mjs verify | head -30`
Expected: HTML output. Search for `{{ .ConfirmationURL }}` and `{{ .Email }}` — both should appear literally (un-escaped — verify via `grep -c '{{ \.ConfirmationURL }}'`).

Run: `node scripts/upload-resend-templates.mjs verify | grep -c "{{ .ConfirmationURL }}"`
Expected: 2 (CTA href + code-block fallback).

- [ ] **Step 3: Commit**

```bash
git add scripts/upload-resend-templates.mjs
git commit -m "feat(email): Supabase Auth template generator for verify + reset"
```

---

## Task 31: Legal-update broadcast script

**Files:**
- Create: `scripts/send-legal-update.mjs`

**Context:** Operator-triggered. Reads a JSON file describing the update, batches over all non-marketing-suppressed users at ~1 send/sec to stay under Resend rate limits.

- [ ] **Step 1: Write the script**

Create `scripts/send-legal-update.mjs`:

```js
#!/usr/bin/env node
// scripts/send-legal-update.mjs
// Broadcast a legal update (ToS or Privacy) to all confirmed users.
//
// Usage:
//   node scripts/send-legal-update.mjs --template tos-update \
//     --date 2026-05-15 \
//     --summary "..." \
//     --change "..." --change "..." \
//     [--dry-run] [--limit 100]
//
// The script sleeps 1s between sends so Resend's default rate limit (10 req/s)
// is not saturated even if the worker is doing other things.

import { supabaseAdmin } from "../api/lib/clients.js";
import { sendLegalTosUpdate, sendLegalPrivacyUpdate } from "../api/lib/email/senders.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}
const template = arg("template");
const date     = arg("date");
const summary  = arg("summary");
const changes  = args("change");
const dryRun   = process.argv.includes("--dry-run");
const limit    = Number(arg("limit", "0")) || null;

if (!template || !date || !summary || !changes.length) {
  console.error("usage: --template tos-update|privacy-update --date YYYY-MM-DD --summary ... --change ... [--change ...]");
  process.exit(1);
}
const sender = template === "tos-update" ? sendLegalTosUpdate
             : template === "privacy-update" ? sendLegalPrivacyUpdate
             : null;
if (!sender) {
  console.error(`unknown template ${template}`);
  process.exit(1);
}

const { data: users, error } = await supabaseAdmin
  .from("profiles")
  .select("user_id, email")
  .not("email", "is", null)
  .limit(limit || 100000);
if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`targeting ${users.length} users${dryRun ? " (DRY RUN)" : ""}`);
let sent = 0, failed = 0;
for (const u of users) {
  try {
    if (dryRun) {
      console.log(`[dry] ${u.email}`);
    } else {
      await sender({
        userId: u.user_id, to: u.email,
        summary, changes, effectiveAt: date,
      });
    }
    sent++;
    if (!dryRun) await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    failed++;
    console.error(`failed ${u.email}: ${err.message}`);
  }
}
console.log(`done: sent=${sent} failed=${failed}`);
```

- [ ] **Step 2: Dry-run smoke test**

Run: `node scripts/send-legal-update.mjs --template tos-update --date 2026-05-15 --summary "test" --change "a" --dry-run --limit 3`
Expected: `[dry] <email>` × ≤3 then `done: sent=3 failed=0`.

- [ ] **Step 3: Commit**

```bash
git add scripts/send-legal-update.mjs
git commit -m "feat(email): operator broadcast script for legal updates"
```

---

## Task 32: One-off test helpers — send-test-email + simulate-resend-webhook

**Files:**
- Create: `scripts/test/send-test-email.mjs`
- Create: `scripts/test/simulate-resend-webhook.mjs`

- [ ] **Step 1: Write send-test-email.mjs**

Create `scripts/test/send-test-email.mjs`:

```js
#!/usr/bin/env node
// scripts/test/send-test-email.mjs
// Renders a single template with fixture data and actually sends it via
// Resend. Used once per template during real-client QA.
//
// Usage: node scripts/test/send-test-email.mjs --template auth-welcome --to sid@example.com

import { FIXTURES } from "../email-fixtures.js";

import * as senders from "../../api/lib/email/senders.js";

const SENDER_MAP = {
  "auth-verify":            senders.sendAuthVerify,
  "auth-reset":             senders.sendAuthReset,
  "auth-welcome":           senders.sendAuthWelcome,
  "auth-password-changed":  senders.sendAuthPasswordChanged,
  "billing-receipt":        senders.sendBillingReceipt,
  "billing-renewal":        senders.sendBillingRenewal,
  "billing-payment-failed": senders.sendBillingPaymentFailed,
  "billing-cancellation":   senders.sendBillingCancellation,
  "legal-tos-update":       senders.sendLegalTosUpdate,
  "legal-privacy-update":   senders.sendLegalPrivacyUpdate,
  "data-export-ready":      senders.sendDataExportReady,
  "research-new-paper":     senders.sendResearchNewPaper,
};

function arg(n, fb) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : fb; }

const template = arg("template");
const to       = arg("to");
if (!template || !to || !SENDER_MAP[template]) {
  console.error(`usage: --template <${Object.keys(SENDER_MAP).join("|")}> --to <email>`);
  process.exit(1);
}

const fx = FIXTURES[template];
const sender = SENDER_MAP[template];
// Map fixture -> sender keyword args. The fixture shape is already close,
// but `user` is nested; unpack.
const { user, ...rest } = fx;
const res = await sender({ userId: "qa-test-user", to, ...rest });
console.log(JSON.stringify(res, null, 2));
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/test/send-test-email.mjs`
Expected: no output.

- [ ] **Step 3: Write simulate-resend-webhook.mjs**

Create `scripts/test/simulate-resend-webhook.mjs`:

```js
#!/usr/bin/env node
// scripts/test/simulate-resend-webhook.mjs
// Posts a Svix-signed webhook payload to the local dev server. Used to
// verify the webhook route + idempotency behavior without waiting for
// Resend to actually send + receive a real email.
//
// Usage: node scripts/test/simulate-resend-webhook.mjs \
//   --kind delivered|bounced|complained|clicked --resend-id re_001 [--base http://localhost:3000]

import { Webhook } from "svix";

function arg(n, fb) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : fb; }

const kind      = arg("kind", "delivered");
const resendId  = arg("resend-id", "re_" + Math.random().toString(36).slice(2, 10));
const base      = arg("base", "http://localhost:3000");
const secret    = process.env.RESEND_WEBHOOK_SECRET;
if (!secret) {
  console.error("RESEND_WEBHOOK_SECRET not set");
  process.exit(1);
}

const body = {
  type: `email.${kind}`,
  created_at: new Date().toISOString(),
  data: { email_id: resendId, to: "qa@example.com", subject: "QA" },
};
const payload = JSON.stringify(body);
const wh = new Webhook(secret);
const msgId = "msg_" + Math.random().toString(36).slice(2);
const signature = wh.sign(msgId, new Date(), payload);

const res = await fetch(`${base}/api/email/webhook/resend`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": signature,
  },
  body: payload,
});
console.log(res.status, await res.text());
```

- [ ] **Step 4: Syntax check**

Run: `node --check scripts/test/simulate-resend-webhook.mjs`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/test/send-test-email.mjs scripts/test/simulate-resend-webhook.mjs
git commit -m "feat(email): manual QA scripts (send-test-email, simulate-webhook)"
```

---

## Task 33: Apply the migration + update .env

**Context:** This is the only non-local step. Must be done on the Hetzner production DB (local dev points at prod per `CLAUDE.md`). Per memory `project_supabase_admin_role.md`, use `-U supabase_admin`. Apply via psql, not via pushing to main, since the webhook auto-deploy runs `npm install && npm run build && pm2 restart` — it does NOT apply SQL migrations.

- [ ] **Step 1: Apply the migration**

Run:
```bash
ssh hetzner 'cat > /tmp/email_tracking.sql' < supabase/migrations/20260424120000_email_tracking.sql
ssh hetzner 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < /tmp/email_tracking.sql && rm /tmp/email_tracking.sql'
```

Expected output ends with `CREATE POLICY` (last statement) and no errors.

**Alternative (per memory `feedback_migration_scp_conflict.md`):** avoid `scp`'ing a tracked file — use:
```bash
cat supabase/migrations/20260424120000_email_tracking.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1"
```

- [ ] **Step 2: Verify the tables exist**

Run:
```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "\dt email_*"'
```

Expected: table list includes `email_sends`, `email_events`, `email_unsubscribes`.

- [ ] **Step 3: Generate + set EMAIL_CLICK_SECRET + RESEND_WEBHOOK_SECRET**

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run twice (one per secret). Add to the Hetzner prod `.env` at `~/app/.env` (per memory `reference_hetzner_env_file.md`):

```bash
ssh hetzner
# edit ~/app/.env — add:
# EMAIL_CLICK_SECRET=<secret-1>
# RESEND_WEBHOOK_SECRET=<secret-2 will be replaced by Resend's actual value>
# RESEND_FROM_EMAIL="Emersus <noreply@emersus.ai>"
# RESEND_REPLY_TO_EMAIL="info@emersus.ai"
pm2 restart emersus-api --update-env
```

- [ ] **Step 4: Configure Resend webhook**

In the Resend dashboard (manual operator step):

- Create an endpoint pointed at `https://emersus.ai/api/email/webhook/resend`.
- Enable events: `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`.
- Copy the signing secret into `RESEND_WEBHOOK_SECRET` on the Hetzner box and `pm2 restart emersus-api --update-env` again.

- [ ] **Step 5: Restart worker**

Per memory `feedback_webhook_doesnt_restart_worker.md`: the webhook restarts `emersus-api` only. After pushing to `jobs/`, manually:
```bash
ssh hetzner 'pm2 restart emersus-worker --update-env'
```

Check logs:
```bash
ssh hetzner 'pm2 logs emersus-worker --lines 40 --nostream'
```

Expected: `registered email-renewal-reminder` and `registered email-research-alerts` lines appear.

- [ ] **Step 6: No git commit**

This task is pure operator configuration — nothing to commit.

---

## Task 34: Real-client QA

**Context:** Send each of the 12 templates to your own inbox and visually inspect in four clients. No automation.

- [ ] **Step 1: Send each template**

For each name in the SENDER_MAP, run:

```bash
node scripts/test/send-test-email.mjs --template <name> --to <your-test-inbox>
```

Expected: 12 emails arrive at your inbox.

- [ ] **Step 2: Open each in 4 clients**

For each email, open in:
1. Gmail web (dark mode)
2. Apple Mail macOS (dark mode)
3. iOS Mail (iPhone)
4. Outlook desktop on Windows

Verify visually:
- Brand mark renders (`em∴rsus`, jade dot for `∴`).
- Eyebrow + title styled correctly.
- CTA button is a jade rectangle with white-on-near-black text.
- Footer small-caps reads.
- Outlook: no stripped background, no broken table.

- [ ] **Step 3: Configure Supabase Auth email templates**

In the self-hosted Supabase dashboard:
- Go to Authentication → Email Templates → Confirm signup.
- Replace the HTML with the output of `node scripts/upload-resend-templates.mjs verify`.
- Go to Authentication → Email Templates → Reset password.
- Replace the HTML with the output of `node scripts/upload-resend-templates.mjs reset`.

Test: sign up a test account → receive the branded verify email. Click → redirects to `/auth/callback` → logged in. Reset password via the /auth/forgot-password flow → receive the branded reset email.

- [ ] **Step 4: Verify webhook pipe with real traffic**

After the verify + reset test:
```bash
ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "select count(*), kind from email_events group by kind order by count(*) desc limit 10;"'
```

Expected: `delivered` count > 0 within ~1 minute of the test sends.

- [ ] **Step 5: No code commit**

This task produces screenshots only (optionally; not committed). Record any regressions as new GH issues.

---

## Self-Review Checklist

Before handing off, verify:

- [ ] **Spec coverage.** Every section of `docs/superpowers/specs/2026-04-24-email-templates-design.md` has at least one task. Covered:
  - File layout → Tasks 3–7, 20, 22–24
  - Design system (tokens, shell, components) → Tasks 3, 4, 5
  - Template inventory (all 12) → Tasks 8–19
  - Tracking infra (3 tables + 3 routes + senders) → Tasks 1, 6, 21, 22, 23, 24
  - Data flow wiring → Tasks 25, 26, 27
  - Supabase Auth exception → Task 30, 34
  - Testing & preview → Tasks 4–9, 20, 32
  - Rollout → Task 33
  - Rollback → (no task; inherently covered by additive migration + flagged import swaps)

- [ ] **Placeholder scan.** No "TBD" / "TODO" / "fill in details" / "add appropriate error handling" strings in any step.

- [ ] **Type consistency.** Template render-fn names (`renderAuthVerify`, etc.) match senders (`sendAuthVerify`). Fixture keys (`"auth-verify"`) match template file names. Table names match across migration, senders, routes.

- [ ] **Memory-driven constraints honored:**
  - No `userRateLimit()` on any email route (per `feedback_userratelimit_is_chat_only.md`). ✓
  - Webhook idempotency uses `webhook-id` header via Svix (per `feedback_polar_webhook_id_header.md`). ✓
  - Only `info@emersus.ai` referenced as contact; no invented aliases (per `reference_contact_email.md`). ✓
  - Migration applied via `ssh hetzner + docker exec + cat | psql` — no scp of tracked SQL (per `feedback_migration_scp_conflict.md`). ✓
  - `emersus-worker` manually restarted after `jobs/` changes (per `feedback_webhook_doesnt_restart_worker.md`). ✓
  - `.md` files never `git add`ed in any task (per `feedback_local_md_docs.md`). ✓

---

## Open items for the executor

- **Password-changed detection.** Spec Open Question #5 — Supabase Auth Hooks may not be available on self-hosted. The `sendAuthPasswordChanged` sender is built but not yet triggered by any caller. Defer the callsite to a follow-up after confirming Auth Hooks support, OR add a nightly shadow-table diff job. This plan does NOT include that wiring; it's a known gap.

- **User profile email column.** The `profiles` query in Task 28/29 assumes `profiles.email` exists. Verify before running:
  ```bash
  ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "\d profiles"'
  ```
  If `email` is absent, join `auth.users` instead:
  ```sql
  select u.id as user_id, u.email from auth.users u where u.email_confirmed_at is not null;
  ```

- **`user_subscriptions` schema.** The renewal job assumes columns `user_id`, `polar_subscription_id`, `status`, `current_period_end`, `product_id`. Check the live schema before pushing Task 28 to prod:
  ```bash
  ssh hetzner 'docker exec supabase-db psql -U supabase_admin -d postgres -c "\d user_subscriptions"'
  ```

- **`research_alerts_since` RPC.** Task 29 assumes this RPC exists or creates a graceful no-op. If follow-infrastructure is not yet built, this cron will log-and-skip — that's the intended failsafe. Wire the RPC up before depending on live alerts.

---

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-email-templates.md`.

Two execution options:

**1. Subagent-Driven (recommended).** I dispatch a fresh subagent per task with full task context; review between tasks; fast iteration.

**2. Inline Execution.** I execute tasks in this session via executing-plans; batch execution with review checkpoints.

Which approach?
