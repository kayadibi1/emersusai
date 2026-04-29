# Social + Retention Stack — Parked 2026-04-22

Parked mid-brainstorm. Two separate tracks, both deferred, both with a clear
jump-off point when we come back.

---

## Track 1 — Social feed (deferred indefinitely)

### Decisions locked during brainstorm

1. **Social object:** training-only (workouts, cardio, climbs)
2. **Graph model:** asymmetric follow (Strava-style), with a Discover tab fed
   algorithmically so new users aren't staring at an empty Following tab
3. **Privacy default:** public, with per-post and global toggles; one-time
   first-share visibility modal
4. **Cold-start:** no curated seed users — Discover carries the load until
   Following becomes useful
5. **Content source:** auto-post on session complete (Strava default;
   opt-out per-session + global setting)
6. **Post content:** stat + caption + photo (full Strava). Pulls in S3/R2
   storage, thumbnails, EXIF stripping, image moderation, CDN
7. **Engagement:** kudos-only, no comments (keeps moderation scope tight)
8. **Profile:** stats-rich (Strava-like) — totals, current streak, current
   program, top lifts / fastest climbs / longest runs
9. **PR badges:** yes, in v1 of social whenever we pick it back up
10. **Navigation placement:** open — last question was top-level tab vs
    dashboard embed vs overlay

### Why parked

- Cold-start is worse than Discover-as-safety-net solves for a small DAU
  base; empty feed on launch day is worse than no feature
- Realistic scope is 2–3 months (photos + PR engine + Discover algo +
  profile stats + nav restructure + report/block + abuse response) with
  ongoing moderation debt
- Audience leans researchy/introvert — unvalidated that they want to
  broadcast workouts
- Cheaper retention levers haven't been tried yet (Track 2)

### Resume condition

Come back to this once we have:
- ≥3 months of share-card analytics showing meaningful share rate
- DAU large enough that a Discover feed would look populated (rough target:
  hundreds of daily workout completions)
- Explicit user requests for friend/follow features

---

## Track 2 — Retention Phase 0 (deferred — next candidate to pick up)

### Current state of share workout feature

Already in place and good:
- `shared/share-card.js` — Canvas renderer, 1080×1350 (IG Story), 6 variants
  (gym / cardio+map / cardio time-only / swim / climb / hybrid)
- `shared/share-modal.js` — React modal, Web Share API / Download / Copy
- Triggered from `app/workout/session/session.js:49-50, 638-649` and
  equivalents in cardio/climb/swim
- PR detection already runs and shows a "PR" stamp on top-exercise rows
  (`shared/share-card.js:262`)
- Watermark: `emersus.ai` in the corner

Gaps:
1. **No analytics on share events** — `share-modal.js` has no PostHog
   import. Blind to share-open / share-complete / drop-off
2. **No acquisition hook on the card** — watermark but no CTA / QR /
   short-link. Shares don't drive signups
3. **Streak not on the share card** — `shared/widget-v2/templates/progress/
   streak-counter-card.js` exists as a widget but isn't persistent surface
   and isn't printed on cards
4. **Streak isn't a core mechanic** — only a widget, no at-risk detection,
   no push/email when about to break
5. **No weekly digest email**
6. **No PR digest** (per-session PR detection exists; weekly rollup does not)

### Proposed Phase 0 (when we pick this up)

Rank-ordered cheapest-first:

| # | Feature | Effort | Why |
|---|---|---|---|
| 1 | Instrument share events (PostHog: open / rendered / completed / cancelled, per variant) | ~0.5 day | Measures the social hypothesis before we build it |
| 2 | CTA + short-link / QR on share card | ~1 day | Every share becomes an acquisition funnel |
| 3 | Promote streak from widget → core mechanic (persistent surface, day-N badge, at-risk detection) | ~3 days | Classic behavior-change primitive |
| 4 | Streak badge on share card | ~0.5 day | Amplifies #3 |
| 5 | At-risk streak push / email | ~2 days | Standard retention hook |
| 6 | Weekly digest email (week summary + PRs + next session prompt) | ~3-4 days | Highest-impact lever for chat+workout |

Total: ~2 weeks sequentially; each piece independently valuable.

### Entry point when we resume

Start with **#1 + #2** as a single tight PR — it's half a week of work and
gives us the data we need to prioritize the rest (if share completion rate
is <5%, deprioritize everything else and rethink).
