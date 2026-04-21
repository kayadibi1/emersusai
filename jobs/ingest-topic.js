// jobs/ingest-topic.js
// Topic-level fanout job. Given a topicId, dispatches one
// ingest-topic-from-source job per ingestion source (or a subset if
// data.sourceIds is specified).
//
// Uses singletonKey + singletonHours so duplicate in-flight jobs for
// the same topic+source are de-duped within a 24h window. Callers can
// bypass the 24h window for a single run by passing `keySuffix` in
// ctx.data — the suffix is appended to both the parent and child
// singletonKeys so a fresh manual run doesn't collide with the most
// recent scheduled run. See docs/ops/topic-pipeline-runbook.md and
// `reference_manual_topic_fill.md` in the auto-memory for the
// canonical manual-fill command.

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
// the caller requests, minus sources handled by other jobs (preprint
// sweep) and sources disabled via the INGEST_DISABLED_SOURCES env var.
const LEGACY_SUPPORTED_SOURCE_IDS = ["pubmed"];
// biorxiv + medrxiv + psyarxiv share PHP-backed / paginated APIs with
// no real keyword search. Per-topic fanout duplicated the same
// date-range/page requests 300× and triggered a thundering-herd of
// HTML error responses (2026-04-21). They're now ingested by the
// dedicated `ingest-preprints-sweep` job which walks each source once.
// See jobs/ingest-preprints-sweep.js.
const PREPRINT_SWEEP_SOURCE_IDS = ["biorxiv", "medrxiv", "psyarxiv"];

function readEnvList(name) {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build a child singletonKey that's optionally namespaced by a per-run
 * suffix. Without a suffix, behavior is identical to the legacy form
 * (`ingest-${topicId}-${sourceId}`) so scheduled runs keep dedup'ing
 * themselves within their 24h window. With a suffix, the key becomes
 * `ingest-${topicId}-${sourceId}-${suffix}` which is disjoint from
 * the unsuffixed slot — a manual force-rerun can proceed without
 * stomping on the live-schedule lockout.
 *
 * Exported for unit-test access.
 */
export function buildChildSingletonKey(topicId, sourceId, keySuffix) {
  const base = `ingest-${topicId}-${sourceId}`;
  return keySuffix ? `${base}-${keySuffix}` : base;
}

export async function ingestTopicHandler(ctx, deps) {
  const { topicId, sourceIds: requestedSourceIds, keySuffix = "" } = ctx.data;
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
    !PREPRINT_SWEEP_SOURCE_IDS.includes(id) &&
    !disabledSources.includes(id);

  const sourceIds = multiSourceEnabled
    ? requested.filter(isCandidate)
    : requested.filter((id) => LEGACY_SUPPORTED_SOURCE_IDS.includes(id) && isCandidate(id));

  if (sourceIds.length === 0) {
    const reason = multiSourceEnabled
      ? `no candidate sources to dispatch (requested=${requested.join(",")}, disabled=${disabledSources.join(",")}, sweep-only=${PREPRINT_SWEEP_SOURCE_IDS.join(",")})`
      : `no supported sources to dispatch (MULTI_SOURCE_ENABLED=false, legacy supports: ${LEGACY_SUPPORTED_SOURCE_IDS.join(", ")})`;
    await ctx.progress(reason, "warn");
    return { topicId, sourceCount: 0 };
  }
  await ctx.progress(`dispatching ${sourceIds.length} source jobs for topic ${topicId}`);

  for (const sourceId of sourceIds) {
    await boss.send(
      "ingest-topic-from-source",
      // Forward keySuffix so nested re-dispatches (none today, but
      // future proofing) can carry the same namespace.
      { topicId, sourceId, target: topic.target_paper_count, keySuffix },
      {
        singletonKey: buildChildSingletonKey(topicId, sourceId, keySuffix),
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
