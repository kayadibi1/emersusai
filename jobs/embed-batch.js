// jobs/embed-batch.js
// Ports the core logic from scripts/embed-evidence.js into a pg-boss handler.
//
// Selects unembedded evidence_chunks (embedding IS NULL), calls OpenAI
// text-embedding-3-small in batches, writes results back. Preserves all
// battle-tested behaviors from the original script:
//   - Rate-limit retry with exponential backoff + OpenAI retry-hint parsing
//   - Bad-payload bisect: isolates unembeddable chunks rather than dying
//   - Graceful abort: if ctx.signal fires between batches, exits without throw
//   - Retryable DB error classification (5xx, gateway, timeout)
//
// Payload: { limit? }
// Deps:    { sql, openaiClient? }  — openaiClient defaults to import from clients.js

import { openai as defaultOpenai } from "../api/lib/clients.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
// Batch size tuned for tier-2 OpenAI TPM. 200 inputs × ~200 tokens/chunk ≈
// 40k tokens per call. With ~15 calls/min per worker, one worker runs at
// roughly 600k TPM — safely under the 1M TPM cap. Combined with
// concurrency=2 in the registry, aggregate ≈ 1.2M TPM which 429-smooths
// to near the ceiling via the retry-hint pacing in embedBatchWithRetries.
// 50 was the original (tested) value — change revisited 2026-04-14 after
// the ~45 chunks/sec observed ceiling during the non-pubmed backfill.
const DEFAULT_FETCH_BATCH_SIZE = 200;
const MAX_DB_RETRIES = 6;
const BASE_RETRY_DELAY_MS = 1000;

// --- Retry helpers (ported from embed-evidence.js) ---

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withDbRetry(label, operation) {
  let attempt = 0;
  while (true) {
    try {
      const result = await operation();
      if (result?.error && isRetryableSupabaseError(result.error)) throw result.error;
      return result;
    } catch (error) {
      attempt++;
      if (!isRetryableSupabaseError(error) || attempt >= MAX_DB_RETRIES) throw error;
      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }
}

function isFatalEmbeddingPayloadError(err) {
  return (
    err?.code === "invalid_request_error" ||
    err?.type === "invalid_request_error" ||
    err?.status === 400
  );
}

function extractRetryHintMs(message) {
  if (typeof message !== "string") return 0;
  const msMatch = message.match(/try again in (\d+(?:\.\d+)?)ms/i);
  if (msMatch) return Math.ceil(Number(msMatch[1]));
  const sMatch = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (sMatch) return Math.ceil(Number(sMatch[1]) * 1000);
  return 0;
}

function sanitizeForJson(text) {
  if (typeof text !== "string") return "";
  const roundTripped = Buffer.from(text, "utf-8").toString("utf-8");
  return roundTripped.replace(/\u0000/g, "");
}

// Recursive embed with rate-limit retry + bisect on bad-payload errors
async function embedWithRetry(texts, openaiClient) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await openaiClient.embeddings.create({
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

      if (isRateLimit && attempt < 6) {
        const hintMs = extractRetryHintMs(err?.message || err?.error?.message);
        const waitMs = hintMs || Math.min(30000, 1000 * 2 ** attempt);
        await sleep(waitMs);
        continue;
      }

      if (isFatalEmbeddingPayloadError(err) && texts.length > 1) {
        const mid = Math.floor(texts.length / 2);
        const leftEmb = await embedWithRetry(texts.slice(0, mid), openaiClient);
        const rightEmb = await embedWithRetry(texts.slice(mid), openaiClient);
        return [...leftEmb, ...rightEmb];
      }

      if (isFatalEmbeddingPayloadError(err) && texts.length === 1) {
        // Drop this chunk — leave embedding null
        return [null];
      }

      throw err;
    }
  }
  throw lastError;
}

// --- Main handler ---

export async function embedBatchHandler(ctx, deps) {
  const { limit } = ctx.data;
  const { sql } = deps;
  // Honor an explicit `null` (callers signalling "no client available") as
  // distinct from `undefined` (caller didn't specify → use default). `??`
  // would fall through on both, which hides bugs in callers that pass null
  // by mistake and masks the OPENAI_API_KEY misconfig error in tests.
  const openaiClient = deps.openaiClient === undefined ? defaultOpenai : deps.openaiClient;

  if (!openaiClient) {
    throw new Error("OPENAI client not configured — set OPENAI_API_KEY");
  }

  const fetchBatchSize = limit ?? DEFAULT_FETCH_BATCH_SIZE;
  let totalUpdated = 0;
  let batchNum = 0;
  let afterId = 0;

  while (true) {
    // Check for abort between batches
    if (ctx.signal.aborted) {
      await ctx.progress(`aborted after ${totalUpdated} embeddings`);
      break;
    }

    // Fetch next batch of un-embedded chunks
    const result = await withDbRetry("fetch unembedded chunks", () =>
      sql`
        SELECT id, pmid, chunk_type, content
        FROM evidence_chunks
        WHERE embedding IS NULL AND id > ${afterId}
        ORDER BY id ASC
        LIMIT ${fetchBatchSize}
      `
    );
    const rows = result.rows;

    if (rows.length === 0) break;

    batchNum++;
    afterId = rows[rows.length - 1].id;

    const texts = rows.map((r) => sanitizeForJson(r.content));
    const embeddings = await embedWithRetry(texts, openaiClient);

    // Write back — skip null embeddings (bad-payload bisect dropped them)
    const toUpsert = rows
      .map((row, i) => ({ id: row.id, embedding: embeddings[i] }))
      .filter((e) => e.embedding != null);

    if (toUpsert.length > 0) {
      // Batch-update in a single SQL statement via unnest. The old
      // per-row UPDATE loop was N sequential round-trips (~5-10ms each),
      // which dominated the per-batch wall clock for any batch size above
      // ~50. Measured 2026-04-14 during the non-pubmed backfill: 200-row
      // batches spent ~2s in DB writes vs ~1s in OpenAI.
      const ids = toUpsert.map((e) => e.id);
      const embStrs = toUpsert.map((e) => "[" + e.embedding.join(",") + "]");
      await withDbRetry("batch update embeddings", () =>
        sql`
          UPDATE evidence_chunks AS ec
             SET embedding = v.emb::vector
             FROM (
               SELECT unnest(${ids}::bigint[]) AS id,
                      unnest(${embStrs}::text[]) AS emb
             ) v
          WHERE ec.id = v.id
        `
      );
      totalUpdated += toUpsert.length;
    }

    await ctx.progress(`batch ${batchNum}: embedded ${toUpsert.length}/${rows.length} chunks (total ${totalUpdated})`);
  }

  return { embedded: totalUpdated, batches: batchNum };
}
