import { createHash } from "node:crypto";

const RATE_LIMIT_WINDOW_MS = Number(
  process.env.EMERSUS_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000
);
const RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.EMERSUS_RATE_LIMIT_MAX_REQUESTS || 15
);
const RATE_LIMIT_BOT_MAX_REQUESTS = 3;
const BOT_SCORE_THRESHOLD = 0.55;

const rateLimitStore = new Map();

// --- Helpers ---

function getClientIp(req) {
  // Use req.ip which respects Express's "trust proxy" setting.
  // With trust proxy = 1 (Caddy), Express reads the rightmost
  // X-Forwarded-For entry set by Caddy, ignoring client-spoofed values.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function buildRequestMeta(req) {
  const userAgent = req.headers["user-agent"];
  return {
    clientIp: getClientIp(req),
    userAgent: Array.isArray(userAgent)
      ? String(userAgent[0] || "")
      : String(userAgent || ""),
  };
}

function hashQuestion(question) {
  if (!question || typeof question !== "string") return "";
  return createHash("sha256").update(question.trim().toLowerCase()).digest("hex").slice(0, 16);
}

// --- Bot detection ---

const SUSPICIOUS_UA_PATTERN =
  /\b(curl|python-requests|python-urllib|httpie|wget|Go-http-client|node-fetch|axios|undici|scrapy|bot|spider|crawl|headless|phantom|selenium|playwright|puppeteer)\b/i;

function scoreRequestIntervalConsistency(timestamps) {
  if (timestamps.length < 3) return 0;
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(timestamps[i] - timestamps[i - 1]);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance =
    gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const stdev = Math.sqrt(variance);
  // Humans vary 3-30s+; bots fire at near-identical intervals.
  // stdev < 500ms → full score, > 3000ms → zero, linear between.
  if (stdev < 500) return 1;
  if (stdev > 3000) return 0;
  return 1 - (stdev - 500) / 2500;
}

function scoreDuplicatePayloads(questionHashes) {
  if (questionHashes.length < 3) return 0;
  const freq = {};
  for (const h of questionHashes) {
    freq[h] = (freq[h] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(freq));
  // 3 of 5 identical → full score
  if (maxFreq >= 3) return 1;
  if (maxFreq === 2) return 0.4;
  return 0;
}

function scoreSuspiciousUserAgent(userAgent) {
  if (!userAgent || userAgent.trim() === "") return 1;
  if (SUSPICIOUS_UA_PATTERN.test(userAgent)) return 1;
  return 0;
}

function scoreBlockRatio(blockCount, totalCount) {
  if (totalCount < 3) return 0;
  const ratio = blockCount / totalCount;
  if (ratio > 0.6) return 1;
  if (ratio > 0.3) return (ratio - 0.3) / 0.3;
  return 0;
}

function scoreBotLikelihood(entry, userAgent) {
  const interval = scoreRequestIntervalConsistency(entry.requestTimestamps);
  const duplicates = scoreDuplicatePayloads(entry.questionHashes);
  const ua = scoreSuspiciousUserAgent(userAgent);
  const blocks = scoreBlockRatio(entry.blockCount, entry.count);

  return interval * 0.3 + duplicates * 0.25 + ua * 0.2 + blocks * 0.25;
}

// --- Rate limiting ---

function checkRateLimit(req, questionText) {
  const now = Date.now();
  const key = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const qHash = hashQuestion(questionText);
  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
      requestTimestamps: [],
      questionHashes: [],
      blockCount: 0,
      botFlagged: false,
    };
  }

  entry.count += 1;
  entry.requestTimestamps.push(now);
  if (entry.requestTimestamps.length > 5) {
    entry.requestTimestamps = entry.requestTimestamps.slice(-5);
  }
  if (qHash) {
    entry.questionHashes.push(qHash);
    if (entry.questionHashes.length > 5) {
      entry.questionHashes = entry.questionHashes.slice(-5);
    }
  }

  // Bot scoring
  const botScore = scoreBotLikelihood(entry, userAgent);
  if (botScore >= BOT_SCORE_THRESHOLD) {
    entry.botFlagged = true;
  }

  const effectiveMax = entry.botFlagged
    ? RATE_LIMIT_BOT_MAX_REQUESTS
    : RATE_LIMIT_MAX_REQUESTS;

  rateLimitStore.set(key, entry);

  if (entry.count > effectiveMax) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      botFlagged: entry.botFlagged,
      botScore,
      limit: effectiveMax,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(effectiveMax - entry.count, 0),
    resetAt: entry.resetAt,
    botFlagged: entry.botFlagged,
    botScore,
    limit: effectiveMax,
  };
}

function recordGuardrailBlockForRateLimit(req) {
  const key = getClientIp(req);
  const entry = rateLimitStore.get(key);
  if (entry) {
    entry.blockCount += 1;
    rateLimitStore.set(key, entry);
  }
}

// --- Stale entry cleanup ---
// Prevents unbounded growth of the in-memory rate limit store.
// Runs every 10 minutes, evicts entries whose window has expired.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

// --- General-purpose rate limiter for public endpoints ---
// Lighter than the recommendation rate limiter: no bot scoring, no
// question hashing. Used for unauthenticated POST endpoints like
// contact, check-email, notify-signup.

const publicRateLimitStore = new Map();

const PUBLIC_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PUBLIC_RATE_LIMIT_MAX = {
  default: 10,          // generic endpoints
  "check-email": 20,    // signup flow may hit this a few times
};

function checkPublicRateLimit(req, endpointName = "default") {
  const now = Date.now();
  const ip = getClientIp(req);
  const storeKey = `${ip}:${endpointName}`;
  let entry = publicRateLimitStore.get(storeKey);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + PUBLIC_RATE_LIMIT_WINDOW_MS };
  }

  entry.count += 1;
  publicRateLimitStore.set(storeKey, entry);

  const max = PUBLIC_RATE_LIMIT_MAX[endpointName] || PUBLIC_RATE_LIMIT_MAX.default;

  if (entry.count > max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      limit: max,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(max - entry.count, 0),
    resetAt: entry.resetAt,
    limit: max,
  };
}

// Cleanup for public rate limit store too
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of publicRateLimitStore) {
    if (entry.resetAt <= now) publicRateLimitStore.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Express middleware factory for public endpoint rate limiting.
 * Usage: app.post("/api/contact", publicRateLimitMiddleware("contact"), handler)
 */
function publicRateLimitMiddleware(endpointName = "default") {
  return (req, res, next) => {
    const result = checkPublicRateLimit(req, endpointName);
    res.setHeader("X-RateLimit-Limit", result.limit);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    next();
  };
}

export {
  getClientIp,
  buildRequestMeta,
  checkRateLimit,
  recordGuardrailBlockForRateLimit,
  checkPublicRateLimit,
  publicRateLimitMiddleware,
  RATE_LIMIT_MAX_REQUESTS,
};
