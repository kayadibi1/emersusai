// scripts/seed-research-topics.js
// One-shot idempotent seed: parses TOPIC_QUERIES and domain section comments
// out of fill-pmc-topics.js and upserts rows into research_topics.
// Safe to re-run — INSERT ... ON CONFLICT DO UPDATE keeps query/domain fresh.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse TOPIC_QUERIES JS object literal into a list of { topic_key, query, domain }.
 *
 * fill-pmc-topics.js has two structures:
 *   1. DEFAULT_TOPIC_ORDER — an array with section comments like:
 *        // ── 1. Core resistance training ──────────────────────────────
 *        "creatine",
 *      We use this to build a topic_key → domain map.
 *   2. TOPIC_QUERIES — an object where values may span multiple lines:
 *        creatine:
 *          "...",
 *        strength: "...",
 *      We parse this separately for keys + queries.
 */
export function parseTopicQueriesWithDomains(source) {
  // ── Step 1: build topic_key → domain from DEFAULT_TOPIC_ORDER ──
  const domainMap = new Map();
  const orderMatch = source.match(/const DEFAULT_TOPIC_ORDER\s*=\s*\[([\s\S]*?)\];/);
  if (orderMatch) {
    const orderBlock = orderMatch[1];
    const lines = orderBlock.split(/\r?\n/);
    let currentDomain = null;
    // Section header format: // ── N. Text ────────
    const sectionRe = /\/\/\s*──+\s*\d+\.\s*(.+?)\s*──+/;
    const keyRe = /^\s*"([a-z_0-9]+)"\s*,?\s*$/;
    for (const line of lines) {
      const s = line.match(sectionRe);
      if (s) {
        currentDomain = s[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        continue;
      }
      const k = line.match(keyRe);
      if (k && currentDomain) {
        domainMap.set(k[1], currentDomain);
      }
    }
  }

  // ── Step 2: parse TOPIC_QUERIES for keys + queries ──
  // The object may also have section comments for sections 11–21 which we use
  // to assign domains to topics not found in DEFAULT_TOPIC_ORDER.
  const queriesMatch = source.match(/const TOPIC_QUERIES\s*=\s*\{([\s\S]*?)\n\};/);
  if (!queriesMatch) {
    throw new Error("Could not find TOPIC_QUERIES in fill-pmc-topics.js");
  }
  const queriesBlock = queriesMatch[1];

  // Split into lines and scan for topic entries + section headers
  const lines = queriesBlock.split(/\r?\n/);
  const out = [];
  let currentDomain = null;
  const sectionRe = /\/\/\s*──+\s*\d+\.\s*(.+?)\s*──+/;
  // Topic key line: "  key:" or "  key: "value","
  const keyLineRe = /^\s{2}([a-z_0-9]+):/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Section header inside TOPIC_QUERIES
    const s = line.match(sectionRe);
    if (s) {
      currentDomain = s[1].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      i++;
      continue;
    }

    const km = line.match(keyLineRe);
    if (km) {
      const topic_key = km[1];
      // Determine domain: prefer the pre-built map (from DEFAULT_TOPIC_ORDER),
      // then fall back to currentDomain from TOPIC_QUERIES section headers.
      const domain = domainMap.get(topic_key) ?? currentDomain;

      // Collect the full value — may start on same line or next line.
      // Accumulate until we have a complete quoted string (odd number of unescaped quotes).
      // Strategy: find the opening " and scan until the closing ".
      let fullLine = line;
      let j = i + 1;
      // Check if the value is on the key line itself after ':'
      const afterColon = fullLine.replace(/^\s{2}[a-z_0-9]+:\s*/, "");
      // If it starts with a quote, consume until the closing quote
      if (afterColon.trimStart().startsWith('"')) {
        // Count unescaped quotes on current accumulated line
        while (!isCompleteQuotedValue(fullLine.replace(/^\s{2}[a-z_0-9]+:\s*/, "")) && j < lines.length) {
          fullLine += "\n" + lines[j];
          j++;
        }
      } else {
        // Value on next line
        while (j < lines.length && !isCompleteQuotedValue(lines[j]) && !lines[j].trimStart().startsWith('"')) {
          j++;
        }
        if (j < lines.length) {
          fullLine = lines[j];
          // Might span further lines
          j++;
          while (!isCompleteQuotedValue(fullLine) && j < lines.length && !lines[j].match(keyLineRe) && !lines[j].match(sectionRe)) {
            fullLine += "\n" + lines[j];
            j++;
          }
        }
      }

      // Extract the quoted value
      const queryMatch = fullLine.match(/"((?:[^"\\]|\\.)*)"/);
      if (queryMatch) {
        out.push({
          topic_key,
          query: queryMatch[1].replace(/\\"/g, '"'),
          domain,
        });
      }
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** Returns true if the string contains a complete quoted value (one string literal). */
function isCompleteQuotedValue(str) {
  const trimmed = str.trimStart();
  if (!trimmed.startsWith('"')) return false;
  // Count unescaped quotes: even total means closed
  let count = 0;
  for (let k = 0; k < trimmed.length; k++) {
    if (trimmed[k] === '"' && (k === 0 || trimmed[k - 1] !== '\\')) count++;
  }
  return count >= 2;
}

export async function seedResearchTopics({ databaseUrl }) {
  const srcPath = resolve(__dirname, "fill-pmc-topics.js");
  const src = readFileSync(srcPath, "utf8");
  const topics = parseTopicQueriesWithDomains(src);
  if (topics.length === 0) {
    throw new Error("parsed 0 topics from fill-pmc-topics.js — regex mismatch?");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let inserted = 0;
  let updated = 0;
  try {
    for (const t of topics) {
      const result = await client.query(
        `INSERT INTO public.research_topics (topic_key, query, domain, origin)
         VALUES ($1, $2, $3, 'seed')
         ON CONFLICT (topic_key) DO UPDATE
           SET query = EXCLUDED.query,
               domain = EXCLUDED.domain,
               updated_at = now()
         RETURNING xmax = 0 AS was_insert`,
        [t.topic_key, t.query, t.domain]
      );
      if (result.rows[0].was_insert) inserted++;
      else updated++;
    }
  } finally {
    await client.end();
  }
  return { inserted, updated, total: topics.length };
}

// Direct invocation: node scripts/seed-research-topics.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const result = await seedResearchTopics({ databaseUrl });
  console.log(`seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.total} total`);
}
