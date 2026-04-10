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
    const recommendation = await generateRecommendation(body);

    // Track guardrail blocks for bot scoring
    if (recommendation?.guardrail?.status === "hard_refusal") {
      recordGuardrailBlockForRateLimit(req);
    }

    return res.status(200).json(recommendation);
  } catch (error) {
    const statusCode = Number(error.statusCode || error.status || 500);

    return res.status(statusCode).json({
      message: error.message || "Unable to generate an Emersus recommendation.",
    });
  }
}
