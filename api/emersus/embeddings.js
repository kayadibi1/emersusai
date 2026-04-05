import { openai } from "../lib/clients.js";

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function embedText(text) {
  const input = String(text || "").trim();

  if (!input) {
    throw new Error("Cannot embed empty text.");
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  return response.data[0].embedding;
}