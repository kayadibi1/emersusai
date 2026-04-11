// scripts/sources/_errors.js
// Error taxonomy used by source plugins. Handlers inspect these with
// instanceof to pick retry policy.

export class SourceTransientError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "SourceTransientError";
    this.cause = cause;
  }
}

export class SourceRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "SourceRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class SourcePermanentError extends Error {
  constructor(message, { cause, body } = {}) {
    super(message);
    this.name = "SourcePermanentError";
    this.cause = cause;
    this.body = body;
  }
}
