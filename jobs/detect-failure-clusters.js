// jobs/detect-failure-clusters.js
// Query pg-boss for recent failure clusters, alert with 60min cooldown.
//
// Logic:
//   1. Query pgboss.job for failure clusters in last 10 minutes (≥5 failures/name)
//   2. For each cluster, check alert_log for a prior failure_cluster alert
//      for the same job name in the last hour
//   3. If none, insert alert_log row and call sendAlert
//
// Returns: { clustersDetected, alertsSent }

import { sendAlert as _sendAlert } from "../api/lib/alerts.js";

export async function detectFailureClustersHandler(ctx, deps) {
  const { sql, sendAlert = _sendAlert } = deps;

  // Query pg-boss for failure clusters in the last 10 minutes
  const clusterResult = await sql`
    SELECT name, COUNT(*) AS failure_count
    FROM pgboss.job
    WHERE state = 'failed'
      AND completed_on > now() - interval '10 minutes'
    GROUP BY name
    HAVING COUNT(*) >= 5
  `;
  const clusters = clusterResult.rows;

  await ctx.progress(`detected ${clusters.length} failure cluster(s)`);

  let alertsSent = 0;

  for (const cluster of clusters) {
    // Check for prior alert in last hour (60min cooldown)
    const priorResult = await sql`
      SELECT id FROM alert_log
      WHERE alert_type = 'failure_cluster'
        AND payload->>'job_name' = ${cluster.name}
        AND sent_at > now() - interval '1 hour'
      LIMIT 1
    `;

    if (priorResult.rows.length > 0) {
      await ctx.progress(`cluster for ${cluster.name} already alerted within 1h — skipping`);
      continue;
    }

    // Insert alert_log row
    await sql`
      INSERT INTO alert_log (alert_type, payload)
      VALUES (
        'failure_cluster',
        ${JSON.stringify({ job_name: cluster.name, failure_count: Number(cluster.failure_count) })}
      )
    `;

    const subject = `[Emersus] Failure cluster: ${cluster.name} (${cluster.failure_count} failures in 10min)`;
    const body = `Job "${cluster.name}" has failed ${cluster.failure_count} times in the last 10 minutes.\n\nCheck worker logs for details.`;

    await sendAlert({ type: "failure_cluster", subject, body });
    alertsSent++;

    await ctx.progress(`alerted on failure cluster: ${cluster.name} (${cluster.failure_count} failures)`);
  }

  return { clustersDetected: clusters.length, alertsSent };
}
