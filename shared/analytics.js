// shared/analytics.js
// Single entry point for client-side analytics (PostHog) and error
// tracking (Sentry). Loads both from CDN so we don't bloat the React
// bundle. Reads config from window.__EMERSUS_ANALYTICS__, which is
// injected at build time by the vite plugin in vite.config.js.
//
// No-ops silently when config is absent (e.g. local dev without keys),
// so it's safe to import from every HTML entry unconditionally.

const cfg = (typeof window !== "undefined" && window.__EMERSUS_ANALYTICS__) || {};

let posthogLoaded = false;
let sentryLoaded = false;

function loadPostHog() {
  if (posthogLoaded || !cfg.posthogKey || !cfg.posthogHost) return;
  posthogLoaded = true;
  // Official PostHog snippet (minified), adapted to take key+host from cfg.
  // Source: https://posthog.com/docs/libraries/js#snippet-installation
  // eslint-disable-next-line
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(cfg.posthogKey, {
    api_host: cfg.posthogHost,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    loaded: (ph) => {
      if (cfg.release) ph.register({ $release: cfg.release });
      if (cfg.env) ph.register({ app_env: cfg.env });
    },
  });
}

function loadSentry() {
  if (sentryLoaded || !cfg.sentryDsn) return;
  sentryLoaded = true;
  // Sentry Loader Script — async, non-blocking, deferred init.
  // We configure via Sentry.onLoad() so errors captured before full SDK
  // initializes are still sent.
  const s = document.createElement("script");
  s.src = `https://js.sentry-cdn.com/${extractPublicKey(cfg.sentryDsn)}.min.js`;
  s.crossOrigin = "anonymous";
  s.async = true;
  s.onload = () => {
    if (!window.Sentry) return;
    window.Sentry.onLoad(() => {
      window.Sentry.init({
        dsn: cfg.sentryDsn,
        environment: cfg.env || "production",
        release: cfg.release || undefined,
        tracesSampleRate: cfg.env === "production" ? 0.1 : 1.0,
        replaysSessionSampleRate: 0, // keep bandwidth low by default
        replaysOnErrorSampleRate: 0.1,
      });
    });
  };
  document.head.appendChild(s);
}

function extractPublicKey(dsn) {
  // Sentry Loader URL uses the project's public key (the part between // and @).
  try {
    const url = new URL(dsn);
    return url.username;
  } catch {
    return "";
  }
}

export function identifyUser(userId, traits = {}) {
  if (!userId) return;
  if (window.posthog && posthogLoaded) {
    try { window.posthog.identify(String(userId), traits); } catch {}
  }
  if (window.Sentry && sentryLoaded) {
    try { window.Sentry.setUser({ id: String(userId), ...traits }); } catch {}
  }
}

export function capture(event, properties = {}) {
  if (window.posthog && posthogLoaded) {
    try { window.posthog.capture(event, properties); } catch {}
  }
}

export function trackPageView(path) {
  if (window.posthog && posthogLoaded) {
    try { window.posthog.capture("$pageview", { $current_url: path || location.href }); } catch {}
  }
  if (window.gtag) {
    try { window.gtag("event", "page_view", { page_path: path || location.pathname }); } catch {}
  }
}

// Auto-init on module load. Safe to call repeatedly — each loader guards
// against double-init.
loadPostHog();
loadSentry();
