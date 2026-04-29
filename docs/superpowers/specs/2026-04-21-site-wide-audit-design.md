---
name: Site-wide code audit + fix (2026-04-21)
status: in-progress
owner: autonomous
scope: landing, auth, app shell, nutrition, train/workout, progress/profile, widgets, backend, chat UI (presentation only)
out-of-scope: chat workflow / pipeline bugs (flagged separately for user review)
---

# Site-wide audit — consolidated spec

Nine parallel audit agents inspected the site end to end. This doc is the merged punch-list + resolution for every finding, grouped by severity.

Chat workflow bugs are NOT fixed this pass — see `docs/chat-workflow-bugs-flagged.md`.

## P0 — fix first

| # | Finding | Source | Action |
|---|---------|--------|--------|
| 0-1 | Nutrition TZ offset sign likely inverted (`getTimezoneOffset()` returned negative but sent as positive). US users may see date drift | nutrition.js:115,781 | Use `shared/date-utils.js localDateStr()` instead of raw offset; align with server contract |
| 0-2 | Profile password/email change buttons are `alert()` stubs | profile.js:543–545 | Wire real flows OR hide buttons behind feature flag until ready |
| 0-3 | Volume math silently zero-floors corrupted `load_kg` strings | train.js:453 | Explicit `Number.isFinite` guard + warn to Sentry on NaN |

## P1 — a11y, correctness, UX blockers

### Global / shell
- **No `:focus-visible` universal rule** (landing, auth, shell). Add in `shared/design-tokens.css`.
- **Not all animations guarded by `prefers-reduced-motion`**. Audit landing.css, chat.css, chrome.css; add global `@media (prefers-reduced-motion: reduce)` to neutralise non-critical motion.
- **Missing skip-to-main link** on app shell.
- **FOUC on initial paint for dark palettes** (theme.js rejects system preference; no preload hint).
- **Theme doesn't sync across tabs** (profile.js reads `data-theme`, ignores storage events).
- **Mobile has no sidebar drawer** (chrome.css:242 hides `.sidebar` but no hamburger). User loses nav on phones.

### Landing
- Missing `:focus-visible` on `.btn`, `.nav-links a`, theme swatches.
- Hardcoded hex colours (`#34d399`, `#f59e0b`, `#e8a838`) bypass design tokens.
- `countTo()` regex `/[^\d-]/g` keeps hyphen → breaks on dashes inside labels.
- DOM leak: three rotator `measurer` spans are appended to `body` and never removed.
- `grid-template-columns: none` (line 1094) is a no-op.
- `requestAnimationFrame(requestAnimationFrame(...))` anti-pattern × 3.
- FAQ handler thrashes layout (scrollHeight read → write → offsetHeight read → write).

### Auth
- **Reset-password form is a stub** — `bindResetPasswordForm()` binds to markup that doesn't exist.
- No `aria-live` on `.auth-status`; `aria-invalid` never set on bad inputs; focus not moved to error.
- OAuth error message from URL rendered as plain text (phishing vector if URL reaches user).
- `configPromise` caches rejection → `/api/config` stays broken until page reload.
- `wireForgot()` duplicates `bindForgotPasswordForm()` (double-bind guard exists but dead code).
- Callback page shows no spinner during 2-5 s OAuth exchange.
- "Remember for 30 days" checkbox is read-only cosmetic.
- No back-off on repeated OAuth click → rate-limit risk.

### Nutrition
- Water + supplement `logWater()`/`submitSupp()` don't await fetch → reload runs before request commits.
- `guessMealSlot()` uses browser local TZ; API sends TZ in minutes — disagreement on TZ reference.
- Modal has no `role="dialog"`, no focus trap, no focus return to trigger.
- Food search input, supplement name input, meal slot select — all rely on placeholder only, no label/aria-label.
- `MacroRing` lacks `aria-label` (actual / target).
- Delete confirm bar contrast fails WCAG (rgba(239,68,68,0.08) bg + `#ef4444` text).

