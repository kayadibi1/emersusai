// jobs/ingest-topic.js
// Topic-level fanout job. Given a topicId, dispatches one
// ingest-topic-from-source job per ingestion source (or a subset if
// data.sourceIds is specified).
//
// Uses singletonKey + singletonHours so duplicate in-flight jobs for
// the same topic+source are de-duped within a 24h window.

import { listIngestionSources } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";

// Phase 2 constraint: research_articles has `pmid bigint NOT NULL PK`.
// Non-pubmed sources (biorxiv, medrxiv, etc.) have no pmid, so they
// can't be inserted until the schema is reworked (drop pmid PK, add
// surrogate id, make pmid UNIQUE-nullable). Until then, restrict the
// fanout to pubmed-only. Multi-source ingestion is tracked as a
// follow-up.
const SUPPORTED_SOURCE_IDS = ["pubmed"];

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

  // Intersect the requested sources with the phase 2 supported set.
  // If the caller didn't specify, use the supported set directly.
  const available = listIngestionSources().map(s => s.id);
  const requested = requestedSourceIds ?? available;
  const sourceIds = requested.filter(id =>
    SUPPORTED_SOURCE_IDS.includes(id) && available.includes(id)
  );

  if (sourceIds.length === 0) {
    await ctx.progress(`no supported sources to dispatch (phase 2 supports: ${SUPPORTED_SOURCE_IDS.join(", ")})`, "warn");
    return { topicId, sourceCount: 0 };
  }
  await ctx.progress(`dispatching ${sourceIds.length} source jobs for topic ${topicId}`);

  for (const sourceId of sourceIds) {
    await boss.send(
      "ingest-topic-from-source",
      { topicId, sourceId, target: topic.target_paper_count },
      {
        singletonKey: `ingest-${topicId}-${sourceId}`,
        singletonHours: 24,
        // Phase 2 hardening: NCBI periodically TCP-drops under sustained
        // load. pg-boss's default retryLimit: 2 burned through retries
        // during the 2026-04-11 deploy and left 14 topics permanently
        // failed. Bump retries + enable exponential backoff so transient
        // upstream failures recover without hand-requeuing.
        retryLimit: 5,
        retryBackoff: true,
        retryDelay: 15,
      }
    );
  }

  await ctx.progress(`fanned out to ${sourceIds.length} sources for topic ${topic.topic_key}`);
  return { topicId, sourceCount: sourceIds.length };
}
