// scripts/inject-app-crossnav.js
// Injects a fixed-top cross-section nav bar into the 4 non-chat v2 app
// pages (train, nutrition v2, progress v2, profile v2). The nav gives
// users a way to move between /app/ sections without a sidebar. Chat
// (body.chat-page) renders its own sidebar SECTIONS list and is not
// targeted.
//
// Idempotent via the sentinel comment. Run: node scripts/inject-app-crossnav.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "app/train/index.html",
  "app/nutrition/index-v2.html",
  "app/progress/index-v2.html",
  "app/profile/index-v2.html",
];

const SENTINEL = "<!-- app-crossnav: fixed top bar linking app sections -->";

const MARKUP = `  ${SENTINEL}
  <aside class="app-crossnav" aria-label="App sections">
    <a href="/app/" data-section="chat">Chat</a>
    <a href="/app/train/" data-section="train">Train</a>
    <a href="/app/nutrition/" data-section="nutrition">Nutrition</a>
    <a href="/app/progress/" data-section="progress">Progress</a>
    <a href="/app/profile/" data-section="profile">Profile</a>
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

let injected = 0;
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
    console.log(`skipped (already had sentinel): ${rel}`);
    continue;
  }
  const bodyOpenMatch = html.match(/<body[^>]*>\s*(?:\r?\n)?/);
  if (!bodyOpenMatch) {
    console.log(`NO <body>: ${rel}`);
    continue;
  }
  const insertAt = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const next = html.slice(0, insertAt) + MARKUP + html.slice(insertAt);
  fs.writeFileSync(full, next, "utf8");
  injected++;
  console.log(`injected: ${rel}`);
}

console.log("");
console.log(`injected: ${injected}, skipped: ${skipped}`);
