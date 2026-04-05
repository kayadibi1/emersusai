import { openai, supabaseAdmin } from "../api/lib/clients.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 50;

async function fetchRowsNeedingEmbeddings(limit = BATCH_SIZE) {
  const { data, error } = await supabaseAdmin
    .from("evidence_chunks")
    .select("id, content")
    .is("embedding", null)
    .order("id", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function generateEmbeddings(texts) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

async function updateEmbedding(id, embedding) {
  const { error } = await supabaseAdmin
    .from("evidence_chunks")
    .update({ embedding })
    .eq("id", id);

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