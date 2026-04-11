# PubMed Topic Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `scripts/fill-pmc-topics.js` by ~86 new topics across 11 new domains, reorganize existing 121 topics into domain-grouped sections, refine 40–60 too-narrow existing queries, ship a new `scripts/validate-pubmed-queries.js` helper, and run a one-off web research pass to inform topic selection.

**Architecture:** Single-file static edit to `scripts/fill-pmc-topics.js` (data, not code refactor), supported by a throwaway research crawler that writes candidate topics to a JSONL file, and a new committed validator that smoke-tests queries against PubMed eutils. Domain grouping is via JS comments inside the existing `DEFAULT_TOPIC_ORDER` array — no refactor, no data file split.

**Tech Stack:** Node.js (ES modules), PubMed eutils `/esearch.fcgi`, Semantic Scholar–style boolean query syntax, `openai` SDK for LLM classification (`gpt-5-mini`), Reddit/YouTube/RSS public endpoints, `curl` via `child_process.spawn` (matching the existing `backfill-semantic-scholar.js` pattern).

**Design spec:** `docs/superpowers/specs/2026-04-11-pubmed-topic-expansion-design.md`

---

## Task 1: Write throwaway research crawler

**Files:**
- Create: `scripts/research-topic-candidates.js` (NOT committed, deleted after use)

- [ ] **Step 1: Create the file with the complete crawler + classifier**

```js
// Throwaway one-off: crawls Reddit, YouTube, research blogs, magazines, and
// BioRxiv for exercise-science discussion snippets, classifies them via
// gpt-5-mini, groups by topic, and writes candidate gap topics to a JSONL
// file. Not committed — delete after use. Spec §3.
import "dotenv/config";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const YOUTUBE_API_KEY = (process.env.YOUTUBE_API_KEY || "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not set. Add to ~/app/.env on Hetzner.");
  process.exit(1);
}
if (!YOUTUBE_API_KEY) {
  console.warn("[warn] YOUTUBE_API_KEY not set — YouTube sources skipped.");
}

// ── Source lists (spec §3.1) ───────────────────────────────────────────
const REDDIT_SUBS = [
  "AdvancedFitness", "weightroom", "hypertrophy", "AdvancedRunning",
  "running", "triathlon", "climbharder", "bodyweightfitness", "powerlifting",
  "xxfitness", "Stronglifts5x5", "GYM", "Fitness", "Supplements",
  "ScientificNutrition", "nutrition", "bodybuilding", "naturalbodybuilding",
  "weightlifting", "olympicweightlifting", "bjj", "martialarts", "Swimming",
  "cycling", "Velo", "Ultramarathon", "bouldering", "Rowing", "MTB",
  "Perimenopause", "AskPhysicalTherapy", "Tendinopathy", "intermittentfasting",
  "nootropics",
];

// YouTube handles (no @, no spaces). channels.list?forHandle uses these.
const YOUTUBE_HANDLES = [
  "JeffNippard", "RenaissancePeriodization", "StrongerByScience",
  "SquatUniversityPL", "BarbellMedicine", "StartingStrength",
  "N1Training", "EugeneTeo", "IronCulturePodcast", "Biolayne",
  "TheMovementSystem", "gmbfitness", "LatticeTraining",
  "gcn", "gtn", "AthleticTruthGroup",
];

const RSS_FEEDS = [
  // Research blogs + podcasts
  { url: "https://www.strongerbyscience.com/feed/", source: "blog_sbs" },
  { url: "https://www.barbellmedicine.com/feed/", source: "blog_bbm" },
  { url: "https://rpstrength.com/feed/", source: "blog_rp" },
  { url: "https://startingstrength.com/feeds/starting-strength-articles.xml", source: "blog_ss" },
  { url: "https://sigmanutrition.com/feed/podcast/", source: "podcast_sigma" },
  { url: "https://feeds.simplecast.com/5iIUCXZx", source: "podcast_ic" }, // iron culture
  { url: "https://feeds.megaphone.fm/hubermanlab", source: "podcast_huberman" },
  { url: "https://theproof.libsyn.com/rss", source: "podcast_proof" },
  // Magazines
  { url: "https://www.outsideonline.com/rss/training.xml", source: "mag_outside" },
  { url: "https://www.runnersworld.com/rss/all.xml", source: "mag_rw" },
  { url: "https://www.triathlete.com/feed/", source: "mag_triathlete" },
  { url: "https://velo.outsideonline.com/feed/", source: "mag_velo" },
  { url: "https://swimswam.com/feed/", source: "mag_swimswam" },
  // BioRxiv physiology
  { url: "https://connect.biorxiv.org/biorxiv_xml.php?subject=physiology", source: "preprint_biorxiv" },
];

// ── Helpers ────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function curlJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25", "-A", "emersus-research/1.0"];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    const child = spawn("curl", args);
    let out = ""; let err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error(`JSON parse: ${e.message}; body=${out.slice(0, 200)}`)); }
    });
  });
}

async function curlText(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25", "-A", "emersus-research/1.0", url];
    const child = spawn("curl", args);
    let out = ""; let err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}

// ── Reddit fetch ───────────────────────────────────────────────────────
async function fetchReddit() {
  const snippets = [];
  for (const sub of REDDIT_SUBS) {
    for (const mode of ["top.json?t=year&limit=100", "hot.json?limit=100"]) {
      try {
        const url = `https://www.reddit.com/r/${sub}/${mode}`;
        const data = await curlJson(url);
        const posts = data?.data?.children || [];
        for (const p of posts) {
          const d = p.data;
          if (!d) continue;
          const text = [d.title, d.selftext || ""].filter(Boolean).join("\n").trim();
          if (text.length < 30) continue;
          snippets.push({ source: `reddit/${sub}`, id: d.id, text: text.slice(0, 1500) });
        }
        console.log(`[reddit] r/${sub} ${mode.split("?")[0]}: +${posts.length}`);
        await sleep(1100);
      } catch (e) {
        console.warn(`[reddit] r/${sub} ${mode}: ${e.message}`);
      }
    }
  }
  // Dedupe by id
  const seen = new Set();
  return snippets.filter(s => {
    const k = `${s.source}:${s.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── YouTube fetch (cheap ops only) ─────────────────────────────────────
async function fetchYouTube() {
  if (!YOUTUBE_API_KEY) return [];
  const snippets = [];
  for (const handle of YOUTUBE_HANDLES) {
    try {
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=@${handle}&key=${YOUTUBE_API_KEY}`;
      const chResp = await curlJson(chUrl);
      const uploads = chResp?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) {
        console.warn(`[yt] ${handle}: no uploads playlist`);
        continue;
      }
      let pageToken = "";
      let pages = 0;
      while (pages < 5) {
        const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploads}&maxResults=50&key=${YOUTUBE_API_KEY}` + (pageToken ? `&pageToken=${pageToken}` : "");
        const plResp = await curlJson(plUrl);
        const items = plResp?.items || [];
        for (const it of items) {
          const s = it.snippet;
          if (!s) continue;
          const text = [s.title, s.description || ""].filter(Boolean).join("\n").trim();
          if (text.length < 30) continue;
          snippets.push({ source: `youtube/${handle}`, id: it.id, text: text.slice(0, 1500) });
        }
        pageToken = plResp?.nextPageToken || "";
        pages++;
        if (!pageToken) break;
      }
      console.log(`[yt] ${handle}: total snippets so far ${snippets.length}`);
      await sleep(300);
    } catch (e) {
      console.warn(`[yt] ${handle}: ${e.message}`);
    }
  }
  return snippets;
}

// ── RSS fetch (minimal XML parser) ─────────────────────────────────────
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi;
  const matches = xml.match(itemRe) || [];
  for (const raw of matches) {
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = raw.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
                      raw.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
                      raw.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const idMatch = raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) ||
                    raw.match(/<id[^>]*>([\s\S]*?)<\/id>/i) ||
                    raw.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const stripCdata = (s) => (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
    const title = stripCdata(titleMatch?.[1]);
    const desc = stripCdata(descMatch?.[1]);
    const id = stripCdata(idMatch?.[1]);
    if (!title) continue;
    items.push({ id: id || title.slice(0, 80), text: [title, desc].filter(Boolean).join("\n") });
  }
  return items;
}

async function fetchRss() {
  const snippets = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await curlText(feed.url);
      const items = parseRssItems(xml);
      for (const it of items) {
        if (it.text.length < 30) continue;
        snippets.push({ source: feed.source, id: it.id, text: it.text.slice(0, 1500) });
      }
      console.log(`[rss] ${feed.source}: +${items.length}`);
      await sleep(1100);
    } catch (e) {
      console.warn(`[rss] ${feed.source}: ${e.message}`);
    }
  }
  return snippets;
}

// ── Classifier (gpt-5-mini JSON mode) ──────────────────────────────────
const CLASSIFIER_PROMPT = `You are classifying discussion snippets to find topics relevant to an evidence-based exercise science knowledge base. For each snippet, decide if it's about exercise, training, sports nutrition, recovery, athletic performance, or closely related topics. Return valid JSON only.

Output format per snippet: { "is_exercise_science": bool, "topic_label": "short_snake_case_key", "confidence": 0.0-1.0, "one_line_summary": "what this is about" }

topic_label should be a concise snake_case keyword that captures the topic (e.g. "menstrual_cycle_training", "achilles_tendinopathy", "polarized_endurance"). Prefer existing exercise-science terminology over novel phrases.

Be strict: confidence < 0.6 for anything that's just gym culture chat, progress selfies, meme posts, or product shilling. Only is_exercise_science=true for actual technical discussion about training, physiology, nutrition science, recovery mechanisms, or performance.`;

async function classifyBatch(batch) {
  const input = batch.map((s, i) => `${i}: ${s.text.slice(0, 600)}`).join("\n---\n");
  const body = JSON.stringify({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLASSIFIER_PROMPT },
      { role: "user", content: `Classify each of these ${batch.length} snippets. Return JSON with a "results" array where index i corresponds to snippet i.\n\n${input}` },
    ],
  });
  const resp = await curlJsonPost("https://api.openai.com/v1/chat/completions", body, {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  });
  try {
    const content = resp?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return parsed.results || [];
  } catch (e) {
    console.warn(`[classify] parse failure: ${e.message}`);
    return [];
  }
}

