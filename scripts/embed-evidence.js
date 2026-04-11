// Load env from .env BEFORE importing clients.js — clients.js's
// loadLocalEnv() only checks .env.local, which doesn't exist in ~/app
// on Hetzner (prod uses ~/app/.env). Same fix as backfill-icite-rcr.js.
import "dotenv/config";
import { openai, supabaseAdmin } from "../api/lib/clients.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_FETCH_BATCH_SIZE = 50;
const DEFAULT_WRITE_BATCH_SIZE = 25;
const MAX_DB_RETRIES = 6;
const BASE_RETRY_DELAY_MS = 1000;

function parseArgs(argv) {
  const args = {
    fetchBatchSize: DEFAULT_FETCH_BATCH_SIZE,
    writeBatchSize: DEFAULT_WRITE_BATCH_SIZE,
    sleepMs: 0,
    maxRows: 0,
  };

  for (const rawArg of argv) {
    const [key, ...rest] = String(rawArg || "").split("=");
    const value = rest.join("=");

    if (key === "--fetch-batch-size" || key === "--batch-size") {
      args.fetchBatchSize = Number(value || DEFAULT_FETCH_BATCH_SIZE);
    } else if (key === "--write-batch-size") {
      args.writeBatchSize = Number(value || DEFAULT_WRITE_BATCH_SIZE);
    } else if (key === "--sleep-ms" || key === "--pause-ms") {
      args.sleepMs = Number(value || 0);
    } else if (key === "--max-rows") {
      args.maxRows = Number(value || 0);
    }
  }

  args.fetchBatchSize = Math.max(
    1,
    Math.min(2048, Math.floor(args.fetchBatchSize || DEFAULT_FETCH_BATCH_SIZE))
  );
  args.writeBatchSize = Math.max(
    1,
    Math.min(args.fetchBatchSize, Math.floor(args.writeBatchSize || DEFAULT_WRITE_BATCH_SIZE))
  );
  args.sleepMs = Math.max(0, Math.floor(args.sleepMs || 0));
  args.maxRows = Math.max(0, Math.floor(args.maxRows || 0));

  return args;
}

