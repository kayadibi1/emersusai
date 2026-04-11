// jobs/ingest-topic-from-source.js
// The ingestion workhorse. Pulls papers from a single source plugin for
// a single topic and inserts them into research_articles.
//
// Payload: { topicId, sourceId, target }
// Returns: { inserted, skipped }

import { getIngestionSource } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";

const PROGRESS_INTERVAL = 50; // emit progress every N papers

export async function ingestTopicFromSourceHandler(ctx, deps) {
  const { topicId, sourceId, target } = ctx.data;
  const { sql, boss } = deps;

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
    // For pubmed sources, pmid is the externalId cast to integer (if numeric).
    const pmidVal = (plugin.id === "pubmed" || paper.source === "pubmed")
      ? (Number.isFinite(Number(paper.externalId)) ? Number(paper.externalId) : null)
      : null;

    // Phase 2 constraint: pmid is the PK of research_articles, so only
    // pubmed-sourced rows can be inserted. Other sources are filtered
    // out in ingest-topic.js but guard here too.
    if (pmidVal == null) {
      skippedCount++;
      continue;
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
      ON CONFLICT (pmid) DO NOTHING
      RETURNING pmid
    `;

    if (insertResult.rows.length > 0) {
      insertedCount++;
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

  // Enqueue follow-up embed-batch job
  await boss.send("embed-batch", { limit: 1000 });

  await ctx.progress(`done: inserted=${insertedCount} skipped=${skippedCount}`);
  return { inserted: insertedCount, skipped: skippedCount };
}
