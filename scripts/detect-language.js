#!/usr/bin/env node
// scripts/detect-language.js
//
// One-shot batch language detection for research_articles. Tags every
// row with `language` (ISO 639-3) using franc against (title || abstract).
//
// Scope: --source <name> filter (default openalex+openaire+core, the
// aggregator sources that carry non-English content). PubMed/EuropePMC/
// eLife/preprint servers are English-only by curation; skip by default.
//
// Why batched: streaming through millions of titles + writing back is
// I/O bound. We pull 1000 rows at a time, classify in-memory, then
// bulk-UPDATE via unnest in one round-trip. ~5–15 ms classify per row;
// expect ~1–2 h total wall time for 1.3M rows.
//
//   node scripts/detect-language.js                    # all aggregator sources
//   node scripts/detect-language.js --source openalex  # one source only
//   node scripts/detect-language.js --redo             # re-tag rows that already have language set
//
// Run on Hetzner against prod DB (loads ~/app/.env).

import "dotenv/config";
import pg from "pg";
import { parseArgs } from "node:util";
import { franc } from "franc";

const BATCH = 1000;
const MIN_LENGTH = 12;  // franc returns 'und' below this; skip the call
const AGGREGATOR_SOURCES = ["openalex", "openaire", "core"];

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    redo:   { type: "boolean", default: false },
    limit:  { type: "string" },
  },
});

const sources = values.source ? [values.source] : AGGREGATOR_SOURCES;
const overallLimit = values.limit ? Number(values.limit) : Infinity;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

function log(...a) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}]`, ...a);
}

function detect(title, abstract) {
  const text = ((title || "") + " " + (abstract || "")).trim().slice(0, 4000);
  if (text.length < MIN_LENGTH) return "und";
  try {
    return franc(text, { minLength: MIN_LENGTH });
  } catch {
    return "und";
  }
}

async function processSource(source) {
  log(`source=${source} starting…`);
  const baseClause = values.redo
    ? `source = $1 AND (title IS NOT NULL OR abstract IS NOT NULL)`
    : `source = $1 AND language IS NULL AND (title IS NOT NULL OR abstract IS NOT NULL)`;

  const totalRes = await pool.query(
    `SELECT COUNT(*) AS c FROM research_articles WHERE ${baseClause}`,
    [source]
  );
  const total = Math.min(Number(totalRes.rows[0].c), overallLimit);
  log(`  ${total.toLocaleString()} rows to tag`);
  if (total === 0) return { source, processed: 0, langs: {} };

  let processed = 0;
  let lastPmid = -1;
  const langCounts = new Map();

  while (processed < total) {
    const remaining = total - processed;
    const lim = Math.min(BATCH, remaining);

    const sel = await pool.query(
      `SELECT pmid, title, abstract
         FROM research_articles
         WHERE ${baseClause} AND pmid > $2
         ORDER BY pmid ASC
         LIMIT $3`,
      [source, lastPmid, lim]
    );
    if (sel.rows.length === 0) break;

    const pmids = [];
    const langs = [];
    for (const row of sel.rows) {
      const lang = detect(row.title, row.abstract);
      pmids.push(Number(row.pmid));
      langs.push(lang);
      langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    }

    await pool.query(
      `UPDATE research_articles AS ra
          SET language = v.lang
          FROM (
            SELECT unnest($1::bigint[]) AS pmid,
                   unnest($2::text[])   AS lang
          ) v
        WHERE ra.pmid = v.pmid`,
      [pmids, langs]
    );

    processed += sel.rows.length;
    lastPmid = Number(sel.rows[sel.rows.length - 1].pmid);

    if (processed % (BATCH * 25) === 0 || processed >= total) {
      const top = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${k}=${v}`).join(" ");
      log(`  ${source}: ${processed.toLocaleString()}/${total.toLocaleString()} (${top})`);
    }
  }

  return { source, processed, langs: Object.fromEntries(langCounts) };
}

async function main() {
  log(`detect-language: sources=[${sources.join(",")}] redo=${values.redo}`);
  for (const source of sources) {
    const result = await processSource(source);
    log(`source=${source} done: ${result.processed.toLocaleString()} tagged`);
    log(`  language breakdown: ${JSON.stringify(result.langs)}`);
  }
  await pool.end();
  log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
