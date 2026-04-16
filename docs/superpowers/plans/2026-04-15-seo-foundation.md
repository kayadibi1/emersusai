# SEO Foundation (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every baseline SEO gap on emersus.ai so the site is crawlable, indexable, correctly rendered in social shares, properly structured for AI search engines, and well-performant — without adding any content or content infrastructure.

**Architecture:** No build-step templating exists (MPA Vite build copies static HTML files verbatim). Meta tags, canonicals, OG tags, and JSON-LD are therefore added inline to each public page's `<head>`. New static files (`robots.txt`, `sitemap.xml`, `manifest.webmanifest`, favicon) live at the repo root and are registered with Vite's `copyStaticFiles` plugin so they land in `dist/`. The `/chat/ → /app/` redirect is migrated from a JS meta-refresh to a server-side 301 in the Hetzner Caddyfile (`infra/Caddyfile`, untracked — SSH to the box).

**Tech Stack:** Static HTML5, JSON-LD (schema.org), Vite 5 MPA build, Caddy 2 (prod), SVG favicons, web manifest. No new dependencies.

**Public pages in scope (SEO-indexable):**
- `/` — `index.html`
- `/contact/` — `contact/index.html`
- `/privacy/` — `privacy/index.html`
- `/terms/` — `terms/index.html`
- `/consumer-health-data/` — `consumer-health-data/index.html`
- `/demo/` — `demo/index.html`

**Auth-gated pages needing `noindex` (not indexable):**
- `/app/`, `/app/train/`, `/app/nutrition/`, `/app/progress/`, `/app/profile/`
- `/app/workout/` (parent page; sub-pages already have noindex)
- `/chat/` (redirect page)
- `/auth/`, `/auth/login/`, `/auth/signup/`, `/auth/forgot-password/`, `/auth/reset-password/`, `/auth/callback/`
- `/admin/` and all admin sub-pages

**Production domain:** `https://emersus.ai`

**Verification tools used throughout this plan:**
- `npm run build` — verifies Vite MPA build succeeds and copies static files
- `curl -sI` and `curl -s` — verifies file presence and content
- Google Rich Results Test: https://search.google.com/test/rich-results
- Schema.org validator: https://validator.schema.org/
- Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/
- Lighthouse (DevTools → Lighthouse → SEO + Performance + Best Practices)

---

## Task 1: Create robots.txt

**Files:**
- Create: `robots.txt`

- [ ] **Step 1: Create the file at the repo root**

```
# robots.txt for https://emersus.ai
# Last updated: 2026-04-15

User-agent: *
Allow: /
Disallow: /api/
Disallow: /app/
Disallow: /auth/
Disallow: /admin/
Disallow: /chat/

# AI crawlers — explicitly allowed so our content can be cited
# by ChatGPT, Claude, Perplexity, and Google AI Overviews.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bytespider
Allow: /

User-agent: CCBot
Allow: /

Sitemap: https://emersus.ai/sitemap.xml
```

- [ ] **Step 2: Commit**

```bash
git add robots.txt
git commit -m "seo: add robots.txt allowing AI crawlers, disallowing auth/app/api"
```

---

## Task 2: Create sitemap.xml

**Files:**
- Create: `sitemap.xml`

- [ ] **Step 1: Create the file at the repo root**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://emersus.ai/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://emersus.ai/demo/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://emersus.ai/contact/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://emersus.ai/privacy/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://emersus.ai/terms/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://emersus.ai/consumer-health-data/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
```

- [ ] **Step 2: Commit**

```bash
git add sitemap.xml
git commit -m "seo: add sitemap.xml listing all public pages"
```

---

## Task 3: Update vite.config.js to copy robots.txt + sitemap.xml to dist

**Files:**
- Modify: `vite.config.js:68-72`

- [ ] **Step 1: Update the copyStaticFiles call**

Change:
```js
  plugins: [
    copyStaticFiles([
      "emersus-logo.png",
    ]),
  ],
```

To:
```js
  plugins: [
    copyStaticFiles([
      "emersus-logo.png",
      "emersus_mark_fibonacci_blue.svg",
      "robots.txt",
      "sitemap.xml",
      "favicon.ico",
      "favicon.svg",
      "apple-touch-icon.png",
      "manifest.webmanifest",
    ]),
  ],
```

Note: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, and `manifest.webmanifest` will be created in later tasks. The `copyStaticFiles` plugin already handles missing files gracefully (`if (!fs.existsSync(source)) continue;` at vite.config.js:47).

- [ ] **Step 2: Verify Vite build copies robots.txt and sitemap.xml**

Run:
```bash
npm run build
```

Expected: Build succeeds. Check:
```bash
ls dist/robots.txt dist/sitemap.xml
```

Expected: Both files present in `dist/`.

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "seo: copy robots.txt, sitemap.xml, favicons, manifest to dist build"
```

---

## Task 4: Add noindex to all auth-gated and admin pages

**Files:**
- Modify: `app/index.html` (add meta robots tag in `<head>`)
- Modify: `app/train/index.html`
- Modify: `app/nutrition/index.html`
- Modify: `app/progress/index.html`
- Modify: `app/profile/index.html`
- Modify: `app/workout/index.html`
- Modify: `chat/index.html`
- Modify: `auth/index.html`
- Modify: `auth/login/index.html`
- Modify: `auth/signup/index.html`
- Modify: `auth/forgot-password/index.html`
- Modify: `auth/reset-password/index.html`
- Modify: `auth/callback/index.html`
- Modify: `admin/index.html`, `admin/alerts/index.html`, `admin/candidates/index.html`, `admin/feeds/index.html`, `admin/jobs/index.html`, `admin/topics/index.html`

- [ ] **Step 1: Add the noindex tag to each page**

In each file's `<head>` section, immediately after the existing `<meta name="viewport" ...>` tag, insert:

```html
<meta name="robots" content="noindex, nofollow">
```

