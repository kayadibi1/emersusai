// jobs/fetch-feed.js
// Pulls new items from a single discovery feed, updates watermarks,
// and fans out classify-candidates jobs.
//
// Circuit breaker: after 3 consecutive failures, marks the feed as
// disabled and logs a warning candidate row so the operator notices
// during the weekly review.
import { getDiscoverySource } from "../scripts/sources/_registry.js";
import { SourcePermanentError } from "../scripts/sources/_errors.js";

const CHUNK_SIZE = 25;
const FAILURE_THRESHOLD = 3;

export async function fetchFeedHandler(ctx, deps) {
  const { feedId } = ctx.data;
  const { sql, boss } = deps;

  // Load feed config
  const feedRow = await sql`
    SELECT * FROM discovery_feeds WHERE id = ${feedId}
  `;
  if (feedRow.rows.length === 0) {
    throw new SourcePermanentError(`no discovery_feeds row with id=${feedId}`);
  }
  const feed = feedRow.rows[0];

  if (feed.status !== "active") {
    await ctx.progress(`feed ${feedId} is ${feed.status} — skipping`);
    return { skipped: true };
  }

  const plugin = getDiscoverySource(feed.source_plugin);
  if (!plugin) {
    throw new SourcePermanentError(`unknown discovery plugin: ${feed.source_plugin} (feed ${feedId})`);
  }

  try {
    const items = await plugin.fetchNew(feed);
    await ctx.progress(`fetched ${items.length} new items from ${feedId}`);

    // Update watermark + reset consecutive failures
    const newestAt = items.length > 0
      ? new Date(Math.max(...items.map(i => new Date(i.publishedAt).getTime())))
      : feed.last_item_at;
    await sql`
      UPDATE discovery_feeds
      SET last_run_at = now(),
          last_item_count = ${items.length},
          last_item_at = ${newestAt},
          consecutive_failures = 0,
          updated_at = now()
      WHERE id = ${feedId}
    `;

    // Fan out classify-candidates jobs in CHUNK_SIZE-item batches
    let jobsEnqueued = 0;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      await boss.send("classify-candidates", { items: chunk, feedId });
      jobsEnqueued += 1;
    }
    await ctx.progress(`enqueued ${jobsEnqueued} classify-candidates jobs`);
    return { itemCount: items.length, jobsEnqueued };
  } catch (err) {
    // Circuit breaker: record failure, disable if threshold hit
    const newCount = (feed.consecutive_failures ?? 0) + 1;
    await sql`
      UPDATE discovery_feeds
      SET last_run_at = now(),
          consecutive_failures = ${newCount},
          status = CASE WHEN ${newCount} >= ${FAILURE_THRESHOLD} THEN 'disabled' ELSE status END,
          updated_at = now()
      WHERE id = ${feedId}
    `;
    if (newCount >= FAILURE_THRESHOLD) {
      await sql`
        INSERT INTO topic_candidates (topic_key, raw_term, confidence, rationale, source_urls, discovery_feed, status)
        VALUES (
          ${"feed_dead_" + feedId},
          ${"Feed disabled: " + feedId},
          ${0.0},
          ${"Auto-disabled after " + newCount + " consecutive failures: " + err.message},
          ${[feed.url]},
          ${feedId},
          ${"rejected"}
        )
        ON CONFLICT (topic_key) DO NOTHING
      `;
      await ctx.progress(`feed ${feedId} disabled after ${newCount} failures`, "warn");
    }
    throw err;
  }
}
