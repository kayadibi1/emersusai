// jobs/ingest-topic.js
// Topic-level fanout job. Given a topicId, dispatches one
// ingest-topic-from-source job per ingestion source (or a subset if
// data.sourceIds is specified).
//
// Uses singletonKey + singletonHours so duplicate in-flight jobs for
// the same topic+source are de-duped within a 24h window.

import { listIngestionSources } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";

export async function ingestTopicHandler(ctx, deps) {
  const { topicId, sourceIds: requestedSourceIds } = ctx.data;
  const { sql, boss } = deps;

  // Load the topic row
  const result = await sql`
    SELECT * FROM research_topics WHERE id = ${topicId}
  `;
  const topic = result.rows[0];
  if (!topic) {
    throw new SourcePermanentError(`research_topics row not found: id=${topicId}`);
  }

  const sourceIds = requestedSourceIds ?? listIngestionSources().map(s => s.id);
  await ctx.progress(`dispatching ${sourceIds.length} source jobs for topic ${topicId}`);

  for (const sourceId of sourceIds) {
    await boss.send(
      "ingest-topic-from-source",
      { topicId, sourceId, target: topic.target_paper_count },
      {
        singletonKey: `ingest-${topicId}-${sourceId}`,
        singletonHours: 24,
      }
    );
  }

  await ctx.progress(`fanned out to ${sourceIds.length} sources for topic ${topic.topic_key}`);
  return { topicId, sourceCount: sourceIds.length };
}
