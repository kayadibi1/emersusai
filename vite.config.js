import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.resolve(".");
const htmlEntries = [
  "index.html",
  "about/index.html",
  "admin/index.html",
  "admin/alerts/index.html",
  "admin/candidates/index.html",
  "admin/feeds/index.html",
  "admin/jobs/index.html",
  "admin/topics/index.html",
  "app/index.html",
  "app/nutrition/index.html",
  "app/profile/index.html",
  "app/train/index.html",
  "app/progress/index.html",
  "app/progress/exercise/index.html",
  "app/progress/session/index.html",
  "app/workout/index.html",
  "app/workout/cardio/index.html",
  "app/workout/climb/index.html",
  "app/workout/session/index.html",
  "app/workout/swim/index.html",
  "auth/callback/index.html",
  "auth/forgot-password/index.html",
  "auth/login/index.html",
  "auth/reset-password/index.html",
  "auth/signup/index.html",
  "auth/index.html",
  "chat/index.html",
  "contact/index.html",
  "consumer-health-data/index.html",
  "demo/index.html",
  "editorial-policy/index.html",
  "privacy/index.html",
  "pricing/index.html",
  "terms/index.html",
];

const GA_MEASUREMENT_ID = "G-RVQWW1H0S9";
const GA_SNIPPET = `
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_MEASUREMENT_ID}');
    </script>`;

function injectGtag() {
  return {
    name: "inject-gtag",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (html.includes(GA_MEASUREMENT_ID)) return html;
        const charsetRe = /<meta\s+charset\s*=\s*["']?[^"'>]+["']?\s*\/?>/i;
        if (charsetRe.test(html)) {
          return html.replace(charsetRe, (match) => `${match}${GA_SNIPPET}`);
        }
        return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${GA_SNIPPET}`);
      },
    },
  };
}

function getGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: rootDir }).toString().trim();
  } catch {
    return "unknown";
  }
}

function injectAnalytics(env) {
  const posthogKey = env.VITE_POSTHOG_KEY || "";
  const posthogHost = env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
  const sentryDsn = env.VITE_SENTRY_DSN_WEB || "";
  const release = env.VITE_RELEASE || getGitSha();
  const appEnv = env.VITE_APP_ENV || process.env.NODE_ENV || "production";

  // Nothing to inject if neither service is configured. Returns a no-op plugin
  // so devs without keys can still build locally.
  if (!posthogKey && !sentryDsn) {
    return { name: "inject-analytics-noop" };
  }

  const configJson = JSON.stringify({
    posthogKey,
    posthogHost,
    sentryDsn,
    release,
    env: appEnv,
  });

  const snippet = `
    <!-- Emersus analytics bootstrap (PostHog + Sentry) -->
    <script>window.__EMERSUS_ANALYTICS__ = ${configJson};</script>
    <script type="module" src="/shared/analytics.js"></script>`;

  return {
    name: "inject-analytics",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (html.includes("__EMERSUS_ANALYTICS__")) return html;
        return html.replace(/<\/head>/i, `${snippet}\n</head>`);
      },
    },
  };
}

function copyStaticFiles(files) {
  return {
    name: "copy-static-files",
    closeBundle() {
      const outDir = path.join(rootDir, "dist");
      for (const relativeFile of files) {
        const source = path.join(rootDir, relativeFile);
        if (!fs.existsSync(source)) continue;
        const target = path.join(outDir, relativeFile);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, ["VITE_"]);
  return {
    appType: "mpa",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries(
          htmlEntries.map((relativePath) => [relativePath, path.join(rootDir, relativePath)])
        ),
      },
    },
    plugins: [
      injectGtag(),
      injectAnalytics(env),
      copyStaticFiles([
        "emersus-logo.png",
        "emersus_mark_fibonacci_blue.svg",
        "robots.txt",
        "sitemap.xml",
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon.png",
        "manifest.webmanifest",
        "og-image.png",
        "BingSiteAuth.xml",
      ]),
    ],
  };
});