function isRetryableSupabaseError(error) {
  const message = String(error?.message || error || "");
  return (
    /502/i.test(message) ||
    /503/i.test(message) ||
    /504/i.test(message) ||
    /bad gateway/i.test(message) ||
    /gateway/i.test(message) ||
    /cloudflare/i.test(message) ||
    /timeout/i.test(message) ||
    /network/i.test(message) ||
    /fetch failed/i.test(message)
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDbRetry(label, operation) {
  let attempt = 0;

  while (true) {
    try {
      const result = await operation();

      if (result?.error && isRetryableSupabaseError(result.error)) {
        throw result.error;
      }

      return result;
    } catch (error) {
      attempt += 1;

      if (!isRetryableSupabaseError(error) || attempt >= MAX_DB_RETRIES) {
        throw error;
      }

      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `${label} failed with a retryable database error (attempt ${attempt}/${MAX_DB_RETRIES}). Waiting ${delayMs}ms before retrying...`
      );
      await wait(delayMs);
    }
  }
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchRowsNeedingEmbeddings(limit = DEFAULT_FETCH_BATCH_SIZE, afterId = 0) {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const { data, error } = await withDbRetry("Fetching rows needing embeddings", async () => {
    let query = supabaseAdmin
      .from("evidence_chunks")
      .select("id, pmid, chunk_type, content")
      .is("embedding", null)
      .order("id", { ascending: true })
      .limit(limit);

    if (afterId > 0) {
      query = query.gt("id", afterId);
    }

    return query;
  });

  if (error) throw error;
  return data || [];
}

async function generateEmbeddings(texts) {
  if (!openai) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  // Retry on 429 / rate_limit_exceeded. OpenAI returns a retry-after
  // hint in the error message ("try again in 445ms") — we honor it
  // if parseable, otherwise fall back to exponential backoff.
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });
      return response.data.map((item) => item.embedding);
    } catch (err) {
      lastError = err;
      const isRateLimit =
        err?.code === "rate_limit_exceeded" ||
        err?.status === 429 ||
        err?.type === "tokens";
      if (!isRateLimit || attempt >= 6) throw err;
      const hintMs = extractRetryHintMs(err?.message || err?.error?.message);
      const waitMs = hintMs || Math.min(30000, 1000 * 2 ** attempt);
      console.warn(
        `[embed] rate limited (attempt ${attempt}/6). Waiting ${waitMs}ms before retrying...`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

function extractRetryHintMs(message) {
  if (typeof message !== "string") return 0;
  // OpenAI format: "Please try again in 445ms" or "in 2.34s"
  const msMatch = message.match(/try again in (\d+(?:\.\d+)?)ms/i);
  if (msMatch) return Math.ceil(Number(msMatch[1]));
  const sMatch = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (sMatch) return Math.ceil(Number(sMatch[1]) * 1000);
  return 0;
}

async function updateEmbeddingsBatch(rows, embeddings) {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const payload = rows.map((row, index) => ({
    id: row.id,
    pmid: row.pmid,
    chunk_type: row.chunk_type,
    content: row.content,
    embedding: embeddings[index],
  }));

  const { error } = await withDbRetry(
    `Updating chunks ${rows[0]?.id || "?"}-${rows[rows.length - 1]?.id || "?"}`,
    async () =>
    supabaseAdmin
      .from("evidence_chunks")
      .upsert(payload, {
        onConflict: "id",
        ignoreDuplicates: false,
      })
  );

  if (error) {
    throw new Error(`Failed updating embedding batch: ${error.message}`);
  }
}

async function main() {
  console.log("embed-evidence.js started");
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Options: fetchBatchSize=${args.fetchBatchSize}, writeBatchSize=${args.writeBatchSize}, sleepMs=${args.sleepMs}, maxRows=${args.maxRows || "unlimited"}`
  );

  let totalUpdated = 0;
  let batchNum = 0;
  const totals = { fetch: 0, openai: 0, db: 0, sleep: 0 };
  const startedAt = Date.now();

  // Pipeline: prefetch the first batch, then overlap fetch+embed with writes
  let prefetchedRows = null;

  while (true) {
    if (args.maxRows > 0 && totalUpdated >= args.maxRows) {
      console.log(`Reached maxRows=${args.maxRows}. Stopping after ${totalUpdated} updates.`);
      break;
    }

    batchNum += 1;
    const batchStart = Date.now();

    const remainingLimit =
      args.maxRows > 0
        ? Math.min(args.fetchBatchSize, args.maxRows - totalUpdated)
        : args.fetchBatchSize;

    let rows;
    let fetchMs;
    if (prefetchedRows !== null) {
      rows = prefetchedRows;
      fetchMs = 0;
      prefetchedRows = null;
    } else {
      const fetchStart = Date.now();
      rows = await fetchRowsNeedingEmbeddings(remainingLimit);
      fetchMs = Date.now() - fetchStart;
    }

    if (rows.length === 0) {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`Done. Updated ${totalUpdated} rows in ${elapsedSec}s.`);
      console.log(
        `Cumulative: fetch=${(totals.fetch / 1000).toFixed(1)}s  openai=${(totals.openai / 1000).toFixed(1)}s  db=${(totals.db / 1000).toFixed(1)}s  sleep=${(totals.sleep / 1000).toFixed(1)}s`
      );
      const dom = Math.max(totals.fetch, totals.openai, totals.db);
      const bottleneck =
        dom === totals.db
          ? "DB writes (round-trip latency to Supabase)"
          : dom === totals.openai
            ? "OpenAI embeddings call"
            : "DB fetch";
      console.log(`Dominant phase: ${bottleneck}`);
      break;
    }

    const texts = rows.map((row) => row.content);

    const openaiStart = Date.now();
    const embeddings = await generateEmbeddings(texts);
    const openaiMs = Date.now() - openaiStart;

    const rowChunks = chunkArray(rows, args.writeBatchSize);
    const embeddingChunks = chunkArray(embeddings, args.writeBatchSize);

    let dbMs = 0;
    let sleepMs = 0;
    const writeCount = rowChunks.length;

    // Pipeline: start fetching next batch while writing current embeddings.
    // Use afterId to guarantee no overlap regardless of transaction timing.
    const lastId = rows[rows.length - 1].id;
    const nextRemainingLimit =
      args.maxRows > 0
        ? Math.min(args.fetchBatchSize, args.maxRows - totalUpdated - rows.length)
        : args.fetchBatchSize;
    const shouldPrefetch = nextRemainingLimit > 0;

    const writeStart = Date.now();
    const writePromises = rowChunks.map((rowChunk, index) =>
      updateEmbeddingsBatch(rowChunk, embeddingChunks[index])
    );
    const prefetchPromise = shouldPrefetch
      ? fetchRowsNeedingEmbeddings(nextRemainingLimit, lastId)
      : Promise.resolve(null);

    const [, nextRows] = await Promise.all([
      Promise.all(writePromises),
      prefetchPromise,
    ]);
    dbMs = Date.now() - writeStart;

    if (nextRows !== null) {
      prefetchedRows = nextRows;
    }

    for (const rowChunk of rowChunks) {
      totalUpdated += rowChunk.length;
    }

    if (args.sleepMs > 0) {
      const sleepStart = Date.now();
      await wait(args.sleepMs);
      sleepMs = Date.now() - sleepStart;
    }

    const totalMs = Date.now() - batchStart;
    totals.fetch += fetchMs;
    totals.openai += openaiMs;
    totals.db += dbMs;
    totals.sleep += sleepMs;

    const avgWriteMs = writeCount > 0 ? Math.round(dbMs / writeCount) : 0;
    console.log(
      `[batch ${batchNum}] rows=${rows.length} fetch=${fetchMs}ms openai=${openaiMs}ms db=${dbMs}ms (${writeCount} writes × ${args.writeBatchSize}, avg ${avgWriteMs}ms each) total=${totalMs}ms | updated=${totalUpdated}`
    );
  }
}

main().catch((err) => {
  console.error("SCRIPT ERROR:");
  console.error(err);
  process.exit(1);
});
