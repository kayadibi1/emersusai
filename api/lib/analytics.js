import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";

const SENTRY_DSN = process.env.SENTRY_DSN || "";
const POSTHOG_KEY = process.env.POSTHOG_API_KEY || "";
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const RELEASE = process.env.RELEASE || process.env.GIT_SHA || "unknown";
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || "development";

let sentryReady = false;
let posthog = null;

export function initSentry() {
  if (sentryReady || !SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    release: RELEASE,
    tracesSampleRate: APP_ENV === "production" ? 0.1 : 1.0,
    // Don't send PII by default; we attach user context explicitly via setUser.
    sendDefaultPii: false,
  });
  sentryReady = true;
}

export function initPostHog() {
  if (posthog || !POSTHOG_KEY) return null;
  posthog = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    // Flush aggressively in a request/response server so events don't
    // linger if the process is restarted by pm2.
    flushAt: 20,
    flushInterval: 10_000,
  });
  return posthog;
}

export function capture(distinctId, event, properties = {}) {
  if (!posthog) initPostHog();
  if (!posthog || !distinctId) return;
  try {
    posthog.capture({
      distinctId: String(distinctId),
      event,
      properties: { ...properties, $release: RELEASE, app_env: APP_ENV },
    });
  } catch (err) {
    // Never let telemetry break the request path.
    Sentry.captureException?.(err);
  }
}

export function identify(distinctId, properties = {}) {
  if (!posthog) initPostHog();
  if (!posthog || !distinctId) return;
  try {
    posthog.identify({
      distinctId: String(distinctId),
      properties,
    });
  } catch (err) {
    Sentry.captureException?.(err);
  }
}

export async function shutdownAnalytics() {
  if (posthog) {
    try {
      await posthog.shutdown();
    } catch {
      // ignore
    }
  }
  if (sentryReady) {
    try {
      await Sentry.close(2000);
    } catch {
      // ignore
    }
  }
}

export { Sentry };
