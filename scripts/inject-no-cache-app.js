// scripts/inject-no-cache-app.js
// Injects Cache-Control: no-cache meta tags into every authenticated /app/*
// and /auth/* HTML entry. Prevents browsers from using a stale HTML copy
// after a deploy (the issue that caused legacy-profile flash → /index-v2/
// 404 on 2026-04-15 after the index.html/index-v2.html consolidation).
//
// Adds sentinel once per file; idempotent.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SENTINEL = "<!-- no-cache-app: always revalidate app HTML -->";
const BLOCK = `  ${SENTINEL}
  <meta http-equiv="Cache-Control" content="no-cache, must-revalidate">`;

// Only the authenticated app shell + auth SPA. Static/legal pages (landing,
// privacy, terms, contact, demo, CHD) stay cache-friendly.
const TARGET_DIRS = ["app", "auth"];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

let injected = 0;
let skipped = 0;
for (const target of TARGET_DIRS) {
  for (const file of walk(path.join(rootDir, target))) {
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    const html = fs.readFileSync(file, "utf8");
    if (html.includes(SENTINEL)) {
      skipped++;
      continue;
    }
    // If the existing no-cache-legacy block is already there (redirect pages),
    // this new sentinel is harmless but redundant — skip.
    if (html.includes("no-cache-legacy")) {
      skipped++;
      continue;
    }
    const charsetMatch = html.match(/<meta\s+charset="utf-8"\s*\/?>\s*(?:\r?\n)?/i);
    if (!charsetMatch) {
      console.log(`NO <meta charset>: ${rel}`);
      continue;
    }
    const insertAt = charsetMatch.index + charsetMatch[0].length;
    const next = html.slice(0, insertAt) + BLOCK + "\n" + html.slice(insertAt);
    fs.writeFileSync(file, next, "utf8");
    injected++;
    console.log(`injected: ${rel}`);
  }
}

console.log("");
console.log(`injected: ${injected}, skipped: ${skipped}`);
