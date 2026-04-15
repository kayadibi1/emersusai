// scripts/inject-no-cache-legacy.js
// Adds <meta http-equiv="Cache-Control" content="no-cache..."> to every HTML
// entry that contains a window.location.replace(...) redirect. Without this,
// browsers cache the legacy HTML and users miss the redirect to v2 after
// flipping a feature flag until they hard-reload.
//
// Idempotent via sentinel. Run: node scripts/inject-no-cache-legacy.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SENTINEL = "<!-- no-cache-legacy: defeat browser cache on redirect page -->";
const BLOCK = `  ${SENTINEL}
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">`;

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
const files = walk(rootDir);
for (const file of files) {
  const rel = path.relative(rootDir, file).replace(/\\/g, "/");
  const html = fs.readFileSync(file, "utf8");
  if (!/window\.location\.replace/.test(html)) continue;
  if (html.includes(SENTINEL)) {
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

console.log("");
console.log(`injected: ${injected}, skipped: ${skipped}`);
