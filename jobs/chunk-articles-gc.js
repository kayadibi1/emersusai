// jobs/chunk-articles-gc.js
// GC + backfill handler. Selects research_articles rows that have an
// abstract but no evidence_chunks, builds chunks via buildGenericChunks,
// batch-inserts them, and enqueues embed-batch if anything was written.
//
// Payload: { limit?: 1000, source?: string }
// Returns: { rowsProcessed, chunksInserted, rowFailures }

import {
  buildGenericChunks,
  MIN_ABSTRACT_CHARS,
} from "../scripts/lib/build-evidence-chunks-generic.js";

const DEFAULT_LIMIT = 1000;
const INSERT_BATCH_SIZE = 500;

export async function chunkArticlesGcHandler(ctx, deps) {
  const { limit = DEFAULT_LIMIT, source = null } = ctx.data ?? {};
  const { sql, boss, log } = deps;

  const candidateResult = source
    ? await sql`
        SELECT pmid, title, abstract, source, external_id, doi
        FROM research_articles ra
        WHERE ra.abstract IS NOT NULL
          AND length(ra.abstract) >= ${MIN_ABSTRACT_CHARS}
          AND ra.source = ${source}
          AND NOT EXISTS (
            SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid
          )
        ORDER BY ra.pmid
        LIMIT ${limit}
      `
    : await sql`
        SELECT pmid, title, abstract, source, external_id, doi
        FROM research_articles ra
        WHERE ra.abstract IS NOT NULL
          AND length(ra.abstract) >= ${MIN_ABSTRACT_CHARS}
          AND NOT EXISTS (
            SELECT 1 FROM evidence_chunks ec WHERE ec.pmid = ra.pmid
          )
        ORDER BY ra.pmid
        LIMIT ${limit}
      `;

  const rows = candidateResult.rows ?? [];
  if (rows.length === 0) {
    return { rowsProcessed: 0, chunksInserted: 0, rowFailures: 0 };
  }

  const allChunks = [];
  let rowFailures = 0;
  for (const row of rows) {
    try {
      const chunks = buildGenericChunks({
        pmid: Number(row.pmid),
        title: row.title,
        abstract: row.abstract,
        source: row.source,
        external_id: row.external_id,
        doi: row.doi,
      });
      for (const c of chunks) allChunks.push(c);
    } catch (err) {
      rowFailures += 1;
      log?.warn?.({ pmid: row.pmid, err: err.message }, "chunk build failed");
    }
  }

  if (allChunks.length === 0) {
    return { rowsProcessed: rows.length, chunksInserted: 0, rowFailures };
  }

  let chunksInserted = 0;
  for (let i = 0; i < allChunks.length; i += INSERT_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + INSERT_BATCH_SIZE);
    chunksInserted += await insertChunkBatch(sql, batch);
  }

  if (chunksInserted > 0 && boss?.send) {
    await boss.send("embed-batch", { limit: Math.max(2000, chunksInserted) });
  }

  return { rowsProcessed: rows.length, chunksInserted, rowFailures };
}

async function insertChunkBatch(sql, chunks) {
  const pmids = chunks.map((c) => c.pmid);
  const types = chunks.map((c) => c.chunk_type);
  const contents = chunks.map((c) => c.content);
  const metas = chunks.map((c) => JSON.stringify(c.metadata));

  const result = await sql`
    INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata)
    SELECT unnest(${pmids}::bigint[]),
           unnest(${types}::text[]),
           unnest(${contents}::text[]),
           unnest(${metas}::jsonb[])
  `;
  return result.rowCount ?? chunks.length;
}
