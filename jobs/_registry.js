// jobs/_registry.js
// Central handler registry. Imports all 13 handlers and registers them
// with pg-boss. Also sets up 4 cron schedules.

import { discoveryWeeklyHandler }        from "./discovery-weekly.js";
import { fetchFeedHandler }              from "./fetch-feed.js";
import { classifyCandidatesHandler }     from "./classify-candidates.js";
import { ingestTopicHandler }            from "./ingest-topic.js";
import { ingestTopicFromSourceHandler }  from "./ingest-topic-from-source.js";
import { embedBatchHandler }             from "./embed-batch.js";
import { s2CitationBackfillHandler }     from "./s2-citation-backfill.js";
import { rcrBackfillHandler }            from "./rcr-backfill.js";
import { validateQueriesHandler }        from "./validate-queries.js";
import { detectFailureClustersHandler }  from "./detect-failure-clusters.js";
import { alertDailyDigestHandler }       from "./alert-daily-digest.js";
import { cleanupJobProgressHandler }     from "./cleanup-job-progress.js";
import { sendAlertHandler }              from "./send-alert.js";

// Side-effect imports: ingestion plugins self-register on import
import "../scripts/sources/pubmed.js";
import "../scripts/sources/europepmc.js";
import "../scripts/sources/biorxiv.js";
import "../scripts/sources/medrxiv.js";
import "../scripts/sources/sportrxiv.js";
import "../scripts/sources/crossref.js";
import "../scripts/sources/doaj.js";
import "../scripts/sources/openalex.js";

// Discovery plugins
import "../scripts/sources/rss-sbs.js";
import "../scripts/sources/rss-suppversity.js";
import "../scripts/sources/rss-mass.js";
import "../scripts/sources/rss-sfs.js";
import "../scripts/sources/rss-nsca.js";
import "../scripts/sources/rss-acsm.js";
import "../scripts/sources/rss-journal-bjsm.js";
import "../scripts/sources/rss-journal-jscr.js";
import "../scripts/sources/rss-journal-msse.js";
import "../scripts/sources/rss-journal-ijspp.js";
import "../scripts/sources/rss-journal-jap.js";
import "../scripts/sources/rss-journal-sportsmed.js";
import "../scripts/sources/rss-journal-sjmss.js";
import "../scripts/sources/rss-journal-ejap.js";

/**
 * Register all handlers with pg-boss and schedule cron jobs.
 * @param {{ boss: PgBoss, sql: Function, log: object, incrementJobsProcessed: Function }} param0
 */
export async function registerHandlers({ boss, sql, log, incrementJobsProcessed }) {
  const deps = { sql, boss, log, incrementJobsProcessed };

  /**
   * Register a named handler with pg-boss.
   * The work callback receives a job or array of jobs (pg-boss v10 batch mode).
   * Constructs ctx via makeContext, calls handler(ctx, deps), and tracks throughput.
   */
  const register = async (name, handler, options = {}) => {
    // pg-boss v10: boss.work() registers the handler but does NOT create
    // the queue row. Calls to boss.send(name, ...) from a handler silently
    // no-op if the queue doesn't exist. Call createQueue explicitly for
    // every registered handler. Idempotent — duplicate creates are fine.
    await boss.createQueue(name);
    return boss.work(name, options, async (job) => {
      const jobRow = Array.isArray(job) ? job[0] : job;
      const { makeContext } = await import("../worker/context.js");
      const ctx = makeContext(jobRow, sql);
      try {
        const result = await handler(ctx, deps);
        incrementJobsProcessed?.();
        return result;
      } catch (err) {
        log.error(`handler ${name} failed`, { err: err.message });
        throw err;
      }
    });
  };

  await register("discovery-weekly",          discoveryWeeklyHandler);
  await register("fetch-feed",                fetchFeedHandler,               { teamSize: 4,  teamConcurrency: 4 });
  await register("classify-candidates",       classifyCandidatesHandler,      { teamSize: 2,  teamConcurrency: 2 });
  await register("ingest-topic",              ingestTopicHandler,             { teamSize: 4,  teamConcurrency: 4 });
  // Concurrency capped at 4 so the pubmed limiter (9 RPS with api_key, 3
  // RPS without) doesn't get stampeded. The 2026-04-11 deploy ran with
  // teamSize: 14 and NCBI TCP-dropped ~5% of requests under the burst.
  await register("ingest-topic-from-source",  ingestTopicFromSourceHandler,   { teamSize: 4,  teamConcurrency: 4 });
  await register("embed-batch",               embedBatchHandler);
  await register("s2-citation-backfill",      s2CitationBackfillHandler);
  await register("rcr-backfill",              rcrBackfillHandler);
  await register("validate-queries",          validateQueriesHandler);
  await register("detect-failure-clusters",   detectFailureClustersHandler);
  await register("alert-daily-digest",        alertDailyDigestHandler);
  await register("cleanup-job-progress",      cleanupJobProgressHandler);
  await register("send-alert",               sendAlertHandler);

  // Scheduled cron jobs (pg-boss internal cron, NY timezone for DST correctness).
  // Queues were already created above in register() so schedule() can
  // attach its FK cleanly.
  await boss.schedule("discovery-weekly",        "0 3 * * 1", {},                          { tz: "America/New_York" });
  await boss.schedule("detect-failure-clusters", "*/5 * * * *", {},                        { tz: "America/New_York" });
  await boss.schedule("alert-daily-digest",      "0 8 * * *",  {},                         { tz: "America/New_York" });
  await boss.schedule("cleanup-job-progress",    "0 2 * * *",  { olderThanDays: 30 },      { tz: "America/New_York" });

  log.info("all 13 handlers registered + 4 schedules");
}