Tip: Use a single find-and-insert across files — the exact pattern to insert after is:
```
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```
or the shorter variant some pages use:
```
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Some pages already have `<meta name="robots" content="noindex">` (e.g. `app/workout/session/index.html`, `app/progress/exercise/index.html`). Do NOT add a duplicate — `grep -l 'name="robots"' app/**/*.html chat/*.html auth/**/*.html admin/**/*.html` will list files that already have one.

- [ ] **Step 2: Verify every listed page has the tag**

Run:
```bash
for f in app/index.html app/train/index.html app/nutrition/index.html \
         app/progress/index.html app/profile/index.html app/workout/index.html \
         chat/index.html auth/index.html auth/login/index.html auth/signup/index.html \
         auth/forgot-password/index.html auth/reset-password/index.html \
         auth/callback/index.html admin/index.html admin/alerts/index.html \
         admin/candidates/index.html admin/feeds/index.html admin/jobs/index.html \
         admin/topics/index.html; do
  if ! grep -q 'name="robots"' "$f"; then echo "MISSING: $f"; fi
done
```

Expected: No output (all pages have the tag).

- [ ] **Step 3: Commit**

```bash
git add app/ chat/ auth/ admin/
git commit -m "seo: add noindex,nofollow to auth-gated and admin pages"
```

---

## Task 5: Add canonical URLs to all public pages

**Files:**
- Modify: `index.html` (add `<link rel="canonical">`)
- Modify: `contact/index.html`
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `consumer-health-data/index.html`
- Modify: `demo/index.html`

- [ ] **Step 1: Add the canonical tag to each public page**

In each public page's `<head>` section, after the existing `<title>` tag, insert the appropriate canonical tag:

`index.html`:
```html
<link rel="canonical" href="https://emersus.ai/">
```

`contact/index.html`:
```html
<link rel="canonical" href="https://emersus.ai/contact/">
```

`privacy/index.html`:
```html
<link rel="canonical" href="https://emersus.ai/privacy/">
```

`terms/index.html`:
```html
<link rel="canonical" href="https://emersus.ai/terms/">
```

`consumer-health-data/index.html`:
```html
<link rel="canonical" href="https://emersus.ai/consumer-health-data/">
```

`demo/index.html`:
```html
<link rel="canonical" href="https://emersus.ai/demo/">
```

- [ ] **Step 2: Verify canonical tags are present**

Run:
```bash
for f in index.html contact/index.html privacy/index.html terms/index.html \
         consumer-health-data/index.html demo/index.html; do
  echo "=== $f ==="
  grep 'rel="canonical"' "$f" || echo "MISSING"
done
```

Expected: Each file shows its canonical tag.

- [ ] **Step 3: Commit**

```bash
git add index.html contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "seo: add canonical URL tags to all public pages"
```

---

## Task 6: Add meta descriptions to public pages missing them

**Files:**
- Modify: `contact/index.html`
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `consumer-health-data/index.html`
- Modify: `demo/index.html`

Note: `index.html` already has a meta description at line 6.

- [ ] **Step 1: Add meta description to each page**

In each file's `<head>`, immediately after the `<meta name="viewport" ...>` tag, insert:

`contact/index.html`:
```html
<meta name="description" content="Get in touch with Emersus AI — evidence-based fitness and nutrition intelligence. Email info@emersus.ai for partnerships, press, or product questions.">
```

`privacy/index.html`:
```html
<meta name="description" content="How Emersus AI collects, uses, and protects your personal and health data. Plain-English explanations of our data handling, retention, and GDPR/CCPA rights.">
```

`terms/index.html`:
```html
<meta name="description" content="Terms of Service for Emersus AI. Acceptable use, health disclaimers, account terms, and liability for using our evidence-based fitness AI chat.">
```

`consumer-health-data/index.html`:
```html
<meta name="description" content="Consumer Health Data Privacy Policy for Emersus AI, covering Washington State's My Health My Data Act and similar consumer health data protections.">
```

`demo/index.html`:
```html
<meta name="description" content="See how Emersus AI answers fitness questions with citations from peer-reviewed research. Interactive demo with real protein, training, and recovery queries.">
```

- [ ] **Step 2: Verify all 6 public pages have a meta description of 120-160 chars**

Run:
```bash
for f in index.html contact/index.html privacy/index.html terms/index.html \
         consumer-health-data/index.html demo/index.html; do
  desc=$(grep -oE '<meta name="description" content="[^"]*"' "$f" | head -1)
  len=$(echo "$desc" | wc -c)
  echo "$f: $len chars"
done
```

Expected: Each file prints a reasonable byte count (roughly 150-220 including the `<meta ...>` wrapper, meaning the actual description is ~120-180 chars).

- [ ] **Step 3: Commit**

```bash
git add contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "seo: add meta descriptions to contact/privacy/terms/chd/demo pages"
```

---

## Task 7: Generate the Open Graph preview image

**Files:**
- Create: `og-image.png` (1200×630, at repo root)

- [ ] **Step 1: Create a 1200×630 Open Graph image**

Requirements:
- 1200×630 pixels exactly (Facebook/LinkedIn/Twitter spec)
- PNG format
- Under 300 KB (target ~100 KB)
- Must display the Emersus logo and tagline ("Evidence-based fitness intelligence")
- Readable at 600×315 (LinkedIn thumbnail size)

Option A — generate programmatically with a one-off Node script:

Create `scripts/gen-og-image.mjs`:
```js
// Run: node scripts/gen-og-image.mjs
// Requires: npm i -D sharp (temporary dev dependency)
import sharp from "sharp";
import fs from "node:fs";

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="290" font-family="Space Grotesk, sans-serif" font-size="96" font-weight="700" fill="#e6edf3">EMERSUS</text>
  <text x="80" y="380" font-family="Space Grotesk, sans-serif" font-size="42" font-weight="500" fill="#8b949e">Evidence-based fitness intelligence.</text>
  <text x="80" y="440" font-family="Space Grotesk, sans-serif" font-size="42" font-weight="500" fill="#8b949e">Every answer cited.</text>
  <text x="80" y="560" font-family="JetBrains Mono, monospace" font-size="24" fill="#58a6ff">emersus.ai · 1M+ papers indexed</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile("og-image.png");
console.log("Wrote og-image.png");
```

Then run:
```bash
npm install --save-dev sharp
node scripts/gen-og-image.mjs
npm uninstall sharp   # we only needed it once
rm scripts/gen-og-image.mjs
```

Option B — generate manually in Figma/Photoshop and save as `og-image.png`. Use the Emersus wordmark on a dark `#0e1117` → `#161b22` gradient.

- [ ] **Step 2: Verify the file exists and is under 300 KB**

Run:
```bash
ls -la og-image.png
file og-image.png
```

