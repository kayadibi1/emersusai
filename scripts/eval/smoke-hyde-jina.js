// scripts/eval/smoke-hyde-jina.js
//
// End-to-end smoke test for the HyDE + Jina integrated retrieval path.
// Runs retrieveDatabaseEvidence with both CHAT_HYDE_ENABLED=true AND
// CHAT_JINA_RERANK_ENABLED=true and inspects the output — confirms both
// stages fired and the downstream row shape is intact for rankEvidence.

import "dotenv/config";
import "../../api/lib/clients.js";
import { retrieveDatabaseEvidence } from "../../api/emersus/retrieveDatabaseEvidence.js";

const QUERY = process.argv.slice(2).join(" ").trim() || "does sugar help endurance athletes";

async function runOne({ hyde, jina, label }) {
  process.env.RETRIEVAL_USE_V4 = "true";
  process.env.CHAT_HYDE_ENABLED = hyde ? "true" : "false";
  process.env.CHAT_JINA_RERANK_ENABLED = jina ? "true" : "false";
  const t0 = Date.now();
  const rows = await retrieveDatabaseEvidence({
    prompt: QUERY,
    matchThreshold: 0.4,
    matchCount: 25,
    includePreprints: true,
  });
  const dt = Date.now() - t0;
  const jinaScored = rows.filter((r) => typeof r._jina_score === "number").length;
  return { rows, dt, jinaScored };
}

async function main() {
  console.log(`# Query: "${QUERY}"\n`);

  const variants = [
    { hyde: false, jina: false, label: "baseline (dense only)" },
    { hyde: true,  jina: false, label: "HyDE only" },
    { hyde: true,  jina: true,  label: "HyDE + Jina" },
  ];

  for (const v of variants) {
    const { rows, dt, jinaScored } = await runOne(v);
    console.log(`## ${v.label} — ${dt}ms, ${rows.length} rows, ${jinaScored} with Jina score`);
    for (const [i, r] of rows.slice(0, 6).entries()) {
      const jina = typeof r._jina_score === "number" ? `jina=${r._jina_score.toFixed(3)}` : "no-jina";
      console.log(
        `  ${i + 1}. pmid=${String(r.pmid).padEnd(11)} sim=${Number(r.similarity || 0).toFixed(3)} ${jina.padEnd(12)} "${(r.title || "").slice(0, 80)}"`
      );
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
