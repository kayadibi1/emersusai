// api/emersus/pipeline/extract-memory-sanitize.js
//
// Write-side defense against stored-memory prompt-injection attacks
// (spec §9.1). Small, conservative blocklist — false-positive-sensitive,
// because we don't want to reject legitimate fitness facts that coincidentally
// contain a blocked phrase.
//
// Public API:
//   blocklistHit(text) -> boolean
//   sanitizeFactText(text) -> string | null
//     Returns a cleaned fact string, or null if the text should be rejected.

const BLOCKLIST_PATTERNS = [
  // "ignore previous instructions" family
  /\bignore (all |the )?(previous|prior|above|earlier) (instructions?|rules|context)\b/i,
  /\bdisregard (?:(?:all|your|the|prior|previous|any|above) ){0,3}(?:instructions?|rules|context|guidelines|prompt|programming)\b/i,
  /\bforget (everything|all (?:previous|prior|above)|the above)\b/i,

  // role-swap / pretend-you-are
  /\b(pretend|act as (if |though ))\b.{0,60}\b(you (are|have no|don'?t|can|cannot)|safety (does not apply|off)|different ai|another ai)\b/i,
  /\byou are now\b/i,
  /\bfrom now on (you|your replies?|every reply)\b/i,
  /\broleplay as\b/i,
  /\bact as (DAN|STAN|AIM|DUDE|AntiDAN|UnrestrictedGPT|JailbreakGPT)\b/i,

  // system-prompt extraction
  /\b(print|reveal|show|output|repeat|give me) (your |the |back |me )?(system|initial|original|hidden|internal) (prompt|instructions|message|rules|directives)\b/i,
  /\bwhat (are|were) your (instructions|rules|guidelines|system prompt|directives)\b/i,

  // unrestricted-mode framing
  /\b(no (restrictions?|limits?|boundaries|rules|filters))\b/i,
  /\b(unrestricted|unfiltered|uncensored|unhinged|jailbroken?) (mode|version|model)\b/i,

  // must-start-reply / override response format
  /\b(must|have to|always) start (every |your |each )?(reply|response|message|answer) with\b/i,
];

export function blocklistHit(text) {
  const s = String(text || "");
  if (!s) return false;
  return BLOCKLIST_PATTERNS.some((re) => re.test(s));
}

export function sanitizeFactText(raw) {
  if (raw == null) return null;
  let s = String(raw);

  // Normalize whitespace first so length + pattern checks are stable.
  s = s.replace(/\s+/g, " ").trim();

  // Strip markdown fences but NOT what's inside — if the inside was clean,
  // keep it; if it's an injection, blocklist catches it next.
  s = s.replace(/```+/g, "").replace(/\s+/g, " ").trim();

  // Now check the stripped text against the blocklist.
  if (blocklistHit(s)) return null;

  // Length cap (matches DB constraint + tool description).
  if (s.length < 1 || s.length > 500) return null;

  return s;
}