Expected: `og-image.png` exists, is a PNG, under 300 KB.

- [ ] **Step 3: Register the file in Vite's copyStaticFiles**

Modify `vite.config.js` — add `"og-image.png"` to the array from Task 3:
```js
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
    ]),
```

- [ ] **Step 4: Verify it lands in dist/**

Run:
```bash
npm run build && ls dist/og-image.png
```

Expected: File is present in dist.

- [ ] **Step 5: Commit**

```bash
git add og-image.png vite.config.js
git commit -m "seo: add 1200x630 Open Graph preview image"
```

---

## Task 8: Add Open Graph and Twitter Card tags to all public pages

**Files:**
- Modify: `index.html`
- Modify: `contact/index.html`
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `consumer-health-data/index.html`
- Modify: `demo/index.html`

- [ ] **Step 1: Add OG + Twitter tags to each page**

In each file's `<head>`, immediately after the canonical tag added in Task 5, insert the page-specific block:

`index.html`:
```html
<!-- Open Graph / Social -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Emersus AI — Evidence-based fitness intelligence">
<meta property="og:description" content="Every answer cited. Every protocol grounded in peer-reviewed research. No bro science — just the evidence.">
<meta property="og:url" content="https://emersus.ai/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Emersus AI — Evidence-based fitness intelligence">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Emersus AI — Evidence-based fitness intelligence">
<meta name="twitter:description" content="Every answer cited. Every protocol grounded in peer-reviewed research.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

`contact/index.html`:
```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Contact | Emersus AI">
<meta property="og:description" content="Get in touch with Emersus AI — partnerships, press, and product questions.">
<meta property="og:url" content="https://emersus.ai/contact/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Contact | Emersus AI">
<meta name="twitter:description" content="Get in touch with Emersus AI.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

`privacy/index.html`:
```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Privacy Policy | Emersus AI">
<meta property="og:description" content="How Emersus AI collects, uses, and protects your personal and health data.">
<meta property="og:url" content="https://emersus.ai/privacy/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Privacy Policy | Emersus AI">
<meta name="twitter:description" content="How Emersus AI handles your personal and health data.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

`terms/index.html`:
```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Terms of Service | Emersus AI">
<meta property="og:description" content="Terms for using Emersus AI. Acceptable use, health disclaimers, and account terms.">
<meta property="og:url" content="https://emersus.ai/terms/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Terms of Service | Emersus AI">
<meta name="twitter:description" content="Terms of Service for Emersus AI.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

`consumer-health-data/index.html`:
```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Consumer Health Data Privacy Policy | Emersus AI">
<meta property="og:description" content="Consumer health data rights and protections under Washington's My Health My Data Act.">
<meta property="og:url" content="https://emersus.ai/consumer-health-data/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Consumer Health Data Privacy | Emersus AI">
<meta name="twitter:description" content="Consumer health data rights under state privacy laws.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

`demo/index.html`:
```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="Emersus AI">
<meta property="og:title" content="Chat Demo | Emersus AI">
<meta property="og:description" content="See how Emersus AI answers fitness questions with citations from peer-reviewed research.">
<meta property="og:url" content="https://emersus.ai/demo/">
<meta property="og:image" content="https://emersus.ai/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Chat Demo | Emersus AI">
<meta name="twitter:description" content="Interactive demo of Emersus AI's evidence-based chat.">
<meta name="twitter:image" content="https://emersus.ai/og-image.png">
```

- [ ] **Step 2: Verify all public pages have both og:image and twitter:card**

Run:
```bash
for f in index.html contact/index.html privacy/index.html terms/index.html \
         consumer-health-data/index.html demo/index.html; do
  missing=""
  grep -q 'og:image' "$f" || missing="og:image "
  grep -q 'twitter:card' "$f" || missing="${missing}twitter:card"
  if [ -n "$missing" ]; then echo "$f MISSING: $missing"; fi
done
```

Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add index.html contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "seo: add Open Graph and Twitter Card tags to all public pages"
```

---

## Task 9: Generate favicons from existing logo

**Files:**
- Create: `favicon.svg` (copy of `emersus_mark_fibonacci_blue.svg` with cache-busting name)
- Create: `favicon.ico` (16×16 + 32×32 multi-size)
- Create: `apple-touch-icon.png` (180×180 PNG for iOS home screen)

- [ ] **Step 1: Create favicon.svg**

Copy the existing SVG mark:
```bash
cp emersus_mark_fibonacci_blue.svg favicon.svg
```

- [ ] **Step 2: Generate favicon.ico and apple-touch-icon.png**

Create `scripts/gen-favicons.mjs`:
```js
// Run: node scripts/gen-favicons.mjs
// Requires: npm i -D sharp png-to-ico
import sharp from "sharp";
import pngToIco from "png-to-ico";
import fs from "node:fs";

const svg = fs.readFileSync("emersus_mark_fibonacci_blue.svg");

// apple-touch-icon: 180x180 PNG
await sharp(svg, { density: 300 }).resize(180, 180).png().toFile("apple-touch-icon.png");

// favicon sizes for .ico
const sizes = [16, 32, 48];
const buffers = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 300 }).resize(s, s).png().toBuffer())
);
const icoBuffer = await pngToIco(buffers);
fs.writeFileSync("favicon.ico", icoBuffer);

console.log("Wrote favicon.ico, apple-touch-icon.png");
```

Then run:
```bash
npm install --save-dev sharp png-to-ico
node scripts/gen-favicons.mjs
npm uninstall sharp png-to-ico
rm scripts/gen-favicons.mjs
```

- [ ] **Step 3: Verify files exist and look reasonable**

Run:
```bash
ls -la favicon.svg favicon.ico apple-touch-icon.png
file favicon.ico apple-touch-icon.png
```

Expected: All three exist; `favicon.ico` is "MS Windows icon resource"; `apple-touch-icon.png` is PNG 180×180.

- [ ] **Step 4: Verify Vite copies them to dist/**

They were already added to `copyStaticFiles` in Task 3. Run:
```bash
npm run build
ls dist/favicon.ico dist/favicon.svg dist/apple-touch-icon.png
```

Expected: All three exist in dist.

- [ ] **Step 5: Commit**

```bash
git add favicon.svg favicon.ico apple-touch-icon.png
git commit -m "seo: generate favicon (svg/ico) and apple-touch-icon from logo mark"
```

---

## Task 10: Link favicon and apple-touch-icon from every HTML page

**Files:**
- Modify: All 6 public pages + all auth-gated pages listed in Task 4

- [ ] **Step 1: Add favicon links to every HTML page**

In each `<head>` section, after the `<meta name="viewport" ...>` tag, insert:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0e1117">
```

This applies to every HTML page in the repo (public pages, app pages, auth pages, admin pages, chat redirect).

Files to modify (total: ~25 HTML files):
- All 6 public pages
- All pages from Task 4 (auth/app/admin/chat)
- Plus any app sub-pages that weren't covered: `app/workout/session/index.html`, `app/workout/cardio/index.html`, `app/workout/climb/index.html`, `app/workout/swim/index.html`, `app/progress/session/index.html`, `app/progress/exercise/index.html`

- [ ] **Step 2: Verify every HTML page links the favicon**

Run:
```bash
find . -name "index.html" -not -path "./node_modules/*" -not -path "./dist/*" | while read f; do
  grep -q 'rel="icon"' "$f" || echo "MISSING favicon: $f"
done
```

Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add index.html app/ auth/ admin/ chat/ contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "seo: link favicon, apple-touch-icon, theme-color from every page"
```

---

## Task 11: Create web manifest (PWA basics)

**Files:**
- Create: `manifest.webmanifest`

- [ ] **Step 1: Create the manifest at repo root**

```json
{
  "name": "Emersus AI",
  "short_name": "Emersus",
  "description": "Evidence-based fitness intelligence. Every answer cited.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0e1117",
  "theme_color": "#0e1117",
  "icons": [
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png"
    },
    {
      "src": "/favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

- [ ] **Step 2: Link manifest from every page**

In each HTML page's `<head>`, immediately after the favicon lines added in Task 10, add:

```html
<link rel="manifest" href="/manifest.webmanifest">
```

- [ ] **Step 3: Verify the manifest validates**

Run:
```bash
npm run build
```

Then after deploying, open DevTools → Application → Manifest — it should parse without errors. Locally you can use:
```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add manifest.webmanifest index.html app/ auth/ admin/ chat/ contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "seo: add web manifest and link it from every page"
```

---

## Task 12: Add Organization + WebSite JSON-LD to landing page

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Insert JSON-LD script block**

In `index.html`, immediately before the closing `</head>` tag, insert:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://emersus.ai/#organization",
      "name": "Emersus AI",
      "url": "https://emersus.ai/",
      "logo": {
        "@type": "ImageObject",
        "url": "https://emersus.ai/emersus-logo.png",
        "width": 512,
        "height": 512
      },
      "description": "Evidence-based fitness and nutrition AI chat that grounds every recommendation in peer-reviewed research.",
      "email": "info@emersus.ai",
      "foundingDate": "2025",
      "slogan": "Evidence-based fitness intelligence"
    },
    {
      "@type": "WebSite",
      "@id": "https://emersus.ai/#website",
      "url": "https://emersus.ai/",
      "name": "Emersus AI",
      "description": "Evidence-based fitness intelligence. Every answer cited.",
      "publisher": { "@id": "https://emersus.ai/#organization" },
      "inLanguage": "en-US"
    }
  ]
}
</script>
```

- [ ] **Step 2: Validate the JSON-LD**

Run:
```bash
node -e "const html = require('fs').readFileSync('index.html','utf8'); const m = html.match(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/); JSON.parse(m[1]); console.log('OK');"
```

Expected: `OK` (valid JSON).

- [ ] **Step 3: Build and deploy, then validate with Google Rich Results Test**

After deploying (if applicable), paste `https://emersus.ai/` into https://search.google.com/test/rich-results. Expected: Organization and WebSite schemas detected with no errors.

Alternative (no deploy needed): copy the JSON-LD block contents into https://validator.schema.org/ and confirm zero errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "seo: add Organization + WebSite JSON-LD schemas to landing page"
```

---

## Task 13: Add WebApplication JSON-LD to landing page

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add a second JSON-LD block below the one from Task 12**

In `index.html`, immediately after the closing `</script>` of the JSON-LD block from Task 12, insert:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": "https://emersus.ai/#webapp",
  "name": "Emersus AI",
  "applicationCategory": "HealthApplication",
  "applicationSubCategory": "Fitness",
  "operatingSystem": "Web, iOS, Android",
  "url": "https://emersus.ai/",
  "description": "AI chat that answers fitness and nutrition questions with inline citations to peer-reviewed research. Over 1 million papers indexed.",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  },
  "featureList": [
    "Inline citations to peer-reviewed research",
    "Evidence grading (high / moderate / limited / insufficient)",
    "Peer-reviewed vs. preprint labeling",
    "Personalized workout and nutrition protocols",
    "Support for lifting, cardio, swim, and climbing"
  ],
  "publisher": { "@id": "https://emersus.ai/#organization" },
  "screenshot": "https://emersus.ai/og-image.png"
}
</script>
```

- [ ] **Step 2: Validate the JSON-LD**

Run:
```bash
node -e "
const html = require('fs').readFileSync('index.html','utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)];
console.log('Found', blocks.length, 'JSON-LD blocks');
blocks.forEach((m, i) => { JSON.parse(m[1]); console.log('Block', i+1, 'OK'); });
"
```

Expected: `Found 2 JSON-LD blocks`, both valid.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "seo: add WebApplication JSON-LD (HealthApplication category) to landing"
```

---

## Task 14: Add FAQPage JSON-LD to landing page

**Files:**
- Modify: `index.html`

**Context:** The landing page has 5 FAQ items implemented with `<details>/<summary>` elements at `index.html:480-502`. This task mirrors them as FAQPage JSON-LD so Google and AI engines can extract the Q&A without parsing HTML.

- [ ] **Step 1: Add the FAQPage JSON-LD block**

Immediately after the WebApplication block from Task 13, insert this exact markup (the 5 questions match `index.html:482-501` verbatim as of 2026-04-15):

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Where do the citations actually come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Retrieval runs over 1M+ indexed papers from PubMed, bioRxiv, medRxiv, CORE, and Semantic Scholar. Every citation points back to a real, resolvable DOI or PubMed ID — not a fabricated reference."
      }
    },
    {
      "@type": "Question",
      "name": "How do you decide what's credible?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Reranking weights study design, sample size, replication, RCR (relative citation ratio), and journal quality. Meta-analyses outrank single underpowered trials. Anecdotes, blog posts, and popular-press articles never enter the retrieval pool."
      }
    },
    {
      "@type": "Question",
      "name": "What if the evidence is mixed or insufficient?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The model flags it explicitly. If no strong studies exist, you'll see an \"insufficient evidence\" label rather than a fabricated confident answer. Honest uncertainty beats false confidence every time."
      }
    },
    {
      "@type": "Question",
      "name": "How does personalization work?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Your training history, equipment, injuries, and goals shape every protocol. The model doesn't recommend a barbell program if you only have dumbbells — and it respects constraints without fighting them."
      }
    },
    {
      "@type": "Question",
      "name": "What about very new research?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The corpus refreshes daily. New preprints on bioRxiv and medRxiv surface within 24 hours of indexing, flagged as \"preprint — not yet peer-reviewed\" so you can weigh them accordingly."
      }
    }
  ]
}
</script>
```

**If you edit the on-page `<details>` copy later**, update the JSON-LD in the same commit. Google will flag a mismatch between FAQPage schema and visible FAQ content.

- [ ] **Step 2: Validate the JSON-LD**

Run:
```bash
node -e "
const html = require('fs').readFileSync('index.html','utf8');
const blocks = [...html.matchAll(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/g)];
console.log('Found', blocks.length, 'JSON-LD blocks');
blocks.forEach((m, i) => { JSON.parse(m[1]); console.log('Block', i+1, 'OK'); });
"
```

Expected: `Found 3 JSON-LD blocks`, all valid.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "seo: add FAQPage JSON-LD mirroring existing details/summary FAQ"
```

---

## Task 15: Delete unused 6.5 MB hero PNG

**Files:**
- Delete: `neuron-hero-upscaled.png`

- [ ] **Step 1: Verify the file is not referenced anywhere**

Run:
```bash
grep -r "neuron-hero-upscaled" --include="*.html" --include="*.js" --include="*.css" --include="*.json" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
```

Expected: No matches. If any match is found, STOP and investigate before deleting.

- [ ] **Step 2: Delete the file**

```bash
rm neuron-hero-upscaled.png
```

- [ ] **Step 3: Verify build still succeeds**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -u neuron-hero-upscaled.png
git commit -m "perf: delete unused 6.5MB neuron-hero-upscaled.png"
```

---

## Task 16: Add width/height and loading="lazy" to images

**Files:**
- Modify: `index.html` (all `<img>` tags)
- Modify: All other HTML files with `<img>` tags

- [ ] **Step 1: Find all img tags missing width or height**

Run:
```bash
grep -rn "<img" --include="*.html" --exclude-dir=node_modules --exclude-dir=dist | grep -vE 'width="[0-9]+"[^>]*height="[0-9]+"|height="[0-9]+"[^>]*width="[0-9]+"'
```

Expected: A list of `<img>` tags missing dimensions.

- [ ] **Step 2: For each img, add width, height, and loading="lazy" (unless above the fold)**

For each `<img src="..." ...>` tag found:

- Above-the-fold images (logo in nav, hero illustrations): add `width="X" height="Y" fetchpriority="high"` with actual pixel dimensions
- Below-the-fold images: add `width="X" height="Y" loading="lazy" decoding="async"`

Example — nav logo:
```html
<!-- Before -->
<img src="/emersus-logo.png" alt="Emersus">
<!-- After -->
<img src="/emersus-logo.png" alt="Emersus" width="120" height="32" fetchpriority="high">
```

Use actual intrinsic image dimensions (check with `file emersus-logo.png` or `identify emersus-logo.png` if ImageMagick is installed).

- [ ] **Step 3: Verify no img lacks both dimensions**

Run the command from Step 1 again. Expected: No output (all `<img>` tags have width and height).

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "perf: add width/height/lazy-loading to all img tags (prevent CLS)"
```

---

## Task 17: Override Google Fonts with local font-display: swap

**Files:**
- Modify: `shared/design-tokens.css` (top of file)

- [ ] **Step 1: Determine the current font-loading strategy**

Open `shared/design-tokens.css` and scan the top of the file. If it already contains `@font-face` rules for JetBrains Mono or Space Grotesk, skip this task. If it doesn't (most likely), continue.

- [ ] **Step 2: Add font-display override at the top of design-tokens.css**

This ensures text renders in a fallback font immediately instead of blocking on the Google Fonts download:

```css
/* SEO / perf: ensure fonts never block text render.
   Google Fonts already sets font-display: swap in its generated CSS,
   but we add explicit @font-face with font-display: swap so our
   fallback behavior is not dependent on Google's CSS response. */
