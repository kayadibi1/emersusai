// jobs/ingest-topic.js
// Topic-level fanout job. Given a topicId, dispatches one
// ingest-topic-from-source job per ingestion source (or a subset if
// data.sourceIds is specified).
//
// Uses singletonKey + singletonHours so duplicate in-flight jobs for
// the same topic+source are de-duped within a 24h window.

import { listIngestionSources } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";

// Phase 2 originally restricted ingestion to pubmed because
// research_articles.pmid was NOT NULL PK. That's now handled by the
// synthetic pmid sequence (see
// supabase/20260412_research_articles_synthetic_pmid_sequence.sql and
// jobs/ingest-topic-from-source.js). The filter below is now a feature
// flag guarding the multi-source rollout for revertibility.
//
// MULTI_SOURCE_ENABLED=true enables fanout to every registered source
// the caller requests, except deprioritized sources (crossref, doaj —
// metadata-only, no abstracts to chunk) and sources disabled via the
// INGEST_DISABLED_SOURCES env var.
const LEGACY_SUPPORTED_SOURCE_IDS = ["pubmed"];
const DEPRIORITIZED_SOURCE_IDS = ["crossref", "doaj"];

function readEnvList(name) {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

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

  const multiSourceEnabled = process.env.MULTI_SOURCE_ENABLED === "true";
  const disabledSources = readEnvList("INGEST_DISABLED_SOURCES");
  const available = listIngestionSources().map((s) => s.id);
  const requested = requestedSourceIds ?? available;

  const isCandidate = (id) =>
    available.includes(id) &&
    !DEPRIORITIZED_SOURCE_IDS.includes(id) &&
    !disabledSources.includes(id);

  const sourceIds = multiSourceEnabled
    ? requested.filter(isCandidate)
    : requested.filter((id) => LEGACY_SUPPORTED_SOURCE_IDS.includes(id) && isCandidate(id));

  if (sourceIds.length === 0) {
    const reason = multiSourceEnabled
      ? `no candidate sources to dispatch (requested=${requested.join(",")}, disabled=${disabledSources.join(",")}, deprioritized=${DEPRIORITIZED_SOURCE_IDS.join(",")})`
      : `no supported sources to dispatch (MULTI_SOURCE_ENABLED=false, legacy supports: ${LEGACY_SUPPORTED_SOURCE_IDS.join(", ")})`;
    await ctx.progress(reason, "warn");
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