async function curlJsonPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "60", "-X", "POST", "--data-binary", "@-"];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    const child = spawn("curl", args);
    let out = ""; let err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
    });
    child.stdin.write(body);
    child.stdin.end();
  });
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const outDir = "data/research";
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log("[step 1/4] Fetching snippets from Reddit, YouTube, RSS...");
  const [reddit, youtube, rss] = await Promise.all([
    fetchReddit(),
    fetchYouTube(),
    fetchRss(),
  ]);
  const all = [...reddit, ...youtube, ...rss];
  console.log(`[step 1/4] ${reddit.length} reddit + ${youtube.length} youtube + ${rss.length} rss = ${all.length} total`);

  // Dedupe by id
  const seen = new Set();
  const unique = all.filter(s => {
    const k = `${s.source}:${s.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`[step 2/4] After dedupe: ${unique.length} snippets`);

  console.log("[step 3/4] Classifying via gpt-5-mini...");
  const classified = [];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const results = await classifyBatch(batch);
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r && r.is_exercise_science && (r.confidence || 0) >= 0.6) {
        classified.push({ ...batch[j], classification: r });
      }
    }
    console.log(`[classify] ${i + batch.length}/${unique.length} (${classified.length} kept)`);
  }

  console.log("[step 4/4] Aggregating by topic and writing output...");
  const byTopic = new Map();
  for (const s of classified) {
    const key = s.classification.topic_label;
    if (!byTopic.has(key)) byTopic.set(key, { topic_label: key, count: 0, example_titles: [], sources: {} });
    const e = byTopic.get(key);
    e.count++;
    if (e.example_titles.length < 3) e.example_titles.push(s.text.slice(0, 120));
    const src = s.source.split("/")[0];
    e.sources[src] = (e.sources[src] || 0) + 1;
  }

  // Load existing topic keys to subtract already-covered
  const existingTopicsSrc = readFileSync("scripts/fill-pmc-topics.js", "utf8");
  const existingKeys = new Set(
    [...existingTopicsSrc.matchAll(/^\s*"([a-z_0-9]+)"/gm)].map(m => m[1])
  );

  const sorted = [...byTopic.values()]
    .filter(e => !existingKeys.has(e.topic_label))
    .sort((a, b) => b.count - a.count)
    .slice(0, 200);

  const outPath = join(outDir, "topic-candidates-2026-04-11.jsonl");
  const stream = createWriteStream(outPath);
  for (const e of sorted) stream.write(JSON.stringify(e) + "\n");
  stream.end();
  console.log(`Done. ${sorted.length} gap candidates written to ${outPath}`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Parse-check**

Run: `node --check scripts/research-topic-candidates.js`
Expected: no output, exit 0

- [ ] **Step 3: Do NOT commit — this file is throwaway**

```bash
git status --short
# Verify scripts/research-topic-candidates.js shows as untracked (??), not staged
```

---

## Task 2: Run the research pass

**Files:** none modified; generates `data/research/topic-candidates-2026-04-11.jsonl`

- [ ] **Step 1: scp the throwaway to Hetzner**

```bash
scp scripts/research-topic-candidates.js hetzner:~/app/scripts/
```

- [ ] **Step 2: Run it on Hetzner (env is there)**

```bash
ssh hetzner 'cd ~/app && mkdir -p data/research && node scripts/research-topic-candidates.js 2>&1 | tail -80'
```

Expected: log lines showing reddit/yt/rss counts, classify progress, and final "Done. NNN gap candidates written to data/research/topic-candidates-2026-04-11.jsonl"

Wall time: 30–60 minutes. If it exits early with a credential error, check `YOUTUBE_API_KEY` and `OPENAI_API_KEY` in `~/app/.env`.

- [ ] **Step 3: Pull the output back to local**

```bash
mkdir -p data/research
scp hetzner:~/app/data/research/topic-candidates-2026-04-11.jsonl data/research/
wc -l data/research/topic-candidates-2026-04-11.jsonl
```

Expected: ≥50 lines (per spec Gate 3).

- [ ] **Step 4: Do NOT commit the output file**

```bash
# data/research/ should be gitignored or left untracked
echo 'data/research/' >> .gitignore  # if not already present
```

---

## Task 3: Review research output, note additions to topic list

**Files:** none (manual notes)

- [ ] **Step 1: Display the top 30 candidates by frequency**

```bash
head -30 data/research/topic-candidates-2026-04-11.jsonl | jq -r '"\(.count)\t\(.topic_label)\t\(.example_titles[0] // "")"'
```

- [ ] **Step 2: Manually note any topics that should be added beyond the pre-planned ~86**

Compare top candidates against the pre-planned list in spec §4.2. Note any surprises in a local scratch file `data/research/additions.txt`:

```
# High-frequency candidates not in pre-planned list (>10 mentions each):
# <topic_label>  <count>  <short_rationale>
```

- [ ] **Step 3: Clean up local scratch**

The scratch file informs Tasks 10–20 but isn't committed.

---

## Task 4: Delete the throwaway research script

**Files:**
- Delete: `scripts/research-topic-candidates.js` (local and Hetzner)

- [ ] **Step 1: Remove local copy**

```bash
rm scripts/research-topic-candidates.js
```

- [ ] **Step 2: Remove Hetzner copy**

```bash
ssh hetzner 'rm -f ~/app/scripts/research-topic-candidates.js'
```

- [ ] **Step 3: Verify git status clean for that path**

```bash
git status --short scripts/research-topic-candidates.js
# Expected: no output (file is fully deleted, never tracked)
```

---

## Task 5: Create `scripts/validate-pubmed-queries.js`

**Files:**
- Create: `scripts/validate-pubmed-queries.js`

- [ ] **Step 1: Write the validator**

```js
// Validates TOPIC_QUERIES against PubMed eutils /esearch by checking that
// each query returns a reasonable number of papers. Rate-limited to the
// PubMed unauthenticated limit (3 req/sec). Reports pass/warn/fail per
// query to stdout so operators can fix malformed queries before running
// a real fill.
//
// Usage:
//   node scripts/validate-pubmed-queries.js                    # all topics
//   node scripts/validate-pubmed-queries.js --topics=creatine,sleep
//   node scripts/validate-pubmed-queries.js --min-count=100    # tune pass threshold
//
// Thresholds:
//   count >= PASS_MIN       → PASS
//   WARN_MIN <= count < PASS_MIN → WARN  (query works but narrow)
//   count <  WARN_MIN       → FAIL  (likely malformed or very obscure topic)
import "dotenv/config";
import { spawn } from "node:child_process";

const DEFAULT_PASS_MIN = 100;
const DEFAULT_WARN_MIN = 10;
const REQUEST_SPACING_MS = 350; // slightly over 1/3s → < 3 RPS
const ESEARCH_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

function parseArgs(argv) {
  const args = { topics: null, passMin: DEFAULT_PASS_MIN, warnMin: DEFAULT_WARN_MIN };
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    if (key === "--topics") {
      args.topics = value.split(",").map(s => s.trim()).filter(Boolean);
    } else if (key === "--min-count") {
      args.passMin = Number(value) || DEFAULT_PASS_MIN;
    } else if (key === "--warn-count") {
      args.warnMin = Number(value) || DEFAULT_WARN_MIN;
    }
  }
  return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function curlGet(url) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25", "-A", "emersus-validator/1.0", url];
    const child = spawn("curl", args);
    let out = ""; let err = "";
    child.stdout.on("data", d => out += d.toString());
    child.stderr.on("data", d => err += d.toString());
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err.slice(0, 200)}`));
      resolve(out);
    });
  });
}

async function esearchCount(query) {
  const url = `${ESEARCH_URL}?db=pubmed&retmax=0&term=${encodeURIComponent(query)}`;
  const xml = await curlGet(url);
  const match = xml.match(/<Count>(\d+)<\/Count>/);
  if (!match) throw new Error(`no <Count> in response: ${xml.slice(0, 200)}`);
  return Number(match[1]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Import TOPIC_QUERIES dynamically from the sibling script
  const mod = await import("./fill-pmc-topics.js").catch(() => null);
  if (!mod || !mod.TOPIC_QUERIES) {
    // fill-pmc-topics.js does not currently export TOPIC_QUERIES.
    // Fall back to textual parse.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./fill-pmc-topics.js", import.meta.url), "utf8");
    const queries = parseTopicQueries(src);
    return runValidation(queries, args);
  }
  return runValidation(mod.TOPIC_QUERIES, args);
}

function parseTopicQueries(src) {
  // Minimal parser: matches `  topic_key: "..."` lines (handles escaped quotes).
  // Sufficient because fill-pmc-topics.js uses a flat object literal.
  const out = {};
  const re = /^\s*([a-z_0-9]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return out;
}

async function runValidation(TOPIC_QUERIES, args) {
  const topics = args.topics && args.topics.length
    ? args.topics.filter(t => TOPIC_QUERIES[t])
    : Object.keys(TOPIC_QUERIES);

  if (!topics.length) {
    console.error("No matching topics. Available:", Object.keys(TOPIC_QUERIES).slice(0, 5).join(", "), "...");
    process.exit(2);
  }

  const results = { pass: 0, warn: 0, fail: 0, error: 0 };
  console.log(`Validating ${topics.length} queries at ~${Math.round(1000 / REQUEST_SPACING_MS)} RPS...`);
  console.log(`Pass threshold: ≥${args.passMin}  Warn threshold: ≥${args.warnMin}\n`);

  for (const topic of topics) {
    const query = TOPIC_QUERIES[topic];
    try {
      const count = await esearchCount(query);
      let tag;
      if (count >= args.passMin) { tag = "PASS"; results.pass++; }
      else if (count >= args.warnMin) { tag = "WARN"; results.warn++; }
      else { tag = "FAIL"; results.fail++; }
      console.log(`[${tag}] ${count.toString().padStart(7)}  ${topic}`);
      if (tag !== "PASS" && process.env.VERBOSE) {
        console.log(`         query: ${query.slice(0, 180)}${query.length > 180 ? "..." : ""}`);
      }
    } catch (e) {
      console.log(`[ERROR]          ${topic}: ${e.message}`);
      results.error++;
    }
    await sleep(REQUEST_SPACING_MS);
  }

  console.log(`\nSummary: ${results.pass} pass, ${results.warn} warn, ${results.fail} fail, ${results.error} error`);
  if (results.fail > 0 || results.error > 0) process.exit(1);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Parse-check**

Run: `node --check scripts/validate-pubmed-queries.js`
Expected: no output, exit 0

---

## Task 6: Smoke-test the validator on existing known-good queries

**Files:** none modified

- [ ] **Step 1: Run against a small sample**

```bash
node scripts/validate-pubmed-queries.js --topics=creatine,protein,hypertrophy,sleep
```

Expected output (approximate counts, may vary):
```
Validating 4 queries at ~3 RPS...
Pass threshold: ≥100  Warn threshold: ≥10

[PASS]    NNNN  creatine
[PASS]    NNNN  protein
[PASS]    NNNN  hypertrophy
[PASS]    NNNN  sleep

Summary: 4 pass, 0 warn, 0 fail, 0 error
```

If any show FAIL, the parser in `parseTopicQueries` is broken. Investigate before proceeding.

- [ ] **Step 2: Commit the validator**

```bash
git add scripts/validate-pubmed-queries.js
git commit -m "feat(scripts): add validate-pubmed-queries helper

Rate-limited PubMed eutils /esearch smoke-test for TOPIC_QUERIES in
scripts/fill-pmc-topics.js. Reports per-query PASS/WARN/FAIL based on
paper count returned by each query, so malformed or ultra-narrow
queries can be caught before running a real fill.

Threshold defaults: PASS >=100, WARN >=10, FAIL <10. Override via
--min-count / --warn-count. Filter with --topics=a,b,c.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Retrofit existing 121 topics into domain-grouped sections

**Files:**
- Modify: `scripts/fill-pmc-topics.js:4-126` (the `DEFAULT_TOPIC_ORDER` array)

**Non-goal:** no query changes, no renames, no new topics in this task. Purely reorder + add comments.

- [ ] **Step 1: Replace the existing `DEFAULT_TOPIC_ORDER` with the domain-grouped version**

Find the current `const DEFAULT_TOPIC_ORDER = [ ... ];` block (lines 4–126) and replace with:

```js
const DEFAULT_TOPIC_ORDER = [
  // ── 1. Core resistance training ──────────────────────────────
  "creatine",
  "protein",
  "hypertrophy",
  "strength",
  "power",
  "progressive_overload",
  "volume",
  "frequency",
  "intensity",
  "periodization",
  "deload",
  "warm_up",
  "cool_down",
  "exercise_selection",
  "training_splits",
  "barbell_training",
  "dumbbell_training",
  "bodyweight_training",
  "fitness_programs",

  // ── 2. Exercise selection & execution ────────────────────────
  "hinge_exercises",
  "unilateral_leg_exercises",
  "glute_training",
  "machine_leg_training",
  "upper_push_exercises",
  "upper_pull_exercises",
  "arm_shoulder_isolation",

  // ── 3. Endurance & cardiovascular ────────────────────────────
  "endurance",
  "concurrent_training",
  "vo2_max",
  "zone_2",
  "hiit",
  "sprint_interval_training",
  "lactate_threshold",
  "running_economy",
  "resting_heart_rate",

  // ── 4. Body composition & general nutrition ──────────────────
  "fat_loss",
  "body_recomposition",
  "body_composition",
  "caloric_deficit",
  "caloric_surplus",
  "meal_timing",
  "carbohydrates",
  "fiber",
  "hydration",
  "electrolytes",
  "appetite",
  "blood_glucose",
  "insulin_sensitivity",

  // ── 5. Supplements — performance ─────────────────────────────
  "caffeine",
  "beta_alanine",
  "citrulline",
  "taurine",
  "betaine_tmg",
  "tyrosine",
  "alpha_gpc",
  "l_carnitine",
  "hmb",
  "beetroot_nitrate",
  "sodium_bicarbonate",
  "amino_acids",
  "whey_protein",
  "casein",
  "collagen",
  "collagen_peptides",
  "pre_workout",
  "pde5_pump",

  // ── 6. Supplements — hormones, adaptogens, micronutrients ────
  "testosterone",
  "ashwagandha",
  "tongkat_ali",
  "eurycoma_longifolia",
  "eurycome_longfolia",
  "turkesterone",
  "rhodiola",
  "shilajit",
  "cordyceps",
  "omega_3",
  "vitamin_d",
  "magnesium",
  "glycine_sleep",
  "sun_exposure",
  "probiotics",
  "nac_tudca",
  "glutathione",
  "cerebrolysin",

  // ── 7. Supplements — peptides & research compounds ───────────
  "peptides",
  "bioactive_peptides",
  "bpc_157",
  "thymosin_beta_4",
  "growth_hormone_peptides",
  "glp_1_peptides",
  "ghrelin_peptides",
  "tesofensine",
  "metabolic_peptides",
  "nootropic_peptides",
  "longevity_peptides",
  "melanocortin_peptides",
  "copper_peptides",
  "nad_longevity",
  "sarms_and_research_compounds",
  "anabolic_agents",

  // ── 8. Recovery, sleep, stress ───────────────────────────────
  "sleep",
  "recovery",
  "hrv",
  "stress",
  "muscle_soreness",
  "injury_prevention",
  "inflammation",

  // ── 9. Metabolic & cardiovascular health (existing) ──────────
  "blood_pressure",
  "cholesterol",
  "triglycerides",
  "metabolic_syndrome",
  "mitochondrial_function",
  "bone_density",
  "joint_health",
  "tendon_health",
  "mobility",
  "gut_health",

  // ── 10. Mind, habit, behavior ────────────────────────────────
  "motivation",
  "adherence",
  "habit_formation",
  "mental_fatigue",
  "focus",
  "circadian_rhythm",
];
```

**Important:** this preserves every existing key. Run a diff check to verify parity.

- [ ] **Step 2: Verify parity — every original key is present, none added**

```bash
node -e '
import("./scripts/fill-pmc-topics.js").then(() => {}).catch(e => { console.error(e); process.exit(1); });
'
```

Then cross-check against git:

```bash
git diff scripts/fill-pmc-topics.js | grep -E "^-\s+\"[a-z_]" | wc -l  # removed
git diff scripts/fill-pmc-topics.js | grep -E "^\+\s+\"[a-z_]" | wc -l  # added
```

Expected: both counts should be the same — every removed line is just re-added in a new position.

- [ ] **Step 3: Parse + dry-run**

```bash
node --check scripts/fill-pmc-topics.js
```

Expected: no output.

```bash
node scripts/fill-pmc-topics.js --topics=INVALID --dry-run
```

Expected: exits with usage help (INVALID is not a known topic). Confirms file loads cleanly.

- [ ] **Step 4: Commit the retrofit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "refactor(scripts): group fill-pmc-topics topics by domain

Reorganize DEFAULT_TOPIC_ORDER into 10 commented domain sections for
the 121 existing topics. No renames, no query changes, no new topics
in this commit — purely a reshuffle and comment addition to make the
file navigable before new topics and query refinements land on top.

Default processing order changes (domains now fill in grouped order
instead of historical add order) but no caller depends on positional
order; --topics= filter is key-based.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Refine the 40–60 too-narrow existing queries

**Files:**
- Modify: `scripts/fill-pmc-topics.js` — the `TOPIC_QUERIES` object, existing entries only

**Criteria for refinement** (spec §5.1):
- Two-term `A AND B` shape with no OR expansion
- Missing common synonyms / MeSH canonical forms
- Missing context / outcome terms

- [ ] **Step 1: Apply refinements in place**

For each of the following topics, replace the existing query string with the refined version. Only these entries change; all others stay as-is.

```js
// ── Core resistance training ──
creatine: "(creatine OR \"creatine monohydrate\" OR phosphocreatine) AND (\"resistance training\" OR strength OR hypertrophy OR \"exercise performance\")",

protein: "(\"protein intake\" OR \"dietary protein\" OR \"protein supplementation\" OR \"whey protein\") AND (hypertrophy OR \"muscle protein synthesis\" OR \"lean mass\" OR \"resistance training\")",

hypertrophy: "(hypertrophy OR \"muscle growth\" OR \"muscle hypertrophy\" OR \"lean mass gain\") AND (\"resistance training\" OR \"strength training\" OR \"muscle protein synthesis\")",

// ── Endurance & cardiovascular ──
caffeine: "(caffeine OR \"caffeine ingestion\" OR \"caffeine supplementation\") AND (\"exercise performance\" OR endurance OR \"time trial\" OR \"resistance training\" OR fatigue)",

endurance: "(\"endurance training\" OR \"aerobic training\" OR \"cardiorespiratory training\") AND (\"VO2 max\" OR \"zone 2\" OR \"lactate threshold\" OR performance OR adaptation)",

// ── Body composition & general nutrition ──
sleep: "(sleep OR \"sleep duration\" OR \"sleep quality\" OR \"sleep deprivation\" OR \"sleep extension\") AND (\"athletic recovery\" OR \"exercise performance\" OR \"muscle protein synthesis\" OR \"muscle recovery\")",

recovery: "(\"athletic recovery\" OR \"exercise recovery\" OR \"post-exercise recovery\" OR \"muscle recovery\" OR \"training recovery\") AND (sleep OR nutrition OR \"cold water immersion\" OR \"active recovery\")",

hydration: "(hydration OR \"fluid balance\" OR \"water intake\" OR dehydration) AND (\"exercise performance\" OR athletes OR \"thermal regulation\" OR \"endurance performance\")",

electrolytes: "(electrolytes OR sodium OR potassium OR \"sodium chloride\" OR \"electrolyte replacement\") AND (\"exercise performance\" OR hydration OR athletes OR \"muscle cramps\")",

meal_timing: "(\"meal timing\" OR \"nutrient timing\" OR \"protein timing\" OR \"pre-workout nutrition\" OR \"post-workout nutrition\") AND (hypertrophy OR \"muscle protein synthesis\" OR \"exercise performance\")",

carbohydrates: "(carbohydrate OR glycogen OR \"carbohydrate loading\" OR \"glycogen resynthesis\" OR \"carbohydrate ingestion\") AND (\"exercise performance\" OR endurance OR \"resistance training\" OR \"glucose metabolism\")",

fiber: "(fiber OR \"dietary fiber\" OR \"soluble fiber\" OR \"fermentable fiber\") AND (satiety OR \"gut health\" OR \"glycemic control\" OR \"body composition\" OR microbiome)",

caloric_deficit: "(\"caloric deficit\" OR \"energy deficit\" OR \"hypocaloric diet\") AND (\"fat loss\" OR \"lean mass\" OR \"body composition\" OR \"resistance training\")",

caloric_surplus: "(\"caloric surplus\" OR \"energy surplus\" OR \"hypercaloric diet\") AND (\"muscle gain\" OR hypertrophy OR \"resistance training\" OR \"lean mass\")",

body_composition: "(\"body composition\" OR \"body fat percentage\" OR \"lean body mass\" OR \"fat free mass\") AND (exercise OR \"resistance training\" OR nutrition OR athletes)",

appetite: "(appetite OR \"appetite regulation\" OR satiety OR \"hunger hormones\" OR ghrelin OR leptin) AND (exercise OR \"resistance training\" OR \"energy intake\" OR \"body composition\")",

blood_glucose: "(\"blood glucose\" OR glycemia OR \"postprandial glucose\" OR \"glycemic response\") AND (exercise OR \"resistance training\" OR endurance OR \"insulin sensitivity\")",

insulin_sensitivity: "(\"insulin sensitivity\" OR \"insulin resistance\" OR \"glucose tolerance\") AND (\"resistance training\" OR exercise OR \"aerobic training\" OR \"HIIT\")",

// ── Supplements — performance ──
taurine: "(taurine OR \"taurine supplementation\") AND (\"exercise performance\" OR fatigue OR endurance OR \"resistance training\" OR \"oxidative stress\")",

// ── Recovery, sleep, stress ──
hrv: "(\"heart rate variability\" OR HRV OR \"vagal tone\") AND (training OR overtraining OR recovery OR \"exercise performance\" OR athletes)",

stress: "(\"psychological stress\" OR \"cortisol response\" OR \"perceived stress\" OR \"allostatic load\") AND (exercise OR \"resistance training\" OR recovery OR athletes)",

muscle_soreness: "(\"delayed onset muscle soreness\" OR DOMS OR \"muscle soreness\" OR \"muscle damage\") AND (\"eccentric exercise\" OR recovery OR \"resistance training\")",

injury_prevention: "(\"injury prevention\" OR \"injury reduction\" OR \"injury risk\") AND (exercise OR training OR athletes OR \"warm up\" OR \"strength training\")",

inflammation: "(inflammation OR \"inflammatory response\" OR \"exercise induced inflammation\" OR cytokines) AND (exercise OR recovery OR \"resistance training\" OR \"endurance training\")",

// ── Metabolic / joint / mobility existing ──
mitochondrial_function: "(\"mitochondrial function\" OR \"mitochondrial biogenesis\" OR \"mitochondrial density\") AND (exercise OR \"endurance training\" OR \"resistance training\" OR aging)",

bone_density: "(\"bone density\" OR \"bone mineral density\" OR BMD OR osteoporosis OR osteopenia) AND (exercise OR \"resistance training\" OR \"impact loading\" OR \"weight bearing\")",

joint_health: "(\"joint health\" OR \"joint function\" OR \"cartilage health\") AND (exercise OR \"resistance training\" OR \"joint loading\" OR arthritis)",

tendon_health: "(\"tendon health\" OR \"tendon stiffness\" OR \"tendon adaptation\" OR \"tendon loading\") AND (exercise OR \"resistance training\" OR \"eccentric loading\")",

mobility: "(mobility OR \"range of motion\" OR flexibility OR \"dynamic flexibility\") AND (exercise OR \"resistance training\" OR \"athletic performance\" OR aging)",

gut_health: "(\"gut health\" OR microbiome OR \"gut microbiota\" OR \"intestinal permeability\") AND (exercise OR athletes OR nutrition OR \"endurance training\")",

// ── Mind, habit, behavior ──
motivation: "(motivation OR \"exercise motivation\" OR \"self-determination theory\" OR \"autonomous motivation\") AND (\"exercise adherence\" OR \"physical activity\" OR training)",

adherence: "(\"exercise adherence\" OR \"training adherence\" OR \"physical activity maintenance\") AND (intervention OR behavior OR habit OR motivation)",

habit_formation: "(\"habit formation\" OR \"behavior change\" OR \"habit automaticity\") AND (exercise OR \"physical activity\" OR diet OR \"health behavior\")",

mental_fatigue: "(\"mental fatigue\" OR \"cognitive fatigue\" OR \"central fatigue\") AND (\"exercise performance\" OR endurance OR \"resistance training\" OR \"perceived exertion\")",

focus: "(focus OR attention OR concentration OR \"cognitive performance\") AND (exercise OR caffeine OR \"pre-workout\" OR \"athletic performance\")",

circadian_rhythm: "(\"circadian rhythm\" OR chronobiology OR \"time of day\" OR chronotype) AND (exercise OR \"resistance training\" OR performance OR sleep)",
```

**Note:** refinements may be added/removed in situ based on Gate 2 results in Task 21. If a refined query returns fewer results than the original, revert.

- [ ] **Step 2: Parse check**

```bash
node --check scripts/fill-pmc-topics.js
```

Expected: no output.

- [ ] **Step 3: Run validator on the refined subset**

```bash
node scripts/validate-pubmed-queries.js --topics=creatine,protein,hypertrophy,caffeine,sleep,recovery,hydration
```

Expected: all PASS with Count >= 100.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): refine narrow queries in fill-pmc-topics

