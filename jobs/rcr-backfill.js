// jobs/rcr-backfill.js
// Ports scripts/backfill-icite-rcr.js logic into a pg-boss handler.
//
// Reads research_articles rows where rcr IS NULL, calls NIH iCite API
// in batches to get Relative Citation Ratio (RCR) scores, writes them back.
//
// Preserved behaviors from original script:
//   - iCite 200-PMID cap per request (URL length limit bites before the
//     documented 1000-PMID cap)
//   - 300ms pause between batches (polite / avoids throttle)
//   - 3x retry with exponential backoff for transient HTTP errors
//   - Idempotent: only rows where rcr IS NULL are selected
//
// Payload: { limit?, batchSize?, pauseMs? }
// Returns: { checked, updated }

import { buildIciteUrl, parseIciteResponse } from "../scripts/lib/icite.js";

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_PAUSE_MS = 300;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchIciteWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`iCite HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

export async function rcrBackfillHandler(ctx, deps) {
  const { limit, batchSize: payloadBatchSize, pauseMs: payloadPauseMs } = ctx.data;
  const { sql } = deps;

  const batchSize = payloadBatchSize ?? DEFAULT_BATCH_SIZE;
  const pauseMs = payloadPauseMs ?? DEFAULT_PAUSE_MS;
  const maxBatches = limit ? Math.ceil(limit / batchSize) : Infinity;

  let cursor = null;
  let batchNum = 0;
  let totalChecked = 0;
  let totalUpdated = 0;

  await ctx.progress(`rcr-backfill starting: batchSize=${batchSize} pauseMs=${pauseMs}`);

  while (batchNum < maxBatches) {
    if (ctx.signal.aborted) {
      await ctx.progress("aborted");
      break;
    }

    // Fetch next page of PMIDs where rcr IS NULL
    let pageResult;
    if (cursor != null) {
      pageResult = await sql`
        SELECT pmid FROM research_articles
        WHERE rcr IS NULL AND pmid IS NOT NULL AND pmid > ${cursor}
        ORDER BY pmid ASC
        LIMIT ${batchSize}
      `;
    } else {
      pageResult = await sql`
        SELECT pmid FROM research_articles
        WHERE rcr IS NULL AND pmid IS NOT NULL
        ORDER BY pmid ASC
        LIMIT ${batchSize}
      `;
    }

    const page = pageResult.rows;
    if (page.length === 0) {
      await ctx.progress("no more rows with rcr IS NULL; done");
      break;
    }

    const pmids = page.map((r) => r.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalChecked += pmids.length;

    const url = buildIciteUrl(pmids);
    const body = await fetchIciteWithRetry(url);
    const updates = parseIciteResponse(body);

    if (updates.length > 0) {
      for (const u of updates) {
        await sql`
          UPDATE research_articles
          SET rcr = ${u.rcr}
          WHERE pmid = ${u.pmid}
        `;
      }
      totalUpdated += updates.length;
    }

    await ctx.progress(`batch=${batchNum} checked=${totalChecked} updated=${totalUpdated}`);
    await sleep(pauseMs);
  }

  return { checked: totalChecked, updated: totalUpdated };
}
