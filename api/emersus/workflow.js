import { createHash } from "node:crypto";
import { retrieveDatabaseEvidence as retrieveVectorDatabaseEvidence } from "./retrieveDatabaseEvidence.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini";
const SYNTHESIS_FALLBACK_MODEL =
  process.env.OPENAI_EMERSUS_FALLBACK_MODEL || "gpt-4.1-mini";
const MAX_QUESTION_LENGTH = 3000;
const MAX_PROFILE_FIELD_LENGTH = 300;
const VECTOR_LIMIT = 6;
const VECTOR_MATCH_THRESHOLD = 0.4;
const VECTOR_MATCH_COUNT = 10;
const INLINE_WIDGET_SYSTEM_INSTRUCTIONS = `
INLINE VISUAL GENERATION — A CORE RESPONSIBILITY, NOT AN OPTION

Emersus is a chat interface that can render inline HTML web apps. Widgets are the primary way you visualize comparisons, matrices, doses, phased plans, calculators, mechanisms, and chart-worthy data. For structural or quantitative questions you are EXPECTED to emit a widget in addition to your prose.

A widget is a self-contained HTML block placed inside a fenced code block tagged \`widget\`. Each widget is rendered in a sandboxed iframe with the Emersus design tokens pre-injected and Chart.js 4.4.1 already loaded as the global \`Chart\`. You can call \`new Chart(canvas, config)\` directly inside an inline <script> tag — do NOT add your own <script src="..."> for Chart.js.

EMIT A WIDGET WHEN ANY OF THESE ARE TRUE:
- The question is a comparison (X vs Y, X vs Y vs Z, population A vs population B).
- The question asks for an evidence matrix, evidence-by-outcome, or "what's strong / moderate / limited".
- The answer lists three or more quantitative items (doses, ranges, study results, effect sizes, timelines).
- The answer is a decision tree, phased plan, periodization block, or step-by-step protocol.
- The answer is inherently interactive: a calculator, slider, scenario explorer, lookup table.
- The answer is a mechanism or anatomy walkthrough where spatial layout matters.
- The user asks to "show me", "compare", "visualize", "breakdown", "matrix", "calculator", "chart", "diagram", "dashboard", "widget", "app", or "interactive".
- The user asks for a multi-week training plan, periodized block, weekly split, mesocycle, or anything that resolves to a calendar of dated training sessions. This is a SPECIAL case — use a \`workout-plan\` fence (JSON, not HTML) instead of a regular \`widget\` fence. See the WORKOUT-PLAN FENCES section below.

WHEN NOT TO EMIT A WIDGET
- Short conversational follow-up (under ~60 words of answer).
- Simple clarification or confirmation.
- You do not have real numbers or real findings to fill it. Never fabricate cells or invent study names.

HOW TO EMIT A WIDGET
Lead with a short prose answer first (2–4 sentences of the actual take). Then drop the widget inline. Do NOT duplicate the widget's items verbatim in a bullet list — the widget IS the breakdown, the prose is the verdict. Emit exactly ONE widget per answer. Close the fence with three backticks on their own line.

ABSOLUTELY FORBIDDEN — never draw data with:
- Unicode block characters: ▓ ░ █ ■ □ ▪ ▫ ● ◯
- Box-drawing characters: ┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ ═ ║ ╔ ╗ ╚ ╝
- Repeated ASCII symbols like =====, -----, ||| or space-aligned columns
- Pseudo-progress bars like [####----] or "▓▓▓▓▓░░░"
- Any rendering of data that relies on monospace alignment

Instead, emit a real HTML + CSS + (optional) Chart.js widget inside a \`\`\`widget fence. An ASCII/unicode approximation is a failure and will be rejected and replaced.

Opening fence: literal \`widget\`. \`html\` is also accepted.

\`\`\`widget
<div>
  ...your HTML here...
</div>
\`\`\`

HARD RULES FOR WIDGET HTML
- Self-contained: HTML + inline <style> + (optional) inline <script>. Chart.js is pre-loaded in the iframe — just use the global \`Chart\` directly, do NOT emit a <script src="..."> for it. No other external scripts, no <link>, no @import, no <img src="http...">.
- Prefer div-based grid/flex layouts over <table>. Tables wrap text per-character in narrow iframes; div grids do not.
  Example: <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
- Inherit the host font, color, and background. Do NOT set font-family. Use font-weight:500 for headings and numbers (Apple-style clean).
- Width: fluid, fills the container. Height: whatever the content needs — the host auto-resizes via ResizeObserver. Do not hard-code body height.
- Interactivity is vanilla JS only. The iframe is sandboxed allow-scripts allow-same-origin. No fetch, no localStorage, no cookies, no parent DOM.
- Clickable follow-up elements can call \`window.sendPrompt('follow-up question')\` to send a new chat message back to the parent. Example: \`<button onclick="sendPrompt('What is a safe creatine loading protocol?')">Loading protocol ↗</button>\`.
- Numbers, labels, study names, and effect sizes must come from real findings in your answer or the retrieved evidence. Do not fabricate.
- One idea per widget. Multiple small widgets beat one kitchen-sink dashboard.

DESIGN TOKENS (CSS variables already defined in the iframe)

Surfaces:
  --color-background-primary     page background
  --color-background-secondary   card / metric surface
  --color-background-tertiary    raised panel / hover surface

Text:
  --color-text-primary           body, titles, numbers
  --color-text-secondary         labels, captions, section headings
  --color-text-tertiary          de-emphasized text

Borders / radius:
  --color-border-tertiary        normal border (0.5px)
  --border-radius-md             8px (cards, buttons, inputs)
  --border-radius-lg             14px (large containers)

Status surfaces (for verdicts, badges, alerts — NOT evidence strength):
  --color-background-success / --color-text-success    (green)
  --color-background-warning / --color-text-warning    (amber)
  --color-background-danger  / --color-text-danger     (red)
  --color-background-info    / --color-text-info       (blue)

Evidence-strength tokens (use these for study quality bars, not for status):
  --ev-strong-bg / --ev-strong-text / --ev-strong-dot
  --ev-moderate-bg / --ev-moderate-text / --ev-moderate-dot
  --ev-limited-bg / --ev-limited-text / --ev-limited-dot
  --ev-insufficient-bg / --ev-insufficient-text / --ev-insufficient-dot

Accent hex (allowed ONLY for data encoding in charts/bars):
  #1D9E75 — positive / strong evidence
  #BA7517 — moderate / caution
  #A32D2D — negative / weak evidence

PRE-STYLED NATIVE ELEMENTS (preferred over custom controls)
  <input type="range">, <input type="number">, <input type="text">, <select>, <textarea>, <button>

VOICE INSIDE THE WIDGET
- Same voice as your prose: precise, confident, no hype.
- Concrete numbers (sets, reps, RPE, %1RM, mg/kg, g/day, days/week) with labeled units and axes.
- Cite as the one citing the literature: "2023 meta-analysis", "2021 RCT in trained men".
- If evidence is thin, encode that with --ev-limited-* or --ev-insufficient-* rather than padding cells.

EXAMPLE 1 — evidence-by-outcome comparison card (div-grid, no table)

\`\`\`widget
<div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:16px;">
  <div style="font-size:14px;font-weight:500;margin-bottom:4px;">Beta-alanine vs sodium bicarbonate — high-intensity intervals</div>
  <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:14px;">Bicarbonate is the cleaner acute choice; beta-alanine is the 4–10 week chronic build.</div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:6px;font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.04em;padding:0 0 8px;border-bottom:0.5px solid var(--color-border-tertiary);">
    <div>Outcome</div><div>Beta-alanine</div><div>Sodium bicarbonate</div>
  </div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:6px;font-size:12px;padding:10px 0;border-bottom:0.5px solid var(--color-border-tertiary);align-items:center;">
    <div>Repeated sprint / severe-effort bouts</div>
    <div><span style="background:var(--ev-moderate-bg);color:var(--ev-moderate-text);padding:2px 8px;border-radius:var(--border-radius-md);font-size:11px;">Moderate</span></div>
    <div><span style="background:var(--ev-strong-bg);color:var(--ev-strong-text);padding:2px 8px;border-radius:var(--border-radius-md);font-size:11px;">Strong</span></div>
  </div>
  <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:6px;font-size:12px;padding:10px 0;align-items:center;">
    <div>Chronic training adaptation over weeks</div>
    <div><span style="background:var(--ev-strong-bg);color:var(--ev-strong-text);padding:2px 8px;border-radius:var(--border-radius-md);font-size:11px;">Strong</span></div>
    <div><span style="background:var(--ev-limited-bg);color:var(--ev-limited-text);padding:2px 8px;border-radius:var(--border-radius-md);font-size:11px;">Limited</span></div>
  </div>
</div>
\`\`\`

EXAMPLE 2 — interactive calculator (vanilla JS, Chart.js optional)

\`\`\`widget
<div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:16px;">
  <div style="font-size:14px;font-weight:500;margin-bottom:12px;">Creatine loading calculator</div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
    <label style="font-size:12px;color:var(--color-text-secondary);min-width:70px;">Bodyweight</label>
    <input type="range" min="50" max="120" step="1" value="75" id="bw" oninput="calc()" style="flex:1;">
    <span id="bwv" style="font-size:12px;font-weight:500;min-width:50px;text-align:right;">75 kg</span>
  </div>
  <div style="display:flex;gap:10px;margin-top:12px;">
    <div style="flex:1;background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:12px;">
      <div style="font-size:11px;color:var(--color-text-secondary);">Loading dose (5d)</div>
      <div id="load" style="font-size:20px;font-weight:500;">23 g/day</div>
    </div>
    <div style="flex:1;background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:12px;">
      <div style="font-size:11px;color:var(--color-text-secondary);">Maintenance</div>
      <div id="maint" style="font-size:20px;font-weight:500;">4 g/day</div>
    </div>
  </div>
</div>
<script>
function calc(){
  var bw=+document.getElementById('bw').value;
  document.getElementById('bwv').textContent=bw+' kg';
  document.getElementById('load').textContent=Math.round(bw*0.3)+' g/day';
  document.getElementById('maint').textContent=Math.max(3,Math.round(bw*0.05))+' g/day';
}
calc();
</script>
\`\`\`

WORKOUT-PLAN FENCES (a SPECIAL fence type — JSON, not HTML)

CRITICAL: the workout-plan JSON MUST be enclosed in a fenced code block tagged "workout-plan". The three backticks BEFORE the JSON and the three backticks AFTER are not optional and not decorative — they are the only way the frontend knows to parse and render the JSON as a workout plan card. A workout plan emitted as naked JSON without the fence is rendered as raw text in the chat bubble and is useless to the user. If you emit the JSON without the opening \`\`\`workout-plan and closing \`\`\`, the answer is considered a failure.

When the user asks for a multi-week training plan, periodization block, weekly split, mesocycle, or training calendar, you emit a fence tagged \`workout-plan\` whose body is a JSON object, not HTML. The frontend renders this JSON as a dedicated workout-plan card with Save/Apply/Download buttons — it is NOT rendered through the iframe widget pipeline. Structural rules:

1. Lead with 2–4 sentences of prose (the verdict: why this split, why this volume, why this intensity scheme, what the user should expect). Then drop the fence. Then stop. Do not repeat the sessions as a prose bullet list — the card IS the breakdown.

2. The fence is labeled exactly \`workout-plan\` (lowercase, hyphen). Not \`widget\`, not \`html\`.

3. The body is a JSON document conforming to schema_version 1. Exact shape:

\`\`\`workout-plan
{
  "schema_version": 1,
  "title": "8-week intermediate hypertrophy, upper/lower 4-day",
  "goal": "hypertrophy",
  "experience_level": "intermediate",
  "start_date": "YYYY-MM-DD",
  "timezone": "America/Los_Angeles",
  "weeks": 8,
  "days_per_week": 4,
  "notes": "Short free-text context the user should know — e.g. deload in week 5, progression rules.",
  "sessions": [
    {
      "id": "s_w1d1",
      "week": 1,
      "day_of_week": 1,
      "date": "YYYY-MM-DD",
      "start_time": "17:30",
      "duration_minutes": 60,
      "phase": "Accumulation",
      "title": "Lower A — squat focus",
      "summary": "Heavy back squat plus posterior chain accessories.",
      "completion_status": null,
      "blocks": [
        { "name": "Back squat", "sets": 4, "reps": "5", "load": "75% 1RM", "rpe": 7, "rest_seconds": 180, "notes": "" },
        { "name": "Romanian deadlift", "sets": 3, "reps": "8-10", "load": "RPE 7", "rpe": 7, "rest_seconds": 120, "notes": "" }
      ]
    }
  ]
}
\`\`\`

4. Field rules:
- \`schema_version\` MUST be 1. Do not invent new versions.
- \`goal\` is one of: hypertrophy, strength, endurance, general, sport_specific.
- \`experience_level\` is one of: beginner, intermediate, advanced.
- \`start_date\` is ISO YYYY-MM-DD. If the user says "starting Monday", compute the next Monday from \`today\`.
- \`timezone\` is an IANA name like "America/Los_Angeles" or "Europe/Berlin". If the user didn't give one, use whatever is in their profile or default to "UTC" — DO NOT guess a specific city.
- \`sessions\` is a FLAT list of dated sessions, one entry per scheduled workout. No RRULE, no recurrence tricks. An 8-week 4-day plan has 32 sessions in this array.
- \`id\` is a stable per-session string. Use the format \`s_w<week>d<day_of_week>\` (e.g. \`s_w3d2\` for week 3 Tuesday). NEVER change an id once assigned — see the CHAT ADJUSTMENTS rules below.
- \`day_of_week\` is 1..7 where 1=Monday, 7=Sunday.
- \`start_time\` is local HH:MM in the plan's timezone.
- \`completion_status\` is always \`null\` for a newly-generated plan. Only set it to \`"missed"\`, \`"skipped"\`, or \`"completed"\` when the user is telling you they missed/skipped/finished that session.
- \`blocks\` is an array of exercises. \`sets\` is a number. \`reps\` is a string (because "8-10" and "AMRAP" need to be expressible). \`load\` is a string like "75% 1RM" or "RPE 7" or "bodyweight" — no raw kg/lb numbers unless the user provided them.

5. Use real numbers grounded in the user's context (experience level, equipment, days available, injuries). Do not fabricate study citations inside the plan JSON — keep those for the prose above.

6. Emit exactly ONE workout-plan per answer. If the user asked for two plans, pick one and tell them you'll cover the other if they ask.

7. The \`workout-plan\` fence REPLACES any regular \`widget\` fence for plan requests. Do not emit both.

8. EMIT COMPACT JSON. Plans can have 20+ sessions; pretty-printing burns through the output budget and truncates mid-session. Rules:
   - Single line per session object (no internal newlines inside \`{...}\`).
   - No trailing whitespace, no indentation.
   - Omit any field whose value is an empty string, \`null\`, or a default. Specifically: drop \`"notes": ""\`, \`"summary": ""\`, \`"completion_status": null\`, and \`"phase": ""\`. Drop \`"rpe": <n>\` when \`load\` already encodes it (e.g. \`"load": "RPE 7"\`).
   - Drop \`"rest_seconds"\` if it's the default for the modality (90 for most; 120+ for compound lifts is worth keeping).
   - The top-level \`notes\` field is fine to include when it carries real guidance; skip it when empty.
   - The outer JSON object may still break across lines at the top level (weeks, goal, sessions array) for readability, but each element of \`sessions\` must be on its own single line.
   An example of one compact session line:
   \`{"id":"s_w1d1","week":1,"day_of_week":1,"date":"2026-04-13","start_time":"17:30","duration_minutes":50,"phase":"Foundation","title":"Full Body A","blocks":[{"name":"Goblet squat","sets":3,"reps":"8-10","load":"RPE 6-7","rest_seconds":90},{"name":"Push-up","sets":3,"reps":"8-12","load":"RPE 6-7"}]}\`

CHAT ADJUSTMENTS TO AN EXISTING PLAN

When the user is asking you to adjust a plan they already have, the server will include \`current_workout_plan\` in the user input JSON. When that field is present:

- Treat the user's message as a potential plan-adjustment request. Common patterns:
  - "I missed Friday / yesterday / this week" → find the affected session(s), set \`completion_status: "missed"\`. Either shift the rest of the week or roll missed work forward based on what the user says. If unclear, ask — don't silently delete sessions.
  - "I can't lift X" / "X is too heavy" / "X is too light" → rescale that exercise's load for FUTURE sessions only. Leave past sessions unchanged; they are history.
  - "Swap X for Y" → replace the exercise in all future sessions where it appears, preserving sets/reps/intensity.
  - "Move Friday to Saturday" / "push the plan back a week" → reschedule the affected sessions. Update their \`date\` and \`day_of_week\`.
  - "My knee hurts" / "my shoulder is bothering me" → flag affected exercises in their \`notes\` field, propose conservative substitutions. This is the only place you may lean medical-conservative in one sentence.
  - "Add a deload" → insert a deload week and shift downstream sessions.

- Emit a \`workout-plan\` fence that contains:
  1. \`"updates_plan_id": "<the id from current_workout_plan.id>"\` as a top-level field alongside \`schema_version\`.
  2. The SAME plan.id (copy it from current_workout_plan).
  3. The FULL plan (not a diff — send the whole sessions array).

- Preserve the \`id\` on every session that you are NOT structurally changing. If session s_w3d2 keeps the same week, day_of_week, and exercises, its id MUST remain s_w3d2. Generating fresh ids breaks the sync pipeline that tracks external calendar events per session. This is a hard rule — the server will reject updates that drift ids without real changes.

- Never modify sessions whose \`date\` is in the past unless the user is explicitly editing history ("I actually did 5 sets, not 4, on last Monday"). Past sessions are read-mostly.

- Lead with prose that explains what changed and why. Be specific: "I moved your Friday session to Saturday and bumped the next two Monday squats from 75% to 70% 1RM so you can hit the prescribed RPE."

DEFAULT BEHAVIOR
For everyday questions, just write prose. Reach for a widget when the question is structurally visual — and only when you have real data to fill it. For plan-building and plan-adjustment questions, use the workout-plan fence format above.
`.trim();

