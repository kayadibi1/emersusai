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
import "../scripts/sources/semantic-scholar.js";
import "../scripts/sources/epistemonikos.js";
import "../scripts/sources/openaire.js";
import "../scripts/sources/core.js";

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
   *
   * pg-boss v10 notes:
   *   - Removed the v9 `teamSize` / `teamConcurrency` options. The only
   *     fetch option is `batchSize` (default 1). Passing v9 names is
   *     silently ignored and the queue falls back to batchSize=1.
   *   - The work callback ALWAYS receives an array of job rows — even
   *     when batchSize=1. An older version of this helper did
   *     `const jobRow = Array.isArray(job) ? job[0] : job;`, which
   *     only processed the first row and silently dropped the rest if
   *     batchSize was ever >1. pg-boss then marked every id in the
   *     batch as complete, causing silent data loss.
   *
   * Our concurrency model: pg-boss fetches batches via one worker's
   * polling loop, and each worker processes its batch sequentially. For
   * true parallelism across many jobs in a single queue, we register N
   * independent workers — each polls on its own interval, each grabs
   * its own batch, and multiple handler invocations run in parallel.
   *
   * Concurrency tuning notes per queue (see call sites below):
   *   - ingest-topic-from-source: capped at 4 so the pubmed limiter
   *     (9 RPS with NCBI_API_KEY, 3 RPS without) doesn't get
   *     stampeded. The 2026-04-11 deploy ran with 14 parallel workers
   *     and NCBI TCP-dropped ~5% of requests.
   *   - Slow preprint sources (biorxiv/medrxiv/sportrxiv) share this
   *     queue, so concurrency across the fleet matters: a slow job
   *     no longer holds up fast siblings because each of the 4
   *     workers has its own fetch cycle. See the 2026-04-12 fanout
   *     post-mortem in checkpoint.md.
   */
  const register = async (name, handler, { concurrency = 1, ...workOptions } = {}) => {
    // pg-boss v10: boss.work() registers the handler but does NOT create
    // the queue row. Calls to boss.send(name, ...) from a handler silently
    // no-op if the queue doesn't exist. Call createQueue explicitly for
    // every registered handler. Idempotent — duplicate creates are fine.
    await boss.createQueue(name);

    const workCallback = async (jobs) => {
      // pg-boss v10 passes an array of job rows (length = batchSize);
      // defensively accept a single object too in case a future version
      // changes this.
      const jobList = Array.isArray(jobs) ? jobs : [jobs];
      const { makeContext } = await import("../worker/context.js");
      // Process the batch concurrently. pg-boss will mark all ids in
      // the batch complete iff the callback resolves; if any handler
      // throws we let it propagate and pg-boss retries the whole batch.
      const results = await Promise.all(jobList.map(async (jobRow) => {
        const ctx = makeContext(jobRow, sql);
        try {
          const result = await handler(ctx, deps);
          incrementJobsProcessed?.();
          return result;
        } catch (err) {
          log.error(`handler ${name} failed`, { err: err.message });
          throw err;
        }
      }));
      return results.length === 1 ? results[0] : results;
    };

    // Register `concurrency` independent workers for this queue. Each
    // worker has its own fetch loop and processes its batch, which
    // gives us true across-job parallelism without depending on the
    // v9 batching semantics.
    const workerIds = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      workerIds.push(await boss.work(name, workOptions, workCallback));
    }
    return workerIds;
  };

  await register("discovery-weekly",          discoveryWeeklyHandler);
  await register("fetch-feed",                fetchFeedHandler,               { concurrency: 4 });
  await register("classify-candidates",       classifyCandidatesHandler,      { concurrency: 2 });
  await register("ingest-topic",              ingestTopicHandler,             { concurrency: 4 });
  // Concurrency capped at 4 so the pubmed limiter (9 RPS with api_key, 3
  // RPS without) doesn't get stampeded. The 2026-04-11 deploy ran with
  // teamSize: 14 and NCBI TCP-dropped ~5% of requests under the burst.
  await register("ingest-topic-from-source",  ingestTopicFromSourceHandler,   { concurrency: 4 });
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