@font-face {
  font-family: "Space Grotesk Fallback";
  src: local("Arial"), local("Helvetica"), local("sans-serif");
  font-display: swap;
  ascent-override: 94%;
  descent-override: 25%;
  line-gap-override: 0%;
}
@font-face {
  font-family: "JetBrains Mono Fallback";
  src: local("Menlo"), local("Consolas"), local("monospace");
  font-display: swap;
}
```

And update the body/font-family references in `shared/design-tokens.css` and `shared/landing-v2.css` to include these fallbacks, e.g.:

```css
body { font-family: "Space Grotesk", "Space Grotesk Fallback", -apple-system, sans-serif; }
code, pre { font-family: "JetBrains Mono", "JetBrains Mono Fallback", Menlo, Consolas, monospace; }
```

- [ ] **Step 3: Verify fonts still render correctly**

Run:
```bash
npm run build
# Open dist/index.html in a browser
```

Expected: Page still uses Space Grotesk / JetBrains Mono once loaded; text appears in fallback font during the brief loading window instead of invisible.

- [ ] **Step 4: Commit**

```bash
git add shared/
git commit -m "perf: add fallback @font-face with font-display: swap"
```

---

## Task 18: Fix heading hierarchy on legal pages (skip from h1 to h3)

**Files:**
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `consumer-health-data/index.html`

- [ ] **Step 1: Audit heading structure on each page**

Run:
```bash
for f in privacy/index.html terms/index.html consumer-health-data/index.html; do
  echo "=== $f ==="
  grep -oE '<h[1-6]' "$f" | sort | uniq -c
