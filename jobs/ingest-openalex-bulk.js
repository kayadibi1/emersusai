// jobs/ingest-openalex-bulk.js
// Bulk ingest the OpenAlex snapshot matches produced by
// `scripts/openalex-bulk/filter.js`. Reads a gzipped JSONL file from
// ~/data/openalex-bulk/<filename>, inserts into research_articles,
// builds chunks, enqueues embed-batch. See docs/openalex-bulk-plan.md.
//
// Payload: { filename }
// Returns: { inserted, skipped, chunkRows }

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { SourcePermanentError } from "../scripts/sources/_errors.js";
import { buildGenericChunks } from "../scripts/lib/build-evidence-chunks-generic.js";

const BATCH_SIZE = 500;
const UPLOAD_DIR = process.env.OPENALEX_BULK_DIR ?? "/home/emersus/data/openalex-bulk";

// OpenAlex `work.type` → research_articles row mapping.
//   - KEEP    types become `is_deleted=false` with the labeled publication_types[]
//   - DROP    types are inserted soft-deleted so retrieval ignores them but the
//             row still exists for dedup against future ingests
// Decisions (2026-04-22 audit, see docs/openalex-bulk-plan.md "Actuals"):
//   - book/book-chapter: too variable in quality to vet at scale
//   - dissertation:      gray literature, LLM may cite hypotheses as established findings
//   - letter/editorial:  opinion/commentary, not primary evidence
//   - other:             OpenAlex junk drawer (~95% non-research artifacts)
//   - peer-review:       review reports themselves, not the paper
//   - dataset/libguides/paratext/supplementary-materials/erratum/standard/retraction:
//                        not citable evidence
const OA_TYPE_KEEP = new Map([
  ["article",  "Journal Article"],
  ["review",   "Review"],
  ["preprint", "Preprint"],
]);
const OA_TYPE_DROP = new Set([
  "dataset", "libguides", "peer-review", "erratum", "paratext",
  "supplementary-materials", "other", "dissertation", "book",
  "book-chapter", "letter", "editorial", "report", "reference-entry",
  "standard", "retraction",
]);

export async function ingestOpenalexBulkHandler(ctx, deps) {
  const { filename } = ctx.data;
  if (!filename || typeof filename !== "string" || filename.includes("/") || filename.includes("..")) {
    throw new SourcePermanentError(`invalid filename: ${filename}`);
  }
  const { sql, boss, log } = deps;
  const path = resolve(UPLOAD_DIR, filename);

  let inserted = 0;
  let skipped = 0;
  let totalChunks = 0;
  let batch = [];

  const rl = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const flushBatch = async () => {
    if (batch.length === 0) return;
    if (ctx.signal?.aborted) return;

    // Pre-allocate N synthetic pmids in one DB round-trip.
    const seqRes = await sql`
      SELECT nextval('research_articles_synthetic_pmid_seq')::bigint AS pmid
      FROM generate_series(1, ${batch.length})
    `;
    const pmids = seqRes.rows.map((r) => Number(r.pmid));

    const sources = new Array(batch.length).fill("openalex");
    const externalIds = batch.map((r) => r.external_id);
    const titles = batch.map((r) => r.title);
    const abstracts = batch.map((r) => r.abstract ?? null);
    const dois = batch.map((r) => r.doi ?? null);
    const pubDates = batch.map((r) => r.publication_date ?? null);
    const pubYears = batch.map((r) => r.publication_year ?? null);
    const journals = batch.map((r) => r.journal ?? null);
    const authorsJson = batch.map((r) => JSON.stringify(r.authors ?? []));

    // OpenAlex type → label + filter. Reviews are peer-reviewed by convention;
    // articles are too. Preprints flow through but are tier-gated at retrieval
    // (Free=peer-reviewed only; Pro=preprints+peer-reviewed). Drop types are
    // inserted is_deleted=true so retrieval skips them but they still occupy
    // a (source, external_id) row for future-run dedup.
    const peerRev = batch.map((r) => {
      const t = r.source_metadata?.type;
      return t === "article" || t === "review";
    });
    const pubTypes = batch.map((r) => {
      const label = OA_TYPE_KEEP.get(r.source_metadata?.type);
      return label ? [label] : [];
    });
    const isDeleted = batch.map((r) => OA_TYPE_DROP.has(r.source_metadata?.type));
    const metaJson = batch.map((r) => JSON.stringify(r.source_metadata ?? {}));

    // ON CONFLICT DO NOTHING: untargeted so both pmid PK and
    // (source, external_id) UNIQUE constraints are caught silently.
    // RETURNING pmid, external_id lets us map inserted rows back to the
    // input batch so we only chunk what we actually inserted.
    const ins = await sql`
      INSERT INTO research_articles (
        pmid, source, external_id, title, abstract, doi,
        publication_date, publication_year, journal, authors,
        peer_reviewed, publication_types, is_deleted, source_metadata
      )
      SELECT * FROM unnest(
        ${pmids}::bigint[],
        ${sources}::text[],
        ${externalIds}::text[],
        ${titles}::text[],
        ${abstracts}::text[],
        ${dois}::text[],
        ${pubDates}::date[],
        ${pubYears}::int[],
        ${journals}::text[],
        ${authorsJson}::jsonb[],
        ${peerRev}::bool[],
        ${pubTypes}::text[][],
        ${isDeleted}::bool[],
        ${metaJson}::jsonb[]
      )
      ON CONFLICT DO NOTHING
      RETURNING pmid, external_id
    `;

    const insertedByExtId = new Map();
    for (const row of ins.rows) insertedByExtId.set(row.external_id, Number(row.pmid));

    inserted += ins.rows.length;
    skipped += batch.length - ins.rows.length;

    // Chunk only inserted rows that aren't soft-deleted — no point embedding
    // 200k+ junk-type chunks that retrieval would never return.
    const allChunks = [];
    for (const r of batch) {
      const pmid = insertedByExtId.get(r.external_id);
      if (!pmid) continue;
      if (OA_TYPE_DROP.has(r.source_metadata?.type)) continue;
      try {
        for (const c of buildGenericChunks({
          pmid, title: r.title, abstract: r.abstract,
          source: "openalex", external_id: r.external_id, doi: r.doi,
        })) allChunks.push(c);
      } catch (err) {
        log?.warn?.({ pmid, err: err.message }, "chunk build failed");
      }
    }

    if (allChunks.length > 0) {
      try {
        await sql`
          INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata)
          SELECT unnest(${allChunks.map((c) => c.pmid)}::bigint[]),
                 unnest(${allChunks.map((c) => c.chunk_type)}::text[]),
                 unnest(${allChunks.map((c) => c.content)}::text[]),
                 unnest(${allChunks.map((c) => JSON.stringify(c.metadata))}::jsonb[])
        `;
        totalChunks += allChunks.length;
      } catch (err) {
        log?.warn?.({ err: err.message }, "chunk insert failed; chunk-articles-gc will retry");
      }
    }

    batch = [];
    await ctx.progress(`inserted=${inserted} skipped=${skipped} chunks=${totalChunks}`);
  };

  for await (const line of rl) {
    if (!line) continue;
    if (ctx.signal?.aborted) break;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec.external_id || !rec.title) continue;
    batch.push(rec);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  // Kick the embedder. It's rate-limited to 1 worker so we enqueue a
  // single signal — it'll drain all the new empty-embedding rows.
  await boss.send("embed-batch", { limit: 1000 });

  await ctx.progress(`done: inserted=${inserted} skipped=${skipped} chunks=${totalChunks}`);
  return { inserted, skipped, chunkRows: totalChunks };
}
