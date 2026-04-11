// jobs/discovery-weekly.js
// Top-level fanout job. Runs once a week via pg-boss schedule.
// 1. Wakes up snoozed candidates whose snooze_until has passed.
// 2. Selects all active discovery feeds.
// 3. Sends a fetch-feed job for each.

export async function discoveryWeeklyHandler(ctx, deps) {
  const { sql, boss } = deps;

  // Housekeeping: expired snoozes come back to pending
  await sql`
    UPDATE topic_candidates
    SET status = 'pending'
    WHERE status = 'snoozed' AND snooze_until < now()
  `;

  // Select all active feeds
  const result = await sql`
    SELECT id FROM discovery_feeds WHERE status = 'active' ORDER BY id
  `;
  const feeds = result.rows;

  for (const feed of feeds) {
    await boss.send("fetch-feed", { feedId: feed.id });
  }

  await ctx.progress(`fanned out ${feeds.length} feeds`);
  return { feedsDispatched: feeds.length };
}
