// jobs/alert-daily-digest.js
// Daily summary email. Composes a 24h digest from several SQL queries
// and sends via maybeSendAlert (dynamic import of api/lib/alerts.js).
// Always sends, even on quiet days.
//
// Digest sections:
//   - Job counts by name + state over last 24h
//   - Pending topic candidates
//   - Corpus growth by source over last 24h
//   - Feeds with consecutive failures > 0
//   - Jobs-per-hour sparkline (unicode block chars)
//
// Returns: { sent: boolean }

// Dynamic import wrapper — same pattern as detect-failure-clusters.js.
// alerts.js will exist after Milestone 10.
async function maybeSendAlert(payload) {
  try {
    const { sendAlert } = await import("../api/lib/alerts.js");
    await sendAlert(payload);
    return true;
  } catch (_err) {
    return false;
  }
}

// Sparkline: render a jobs-per-hour histogram for the last 24h
// using Unicode block characters (▁▂▃▄▅▆▇█).
function buildSparkline(hourlyCounts) {
  const BLOCKS = "▁▂▃▄▅▆▇█";
  if (!hourlyCounts.length) return "▁".repeat(24);
  const max = Math.max(...hourlyCounts, 1);
  return hourlyCounts
    .map((n) => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((n / max) * (BLOCKS.length - 1)))])
    .join("");
}

export async function alertDailyDigestHandler(ctx, deps) {
  const { sql } = deps;

  await ctx.progress("composing daily digest");

  // 1. Job counts by name + state over last 24h
  const jobStatsResult = await sql`
    SELECT name, state, count(*) AS cnt
    FROM pgboss.job
    WHERE completed_on > now() - interval '24 hours'
    GROUP BY name, state
    ORDER BY name, state
  `;
  const jobStats = jobStatsResult.rows;

  // 2. Pending topic candidates
  const pendingResult = await sql`
    SELECT count(*) AS cnt FROM topic_candidates WHERE status = 'pending'
  `;
  const pendingCount = Number(pendingResult.rows[0]?.cnt ?? 0);

  // 3. Corpus growth by source (last 24h)
  const corpusGrowthResult = await sql`
    SELECT source, count(*) AS cnt
    FROM research_articles
    WHERE created_at > now() - interval '24 hours'
    GROUP BY source
    ORDER BY cnt DESC
  `;
  const corpusGrowth = corpusGrowthResult.rows;

  // 4. Feeds with consecutive failures > 0
  const failFeedsResult = await sql`
    SELECT id, consecutive_failures FROM discovery_feeds
    WHERE consecutive_failures > 0
    ORDER BY consecutive_failures DESC
  `;
  const failFeeds = failFeedsResult.rows;

  // 5. Jobs-per-hour over last 24h for sparkline
  const hourlyResult = await sql`
    SELECT
      date_trunc('hour', completed_on) AS hour,
      count(*) AS cnt
    FROM pgboss.job
    WHERE completed_on > now() - interval '24 hours'
    GROUP BY 1
    ORDER BY 1
  `;
  // Fill 24 slots (oldest to newest)
  const hourlyCounts = Array(24).fill(0);
  for (const row of hourlyResult.rows) {
    const hoursAgo = Math.floor((Date.now() - new Date(row.hour).getTime()) / 3_600_000);
    const slot = 23 - Math.max(0, Math.min(23, hoursAgo));
    hourlyCounts[slot] = Number(row.cnt);
  }
  const sparkline = buildSparkline(hourlyCounts);

  // --- Compose body ---
  const lines = [
    `=== Emersus Daily Digest — ${new Date().toISOString().slice(0, 10)} ===`,
    "",
    `Jobs sparkline (oldest → newest, per hour): ${sparkline}`,
    "",
    "--- Job stats (last 24h) ---",
  ];

  if (jobStats.length === 0) {
    lines.push("  (no completed jobs in last 24h)");
  } else {
    const grouped = {};
    for (const row of jobStats) {
      if (!grouped[row.name]) grouped[row.name] = {};
      grouped[row.name][row.state] = Number(row.cnt);
    }
    for (const [name, states] of Object.entries(grouped)) {
      const parts = Object.entries(states)
        .map(([s, c]) => `${s}=${c}`)
        .join(" ");
      lines.push(`  ${name}: ${parts}`);
    }
  }

  lines.push("");
  lines.push("--- Topic candidates ---");
  lines.push(`  Pending review: ${pendingCount}`);

  lines.push("");
  lines.push("--- Corpus growth (last 24h) ---");
  if (corpusGrowth.length === 0) {
    lines.push("  (no new articles)");
  } else {
    for (const row of corpusGrowth) {
      lines.push(`  ${row.source}: +${row.cnt}`);
    }
  }

  lines.push("");
  lines.push("--- Discovery feeds with failures ---");
  if (failFeeds.length === 0) {
    lines.push("  All feeds healthy.");
  } else {
    for (const row of failFeeds) {
      lines.push(`  ${row.id}: ${row.consecutive_failures} consecutive failure(s)`);
    }
  }

  const body = lines.join("\n");
  const subject = `[Emersus] Daily Digest — ${new Date().toISOString().slice(0, 10)}`;

  const sent = await maybeSendAlert({ type: "daily_digest", subject, body });
  await ctx.progress(`daily digest composed and ${sent ? "sent" : "logged (alerts.js pending)"}`);

  return { sent };
}
