// jobs/cleanup-job-progress.js
// Purges old job_progress rows to keep the table from growing unbounded.
//
// Payload: { olderThanDays? }  — defaults to 30
// Returns: { deleted }

export async function cleanupJobProgressHandler(ctx, deps) {
  const { olderThanDays = 30 } = ctx.data;
  const { sql } = deps;

  await ctx.progress(`deleting job_progress rows older than ${olderThanDays} days`);

  const result = await sql`
    DELETE FROM job_progress
    WHERE ts < now() - (${String(olderThanDays)} || ' days')::interval
  `;

  // postgres DELETE returns rowCount (not rows), but our tagged-template
  // sql helper may surface it differently. We capture what we can.
  const deleted = result.rowCount ?? result.rows?.length ?? 0;

  await ctx.progress(`deleted ${deleted} job_progress rows`);
  return { deleted };
}