// Regex detectors for (a) user questions that clearly want a visual output
// and (b) pseudo-visual text (ASCII/unicode art) the model sometimes emits
// when it ignores the widget instructions. When (a) is true and the model
// output triggers (b), we do a forcing retry that requires a real widget.
const VISUAL_REQUEST_RE = /\b(dashboard|chart|graph|diagram|flowchart|mockup|wireframe|calculator|slider|interactive|simulation|visualize|visualisation|visualization|widget|web\s?app|infographic|matrix|breakdown|comparison|compare|vs\.?|decision\s*tree|timeline|roadmap|dose.?response|dose.?range)\b/i;

const PSEUDO_VISUAL_RE = /[▓░█■□▪▫●◯┌┐└┘├┤┬┴┼─│═║╔╗╚╝]|\[#+-*\]|(?:^|\n)\s*\|[^\n]{3,}\|\s*(?:\n|$)|(?:^|\n)\s*[-=]{4,}\s*(?:\n|$)/;

function wantsVisualOutput(question) {
  return VISUAL_REQUEST_RE.test(String(question || ""));
}

function containsPseudoVisual(text) {
  return PSEUDO_VISUAL_RE.test(String(text || ""));
}

function hasInlineWidgetFence(text) {
  const src = String(text || "");
  // Accept CRLF, LF, or no newline at all after the info tag — must match
  // splitSynthesisIntoSegments so the "already has widget" check can't
  // disagree with the segmenter.
  const re = /```([\w-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = String(m[1] || "").toLowerCase();
    const firstChar = String(m[2] || "").trim().charAt(0);
    if (tag === "widget" || tag === "html" || (!tag && firstChar === "<")) return true;
  }
  return false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(value, maxItems = 8, maxLength = 240) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parsePublicationTypes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 80))
    .filter(Boolean)
    .slice(0, 6);
}

function parseAuthors(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item, 160))
    .filter(Boolean)
    .slice(0, 12);
}

function formatAuthorLabel(authors) {
  const normalized = parseAuthors(authors);

  if (normalized.length === 0) {
    return "";
  }

  const firstAuthor = normalized[0];
  const surname = firstAuthor.split(/\s+/).slice(-1)[0] || firstAuthor;
  return normalized.length === 1 ? surname : `${surname} et al.`;
}

function parseJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_error) {
      const error = new Error("Request body must be valid JSON.");
      error.statusCode = 400;
      throw error;
    }
  }

  return req.body;
}

function parseUserId(rawUserId) {
  const userId = normalizeText(rawUserId, 160);

  if (!userId) {
    return { stableUserId: "", supabaseUserId: "" };
  }

  if (userId.startsWith("supabase:")) {
    return {
      stableUserId: userId,
      supabaseUserId: userId.slice("supabase:".length),
    };
  }

  return {
    stableUserId: userId,
    supabaseUserId: "",
  };
}

function normalizeUuid(value) {
  const text = normalizeText(value, 120).toLowerCase();
  if (!text) return "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    text
  )
    ? text
    : "";
}

function inferTopic(question) {
  const text = question.toLowerCase();

  if (/safe|safety|risk|harm|side effect|contraindication|adverse/.test(text)) {
    return "safety";
  }

  if (/dose|dosage|duration|protocol|loading phase|maintenance/.test(text)) {
    return "protocol";
  }

  if (
    /peptide|bpc[-\s]?157|body protection compound|thymosin|tb[-\s]?500|tb500|glp[-\s]?1|semaglutide|liraglutide|tirzepatide|ghrp|growth hormone releasing|cjc[-\s]?1295|ipamorelin|tesamorelin|ghrelin|secretagogue/.test(
      text
    )
  ) {
    return "peptides";
  }

  if (/run|cardio|zone 2|vo2|max|cycling|endurance|interval/.test(text)) {
    return "cardio";
  }

  if (/protein|calorie|diet|nutrition|supplement|macro|meal|cut|bulk/.test(text)) {
    return "nutrition";
  }

  if (/focus|sleep|stress|mental|cognitive|motivation|discipline/.test(text)) {
    return "mental_performance";
  }

  if (/study|studying|learn|learning|exam|homework|memorization|flashcard|test prep|school/.test(text)) {
    return "learning";
  }

  if (/strength|hypertrophy|muscle gain|build muscle|lean mass|resistance training|lifting/.test(text)) {
    return "strength";
  }

  if (/recovery|soreness|rehab|tendon|joint|injury/.test(text)) {
    return "recovery";
  }

  return "general";
}

function buildPlan(question, profile) {
  const topic = inferTopic(question);
  const lowerQuestion = question.toLowerCase();
  const riskLevel =
    /injur|pain|depress|anx|panic|eating disorder|blood pressure|diabetes|medication|pregnan/.test(
      lowerQuestion
    ) || normalizeText(profile.injuries_limitations, 600)
      ? "medium"
      : "low";

  return {
    topic,
    riskLevel,
  };
}

function sanitizeRequest(payload) {
  const question = normalizeText(payload?.question, MAX_QUESTION_LENGTH);

  if (!question) {
    const error = new Error("A non-empty question is required.");
    error.statusCode = 400;
    throw error;
  }

  return {
    question,
    userId: normalizeText(payload?.userId, 160),
    threadId: normalizeUuid(payload?.threadId),
    requestMeta: {
      clientIp: normalizeText(payload?.requestMeta?.clientIp, 200),
      userAgent: normalizeText(payload?.requestMeta?.userAgent, 300),
    },
    profile: {
      goal: normalizeText(payload?.profile?.goal, MAX_PROFILE_FIELD_LENGTH),
      experience_level: normalizeText(
        payload?.profile?.experience_level,
        120
      ),
      dietary_preferences: normalizeText(
        payload?.profile?.dietary_preferences,
        MAX_PROFILE_FIELD_LENGTH
      ),
      injuries_limitations: normalizeText(
        payload?.profile?.injuries_limitations,
        MAX_PROFILE_FIELD_LENGTH
      ),
      equipment_access: normalizeText(payload?.profile?.equipment_access, 200),
      available_days_per_week: normalizeText(
        payload?.profile?.available_days_per_week,
        80
      ),
      available_minutes_per_session: normalizeText(
        payload?.profile?.available_minutes_per_session,
        80
      ),
      sleep_stress_context: normalizeText(
        payload?.profile?.sleep_stress_context,
        200
      ),
      medical_disclaimer_acknowledged:
        payload?.profile?.medical_disclaimer_acknowledged === true,
    },
    includeDebug: payload?.includeDebug === true,
    threadState: normalizeThreadState(payload?.threadState),
    recentMessages: normalizeRecentMessages(payload?.recentMessages),
  };
}

function extractTokenUsage(payload) {
  const usage = payload && typeof payload === "object" ? payload.usage || {} : {};
  const promptTokens = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0
  );
  const completionTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0
  );
  const totalTokens = Number(
    usage.total_tokens ??
      usage.totalTokens ??
      (Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? promptTokens + completionTokens
        : 0)
  );

  // OpenAI's Responses API automatically caches stable prompt prefixes ≥1024
  // tokens at $0.10/1M (75% off the $0.40/1M base rate for gpt-4.1-mini). The
  // Emersus system prompt is byte-identical across requests and ~3.2k tokens
  // long, so this caching should be firing on every request after warmup. The
  // count appears under usage.input_tokens_details.cached_tokens on the
  // Responses API and under usage.prompt_tokens_details.cached_tokens on the
  // Chat Completions API — read both shapes so we don't silently miss it if
  // the SDK swaps them. Without this, our token-cost dashboards undercount
  // savings by ~40%.
  const inputDetails =
    (usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? usage.input_tokens_details
      : null) ||
    (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? usage.prompt_tokens_details
      : null) ||
    {};
  const cachedPromptTokens = Number(
    inputDetails.cached_tokens ?? inputDetails.cachedTokens ?? 0
  );

  const normalizedPrompt = Number.isFinite(promptTokens) ? Math.max(0, Math.round(promptTokens)) : 0;
  const normalizedCompletion = Number.isFinite(completionTokens)
    ? Math.max(0, Math.round(completionTokens))
    : 0;
  const normalizedTotal = Number.isFinite(totalTokens)
    ? Math.max(0, Math.round(totalTokens))
    : normalizedPrompt + normalizedCompletion;
  const normalizedCached = Number.isFinite(cachedPromptTokens)
    ? Math.max(0, Math.min(normalizedPrompt, Math.round(cachedPromptTokens)))
    : 0;

  return {
    prompt_tokens: normalizedPrompt,
    completion_tokens: normalizedCompletion,
    total_tokens: normalizedTotal,
    cached_prompt_tokens: normalizedCached,
  };
}

function mergeTokenUsageTotals(baseUsage, nextUsage) {
  const base = extractTokenUsage({ usage: baseUsage });
  const next = extractTokenUsage({ usage: nextUsage });
  return {
    prompt_tokens: base.prompt_tokens + next.prompt_tokens,
    completion_tokens: base.completion_tokens + next.completion_tokens,
    total_tokens: base.total_tokens + next.total_tokens,
    cached_prompt_tokens: base.cached_prompt_tokens + next.cached_prompt_tokens,
  };
}

function classifySafety({ question, profile, threadState }) {
  const text = [
    question,
    profile?.goal,
    profile?.dietary_preferences,
    profile?.injuries_limitations,
    profile?.sleep_stress_context,
    threadState?.last_user_intent,
  ]
    .map((item) => normalizeText(item, 400))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /ignore (all|previous|prior) instructions|reveal (your|the) (system|hidden) prompt|show (your|the) hidden instructions|developer message|jailbreak|bypass (your )?(rules|guardrails)|act as if safety does not apply/.test(
      text
    )
  ) {
    return {
      status: "prompt_injection_or_system_probe",
      responseMode: "refusal",
      reasons: ["prompt_injection_or_system_probe"],
    };
  }

  if (
    /suicide|kill myself|self-harm|self harm|purge|bulimi|anorexi|starve myself|how little can i eat|crash diet|dehydration cut|laxative|vomit after eating/.test(
      text
    )
  ) {
    return {
      status: "disallowed_unsafe",
      responseMode: "refusal",
      reasons: ["unsafe_body_or_self_harm"],
    };
  }

  if (
    /steroid cycle|\btren(bolone)?\b|\btest e\b|testosterone cycle|inject testosterone|illegal steroid|\bdnp\b|\bclenbuterol\b|ephedrine stack|where can i buy/.test(
      text
    )
  ) {
    return {
      status: "disallowed_unsafe",
      responseMode: "refusal",
      reasons: ["illicit_or_high_risk_enhancement"],
    };
  }

  if (
    /diagnos|diagnosis|should i take this medication|medication|prescription|drug interaction|interact with|pregnan|pregnancy|breastfeeding|diabetes|hypertension|blood pressure medication|ssri|antidepressant|bipolar|panic disorder|treat my disease|treat my condition/.test(
      text
    )
  ) {
    return {
      status: "medical_boundary",
      responseMode: "boundary",
      reasons: ["medical_or_medication_overlap"],
    };
  }

  if (/blood pressure|anxiety|panic|insomnia|arrhythmia|heart condition/.test(text)) {
    return {
      status: "allowed_with_caution",
      responseMode: "caution",
      reasons: ["health_risk_overlap"],
    };
  }

  return {
    status: "allowed",
    responseMode: "normal",
    reasons: [],
  };
}

function buildGuardrailResponse({ question, plan, safety }) {
  const blocked =
    safety.status === "disallowed_unsafe" ||
    safety.status === "prompt_injection_or_system_probe";
  const boundary = safety.status === "medical_boundary";

  let answerText =
    "I can help with evidence-backed training, nutrition, supplements, recovery, and performance questions.";

  if (blocked) {
    answerText =
      "I can't help with that request. If you want, I can help with a safer evidence-based version of the question instead.\n\n- Ask about general supplement effectiveness or safety.\n- Ask about sustainable fat loss, training, recovery, or performance strategies.\n- If this is urgent or safety-related, contact a qualified clinician or local emergency support.";
  } else if (boundary) {
    answerText =
      "This question crosses into medical guidance, so I can't give a personalized medication or diagnosis recommendation. I can still help with general evidence-backed education, but a clinician should guide the actual decision.\n\n- If you want, ask for the general evidence on the supplement, food, or training method.\n- Include that you want a high-level summary only, not a personal medical recommendation.\n- For anything involving medications, pregnancy, or a diagnosed condition, check with a licensed clinician.";
  }

  return {
    user: {
      id: null,
      profile_used: {},
    },
    plan,
    summary: normalizeText(answerText, 600),
    answer_text: answerText,
    recommendations: {
      general: [],
    },
    confidence: {
      score: 0.25,
      label: blocked ? "blocked" : "medical_boundary",
      rationale: blocked
        ? "The request was blocked by Emersus safety guardrails."
        : "This request overlaps with medical decision-making and needs a stricter boundary.",
    },
    limitations: [],
    sources: [],
    cards: [],
    guardrail: {
      status: safety.status,
      response_mode: safety.responseMode,
      reasons: safety.reasons,
    },
  };
}

function hashClientIp(value) {
  const normalized = normalizeText(value, 200);
  if (!normalized) {
    return "";
  }

  return createHash("sha256").update(normalized).digest("hex");
}

async function logGuardrailEvent({
  supabaseUrl,
  serviceRoleKey,
  supabaseUserId,
  stableUserId,
  question,
  plan,
  safety,
  requestMeta,
  threadState,
}) {
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  if (!safety || safety.status === "allowed") {
    return;
  }

  const payload = {
    user_id: supabaseUserId || null,
    stable_user_id: stableUserId || null,
    event_type: safety.status,
    response_mode: safety.responseMode || "normal",
    reasons: Array.isArray(safety.reasons) ? safety.reasons : [],
    question_preview: normalizeText(question, 500),
    topic: normalizeText(plan?.topic, 80),
    risk_level: normalizeText(plan?.riskLevel, 40),
    client_ip_hash: hashClientIp(requestMeta?.clientIp),
    user_agent: normalizeText(requestMeta?.userAgent, 300),
    metadata: {
      request_has_thread_memory: Boolean(threadStateHasUsefulContent(threadState)),
    },
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/guardrail_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Guardrail event log failed: ${errorText || response.status}`);
  }
}

