// scripts/heartbeat-watchdog.js
// Cron-invoked watchdog (run from Hetzner crontab every 2 minutes, NOT
// via pg-boss because if the worker is down pg-boss jobs don't fire).
// Checks worker_heartbeats for stale rows and sends an alert via
// api/lib/alerts.js if the last beat is older than HEARTBEAT_LOST_THRESHOLD_MS.
//
// Hetzner crontab entry:
//   */2 * * * * cd /home/emersus/app && /usr/bin/node scripts/heartbeat-watchdog.js >> /var/log/emersus-heartbeat-watchdog.log 2>&1
import "dotenv/config";
import pg from "pg";
import { sendAlert } from "../api/lib/alerts.js";

const HEARTBEAT_LOST_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes
const COOLDOWN_MS = 30 * 60 * 1000;                  // 30 minutes

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // 1. Find the newest heartbeat
  const { rows: hbRows } = await client.query(
    `SELECT worker_id, last_beat_at, EXTRACT(EPOCH FROM (now() - last_beat_at)) * 1000 AS age_ms
     FROM worker_heartbeats
     ORDER BY last_beat_at DESC
     LIMIT 1`
  );

  if (hbRows.length === 0) {
    console.log("[watchdog] no worker_heartbeats rows — worker never started");
    // Don't alert on empty table — on fresh install, this is expected until first boot
    process.exit(0);
  }

  const { worker_id, last_beat_at, age_ms } = hbRows[0];
  const ageMsNum = Number(age_ms);

  if (ageMsNum < HEARTBEAT_LOST_THRESHOLD_MS) {
    console.log(`[watchdog] healthy: worker=${worker_id} last_beat=${last_beat_at} age_ms=${Math.round(ageMsNum)}`);
    process.exit(0);
  }

  // Heartbeat is stale — check cooldown before alerting
  const { rows: recentAlerts } = await client.query(
    `SELECT id, sent_at FROM alert_log
      WHERE alert_type = 'worker_down'
        AND sent_at > now() - interval '30 minutes'
      ORDER BY sent_at DESC
      LIMIT 1`
  );
  if (recentAlerts.length > 0) {
    console.log(`[watchdog] worker ${worker_id} is stale (${Math.round(ageMsNum)}ms) but alert cooldown active — skipping`);
    process.exit(0);
  }

  // Fire alert
  console.log(`[watchdog] worker ${worker_id} stale for ${Math.round(ageMsNum / 1000)}s — sending alert`);
  const result = await sendAlert({
    type: "worker_down",
    subject: `[Emersus] Worker heartbeat lost — ${worker_id}`,
    body: `The emersus-worker process has not updated its heartbeat in ${Math.round(ageMsNum / 1000)} seconds.

Last worker id: ${worker_id}
Last beat at:   ${last_beat_at}
Age:            ${Math.round(ageMsNum / 1000)}s
Threshold:      ${HEARTBEAT_LOST_THRESHOLD_MS / 1000}s

Check pm2 status on Hetzner:
  ssh hetzner 'pm2 status'

If the worker is dead, restart it:
  ssh hetzner 'pm2 restart emersus-worker'

Admin dashboard: https://emersus.ai/admin/jobs`,
  });
  console.log(`[watchdog] alert result: ${JSON.stringify(result)}`);
} finally {
  await client.end();
}