### Train / workout
- Rest timer announces via `role="status"` but no `aria-live` for value updates.
- Climbing grade grid cuts off V18+/YDS 5.15a–d/Font 8B+–9A/French 9a+–9b (only first 18 shown).
- Cardio wake-lock is fire-and-forget; screen may dim mid-run with no indicator.
- GPS permission-denied branch relies on numeric `code===1` without explicit type guard.
- Session `flushSave` reads `planRef.current` in a closure — stale ID if user fast-edits and navigates.
- Share-card computation reads `planRef.current?.plan || plan` — timing-dependent on network.

### Progress / profile
- Control chart Y-axis hardcoded `0.5 → 2.0` regardless of actual data variance.
- Weekly-activity SVG uses raw rgba instead of tokens.
- Numeric fields on profile have no client-side min/max guard before PATCH.
- Profile deletion button is an `alert()` stub — safety-critical.
- Theme picker reads DOM attr only → won't sync when another tab flips theme.
- All SVG charts lack text alternatives / tabular fallback (screen reader blind spot).
- `var(--success, #15803d)` fallback pattern inconsistent across tokens.
- `--dim` ≈ 2.5:1 contrast on `--bg` → fails WCAG AA for non-label copy.

### Chat UI (presentation only; workflow flagged)
- Textarea has no auto-grow (fixed height → internal scroll only).
- Scroll-to-bottom uses `behavior: "smooth"` and fights user scroll when streaming.
- Submit button `:disabled` styling relies on browser default.
- Context menu for share/delete has no viewport bounds checking.
- Thread heading silently ellipsises with no `title` tooltip.
- Onboarding banner `color: var(--muted)` on `--accent-soft` fails WCAG AA on paper theme.
- Textarea placeholder fades to transparent on focus → no cursor anchor on empty input.
- `.msg-action-more` overflow button lacks `aria-expanded`/`aria-controls`.

### Widgets / utilities
- **postMessage** origin check accepts opaque `"null"` broadly — narrow and document.
- Widget HTML in fenced block is rendered inside sandboxed iframe but unsanitized. Iframe sandbox is mitigating; document rather than layer DOMPurify (would break legitimate widgets).
- `ShareModal.doCopy()` mutates button text via DOM `textContent` lookup; use state.
- `ShareModal` createObjectURL leaks on error path before `setPreviewUrl`.
- Dead `widget-v2` branch in `parseLLMOutput` consumer (unreachable).
- Legacy colour remap regex risks substrings inside `var(..., #hex)` fallbacks.

### Backend (non-chat)
- `/api/send-test-email` hardcodes the operator's personal recipient address — delete or require admin + body param.
- Error response shape split between `{error}` and `{message}` — standardise on `{error, message?}`.
- `contact.js:114` missing `await` on `sendResendEmail()` → unhandled rejection.
- `parseAdminEmails()` re-splits env per request — cache at module init.
- Boot-time validation missing for `POLAR_PRODUCT_ID_*`, `SITE_URL` — throw early on startup.
- Several 5xx handlers echo raw `error.message` (schema/column names leak).
- `rate-limit.js` in-memory map has no LRU cap (unbounded growth under attack).

## P2 / P3 — cleanup, polish

Addressed opportunistically by section agents; list in plan doc. Highlights: dead code (`progress-ghost-samples.js`, `trophy` exercise icon, `brand-dots` selectors on app pages), magic numbers in landing rotators, duplicate boot logic across auth HTML files, button shadow scale inconsistency, design token fallback consistency.

## Chat workflow findings — FLAGGED for user review (not fixed)

See `docs/chat-workflow-bugs-flagged.md` for the full list. Summary:
1. SSE abort race may produce duplicate/post-cancel messages.
2. Tool-result rendering may lose metadata on SSE early-close.
3. Placeholder message doesn't merge blocks added during streaming.
4. 429 rate-limit block never auto-clears at reset_at without page reload.
5. Thread hydration trusts malformed rows.
6. Follow-up prompt built from source metadata — potential prompt injection via citation fields.
7. Model-change dropdown doesn't validate against allowed models.
8. Aborted message synthesisMode shows stale synthesis stats.
9. Widget-v2 dispatcher silently renders on unknown family.
10. `recommendation.js` may leak unhandled promise rejection from stream handler.
