// jobs/ingest-preprints-sweep.js
// Single-pass preprint ingestion. biorxiv + medrxiv share api.biorxiv.org,
// have no keyword search, and return the same ~3-5k preprints/month
// regardless of query. Per-topic fanout was making 287 jobs hit identical
// date-range URLs — overloading the endpoint with HTML error responses
// (root cause of the 2026-04-21 failure cluster). This handler walks the
// date range ONCE for both sources and inserts via DOI dedup. All topics
// share the same preprint corpus; relevance is handled by pgvector +
// rerank at retrieval time.
//
// Payload: { sources?: string[], daysBack?: number, query?: string }
//   sources  — defaults to ["biorxiv", "medrxiv"]
//   daysBack — defaults to 60 (covers 2× the weekly schedule for safety)
//   query    — broad exercise-science union (overridable for one-off
//              full-history backfills)

import { getIngestionSource } from "../scripts/sources/_registry.js";
import { buildGenericChunks } from "../scripts/lib/build-evidence-chunks-generic.js";

const DEFAULT_SOURCES = ["biorxiv", "medrxiv"];
const DEFAULT_DAYS_BACK = 60;

// Broad exercise/sports-science term union. biorxiv/medrxiv return all
// of biology + medicine, so we filter client-side to the topical subset.
// Any preprint touching at least one of these survives.
const EXERCISE_UNION_QUERY = [
  "exercise", "training", "athlete", "athletic",
  "muscle", "hypertrophy", "resistance",
  "endurance", "aerobic", "anaerobic", "cardiorespiratory",
  "strength", "power", "fitness",
  "sport", "performance",
  "nutrition", "protein", "supplement", "creatine",
  "fatigue", "recovery", "rehabilitation", "injury",
  "biomechanics", "physiology", "metabolism",
].join(" OR ");

// Always re-fetch this many days past the watermark to catch backdated
// submissions that arrived after our last pass.
const WATERMARK_OVERLAP_DAYS = 3;
// Floor on daysBack derived from watermark — never less than this even
// if the watermark was updated yesterday. Covers a missed week.
const WATERMARK_MIN_DAYS = 14;

