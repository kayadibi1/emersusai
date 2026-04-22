#!/usr/bin/env node
// scripts/openalex-bulk/ingest-sources.js
//
// Downloads the OpenAlex Sources dump (~280k records, 347 MB across 39
// partitions), streams + normalizes + INSERTs into a local `openalex_sources`
// table. Used to build an ISSN-based journal trust signal for the
// research_articles.journal column.
//
// Schema (created idempotently):
//   CREATE TABLE openalex_sources (
//     source_id        text PRIMARY KEY,     -- 'S' prefix stripped
//     display_name     text,
//     display_name_norm text NOT NULL,       -- normalized for join
//     issn_l           text,
//     issn_count       int,                  -- count of issn[]
//     is_core          boolean,
//     is_in_doaj       boolean,
//     works_count      int,
//     cited_by_count   bigint,
//     country_code     text,
//     source_type      text                  -- journal, conference, etc.
//   )
//   CREATE INDEX ON openalex_sources (display_name_norm);
//
// Run on Hetzner:  node scripts/openalex-bulk/ingest-sources.js

import "dotenv/config";
import pg from "pg";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const MANIFEST_URL = "https://openalex.s3.amazonaws.com/data/sources/manifest";
const BATCH = 2000;

function log(...a) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}]`, ...a);
}

function normName(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortSourceId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/(S\d+)$/);
  return m ? m[1] : null;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.openalex_sources (
      source_id          text PRIMARY KEY,
      display_name       text,
      display_name_norm  text NOT NULL,
      issn_l             text,
      issn_count         int,
      is_core            boolean,
      is_in_doaj         boolean,
      works_count        int,
      cited_by_count     bigint,
      country_code       text,
      source_type        text
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS openalex_sources_name_norm_idx ON public.openalex_sources (display_name_norm)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS openalex_sources_issn_l_idx ON public.openalex_sources (issn_l) WHERE issn_l IS NOT NULL`);
}

async function processPartition(entry, pool) {
  const httpUrl = entry.url.replace("s3://openalex/", "https://openalex.s3.amazonaws.com/");
  const resp = await fetch(httpUrl);
  if (!resp.ok) throw new Error(`partition HTTP ${resp.status} for ${entry.url}`);
  const rl = createInterface({
    input: Readable.fromWeb(resp.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let batch = [];
  let seen = 0, inserted = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await pool.query(
      `INSERT INTO openalex_sources (
         source_id, display_name, display_name_norm,
         issn_l, issn_count, is_core, is_in_doaj,
         works_count, cited_by_count, country_code, source_type
       )
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[],
         $4::text[], $5::int[], $6::bool[], $7::bool[],
         $8::int[], $9::bigint[], $10::text[], $11::text[]
       )
       ON CONFLICT (source_id) DO UPDATE SET
         display_name      = EXCLUDED.display_name,
         display_name_norm = EXCLUDED.display_name_norm,
         issn_l            = EXCLUDED.issn_l,
         issn_count        = EXCLUDED.issn_count,
         is_core           = EXCLUDED.is_core,
         is_in_doaj        = EXCLUDED.is_in_doaj,
         works_count       = EXCLUDED.works_count,
         cited_by_count    = EXCLUDED.cited_by_count,
         country_code      = EXCLUDED.country_code,
         source_type       = EXCLUDED.source_type
      `,
      [
        batch.map((r) => r.source_id),
        batch.map((r) => r.display_name),
        batch.map((r) => r.display_name_norm),
        batch.map((r) => r.issn_l),
        batch.map((r) => r.issn_count),
        batch.map((r) => r.is_core),
        batch.map((r) => r.is_in_doaj),
        batch.map((r) => r.works_count),
        batch.map((r) => r.cited_by_count),
        batch.map((r) => r.country_code),
        batch.map((r) => r.source_type),
      ]
    );
    inserted += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line) continue;
    seen += 1;
    let s;
    try { s = JSON.parse(line); } catch { continue; }
    const source_id = shortSourceId(s.id);
    if (!source_id) continue;
    const display_name = s.display_name || null;
    batch.push({
      source_id,
      display_name,
      display_name_norm: normName(display_name),
      issn_l: s.issn_l || null,
      issn_count: Array.isArray(s.issn) ? s.issn.length : 0,
      is_core: s.is_core ?? null,
      is_in_doaj: s.is_in_doaj ?? null,
      works_count: s.works_count ?? 0,
      cited_by_count: s.cited_by_count ?? 0,
      country_code: s.country_code || null,
      source_type: s.type || null,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  log(`  ${entry.url.split("/").slice(-2).join("/")}: seen=${seen} upserted=${inserted}`);
  return { seen, inserted };
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(2); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  log("ensuring schema…");
  await ensureSchema(pool);

  log("fetching manifest…");
  const resp = await fetch(MANIFEST_URL);
  const m = await resp.json();
  log(`partitions: ${m.entries.length}, total records: ${m.entries.reduce((s, e) => s + e.meta.record_count, 0).toLocaleString()}`);

  let totalSeen = 0, totalUpserted = 0;
  for (const entry of m.entries) {
    const r = await processPartition(entry, pool);
    totalSeen += r.seen; totalUpserted += r.inserted;
  }
  log(`DONE seen=${totalSeen.toLocaleString()} upserted=${totalUpserted.toLocaleString()}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