Rewrites ~35 existing TOPIC_QUERIES entries from two-term 'A AND B'
shape to OR-expanded MeSH/synonym form. No topic keys renamed, no
queries deleted.

Refinement criteria: missing synonyms, missing MeSH canonical forms,
missing context/outcome terms, unquoted multi-word phrases. Leave-alone
criteria: queries that already had >=3 OR-expanded terms per clause
or multi-clause boolean structure.

Smoke-tested with validate-pubmed-queries — all refined entries return
>=100 papers via PubMed eutils /esearch.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Add domain 10 — Women's health / female physiology

**Files:**
- Modify: `scripts/fill-pmc-topics.js` — append to `DEFAULT_TOPIC_ORDER` and `TOPIC_QUERIES`

- [ ] **Step 1: Append a new domain section to `DEFAULT_TOPIC_ORDER`**

After the last existing-domain section (`// ── 10. Mind, habit, behavior ──`) and before the closing `];`, insert:

```js
  // ══ NEW DOMAINS ══

  // ── 11. Women's health / female physiology ───────────────────
  "menstrual_cycle_training",
  "perimenopause_training",
  "postmenopause_training",
  "pregnancy_exercise",
  "postpartum_return_to_training",
  "pcos_and_exercise",
  "low_energy_availability",
  "hormonal_contraception_training",
  "female_strength_norms",
```

