// jobs/bulk-ingest-active-topics.js
// Recurring fanout job. Enqueues `ingest-topic` for every research_topics
// row with status='active'. Mirrors the manual `scripts/fill-pmc-topics.js
// --all` command but as a scheduled handler so the corpus stays current
// without an operator running the script by hand.
//
// Singleton convention matches the manual script: each child uses
// `bulk-ingest-${topicId}` with singletonHours=24, so an ad-hoc manual
// run on the same day still de-duplicates against this scheduled run.

export async function bulkIngestActiveTopicsHandler(ctx, deps) {
  const { sql, boss, log } = deps;

  const { rows } = await sql`
    SELECT id, topic_key
    FROM research_topics
    WHERE status = 'active'
    ORDER BY id
  `;

  let enqueued = 0;
  let skipped = 0;
  for (const row of rows) {
    const jobId = await boss.send(
      "ingest-topic",
      { topicId: row.id },
      {
        singletonKey: `bulk-ingest-${row.id}`,
        singletonHours: 24,
      }
    );
    if (jobId) enqueued += 1;
    else skipped += 1;
  }

  log.info("bulk-ingest-active-topics done", {
    total: rows.length,
    enqueued,
    skipped,
  });

  return { total: rows.length, enqueued, skipped };
}