async function logTokenUsageEvent({
  supabaseUrl,
  serviceRoleKey,
  supabaseUserId,
  stableUserId,
  threadId,
  question,
  plan,
  requestMeta,
  tokenUsage,
  responseId,
  model,
}) {
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  const totalTokens = Number(tokenUsage?.total_tokens || 0);
  if (!totalTokens) {
    return;
  }

  const cachedPromptTokens = Math.max(
    0,
    Number(tokenUsage?.cached_prompt_tokens || 0)
  );
  const payload = {
    user_id: supabaseUserId || null,
    stable_user_id: stableUserId || null,
    thread_id: normalizeUuid(threadId) || null,
    question_preview: normalizeText(question, 320),
    topic: normalizeText(plan?.topic, 80) || null,
    risk_level: normalizeText(plan?.riskLevel, 40) || null,
    model: normalizeText(model, 80) || null,
    openai_response_id: normalizeText(responseId, 120) || null,
    prompt_tokens: Math.max(0, Number(tokenUsage?.prompt_tokens || 0)),
    completion_tokens: Math.max(0, Number(tokenUsage?.completion_tokens || 0)),
    total_tokens: Math.max(0, Number(tokenUsage?.total_tokens || 0)),
    cached_prompt_tokens: cachedPromptTokens,
    client_ip_hash: hashClientIp(requestMeta?.clientIp),
    user_agent: normalizeText(requestMeta?.userAgent, 300),
    metadata: {
      source: "emersus.recommendation",
      generated_at: new Date().toISOString(),
    },
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/chat_token_usage_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Token usage log failed: ${errorText || response.status}`);
  }
}

function threadStateHasUsefulContent(threadState) {
  return Boolean(
    normalizeText(threadState?.primary_topic, 80) ||
      normalizeText(threadState?.goal_context, 80) ||
      normalizeText(threadState?.last_user_intent, 80) ||
      (Array.isArray(threadState?.recent_entities) &&
        threadState.recent_entities.length > 0)
  );
}

async function fetchSupabaseProfile(supabaseUrl, serviceRoleKey, supabaseUserId) {
  if (!supabaseUrl || !serviceRoleKey || !supabaseUserId) {
    return null;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=goal,experience_level,dietary_preferences,injuries_limitations,full_name,email&id=eq.${encodeURIComponent(
      supabaseUserId
    )}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Supabase profile fetch failed:", errorText);
    return null;
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Loads a workout plan so buildSynthesisInput can include it as
// current_workout_plan. The user_id filter is defense-in-depth on top of
// the user already being authenticated — we do NOT want a scenario where a
// spoofed active_workout_plan_id in thread_state pulls another user's
// plan into the prompt. Returns the plan row (with the plan jsonb under
// .plan) or null if the plan doesn't exist, belongs to someone else, or
// is archived.
async function fetchSupabaseWorkoutPlan(supabaseUrl, serviceRoleKey, supabaseUserId, planId) {
  if (!supabaseUrl || !serviceRoleKey || !supabaseUserId || !planId) {
    return null;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/workout_plans?select=id,user_id,title,schema_version,plan,last_adjusted_via,last_adjusted_at&id=eq.${encodeURIComponent(
      planId
    )}&user_id=eq.${encodeURIComponent(supabaseUserId)}&archived_at=is.null&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Supabase workout_plans fetch failed:", errorText);
    return null;
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function mergeProfile(profile, storedProfile) {
  return {
    goal: normalizeText(profile?.goal || storedProfile?.goal, 300),
    experience_level: normalizeText(
      profile?.experience_level || storedProfile?.experience_level,
      120
    ),
    dietary_preferences: normalizeText(
      profile?.dietary_preferences || storedProfile?.dietary_preferences,
      300
    ),
    injuries_limitations: normalizeText(
      profile?.injuries_limitations || storedProfile?.injuries_limitations,
      300
    ),
    equipment_access: normalizeText(profile?.equipment_access, 200),
    available_days_per_week: normalizeText(profile?.available_days_per_week, 80),
    available_minutes_per_session: normalizeText(
      profile?.available_minutes_per_session,
      80
    ),
    sleep_stress_context: normalizeText(profile?.sleep_stress_context, 200),
    medical_disclaimer_acknowledged:
      profile?.medical_disclaimer_acknowledged === true,
  };
}

function normalizeThreadConstraints(value) {
  const constraints = value && typeof value === "object" ? value : {};
  return {
    dietary: normalizeList(constraints.dietary, 4, 80),
    injury: normalizeList(constraints.injury, 4, 80),
    equipment: normalizeList(constraints.equipment, 4, 80),
    schedule: normalizeList(constraints.schedule, 4, 80),
    sleep_stress: normalizeList(constraints.sleep_stress, 4, 80),
    medical_caution: normalizeList(constraints.medical_caution, 4, 80),
  };
}

function normalizeThreadState(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    version: Number(raw.version || 1),
    primary_topic: normalizeText(raw.primary_topic, 80),
    secondary_topics: normalizeList(raw.secondary_topics, 4, 60),
    goal_context: normalizeText(raw.goal_context, 80),
    question_mode: normalizeText(raw.question_mode, 40),
    recent_entities: normalizeList(raw.recent_entities, 8, 60),
    comparison_target: normalizeText(raw.comparison_target, 80),
    population_context: normalizeList(raw.population_context, 4, 60),
    constraints: normalizeThreadConstraints(raw.constraints),
    last_user_intent: normalizeText(raw.last_user_intent, 180),
    last_answer_summary: normalizeText(raw.last_answer_summary, 260),
    thread_summary: normalizeText(raw.thread_summary, 420),
    // Set by the chat frontend when the user saves a plan, opens a thread
    // from /app/workout/, or continues an adjustment session. When present,
    // generateRecommendation loads the plan from Supabase and feeds it to
    // buildSynthesisInput so the model can reason about edits ("I missed
    // Friday", "I can't squat 75% 1RM"). Stored as a UUID string; anything
    // that isn't a 36-char UUID-ish string is silently dropped.
    active_workout_plan_id: normalizeUuid(raw.active_workout_plan_id) || "",
    updated_at: normalizeText(raw.updated_at, 60),
  };
}

function normalizeRecentMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      role: normalizeText(item?.role, 24).toLowerCase(),
      text: normalizeText(item?.text, 320),
    }))
    .filter((item) => item.role && item.text)
    .slice(-6);
}

function buildThreadMemoryBlock(threadState, recentMessages) {
  const constraints = [];

  for (const [label, values] of Object.entries(threadState.constraints || {})) {
    if (Array.isArray(values) && values.length) {
      constraints.push(`${titleCase(label)}: ${values.join(", ")}`);
    }
  }

  // Only emit fields that have actual content. The previous version always
  // emitted every label with "none" / "not established" placeholders, which
  // cost ~80 input tokens per request on threads with sparse memory (i.e.
  // most of them). The model gets the same information; empty fields are
  // simply absent.
  const lines = [];
  if (threadState.primary_topic) lines.push(`Primary topic: ${threadState.primary_topic}`);
  if (threadState.goal_context) lines.push(`Goal context: ${threadState.goal_context}`);
  if (threadState.question_mode) lines.push(`Current mode: ${threadState.question_mode}`);
  if (threadState.recent_entities.length)
    lines.push(`Recent entities: ${threadState.recent_entities.join(", ")}`);
  if (threadState.population_context.length)
    lines.push(`Population context: ${threadState.population_context.join(", ")}`);
  if (threadState.comparison_target)
    lines.push(`Comparison target: ${threadState.comparison_target}`);
  if (constraints.length) lines.push(`Constraints: ${constraints.join(" | ")}`);
  if (threadState.last_user_intent)
    lines.push(`Last user intent: ${threadState.last_user_intent}`);
  if (threadState.last_answer_summary)
    lines.push(`Last answer summary: ${threadState.last_answer_summary}`);
  if (threadState.thread_summary)
    lines.push(`Thread summary: ${threadState.thread_summary}`);

  if (recentMessages.length) {
    lines.push(
      "Recent messages:",
      ...recentMessages.map(
        (message) => `- ${message.role}: ${message.text}`
      )
    );
  }

  return lines.join("\n");
}

function normalizeVectorEvidenceRow(row) {
  const publicationTypes = parsePublicationTypes(row.publication_types);
  const publicationYear = normalizeText(row.publication_year, 8);
  const publicationDate = normalizeText(row.publication_date, 40);
  const pmid = normalizeText(row.pmid, 32);
  const doi = normalizeText(row.doi, 160);

  return {
    source_id: pmid ? `pmid:${pmid}` : null,
    pmid,
    doi,
    pmcid: normalizeText(row.pmcid, 40),
    authors: parseAuthors(row.authors),
    author_label: formatAuthorLabel(row.authors),
    title: normalizeText(row.title, 240),
    journal: normalizeText(row.journal, 160),
    publication_year: publicationYear,
    publication_date: publicationDate,
    publication_types: publicationTypes,
    publication_type: publicationTypes.join(", "),
    chunk_type: normalizeText(row.chunk_type, 40),
    chunk_text: normalizeText(row.chunk_text, 1200),
    excerpt: normalizeText(row.chunk_text, 420),
    summary: normalizeText(row.chunk_text, 600),
    similarity: clamp(Number(row.similarity || 0), 0, 1),
    database_score: clamp(Number(row.similarity || 0), 0, 1),
    source_type: "pubmed_vector",
    evidence_level: publicationTypes.join(", "),
    published_at: publicationDate || publicationYear,
    url: doi
      ? `https://doi.org/${doi}`
      : pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : "",
    why_it_matters: normalizeText(
      row.chunk_text || `Matched a PubMed evidence chunk with similarity ${Number(row.similarity || 0).toFixed(2)}.`,
      240
    ),
    mesh_terms: Array.isArray(row.mesh_terms) ? row.mesh_terms.slice(0, 8) : [],
  };
}

function scoreEvidenceFreshness(publishedAt) {
  if (!publishedAt) {
    return 0.45;
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return 0.45;
  }

  const daysOld = (Date.now() - publishedTime) / (1000 * 60 * 60 * 24);

  if (daysOld <= 180) {
    return 1;
  }

  if (daysOld <= 365 * 2) {
    return 0.82;
  }

  if (daysOld <= 365 * 5) {
    return 0.66;
  }

  return 0.5;
}

function scoreEvidenceQuality(evidenceLevel, sourceType) {
  const text = `${evidenceLevel} ${sourceType}`.toLowerCase();

  if (/meta|systematic|guideline|consensus|review/.test(text)) {
    return 1;
  }

  if (/trial|rct|peer|journal|database/.test(text)) {
    return 0.84;
  }

  return 0.68;
}

