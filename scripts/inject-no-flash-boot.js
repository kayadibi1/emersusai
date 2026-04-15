// scripts/inject-no-flash-boot.js
// Injects a synchronous pre-paint <script> into the <head> of every HTML
// entry listed in vite.config.js. The script resolves data-theme + every v2
// flag from localStorage/URL BEFORE CSS loads, eliminating the FOUC caused
// by deferred module scripts.
//
// Idempotent: detects the sentinel comment and skips already-injected files.
// Run: node scripts/inject-no-flash-boot.js [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const HTML_ENTRIES = [
  "index.html",
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
  "privacy/index.html",
  "terms/index.html",
];

const SENTINEL = "<!-- no-flash-boot: resolves data-theme + v2 flags pre-paint -->";

const BOOT_BLOCK = `  ${SENTINEL}
  <script>
    (function () {
      var H = document.documentElement;
      try {
        var saved = localStorage.getItem('emersus-theme');
        var theme = (saved === 'mint' || saved === 'paper') ? saved
          : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'mint');
        H.setAttribute('data-theme', theme);
      } catch (_) { H.setAttribute('data-theme', 'mint'); }
      try {
        var url = new URLSearchParams(location.search);
        var stored = {};
        try { stored = JSON.parse(localStorage.getItem('emersus-flags') || '{}') || {}; } catch (_) {}
        var FLAGS = ['chat_v2','train_v2','nutrition_v2','profile_v2','progress_v2','auth_v2','public_v2','conversational_onboarding'];
        FLAGS.forEach(function (flag) {
          var raw = url.get(flag);
          var val = (raw === '0' || raw === 'false') ? false
            : (raw === '1' || raw === 'true') ? true
            : (typeof stored[flag] === 'boolean') ? stored[flag]
            : true;
          if (val) H.setAttribute('data-' + flag.replace(/_/g, '-'), '1');
        });
      } catch (_) {
        ['chat-v2','train-v2','nutrition-v2','profile-v2','progress-v2','auth-v2','public-v2','conversational-onboarding'].forEach(function (f) {
          H.setAttribute('data-' + f, '1');
        });
      }
    })();
  </script>`;

let injected = 0;
let skipped = 0;
let removed = 0;
const problems = [];

for (const rel of HTML_ENTRIES) {
  const full = path.join(rootDir, rel);
  if (!fs.existsSync(full)) {
    problems.push(`missing: ${rel}`);
    continue;
  }
  let html = fs.readFileSync(full, "utf8");

  // Remove any older boot variant we may have put in /app/index.html so every
  // file ends up with the canonical block. Sentinel match wins if present.
  const olderMarkers = [
    /\s*<!--\s*No-flash theme[\s\S]*?<\/script>\s*/,
  ];
  for (const re of olderMarkers) {
    const next = html.replace(re, "");
    if (next !== html) {
      removed++;
      html = next;
    }
  }

  if (html.includes(SENTINEL)) {
    skipped++;
    continue;
  }

  // Insert right after </title>. Preserves the line break + indentation.
  const titleEnd = html.match(/<\/title>\s*(?:\r?\n)?/);
  if (!titleEnd) {
    problems.push(`no </title> in ${rel}`);
    continue;
  }
  const insertAt = titleEnd.index + titleEnd[0].length;
  const next = html.slice(0, insertAt) + BOOT_BLOCK + "\n" + html.slice(insertAt);

  if (dryRun) {
    console.log(`WOULD INJECT: ${rel}`);
  } else {
    fs.writeFileSync(full, next, "utf8");
    console.log(`injected:     ${rel}`);
  }
  injected++;
}

console.log("");
console.log(`injected: ${injected}`);
console.log(`skipped (already had sentinel): ${skipped}`);
console.log(`older-variants removed pre-inject: ${removed}`);
if (problems.length) {
  console.log("problems:");
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