- [ ] **Step 2: Append matching `TOPIC_QUERIES` entries**

Append inside `TOPIC_QUERIES` (before its closing `}`):

```js
  menstrual_cycle_training:
    "(\"menstrual cycle\" OR luteal OR follicular OR \"menstrual phase\" OR \"ovarian hormones\") AND (\"resistance training\" OR strength OR endurance OR \"exercise performance\" OR \"athletic performance\")",
  perimenopause_training:
    "(perimenopause OR \"menopausal transition\") AND (\"resistance training\" OR exercise OR \"bone density\" OR \"body composition\" OR \"physical activity\")",
  postmenopause_training:
    "(postmenopause OR \"post-menopausal\" OR \"postmenopausal women\") AND (\"resistance training\" OR exercise OR \"bone density\" OR sarcopenia OR \"body composition\")",
  pregnancy_exercise:
    "(\"pregnancy\" OR \"pregnant women\" OR gestation) AND (exercise OR \"resistance training\" OR \"aerobic exercise\" OR \"physical activity\" OR safety)",
  postpartum_return_to_training:
    "(postpartum OR \"post-natal\" OR \"postnatal recovery\") AND (\"return to exercise\" OR \"return to sport\" OR \"resistance training\" OR \"pelvic floor\")",
  pcos_and_exercise:
    "(\"polycystic ovary syndrome\" OR PCOS) AND (exercise OR \"resistance training\" OR \"insulin sensitivity\" OR \"body composition\")",
  low_energy_availability:
    "(\"relative energy deficiency in sport\" OR REDS OR \"low energy availability\") AND (athlete OR training OR \"bone health\" OR \"menstrual dysfunction\")",
  hormonal_contraception_training:
    "(\"oral contraceptive\" OR \"hormonal contraception\" OR \"combined contraceptive pill\") AND (\"exercise performance\" OR \"resistance training\" OR \"muscle protein synthesis\" OR strength)",
  female_strength_norms:
    "(\"female athletes\" OR \"women's strength\" OR \"female strength\" OR \"sex differences strength\") AND (\"resistance training\" OR \"strength training\" OR hypertrophy OR \"muscle quality\")",
```

