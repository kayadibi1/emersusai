import {
  generateRecommendationStream,
  parseJsonBody,
  validateRequest,
} from "./workflow.js";
import {
  buildRequestMeta,
  checkRateLimit,
  recordGuardrailBlockForRateLimit,
} from "./rate-limit.js";

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
      const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).json({
        message: rateLimit.botFlagged
          ? "Automated traffic detected. Please try again later."
          : "Too many chat requests. Please wait a moment and try again.",
      });
    }

    body.requestMeta = buildRequestMeta(req);

    // Override self-asserted userId with the verified one from JWT
    if (req.verifiedUserId) {
      body.userId = `supabase:${req.verifiedUserId}`;
    }

    // Propagate the billing tier set by the userRateLimit middleware so
    // the pipeline can gate preprint access (Pro-only) in retrieve.js.
    body.tier = req.rateLimitInfo?.tier || "free";

    // Stream SSE directly to the client.
    // ShortCircuit responses (onboarding, guardrail refusal) are sent as JSON
    // by generateRecommendationStream — the client detects via Content-Type.
    await generateRecommendationStream(body, res);
  } catch (error) {
    if (!res.headersSent) {
      console.error("Recommendation handler error:", error);
      const statusCode = Number(error.statusCode || error.status || 500);
      // Only forward .message for client errors (4xx) created by our own
      // validation code. Never forward 5xx errors which may contain
      // upstream API details (OpenAI key echoes, Supabase internals).
      const safeMessage = statusCode < 500
        ? (error.message || "Bad request.")
        : "Unable to generate a recommendation. Please try again.";
      return res.status(statusCode).json({ message: safeMessage });
    }
  }
}