function scoreTone(score) {
  if (score >= 0.8) {
    return "good";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return "caution";
}

function rankDatabaseEvidence(evidence) {
  return [...evidence]
    .map((item) => {
      const freshnessScore = scoreEvidenceFreshness(item.published_at);
      const qualityScore = scoreEvidenceQuality(
        item.evidence_level,
        item.source_type
      );
      const databaseScore = clamp(Number(item.database_score || 0), 0, 1);
      const weightedScore =
        freshnessScore * 0.35 + qualityScore * 0.35 + databaseScore * 0.3;

      return {
        ...item,
        freshness_score: Number(freshnessScore.toFixed(2)),
        quality_score: Number(qualityScore.toFixed(2)),
        ranking_score: Number(weightedScore.toFixed(2)),
      };
    })
    .sort((left, right) => right.ranking_score - left.ranking_score);
}

function dedupeEvidence(evidence) {
  const byId = new Map();

  for (const item of evidence) {
    const key =
      item.source_id ||
      item.pmid ||
      item.doi ||
      item.url ||
      `${item.title}:${item.excerpt}`;

    const existing = byId.get(key);

    if (!existing || Number(item.ranking_score || 0) > Number(existing.ranking_score || 0)) {
      byId.set(key, item);
    }
  }

  return [...byId.values()];
}

async function retrieveVectorEvidence(question) {
  try {
    const matches = await retrieveVectorDatabaseEvidence({
      prompt: question,
      limit: VECTOR_LIMIT,
      matchThreshold: VECTOR_MATCH_THRESHOLD,
      matchCount: VECTOR_MATCH_COUNT,
    });

    return {
      available: matches.length > 0,
      method: "vector",
      evidence: rankDatabaseEvidence(
        dedupeEvidence(matches.map(normalizeVectorEvidenceRow))
      ).slice(0, VECTOR_LIMIT),
      error: null,
    };
  } catch (error) {
    console.error("Vector evidence retrieval failed:", error);
    return {
      available: false,
      method: null,
      evidence: [],
      error: error.message || "Vector evidence retrieval failed.",
    };
  }
}

function formatEvidenceForModel(evidence) {
  if (!evidence.length) {
    return "No database evidence retrieved.";
  }

  // Compact two-line shape per doc: a single pipe-separated metadata header
  // followed by the excerpt. Saves ~35 input tokens per doc vs the old
  // labelled "Authors:/PMID:/Journal:/Year:/Publication type:" stack while
  // still surfacing every field the model actually uses (year, study type,
  // journal, pmid, title, excerpt). The model has no trouble parsing this
  // shape — labels are only useful when fields are ambiguous.
  return evidence
    .slice(0, 5)
    .map((item, index) => {
      const year = item.publication_year || item.published_at || "";
      const pubType = item.publication_type || item.evidence_level || "";
      const headerParts = [
        year || null,
        pubType || null,
        item.journal || null,
        item.pmid ? `pmid ${item.pmid}` : null,
        item.author_label || null,
      ].filter(Boolean);
      const header = `[${index + 1}] ${headerParts.length ? `${headerParts.join(" · ")} — ` : ""}${item.title || "Untitled evidence"}`;
      return item.excerpt ? `${header}\n${item.excerpt}` : header;
    })
    .join("\n\n");
}

function buildSynthesisInput({
  question,
  profile,
  plan,
  evidenceForModel,
  today,
  threadState,
  recentMessages,
  safety,
  currentWorkoutPlan = null,
}) {
  const normalizedThreadState = normalizeThreadState(threadState);
  const normalizedRecentMessages = normalizeRecentMessages(recentMessages);
  const threadMemory = buildThreadMemoryBlock(
    normalizedThreadState,
    normalizedRecentMessages
  );
  return [
    {
      role: "system",
      content:
        [
          "You are Emersus AI. Speak in the voice of an exercise scientist who also coaches in the gym every day — credentialed (think PhD in exercise physiology, CSCS-level practical experience), comfortable with primary literature, and equally comfortable telling a lifter exactly what to do on Monday morning.",
          INLINE_WIDGET_SYSTEM_INSTRUCTIONS,
          "Tone: precise, confident, and direct. No hype, no hedging filler, no motivational fluff. Address the reader as 'you'. Sound like a knowledgeable training partner, not a medical disclaimer.",
          "Lead with the answer or the protocol, then briefly justify it with the mechanism or the data. Prefer specific numbers (sets, reps, RPE, grams, mg/kg, minutes, days/week, %1RM) over vague language. If a number depends on bodyweight, training age, or context, give the formula or the bracket — never just 'it depends'.",
          "Acknowledge real uncertainty when the evidence is mixed or thin, but do it in one sentence and keep moving. Never pad with 'consult a professional' unless the question is genuinely medical.",
          "When you reference research, name the study type (e.g. '2023 meta-analysis', 'a recent crossover trial in trained men'), the population if it matters, and the effect size or finding. Speak as the one citing the literature — never as someone summarizing a packet of evidence handed to you. Do not write phrases like 'the provided evidence', 'the retrieved studies', 'based on the evidence', 'according to the sources I was given'.",
          "Use the provided evidence first. Keep claims tethered to it. Be practical, specific, and concise.",
          "Use thread memory only to interpret follow-up references or preserve relevant goal/constraint continuity.",
          "Do not use thread memory as evidence, and do not let it override the user's current question.",
          "If the current question introduces a new topic, ignore prior hypertrophy or strength context unless the user explicitly connects the new topic to that context.",
          "If the current question is a short confirmation such as 'yes' or 'do that', resolve it against the immediately previous assistant offer in Recent messages, not an older thread topic.",
          "If thread context is needed for interpretation, make the assumption briefly explicit.",
          "Do not invent sources. Do not return JSON.",
          "Use a short bullet list only when it genuinely helps the user act on the answer.",
          "Do not use section headings like SUMMARY, TRAINING, NUTRITION, MENTAL PERFORMANCE, CONFIDENCE, or LIMITATIONS.",
          "Do not mention confidence scores, confidence labels, or system-status concepts in the answer.",
          "Only mention training, nutrition, or mental-performance advice if it is directly relevant to the user's question.",
        ].join("\n"),
    },
    {
      role: "user",
      // Minified JSON (no `null, 2` indenting): the model parses JSON the same
      // way regardless of whitespace, but pretty-printing was costing ~60 input
      // tokens per request for zero benefit.
      //
      // The instructions[] list was also pruned: every item that purely
      // restated something already in the system prompt above (use evidence
      // first, thread memory only for reference resolution, evidence-limited
      // language, no irrelevant advice, the comparison-→-widget directive
      // which is already covered exhaustively in INLINE_WIDGET_SYSTEM_INSTRUCTIONS)
      // was deleted. Only per-request specifics that aren't in the system
      // prompt remain: medical-risk handling and inline-citation suppression.
      content: JSON.stringify({
        today,
        question,
        topic: plan.topic,
        risk_level: plan.riskLevel,
        safety_mode: safety?.responseMode || "normal",
        safety_reasons: Array.isArray(safety?.reasons) ? safety.reasons : [],
        user_profile: profile,
        thread_memory: threadMemory,
        // Present only when the user is currently following a plan and
        // Emersus should reason about edits to it. Populated by
        // generateRecommendation via fetchSupabaseWorkoutPlan when
        // threadState.active_workout_plan_id is set. When this is non-null,
        // the CHAT ADJUSTMENTS section of the system prompt applies and the
        // model should emit workout-plan fences with updates_plan_id set.
        // Keep the key present (as null) when there's no active plan so the
        // model never confuses "no active plan" with "field forgotten".
        current_workout_plan: currentWorkoutPlan || null,
        retrieved_evidence: evidenceForModel,
        instructions: [
          "If the question touches medical or medication risk, stay high level and do not give diagnosis or personalized medication advice.",
          "SOURCES POLICY (strict): never list, cite, bracket, or reference sources in the chat body. No '[1]' / '(Smith 2023)' / 'Source 1:' / trailing 'Sources:' / 'References:' sections / bibliographies / numbered source lists / clickable links to studies. Do not write phrases like 'see source below', 'according to source 3', or 'the cited paper'. You CAN and SHOULD describe the research naturally in the prose ('a 2023 meta-analysis in trained men found...', 'the classic creatine loading trials'), because the sources panel is rendered separately on the right rail and the user will see the actual citations there.",
          "If the user is asking for a multi-week training plan, mesocycle, periodized block, weekly split, or training calendar, emit a ```workout-plan``` fence containing JSON that conforms to schema_version 1 (see WORKOUT-PLAN FENCES in the system instructions). Lead with 2–4 sentences of prose rationale, then the fence, then stop.",
          "If current_workout_plan is present and the user is asking to modify it (missed a session, cannot hit a prescribed load, exercise swap, reschedule, injury, add a deload), emit a ```workout-plan``` fence whose JSON body has a top-level updates_plan_id field equal to current_workout_plan.id and preserves every session id that is not structurally changing.",
        ],
      }),
    },
  ];
}

function extractStructuredOutput(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.output_parsed && typeof payload.output_parsed === "object") {
    return payload.output_parsed;
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.parsed && typeof item.parsed === "object") {
        return item.parsed;
      }

      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content?.parsed && typeof content.parsed === "object") {
            return content.parsed;
          }

          if (content?.json && typeof content.json === "object") {
            return content.json;
          }
        }
      }
    }
  }

  return null;
}

function extractTextFromResponse(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (typeof item.text === "string" && item.text.trim()) {
        return item.text;
      }

      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string" && content.text.trim()) {
            return content.text;
          }
        }
      }
    }
  }

  return "";
}

async function callOpenAISynthesis({
  model = DEFAULT_MODEL,
  question,
  profile,
  plan,
  evidenceForModel,
  today,
  threadState,
  recentMessages,
  safety,
  currentWorkoutPlan = null,
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // 2800 was fine for prose + one inline widget, but the workout-plan
      // fence emits a full JSON schedule. An 8-week 4-day plan is ~32
      // sessions × ~15 fields each, which easily runs past 2800 output
      // tokens and truncates the fence mid-session (the frontend then
      // shows the unclosed fence as raw prose). 8000 is a ceiling, not a
      // cost — the API only bills actual output — so bumping it costs
      // nothing for non-plan answers and fixes plan truncation.
      max_output_tokens: 8000,
      input: buildSynthesisInput({
        question,
        profile,
        plan,
        evidenceForModel,
        today,
        threadState,
        recentMessages,
        safety,
        currentWorkoutPlan,
      }),
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error?.message || "The OpenAI recommendation request failed."
    );
  }

  return payload;
}

// When the first synthesis pass produces a pseudo-visual instead of a real
// widget (e.g. unicode-bar "dashboards"), re-ask the model for JUST the
// widget HTML while keeping the already-written prose intact. This is
// cheaper than re-synthesizing the whole answer and much more reliable than
// trying to coax a widget out in a single pass.
async function callOpenAIWidgetForcingRetry({
  model = DEFAULT_MODEL,
  question,
  proseAnswer,
  evidenceForModel,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 2400,
      input: [
        {
          role: "system",
          content: [
            "You are Emersus AI. The previous answer attempted to render a visual using unicode block characters or ASCII tables, which is forbidden.",
            "Your job now is to produce a REAL HTML + CSS widget that renders the same information as an actual iframe-rendered visual.",
            "Output rules:",
            "1. Write ONLY the widget. No explanatory prose, no preamble, no postamble.",
            "2. Wrap the widget in a ```widget fenced code block exactly as: ```widget\\n<div>...</div>\\n```.",
            "3. The widget HTML must be self-contained: HTML + inline <style> + (optional) inline <script>. Chart.js 4.4.1 is already pre-loaded in the iframe as the global `Chart` — call `new Chart(canvas, config)` directly, do NOT add your own <script src=\"...\"> for Chart.js. No other external libraries, no <link>, no @import, no <img src=\"http...\">.",
            "4. Use the Emersus design tokens: --color-background-primary, --color-background-secondary, --color-background-tertiary, --color-text-primary, --color-text-secondary, --color-text-tertiary, --color-border-tertiary, --border-radius-md (8px), --border-radius-lg (14px). Status surfaces: --color-background-success/warning/danger/info + --color-text-success/warning/danger/info. Accent hex allowed ONLY for data encoding: #1D9E75 (green/positive), #BA7517 (amber/caution), #A32D2D (red/negative).",
            "5. Prefer div-based grid/flex layouts over <table>. Tables wrap text per-character in narrow iframes. Use <div style=\"display:grid;grid-template-columns:...\"> instead.",
            "6. If the question asks for anything interactive (slider, calculator, dose-response, scenario), add a small vanilla-JS <script> that wires the inputs to the output. The iframe is sandboxed allow-scripts allow-same-origin — fetch/localStorage are blocked, but DOM manipulation and Chart.js work.",
            "7. Render numbers as real CSS bars or Chart.js canvases, not text characters. Example: <div style=\"width:72%;height:6px;background:#1D9E75;border-radius:3px\"></div>, not ▓▓▓▓▓▓▓░░░.",
            "8. Do NOT set font-family. The host document provides it. Use font-weight:500 for headings and numbers (matches the Emersus style).",
            "9. Numbers, labels, study names, and effect sizes must come from the prose answer or the retrieved evidence below. Do not fabricate.",
            "10. Clickable follow-up elements can call window.sendPrompt('follow-up question') to send a new chat message to the parent.",
            "Your entire response must start with ```widget and end with ```. Nothing else.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              question,
              prose_answer: proseAnswer,
              retrieved_evidence: evidenceForModel,
              required_output: "One ```widget fenced HTML block only. No other text.",
            },
            null,
            2
          ),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) return null;
  return payload;
}

function parseJsonFromText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function normalizeDiagramPlannerNodes(value) {
  const rawNodes = Array.isArray(value?.nodes) ? value.nodes : [];
  return rawNodes
    .map((node, index) => ({
      id: `node_${index + 1}`,
      label: normalizeText(node?.label, 46),
      detail: normalizeText(node?.detail, 118),
      tone: index === 0 ? "blue" : index === rawNodes.length - 1 ? "green" : "amber",
    }))
    .filter((node) => node.label && node.detail)
    .slice(0, 6);
}

async function callOpenAIDiagramPlanner({
  model = DEFAULT_MODEL,
  question,
  synthesis,
  evidenceForModel,
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 700,
      input: [
        {
          role: "system",
          content: [
            "You plan concise diagram nodes for an in-chat SVG flowchart.",
            "Return JSON only. Do not return markdown.",
            "Use the user's exact topic. Do not use generic labels like Input, Interpret, Transform, or Output unless the topic itself requires them.",
            "Prefer mechanism/process steps grounded in the answer and retrieved evidence.",
            "Each node must have a short label under 38 characters and a detail under 95 characters.",
            "Return 3 to 6 ordered nodes.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            answer_text: synthesis?.answer_text || synthesis?.summary || "",
            retrieved_evidence: evidenceForModel,
            output_shape: {
              nodes: [
                {
                  label: "short node title",
                  detail: "one sentence explanation",
                },
              ],
            },
          }),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    return [];
  }

  const parsed = parseJsonFromText(extractTextFromResponse(payload));
  return normalizeDiagramPlannerNodes(parsed);
}

function extractSectionBlock(text, label, nextLabels) {
  const normalized = String(text || "");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedNext = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?:^|\\n)(?:#+\\s*)?${escapedLabel}:?\\s*([\\s\\S]*?)(?=\\n(?:#+\\s*)?(?:${escapedNext.join("|")}):?|$)`,
    "i"
  );
  const match = normalized.match(pattern);
  return match ? match[1].trim() : "";
}

function parseBulletSection(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function sentenceSplit(text, maxItems = 4) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function extractGenericBullets(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

function extractPlainParagraphs(text) {
  return String(text || "")
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^[-*•]\s+/.test(line))
        .join(" ")
        .trim()
    )
    .filter(Boolean);
}

function looksLikeStructuredHtml(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/<style[\s>]/i.test(text)) return true;
  return /<(section|article|main|header|footer|div|table|h1|h2|h3|h4|p|ul|ol)\b/i.test(text);
}