done
```

Expected: Note which pages skip from `<h1>` directly to `<h3>`.

- [ ] **Step 2: Replace <h3> with <h2> for top-level sections**

In each file with a heading hierarchy gap, promote the top-level section headings from `<h3>` to `<h2>`. Sub-headings that were `<h4>` should become `<h3>`, and so on. Do NOT change the single `<h1>`.

Example — in `privacy/index.html`:
```html
<!-- Before -->
<h1>Privacy Policy</h1>
...
<h3>Information We Collect</h3>
<p>...</p>
<h4>Account Information</h4>
<!-- After -->
<h1>Privacy Policy</h1>
...
<h2>Information We Collect</h2>
<p>...</p>
<h3>Account Information</h3>
```

- [ ] **Step 3: Re-audit**

Run the command from Step 1. Expected: Each page now has `h1` (1), `h2` (multiple), `h3` (multiple) with no gaps.

- [ ] **Step 4: Commit**

```bash
git add privacy/ terms/ consumer-health-data/
git commit -m "seo: fix heading hierarchy on legal pages (h1->h2->h3)"
```

---

## Task 19: Add health disclaimer to footer on all public pages

**Files:**
- Modify: `index.html`
- Modify: `contact/index.html`
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `consumer-health-data/index.html`
- Modify: `demo/index.html`

- [ ] **Step 1: Identify the existing footer element on each page**

Each public page has a `<footer>` element. Locate it in each file.

- [ ] **Step 2: Add a disclaimer block inside each footer**

Add the following markup inside each `<footer>`, at the bottom, above any copyright line:

```html
<div class="footer-disclaimer" style="max-width:680px;margin:24px auto 0;padding:16px 0;border-top:1px solid rgba(255,255,255,.08);font-size:.8rem;color:var(--text-muted,#8b949e);line-height:1.6;">
  <strong>Health disclaimer.</strong> Emersus AI provides evidence-based information
  and AI-generated suggestions for educational and informational purposes only.
  It is not a substitute for professional medical advice, diagnosis, or treatment.
  Always consult a qualified healthcare provider before starting any new exercise
  or nutrition program, especially if you have a medical condition.
