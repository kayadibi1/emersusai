#!/usr/bin/env node
// scripts/openalex-bulk/filter.js
//
// Local-only: stream OpenAlex S3 snapshot partitions, filter to our 303
// topic queries, dedup against existing corpus, emit matches.jsonl.gz.
// See docs/openalex-bulk-plan.md for full context.
//
// Usage:
//   node scripts/openalex-bulk/filter.js --smoke              # newest partition only
//   node scripts/openalex-bulk/filter.js --partitions=1,2,3   # by manifest index
//   node scripts/openalex-bulk/filter.js                      # everything (resumes)

import { createReadStream, createWriteStream, existsSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseQueryIntoGroups, matchesQueryGroups } from "../sources/_query-match.js";

// OpenAlex 2024 Topics taxonomy — curated topic allowlist.
// Primary filter is primary_topic.display_name match against this set.
// Topic-query match (our 303 topics) is annotation only, not gating.
const TOPIC_ALLOWLIST = new Set([
  // Exercise / Sport / Training
  "Sports Performance and Training",
  "Sports injuries and prevention",
  "Tendon Structure and Treatment",
  "Sports and Physical Education Research",
  "Physical Education and Training Studies",
  "Physical Education and Pedagogy",
  "Athletic Training and Education",
  "Effects of Vibration on Health",
  // Nutrition
  "Nutrition, Health and Food Behavior",
  "Clinical Nutrition and Gastroenterology",
  "Fatty Acid Research and Health",
  "Diet, Metabolism, and Disease",
  "Vitamin C and Antioxidants Research",
  "Vitamin K Research Studies",
  "Nuts composition and effects",
  "Sodium Intake and Health",
  "Magnesium in Health and Disease",
  "Pomegranate: compositions and health benefits",
  // Borderline but retained — resistance training / bone density overlap
  "Bone health and osteoporosis research",
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MANIFEST_URL = "https://openalex.s3.amazonaws.com/data/works/manifest";
const DEDUP_FILE = path.join(DATA_DIR, "dedup-index.csv.gz");
const TOPICS_FILE = path.join(DATA_DIR, "topics.json");
const MATCHES_FILE = path.join(DATA_DIR, "matches.jsonl.gz");
const PROGRESS_FILE = path.join(DATA_DIR, "processed-partitions.txt");
function log(...a) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}]`, ...a);
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return null;
  const positioned = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) positioned.push([pos, word]);
  }
  if (positioned.length === 0) return null;
  positioned.sort((a, b) => a[0] - b[0]);
  return positioned.map(([, w]) => w).join(" ");
}

function shortWorkId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/(W\d+)$/);
  return m ? m[1] : null;
}

function shortDoi(url) {
  if (!url || typeof url !== "string") return null;
  const stripped = url.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
  return stripped || null;
}

async function loadDedupSet() {
  log("loading dedup index…");
  const set = new Set();
  const rl = createInterface({
    input: createReadStream(DEDUP_FILE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) set.add(trimmed);
  }
  log(`dedup set size: ${set.size.toLocaleString()}`);
  return set;
}

function loadTopicGroups() {
  const topics = JSON.parse(readFileSync(TOPICS_FILE, "utf8"));
  const parsed = topics.map((t) => ({
    topic_key: t.topic_key,
    groups: parseQueryIntoGroups(t.query),
  }));
  log(`topics: ${parsed.length}, avg groups: ${(parsed.reduce((s, t) => s + t.groups.length, 0) / parsed.length).toFixed(1)}`);
  return parsed;
}

async function fetchManifest() {
  log("fetching manifest…");
  const resp = await fetch(MANIFEST_URL);
  if (!resp.ok) throw new Error(`manifest HTTP ${resp.status}`);
  const m = await resp.json();
  return m.entries.map((e, i) => ({
    idx: i,
    s3url: e.url,
    httpUrl: e.url.replace("s3://openalex/", "https://openalex.s3.amazonaws.com/"),
    bytes: e.meta.content_length,
    records: e.meta.record_count,
  }));
}

function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  return new Set(readFileSync(PROGRESS_FILE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean));
}

async function processPartition(entry, dedup, topics, out) {
  const t0 = Date.now();
  const resp = await fetch(entry.httpUrl);
  if (!resp.ok) throw new Error(`partition ${entry.idx} HTTP ${resp.status}`);
  const rl = createInterface({
    input: Readable.fromWeb(resp.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let seen = 0, matched = 0, dedupSkip = 0, topicSkip = 0;
  for await (const line of rl) {
    if (!line) continue;
    seen += 1;
    let work;
    try { work = JSON.parse(line); } catch { continue; }

    const wid = shortWorkId(work.id);
    const doi = shortDoi(work.doi);
    if (wid && dedup.has(wid)) { dedupSkip += 1; continue; }
    if (doi && dedup.has(doi)) { dedupSkip += 1; continue; }

    // Language gate: English only. OpenAlex's `work.language` is ISO 639-1.
    // NULL slips through to be tagged later by the franc backfill;
    // anything other than 'en' / 'sco' (Scots, franc's mis-tag for terse
    // English) is dropped at the filter so we don't ship Indonesian /
    // Russian / Turkish / Spanish papers to the ingest handler.
    if (work.language && work.language !== "en" && work.language !== "sco") continue;

    // SEO-spam gate: pipe-delimited title with no journal → ~95% garbage
    // in the 2026-04-22 audit (gym facility pages, supplement ads, tennis
    // resort flyers, hostel sites, cabinetry ads, vet-clinic pages).
    // Real research rarely uses " | " and real articles have a journal.
    const titleStr = (work.title || "").trim();
    const journalStr = work.primary_location?.source?.display_name || null;
    if (!journalStr && titleStr.includes(" | ")) continue;

    // Topic gate: OpenAlex ML-classified 2024 Topics taxonomy.
    const primaryTopic = work.primary_topic?.display_name || null;
    const subfield = work.primary_topic?.subfield?.display_name || null;
    if (!primaryTopic || !TOPIC_ALLOWLIST.has(primaryTopic)) { topicSkip += 1; continue; }

    const title = (work.title || "").trim();
    if (!title) continue;
    const abstract = reconstructAbstract(work.abstract_inverted_index);

    // Topic-query match is annotation only, not gating — OpenAlex subfield
    // is the reliable signal; topic labels help with downstream retrieval routing.
    const hitTopics = [];
    for (const t of topics) {
      if (matchesQueryGroups(t.groups, title, abstract)) hitTopics.push(t.topic_key);
    }

    const record = {
      external_id: wid,
      source: "openalex",
      title,
      abstract,
      doi,
      publication_date: work.publication_date || null,
      publication_year: work.publication_year || null,
      journal: work.primary_location?.source?.display_name || null,
      authors: (work.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
      peer_reviewed: work.type === "article",
      source_metadata: {
        openalex_id: wid,
        type: work.type,
        cited_by_count: work.cited_by_count ?? null,
        is_oa: work.open_access?.is_oa ?? null,
        oa_url: work.best_oa_location?.pdf_url || null,
        subfield,
        primary_topic: primaryTopic,
        matched_topics: hitTopics,
      },
    };
    const ok = out.write(JSON.stringify(record) + "\n");
    if (!ok) await new Promise((r) => out.once("drain", r));
    matched += 1;

    // Add newly-matched DOI/wid to dedup so subsequent partitions don't re-emit
    if (wid) dedup.add(wid);
    if (doi) dedup.add(doi);
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  log(`  part ${entry.idx}: records=${seen.toLocaleString()} matched=${matched} topicSkip=${topicSkip} dedup=${dedupSkip} (${sec}s)`);
  return { seen, matched, topicSkip, dedupSkip, sec: Number(sec) };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const args = process.argv.slice(2);
  const isSmoke = args.includes("--smoke");
  const partArg = args.find((a) => a.startsWith("--partitions="));
  const selectedIdx = partArg ? new Set(partArg.split("=")[1].split(",").map((n) => Number(n))) : null;

  const dedup = await loadDedupSet();
  const topics = loadTopicGroups();
  const manifest = await fetchManifest();

  let entries = manifest;
  if (isSmoke) entries = [manifest.at(-1)];          // newest partition only
  else if (selectedIdx) entries = manifest.filter((e) => selectedIdx.has(e.idx));

  const progress = loadProgress();
  const todo = entries.filter((e) => !progress.has(e.s3url));
  log(`plan: ${todo.length} partition(s) to process (${entries.length - todo.length} already done)`);
  if (todo.length === 0) { log("nothing to do"); return; }

  // Append mode — existing matches.jsonl.gz stays; new matches append.
  // Using a single gzip stream per run so the file is a concatenated gzip
  // (still valid, zcat handles it).
  const out = createGzip();
  const sink = createWriteStream(MATCHES_FILE, { flags: "a" });
  out.pipe(sink);

  const totals = { seen: 0, matched: 0, dedupSkip: 0, partitions: 0 };
  for (const entry of todo) {
    log(`partition ${entry.idx}/${manifest.length - 1}  ${entry.s3url}  (${(entry.bytes / 1e6).toFixed(0)} MB, ~${entry.records.toLocaleString()} records)`);
    try {
      const r = await processPartition(entry, dedup, topics, out);
      totals.seen += r.seen; totals.matched += r.matched; totals.dedupSkip += r.dedupSkip; totals.partitions += 1;
      appendFileSync(PROGRESS_FILE, entry.s3url + "\n");
    } catch (err) {
      log(`  FAIL part ${entry.idx}: ${err.message} — leaving unmarked so it retries`);
    }
  }

  await new Promise((resolve, reject) => {
    out.end();
    sink.on("finish", resolve); sink.on("error", reject);
  });

  log("DONE");
  log(JSON.stringify(totals, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
