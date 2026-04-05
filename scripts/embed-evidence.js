import { openai, supabaseAdmin } from "../api/lib/clients.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 50;
const MAX_DB_RETRIES = 6;
const BASE_RETRY_DELAY_MS = 1000;

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

async function fetchRowsNeedingEmbeddings(limit = BATCH_SIZE) {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const { data, error } = await withDbRetry("Fetching rows needing embeddings", async () =>
    supabaseAdmin
      .from("evidence_chunks")
      .select("id, content")
      .is("embedding", null)
      .order("id", { ascending: true })
      .limit(limit)
  );

  if (error) throw error;
  return data || [];
}

async function generateEmbeddings(texts) {
  if (!openai) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

async function updateEmbedding(id, embedding) {
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const { error } = await withDbRetry(`Updating chunk ${id}`, async () =>
    supabaseAdmin
      .from("evidence_chunks")
      .update({ embedding })
      .eq("id", id)
  );

  if (error) {
    throw new Error(`Failed updating chunk ${id}: ${error.message}`);
  }
}

async function main() {
  console.log("embed-evidence.js started");

  let totalUpdated = 0;

  while (true) {
    const rows = await fetchRowsNeedingEmbeddings(BATCH_SIZE);
    console.log(`Fetched ${rows.length} rows needing embeddings`);

    if (rows.length === 0) {
      console.log(`Done. Updated ${totalUpdated} rows.`);
      break;
    }

    const texts = rows.map((row) => row.content);
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < rows.length; i += 1) {
      await updateEmbedding(rows[i].id, embeddings[i]);
      totalUpdated += 1;
    }

    console.log(`Updated ${totalUpdated} chunks so far...`);
  }
}

main().catch((err) => {
  console.error("SCRIPT ERROR:");
  console.error(err);
  process.exit(1);
});
