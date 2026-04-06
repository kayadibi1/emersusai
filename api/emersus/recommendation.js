import {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
} from "./workflow.js";

const RATE_LIMIT_WINDOW_MS = Number(
  process.env.EMERSUS_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000
);
const RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.EMERSUS_RATE_LIMIT_MAX_REQUESTS || 10
);
const rateLimitStore = new Map();

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).split(",")[0].trim();
  }

  return (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

function buildRequestMeta(req) {
  const userAgent = req.headers["user-agent"];
  return {
    clientIp: getClientIp(req),
    userAgent: Array.isArray(userAgent) ? String(userAgent[0] || "") : String(userAgent || ""),
  };
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = getClientIp(req);
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const freshState = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
    rateLimitStore.set(key, freshState);
    return {
      allowed: true,
      remaining: Math.max(RATE_LIMIT_MAX_REQUESTS - freshState.count, 0),
      resetAt: freshState.resetAt,
    };
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(RATE_LIMIT_MAX_REQUESTS - existing.count, 0),
    resetAt: existing.resetAt,
  };
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

    const rateLimit = checkRateLimit(req);
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(rateLimit.resetAt / 1000));

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
      );
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).json({
        message: "Too many chat requests. Please wait a moment and try again.",
      });
    }

    const body = validateRequest(parseJsonBody(req));
    body.requestMeta = buildRequestMeta(req);
    const recommendation = await generateRecommendation(body);

    return res.status(200).json(recommendation);
  } catch (error) {
    const statusCode = Number(error.statusCode || error.status || 500);

    return res.status(statusCode).json({
      message: error.message || "Unable to generate an Emersus recommendation.",
    });
  }
}
