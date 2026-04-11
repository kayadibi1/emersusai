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

    const insertResult = await sql`
      INSERT INTO research_articles (
        source,
        external_id,
        title,
        abstract,
        doi,
        published_at,
        journal,
        authors,
        peer_reviewed,
        source_metadata,
        pmid
      ) VALUES (
        ${paper.source ?? plugin.id},
        ${paper.externalId},
        ${paper.title},
        ${paper.abstract ?? null},
        ${paper.doi ?? null},
        ${paper.publishedAt ?? null},
        ${paper.journal ?? null},
        ${paper.authors ?? []},
        ${paper.peerReviewed ?? plugin.peerReviewed ?? true},
        ${paper.sourceMetadata ?? {}},
        ${pmidVal}
      )
      ON CONFLICT (source, external_id) DO NOTHING
      RETURNING id
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
