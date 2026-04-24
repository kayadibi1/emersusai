// scripts/eval/smoke-jina.js
//
// One-call sanity check that JINA_API_KEY is set and the reranker API
// actually answers. Prints Jina's rerank order over a toy 5-doc set for
// a biomedical query so we can eyeball that it's working before a full
// matrix run.
//
// Usage:
//   node scripts/eval/smoke-jina.js

import "dotenv/config";
// Also run the shared .env.local loader used by bench-matrix so keys live
// in either .env or .env.local interchangeably.
import "../../api/lib/clients.js";
import { rerank } from "./lib/cross-rerank.js";

const QUERY = "does sugar help endurance athletes";

const CANDIDATES = [
  { id: 1, content: "Carbohydrate mouth rinse improves 40km cycling time trial performance via central nervous system activation without providing metabolic substrate." },
  { id: 2, content: "Sugar consumption and dental caries prevalence in school-age children: a systematic review." },
  { id: 3, content: "Glucose-fructose co-ingestion at 2:1 ratio increases exogenous carbohydrate oxidation to 1.5 g/min versus 1.0 g/min with glucose alone in trained cyclists." },
  { id: 4, content: "Effects of high-fructose corn syrup on non-alcoholic fatty liver disease progression in sedentary adults." },
  { id: 5, content: "A review of sucrose ingestion during prolonged endurance exercise and its effect on time-to-exhaustion at 75% VO2max." },
];

async function main() {
  if (!process.env.JINA_API_KEY) {
    console.error("JINA_API_KEY missing from .env.local. Add it and retry.");
    process.exit(1);
  }
  const t0 = Date.now();
  const ranked = await rerank({
    backend: "jina",
    query: QUERY,
    candidates: CANDIDATES,
    topN: 5,
  });
  const dt = Date.now() - t0;
  console.log(`# Query: "${QUERY}"`);
  console.log(`# Jina rerank (${dt}ms, ${ranked.length} results)\n`);
  for (const [i, row] of ranked.entries()) {
    console.log(`  ${i + 1}. id=${row.id} score=${row.score.toFixed(3)} (orig #${row.original_rank + 1})`);
    console.log(`     ${row.content.slice(0, 110)}${row.content.length > 110 ? "…" : ""}`);
  }
  console.log("\n# Expected: ids 1, 3, 5 (endurance / cycling / mouth rinse / glucose-fructose) should rank above ids 2, 4 (dental caries / NAFLD).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
