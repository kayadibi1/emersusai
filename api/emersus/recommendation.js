import {
  generateRecommendationStream,
  parseJsonBody,
  validateRequest,
} from "./workflow-v2.js";
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

    // Stream SSE directly to the client.
    // ShortCircuit responses (onboarding, guardrail refusal) are sent as JSON
    // by generateRecommendationStream — the client detects via Content-Type.
    await generateRecommendationStream(body, res);
  } catch (error) {
    if (!res.headersSent) {
      const statusCode = Number(error.statusCode || error.status || 500);
      return res.status(statusCode).json({
        message: error.message || "Unable to generate an Emersus recommendation.",
      });
    }
  }
}
