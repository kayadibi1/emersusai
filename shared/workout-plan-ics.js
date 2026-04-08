// Vanilla ICS (iCalendar, RFC 5545) generator for workout plans.
//
// Phase 1: the only calendar export path. Works for Google Calendar, Apple
// Calendar, Outlook, Fastmail, Proton Calendar, Thunderbird, and anything
// else that imports .ics files. No OAuth, no external API, no secrets, no
// backend hop — entirely client-side so every user with a plan has a
// working calendar export on day one.
//
// Why no library (ical-generator): it's Node-flavored and would require
// pulling in Buffer/stream polyfills to run in a browser. Writing our own
// ~100 lines is cleaner than fighting the ecosystem, and the RFC 5545
// subset we actually need is small:
//   - VCALENDAR wrapper with PRODID, VERSION, CALSCALE
//   - VTIMEZONE block for the plan's IANA timezone
//   - One VEVENT per session with DTSTART/DTEND using TZID, SUMMARY,
//     DESCRIPTION, UID, DTSTAMP
// No RRULE (sessions are all unique — see one-way street #4).
// No VTIMEZONE VTZ definitions for arbitrary zones either: calendar apps
// recognize TZID by name and resolve it against their own timezone
// database. Every modern calendar (Google, Apple, Outlook) does this.

import { summarizeBlocks, DAY_LABELS } from "./workout-plan-schema.js";

// Escape per RFC 5545 3.3.11: commas, semicolons, backslashes, and newlines.
function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long lines at 75 octets per RFC 5545 3.1. Real calendar apps are
// lenient about this but we fold anyway so exports survive strict
// validators (e.g. Fastmail).
function foldLine(line) {
  const maxLen = 75;
  if (line.length <= maxLen) return line;
  const chunks = [];
  let i = 0;
  while (i < line.length) {
    if (i === 0) {
      chunks.push(line.slice(0, maxLen));
      i = maxLen;
    } else {
      chunks.push(" " + line.slice(i, i + maxLen - 1));
      i += maxLen - 1;
    }
  }
  return chunks.join("\r\n");
}

// YYYYMMDDTHHMMSS (local time, no Z) — used with TZID parameter.
function formatLocalDateTime(date, time) {
  const isoDate = String(date || "").replace(/-/g, "");
  const hhmm = String(time || "00:00").replace(/:/g, "") + "00";
  return `${isoDate}T${hhmm}`;
}

// YYYYMMDDTHHMMSSZ — UTC format for DTSTAMP (the timestamp of when the
// calendar file was authored, not the event itself).
function formatUtcDateTime(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "19700101T000000Z";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// Add N minutes to an HH:MM time, returning HH:MM (wraps the day, we accept
// that — workout sessions are never 24h long so this is safe). Used to
// compute DTEND from DTSTART + duration_minutes.
function addMinutesToTime(time, minutes) {
  const [h, m] = String(time || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  const total = h * 60 + m + Number(minutes || 60);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Stable UID for each event. Re-importing the same plan into the same
// calendar updates the existing events instead of duplicating (per RFC
// 5545 3.8.4.7 — same UID = same event). This is one of the quiet but
// critical wins of ICS — it means "Download .ics" → "import again after
// editing" actually works as an update path even without a real API.
function buildUid(planId, sessionId) {
  const safePlan = String(planId || "local").replace(/[^a-zA-Z0-9-]/g, "");
  const safeSession = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safePlan}.${safeSession}@emersus.ai`;
}

// Build the human-readable DESCRIPTION body for a session. Contains the
// exercises + sets/reps/load/RPE and, if present, a small phase label,
// warmup ramp, and completion status note. Stays short so Apple Calendar's
// preview pane doesn't truncate it ungracefully.
function buildEventDescription(session) {
  const lines = [];
  if (session.phase) lines.push(`Phase: ${session.phase}`);
  if (session.summary) lines.push(session.summary);

  // Phase 1.5: surface warmups when present, under their own header so
  // calendar consumers can visually separate them from working sets.
  if (Array.isArray(session.warmup_blocks) && session.warmup_blocks.length > 0) {
    const warmupSummary = summarizeBlocks(session.warmup_blocks);
    if (warmupSummary) {
      lines.push("");
      lines.push("Warm-up:");
      lines.push(warmupSummary);
    }
  }

  const blockSummary = summarizeBlocks(session.blocks);
  if (blockSummary) {
    lines.push("");
    lines.push(Array.isArray(session.warmup_blocks) && session.warmup_blocks.length > 0 ? "Working sets:" : "");
    lines.push(blockSummary);
  }
  if (session.completion_status === "missed") {
    lines.push("");
    lines.push("(Marked missed.)");
  } else if (session.completion_status === "skipped") {
    lines.push("");
    lines.push("(Marked skipped.)");
  } else if (session.completion_status === "completed") {
    lines.push("");
    lines.push("(Completed.)");
  }
  lines.push("");
  lines.push("Generated by Emersus AI.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Serialize the full plan as an RFC 5545 .ics document. The returned
// string uses CRLF line endings (\r\n) per the spec — some validators
// reject LF-only files. Consumers can wrap it in a Blob.
export function planToIcs(plan, { planRowId = null } = {}) {
  if (!plan || typeof plan !== "object") {
    throw new Error("planToIcs requires a plan object");
  }
  const planId = planRowId || plan.id || "local-plan";
  const timezone = String(plan.timezone || "UTC");
  const now = new Date().toISOString();
  const dtstamp = formatUtcDateTime(now);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Emersus AI//Workout Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(plan.title || "Emersus workout plan")}`,
    `X-WR-TIMEZONE:${escapeIcsText(timezone)}`,
  ];

  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  for (const session of sessions) {
    if (!session || !session.date) continue;
    const startTime = session.start_time || "17:00";
    const duration = Number(session.duration_minutes) || 60;
    const endTime = addMinutesToTime(startTime, duration);
    const dtStart = formatLocalDateTime(session.date, startTime);
    const dtEnd = formatLocalDateTime(session.date, endTime);
    const dayLabel = DAY_LABELS[session.day_of_week] || "";
    const summaryParts = [
      `W${session.week || ""} ${dayLabel}`.trim(),
      session.title || "Workout",
    ].filter(Boolean);
    const summary = summaryParts.join(" · ");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${buildUid(planId, session.id)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${timezone}:${dtStart}`);
    lines.push(`DTEND;TZID=${timezone}:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(buildEventDescription(session))}`);
    if (session.completion_status === "missed" || session.completion_status === "skipped") {
      lines.push("STATUS:CANCELLED");
    } else {
      lines.push("STATUS:CONFIRMED");
    }
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// Browser helper: build the ICS, wrap it in a Blob, and trigger a
// download via an anchor tag. This is the pattern the chat card and the
// /app/workout page both use. Filename falls back to a slugged plan title.
export function downloadPlanIcs(plan, { planRowId = null, filename = null } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("downloadPlanIcs can only run in a browser");
  }
  const ics = planToIcs(plan, { planRowId });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const slug =
    filename ||
    `${String(plan.title || "workout-plan")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workout-plan"}.ics`;
  const a = document.createElement("a");
  a.href = url;
  a.download = slug;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Let the browser finish the download before revoking the object URL.
  // Safari drops the download if we revoke synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
