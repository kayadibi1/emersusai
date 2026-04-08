import { retrieveDatabaseEvidence } from "../api/emersus/retrieveDatabaseEvidence.js";

async function main() {
  console.log("test-retrieval.js started");

  const prompt = "How much protein should I eat to maximize muscle growth?";
  const results = await retrieveDatabaseEvidence({
    prompt,
    matchThreshold: 0.4,
    matchCount: 10,
  });

  console.dir(results, { depth: null });
}

main().catch((err) => {
  console.error("SCRIPT ERROR:");
  console.error(err);
  process.exit(1);
});