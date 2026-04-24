// Screenshot the 100 widget-v2 emissions using a local static HTTP server
// + Playwright + the viewer.html page in this directory.
//
// Only renders emissions where a widget actually fired (skips "no_widget" rows).
// Produces .widget-gallery/<id>.png per emission.

import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const GALLERY = path.resolve(ROOT, process.env.GALLERY_DIR || ".widget-gallery");
const IN_PATH = path.resolve(__dirname, "grades", process.env.GRADES_FILE || "2026-04-24-scored.jsonl");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function mime(p) { return MIME[path.extname(p).toLowerCase()] || "application/octet-stream"; }

function startServer(port = 4780) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        // /viewer.html served from the widget-diagnose directory
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath;
        if (urlPath === "/viewer.html") {
          filePath = path.join(__dirname, "viewer.html");
        } else if (urlPath.startsWith("/")) {
          filePath = path.join(ROOT, urlPath);
        }
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
          res.statusCode = 404; res.end("not found: " + urlPath); return;
        }
        const buf = await fs.readFile(filePath);
        res.setHeader("Content-Type", mime(filePath));
        res.end(buf);
      } catch (e) {
        res.statusCode = 500; res.end(String(e));
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function b64urlEncode(obj) {
  const json = JSON.stringify(obj);
  // utf8 → base64
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main() {
  await fs.mkdir(GALLERY, { recursive: true });
  const raw = await fs.readFile(IN_PATH, "utf8");
  const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const renderable = rows.filter((r) => r.payload && r.family_fired && r.family_fired !== "legacy");
  console.log(`Rendering ${renderable.length} of ${rows.length} emissions (skipping ${rows.length - renderable.length} prose-only + legacy).`);

  const server = await startServer(4780);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });

  let done = 0;
  for (const r of renderable) {
    const page = await ctx.newPage();
    const payloadParam = b64urlEncode(r.payload);
    const url = `http://127.0.0.1:4780/viewer.html?family=${encodeURIComponent(r.family_fired)}&payload=${payloadParam}&theme=mint`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector("body[data-ready='1']", { timeout: 10000 }).catch(() => {});
      // give any async chart libs a moment
      await page.waitForTimeout(300);
      const mount = await page.$("#mount");
      const out = path.join(GALLERY, `${String(r.id).padStart(3, "0")}_${r.family_fired}_${r.type_fired || "none"}.png`);
      if (mount) {
        await mount.screenshot({ path: out, omitBackground: false });
      } else {
        await page.screenshot({ path: out });
      }
      done += 1;
      if (done % 10 === 0) console.log(`  ${done}/${renderable.length} screenshots written`);
    } catch (e) {
      console.warn(`  #${r.id} failed: ${e.message}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  server.close();
  console.log(`\nDone. ${done} screenshots → ${GALLERY}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
