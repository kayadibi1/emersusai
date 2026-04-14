// jobs/ingest-topic-from-source.js
// The ingestion workhorse. Pulls papers from a single source plugin for
// a single topic and inserts them into research_articles.
//
// Payload: { topicId, sourceId, target }
// Returns: { inserted, skipped }

import { getIngestionSource } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";
import { buildGenericChunks } from "../scripts/lib/build-evidence-chunks-generic.js";

const PROGRESS_INTERVAL = 50; // emit progress every N papers

export async function ingestTopicFromSourceHandler(ctx, deps) {
  const { topicId, sourceId, target } = ctx.data;
  const { sql, boss, log } = deps;
  const insertedChunkRows = [];

  // Load topic row
  const topicResult = await sql`
    SELECT * FROM research_topics WHERE id = ${topicId}
  `;
  const topic = topicResult.rows[0];
  if (!topic) {
    throw new SourcePermanentError(`research_topics row not found: id=${topicId}`);
  }

  // Load source plugin
  const plugin = getIngestionSource(sourceId);
  if (!plugin) {
    throw new SourcePermanentError(`unknown ingestion source: ${sourceId}`);
  }

  let insertedCount = 0;
  let skippedCount = 0;

  for await (const paper of plugin.fetchPapers(topic.query, {
    target: target ?? topic.target_paper_count,
    signal: ctx.signal,
    progress: ctx.progress,
  })) {
    // Check for cancellation
    if (ctx.signal.aborted) break;

    // Map IngestedPaper → research_articles columns
    // Extract the real PubMed ID when the source is pubmed AND the externalId
    // is numeric. Everything else gets a synthetic pmid allocated from the
    // research_articles_synthetic_pmid_seq sequence, which keeps
    // research_articles.pmid NOT NULL PRIMARY KEY happy without requiring a
    // schema migration. See
    // docs/superpowers/specs/2026-04-11-multi-source-enablement-design.md
    const isPubmedSource = plugin.id === "pubmed" || paper.source === "pubmed";
    const realPmid = isPubmedSource && Number.isFinite(Number(paper.externalId))
      ? Number(paper.externalId)
      : null;

    let pmidVal = realPmid;
    if (pmidVal == null) {
      const seqResult = await sql`
        SELECT nextval('research_articles_synthetic_pmid_seq')::bigint AS id
      `;
      pmidVal = Number(seqResult.rows[0].id);
    }

    const pubDate = paper.publishedAt instanceof Date
      ? paper.publishedAt.toISOString().slice(0, 10)
      : (paper.publishedAt ?? null);
    const pubYear = paper.publishedAt instanceof Date
      ? paper.publishedAt.getFullYear()
      : null;
    // authors on research_articles is jsonb (not text[])
    const authorsJson = JSON.stringify(paper.authors ?? []);
    const metadataJson = JSON.stringify(paper.sourceMetadata ?? {});

    // ON CONFLICT DO NOTHING with no target catches unique violations on ANY
    // constraint — both the `pmid` PK and the `(source, external_id)` UNIQUE
    // index added in the original phase-2 rename migration. The earlier
    // targeted form `ON CONFLICT (pmid) DO NOTHING` only caught pmid PK
    // collisions, so a re-ingestion that yielded the same external_id as
    // an existing row would abort the whole handler with a 23505 error
    // and exhaust the pg-boss retry budget.
    const insertResult = await sql`
      INSERT INTO research_articles (
        pmid,
        source,
        external_id,
        title,
        abstract,
        doi,
        publication_date,
        publication_year,
        journal,
        authors,
        peer_reviewed,
        source_metadata
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
        ${paper.peerReviewed ?? plugin.peerReviewed ?? true},
        ${metadataJson}::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING pmid
    `;

    if (insertResult.rows.length > 0) {
      insertedCount++;
      insertedChunkRows.push({
        pmid: pmidVal,
        title: paper.title,
        abstract: paper.abstract ?? null,
        source: paper.source ?? plugin.id,
        external_id: paper.externalId,
        doi: paper.doi ?? null,
      });
    } else {
      skippedCount++;
    }

    if ((insertedCount + skippedCount) % PROGRESS_INTERVAL === 0) {
      await ctx.progress(`${insertedCount}/${target ?? topic.target_paper_count}`);
    }
  }

  // Update topic fill metadata
  await sql`
    UPDATE research_topics
    SET last_filled_at = now(),
        last_fill_count = ${insertedCount},
        updated_at = now()
    WHERE id = ${topicId}
  `;

  // Write evidence_chunks for freshly inserted rows. If this fails, log and
  // continue — the chunk-articles-gc cron will pick up any misses. Ingest
  // must never regress because chunking is flaky. Pubmed rows with JATS
  // sections still go through the legacy chunker in scripts/import-pubmed.js;
  // this source-agnostic path emits title + flat-abstract chunks, matching
  // pubmed's unsectioned branch.
  if (insertedChunkRows.length > 0) {
    const allChunks = [];
    for (const row of insertedChunkRows) {
      try {
        for (const c of buildGenericChunks(row)) allChunks.push(c);
      } catch (err) {
        log?.warn?.({ pmid: row.pmid, err: err.message }, "chunk build failed in ingest");
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
        log?.warn?.({ err: err.message }, "chunk insert in ingest failed; GC will retry");
      }
    }
  }

  // Enqueue follow-up embed-batch job
  await boss.send("embed-batch", { limit: 1000 });

  await ctx.progress(`done: inserted=${insertedCount} skipped=${skippedCount}`);
  return { inserted: insertedCount, skipped: skippedCount };
}
