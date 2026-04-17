#!/usr/bin/env node
import "dotenv/config";
// scripts/backfill-memory-embeddings.js
//
// Fills fact_embedding on any public.user_memories row that has NULL
// (typically: rows saved before the 2026-04-17 embed-on-write fix in
// api/emersus/pipeline/remember-fact-handler.js).
//
// Idempotent — safe to re-run. Skips rows that already have an embedding.
// Uses the same text-embedding-3-small model + the service-role PostgREST
// pattern used elsewhere in the pipeline.
//
// Usage:
//   OPENAI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backfill-memory-embeddings.js
//
// Optional:
//   DRY_RUN=1  — fetch + embed but don't UPDATE
//   LIMIT=N    — cap the number of rows processed this run (default 100)

import { embedText } from "../api/emersus/embeddings.js";

const supabaseUrl    = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN        = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const LIMIT          = Math.max(1, Math.min(1000, parseInt(process.env.LIMIT || "100", 10)));

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function fetchRowsNeedingEmbedding() {
  const url = `${supabaseUrl}/rest/v1/user_memories?fact_embedding=is.null&select=id,fact,category,tier&limit=${LIMIT}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SELECT failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function patchEmbedding(id, embedding) {
  const url = `${supabaseUrl}/rest/v1/user_memories?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ fact_embedding: embedding }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PATCH ${id} failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

const rows = await fetchRowsNeedingEmbedding();
if (rows.length === 0) {
  console.log("No rows with null fact_embedding. Nothing to do.");
  process.exit(0);
}

console.log(`Found ${rows.length} row(s) needing embedding${DRY_RUN ? " (dry-run)" : ""}:`);
for (const r of rows) {
  console.log(`  ${r.id}  ${r.category.padEnd(22)} tier=${r.tier}  ${String(r.fact).slice(0, 60)}${r.fact.length > 60 ? "…" : ""}`);
}

let done = 0;
let failed = 0;
for (const row of rows) {
  try {
    const vec = await embedText(row.fact);
    if (!DRY_RUN) await patchEmbedding(row.id, vec);
    done++;
    console.log(`  ✓ ${row.id}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${row.id}: ${err?.message || err}`);
  }
}

console.log(`\n${done} embedded${DRY_RUN ? " (dry-run — no writes)" : ""}, ${failed} failed.`);
process.exit(failed ? 1 : 0);
