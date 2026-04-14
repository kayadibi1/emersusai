#!/usr/bin/env node
// scripts/backfill-chunks.js
// Runs the chunk-articles-gc handler directly against Postgres, bypassing
// pg-boss for tight bulk-backfill pacing. Uses the same tagged-template
// `sql` adapter over pg.Pool that worker/index.js uses, so the handler
// sees the identical interface.
//
// Usage:
//   node scripts/backfill-chunks.js --source=sportrxiv --loop
//   node scripts/backfill-chunks.js --loop          # full cross-source backfill
//   node scripts/backfill-chunks.js --dry-run
//   node scripts/backfill-chunks.js --limit=500 --loop

import "dotenv/config";
import pg from "pg";
import PgBoss from "pg-boss";
import { chunkArticlesGcHandler } from "../jobs/chunk-articles-gc.js";

function parseFlags(argv) {
  const flags = { source: null, limit: 1000, loop: false, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--loop") flags.loop = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--source=")) flags.source = arg.split("=")[1];
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.split("=")[1]);
    else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return flags;
}

const flags = parseFlags(process.argv);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const sql = (strings, ...vals) => {
  let text = strings[0];
  for (let i = 0; i < vals.length; i++) text += `$${i + 1}` + strings[i + 1];
  return pool.query(text, vals);
};

if (flags.dryRun) {
  const params = [];
  let sourceClause = "";
  if (flags.source) {
    params.push(flags.source);
    sourceClause = `AND ra.source = $${params.length}`;
  }
  const countQuery = `
    SELECT count(*)::bigint AS n
    FROM research_articles ra
    WHERE ra.abstract IS NOT NULL
      AND length(ra.abstract) >= 50
      ${sourceClause}
      AND NOT EXISTS (SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid)
  `;
  const result = await pool.query(countQuery, params);
  console.log(`[dry-run] would process: ${result.rows[0].n} rows (source=${flags.source ?? "all"})`);
  await pool.end();
  process.exit(0);
}

// Boss needed so the handler can enqueue embed-batch jobs.
const boss = new PgBoss({ connectionString: databaseUrl });
await boss.start();

let totalRows = 0;
let totalChunks = 0;
let tick = 0;
const start = Date.now();

try {
  while (true) {
    tick += 1;
    const ctx = { id: `backfill-tick-${tick}`, data: { limit: flags.limit, source: flags.source } };
    const deps = { sql, boss, log: console };
    const result = await chunkArticlesGcHandler(ctx, deps);
    totalRows += result.rowsProcessed;
    totalChunks += result.chunksInserted;
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[tick ${tick}] rows=${result.rowsProcessed} chunks=${result.chunksInserted} ` +
      `total_rows=${totalRows} total_chunks=${totalChunks} elapsed=${elapsedSec}s`
    );
    if (!flags.loop || result.rowsProcessed === 0) break;
  }
  console.log(`done: ${totalRows} rows processed, ${totalChunks} chunks inserted, ${tick} ticks`);
} finally {
  await boss.stop({ graceful: false });
  await pool.end();
}

process.exit(0);
