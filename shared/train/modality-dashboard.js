// shared/train/modality-dashboard.js
//
// "User has past sessions but no ACTIVE session" surface on /app/train/.
// Replaces ModalityEmptyState once the user has ≥1 finished session for
// the current modality.
//
// Bands:
//   1. Compact hero CTA — "Start next [modality]" (no big onboarding copy).
//   2. Last session card — title, date, duration, one-line summary.
//   3. Recent sessions list — up to 4 rows below the last-session card.
//   4. Research band (reused from modality-empty-state.js).
//
// Data comes from the same /api/workout-sessions?modality=X&limit=10 call
// that train.js already makes to find an active session — we just store
// the whole list instead of discarding everything except the live one.

import React from "react";
import {
  ResearchBand,
  MODALITY_CONTENT,
} from "/shared/train/modality-empty-state.js";

const h = React.createElement;

function minutesBetween(a, b) {
  if (!a || !b) return 0;
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function formatDuration(mins) {
  if (!mins) return null;
  if (mins < 60) return `${mins} min`;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

function formatRelativeDate(iso) {
  if (!iso) return "";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatAbsoluteDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm} ${ampm}`;
}

function sessionSummaryLine(session, modality) {
  const mins = minutesBetween(session.started_at, session.ended_at);
  const durStr = formatDuration(mins);
  const parts = [];
  if (durStr) parts.push(durStr);
  const exercises = Array.isArray(session.exercises) ? session.exercises : [];
  if (modality === "lift" && exercises.length) {
    parts.push(`${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`);
  }
  if (!session.ended_at) parts.push("in progress");
  return parts.join(" · ");
}

function LastSessionCard({ modality, session, onView, onStart }) {
  const content = MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift;
  const title = session.title || `Untitled ${modality} session`;
  const summary = sessionSummaryLine(session, modality);
  const relative = formatRelativeDate(session.started_at);
  const absolute = formatAbsoluteDate(session.started_at);

  return h("section", { className: "tr-mod-last" },
    h("div", { className: "tr-mod-last-head" },
      h("div", { className: "tr-mod-last-head-left" },
        h("span", { className: "tr-mod-last-label" }, content.lastSessionLabel),
        h("span", { className: "tr-mod-last-dot" }, "·"),
        h("span", { className: "tr-mod-last-date", title: absolute }, relative),
      ),
      onStart
        ? h("button", {
            type: "button",
            className: "tr-mod-hero-cta tr-mod-last-start",
            onClick: onStart,
          },
            content.nextCtaLabel,
            h("span", { className: "tr-mod-hero-cta-arrow", "aria-hidden": true }, "→"),
          )
        : null,
    ),
    h("div", { className: "tr-mod-last-body" },
      h("div", { className: "tr-mod-last-title" }, title),
      summary ? h("div", { className: "tr-mod-last-summary" }, summary) : null,
    ),
    h("button", {
      type: "button",
      className: "tr-mod-last-view",
      onClick: () => onView && onView(session.id),
    },
      "View session",
      h("span", { className: "tr-mod-last-view-arrow", "aria-hidden": true }, " →"),
    ),
  );
}

function RecentSessionsList({ modality, sessions, onView }) {
  if (!sessions.length) return null;
  return h("section", { className: "tr-mod-recent" },
    h("div", { className: "tr-mod-recent-head" },
      h("span", { className: "tr-mod-recent-label" }, "Recent sessions"),
      h("span", { className: "tr-mod-recent-count" }, `${sessions.length}`),
    ),
    h("ul", { className: "tr-mod-recent-list" },
      sessions.map((s) => {
        const title = s.title || `Untitled ${modality} session`;
        const summary = sessionSummaryLine(s, modality);
        const rel = formatRelativeDate(s.started_at);
        return h("li", { key: s.id, className: "tr-mod-recent-row" },
          h("button", {
            type: "button",
            className: "tr-mod-recent-btn",
            onClick: () => onView && onView(s.id),
          },
            h("div", { className: "tr-mod-recent-left" },
              h("div", { className: "tr-mod-recent-title" }, title),
              h("div", { className: "tr-mod-recent-meta" }, [rel, summary].filter(Boolean).join(" · ")),
            ),
            h("span", { className: "tr-mod-recent-chev", "aria-hidden": true }, "›"),
          ),
        );
      }),
    ),
  );
}

export function ModalityDashboard({ modality, onStart, onViewSession, pastSessions }) {
  const list = Array.isArray(pastSessions) ? pastSessions : [];
  const last = list[0];
  const rest = list.slice(1, 5);

  return h("div", { className: "tr-mod-empty tr-mod-dashboard" },
    // The "Start next lift" CTA is now rendered INSIDE LastSessionCard's
    // header row (top-right) so it sits next to the date context rather
    // than floating alone in a 620px column above it. If there's no
    // last-session to attach to, render a standalone CTA at the top.
    last
      ? h(LastSessionCard, { modality, session: last, onView: onViewSession, onStart })
      : h("section", { className: "tr-mod-standalone-cta" },
          h("button", { type: "button", className: "tr-mod-hero-cta", onClick: onStart },
            (MODALITY_CONTENT[modality] || MODALITY_CONTENT.lift).nextCtaLabel,
            h("span", { className: "tr-mod-hero-cta-arrow", "aria-hidden": true }, "→"),
          )),
    rest.length ? h(RecentSessionsList, { modality, sessions: rest, onView: onViewSession }) : null,
    h(ResearchBand, { modality }),
  );
}
