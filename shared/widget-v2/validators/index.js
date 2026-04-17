// Top-level widget-v2 validator. Mirrors the strict-mode OpenAI schema but
// runs server-side after parsing the tool arguments JSON, so we can surface
// clear errors in SSE `tool_error` events rather than silently dropping.

const VALID_WIDTHS = new Set(["narrow", "medium", "wide"]);

export function validateBase(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["payload must be an object"] };
  }
  if (typeof payload.title !== "string" || !payload.title.trim()) {
    errors.push("title must be a non-empty string");
  }
  if (!VALID_WIDTHS.has(payload.display_width)) {
    errors.push(`display_width must be one of narrow|medium|wide, got ${payload.display_width}`);
  }
  if (payload.summary !== null && typeof payload.summary !== "string") {
    errors.push("summary must be string or null");
  }
  if (!Array.isArray(payload.follow_up_chips)) {
    errors.push("follow_up_chips must be an array");
  } else if (payload.follow_up_chips.length > 4) {
    errors.push("follow_up_chips max 4 items");
  } else if (payload.follow_up_chips.some((c) => typeof c !== "string")) {
    errors.push("follow_up_chips must contain strings");
  }
  if (typeof payload.type !== "string") errors.push("type must be a string");
  if (!payload.data || typeof payload.data !== "object") errors.push("data must be an object");
  return { valid: errors.length === 0, errors };
}