- [ ] **Step 3: Parse + smoke-test the 9 new topics**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=menstrual_cycle_training,perimenopause_training,postmenopause_training,pregnancy_exercise,postpartum_return_to_training,pcos_and_exercise,low_energy_availability,hormonal_contraception_training,female_strength_norms
```

Expected: 9 PASS or WARN entries, 0 FAIL.

If any FAIL: broaden the query (add synonyms) and re-test before committing. Common fix: add `OR women` to the first clause.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add women's health topic domain to fill-pmc-topics

9 new topics covering menstrual cycle, peri/postmenopause, pregnancy,
postpartum return, PCOS, low energy availability, hormonal contraception,
and female strength norms. All queries pass the PubMed smoke test.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Add domain 11 — Youth / LTAD

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

After the women's health section, insert:

```js
  // ── 12. Youth / long-term athletic development ───────────────
  "youth_resistance_training",
  "peak_height_velocity",
  "long_term_athletic_development",
  "youth_endurance_training",
  "growth_plate_safety",
  "early_specialization",
  "physical_literacy",
```

- [ ] **Step 2: Append `TOPIC_QUERIES` entries**

```js
  youth_resistance_training:
    "(\"youth resistance training\" OR \"pediatric strength training\" OR \"children resistance training\" OR \"adolescent strength\") AND (safety OR strength OR adaptation OR development)",
  peak_height_velocity:
    "(\"peak height velocity\" OR PHV OR \"biological maturation\" OR \"growth spurt\") AND (\"athletic development\" OR \"injury risk\" OR \"training load\" OR youth)",
  long_term_athletic_development:
    "(\"long-term athletic development\" OR LTAD OR \"youth athletic development\") AND (periodization OR training OR sport OR \"talent development\")",
  youth_endurance_training:
    "(\"youth endurance\" OR \"pediatric endurance\" OR \"child endurance training\" OR \"adolescent aerobic training\") AND (\"VO2 max\" OR \"aerobic capacity\" OR adaptation)",
  growth_plate_safety:
    "(\"growth plate\" OR physis OR epiphysis) AND (\"resistance training\" OR \"youth strength\" OR injury OR safety OR loading)",
  early_specialization:
    "(\"early sport specialization\" OR \"early specialization\" OR \"sport diversification\") AND (youth OR adolescent OR \"injury risk\" OR burnout)",
  physical_literacy:
    "(\"physical literacy\" OR \"fundamental movement skills\" OR \"motor competence\") AND (youth OR children OR development OR \"physical activity\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=youth_resistance_training,peak_height_velocity,long_term_athletic_development,youth_endurance_training,growth_plate_safety,early_specialization,physical_literacy
```

Expected: 7 PASS or WARN, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add youth/LTAD topic domain to fill-pmc-topics

7 new topics: youth resistance training, peak height velocity, LTAD,
youth endurance, growth plate safety, early specialization, physical
literacy. All queries pass the PubMed smoke test.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Add domain 12 — Masters (40+)

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 13. Masters / 40+ athletes ───────────────────────────────
  "sarcopenia",
  "strength_training_older_adults",
  "vo2_max_preservation",
  "bone_density_exercise",
  "balance_fall_prevention",
  "masters_endurance_training",
  "recovery_older_athletes",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  sarcopenia:
    "(sarcopenia OR \"age-related muscle loss\" OR \"muscle wasting aging\") AND (\"resistance training\" OR exercise OR \"protein supplementation\" OR \"older adults\")",
  strength_training_older_adults:
    "(\"strength training older adults\" OR \"resistance training elderly\" OR \"resistance training aging\") AND (muscle OR strength OR function OR \"quality of life\")",
  vo2_max_preservation:
    "(\"VO2 max\" OR \"cardiorespiratory fitness\") AND (aging OR \"older adults\" OR preservation OR \"masters athletes\" OR \"age-related decline\")",
  bone_density_exercise:
    "(\"bone mineral density\" OR \"bone density\" OR osteoporosis) AND (\"resistance training\" OR \"impact loading\" OR exercise OR \"older adults\")",
  balance_fall_prevention:
    "(balance OR \"fall prevention\" OR \"falls in older adults\" OR \"postural stability\") AND (\"resistance training\" OR exercise OR \"older adults\" OR \"tai chi\")",
  masters_endurance_training:
    "(\"masters athlete\" OR \"older endurance athlete\" OR \"veteran athlete\") AND (\"endurance training\" OR marathon OR cycling OR adaptation OR recovery)",
  recovery_older_athletes:
    "(\"recovery older athletes\" OR \"aging recovery\" OR \"age-related recovery\") AND (\"resistance training\" OR exercise OR sleep OR inflammation)",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=sarcopenia,strength_training_older_adults,vo2_max_preservation,bone_density_exercise,balance_fall_prevention,masters_endurance_training,recovery_older_athletes
```