</div>
```

Note: Adjust the styling to match the existing footer design system. If the site uses utility classes or CSS variables, use them instead of the inline styles shown above. Inline fallback styles are acceptable if you cannot quickly locate the design-token equivalent.

- [ ] **Step 3: Verify disclaimer is present on all public pages**

Run:
```bash
for f in index.html contact/index.html privacy/index.html terms/index.html \
         consumer-health-data/index.html demo/index.html; do
  grep -q 'footer-disclaimer' "$f" || echo "MISSING: $f"
done
```

Expected: No output.

- [ ] **Step 4: Commit**

```bash
git add index.html contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "eeat: add health disclaimer to footer on all public pages"
```

---

## Task 20: Create /about/ page with team credentials and methodology

**Files:**
- Create: `about/index.html`

- [ ] **Step 1: Create the about page**

Create `about/index.html` modeled on the structure of `contact/index.html` (it uses the same shared chrome / design tokens). The full content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="About Emersus AI: why we built an evidence-based fitness AI, how our scientific literature pipeline works, and what 'evidence-based' actually means for the recommendations you see.">
  <title>About | Emersus AI</title>
  <link rel="canonical" href="https://emersus.ai/about/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Emersus AI">
  <meta property="og:title" content="About | Emersus AI">
  <meta property="og:description" content="Why we built Emersus — evidence-based fitness AI grounded in peer-reviewed research.">
  <meta property="og:url" content="https://emersus.ai/about/">
  <meta property="og:image" content="https://emersus.ai/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="About | Emersus AI">
  <meta name="twitter:description" content="Why we built Emersus — evidence-based fitness AI.">
  <meta name="twitter:image" content="https://emersus.ai/og-image.png">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#0e1117">
  <!-- COPY the no-flash-boot script block verbatim from index.html here -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <link rel="stylesheet" href="/shared/site.css?v=redesign-10">
</head>
<body>
  <header>
    <!-- COPY the nav/header markup verbatim from privacy/index.html here -->
  </header>
  <main style="max-width:760px;margin:80px auto;padding:0 24px;">
    <h1>Why Emersus exists.</h1>
    <p class="lede">Fitness and nutrition advice has a credibility problem. Emersus AI is our attempt to fix it: every answer cites its sources, and every source is a real, resolvable study — not a hallucinated reference.</p>

    <h2>What "evidence-based" actually means here.</h2>
    <p>Most fitness apps will tell you they're "science-backed." Very few will show you which studies. Emersus does the opposite:</p>
    <ul>
      <li>Over 1 million peer-reviewed papers indexed in a pgvector semantic search engine, updated daily.</li>
      <li>Every claim links to a specific DOI or PubMed ID — not a generic "studies show" handwave.</li>
      <li>Claims are tagged by evidence quality (high / moderate / limited / insufficient).</li>
      <li>Peer-reviewed research and preprints are labeled distinctly so you can weight them yourself.</li>
    </ul>

    <h2>How the system works.</h2>
    <p>When you ask a question, Emersus retrieves the most relevant studies from its corpus, re-ranks them by quality and topical fit, passes them to a frontier language model as grounding, and streams back a synthesized answer with the underlying citations attached. The model is constrained from giving advice that contradicts the retrieved evidence.</p>

    <h2>What Emersus is not.</h2>
    <p>Emersus is an information tool, not a medical device. It is not a substitute for a physician, a registered dietitian, or a qualified personal trainer. If a recommendation conflicts with advice from a healthcare provider who knows your specific situation, defer to them.</p>

    <h2>Editorial and content policy.</h2>
    <p>Read our <a href="/editorial-policy/">editorial policy</a> for how we build, review, and update the content surfaces on this site.</p>

    <h2>Contact.</h2>
    <p>Questions, partnerships, or corrections: <a href="mailto:info@emersus.ai">info@emersus.ai</a>.</p>
  </main>
  <footer>
    <!-- COPY the footer markup verbatim from privacy/index.html here, INCLUDING the footer-disclaimer block from Task 19 -->
  </footer>
</body>
</html>
```

**Important:** The placeholder comments (`<!-- COPY ... verbatim from ... -->`) are instructions for the implementer. Before committing, replace each one with the actual no-flash-boot script block, nav/header markup, and footer markup copied verbatim from `privacy/index.html` (which is the cleanest existing legal-page template). This keeps the chrome consistent across the site.

