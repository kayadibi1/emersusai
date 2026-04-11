// jobs/s2-citation-backfill.js
// Ports scripts/backfill-semantic-scholar.js logic into a pg-boss handler.
//
// Key behaviors preserved from the original battle-tested script:
//   - SemanticScholarBatchAllInvalid fast-path: avoids log2(N) bisection
//     when S2 explicitly says it doesn't know any PMIDs in the batch.
//   - 1500ms pause between batches (S2 token bucket, authenticated tier)
//   - curl-based transport (Node fetch hangs on this endpoint)
//   - Recursive bisect on generic HTTP 400s
//   - s2_checked_at sentinel: converges regardless of S2 data availability
//
// Payload: { limit?, batchSize?, pauseMs? }
// Returns: { checked, updated }

import { spawn } from "node:child_process";
import {
  buildSemanticScholarBatchUrl,
  buildSemanticScholarBatchBody,
  parseSemanticScholarResponse,
} from "../scripts/lib/semantic-scholar.js";

const S2_API_KEY = (process.env.SEMANTIC_SCHOLAR_API_KEY || "").trim();
const HAS_API_KEY = S2_API_KEY.length > 0;

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PAUSE_MS = HAS_API_KEY ? 1500 : 3500;
const RETRY_DELAY_MS = HAS_API_KEY ? 2000 : 10000;
const REQUEST_TIMEOUT_MS = 25000;
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- S2 sentinel errors (ported from backfill-semantic-scholar.js) ---

class SemanticScholarBatchSkip extends Error {
  constructor(message) {
    super(message);
    this.name = "SemanticScholarBatchSkip";
  }
}

// Critical fast-path: S2 rejected ALL PMIDs as unknown. Bisecting would
// just burn rate-limit budget proving what we already know.
class SemanticScholarBatchAllInvalid extends Error {
  constructor(message, pmids) {
    super(message);
    this.name = "SemanticScholarBatchAllInvalid";
    this.pmids = pmids;
  }
}

// --- curl transport (same reason as original: Node fetch hangs) ---

function curlSemanticScholarBatch(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      "-s", "-o", "-",
      "-w", "\\n%{http_code}",
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", "User-Agent: emersus-backfill/1.0 (+https://emersus.ai)",
    ];
    if (HAS_API_KEY) {
      args.push("-H", `x-api-key: ${S2_API_KEY}`);
    }
    args.push("--data-binary", "@-", url);

    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      const newlineIdx = stdout.lastIndexOf("\n");
      const statusLine = newlineIdx >= 0 ? stdout.slice(newlineIdx + 1) : "";
      const bodyText = newlineIdx >= 0 ? stdout.slice(0, newlineIdx) : stdout;
      const status = Number(statusLine.trim()) || 0;
      resolve({ status, bodyText });
    });
    child.stdin.write(body);
    child.stdin.end();
  });
}

async function fetchSemanticScholarWithRetry(pmids) {
  const url = buildSemanticScholarBatchUrl();
  const body = JSON.stringify(buildSemanticScholarBatchBody(pmids));
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, bodyText } = await curlSemanticScholarBatch(url, body, REQUEST_TIMEOUT_MS);

      if (status === 429) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (status === 400) {
        if (bodyText.includes("No valid paper ids given")) {
          throw new SemanticScholarBatchAllInvalid(
            `Semantic Scholar rejected all ${pmids.length} PMIDs as unrecognized.`,
            pmids
          );
        }
        throw new SemanticScholarBatchSkip(
          `Semantic Scholar HTTP 400 on batch of ${pmids.length} PMIDs; skipping.`
        );
      }
      if (status < 200 || status >= 300) {
        throw new Error(`Semantic Scholar HTTP ${status}: ${bodyText.slice(0, 200)}`);
      }
      return JSON.parse(bodyText);
    } catch (err) {
      if (err instanceof SemanticScholarBatchSkip) throw err;
      if (err instanceof SemanticScholarBatchAllInvalid) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError || new Error("Semantic Scholar: retries exhausted");
}