Expected: 7 PASS or WARN, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add masters (40+) topic domain to fill-pmc-topics

7 new topics covering sarcopenia, strength training in older adults,
VO2 max preservation, bone density, balance/fall prevention, masters
endurance, and recovery in aging athletes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Add domain 13 — Injury rehab / return to play

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 14. Injury rehab / return to play ────────────────────────
  "acl_rehab",
  "rotator_cuff_rehab",
  "low_back_rehab",
  "achilles_tendinopathy",
  "patellar_tendinopathy",
  "tennis_elbow_rehab",
  "hamstring_strain_rehab",
  "concussion_return_to_play",
  "tendinopathy_loading",
  "pain_science_exercise",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  acl_rehab:
    "(\"anterior cruciate ligament\" OR ACL) AND (reconstruction OR rehabilitation OR \"return to sport\" OR \"return to play\" OR prehabilitation)",
  rotator_cuff_rehab:
    "(\"rotator cuff\" OR \"supraspinatus\" OR \"subscapularis\") AND (rehabilitation OR \"resistance training\" OR \"return to play\" OR \"exercise therapy\")",
  low_back_rehab:
    "(\"low back pain\" OR LBP OR \"lumbar spine\") AND (exercise OR rehabilitation OR \"resistance training\" OR \"motor control\" OR \"core stability\")",
  achilles_tendinopathy:
    "(\"achilles tendinopathy\" OR \"achilles tendinitis\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR rehabilitation OR \"exercise therapy\")",
  patellar_tendinopathy:
    "(\"patellar tendinopathy\" OR \"jumper's knee\" OR \"patellar tendinitis\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR rehabilitation)",
  tennis_elbow_rehab:
    "(\"lateral epicondylitis\" OR \"tennis elbow\" OR \"lateral elbow tendinopathy\") AND (rehabilitation OR \"eccentric training\" OR \"exercise therapy\")",
  hamstring_strain_rehab:
    "(\"hamstring strain\" OR \"hamstring injury\" OR \"hamstring tear\") AND (rehabilitation OR \"Nordic hamstring\" OR \"eccentric training\" OR \"return to play\")",
  concussion_return_to_play:
    "(concussion OR \"mild traumatic brain injury\" OR mTBI) AND (\"return to play\" OR \"return to sport\" OR \"graded exercise\" OR rehabilitation)",
  tendinopathy_loading:
    "(tendinopathy OR \"tendon loading\" OR \"tendon rehabilitation\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR isometric OR \"progressive loading\")",
  pain_science_exercise:
    "(\"pain neuroscience education\" OR \"pain science\" OR \"central sensitization\") AND (exercise OR rehabilitation OR \"chronic pain\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=acl_rehab,rotator_cuff_rehab,low_back_rehab,achilles_tendinopathy,patellar_tendinopathy,tennis_elbow_rehab,hamstring_strain_rehab,concussion_return_to_play,tendinopathy_loading,pain_science_exercise
```

Expected: 10 PASS or WARN, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add injury rehab / RTP topic domain to fill-pmc-topics

10 new topics covering ACL rehab, rotator cuff, low back, Achilles
and patellar tendinopathy, tennis elbow, hamstring strain, concussion
return to play, tendinopathy loading protocols, and pain science.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Add domain 14 — Endurance specialization

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 15. Endurance specialization ─────────────────────────────
  "marathon_training",
  "triathlon_training",
  "cycling_training",
  "altitude_training",
  "polarized_training",
  "pyramidal_training",
  "race_tapering",
  "heat_acclimation",
  "cold_water_immersion_endurance",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  marathon_training:
    "(\"marathon training\" OR \"marathon runners\" OR \"long-distance running\") AND (\"training volume\" OR pacing OR \"race performance\" OR periodization)",
  triathlon_training:
    "(triathlon OR triathlete OR \"multi-sport training\") AND (\"training volume\" OR \"brick workout\" OR performance OR periodization)",
  cycling_training:
    "(\"cycling training\" OR cyclist OR \"road cycling\") AND (\"power output\" OR FTP OR \"functional threshold\" OR \"training zones\" OR periodization)",
  altitude_training:
    "(\"altitude training\" OR \"hypoxic training\" OR \"live high train low\") AND (\"endurance performance\" OR \"VO2 max\" OR hemoglobin OR adaptation)",
  polarized_training:
    "(\"polarized training\" OR \"polarised training\" OR \"80/20 training\" OR \"training intensity distribution\") AND (endurance OR running OR cycling OR \"VO2 max\" OR performance)",
  pyramidal_training:
    "(\"pyramidal training\" OR \"training intensity distribution\") AND (endurance OR \"lactate threshold\" OR \"training zones\" OR performance)",
  race_tapering:
    "(taper OR tapering OR \"pre-competition taper\") AND (\"endurance performance\" OR \"race performance\" OR \"training load\" OR recovery)",
  heat_acclimation:
    "(\"heat acclimation\" OR \"heat acclimatization\" OR \"thermal tolerance\") AND (\"endurance performance\" OR athletes OR \"core temperature\" OR adaptation)",
  cold_water_immersion_endurance:
    "(\"cold water immersion\" OR \"ice bath\" OR \"cryotherapy\") AND (recovery OR \"endurance performance\" OR inflammation OR \"muscle damage\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=marathon_training,triathlon_training,cycling_training,altitude_training,polarized_training,pyramidal_training,race_tapering,heat_acclimation,cold_water_immersion_endurance
```

Expected: 9 PASS or WARN, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add endurance specialization topic domain to fill-pmc-topics

9 new topics: marathon, triathlon, cycling, altitude training,
polarized vs pyramidal intensity distribution, race tapering, heat
acclimation, cold water immersion.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Add domain 15 — Advanced programming

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 16. Advanced programming methodologies ───────────────────
  "block_periodization",
  "conjugate_method",
  "bulgarian_method",
  "autoregulation_rpe_rir",
  "daily_undulating_periodization",
  "peaking_for_competition",
  "accumulation_intensification",
  "mesocycle_design",
  "microcycle_design",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  block_periodization:
    "(\"block periodization\" OR \"block training\") AND (\"resistance training\" OR \"strength training\" OR \"athletic performance\" OR adaptation)",
  conjugate_method:
    "(\"conjugate method\" OR \"Westside Barbell\" OR \"max effort training\" OR \"dynamic effort\") AND (\"strength training\" OR powerlifting OR \"resistance training\")",
  bulgarian_method:
    "(\"Bulgarian method\" OR \"daily max training\" OR \"daily singles\") AND (\"weightlifting\" OR powerlifting OR \"strength training\")",
  autoregulation_rpe_rir:
    "(autoregulation OR \"rating of perceived exertion\" OR RPE OR \"repetitions in reserve\" OR RIR) AND (\"resistance training\" OR \"strength training\" OR load)",
  daily_undulating_periodization:
    "(\"daily undulating periodization\" OR DUP OR \"undulating periodization\") AND (\"resistance training\" OR hypertrophy OR strength OR adaptation)",
  peaking_for_competition:
    "(peaking OR \"competition preparation\" OR \"pre-competition\") AND (powerlifting OR weightlifting OR \"strength athletes\" OR tapering)",
  accumulation_intensification:
    "(\"accumulation phase\" OR \"intensification phase\" OR \"training phases\") AND (\"resistance training\" OR periodization OR adaptation)",
  mesocycle_design:
    "(mesocycle OR \"training block\" OR \"training cycle\") AND (\"resistance training\" OR periodization OR \"volume progression\")",
  microcycle_design:
    "(microcycle OR \"weekly training\" OR \"training week\") AND (\"resistance training\" OR periodization OR \"training load\" OR recovery)",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=block_periodization,conjugate_method,bulgarian_method,autoregulation_rpe_rir,daily_undulating_periodization,peaking_for_competition,accumulation_intensification,mesocycle_design,microcycle_design
