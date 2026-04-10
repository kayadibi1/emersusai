// Streaming variant of /api/emersus/recommendation used by /app/_debug/.
//
// Why a separate endpoint:
//   - The regular /api/emersus/recommendation returns one JSON blob after
//     the full pipeline finishes. That's fine for production chat, which
//     has its own fake-typewriter UX, and it's the minimum-risk path for
//     the user-facing chat page.
//   - The debug page wants to SEE the pipeline as it runs: retrieval
//     finishes ~300ms in, the prompt shows up immediately after, the
//     OpenAI call takes 2-4s and then the synthesis/tokens fill in. The
//     only way to surface those timings live is for the server to flush
//     output progressively.
//
// Wire format: standard SSE (Server-Sent Events) — "data: {json}\n\n"
// frames. Each stage in generateRecommendation calls an onProgress
// callback; this handler turns those into SSE frames and flushes each
// one. The client (see app/_debug/react-chat-app-debug.js) parses each
// frame and updates its debug panel incrementally.
//
// Protection: same rate limit and payload validation as the regular
// endpoint. Admin-only access is enforced CLIENT-side via requireAdmin
// in shared/supabase.js — this endpoint itself accepts any request that
// passes rate limiting because the backing OpenAI/Supabase calls are
// already rate-capped and the debug payload contains only the same user's
// own data. The page gate is defence-in-depth for the UI, not a security
// boundary around the endpoint.

import {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
} from "./workflow.js";
import {
  buildRequestMeta,
  checkRateLimit,
  recordGuardrailBlockForRateLimit,
} from "./rate-limit.js";

// Write one SSE frame. Spec: "event: X\ndata: Y\n\n". We use a single
// "message" event type (no custom event names) and put the stage name in
// the JSON payload — simpler on the client side where EventSource
// auto-fires for unnamed "message" events.
function sendSSE(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    // Explicit flush so each SSE chunk reaches the client immediately
    // instead of sitting in Node's response buffer until the next write.
    // res.flush() is added by the `compression` middleware (and a no-op
    // on plain Node sockets), so this is safe regardless of stack.
    if (typeof res.flush === "function") {
      res.flush();
    }
  } catch (_err) {
    // Client probably disconnected mid-response. Let the handler catch it.
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ message: "Method not allowed." });
    }

    const body = validateRequest(parseJsonBody(req));
    const rateLimit = checkRateLimit(req, body.question);

    res.setHeader("X-RateLimit-Limit", rateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(rateLimit.resetAt / 1000));

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
      );
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).json({
        message: rateLimit.botFlagged
          ? "Automated traffic detected. Please try again later."
          : "Too many chat requests. Please wait a moment and try again.",
      });
    }

    body.requestMeta = buildRequestMeta(req);
    // The debug page needs the full debug payload regardless of what
    // the client asked for. This is safe because access is gated by
    // the page-level admin check; any non-admin who reaches this
    // endpoint only sees their own data anyway (the backend respects
    // the user id from the request).
    body.includeDebug = true;

    // SSE headers. Important: must be set BEFORE the first res.write.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable upstream buffering when sitting behind a reverse proxy
    // (Caddy on Hetzner; also honored by Nginx). Without it, progress
    // events buffer until the response closes — which completely
    // defeats the point of streaming.
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Emit a hello frame immediately so the client knows the connection
    // is alive before the pipeline actually starts producing stages.
    sendSSE(res, { stage: "connected", at_ms: 0 });

    const recommendation = await generateRecommendation({
      ...body,
      onProgress: (event) => {
        sendSSE(res, event);
      },
    });

    // Track guardrail blocks for bot scoring
    if (recommendation?.guardrail?.status === "hard_refusal") {
      recordGuardrailBlockForRateLimit(req);
    }

    // The "final" stage event is emitted by generateRecommendation itself
    // via onProgress, so we don't duplicate it here. Just close the
    // stream cleanly with a terminator frame so the client knows it can
    // stop listening.
    sendSSE(res, { stage: "complete" });
    res.end();
    return;
  } catch (error) {
    // If we haven't started streaming yet, respond with a normal JSON
    // error so the client can detect it via response.ok. If we're already
    // mid-stream, emit an error frame and end.
    if (!res.headersSent) {
      const statusCode = Number(error.statusCode || error.status || 500);
      return res.status(statusCode).json({
        message:
          error.message || "Unable to generate an Emersus recommendation.",
      });
    }
    sendSSE(res, {
      stage: "error",
      message: String((error && error.message) || error),
    });
    res.end();
    return;
  }
}