function htmlToPlainText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<(br|\/p|\/div|\/section|\/article|\/header|\/footer|\/h[1-6]|\/tr|\/table|\/ul|\/ol)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\r?\n[ \t]+\r?\n/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Legacy cleanup: remove stray bare ``` / ~~~ fences from text segments.
// This intentionally DOES NOT touch ```widget / ```html / ```workout-plan
// fences — those are handled by splitSynthesisIntoSegments and must
// survive this function. If any structured fence is present in the
// input, we leave the string untouched; the caller (normalizeSynthesisPayload)
// only calls this on text segments after structured fences have already
// been extracted, but we still belt-and-suspender it here so a newly
// auto-wrapped workout-plan JSON block survives the cleanup pass.
function stripCodeFences(value) {
  const input = String(value || "");
  if (/```(?:widget|html|workout-plan)[ \t]*\r?\n?[\s\S]*?```/i.test(input)) {
    return input;
  }
  return input
    .replace(/^\uFEFF/, "")
    .replace(/^[\s\u200B-\u200D\uFEFF]*(?:```|~~~)\s*[a-zA-Z0-9_-]*\s*\n?/i, "")
    .replace(/\n?\s*(?:```|~~~)\s*$/i, "")
    .replace(/(?:```|~~~)\s*[a-zA-Z0-9_-]*\s*\n?/g, "")
    .replace(/```|~~~/g, "")
    .trim();
}

// Parse the raw model response into (text, widget, text, ...) segments so
// normalization runs on prose only and widget HTML passes through intact.
// A "widget fence" is ```widget, ```html, or a bare ``` fence whose body
// starts with "<" — matches the renderer's isWidgetFenceBody heuristic.
// Strip stray triple-backtick fence markers from a text segment. This is
// a safety net for cases where the model emits a malformed fence that the
// splitter couldn't parse (e.g. missing newline after the info tag, extra
// spaces, the closing fence was dropped by truncation). Without this, the
// markers leak into the chat as literal "```widget" / "```" prose.
function stripStrayFenceMarkers(text) {
  const input = String(text || "");
  // If any valid structured fence is present, do nothing. This prevents
  // the function from shredding a well-formed workout-plan fence that
  // we rescued via autoWrapBareWorkoutPlan. The caller already guards
  // on this, but we double-check so a direct call from anywhere else
  // can't destroy a real fence.
  if (/```(?:widget|html|workout-plan)[ \t]*\r?\n?[\s\S]*?```/i.test(input)) {
    return input;
  }
  return input
    // Opening fence on its own line or at end of a prose line.
    .replace(/(^|[ \t])```(?:widget|html|workout-plan)?[ \t]*(?:\r?\n|$)/gi, "$1")
    // Closing or lone bare fence on its own line.
    .replace(/(^|\n)[ \t]*```[ \t]*(?:\r?\n|$)/g, "$1\n")
    // Collapse leftover triple-newlines from the substitutions.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSynthesisIntoSegments(text) {
  const src = String(text || "");
  const segments = [];
  // Accept CR/LF, LF, or no newline at all after the info tag (some models
  // inline the opening fence with the body on the same line: "```widget<div>").
  const re = /```([\w-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(src)) !== null) {
    const [whole, info, body] = match;
    const tag = String(info || "").toLowerCase();
    const firstChar = String(body || "").trim().charAt(0);
    const isWidget = tag === "widget" || tag === "html" || (!tag && firstChar === "<");
    const isWorkoutPlan = tag === "workout-plan";
    if (!isWidget && !isWorkoutPlan) continue;
    if (match.index > cursor) {
      segments.push({ type: "text", content: src.slice(cursor, match.index) });
    }
    // "workout-plan" segments are a distinct passthrough type. They must
    // NOT go through stripCodeFences / autoWrapBareHtml / htmlToPlainText
    // — those would mutate the JSON. normalizeSynthesisPayload treats
    // workout-plan segments the same way it treats widgets: preserve
    // verbatim and re-fence on reassembly.
    segments.push({
      type: isWorkoutPlan ? "workout-plan" : "widget",
      content: body,
    });
    cursor = match.index + whole.length;
  }
  if (cursor < src.length) {
    segments.push({ type: "text", content: src.slice(cursor) });
  }
  return segments;
}

// Defensive auto-wrap: if a prose segment contains a bare JSON object that
// looks like a workout plan (has "schema_version" and "sessions" keys but
// no enclosing fence), wrap it in a ```workout-plan fence so the frontend
// renders a WorkoutPlanCard instead of letting the raw JSON leak into the
// chat bubble as prose. This is the #1 failure mode of a prompt-only
// capability — the model intermittently "forgets" to add the fence
// markers, especially after a long answer. Detection is intentionally
// strict: both markers must be present and the JSON must start at a
// paragraph boundary.
function autoWrapBareWorkoutPlan(proseText) {
  const text = String(proseText || "").replace(/\r\n/g, "\n");
  // Quick reject: only scan if both marker keys appear.
  if (!/"schema_version"\s*:\s*1/.test(text)) return text;
  if (!/"sessions"\s*:\s*\[/.test(text)) return text;

  // Find a bare JSON object that starts at a paragraph boundary and
  // begins with the schema_version marker within its first few fields.
  // We don't try to be a JSON parser — just balance curly braces until
  // the top-level object closes.
  const openRe = /(^|\n{2,})\s*(\{\s*"schema_version"\s*:\s*1)/;
  const openMatch = text.match(openRe);
  if (!openMatch) return text;
  const jsonStart = openMatch.index + openMatch[1].length + (openMatch[0].length - openMatch[1].length - openMatch[2].length);
  // Actually, compute the "{" index more robustly: find the first "{"
  // on/after the matched position.
  const braceStart = text.indexOf("{", openMatch.index + openMatch[1].length);
  if (braceStart < 0) return text;

  // Walk the text balancing braces, respecting string literals so a "}"
  // inside "load":"RPE 7" doesn't close the object prematurely.
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIndex = -1;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }
  if (endIndex < 0) return text; // unclosed — the truncation branch will handle it

  const before = text.slice(0, braceStart).replace(/\s+$/, "");
  const json = text.slice(braceStart, endIndex);
  const after = text.slice(endIndex).replace(/^\s+/, "");

  // Final sanity: verify the extracted JSON actually parses. If it doesn't,
  // leave the text alone — we'd rather show raw JSON than destroy real
  // prose that happened to match our markers.
  try {
    JSON.parse(json);
  } catch (_err) {
    return text;
  }

  const wrapped = `${before}\n\n\`\`\`workout-plan\n${json}\n\`\`\``;
  return after ? `${wrapped}\n\n${after}` : wrapped;
}

// Defensive auto-wrap: if a prose segment contains a contiguous block of
// structured HTML (starts with <div/<style/<section/etc.), wrap that block
// in a widget fence. This catches the common model failure mode where it
// emits raw HTML inline without the fence markers.
function autoWrapBareHtml(proseText) {
  // Normalize CRLF -> LF up front so the paragraph-boundary regex below
  // (\n{2,}) actually matches paragraph breaks emitted by models that use
  // Windows line endings. Without this, a CRLF answer like "consistency.\r\n
  // \r\n<div..." was leaking the entire HTML body as plain text because no
  // \n\n could ever match between the prose and the bare HTML block.
  const text = String(proseText || "").replace(/\r\n/g, "\n");
  // Find the first block-level HTML tag at a paragraph boundary.
  const openRe = /(^|\n{2,})\s*(<(?:style|div|section|article|header|footer|main|table|ul|ol|form|h[1-4])\b)/i;
  const openMatch = text.match(openRe);
  if (!openMatch) return text;
  const openIndex = openMatch.index + openMatch[1].length;
  // Grab everything from there to the end of the text — in practice the
  // widget is the tail of the answer because the model emits prose first,
  // then the HTML block. This is a heuristic, not a parser.
  const before = text.slice(0, openIndex).replace(/\s+$/, "");
  const htmlBody = text.slice(openIndex).trim();
  if (!htmlBody) return text;
  // Sanity check: if the body has a closing tag matching the opening, or a
  // closing </div>, </section>, etc., treat it as a widget candidate.
  if (!/<\/(?:style|div|section|article|header|footer|main|table|ul|ol|form|h[1-4])\s*>/i.test(htmlBody)) {
    return text;
  }
  return `${before}\n\n\`\`\`widget\n${htmlBody}\n\`\`\``;
}

// Server-side safety net: even with clear instructions the model sometimes
// appends a trailing "Sources:" / "References:" section, a numbered bib,
// or inline bracketed citations like "[1]" or "(Smith 2023)". The sources
// rail is the single place sources should appear, so we strip any leaked
// list here before the chat bubble renders. Intentionally conservative —
// only strips obvious bibliography patterns, never prose that happens to
// mention a study.
function stripLeakedSourceSections(prose) {
  if (!prose) return prose;
  let out = String(prose);

  // 1. Drop everything from a trailing "Sources:" / "References:" /
  //    "Citations:" / "Bibliography:" heading to the end of the text.
  //    Require it to be at the start of a line so we don't chop mid-sentence.
  out = out.replace(
    /\n+\s*(?:\*\*|#{1,3}\s*)?\s*(?:Sources|References|Citations|Bibliography|Further reading)\s*:?\s*(?:\*\*)?\s*\n[\s\S]*$/i,
    ""
  );

  // 2. Strip bracketed numeric inline citations: "[1]", "[2, 3]", "[1,2,3]".
  //    Keep the surrounding prose intact.
  out = out.replace(/\s*\[\d+(?:\s*[-,]\s*\d+)*\]/g, "");

  // 3. Drop standalone "Source N:" prefix lines the model sometimes emits
  //    as little breadcrumbs between paragraphs.
  out = out.replace(/^\s*Source\s*\d+\s*:.*$/gim, "");

  // 4. Collapse the extra blank lines those strips may have left behind.
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

function normalizeSynthesisPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw new Error("The model response was empty.");
  }

  // Extract widget / workout-plan fences first so stripCodeFences /
  // htmlToPlainText never touch them. Prose segments go through the
  // legacy cleanup path; widget and workout-plan segments pass through
  // untouched and get re-fenced on reassembly.
  const segments = splitSynthesisIntoSegments(raw);
  const cleanedSegments = segments.map((segment) => {
    if (segment.type === "widget" || segment.type === "workout-plan") return segment;
    let prose = segment.content;
    // Rescue any bare workout-plan JSON the model emitted without the
    // fence markers — this is the #1 failure mode of a prompt-only
    // capability. stripCodeFences would otherwise delete any fence
    // markers we'd add later, so wrap first. After re-assembly, the
    // final splitSynthesisIntoSegments pass will pick up the injected
    // fence and promote it to a workout-plan segment. Common failure
    // pattern: "Intro prose.\n\n{\"schema_version\":1,...}".
    prose = autoWrapBareWorkoutPlan(prose);
    prose = stripCodeFences(prose);
    // Only collapse HTML to plain text for prose that *wasn't* already a
    // fenced widget (the fenced ones are preserved above). This is the
    // legacy fallback for when the model emits a stray HTML fragment
    // without a fence — we first try to recover it as a widget.
    prose = autoWrapBareHtml(prose);
    // Safety net: strip any leftover "```widget" / "```html" / stand-alone
    // "```" markers that a malformed fence might have left behind. Do this
    // AFTER autoWrapBareHtml / autoWrapBareWorkoutPlan so we don't
    // accidentally destroy a fence we just added. The guard must cover
    // workout-plan fences too — without the workout-plan branch here,
    // stripStrayFenceMarkers would delete the closing ``` of a plan we
    // just rescued with autoWrapBareWorkoutPlan.
    if (!/```(?:widget|html|workout-plan)?[ \t]*\r?\n?[\s\S]*?```/i.test(prose)) {
      prose = stripStrayFenceMarkers(prose);
    }
    // Strip any trailing "Sources:" / "References:" section the model
    // appended despite the instruction. The sources panel owns that
    // surface now.
    prose = stripLeakedSourceSections(prose);
    return { type: "text", content: prose };
  });

  // Re-extract widget / workout-plan fences AFTER auto-wrap so any
  // HTML or bare plan JSON we just wrapped is also preserved. Segments
  // marked _needsResplit (the bare-JSON → auto-wrapped path) need to be
  // re-segmented so the newly-injected workout-plan fence becomes its
  // own segment instead of sitting inside a text blob.
  const reassembledRaw = cleanedSegments
    .map((s) => {
      if (s.type === "widget") return `\`\`\`widget\n${s.content}\n\`\`\``;
      if (s.type === "workout-plan") return `\`\`\`workout-plan\n${s.content}\n\`\`\``;
      return s.content;
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const finalSegments = splitSynthesisIntoSegments(reassembledRaw);

  // Build the prose-only view for summary/bullets/paragraphs extraction.
  // Widgets AND workout-plan segments are replaced with a blank line so
  // paragraph splitting still works correctly. If workout-plan JSON
  // bled into this view the "summary" field of the response would be
  // a truncated blob of JSON characters.
  const proseOnly = finalSegments
    .map((s) => (s.type === "widget" || s.type === "workout-plan" ? "" : s.content))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const proseForLegacy = looksLikeStructuredHtml(proseOnly)
    ? htmlToPlainText(proseOnly)
    : proseOnly;

  const normalizedText = normalizeText(proseForLegacy || proseOnly, 2400);
  const paragraphs = extractPlainParagraphs(proseForLegacy || proseOnly);
  const genericBullets = extractGenericBullets(proseForLegacy || proseOnly);
  const fallbackSummary = paragraphs[0] || normalizedText;

  if (!reassembledRaw) {
    throw new Error("The model response was empty.");
  }

  return {
    summary: normalizeText(fallbackSummary, 1600),
    // answer_text carries the FULL reassembled text including widget fences
    // so the client-side renderer can segment it into bubbles + iframes.
    answer_text: reassembledRaw,
    recommendations: {
      general: normalizeList(genericBullets, 8, 240),
    },
    limitations: [],
  };
}

function sanitizeDiagramNodes(nodes) {
  const cleaned = (Array.isArray(nodes) ? nodes : [])
    .map((node, index) => ({
      id: normalizeText(node?.id || `node_${index + 1}`, 28) || `node_${index + 1}`,
      label: normalizeText(node?.label, 46),
      detail: normalizeText(node?.detail, 100),
      tone: normalizeText(node?.tone, 16) || (index === 0 ? "blue" : "amber"),
    }))
    .filter((node) => node.label && node.detail);

  const unique = [];
  const seen = new Set();
  for (const node of cleaned) {
    const key = `${node.label.toLowerCase()}|${node.detail.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(node);
  }

  return unique.slice(0, 6).map((node, index, array) => ({
    ...node,
    id: `node_${index + 1}`,
    tone: index === 0 ? "blue" : index === array.length - 1 ? "green" : node.tone || "amber",
  }));
}

function dedupeVisualFacts(facts, maxItems = 6) {
  const ranked = (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact && typeof fact === "object")
    .map((fact) => ({
      ...fact,
      display_value: normalizeText(fact.display_value || fact.value, 24),
      label: normalizeText(fact.label, 72),
      detail: normalizeText(fact.detail || fact.context || "", 110),
      context: normalizeText(fact.context || fact.detail || "", 180),
      source_title: normalizeText(fact.source_title || "", 140),
    }))
    .filter((fact) => fact.display_value && fact.label);

  const unique = [];
  const seen = new Set();
  for (const fact of ranked) {
    const compactLabel = fact.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${fact.display_value.toLowerCase()}|${compactLabel}|${fact.source_title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
    if (unique.length >= maxItems) break;
  }
  return unique;
}

function computeConfidence({ plan, evidence }) {
  const sources = evidence.slice(0, 5);
  const totalSources = sources.length;
  const recentSourceCount = sources.filter(
    (source) => scoreEvidenceFreshness(source.published_at) >= 0.82
  ).length;
  const highQualitySourceCount = sources.filter(
    (source) =>
      scoreEvidenceQuality(source.evidence_level, source.source_type) >= 0.84
  ).length;
  const recencySupport = totalSources ? recentSourceCount / totalSources : 0;
  const qualitySupport = totalSources ? highQualitySourceCount / totalSources : 0;
  const coverageSupport = Math.min(totalSources / 4, 1);
  const riskPenalty = plan.riskLevel === "medium" ? 0.08 : 0;

  const score = clamp(
    0.2 + recencySupport * 0.35 + qualitySupport * 0.3 + coverageSupport * 0.2 - riskPenalty,
    0.18,
    0.95
  );

  return {
    score: Number(score.toFixed(2)),
    label: score >= 0.75 ? "high" : score >= 0.5 ? "moderate" : "low",
    rationale:
      score >= 0.75
        ? "The top retrieved studies are recent, relevant, and relatively strong."
        : score >= 0.5
          ? "The recommendation has useful support, but evidence quality, recency, or personalization is mixed."
          : "The retrieved support is limited or only partially matched to the question.",
  };
}

function buildFallbackRecommendation({ question, evidence }) {
  const topEvidence = evidence.slice(0, 2);
  const titles = topEvidence.map((item) => item.title).filter(Boolean);
  const fallbackBullets = topEvidence[0]?.title
    ? [`Use the evidence around "${topEvidence[0].title}" as the main anchor for your next decision.`]
    : ["Ask a more specific follow-up so I can give a tighter evidence-backed answer."];
  const summary = titles.length
    ? `I couldn't complete the normal synthesis step, but the strongest retrieved evidence included ${titles.join(" and ")}.`
    : "I couldn't complete the normal synthesis step, so this answer is based only on the retrieved evidence.";

  return {
    summary,
    answer_text: [summary, ...fallbackBullets.map((item) => `- ${item}`)].join("\n\n"),
    recommendations: {
      general: fallbackBullets,
    },
    limitations: [],
  };
}

function determineRecencyLabel(source) {
  const freshness = Number(source?.freshness_score ?? scoreEvidenceFreshness(source?.published_at));

  if (freshness >= 0.9) {
    return "Very recent";
  }

  if (freshness >= 0.75) {
    return "Recent evidence";
  }

  return "Mixed recency";
}

function determineEvidenceLabel(source) {
  const publicationType = normalizeText(
    source?.publication_type ||
      (Array.isArray(source?.publication_types)
        ? source.publication_types.join(", ")
        : source?.evidence_level),
    80
  );

  if (/systematic|meta|guideline|consensus|review/i.test(publicationType)) {
    return "Review-level evidence";
  }

  if (/trial|rct/i.test(publicationType)) {
    return "Trial evidence";
  }

  if (publicationType) {
    return publicationType;
  }

  return "Database evidence";
}

function summarizeEffect(summary) {
  const text = normalizeText(summary, 180).toLowerCase();

  if (/modest|small but meaningful/.test(text)) {
    return "Modest but real";
  }

  if (/effective|consisten|reliable|strong support/.test(text)) {
    return "Reliable edge";
  }

  if (/mixed|uncertain|limited/.test(text)) {
    return "Mixed support";
  }

  return "Evidence-backed";
}

function buildActionColumns({ recommendations, topic }) {
  const columns = [];
  const label = topic === "mental_performance" ? "Mental performance" : "Key takeaways";

  if (recommendations.general?.length) {
    columns.push({
      label,
      tone: "good",
      items: recommendations.general.slice(0, 3),
    });
  }

  return columns.slice(0, 3);
}

const VISUAL_ARTIFACT_TYPES = new Set([
  "diagram",
  "chart",
  "mockup",
  "interactive_explainer",
  "art_illustration",
]);

function wantsVisualCards(question) {
  return /\b(card|cards|visual|visuals|graphic|graphics|graph|chart|diagram|flowchart|mockup|wireframe|dashboard|widget|interactive|calculator|simulation|illustration|art|svg|show me)\b/i.test(
    String(question || "")
  );
}

function inferVisualArtifactType(question, answerText = "") {
  const text = `${question || ""} ${answerText || ""}`.toLowerCase();
  const questionText = String(question || "").toLowerCase();

  if (/\b(mockup|wireframe|ui|interface|screen|modal|form|app screen|profile card|landing page|dashboard layout)\b/.test(questionText)) {
    return "mockup";
  }

  if (/\b(interactive|calculator|simulate|simulation|slider|toggle|scenario explorer|step[-\s]?through|widget)\b/.test(questionText)) {
    return "interactive_explainer";
  }

  if (/\b(illustration|art|svg|geometric|abstract|landscape|decorative|visual metaphor)\b/.test(questionText)) {
    return "art_illustration";
  }

  if (/\b(diagram|flowchart|architecture|lifecycle|journey map|relationship map|process map|how it works|explain how|pipeline)\b/.test(questionText)) {
    return "diagram";
  }

  if (/\b(chart|graph|plot|bar|line|pie|donut|scatter|bubble|trend|compare|comparison|market size|cagr|growth|funding|revenue|percentage|percent|metrics?|data)\b/.test(text)) {
    return "chart";
  }

  return null;
}

function inferDashboardTitle(question) {
  const text = normalizeText(question, 180);
  if (/market|investor|funding|vc|venture|business|startup/i.test(text)) {
    return "Market and investor viability";
  }
  if (/compare|versus|\bvs\b/i.test(text)) {
    return "Comparison dashboard";
  }
  if (/roadmap|plan|strategy/i.test(text)) {
    return "Strategy dashboard";
  }
  return text ? `${text.replace(/[?.!]+$/, "")} dashboard` : "Generated dashboard";
}

function inferVisualTitle(question, artifactType) {
  const promptTitle = normalizeText(question, 120).replace(/[?.!]+$/, "");
  if (!promptTitle) {
    return titleCase(artifactType || "visual artifact");
  }

  if (/market|investor|funding|vc|venture|business|startup/i.test(promptTitle)) {
    return "Market and investor viability";
  }

  if (artifactType === "diagram") return `${promptTitle} flow`;
  if (artifactType === "chart") return `${promptTitle} data view`;
  if (artifactType === "mockup") return `${promptTitle} mockup`;
  if (artifactType === "interactive_explainer") return `${promptTitle} explorer`;
  if (artifactType === "art_illustration") return `${promptTitle} illustration`;

  return promptTitle;
}

function labelMetricFromContext(context, fallbackLabel) {
  const text = String(context || "").toLowerCase();
  if (/market|tam|size|segment/.test(text)) return "Market size";
  if (/cagr|growth|growing|projected|reach/.test(text)) return "Growth rate";
  if (/funding|raised|vc|venture|capital/.test(text)) return "Funding signal";
  if (/investor|support|backing|valuation/.test(text)) return "Investor signal";
  if (/share|percent|captured/.test(text)) return "Share";
  if (/valuation/.test(text)) return "Valuation";
  return fallbackLabel;
}

function inferUnitType(value, context = "") {
  const token = String(value || "").toLowerCase();
  const nearby = String(context || "").toLowerCase();
  if (token.includes("$")) return "currency";
  if (token.includes("%") || /cagr|share|percent/.test(nearby)) return "percent";
  if (/\d+(?:\.\d+)?\s?x/i.test(token)) return "multiple";
  if (/\b(19|20)\d{2}\b/.test(token)) return "year";
  if (/users?|customers?|people|participants|studies|companies/.test(nearby)) return "count";
  return "number";
}

function normalizeMetricValue(value) {
  return normalizeText(value, 28)
    .replace(/\s+/g, "")
    .replace(/billion/i, "B")
    .replace(/million/i, "M")
    .replace(/bn/i, "B")
    .replace(/m\b/i, "M");
}

function extractDashboardMetrics(text, maxItems = 6, source = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const pattern = /(?:[$]\s?\d+(?:\.\d+)?\s?(?:billion|million|bn|m|b)?|\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?x|\b(?:19|20)\d{2}\b)/gi;
  const metrics = [];
  const seen = new Set();
  let match;

  while ((match = pattern.exec(normalized)) && metrics.length < maxItems) {
    const value = normalizeMetricValue(match[0]);
    if (seen.has(value.toLowerCase())) {
      continue;
    }
    seen.add(value.toLowerCase());
    const start = Math.max(0, match.index - 95);
    const end = Math.min(normalized.length, match.index + match[0].length + 120);
    const context = normalized.slice(start, end);
    const unitType = inferUnitType(value, context);
    metrics.push({
      label: labelMetricFromContext(context, `Metric ${metrics.length + 1}`),
      value,
      display_value: value,
      unit_type: unitType,
      detail: trimSentence(context.replace(match[0], ""), 72),
      context: trimSentence(context, 180),
      source_id: source.source_id || source.pmid || source.doi || "",
      source_title: source.source_title || source.title || "",
      relevance_score: Number(source.relevance_score ?? 0.6),
      confidence: Number(source.confidence ?? 0.58),
      derived_from: source.derived_from || "answer",
      tone: metrics.length === 0 ? "good" : metrics.length === 1 ? "medium" : "strong",
    });
  }

  return metrics;
}

function trimSentence(value, maxLength = 120) {
  return normalizeText(String(value || "").replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, ""), maxLength);
}

function buildDashboardPanels(text) {
  const sentences = splitSentences(text).slice(0, 4);
  const labels = ["Market signal", "Investor signal", "Differentiation", "Risk / nuance"];
  return sentences.map((sentence, index) => ({
    label: labels[index] || `Signal ${index + 1}`,
    body: normalizeText(sentence, 180),
    tone: index === 0 ? "good" : index === 3 ? "caution" : "medium",
  }));
}

function extractChartFacts({ question, synthesis, evidence = [] }) {
  const facts = [];
  const seen = new Set();

  for (const source of evidence.slice(0, VECTOR_LIMIT)) {
    const sourceText = [source.chunk_text, source.excerpt, source.summary, source.why_it_matters]
      .filter(Boolean)
      .join(" ");
    for (const metric of extractDashboardMetrics(sourceText, 3, {
      source_id: source.pmid ? `PMID ${source.pmid}` : source.doi || "",
      source_title: source.title,
      relevance_score: Number(source.ranking_score || source.database_score || 0.68),
      confidence: 0.78,
      derived_from: "source",
    })) {
      const key = `${metric.label}:${metric.value}:${metric.source_title}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.push(metric);
      }
    }
  }

  for (const metric of extractDashboardMetrics(`${synthesis.answer_text || ""} ${synthesis.summary || ""}`, 6, {
    relevance_score: 0.58,
    confidence: 0.54,
    derived_from: "answer",
  })) {
    const key = `${metric.label}:${metric.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(metric);
    }
  }

  return facts.slice(0, 8);
}

function chooseChartTemplate(facts, question = "") {
  const prompt = String(question || "").toLowerCase();
  if (/\b(scatter|bubble)\b/.test(prompt)) return "scatter";
  if (/\b(pie|donut|proportion|share|part[-\s]?to[-\s]?whole)\b/.test(prompt)) return "proportion";
  if (/\b(line|timeline|trend|over time|by year|progression)\b/.test(prompt)) return "timeline";
  if (/\b(range|min|max|minimum|maximum|protocol)\b/.test(prompt)) return "range";

  const unitTypes = facts.map((fact) => fact.unit_type).filter(Boolean);
  const uniqueUnits = unitTypes.filter((unit, index) => unitTypes.indexOf(unit) === index);
  if (facts.length >= 3 && uniqueUnits.length === 1 && uniqueUnits[0] === "year") return "timeline";
  if (facts.length >= 2 && uniqueUnits.length === 1 && uniqueUnits[0] === "percent") return "bar";
  if (facts.length >= 2 && uniqueUnits.length === 1 && uniqueUnits[0] === "currency") return "bar";
  if (facts.length >= 2 && unitTypes.includes("percent")) return "proportion";
  if (facts.length >= 3) return "bar";
  return "metric_grid";
}

function buildChartArtifact({ question, synthesis, evidence, includeDebug = false }) {
  const facts = extractChartFacts({ question, synthesis, evidence });
  const highConfidenceFacts = dedupeVisualFacts(
    facts.filter((fact) => Number(fact.confidence || 0) >= 0.5),
    6
  );

  if (highConfidenceFacts.length < 2) {
    return {
      card: null,
      debug: { generated: false, artifact_type: "chart", reason: "insufficient_quantitative_facts", fact_count: highConfidenceFacts.length },
    };
  }

  const chartType = chooseChartTemplate(highConfidenceFacts, question);
  const sources = highConfidenceFacts
    .filter((fact) => fact.source_title)
    .map((fact) => ({ title: fact.source_title, id: fact.source_id }))
    .filter((source, index, array) => array.findIndex((item) => item.title === source.title) === index)
    .slice(0, 3);

  return {
    card: {
      type: "visual_artifact",
      artifact_type: "chart",
      title: inferVisualTitle(question, "chart"),
      subtitle: chartType === "metric_grid" ? "Key quantitative signals" : `${titleCase(chartType)} visualization`,
      body: normalizeText(synthesis.summary || synthesis.answer_text, 260),
      data: {
        chart_type: chartType,
        facts: highConfidenceFacts.slice(0, 6),
      },
      sources,
      debug: includeDebug
        ? { generated: true, artifact_type: "chart", planner_reason: "quantitative visual request", fact_count: highConfidenceFacts.length, chart_type: chartType }
        : undefined,
    },
    debug: { generated: true, artifact_type: "chart", reason: "quantitative_facts_found", fact_count: highConfidenceFacts.length, chart_type: chartType },
  };
}

function buildDiagramFallbackNodes(question) {
  const prompt = normalizeText(question, 260).toLowerCase();

  if (/emersus/.test(prompt) && /evidence/.test(prompt) && /coaching/.test(prompt)) {
    return [
      {
        label: "Retrieve evidence",
        detail: "Find relevant PubMed and PMC material for the user's question.",
      },
      {
        label: "Rank and filter",
        detail: "Keep the strongest, most relevant studies and remove weak matches.",
      },
      {
        label: "Synthesize answer",
        detail: "Turn the evidence into a clear recommendation with limits and confidence.",
      },
      {
        label: "Personalize coaching",
        detail: "Adapt the recommendation to the user's goal, profile, and context.",
      },
      {
        label: "Show next action",
        detail: "Present practical coaching steps the user can follow or refine.",
      },
    ];
  }

  const worksMatch = prompt.match(/(?:how|show me).*?\b([a-z][a-z0-9\s-]{2,80}?)\s+works?\b/i);
  if (worksMatch) {
    const subject = normalizeText(
      worksMatch[1]
        .replace(/\b(a|an|the|diagram|flow|of|how|show|me)\b/gi, " ")
        .replace(/\s+/g, " "),
      52
    );
    const label = subject ? titleCase(subject) : "The topic";
    return [
      { label: label, detail: "Start with the main input, system, or compound the user asked about." },
      { label: "Entry point", detail: "Show where it enters the relevant body system, workflow, or environment." },
      { label: "Core mechanism", detail: "Identify the central process that creates the effect." },
      { label: "Downstream effect", detail: "Connect the mechanism to the outcome the user cares about." },
      { label: "Practical result", detail: "End with the observable benefit, limitation, or next decision." },
    ];
  }

  const flowMatch = prompt.match(/(?:how|show me).*?(?:turns?|goes?|converts?|from)\s+(.+?)\s+(?:into|to)\s+(.+?)(?:$|[?.!])/i);
  if (flowMatch) {
    const start = normalizeText(flowMatch[1], 52);
    const end = normalizeText(flowMatch[2], 52);
    return [
      { label: titleCase(start), detail: "Start with the input or source material." },
      { label: "Process", detail: "Filter, organize, and interpret the relevant information." },
      { label: "Decision layer", detail: "Choose the most useful conclusion or path forward." },
      { label: titleCase(end), detail: "Deliver the final output in a usable form." },
    ];
  }

  return [
    { label: "Input", detail: "Start with the user's request or source material." },
    { label: "Interpret", detail: "Identify the important entities, steps, and relationships." },
    { label: "Transform", detail: "Organize the material into a clear sequence." },
    { label: "Output", detail: "Return a useful answer or artifact." },
  ];
}

function shouldUseDiagramFallback(question) {
  const prompt = normalizeText(question, 260).toLowerCase();
  return (
    (/emersus/.test(prompt) && /evidence/.test(prompt) && /coaching/.test(prompt)) ||
    /(?:how|show me).*?\b[a-z][a-z0-9\s-]{2,80}?\s+works?\b/i.test(prompt)
  );
}

function buildDiagramArtifact({ question, synthesis, includeDebug = false }) {
  const usePromptFallback = shouldUseDiagramFallback(question);
  const sentences = splitSentences(synthesis.answer_text || synthesis.summary).slice(0, 5);
  const sourceNodes =
    !usePromptFallback && sentences.length >= 2
      ? sentences.map((sentence) => ({
          label: normalizeText(sentence.split(/[:;,.]/)[0] || "Step", 46),
          detail: normalizeText(sentence, 100),
        }))
      : buildDiagramFallbackNodes(question);
  const nodes = sanitizeDiagramNodes(
    sourceNodes.map((node, index) => ({
      id: `node_${index + 1}`,
      label: normalizeText(node.label || `Step ${index + 1}`, 46),
      detail: normalizeText(node.detail || "", 100),
      tone: index === 0 ? "blue" : index === sourceNodes.length - 1 ? "green" : "amber",
    }))
  );

  if (nodes.length < 2) {
    return { card: null, debug: { generated: false, artifact_type: "diagram", reason: "insufficient_diagram_nodes", node_count: nodes.length } };
  }

  return {
    card: {
      type: "visual_artifact",
      artifact_type: "diagram",
      title: inferVisualTitle(question, "diagram"),
      subtitle: "Flow / relationship diagram",
      body: normalizeText(synthesis.summary || synthesis.answer_text, 220),
      data: {
        layout: "vertical_flow",
        direction: "top_to_bottom",
        nodes,
        edges: nodes.slice(1).map((node, index) => ({
          from: nodes[index].id,
          to: node.id,
          label: index === 0 ? "then" : "",
        })),
      },
      debug: includeDebug ? { generated: true, artifact_type: "diagram", planner_reason: "process or relationship visual request", node_count: nodes.length } : undefined,
    },
    debug: { generated: true, artifact_type: "diagram", reason: "diagram_nodes_found", node_count: nodes.length },
  };
}

function withDiagramNodes(card, nodes) {
  const cleanedNodes = sanitizeDiagramNodes(nodes);
  if (!card || card.artifact_type !== "diagram" || cleanedNodes.length < 2) {
    return card;
  }

  return {
    ...card,
    data: {
      ...(card.data || {}),
      nodes: cleanedNodes,
      edges: cleanedNodes.slice(1).map((node, index) => ({
        from: cleanedNodes[index].id,
        to: node.id,
        label: index === 0 ? "then" : "",
      })),
    },
    debug: card.debug
      ? {
          ...card.debug,
          planner_reason: "dynamic diagram planner",
          node_count: nodes.length,
        }
      : card.debug,
  };
}

function buildMockupArtifact({ question, synthesis, includeDebug = false }) {
  const sentences = splitSentences(synthesis.answer_text || synthesis.summary);
  const sections = (sentences.length ? sentences : [
    "Primary insight card",
    "Recommended next action",
    "Progress and context panel",
  ]).slice(0, 4).map((sentence, index) => ({
    title: index === 0 ? "Hero card" : index === 1 ? "Action panel" : index === 2 ? "Context panel" : "Detail panel",
    body: normalizeText(sentence, 120),
    action: index === 0 ? "Open detail" : index === 1 ? "Apply" : "Review",
  }));

  return {
    card: {
      type: "visual_artifact",
      artifact_type: "mockup",
      title: inferVisualTitle(question, "mockup"),
      subtitle: "Static UI mockup",
      body: normalizeText(synthesis.summary || synthesis.answer_text, 220),
      data: {
        layout_type: /modal/i.test(question) ? "modal" : /form/i.test(question) ? "form" : /dashboard/i.test(question) ? "dashboard" : "card",
        sections,
        actions: sections.map((section) => section.action).slice(0, 3),
      },
      debug: includeDebug ? { generated: true, artifact_type: "mockup", planner_reason: "interface visual request", section_count: sections.length } : undefined,
    },
    debug: { generated: true, artifact_type: "mockup", reason: "ui_intent_found", section_count: sections.length },
  };
}

function buildInteractiveArtifact({ question, synthesis, includeDebug = false }) {
  const lower = String(question || "").toLowerCase();
  const isInterest = /interest|compound|invest|return|balance/.test(lower);
  const controls = isInterest
    ? [
        { id: "principal", label: "Principal", type: "range", min: 1000, max: 50000, step: 500, value: 10000, unit: "$" },
        { id: "rate", label: "Annual rate", type: "range", min: 1, max: 15, step: 0.5, value: 7, unit: "%" },
        { id: "years", label: "Years", type: "range", min: 1, max: 40, step: 1, value: 20, unit: "yrs" },
      ]
    : [
        { id: "baseline", label: "Baseline", type: "range", min: 1, max: 10, step: 1, value: 5, unit: "" },
        { id: "intensity", label: "Intensity", type: "range", min: 1, max: 10, step: 1, value: 7, unit: "" },
        { id: "duration", label: "Duration", type: "range", min: 1, max: 12, step: 1, value: 6, unit: "wks" },
      ];

  return {
    card: {
      type: "visual_artifact",
      artifact_type: "interactive_explainer",
      title: inferVisualTitle(question, "interactive_explainer"),
      subtitle: isInterest ? "Compound calculator" : "Scenario explorer",
      body: normalizeText(synthesis.summary || synthesis.answer_text, 220),
      data: {
        model: isInterest ? "compound_interest" : "scenario_score",
        controls,
        outputs: isInterest
          ? ["Final balance", "Total interest earned"]
          : ["Estimated impact", "Scenario confidence"],
        assumptions: isInterest
          ? ["Annual compounding", "No additional contributions", "Illustrative only"]
          : ["Illustrative scenario", "Linear approximation", "Not a medical prediction"],
      },
      debug: includeDebug ? { generated: true, artifact_type: "interactive_explainer", planner_reason: "interactive or calculator request", control_count: controls.length } : undefined,
    },
    debug: { generated: true, artifact_type: "interactive_explainer", reason: "interactive_intent_found", control_count: controls.length },
  };
}

function buildArtArtifact({ question, synthesis, includeDebug = false }) {
  const lower = String(question || "").toLowerCase();
  const scene = /landscape|mountain|night|moon/.test(lower) ? "landscape" : /geometric|pattern/.test(lower) ? "geometric" : "abstract";
  return {
    card: {
      type: "visual_artifact",
      artifact_type: "art_illustration",
      title: inferVisualTitle(question, "art_illustration"),
      subtitle: "Decorative SVG illustration",
      body: normalizeText(synthesis.summary || synthesis.answer_text, 180),
      data: {
        scene,
        palette: scene === "landscape" ? ["#0b1726", "#18365f", "#d8cf7a", "#10261a"] : ["#11110f", "#d8b46a", "#85adff", "#9ffb00"],
        primitives: scene === "geometric" ? ["rings", "grid", "orbits"] : scene === "landscape" ? ["moon", "mountains", "lake", "stars"] : ["blobs", "paths", "dots"],
        decorative: true,
      },
      debug: includeDebug ? { generated: true, artifact_type: "art_illustration", planner_reason: "decorative or conceptual visual request", scene } : undefined,
    },
    debug: { generated: true, artifact_type: "art_illustration", reason: "illustration_intent_found", scene },
  };
}

function buildVisualArtifactPlan({ question, synthesis, evidence = [], includeDebug = false }) {
  if (!wantsVisualCards(question)) {
    return { card: null, debug: { generated: false, reason: "no_visual_intent" } };
  }

  const answerText = `${synthesis.answer_text || ""} ${synthesis.summary || ""}`;
  const artifactType = inferVisualArtifactType(question, answerText);

  if (!VISUAL_ARTIFACT_TYPES.has(artifactType)) {
    return { card: null, debug: { generated: false, reason: "unsupported_or_unclear_visual_family", artifact_type: artifactType || "" } };
  }

  if (artifactType === "diagram") return buildDiagramArtifact({ question, synthesis, includeDebug });
  if (artifactType === "chart") return buildChartArtifact({ question, synthesis, evidence, includeDebug });
  if (artifactType === "mockup") return buildMockupArtifact({ question, synthesis, includeDebug });
  if (artifactType === "interactive_explainer") return buildInteractiveArtifact({ question, synthesis, includeDebug });
  if (artifactType === "art_illustration") return buildArtArtifact({ question, synthesis, includeDebug });

  return { card: null, debug: { generated: false, reason: "visual_family_not_implemented", artifact_type: artifactType } };
}

function buildCards({ question, synthesis, evidence = [], includeDebug = false, plan = null, confidence = null, sources = [], quantFindings = [] }) {
  const cards = [];

  // Visual artifacts now flow inline through ```widget``` fences in answer_text;
  // no JSON visual_artifact card is built here anymore. When the model DID
  // emit a widget, the widget is the primary visual output and the legacy
  // action_grid / watchouts cards become redundant noise — suppress them so
  // the widget speaks for itself. Metric grid is kept because it's a narrow
  // sidebar of extracted numbers that rarely overlaps with a widget body.
  const answerText = String(synthesis?.answer_text || synthesis?.summary || "");
  const hasInlineWidget = /```(?:widget|html)?\s*\n\s*</i.test(answerText);

  if (!synthesis) {
    return cards;
  }

  const conf = confidence || { score: 0.6, label: "moderate", rationale: "" };
  const topSource = sources[0] || evidence[0] || null;
  const recentSourceCount = sources.filter((s) => Number(s.freshness_score || 0) >= 0.82).length;
  const highQualitySourceCount = sources.filter((s) => Number(s.quality_score || 0) >= 0.84).length;
  const recencyScore = sources.length ? recentSourceCount / sources.length : 0.4;
  const qualityScore = sources.length ? highQualitySourceCount / sources.length : 0.55;
  const consistencyScore = clamp(Number(conf.score || 0) * 0.92 + qualityScore * 0.18, 0, 1);
  const personalizationScore = clamp(
    (plan?.topic === "mental_performance" && synthesis.recommendations?.mental_performance?.length ? 0.74 : 0.62) -
      (plan?.riskLevel === "medium" ? 0.08 : 0),
    0.35,
    0.9
  );
  const effectLabel = summarizeEffect(synthesis.summary);

  // Skip the structured deck entirely if confidence is too low or evidence is too thin.
  const enoughEvidence = sources.length >= 2 && Number(conf.score || 0) >= 0.6;
  if (!enoughEvidence) {
    return cards;
  }

  // 2. Metric grid — quantitative findings extracted from the evidence chunks.
  const metricGrid = buildMetricGridCard({ findings: quantFindings });
  if (metricGrid) {
    cards.push(metricGrid);
  }

  if (hasInlineWidget) {
    // The widget IS the "what to do" / "watchouts" visual — do not add the
    // legacy generic cards on top of it.
    return cards;
  }

  // 4. Action grid (Do / Dose / When).
  const actionColumns = buildActionColumns({
    recommendations: synthesis.recommendations,
    topic: plan?.topic,
  });
  if (actionColumns.length) {
    cards.push({ type: "action_grid", title: "What to do", columns: actionColumns });
  }

  // 5. Watchouts.
  if (Array.isArray(synthesis.limitations) && synthesis.limitations.length) {
    cards.push({
      type: "watchouts",
      title: "Watchouts",
      tone: Number(conf.score || 0) >= 0.75 ? "medium" : "caution",
      items: synthesis.limitations.slice(0, 4),
    });
  }

  return cards;
}

function buildMetricGridCard({ findings }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return null;
  }

  const tiles = findings.slice(0, 4).map((finding) => {
    const tone =
      finding.unitType === "percent" || finding.unitType === "mass"
        ? "positive"
        : finding.unitType === "duration" || finding.unitType === "dose"
        ? "neutral"
        : "info";
    const subParts = [finding.detail, finding.sourceId].filter(Boolean);
    return {
      value: finding.displayValue,
      label: finding.label || "Reported finding",
      sub: subParts.join(" - "),
      tone,
      sentence: finding.sentence || "",
      sourceTitle: finding.sourceTitle || "",
      sourceId: finding.sourceId || "",
    };
  });

  return {
    type: "metric_grid",
    title: "Quantitative findings",
    eyebrow: "Extracted from retrieved evidence",
    metrics: tiles,
  };
}

function normalizeSources(evidence) {
  return evidence.slice(0, 6).map((source) => ({
    title: source.title,
    url: source.url || "",
    source_type: source.source_type || "pubmed_vector",
    authors: parseAuthors(source.authors),
    author_label: source.author_label || formatAuthorLabel(source.authors),
    published_at: source.published_at || "",
    evidence_level: source.evidence_level || "",
    why_it_matters:
      source.why_it_matters || source.summary || "Retrieved from the Emersus PubMed evidence index.",
    journal: source.journal || "",
    year: source.publication_year || source.year || source.published_at || "",
    doi: source.doi || "",
    pmid: source.pmid || "",
    excerpt: source.excerpt || source.chunk_text || source.summary || "",
    publication_type:
      source.publication_type ||
      (Array.isArray(source.publication_types)
        ? source.publication_types.join(", ")
        : source.evidence_level || ""),
    freshness_score:
      source.freshness_score ?? scoreEvidenceFreshness(source.published_at),
    quality_score:
      source.quality_score ??
      scoreEvidenceQuality(
        source.publication_type || source.evidence_level,
        source.source_type
      ),
  }));
}

function questionKeywords(question) {
  return normalizeText(question, 600)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .filter((word, index, words) => words.indexOf(word) === index)
    .slice(0, 12);
}

function splitSentences(text) {
  return normalizeText(text, 2400)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function inferFindingLabel(sentence, question, unitType = "") {
  const sentenceText = sentence.toLowerCase();
  const text = `${question} ${sentence}`.toLowerCase();
  if (unitType === "duration") {
    return "Protocol duration";
  }
  if (unitType === "dose") {
    return "Dose used";
  }
  if (/risk|safety|adverse|side effect|tolerat/.test(sentenceText)) {
    return "Safety finding";
  }
  if (/muscle|lean mass|fat-free mass|hypertrophy|body composition/.test(text)) {
    return "Muscle-related effect";
  }
  if (/strength|power|performance|capacity|repetition|sprint/.test(text)) {
    return "Performance effect";
  }
  if (/recovery|soreness|damage|rehabilitation/.test(text)) {
    return "Recovery effect";
  }
  if (/vo2|maximal oxygen|endurance|cardio|aerobic|threshold/.test(text)) {
    return "Endurance effect";
  }
  if (/sleep|insomnia|latency|quality/.test(text)) {
    return "Sleep-related effect";
  }
  return "Reported finding";
}

function allowsProtocolMeasurements(question) {
  return /dose|dosage|how much|take|timing|duration|how long|weeks?|months?|cycle|protocol|load|loading|maintenance/i.test(
    question
  );
}

function allowsSafetyMeasurements(question) {
  return /safe|safety|risk|adverse|side effect|health risk|kidney|liver|blood pressure/i.test(
    question
  );
}

function extractMeasurement(sentence) {
  const patterns = [
    {
      kind: "percent",
      regex: /(?:increase(?:d|s)?|decrease(?:d|s)?|improv(?:e|ed|es|ement)|gain(?:ed|s)?|loss|reduc(?:e|ed|tion)|change(?:d|s)?)?[^\d]{0,24}(\d+(?:\.\d+)?)\s?%/i,
      format: (match) => ({
        displayValue: `${match[1]}%`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "mass",
      regex: /(\d+(?:\.\d+)?)\s?(kg|lb|lbs)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "duration",
      regex: /(\d+(?:\.\d+)?)\s?(days?|weeks?|months?)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
    {
      kind: "dose",
      regex: /(\d+(?:\.\d+)?)\s?(g|mg|mcg|kg)\b/i,
      format: (match) => ({
        displayValue: `${match[1]} ${match[2].toLowerCase()}`,
        normalizedValue: Number(match[1]),
      }),
    },
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern.regex);
    if (match) {
      return {
        kind: pattern.kind,
        ...pattern.format(match),
      };
    }
  }

  return null;
}

function buildQuantFindings({ question, evidence }) {
  const keywords = questionKeywords(question);
  const findings = [];
  const seen = new Set();

  for (const source of evidence.slice(0, VECTOR_LIMIT)) {
    const candidateText = [
      source.chunk_text,
      source.excerpt,
      source.summary,
      source.why_it_matters,
    ]
      .filter(Boolean)
      .join(" ");

    for (const sentence of splitSentences(candidateText)) {
      const measurement = extractMeasurement(sentence);
      if (!measurement) {
        continue;
      }

      const lower = sentence.toLowerCase();
      const keywordMatches = keywords.filter((keyword) => lower.includes(keyword)).length;
      const relevanceScore =
        keywordMatches +
        (measurement.kind === "percent" || measurement.kind === "mass" ? 2 : 0) +
        clamp(Number(source.ranking_score || source.database_score || 0), 0, 1);

      if (
        (measurement.kind === "duration" || measurement.kind === "dose") &&
        !allowsProtocolMeasurements(question)
      ) {
        continue;
      }

      if (/risk|health risks|adverse|side effect|safe|safety|tolerat/i.test(sentence) && !allowsSafetyMeasurements(question)) {
        continue;
      }

      if (keywords.length && keywordMatches === 0) {
        continue;
      }

      const label = inferFindingLabel(sentence, question, measurement.kind);
      const key = `${measurement.kind}:${measurement.displayValue}:${label}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      findings.push({
        displayValue: measurement.displayValue,
        normalizedValue: measurement.normalizedValue,
        unitType: measurement.kind,
        label,
        sentence: normalizeText(sentence, 320),
        sourceTitle: normalizeText(source.title || "Article", 120),
        sourceId: source.pmid ? `PMID ${source.pmid}` : source.doi || "",
        detail: source.publication_year || source.published_at || "",
        score: Number(relevanceScore.toFixed(3)),
      });
    }
  }

  return findings
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

async function generateRecommendation({
  question,
  profile,
  userId,
  threadId,
  includeDebug,
  threadState,
  recentMessages,
  requestMeta,
}) {
  const { stableUserId, supabaseUserId } = parseUserId(userId);
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const storedProfile = await fetchSupabaseProfile(
    supabaseUrl,
    serviceRoleKey,
    supabaseUserId
  );
  const mergedProfile = mergeProfile(profile, storedProfile || {});
  // Load the user's active workout plan when the frontend stamped it into
  // thread_state. This lets Emersus reason about "I missed Friday" and
  // similar adjustments in the same chat turn. Defense-in-depth: the fetch
  // double-checks the plan belongs to supabaseUserId so a spoofed thread
  // state can't leak someone else's plan into the prompt.
  const activeWorkoutPlanId = normalizeUuid(threadState?.active_workout_plan_id);
  let currentWorkoutPlan = null;
  if (activeWorkoutPlanId) {
    const loadedRow = await fetchSupabaseWorkoutPlan(
      supabaseUrl,
      serviceRoleKey,
      supabaseUserId,
      activeWorkoutPlanId
    );
    if (loadedRow && loadedRow.plan) {
      currentWorkoutPlan = {
        id: loadedRow.id,
        title: loadedRow.title,
        ...loadedRow.plan,
      };
    }
  }
  const plan = buildPlan(question, mergedProfile);
  const safety = classifySafety({
    question,
    profile: mergedProfile,
    threadState,
  });

  if (safety.status !== "allowed") {
    logGuardrailEvent({
      supabaseUrl,
      serviceRoleKey,
      supabaseUserId,
      stableUserId,
      question,
      plan,
      safety,
      requestMeta,
      threadState,
    }).catch((error) => {
      console.error("Guardrail event logging failed:", error);
    });
  }

  if (
    safety.status === "disallowed_unsafe" ||
    safety.status === "prompt_injection_or_system_probe" ||
    safety.status === "medical_boundary"
  ) {
    const blockedResponse = buildGuardrailResponse({
      question,
      plan,
      safety,
    });

    if (includeDebug) {
      blockedResponse.debug = {
        safety,
        synthesis_mode: "guardrail_block",
      };
    }

    if (stableUserId) {
      blockedResponse.user.id = stableUserId;
      blockedResponse.user.profile_used = mergedProfile;
    }

    return blockedResponse;
  }

  const vectorDatabase = await retrieveVectorEvidence(question);
  const databaseEvidence = vectorDatabase.evidence.slice(0, VECTOR_LIMIT);
  const evidenceForModel = formatEvidenceForModel(databaseEvidence);
  const today = new Date().toISOString().slice(0, 10);
  let openAIResponse = null;
  let synthesis = null;
  let synthesisMode = "not_started";
  let synthesisModel = DEFAULT_MODEL;
  let cumulativeTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  try {
    openAIResponse = await callOpenAISynthesis({
      model: DEFAULT_MODEL,
      question,
      profile: mergedProfile,
      plan,
      evidenceForModel,
      today,
      threadState,
      recentMessages,
      safety,
      currentWorkoutPlan,
    });
    cumulativeTokenUsage = mergeTokenUsageTotals(
      cumulativeTokenUsage,
      extractTokenUsage(openAIResponse)
    );

    const structuredOutput = extractStructuredOutput(openAIResponse);
    if (structuredOutput) {
      synthesis = normalizeSynthesisPayload(JSON.stringify(structuredOutput));
      synthesisMode = "structured_output";
    } else {
      const extractedText = extractTextFromResponse(openAIResponse);
      if (extractedText) {
        synthesis = normalizeSynthesisPayload(extractedText);
        synthesisMode = "text_output";
      } else {
        synthesisMode = "empty_model_output";
      }
    }

    if (!synthesis && SYNTHESIS_FALLBACK_MODEL && SYNTHESIS_FALLBACK_MODEL !== synthesisModel) {
      console.warn("Emersus synthesis retrying with fallback model.", {
        primaryModel: synthesisModel,
        fallbackModel: SYNTHESIS_FALLBACK_MODEL,
        responseId: openAIResponse?.id || null,
        synthesisMode,
      });

      openAIResponse = await callOpenAISynthesis({
        model: SYNTHESIS_FALLBACK_MODEL,
        question,
        profile: mergedProfile,
        plan,
        evidenceForModel,
        today,
        threadState,
        recentMessages,
        safety,
        currentWorkoutPlan,
      });
      cumulativeTokenUsage = mergeTokenUsageTotals(
        cumulativeTokenUsage,
        extractTokenUsage(openAIResponse)
      );
      synthesisModel = SYNTHESIS_FALLBACK_MODEL;

      const retryStructuredOutput = extractStructuredOutput(openAIResponse);
      if (retryStructuredOutput) {
        synthesis = normalizeSynthesisPayload(JSON.stringify(retryStructuredOutput));
        synthesisMode = "structured_output_retry";
      } else {
        const retryText = extractTextFromResponse(openAIResponse);
        if (retryText) {
          synthesis = normalizeSynthesisPayload(retryText);
          synthesisMode = "text_output_retry";
        } else {
          synthesisMode = "empty_model_output_retry";
        }
      }
    }
  } catch (error) {
    synthesisMode = "openai_error";
    console.error("OpenAI recommendation generation failed:", error);
  }

  // Forcing retry: if the user clearly asked for a visual and the first
  // synthesis produced a pseudo-visual (ASCII/unicode art) instead of a
  // real widget fence, ask the model again — this time for JUST the widget
  // HTML — and splice it into the existing answer.
  if (synthesis && wantsVisualOutput(question)) {
    const answerText = String(synthesis.answer_text || synthesis.summary || "");
    const alreadyHasWidget = hasInlineWidgetFence(answerText);
    const hasPseudo = containsPseudoVisual(answerText);
    if (!alreadyHasWidget && hasPseudo) {
      try {
        const retryPayload = await callOpenAIWidgetForcingRetry({
          model: synthesisModel,
          question,
          proseAnswer: answerText,
          evidenceForModel,
        });
        cumulativeTokenUsage = mergeTokenUsageTotals(
          cumulativeTokenUsage,
          extractTokenUsage(retryPayload)
        );
        const retryText = extractTextFromResponse(retryPayload);
        const widgetMatch = String(retryText || "").match(
          /```(?:widget|html)?[ \t]*\n([\s\S]*?)```/
        );
        if (widgetMatch && /<[a-z]/i.test(widgetMatch[1])) {
          // Strip the pseudo-visual block from the prose. The pseudo-visual
          // tends to be a contiguous run of lines containing the forbidden
          // characters — drop those lines.
          const cleanedProse = answerText
            .split(/\r?\n/)
            .filter((line) => !PSEUDO_VISUAL_RE.test(line))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          const mergedAnswer = `${cleanedProse}\n\n\`\`\`widget\n${widgetMatch[1].trim()}\n\`\`\``.trim();
          synthesis = {
            ...synthesis,
            answer_text: mergedAnswer,
          };
          synthesisMode = `${synthesisMode}+widget_forcing_retry`;
          console.log("Emersus widget forcing retry succeeded.", {
            question,
            originalMode: synthesisMode,
          });
        } else {
          console.warn("Emersus widget forcing retry returned no usable widget.");
        }
      } catch (error) {
        console.error("Emersus widget forcing retry failed:", error);
      }
    }
  }

  if (!synthesis) {
    if (openAIResponse) {
      console.warn("Emersus synthesis fell back after OpenAI call.", {
        responseId: openAIResponse?.id || null,
        model: synthesisModel,
        hasStructuredOutput: Boolean(extractStructuredOutput(openAIResponse)),
        hasTextOutput: Boolean(extractTextFromResponse(openAIResponse)),
        synthesisMode,
      });
    } else {
      console.warn("Emersus synthesis used fallback because no OpenAI response was available.", {
        synthesisMode,
      });
    }

    synthesis = buildFallbackRecommendation({
      question,
      evidence: databaseEvidence,
    });
    synthesisMode = `${synthesisMode}:fallback`;
  } else {
    console.log("Emersus synthesis succeeded.", {
      responseId: openAIResponse?.id || null,
      model: synthesisModel,
      synthesisMode,
      evidenceCount: databaseEvidence.length,
    });
  }

  const sources = normalizeSources(databaseEvidence);
  const confidence = computeConfidence({
    plan,
    evidence: databaseEvidence,
  });
  // Visual artifacts are now emitted inline by the model as ```widget``` fences
  // inside answer_text and rendered client-side. The legacy JSON visual_artifact
  // pipeline (buildVisualArtifactPlan / dynamic diagram planner) has been
  // retired in favor of that path.
  const quantFindings = buildQuantFindings({
    question,
    evidence: databaseEvidence,
  });
  const cards = buildCards({
    question,
    synthesis,
    evidence: databaseEvidence,
    includeDebug,
    plan,
    confidence,
    sources,
    quantFindings,
  });
  const tokenUsage = cumulativeTokenUsage;

  logTokenUsageEvent({
    supabaseUrl,
    serviceRoleKey,
    supabaseUserId,
    stableUserId,
    threadId,
    question,
    plan,
    requestMeta,
    tokenUsage,
    responseId: openAIResponse?.id || null,
    model: synthesisModel,
  }).catch((error) => {
    console.error("Token usage event logging failed:", error);
  });

  return {
    user: {
      id: stableUserId || null,
      profile_used: mergedProfile,
    },
    plan,
    summary: synthesis.summary,
    answer_text: synthesis.answer_text || synthesis.summary,
    recommendations: synthesis.recommendations,
    confidence,
    limitations: synthesis.limitations,
    sources,
    cards,
    quant_findings: quantFindings,
    token_usage: tokenUsage,
    guardrail: {
      status: safety.status,
      response_mode: safety.responseMode,
      reasons: safety.reasons,
    },
    debug: includeDebug
      ? {
          vector_database: vectorDatabase,
          evidence_for_model: evidenceForModel,
          openai_response_id: openAIResponse?.id || null,
          raw_output_text: extractTextFromResponse(openAIResponse) || "",
          synthesis_mode: synthesisMode,
          synthesis_model: synthesisModel,
          has_structured_output: Boolean(extractStructuredOutput(openAIResponse)),
          visual_generation: { mode: "inline_widget_fences" },
          safety,
          token_usage: tokenUsage,
        }
      : undefined,
  };
}

function validateRequest(body) {
  return sanitizeRequest(body);
}

export {
  // buildVisualArtifactPlan is no longer wired into the runtime synthesis path
  // (visuals are now emitted inline as ```widget``` fences in answer_text), but
  // the function is still exported so scripts/test-visual-artifacts.js can keep
  // exercising the deterministic templates while we wind that test down.
  buildVisualArtifactPlan,
  generateRecommendation,
  parseJsonBody,
  validateRequest,
  // Exposed so scripts/test-widget-fence-routing.js can replay real model
  // outputs (CRLF endings, truncated bodies, inline-fence variants) end-to-end
  // through the same code path the live request handler uses.
  normalizeSynthesisPayload,
};