async function processBatchWithBisect(pmids) {
  try {
    const body = await fetchSemanticScholarWithRetry(pmids);
    const updates = parseSemanticScholarResponse(body);
    return { updates, dead: [] };
  } catch (err) {
    // Fast path: every PMID in batch unknown to S2
    if (err instanceof SemanticScholarBatchAllInvalid) {
      return { updates: [], dead: err.pmids };
    }
    if (!(err instanceof SemanticScholarBatchSkip)) throw err;
    if (pmids.length === 1) {
      return { updates: [], dead: [pmids[0]] };
    }
    const mid = Math.floor(pmids.length / 2);
    const left = await processBatchWithBisect(pmids.slice(0, mid));
    const right = await processBatchWithBisect(pmids.slice(mid));
    return {
      updates: [...left.updates, ...right.updates],
      dead: [...left.dead, ...right.dead],
    };
  }
}

// --- Handler ---

export async function s2CitationBackfillHandler(ctx, deps) {
  const { limit, batchSize: payloadBatchSize, pauseMs: payloadPauseMs } = ctx.data;
  const { sql } = deps;

  const batchSize = payloadBatchSize ?? DEFAULT_BATCH_SIZE;
  const pauseMs = payloadPauseMs ?? DEFAULT_PAUSE_MS;
  const maxBatches = limit ? Math.ceil(limit / batchSize) : Infinity;

  let cursor = null;
  let batchNum = 0;
  let totalChecked = 0;
  let totalUpdated = 0;

  await ctx.progress(`s2-backfill starting: batchSize=${batchSize} pauseMs=${pauseMs} apiKey=${HAS_API_KEY ? "set" : "unset"}`);

  while (batchNum < maxBatches) {
    if (ctx.signal.aborted) {
      await ctx.progress("aborted");
      break;
    }

    // Fetch next page of un-checked PMIDs
    let pageResult;
    if (cursor != null) {
      pageResult = await sql`
        SELECT pmid FROM research_articles
        WHERE s2_checked_at IS NULL AND pmid IS NOT NULL AND pmid > ${cursor}
        ORDER BY pmid ASC
        LIMIT ${batchSize}
      `;
    } else {
      pageResult = await sql`
        SELECT pmid FROM research_articles
        WHERE s2_checked_at IS NULL AND pmid IS NOT NULL
        ORDER BY pmid ASC
        LIMIT ${batchSize}
      `;
    }

    const page = pageResult.rows;
    if (page.length === 0) {
      await ctx.progress("no more rows with s2_checked_at IS NULL; done");
      break;
    }

    const pmids = page.map((r) => r.pmid);
    cursor = pmids[pmids.length - 1];
    batchNum++;
    totalChecked += pmids.length;

    const { updates, dead } = await processBatchWithBisect(pmids);

    if (updates.length > 0) {
      // Update citation counts for matched PMIDs
      for (const u of updates) {
        await sql`
          UPDATE research_articles
          SET citation_count = ${u.citation_count},
              influential_citation_count = ${u.influential_citation_count},
              s2_checked_at = now()
          WHERE pmid = ${u.pmid}
        `;
      }
      totalUpdated += updates.length;
    }

    // Mark checked (no-data or dead) PMIDs so they stop reappearing
    const matchedPmids = new Set(updates.map((u) => u.pmid));
    const toMark = [
      ...pmids.filter((p) => !matchedPmids.has(p) && !dead.includes(p)),
      ...dead,
    ];
    if (toMark.length > 0) {
      for (const pmid of toMark) {
        await sql`
          UPDATE research_articles
          SET s2_checked_at = now()
          WHERE pmid = ${pmid} AND s2_checked_at IS NULL
        `;
      }
    }

    await ctx.progress(`batch=${batchNum} checked=${totalChecked} updated=${totalUpdated}`);
    await sleep(pauseMs);
  }

  return { checked: totalChecked, updated: totalUpdated };
}
