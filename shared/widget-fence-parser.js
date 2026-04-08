// Pure widget-fence parsing primitives. No React, no DOM, no browser-only
// imports — kept dependency-free so Node-side tests and the browser-side
// renderer can share the exact same matching logic.

// A "widget fence" is a fenced code block whose info string is `widget` or
// `html`, OR an untagged ``` block whose first non-whitespace character is
// `<` (i.e. the model emitted raw HTML in a bare fence). The `widget` tag is
// what the system prompt tells the model to use, but real models drift to
// `html` a lot of the time, and occasionally emit a bare fence, so accepting
// all three keeps the pipeline robust without changing the model contract.
const WIDGET_INFO_TAGS = /^(widget|html)$/i;

// A `workout-plan` fence is a separate fence type the model emits when it
// wants to return a structured workout plan (JSON, not HTML). The renderer
// treats it differently — no iframe, no Chart.js; it becomes a React card
// with Save/Apply/Download buttons. Kept as its own info tag so it never
// collides with widget fences.
const WORKOUT_PLAN_INFO_TAGS = /^workout-plan$/i;

export function isWidgetFenceBody(info, body) {
  if (WIDGET_INFO_TAGS.test(info)) return true;
  // Untagged fence: only treat as a widget if it really looks like HTML.
  if (!info) {
    const firstChar = String(body || "").trim().charAt(0);
    return firstChar === "<";
  }
  return false;
}

export function isWorkoutPlanFenceInfo(info) {
  return WORKOUT_PLAN_INFO_TAGS.test(String(info || ""));
}

// Matches any fenced block: opening ``` + optional info string + optional
// newline (CR/LF, LF, or none — some models inline the body on the same
// line as the opening fence) + body + closing ```. Non-greedy body,
// multiline. We pick the widget-looking ones ourselves via
// isWidgetFenceBody so we never swallow unrelated fences.
export const ANY_FENCE_RE = /```([\w-]*)[ \t]*\r?\n?([\s\S]*?)```/g;

// Parse a workout-plan fence body as JSON. Returns either
//   { ok: true, plan: <object> }
// or
//   { ok: false, error: "...", raw: "..." }
// We never throw — the UI renders a clear error state instead of exploding
// the chat when the model hiccups.
export function parseWorkoutPlanBody(body) {
  const raw = String(body || "").trim();
  if (!raw) return { ok: false, error: "empty workout-plan fence", raw };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "workout-plan body was not a JSON object", raw };
    }
    return { ok: true, plan: parsed };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error), raw };
  }
}

// Walks the markdown for fenced code blocks and produces an ordered list of
// { type, content } segments:
//   - { type: "text",         content: string }
//   - { type: "widget",       content: string (raw HTML) }
//   - { type: "workout-plan", content: { ok, plan?, error?, raw } }
// Empty text segments are dropped so we never render blank prose chunks
// between back-to-back fences.
export function parseLLMOutput(markdown) {
  const text = String(markdown || "");
  const segments = [];
  let lastIndex = 0;
  let match;
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const [whole, info, body] = match;
    const isWidget = isWidgetFenceBody(info, body);
    const isWorkoutPlan = isWorkoutPlanFenceInfo(info);
    if (!isWidget && !isWorkoutPlan) continue;

    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk.trim()) segments.push({ type: "text", content: chunk });
    }

    if (isWorkoutPlan) {
      segments.push({
        type: "workout-plan",
        content: parseWorkoutPlanBody(body),
      });
    } else {
      segments.push({ type: "widget", content: body });
    }

    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    if (tail.trim()) {
      // Detect an UNCLOSED workout-plan fence at the end of the stream.
      // This happens when OpenAI hits max_output_tokens mid-plan and the
      // closing ``` never arrives. Without this branch the tail would
      // render as raw JSON prose, which is confusing. With it, the user
      // gets a clear "truncated — retry" card instead of dumped JSON.
      const unclosed = tail.match(/```workout-plan[ \t]*\r?\n?([\s\S]*)$/i);
      if (unclosed) {
        const beforeFence = tail.slice(0, unclosed.index);
        if (beforeFence.trim()) {
          segments.push({ type: "text", content: beforeFence });
        }
        segments.push({
          type: "workout-plan",
          content: {
            ok: false,
            error: "truncated — the plan was cut off before the model finished emitting it. Try asking again, or ask for a shorter plan (fewer weeks).",
            raw: String(unclosed[1] || ""),
            truncated: true,
          },
        });
      } else {
        segments.push({ type: "text", content: tail });
      }
    }
  }
  return segments;
}

// During typewriter streaming we strip widget AND workout-plan fences from
// the visible substring so the user never sees half-finished fence markers
// or raw JSON. Both fully-closed fences AND a trailing unclosed fence are
// removed.
export function stripWidgetFencesForStreaming(text) {
  const src = String(text || "");
  let out = "";
  let cursor = 0;
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  let match;
  while ((match = re.exec(src)) !== null) {
    const [whole, info, body] = match;
    const isWidget = isWidgetFenceBody(info, body);
    const isWorkoutPlan = isWorkoutPlanFenceInfo(info);
    if (!isWidget && !isWorkoutPlan) continue;
    out += src.slice(cursor, match.index);
    cursor = match.index + whole.length;
  }
  out += src.slice(cursor);
  // Trailing unclosed fence — only strip if the info tag signals a widget
  // or workout-plan fence, or if the first content char looks like HTML.
  out = out.replace(
    /```([\w-]*)[ \t]*\n?([\s\S]*)$/,
    (whole, info, body) => {
      if (isWorkoutPlanFenceInfo(info)) return "";
      if (isWidgetFenceBody(info, body)) return "";
      return whole;
    },
  );
  return out;
}

// Quick check used by callers to decide whether the segment-aware code path
// is needed at all. Pure prose answers stay on the existing rendering path.
// Returns true if ANY widget OR workout-plan fence is present — including
// an UNCLOSED trailing workout-plan fence, so the truncation fallback in
// parseLLMOutput gets a chance to render a retry card instead of the raw
// JSON leaking into prose.
export function hasWidgetFences(text) {
  const src = String(text || "");
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  let match;
  while ((match = re.exec(src)) !== null) {
    if (isWidgetFenceBody(match[1], match[2])) return true;
    if (isWorkoutPlanFenceInfo(match[1])) return true;
  }
  // No closed fence found — check for an unclosed trailing workout-plan
  // fence (max_output_tokens cutoff case).
  if (/```workout-plan[ \t]*\r?\n?[\s\S]*$/i.test(src) && !/```workout-plan[\s\S]*```/i.test(src)) {
    return true;
  }
  return false;
}