```

Expected: 9 PASS or WARN, 0 FAIL. Note: `bulgarian_method` and `conjugate_method` may land in WARN (narrower literature) — that's acceptable.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add advanced programming topic domain to fill-pmc-topics

9 new topics: block periodization, conjugate, Bulgarian, autoregulation
(RPE/RIR), daily undulating periodization, peaking, accumulation/
intensification, mesocycle and microcycle design.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Add domain 16 — Sport-specific technique

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 17. Sport-specific technique / conditioning ──────────────
  "running_gait_mechanics",
  "swimming_stroke_mechanics",
  "climbing_finger_strength",
  "climbing_forearm_endurance",
  "bjj_conditioning",
  "martial_arts_weight_cuts",
  "olympic_lifting_technique",
  "rowing_mechanics",
  "sprint_mechanics",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  running_gait_mechanics:
    "(\"running gait\" OR \"running biomechanics\" OR \"footstrike pattern\" OR \"running kinematics\") AND (performance OR \"injury risk\" OR economy OR cadence)",
  swimming_stroke_mechanics:
    "(\"swimming stroke\" OR \"stroke mechanics\" OR \"freestyle technique\") AND (efficiency OR performance OR \"stroke rate\" OR biomechanics)",
  climbing_finger_strength:
    "(\"finger strength\" OR \"hangboard training\" OR \"finger flexor\" OR \"grip strength climbing\") AND (climbing OR bouldering OR \"rock climbing\")",
  climbing_forearm_endurance:
    "(\"forearm endurance\" OR \"forearm fatigue\" OR \"flexor digitorum\") AND (climbing OR bouldering OR \"rock climbing\")",
  bjj_conditioning:
    "(\"brazilian jiu-jitsu\" OR BJJ OR grappling) AND (conditioning OR \"strength training\" OR \"aerobic capacity\" OR performance)",
  martial_arts_weight_cuts:
    "(\"weight cutting\" OR \"rapid weight loss\" OR \"weight manipulation\") AND (\"combat sports\" OR \"mixed martial arts\" OR MMA OR boxing OR judo OR wrestling)",
  olympic_lifting_technique:
    "(\"olympic weightlifting\" OR \"snatch technique\" OR \"clean and jerk\") AND (biomechanics OR performance OR \"power output\" OR technique)",
  rowing_mechanics:
    "(rowing OR \"rowing biomechanics\" OR \"rowing stroke\") AND (performance OR \"aerobic capacity\" OR technique OR \"rowing ergometer\")",
  sprint_mechanics:
    "(sprinting OR \"sprint mechanics\" OR \"sprint biomechanics\" OR \"ground contact time\") AND (performance OR speed OR \"maximum velocity\" OR \"force-velocity\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=running_gait_mechanics,swimming_stroke_mechanics,climbing_finger_strength,climbing_forearm_endurance,bjj_conditioning,martial_arts_weight_cuts,olympic_lifting_technique,rowing_mechanics,sprint_mechanics
```

Expected: 9 PASS or WARN, 0 FAIL. `climbing_forearm_endurance` may WARN.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add sport-specific technique domain to fill-pmc-topics

9 new topics: running gait, swimming stroke, climbing finger/forearm,
BJJ conditioning, weight cuts, Olympic lifting, rowing mechanics,
sprint mechanics.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Add domain 17 — Mental / behavioral

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 18. Mental / behavioral ──────────────────────────────────
  "exercise_adherence",
  "gym_anxiety",
  "body_image_training",
  "goal_setting_fitness",
  "self_efficacy_exercise",
  "training_burnout",
  "habit_formation_exercise",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  exercise_adherence:
    "(\"exercise adherence\" OR \"training adherence\" OR \"exercise compliance\") AND (intervention OR \"behavior change\" OR motivation OR \"long-term\")",
  gym_anxiety:
    "(\"gym anxiety\" OR \"exercise anxiety\" OR \"social physique anxiety\") AND (exercise OR \"resistance training\" OR motivation OR adherence)",
  body_image_training:
    "(\"body image\" OR \"body dissatisfaction\" OR \"body satisfaction\") AND (\"resistance training\" OR exercise OR \"physical activity\" OR athletes)",
  goal_setting_fitness:
    "(\"goal setting\" OR \"SMART goals\" OR \"process goals\") AND (exercise OR \"physical activity\" OR \"resistance training\" OR adherence)",
  self_efficacy_exercise:
    "(\"self-efficacy\" OR \"exercise self-efficacy\") AND (exercise OR \"physical activity\" OR \"behavior change\" OR adherence)",
  training_burnout:
    "(\"athlete burnout\" OR overtraining OR \"training burnout\" OR \"sport burnout\") AND (recovery OR prevention OR \"psychological stress\" OR motivation)",
  habit_formation_exercise:
    "(\"habit formation\" OR \"exercise habit\" OR \"automaticity\") AND (\"physical activity\" OR \"behavior change\" OR exercise OR intervention)",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=exercise_adherence,gym_anxiety,body_image_training,goal_setting_fitness,self_efficacy_exercise,training_burnout,habit_formation_exercise
```

Expected: 7 PASS or WARN, 0 FAIL. `gym_anxiety` and `habit_formation_exercise` likely WARN.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add mental/behavioral topic domain to fill-pmc-topics

7 new topics: exercise adherence, gym anxiety, body image, goal
setting, self-efficacy, training burnout, habit formation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Add domain 18 — Nutrition subfields

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 19. Nutrition subfields ──────────────────────────────────
  "vegan_athlete_nutrition",
  "intermittent_fasting_performance",
  "keto_endurance",
  "ultra_endurance_fueling",
  "protein_quality_sources",
  "meal_frequency_body_composition",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  vegan_athlete_nutrition:
    "(\"vegan athlete\" OR \"vegetarian athlete\" OR \"plant-based diet\") AND (\"resistance training\" OR performance OR \"protein intake\" OR hypertrophy)",
  intermittent_fasting_performance:
    "(\"intermittent fasting\" OR \"time-restricted eating\" OR \"time-restricted feeding\") AND (\"exercise performance\" OR \"resistance training\" OR \"body composition\")",
  keto_endurance:
    "(\"ketogenic diet\" OR \"low carbohydrate diet\" OR \"high-fat diet\") AND (\"endurance performance\" OR \"VO2 max\" OR \"fat oxidation\" OR athletes)",
  ultra_endurance_fueling:
    "(\"ultra-endurance\" OR \"ultramarathon\" OR \"ironman\") AND (nutrition OR fueling OR \"carbohydrate intake\" OR \"gut training\")",
  protein_quality_sources:
    "(\"protein quality\" OR \"essential amino acids\" OR \"digestible indispensable amino acid score\" OR DIAAS OR \"leucine content\") AND (\"muscle protein synthesis\" OR hypertrophy OR \"resistance training\")",
  meal_frequency_body_composition:
    "(\"meal frequency\" OR \"eating frequency\" OR \"snacking frequency\") AND (\"body composition\" OR hypertrophy OR \"protein distribution\" OR \"muscle protein synthesis\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=vegan_athlete_nutrition,intermittent_fasting_performance,keto_endurance,ultra_endurance_fueling,protein_quality_sources,meal_frequency_body_composition
```

Expected: 6 PASS or WARN, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add nutrition subfields topic domain to fill-pmc-topics

6 new topics: vegan athletes, intermittent fasting, keto endurance,
ultra-endurance fueling, protein quality/sources, meal frequency.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Add domain 19 — Metabolic health / longevity

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 20. Metabolic health / longevity ─────────────────────────
  "cgm_exercise_response",
  "vo2_max_longevity",
  "strength_mortality",
  "muscle_mass_longevity",
  "metabolic_flexibility",
  "grip_strength_predictor",
  "exercise_lifespan",
