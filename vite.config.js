import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

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

export default defineConfig({
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
});
