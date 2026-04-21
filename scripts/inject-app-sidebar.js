// scripts/inject-app-sidebar.js
// Replaces the earlier .app-crossnav top bar with a left-side .app-sidebar
// matching the chat page's sidebar style (brand + SECTIONS), so navigation
// across /app/ sections feels consistent with the chat page. Idempotent.
//
// Run: node scripts/inject-app-sidebar.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "app/train/index.html",
  "app/nutrition/index.html",
  "app/progress/index.html",
  "app/profile/index.html",
];

const NEW_SENTINEL = "<!-- app-sidebar: left nav bar linking app sections -->";
// Match the entire old crossnav aside (sentinel + <aside>...</aside>)
const OLD_BLOCK_RE = /\s*<!-- app-crossnav: fixed top bar linking app sections -->\s*<aside class="app-crossnav"[\s\S]*?<\/aside>\s*\n/;

const MARKUP = `
  ${NEW_SENTINEL}
  <aside class="app-sidebar" aria-label="App navigation">
    <div class="app-sidebar-head">
      <a class="app-sidebar-brand" href="/">em<b>∴</b>rsus</a>
    </div>
    <nav class="app-sidebar-sections">
      <div class="app-sidebar-sections-label">Sections</div>
      <a class="app-sidebar-section" data-section="chat" href="/app/"><span class="app-sidebar-section-dot"></span>Chat</a>
      <a class="app-sidebar-section" data-section="train" href="/app/train/"><span class="app-sidebar-section-dot"></span>Train</a>
      <a class="app-sidebar-section" data-section="nutrition" href="/app/nutrition/"><span class="app-sidebar-section-dot"></span>Nutrition</a>
      <a class="app-sidebar-section" data-section="progress" href="/app/progress/"><span class="app-sidebar-section-dot"></span>Progress</a>
      <a class="app-sidebar-section" data-section="profile" href="/app/profile/"><span class="app-sidebar-section-dot"></span>Profile</a>
    </nav>
    <script>
      (function () {
        var p = location.pathname;
        var key = /^\\/app\\/train/.test(p) ? 'train'
          : /^\\/app\\/nutrition/.test(p) ? 'nutrition'
          : /^\\/app\\/progress/.test(p) ? 'progress'
          : /^\\/app\\/profile/.test(p) ? 'profile'
          : 'chat';
        var host = document.currentScript.parentElement;
        var el = host.querySelector('[data-section="' + key + '"]');
        if (el) el.classList.add('is-active');
      })();
    </script>
  </aside>
`;

let replaced = 0;
let skipped = 0;
let fresh_injected = 0;

for (const rel of TARGETS) {
  const full = path.join(rootDir, rel);
  if (!fs.existsSync(full)) {
    console.log(`MISSING: ${rel}`);
    continue;
  }
  let html = fs.readFileSync(full, "utf8");

  if (html.includes(NEW_SENTINEL)) {
    skipped++;
    console.log(`skipped (already has new sentinel): ${rel}`);
    continue;
  }

  if (OLD_BLOCK_RE.test(html)) {
    html = html.replace(OLD_BLOCK_RE, MARKUP);
    fs.writeFileSync(full, html, "utf8");
    replaced++;
    console.log(`replaced crossnav -> sidebar: ${rel}`);
    continue;
  }

  // No old block present — fall back to injecting right after <body ...>
  const bodyOpen = html.match(/<body[^>]*>\s*(?:\r?\n)?/);
  if (!bodyOpen) {
    console.log(`NO <body>: ${rel}`);
    continue;
  }
  const insertAt = bodyOpen.index + bodyOpen[0].length;
  html = html.slice(0, insertAt) + MARKUP + html.slice(insertAt);
  fs.writeFileSync(full, html, "utf8");
  fresh_injected++;
  console.log(`injected fresh: ${rel}`);
}

console.log("");
console.log(`replaced: ${replaced}, fresh: ${fresh_injected}, skipped: ${skipped}`);