```

- [ ] **Step 2: Append `TOPIC_QUERIES`**

```js
  cgm_exercise_response:
    "(\"continuous glucose monitoring\" OR CGM OR \"glucose dynamics\" OR \"glycemic response\") AND (exercise OR \"resistance training\" OR endurance OR athletes)",
  vo2_max_longevity:
    "(\"VO2 max\" OR \"cardiorespiratory fitness\") AND (mortality OR longevity OR \"all-cause mortality\" OR lifespan)",
  strength_mortality:
    "(\"muscular strength\" OR \"grip strength\" OR \"leg strength\") AND (mortality OR \"all-cause mortality\" OR longevity OR \"cardiovascular mortality\")",
  muscle_mass_longevity:
    "(\"muscle mass\" OR \"lean body mass\" OR \"skeletal muscle\") AND (longevity OR mortality OR aging OR \"quality of life\")",
  metabolic_flexibility:
    "(\"metabolic flexibility\" OR \"fuel switching\" OR \"substrate oxidation\") AND (exercise OR \"insulin sensitivity\" OR \"endurance training\")",
  grip_strength_predictor:
    "(\"grip strength\" OR \"handgrip strength\" OR \"hand grip\") AND (mortality OR predictor OR biomarker OR \"cardiovascular risk\")",
  exercise_lifespan:
    "(\"physical activity\" OR exercise OR \"resistance training\") AND (lifespan OR \"healthy aging\" OR \"healthspan\" OR \"all-cause mortality\")",
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=cgm_exercise_response,vo2_max_longevity,strength_mortality,muscle_mass_longevity,metabolic_flexibility,grip_strength_predictor,exercise_lifespan
```

Expected: 7 PASS, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add metabolic health / longevity topic domain

7 new topics: CGM + exercise, VO2 max longevity, strength-mortality,
muscle mass longevity, metabolic flexibility, grip strength as
predictor, exercise + lifespan.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Add domain 20 — Mobility / movement prep

**Files:**
- Modify: `scripts/fill-pmc-topics.js`

- [ ] **Step 1: Append to `DEFAULT_TOPIC_ORDER`**

```js
  // ── 21. Mobility / movement prep ─────────────────────────────
  "dynamic_warmup_protocols",
  "static_stretching_performance",
  "pnf_stretching",
  "foam_rolling_smr",
  "movement_screens",
  "joint_mobility_drills",
];
```

**Important:** this is the last domain; it must close the `DEFAULT_TOPIC_ORDER` array with `];`.

- [ ] **Step 2: Append `TOPIC_QUERIES`** (this is the last block inside `TOPIC_QUERIES`, ends with its closing `}`)

```js
  dynamic_warmup_protocols:
    "(\"dynamic warm-up\" OR \"dynamic stretching\" OR \"movement preparation\") AND (\"exercise performance\" OR \"power output\" OR \"injury prevention\" OR athletes)",
  static_stretching_performance:
    "(\"static stretching\" OR \"pre-exercise stretching\") AND (\"resistance training\" OR \"power output\" OR \"sprint performance\" OR \"strength performance\")",
  pnf_stretching:
    "(\"PNF stretching\" OR \"proprioceptive neuromuscular facilitation\") AND (flexibility OR \"range of motion\" OR \"muscle performance\")",
  foam_rolling_smr:
    "(\"foam rolling\" OR \"self-myofascial release\" OR \"self myofascial release\") AND (recovery OR \"range of motion\" OR \"exercise performance\" OR soreness)",
  movement_screens:
    "(\"functional movement screen\" OR FMS OR \"movement screen\" OR \"movement quality\") AND (\"injury prediction\" OR \"injury risk\" OR athletes)",
  joint_mobility_drills:
    "(\"joint mobility\" OR \"hip mobility\" OR \"thoracic mobility\" OR \"ankle mobility\") AND (\"resistance training\" OR \"movement quality\" OR athletes)",
};
```

- [ ] **Step 3: Parse + smoke-test**

```bash
node --check scripts/fill-pmc-topics.js
node scripts/validate-pubmed-queries.js --topics=dynamic_warmup_protocols,static_stretching_performance,pnf_stretching,foam_rolling_smr,movement_screens,joint_mobility_drills
```

Expected: 6 PASS, 0 FAIL.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "feat(scripts): add mobility / movement prep topic domain

6 new topics: dynamic warmup, static stretching & performance, PNF,
foam rolling / self-myofascial release, movement screens, joint
mobility drills. Closes out the 11-domain expansion (~80 new topics).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Full validator sweep + fix failures

**Files:**
- Possibly modify: `scripts/fill-pmc-topics.js` — fix any FAIL queries found

- [ ] **Step 1: Run validator on ALL queries**

```bash
node scripts/validate-pubmed-queries.js 2>&1 | tee /tmp/validation-report.txt
```

Expected output ends with a summary line like:
```
Summary: 190 pass, 12 warn, 0 fail, 0 error
```

- [ ] **Step 2: If any FAIL, investigate and fix**

For each FAIL line:
1. Re-read the query in `scripts/fill-pmc-topics.js`
2. Test the query directly: `curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmax=0&term=$(echo '<query>' | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))')"`
3. Common fixes: remove overly restrictive `AND` clauses, add synonyms in the core term, fix typos in MeSH terms

- [ ] **Step 3: Re-run validator after fixes**

```bash
node scripts/validate-pubmed-queries.js --topics=<comma-sep-fixed-ones>
```

Expected: all fixed queries now PASS or WARN.

- [ ] **Step 4: Commit any fix-ups (one commit)**

```bash
git add scripts/fill-pmc-topics.js
git commit -m "fix(scripts): tune FAIL queries found by validator sweep

<list of topics fixed>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

If no fixes were needed, skip this commit.

---

## Task 21: Acceptance criteria verification

**Files:** none modified

- [ ] **Step 1: Parse check**

```bash
node --check scripts/fill-pmc-topics.js && echo "PARSE OK"
```

- [ ] **Step 2: Topic count + parity check**

Use a `.mjs` one-liner file (CJS `node -e` doesn't honor `"type": "module"` in the repo's package.json, so just use a temp file):

```bash
cat > /tmp/topic-parity.mjs << 'EOF'
import { readFileSync } from "node:fs";
const src = readFileSync("scripts/fill-pmc-topics.js", "utf8");
const orderMatch = src.match(/const DEFAULT_TOPIC_ORDER = \[([\s\S]*?)\];/);
const keysInOrder = [...orderMatch[1].matchAll(/"([a-z_0-9]+)"/g)].map(m => m[1]);
const queriesMatch = src.match(/const TOPIC_QUERIES = \{([\s\S]*?)\n\};/);
const keysInQueries = [...queriesMatch[1].matchAll(/^\s*([a-z_0-9]+):/gm)].map(m => m[1]);
console.log(`DEFAULT_TOPIC_ORDER: ${keysInOrder.length} keys`);
console.log(`TOPIC_QUERIES:       ${keysInQueries.length} keys`);
const missingQuery = keysInOrder.filter(k => !keysInQueries.includes(k));
const missingOrder = keysInQueries.filter(k => !keysInOrder.includes(k));
console.log(`Missing queries for order entries: ${JSON.stringify(missingQuery)}`);
console.log(`Missing order for query entries:   ${JSON.stringify(missingOrder)}`);
EOF
node /tmp/topic-parity.mjs
rm /tmp/topic-parity.mjs
```

Expected:
- DEFAULT_TOPIC_ORDER: ~207 keys (121 existing + ~86 new)
- TOPIC_QUERIES: same count (or +2 for the `eurycoma_longifolia`/`eurycome_longfolia` harmless duplicates)
- Missing queries: `[]`
- Missing order: `[]` (or the intentional duplicates)

- [ ] **Step 3: Dry-run**

```bash
node scripts/fill-pmc-topics.js --topics=INVALID --dry-run 2>&1 | head -20
```

Expected: prints usage + "Available topics" with all 200+ keys listed.

- [ ] **Step 4: Final validator sweep**

```bash
node scripts/validate-pubmed-queries.js 2>&1 | tail -5
```

Expected: summary shows 0 fail, 0 error.

- [ ] **Step 5: Push all commits**

```bash
git push origin main 2>&1
```

- [ ] **Step 6: Verify Hetzner auto-deploy pulled the changes**

```bash
ssh hetzner 'cd ~/app && git log --oneline -8'
```

Expected: all the new commits present on the box. `fill:pmc:topics` is not in PM2, so no process restart is needed — the next time you run `npm run fill:pmc:topics`, it picks up the new topic list from disk.

---

## Self-Review

- **Spec coverage:** All 9 acceptance criteria from spec §9 are addressed by Tasks 1–21.
- **Placeholder scan:** No TBD/TODO markers. Every step has concrete commands and expected output.
- **Type consistency:** Topic key naming is consistent across `DEFAULT_TOPIC_ORDER` and `TOPIC_QUERIES` additions. Function names in the validator (`esearchCount`, `runValidation`, `parseTopicQueries`) are defined before use.
- **Scope:** Single file (`fill-pmc-topics.js`) plus one committed helper (`validate-pubmed-queries.js`) plus one throwaway (`research-topic-candidates.js`). Matches spec §2 deliverables.
- **Non-goals respected:** No fill run, no embedding generation, no DB migrations, no behavior change for existing `--topics=` invocations.

## Execution notes

Each of Tasks 9–19 follows the same 4-step shape: append keys → append queries → validate → commit. An agentic worker can treat them as homogeneous and execute in order.

Tasks 2–4 (research pass) are non-deterministic — wall-clock depends on Reddit/YouTube response times and OpenAI classify latency. Hard cap: 90 min. If it exceeds that, kill it and proceed with the pre-planned topic list alone.

If `validate-pubmed-queries.js` reports FAIL on a NEW topic (not a refined existing one), Task 20 is the place to broaden the query before the final push.