- [ ] **Step 2: Register about/index.html as a Vite entry**

Modify `vite.config.js` — add `"about/index.html"` to the `htmlEntries` array (insert alphabetically near the top):

```js
const htmlEntries = [
  "index.html",
  "about/index.html",   // <-- add this line
  "admin/index.html",
  ...
];
```

- [ ] **Step 3: Add the new page to sitemap.xml**

In `sitemap.xml`, add a new `<url>` entry before the closing `</urlset>`:

```xml
  <url>
    <loc>https://emersus.ai/about/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
```

- [ ] **Step 4: Link the about page from the main nav and footer**

In `index.html`, `contact/index.html`, `privacy/index.html`, `terms/index.html`, `consumer-health-data/index.html`, `demo/index.html`:

Add `<a href="/about/">About</a>` to the nav `<div class="nav-links">` (between "Science" / "How it works" and "Log in" on the landing page; in the appropriate nav spot on the legal pages).

Also add it to the footer's "Company" column (or equivalent), adjacent to the existing "Contact" link.

- [ ] **Step 5: Verify the page builds and renders**

Run:
```bash
npm run build
ls dist/about/index.html
```

Expected: File exists in dist.

- [ ] **Step 6: Commit**

```bash
git add about/ vite.config.js sitemap.xml index.html contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "eeat: add /about/ page with methodology and team positioning"
```

---

## Task 21: Create /editorial-policy/ page

**Files:**
- Create: `editorial-policy/index.html`

- [ ] **Step 1: Create the page**

Create `editorial-policy/index.html` using the same chrome-copy approach as Task 20. Full body content:

```html
<main style="max-width:760px;margin:80px auto;padding:0 24px;">
  <h1>Editorial policy.</h1>
  <p class="lede">How we decide what shows up in Emersus AI's responses and on this site, how we review content, and how we handle corrections.</p>
  <p><strong>Last updated:</strong> April 15, 2026</p>

  <h2>Sourcing.</h2>
  <p>Emersus AI's responses are grounded in a continuously updated corpus of peer-reviewed biomedical and exercise-science research. Our primary sources are PubMed, Europe PMC, and open-access journal archives, supplemented with preprint servers (bioRxiv, medRxiv). Every claim in a generated response carries a citation to its underlying source.</p>

  <h2>Evidence grading.</h2>
  <p>Claims are tagged by strength of evidence:</p>
  <ul>
    <li><strong>High</strong> — supported by multiple peer-reviewed RCTs or a recent high-quality meta-analysis.</li>
    <li><strong>Moderate</strong> — supported by a single peer-reviewed RCT or consistent observational evidence.</li>
    <li><strong>Limited</strong> — supported by pilot studies, small trials, or mixed observational evidence.</li>
    <li><strong>Insufficient</strong> — not enough quality evidence exists to make a confident claim.</li>
  </ul>

  <h2>Preprint vs. peer-reviewed.</h2>
  <p>Preprints — research that has not yet passed peer review — are always labeled distinctly. We surface them because they're often the first evidence on a topic, but we flag them so you can weight them appropriately.</p>

  <h2>AI generation vs. human editing.</h2>
  <p>Chat responses are AI-generated from the retrieved source corpus. Static site pages (this one, /about/, /privacy/, /terms/, /consumer-health-data/, marketing copy on the landing) are written and edited by humans on the Emersus team.</p>

  <h2>Updates and corrections.</h2>
  <p>Static pages show a "Last updated" date. When research evolves or we update the pipeline, we refresh affected pages. If you believe content on this site is inaccurate or outdated, email <a href="mailto:info@emersus.ai">info@emersus.ai</a> and we will investigate.</p>

  <h2>Conflicts of interest.</h2>
  <p>Emersus AI has no sponsors and does not accept payment from supplement companies, pharmaceutical companies, gym chains, or any third party whose products or services could influence what the system surfaces. Recommendations are driven by the evidence corpus alone.</p>

  <h2>Not medical advice.</h2>
  <p>See our <a href="/about/">About page</a> and the health disclaimer in the footer of every page.</p>
</main>
```

Surround with the same `<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`, nav/header/footer chrome as Task 20.

- [ ] **Step 2: Register the entry in Vite**

Add `"editorial-policy/index.html"` to `vite.config.js`'s `htmlEntries` array.

- [ ] **Step 3: Add to sitemap.xml**

```xml
  <url>
    <loc>https://emersus.ai/editorial-policy/</loc>
    <lastmod>2026-04-15</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.4</priority>
  </url>
```

- [ ] **Step 4: Link from footer**

Add `<a href="/editorial-policy/">Editorial policy</a>` to the footer's legal column alongside the existing Privacy / Terms / Contact links, on all 6 public pages + the new /about/ page.

- [ ] **Step 5: Build and verify**

```bash
npm run build
ls dist/editorial-policy/index.html
```

Expected: File exists.

- [ ] **Step 6: Commit**

```bash
git add editorial-policy/ vite.config.js sitemap.xml index.html about/ contact/ privacy/ terms/ consumer-health-data/ demo/
git commit -m "eeat: add /editorial-policy/ page and link from footer"
```

---

## Task 22: Migrate /chat/ redirect from meta-refresh to Caddy 301

**Files:**
- Modify: `infra/Caddyfile` (on Hetzner box, via SSH — NOT in repo)
- Optional later-cleanup: `chat/index.html` (leave in place as safety net)

**Context:** The `/chat/` route currently redirects to `/app/` via `<meta http-equiv="refresh">` + JS (see `chat/index.html:10` and `chat/index.html:73-74`). Search engines may not pass full link equity through meta refreshes. A server-side 301 in Caddy is the correct fix.

**Note:** `infra/` is untracked (local-only per CLAUDE.md). This task requires SSH access to the Hetzner box.

- [ ] **Step 1: SSH to the Hetzner server**

```bash
ssh hetzner
```

Expected: Logged in as `emersus` user.

- [ ] **Step 2: Back up the current Caddyfile**

```bash
cp ~/app/infra/Caddyfile ~/app/infra/Caddyfile.bak-$(date +%Y%m%d)
```

Expected: Backup file exists.

- [ ] **Step 3: Add 301 redirect rule**

