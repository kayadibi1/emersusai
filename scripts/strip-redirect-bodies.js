// scripts/strip-redirect-bodies.js
// The 7 pure-redirect HTMLs (auth/login, auth/signup, auth/forgot-password,
// auth/reset-password, chat/, app/progress/exercise, app/progress/session)
// ship full legacy bodies that render briefly before the redirect fires —
// the "flash of old design" the user reported on /app/profile/ was the
// same bug. Replace each with a minimal skeleton: keep the <head> with
// no-cache + no-flash-boot + redirect script, replace <body>...</body>
// with an empty body + one invisible "Redirecting…" fallback.
//
// Idempotent via the "stripped redirect body" sentinel.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "auth/login/index.html",
  "auth/signup/index.html",
  "auth/forgot-password/index.html",
  "auth/reset-password/index.html",
  "chat/index.html",
  "app/progress/exercise/index.html",
  "app/progress/session/index.html",
];

const SENTINEL = "<!-- redirect-only body: stripped legacy markup to avoid flash -->";
const BODY = `<body>
  ${SENTINEL}
  <noscript>
    <p style="padding:20px;font-family:system-ui,sans-serif;">
      This page has moved. Please <a href="/">return home</a>.
    </p>
  </noscript>
</body>`;

let stripped = 0;
let skipped = 0;

for (const rel of TARGETS) {
  const full = path.join(rootDir, rel);
  if (!fs.existsSync(full)) {
    console.log(`MISSING: ${rel}`);
    continue;
  }
  const html = fs.readFileSync(full, "utf8");
  if (html.includes(SENTINEL)) {
    skipped++;
    continue;
  }
  // Replace <body...>...</body> with the minimal shell.
  const bodyRe = /<body[\s\S]*?<\/body>/;
  if (!bodyRe.test(html)) {
    console.log(`NO <body>: ${rel}`);
    continue;
  }
  // Also remove any <link rel="stylesheet" href="/shared/site.css..."> in head
  // since the stripped body no longer needs it.
  const siteCssRe = /\s*<link rel="stylesheet" href="\/shared\/site\.css[^"]*"[^>]*>/;
  const next = html.replace(siteCssRe, "").replace(bodyRe, BODY);
  fs.writeFileSync(full, next, "utf8");
  stripped++;
  console.log(`stripped: ${rel}`);
}

console.log("");
console.log(`stripped: ${stripped}, skipped: ${skipped}`);