export async function ingestPreprintsSweepHandler(ctx, deps) {
  const {
    sources = DEFAULT_SOURCES,
    daysBack: explicitDaysBack,
    query = EXERCISE_UNION_QUERY,
  } = ctx.data ?? {};
  const { sql, boss, log } = deps;

  const insertedChunkRows = [];
  const perSource = {};

  for (const sourceId of sources) {
    const plugin = getIngestionSource(sourceId);
    if (!plugin) {
      log.warn?.(`preprints-sweep: unknown source ${sourceId}, skipping`);
      perSource[sourceId] = { error: "unknown source" };
      continue;
    }

    // Compute the effective daysBack from the per-source watermark.
    // Explicit data.daysBack (e.g., one-shot full-history backfill) wins.
    // Otherwise: days since max(publication_date) + overlap, floored at
    // WATERMARK_MIN_DAYS, fallback to DEFAULT_DAYS_BACK if no watermark.
    let effectiveDaysBack;
    if (explicitDaysBack != null) {
      effectiveDaysBack = explicitDaysBack;
    } else {
      const wmRes = await sql`
        SELECT max(publication_date) AS hwm
        FROM research_articles
        WHERE source = ${sourceId}
      `;
      const hwm = wmRes.rows[0]?.hwm;
      if (hwm) {
        const daysSince = Math.ceil(
          (Date.now() - new Date(hwm).getTime()) / 86_400_000
        );
        effectiveDaysBack = Math.max(daysSince + WATERMARK_OVERLAP_DAYS, WATERMARK_MIN_DAYS);
      } else {
        effectiveDaysBack = DEFAULT_DAYS_BACK;
      }
      log.info?.(`preprints-sweep: ${sourceId} watermark=${hwm} → daysBack=${effectiveDaysBack}`);
    }

    let inserted = 0;
    let skipped = 0;
    let errored = false;

    try {
      for await (const paper of plugin.fetchPapers(query, {
        target: Infinity,
        daysBack: effectiveDaysBack,
        signal: ctx.signal,
        progress: ctx.progress,
      })) {
        if (ctx.signal.aborted) break;

        const seqResult = await sql`
          SELECT nextval('research_articles_synthetic_pmid_seq')::bigint AS id
        `;
        const pmidVal = Number(seqResult.rows[0].id);

        const pubDate = paper.publishedAt instanceof Date
          ? paper.publishedAt.toISOString().slice(0, 10)
          : (paper.publishedAt ?? null);
        const pubYear = paper.publishedAt instanceof Date
          ? paper.publishedAt.getFullYear()
          : null;
        const authorsJson = JSON.stringify(paper.authors ?? []);
        const metadataJson = JSON.stringify(paper.sourceMetadata ?? {});

        const insertResult = await sql`
          INSERT INTO research_articles (
            pmid, source, external_id, title, abstract, doi,
            publication_date, publication_year, journal, authors,
            peer_reviewed, source_metadata
          ) VALUES (
            ${pmidVal},
            ${paper.source ?? plugin.id},
            ${paper.externalId},
            ${paper.title},
            ${paper.abstract ?? null},
            ${paper.doi ?? null},
            ${pubDate},
            ${pubYear},
            ${paper.journal ?? null},
            ${authorsJson}::jsonb,
            ${paper.peerReviewed ?? plugin.peerReviewed ?? false},
            ${metadataJson}::jsonb
          )
          ON CONFLICT DO NOTHING
          RETURNING pmid
        `;

        if (insertResult.rows.length > 0) {
          inserted += 1;
          insertedChunkRows.push({
            pmid: pmidVal,
            title: paper.title,
            abstract: paper.abstract ?? null,
            source: paper.source ?? plugin.id,
            external_id: paper.externalId,
            doi: paper.doi ?? null,
          });
        } else {
          skipped += 1;
        }

        if ((inserted + skipped) % 100 === 0) {
          await ctx.progress(`${sourceId}: inserted=${inserted} skipped=${skipped}`);
        }
      }
    } catch (err) {
      errored = true;
      log.error?.(`preprints-sweep: ${sourceId} failed`, { err: err.message });
    }

    perSource[sourceId] = { inserted, skipped, errored };
    await ctx.progress(`${sourceId} done: inserted=${inserted} skipped=${skipped}`);
  }

  // Build + insert evidence_chunks for fresh rows (mirrors the per-topic
  // handler's chunk emission). Chunk failures are non-fatal —
  // chunk-articles-gc sweeps misses nightly.
  if (insertedChunkRows.length > 0) {
    const allChunks = [];
    for (const row of insertedChunkRows) {
      try {
        for (const c of buildGenericChunks(row)) allChunks.push(c);
      } catch (err) {
        log.warn?.({ pmid: row.pmid, err: err.message }, "chunk build failed in sweep");
      }
    }
    if (allChunks.length > 0) {
      try {
        const pmids = allChunks.map((c) => c.pmid);
        const types = allChunks.map((c) => c.chunk_type);
        const contents = allChunks.map((c) => c.content);
        const metas = allChunks.map((c) => JSON.stringify(c.metadata));
        await sql`
          INSERT INTO evidence_chunks (pmid, chunk_type, content, metadata)
          SELECT unnest(${pmids}::bigint[]),
                 unnest(${types}::text[]),
                 unnest(${contents}::text[]),
                 unnest(${metas}::jsonb[])
        `;
      } catch (err) {
        log.warn?.({ err: err.message }, "chunk insert in sweep failed; GC will retry");
      }
    }
  }

  // Kick the embed pipeline so the new chunks get vectors quickly
  await boss.send("embed-batch", { limit: 1000 });

  log.info?.("preprints-sweep done", { perSource, totalInserted: insertedChunkRows.length });
  return { perSource, totalInserted: insertedChunkRows.length };
}
