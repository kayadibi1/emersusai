// scripts/inject-no-flash-boot.js
// Injects a synchronous pre-paint <script> into the <head> of every HTML
// entry listed below. The script resolves data-theme BEFORE CSS loads,
// eliminating the FOUC caused by deferred module scripts.
//
// Idempotent: detects the sentinel comment and skips already-injected files.
// Run: node scripts/inject-no-flash-boot.js [--dry-run] [--force]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

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
  "about/index.html",
  "editorial-policy/index.html",
];

const SENTINEL = "<!-- no-flash-boot: resolves data-theme pre-paint -->";

const BOOT_BLOCK = `  ${SENTINEL}
  <script>
    (function () {
      var H = document.documentElement;
      try {
        var saved = localStorage.getItem('emersus-theme');
        // Default to Graphite·Jade (mint, dark) for new visitors. Existing
        // users keep whatever they've saved. System prefers-color-scheme is
        // ignored by design; users switch in Settings.
        var theme = (saved === 'mint' || saved === 'paper') ? saved : 'mint';
        H.setAttribute('data-theme', theme);
      } catch (_) { H.setAttribute('data-theme', 'mint'); }
      // Auth pre-paint gate for /app/**. Without this, an unauthenticated
      // visitor clicking "Chat" sees the full chat UI flash for ~300 ms
      // (React mounts before the async requireAuth() -> config fetch chain
      // finishes). Probe for any sb-*-auth-token key in localStorage; if
      // absent, redirect to /auth/login/ synchronously with a next= param.
      // A stale token still hits the async redirect from requireAuth()
      // later — but the cold-visitor path no longer flashes.
      try {
        if (location.pathname.indexOf('/app/') === 0) {
          var hasSession = false;
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf('sb-') === 0 && k.indexOf('auth-token') >= 0) {
              hasSession = true; break;
            }
          }
          if (!hasSession) {
            var returnTo = location.pathname + location.search;
            location.replace('/auth/login/?next=' + encodeURIComponent(returnTo));
          }
        }
      } catch (_) { /* localStorage disabled; async requireAuth will handle */ }
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
    // Pre-Phase-2 sentinel: the FLAGS-iterating boot block tagged with the
    // older comment text. Strip so the new SENTINEL block can take its place.
    /[ \t]*<!-- no-flash-boot: resolves data-theme \+ v2 flags pre-paint -->[\s\S]*?<\/script>\s*/,
    // Phase-2 sentinel: kept setting v2 attrs unconditionally; superseded
    // by Phase 5 (data attributes no longer set; CSS uses body classes).
    /[ \t]*<!-- no-flash-boot: resolves data-theme \+ v2 attrs pre-paint -->[\s\S]*?<\/script>\s*/,
  ];
  for (const re of olderMarkers) {
    const next = html.replace(re, "");
    if (next !== html) {
      removed++;
      html = next;
    }
  }

  if (html.includes(SENTINEL)) {
    if (!force) {
      skipped++;
      continue;
    }
    // --force: strip the existing sentinel block so we can re-insert the
    // canonical BOOT_BLOCK below. Matches from the sentinel comment through
    // the closing </script> greedily, including the leading indentation.
    const stripped = html.replace(
      /[ \t]*<!-- no-flash-boot:[\s\S]*?<\/script>\s*/,
      ""
    );
    if (stripped === html) {
      problems.push(`sentinel present but regex failed on ${rel}`);
      continue;
    }
    html = stripped;
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