Open `~/app/infra/Caddyfile` in an editor. Find the `emersus.ai` site block. Add the redirect directive before any `file_server` / `handle` blocks:

```caddyfile
emersus.ai {
    # ... existing directives ...

    # 301 redirect /chat/ -> /app/ (preserves query string + hash)
    redir /chat/ /app/ 301
    redir /chat/* /app/{uri} 301   # catches /chat/anything

    # ... existing file_server, handle_path /api/*, etc. ...
}
```

If the Caddyfile uses `www.emersus.ai` redirect logic, add the same rule inside that block too.

- [ ] **Step 4: Validate Caddy config before reloading**

```bash
caddy validate --config ~/app/infra/Caddyfile --adapter caddyfile
```

Expected: `Valid configuration`.

- [ ] **Step 5: Reload Caddy**

```bash
sudo systemctl reload caddy
# OR if Caddy is containerized:
docker compose -f ~/app/infra/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

- [ ] **Step 6: Verify the 301 works**

From your local machine:
```bash
curl -sI https://emersus.ai/chat/
```

Expected output includes:
```
HTTP/2 301
location: /app/
```

- [ ] **Step 7: Verify query string is preserved**

```bash
curl -sI "https://emersus.ai/chat/?prompt=hello"
```

Expected: `location: /app/?prompt=hello` or equivalent.

- [ ] **Step 8: No commit needed**

The Caddyfile is not in the repo. No git action required. Record the change in `infra/CHANGELOG.md` (local only) if one exists.

---

## Task 23: Deploy to production and submit to search consoles

**Context:** All prior tasks must have been merged to `main`. Production deploy happens via SSH per CLAUDE.md ("prod deploy needs `git pull && npm run build && pm2 restart emersus-api --update-env`").

- [ ] **Step 1: Deploy to Hetzner**

From local machine:
```bash
ssh hetzner
cd ~/app
git pull
npm run build
pm2 restart emersus-api --update-env
```

- [ ] **Step 2: Smoke-test the deployed site**

From local machine:
```bash
curl -sI https://emersus.ai/ | head -20
curl -sI https://emersus.ai/robots.txt | head -5
curl -sI https://emersus.ai/sitemap.xml | head -5
curl -sI https://emersus.ai/favicon.ico | head -5
curl -sI https://emersus.ai/og-image.png | head -5
curl -sI https://emersus.ai/manifest.webmanifest | head -5
curl -sI https://emersus.ai/about/ | head -5
curl -sI https://emersus.ai/editorial-policy/ | head -5
curl -sI https://emersus.ai/chat/ | head -5
```

Expected: All return HTTP 200 except `/chat/` which returns 301 with `location: /app/`.

- [ ] **Step 3: Validate structured data on the live site**

Paste `https://emersus.ai/` into:
- https://search.google.com/test/rich-results
- https://validator.schema.org/

Expected: Organization, WebSite, WebApplication, and FAQPage schemas all detected with zero errors.

- [ ] **Step 4: Validate Open Graph preview**

Paste `https://emersus.ai/` into:
- https://developers.facebook.com/tools/debug/
- https://www.linkedin.com/post-inspector/
- https://cards-dev.twitter.com/validator (or any Twitter preview tool)

Expected: Title, description, and 1200×630 image render correctly. If Facebook shows cached old data, click "Scrape Again".

- [ ] **Step 5: Submit sitemap to Google Search Console**

1. Sign in to https://search.google.com/search-console (user: `sidarvig@gmail.com`).
2. Add property `https://emersus.ai` if not already added. Verify ownership via DNS TXT record or HTML file upload (the latter requires adding a file to the repo root and redeploying).
3. Once verified, go to Sitemaps → Add new sitemap → enter `sitemap.xml` → Submit.

Expected: Status shows "Success" within a few hours (may show "Couldn't fetch" initially — retry after 30 minutes).

- [ ] **Step 6: Submit sitemap to Bing Webmaster Tools**

1. Sign in to https://www.bing.com/webmasters.
2. Add site `https://emersus.ai`, verify (can import from Google Search Console).
3. Sitemaps → Submit sitemap → `https://emersus.ai/sitemap.xml`.

Expected: Submitted successfully. Bing is critical because Copilot and ChatGPT's web search route through Bing's index.

- [ ] **Step 7: Run Lighthouse audit**

Open `https://emersus.ai/` in Chrome. Open DevTools → Lighthouse → "Mobile" mode, check SEO + Performance + Best Practices + Accessibility. Run audit.

Expected targets:
- SEO: ≥95
- Best Practices: ≥90
- Accessibility: ≥90
- Performance: ≥80 (higher would be better but we haven't done deep CWV work)

Record any SEO issues &lt;95 in a follow-up note. If Performance &lt;80, investigate the top contributors (likely LCP from Google Fonts or the hero section).

- [ ] **Step 8: Update changelog.md**

Append:
```markdown
- 2026-04-15 — seo foundation (plan a) shipped: robots.txt, sitemap.xml, canonical tags, OG + Twitter cards, favicon, web manifest, JSON-LD (Org, WebSite, WebApp, FAQPage), noindex on auth-gated pages, /about/ + /editorial-policy/ pages, health disclaimer, Caddy 301 for /chat/, Search Console + Bing submission — see docs/superpowers/plans/2026-04-15-seo-foundation.md
```

- [ ] **Step 9: Commit changelog**

```bash
git add changelog.md
git commit -m "docs: changelog entry for SEO foundation (plan A)"
```

---

## Post-Deploy Monitoring

After shipping, check back in:

- **Week 1:** Verify Search Console shows pages being crawled (Coverage → Indexed). Check Bing "URL Inspection" tool for indexing status.
- **Week 2-4:** First pages should appear in `site:emersus.ai` Google search. If not, investigate crawl errors in Search Console.
- **Month 2:** Check if Organization card starts appearing in Google for `"emersus ai"` brand search. Check AI mention rate by probing ChatGPT/Claude/Perplexity with 5-10 queries like "AI fitness app with citations" and recording whether Emersus is mentioned.
- **Month 3:** Review Lighthouse scores again on key pages. Review Search Console for any manual actions, crawl errors, or mobile usability issues.

This plan intentionally does NOT include content creation, directory submissions, Reddit strategy, or ChatGPT Apps integration. Those are Plans B, C, and D respectively and should be planned separately.
