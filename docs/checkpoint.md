# Checkpoint
Status: none
Updated: 2026-04-17 (v2)

No active checkpoint. Widget-v2 spec-complete end-to-end (Plans 1 through 10f): all 55 templates across 6 family tools, strict:true superset-data throughout, 0% prod validator drop. Prod telemetry shows 0% validator drop across all 6 families; emission-recall benchmark at 90% on natural-language prompts. Legacy `emit_widget` remains the fallback per the Plan 9 rollout runbook (`docs/widget-v2-rollout.md`, local-only). `feat/landing-ask-bar` merged alongside, shipping the anonymous `/api/emersus/anon-ask` streaming endpoint + landing-page takeover experience.

## Post-UI-redesign checklist

### A. Verification gaps — use the site and confirm it works

1. ✅ **Chat streams answers with the new chrome** — confirmed 2026-04-15 by sidarvig@gmail.com / Maya Bennett demo; evidence retrieval succeeded (no new error-log entries).
2. ✅ **Real Google OAuth sign-in on `/auth/`** — confirmed 2026-04-15. Fixed stale legacy-styled `/auth/callback/` page in commit `70981eef`.
3. ✅ **Log a real workout session through `/app/train/` end-to-end** — confirmed 2026-04-15 (logged set appears on `/app/progress/`). Two UX fixes landed during verification: added a consistent left sidebar on non-chat v2 pages (commit `b2470300`) and labeled the RPE chip group (commit `1aecde61`).
4. ✅ **Water quick-log + supplement quick-log on `/app/nutrition/`** — confirmed 2026-04-15 (water persists, supplement form now inline). Meal quick-log is deferred (Phase 4 — currently routes to chat).
5. ✅ **Edit tabs on `/app/profile/` persist** — confirmed 2026-04-15 by sidarvig@gmail.com. Uncovered + fixed: `index.html`/`index-v2.html` split caused a flash-then-404 after the consolidation commit (legacy redirect cached by browser). Added universal `no-cache` meta on all `/app/*` + `/auth/*` HTMLs (commits `21b90a76`, `5cd38065`).

### B. Operator / infra follow-ups — mostly SSH work

1. ✅ **pm2 `webhook` process fixed 2026-04-15** — rewrote `~/webhook.js` on Hetzner to include the missing `npm run build` step (the actual root cause of today's four-round "looks the same" loop), added per-request timestamped logging so future GitHub deliveries are visible in `~/.pm2/logs/webhook-out.log`, and guarded against the `timingSafeEqual` length-mismatch throw. Whether GitHub is currently delivering to `/webhook/deploy` is still unknown (no deliveries landed in the log yet); next push to main will reveal.
2. ✅ **RLS footgun resolved 2026-04-15** — added permissive `FOR SELECT TO authenticated, anon USING (true)` policies on `evidence_chunks` + `research_articles`. Documented in `supabase/20260415_corpus_rls_and_timeouts.sql`. Writes remain blocked (no write policies).
3. ✅ **HNSW cold-cache cushion added 2026-04-15** — `authenticator` + `authenticated` role `statement_timeout` bumped 8s → 15s, `supabase-rest` container restarted to pick up the new session default.
4. ✅ **Legacy escape hatch removed 2026-04-15** — with chat_v2 default-true permanently, the off-flag else-branch in `app/index.html` + `shared/chat.css` were deleted outright (commit `15b09f58`). 6465 lines of dead code gone; if a user explicitly sets `chat_v2=false` they get unstyled chat, which is their problem for the explicit opt-out.
5. ✅ **Cache-Control: no-cache meta tags on legacy redirect pages** — applied to 20 HTML entries that contain `window.location.replace(...)` (via `scripts/inject-no-cache-legacy.js`).
6. ✅ **OpenAI API key rotation** — completed by operator on 2026-04-13 (no changelog entry was written at the time, which is why it kept appearing "open" in later checkpoints). Runbook kept in memory at `reference_openai_key_rotation.md` for the next rotation.
7. 🟡 **CORE API backfill — partial** — Step 4 attempted 2026-04-15 and aborted after 2 min. CORE's ES is back for simple queries but still `es_rejected_execution_exception`-saturated on the complex boolean queries real ingestion uses. +1,418 rows landed (2,057 → 3,475) from the 48 topics that made it through before abort. CORE re-added to `INGEST_DISABLED_SOURCES`. Retry Step 4 once the complex-query probe (documented in `project_core_recovery_pending.md`) returns 200 consistently — possibly days/weeks away.
8. ✅ **`mint-invite-token --email` flag added** — `scripts/mint-invite-token.js` now accepts `--email` and, if set, sends the invite link via Resend (branded HTML + plaintext fallback). Uses existing `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env.
9. ✅ **Seed `public.benchmarks`** — 42 rows applied to prod 2026-04-15 (7 metrics × 3 experience × 2 sex). Sourced from NSCA Essentials 4e, ACSM Guidelines 11e, Daniels' Running Formula 3e. Migration at `supabase/20260415_benchmarks_seed.sql`. Commit `07f8b8ad`. Coaching/textbook ranges, not RCT averages — operator can refine per-row anytime.

### C. Feature polish — v2 features called out as deferred in commit messages

1. ❌ **Phase 3 — "Ask Emersus" right-side drawer** — REJECTED (AI chat is a full-page experience, not a sidebar).
2. ✅ **Phase 3 — History tab inline-expand** on `/app/train/` — shipped 2026-04-15.
3. ⬜ **Phase 3 — Exercise demo videos** (TODO since 2026-04-10) — short animations per exercise in the workout session view.
4. ✅ **Phase 4 — Real meal-edit modal** — shipped 2026-04-15. Inline CRUD modal with food search, auto-save, delete, meal slot reassignment.
5. ✅ **Phase 5 — Progress charts** on `/app/progress/` — shipped 2026-04-16. Momentum Cards (e1RM trajectory), Beeswarm Plot (every set), Zone River (HR pattern), Control Chart (ACWR with Gabbett thresholds).
6. ⬜ **Phase 8 — Real testimonial cards** on landing page (need customer consent).
7. ✅ **Phase 9 — Migrate `~~~profile-update` fences → OpenAI function-calling** — shipped 2026-04-15. Onboarding now uses `update_user_profile` tool call via previous_response_id multi-turn.

### D. Follow-ups from other specs

1. ⬜ **Conversational onboarding mockup** — build a variant of `chat.html` as pure text dialog (no quiz widgets); structured answer UI was rejected 2026-04-15.
