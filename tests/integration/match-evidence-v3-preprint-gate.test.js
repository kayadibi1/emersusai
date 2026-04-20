// tests/integration/match-evidence-v3-preprint-gate.test.js
//
// Locks the Phase-3 preprint gate: when p_include_preprints=false,
// match_evidence_chunks_v3 must exclude peer_reviewed=false rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(
  __dirname,
  "../../supabase/20260421_match_evidence_chunks_v3.sql"
);

async function setup(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS public.evidence_chunks (
      id bigserial PRIMARY KEY,
      pmid bigint,
      chunk_type text,
      content text,
      embedding vector(1536)
    );
    CREATE TABLE IF NOT EXISTS public.research_articles (
      pmid bigint PRIMARY KEY,
      doi text,
      peer_reviewed boolean NOT NULL DEFAULT true,
      is_retracted boolean NOT NULL DEFAULT false,
      is_deleted boolean NOT NULL DEFAULT false
    );
  `);
  await client.query(readFileSync(MIGRATION, "utf8"));
}

// Build a unit vector so similarity math is predictable: the query is
// identical to the chunk's vector → similarity = 1.
function unitVec(dim = 1536) {
  const arr = new Array(dim).fill(0);
  arr[0] = 1;
  return `[${arr.join(",")}]`;
}

test("p_include_preprints=false hides peer_reviewed=false chunks", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const vec = unitVec();

    // Two articles: one peer-reviewed, one preprint.
    await client.query(
      `INSERT INTO public.research_articles (pmid, doi, peer_reviewed) VALUES
         (100, '10.1/peer', true),
         (200, '10.2/preprint', false)`
    );
    await client.query(
      `INSERT INTO public.evidence_chunks (pmid, chunk_type, content, embedding) VALUES
         (100, 'abstract', 'peer content', $1::vector),
         (200, 'abstract', 'preprint content', $1::vector)`,
      [vec]
    );

    // With preprints on: should see both
    const all = await client.query(
      `SELECT pmid FROM public.match_evidence_chunks_v3($1::vector, 0.5, 10, true) ORDER BY pmid`,
      [vec]
    );
    assert.deepEqual(
      all.rows.map((r) => Number(r.pmid)),
      [100, 200]
    );

    // With preprints off: should see only the peer-reviewed one
    const peerOnly = await client.query(
      `SELECT pmid FROM public.match_evidence_chunks_v3($1::vector, 0.5, 10, false) ORDER BY pmid`,
      [vec]
    );
    assert.deepEqual(
      peerOnly.rows.map((r) => Number(r.pmid)),
      [100]
    );
  });
});

test("default p_include_preprints=true includes preprints", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const vec = unitVec();
    await client.query(
      `INSERT INTO public.research_articles (pmid, doi, peer_reviewed) VALUES
         (300, '10.3/prep', false)`
    );
    await client.query(
      `INSERT INTO public.evidence_chunks (pmid, chunk_type, content, embedding) VALUES
         (300, 'abstract', 'preprint only', $1::vector)`,
      [vec]
    );
    // Call without the 4th arg → uses DEFAULT true
    const res = await client.query(
      `SELECT pmid FROM public.match_evidence_chunks_v3($1::vector, 0.5, 10)`,
      [vec]
    );
    assert.equal(res.rows.length, 1);
    assert.equal(Number(res.rows[0].pmid), 300);
  });
});
